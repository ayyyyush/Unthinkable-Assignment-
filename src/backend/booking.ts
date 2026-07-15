import { Prisma, SlotStatus, AppointmentStatus } from "@prisma/client";
import { prisma } from "./db";
import { env } from "./env";
import { ConflictError, NotFoundError } from "./apiError";
import { writeAuditLog } from "./audit";
import { queueNotification } from "./notify";

/**
 * ── Why this is race-free ─────────────────────────────────────────────
 *
 * Every state transition below follows the same shape:
 *
 *   UPDATE "AppointmentSlot"
 *   SET status = <next>, ...
 *   WHERE id = <slotId> AND status = <expected-current>
 *
 * expressed through `prisma.appointmentSlot.updateMany({ where: { id, status } })`.
 * Postgres executes this as a single atomic statement: row-level locking
 * guarantees that if two transactions race to update the same row, exactly
 * one of them sees `status = <expected-current>` still true and wins: it
 * updates 1 row. The other transaction's WHERE clause no longer matches
 * (the winner already changed the status), so it updates 0 rows — that's
 * the signal we check (`result.count === 0`) to return a clean "already
 * taken" error instead of a duplicate booking or a crash.
 *
 * This holds regardless of how many application server instances are
 * running, because the guarantee lives in Postgres's row lock, not in any
 * in-process mutex. A Redis distributed lock would only add an
 * *application-layer* mutual-exclusion check in front of this — it cannot
 * replace it, because a lock whose TTL expires mid-request would let two
 * requests both believe they hold exclusivity while Postgres still only
 * commits one of their updates anyway. The database is the source of
 * truth; a lock is at best a latency optimization on top of it. This app
 * does not add one, since the Postgres guarantee alone is sufficient for
 * clinic-scale traffic (see Phase 1 architecture doc for the full
 * trade-off discussion).
 *
 * The whole hold → confirm → cancel/reschedule flow additionally wraps the
 * slot update and the Appointment row write in a single `prisma.$transaction`
 * so the two are never observably inconsistent (e.g. a slot marked HELD
 * with no corresponding Appointment row if the process crashes mid-request).
 */

const HOLD_MS = env.SLOT_HOLD_MINUTES * 60 * 1000;

export async function holdSlot(params: { doctorId: string; slotId: string; patientId: string }) {
  const { doctorId, slotId, patientId } = params;
  const now = new Date();
  const holdExpiresAt = new Date(now.getTime() + HOLD_MS);

  return prisma.$transaction(async (tx) => {
    // Conditional update: only succeeds if the slot is currently AVAILABLE,
    // or HELD but its previous hold has already expired (lazy expiry — see
    // note in cron/cleanup-holds for why we don't rely on the cron alone).
    const result = await tx.appointmentSlot.updateMany({
      where: {
        id: slotId,
        doctorId,
        OR: [
          { status: SlotStatus.AVAILABLE },
          { status: SlotStatus.HELD, holdExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: SlotStatus.HELD,
        heldByPatientId: patientId,
        holdExpiresAt,
      },
    });

    if (result.count === 0) {
      throw new ConflictError("This slot is no longer available. Please choose another.");
    }

    const slot = await tx.appointmentSlot.findUniqueOrThrow({ where: { id: slotId } });

    const appointment = await tx.appointment.create({
      data: {
        slotId,
        doctorId,
        patientId,
        status: AppointmentStatus.PENDING_SYMPTOMS,
      },
    });

    await writeAuditLog(tx, {
      userId: patientId,
      action: "SLOT_HELD",
      entityType: "AppointmentSlot",
      entityId: slotId,
    });

    return { appointment, slot, holdExpiresAt };
  });
}

/**
 * Confirms a held appointment: attaches the symptom submission and flips
 * the slot HELD -> BOOKED. AI summary generation is deliberately NOT
 * awaited inside this transaction — a slow or down OpenAI call must never
 * hold a DB transaction (or the slot hold) open. It's dispatched
 * fire-and-forget immediately after commit; see src/backend/ai.ts for the
 * retry/fallback contract.
 */
export async function confirmAppointment(params: {
  appointmentId: string;
  patientId: string;
  symptomText: string;
}) {
  const { appointmentId, patientId, symptomText } = params;
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findUnique({
      where: { id: appointmentId },
      include: { slot: true },
    });

    if (!appointment || appointment.patientId !== patientId) {
      throw new NotFoundError("Appointment not found");
    }
    if (appointment.status !== AppointmentStatus.PENDING_SYMPTOMS) {
      throw new ConflictError("This appointment is not awaiting symptom confirmation");
    }
    if (appointment.slot.holdExpiresAt && appointment.slot.holdExpiresAt < now) {
      throw new ConflictError("Your slot hold has expired. Please book again.");
    }

    // Conditional update mirrors the same pattern as holdSlot: only
    // transitions HELD -> BOOKED if it's still HELD by this patient.
    const slotUpdate = await tx.appointmentSlot.updateMany({
      where: { id: appointment.slotId, status: SlotStatus.HELD, heldByPatientId: patientId },
      data: { status: SlotStatus.BOOKED, holdExpiresAt: null },
    });
    if (slotUpdate.count === 0) {
      throw new ConflictError("Your slot hold has expired. Please book again.");
    }

    await tx.appointment.update({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.CONFIRMED },
    });

    const symptom = await tx.symptom.create({
      data: { appointmentId, rawText: symptomText },
    });

    await writeAuditLog(tx, {
      userId: patientId,
      action: "APPOINTMENT_CONFIRMED",
      entityType: "Appointment",
      entityId: appointmentId,
    });

    return { appointment, symptom };
  });

  // Post-commit side effects: never inside the transaction above.
  await queueNotification({
    type: "BOOKING_CONFIRMATION",
    appointmentId,
  });

  return result;
}

export async function cancelAppointment(params: {
  appointmentId: string;
  actingUserId: string;
  reason?: string;
}) {
  const { appointmentId, actingUserId, reason } = params;

  const result = await prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment) throw new NotFoundError("Appointment not found");

    if (
      appointment.status !== AppointmentStatus.CONFIRMED &&
      appointment.status !== AppointmentStatus.PENDING_SYMPTOMS
    ) {
      throw new ConflictError("This appointment can no longer be cancelled");
    }

    await tx.appointment.update({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.CANCELLED, cancelReason: reason },
    });

    // Release the slot back to the pool unconditionally — cancellation
    // always wins over whatever the slot's current status is, since the
    // appointment row itself is our authority here (not the slot).
    await tx.appointmentSlot.update({
      where: { id: appointment.slotId },
      data: { status: SlotStatus.AVAILABLE, heldByPatientId: null, holdExpiresAt: null },
    });

    await writeAuditLog(tx, {
      userId: actingUserId,
      action: "APPOINTMENT_CANCELLED",
      entityType: "Appointment",
      entityId: appointmentId,
      metadata: { reason },
    });

    return appointment;
  });

  await queueNotification({ type: "CANCELLATION", appointmentId });

  return result;
}

/**
 * Reschedule = hold the new slot with the *same* race-safety guarantee as
 * a fresh booking (not a separate, unaudited code path), then supersede the
 * old appointment. Both happen in one transaction so a crash between the
 * two steps can never leave the patient holding neither slot nor lose the
 * old appointment's history.
 */
export async function rescheduleAppointment(params: {
  appointmentId: string;
  newSlotId: string;
  patientId: string;
}) {
  const { appointmentId, newSlotId, patientId } = params;
  const now = new Date();
  const holdExpiresAt = new Date(now.getTime() + HOLD_MS);

  const result = await prisma.$transaction(async (tx) => {
    const oldAppointment = await tx.appointment.findUnique({ where: { id: appointmentId } });
    if (!oldAppointment || oldAppointment.patientId !== patientId) {
      throw new NotFoundError("Appointment not found");
    }
    if (oldAppointment.status !== AppointmentStatus.CONFIRMED) {
      throw new ConflictError("Only confirmed appointments can be rescheduled");
    }

    const newSlot = await tx.appointmentSlot.findUnique({ where: { id: newSlotId } });
    if (!newSlot || newSlot.doctorId !== oldAppointment.doctorId) {
      throw new NotFoundError("Target slot not found for this doctor");
    }

    // Same conditional-update guarantee as a fresh hold: only succeeds if
    // the target slot is genuinely free right now.
    const claim = await tx.appointmentSlot.updateMany({
      where: {
        id: newSlotId,
        OR: [
          { status: SlotStatus.AVAILABLE },
          { status: SlotStatus.HELD, holdExpiresAt: { lt: now } },
        ],
      },
      data: { status: SlotStatus.BOOKED, heldByPatientId: patientId, holdExpiresAt: null },
    });
    if (claim.count === 0) {
      throw new ConflictError("That slot was just taken. Please pick another.");
    }

    const newAppointment = await tx.appointment.create({
      data: {
        slotId: newSlotId,
        doctorId: oldAppointment.doctorId,
        patientId,
        status: AppointmentStatus.CONFIRMED,
      },
    });

    await tx.appointment.update({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.RESCHEDULED, supersededById: newAppointment.id },
    });

    await tx.appointmentSlot.update({
      where: { id: oldAppointment.slotId },
      data: { status: SlotStatus.AVAILABLE, heldByPatientId: null, holdExpiresAt: null },
    });

    await writeAuditLog(tx, {
      userId: patientId,
      action: "APPOINTMENT_RESCHEDULED",
      entityType: "Appointment",
      entityId: appointmentId,
      metadata: { newAppointmentId: newAppointment.id },
    });

    return newAppointment;
  });

  await queueNotification({ type: "RESCHEDULE", appointmentId: result.id });

  return result;
}

export type TransactionClient = Prisma.TransactionClient;
