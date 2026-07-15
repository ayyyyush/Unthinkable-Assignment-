import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/backend/db";
import { requireCron } from "@/backend/requireCron";
import { toErrorResponse } from "@/backend/apiError";
import { writeAuditLog } from "@/backend/audit";

/**
 * Runs every minute. Handles the "patient abandons the symptom form"
 * edge case: a slot HELD past its holdExpiresAt is released back to
 * AVAILABLE, and its dangling PENDING_SYMPTOMS appointment is cancelled.
 *
 * Note this is a backstop, not the only place expiry is enforced — the
 * booking engine (holdSlot, confirmAppointment) also treats an expired
 * hold as available/invalid *at request time*, so correctness never
 * depends on this cron having run recently. This job exists purely so
 * expired holds don't linger indefinitely in the DB, not to prevent races.
 */
export async function POST(req: NextRequest) {
  try {
    requireCron(req);

    const now = new Date();

    const expiredSlots = await prisma.appointmentSlot.findMany({
      where: { status: "HELD", holdExpiresAt: { lt: now } },
      include: { appointment: true },
    });

    let releasedCount = 0;

    for (const slot of expiredSlots) {
      await prisma.$transaction(async (tx) => {
        // Conditional update guards against a race with a patient who
        // confirms in the instant between our read above and this write.
        const result = await tx.appointmentSlot.updateMany({
          where: { id: slot.id, status: "HELD", holdExpiresAt: { lt: now } },
          data: { status: "AVAILABLE", heldByPatientId: null, holdExpiresAt: null },
        });
        if (result.count === 0) return; // lost the race to a confirm — nothing to do

        if (slot.appointment && slot.appointment.status === "PENDING_SYMPTOMS") {
          await tx.appointment.update({
            where: { id: slot.appointment.id },
            data: { status: "CANCELLED", cancelReason: "Slot hold expired" },
          });
        }

        await writeAuditLog(tx, {
          action: "SLOT_HOLD_EXPIRED",
          entityType: "AppointmentSlot",
          entityId: slot.id,
        });

        releasedCount += 1;
      });
    }

    return NextResponse.json({ releasedCount });
  } catch (err) {
    return toErrorResponse(err);
  }
}
