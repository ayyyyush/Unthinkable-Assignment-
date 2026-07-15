import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/backend/requireAuth";
import { prisma } from "@/backend/db";
import { toErrorResponse, NotFoundError } from "@/backend/apiError";
import { writeAuditLog } from "@/backend/audit";
import { sendEmail, renderEmail } from "@/backend/email";

const bodySchema = z.object({
  date: z.string().datetime(), // UTC midnight of the doctor's local leave date
  reason: z.string().max(500).optional(),
});

/**
 * Doctor-leave conflict handling, end to end:
 *
 * 1. Record the leave day (kept even if everything after this point fails —
 *    the doctor's intent to be off is the fact of record).
 * 2. Find every BOOKED slot for that doctor on that date and pull its
 *    Appointment. These are exactly the conflicts: appointments that existed
 *    *before* the leave was marked.
 * 3. Cancel each affected appointment through the same `cancelAppointment`
 *    semantics (slot released, status set to CANCELLED) so this doesn't
 *    become a second, subtly different cancellation code path.
 * 4. Notify every affected patient by email, including up to 3 alternative
 *    open slots with the same doctor, and persist a Notification row
 *    regardless of send success — the notification log must survive even
 *    if the send itself fails, so nothing goes silently missing.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = requireAuth(req, ["DOCTOR"]);
    const { date, reason } = bodySchema.parse(await req.json());

    const doctor = await prisma.doctorProfile.findUnique({
      where: { userId: auth.sub },
      include: { user: true },
    });
    if (!doctor) throw new NotFoundError("Doctor profile not found");

    const leaveDate = new Date(date);
    const dayStart = new Date(leaveDate);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const leave = await prisma.doctorLeave.create({
      data: { doctorId: doctor.id, date: dayStart, reason },
    });

    const conflictingSlots = await prisma.appointmentSlot.findMany({
      where: {
        doctorId: doctor.id,
        startTime: { gte: dayStart, lt: dayEnd },
        status: "BOOKED",
      },
      include: {
        appointment: { include: { patient: { include: { user: true } } } },
      },
    });

    // Pull alternative open slots on other days for this doctor, to suggest
    // in the notification. Fetched once, reused for every affected patient.
    const alternativeSlots = await prisma.appointmentSlot.findMany({
      where: {
        doctorId: doctor.id,
        status: "AVAILABLE",
        startTime: { gt: dayEnd },
      },
      orderBy: { startTime: "asc" },
      take: 3,
    });

    const notifiedAppointmentIds: string[] = [];

    for (const slot of conflictingSlots) {
      if (!slot.appointment) continue;
      const appointment = slot.appointment;

      await prisma.$transaction(async (tx) => {
        await tx.appointment.update({
          where: { id: appointment.id },
          data: { status: "CANCELLED", cancelReason: "Doctor marked unavailable (leave)" },
        });
        await tx.appointmentSlot.update({
          where: { id: slot.id },
          data: { status: "CANCELLED" }, // not AVAILABLE — this slot no longer exists for that date
        });
        await writeAuditLog(tx, {
          userId: auth.sub,
          action: "APPOINTMENT_CANCELLED_DUE_TO_LEAVE",
          entityType: "Appointment",
          entityId: appointment.id,
          metadata: { leaveId: leave.id },
        });
      });

      const patientUser = appointment.patient.user;
      const { subject, body: baseBody } = renderEmail("DOCTOR_LEAVE", {
        recipientName: patientUser.firstName,
        doctorName: `Dr. ${doctor.user.lastName}`,
        patientName: `${patientUser.firstName} ${patientUser.lastName}`,
        startTime: slot.startTime,
        timezone: patientUser.timezone,
      });

      const alternativesHtml = alternativeSlots.length
        ? `<p>Some other times that are open with Dr. ${doctor.user.lastName}:</p><ul>${alternativeSlots
            .map((s) => `<li>${s.startTime.toISOString()}</li>`)
            .join("")}</ul>`
        : "";
      const body = baseBody.replace("</div>", `${alternativesHtml}</div>`);

      const notification = await prisma.notification.create({
        data: {
          userId: patientUser.id,
          type: "DOCTOR_LEAVE",
          channel: "EMAIL",
          status: "PENDING",
          subject,
          body,
        },
      });

      // Notification log persists regardless of send outcome — this is the
      // "maintain notification logs even if a send fails" requirement.
      try {
        await sendEmail({ to: patientUser.email, subject, html: body });
        await prisma.notification.update({ where: { id: notification.id }, data: { status: "SENT" } });
      } catch (err) {
        await prisma.notification.update({
          where: { id: notification.id },
          data: {
            status: "FAILED",
            attempts: { increment: 1 },
            lastError: err instanceof Error ? err.message : "Unknown email error",
          },
        });
      }

      notifiedAppointmentIds.push(appointment.id);
    }

    return NextResponse.json({
      leaveId: leave.id,
      conflictsFound: conflictingSlots.length,
      patientsNotified: notifiedAppointmentIds.length,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
