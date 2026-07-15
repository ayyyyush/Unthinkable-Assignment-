import { prisma } from "./db";
import { sendEmail, renderEmail } from "./email";
import { syncCalendarEvent } from "./calendar";
import type { NotificationType } from "@prisma/client";

interface QueueNotificationParams {
  type: NotificationType;
  appointmentId: string;
}

/**
 * Called after a booking-engine transaction commits. This function must
 * NEVER throw — a down email provider or Google API must never surface as
 * a failure of the booking/cancel/reschedule action that triggered it. Every
 * external call is wrapped; failures are persisted as FAILED rows for the
 * retry-failed-emails cron to pick up later.
 */
export async function queueNotification({ type, appointmentId }: QueueNotificationParams) {
  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: { include: { user: true } },
        doctor: { include: { user: true } },
        slot: true,
      },
    });
    if (!appointment) return;

    const recipients = [appointment.patient.user, appointment.doctor.user];

    for (const user of recipients) {
      const { subject, body } = renderEmail(type, {
        recipientName: user.firstName,
        doctorName: `Dr. ${appointment.doctor.user.lastName}`,
        patientName: `${appointment.patient.user.firstName} ${appointment.patient.user.lastName}`,
        startTime: appointment.slot.startTime,
        timezone: user.timezone,
      });

      const notification = await prisma.notification.create({
        data: {
          userId: user.id,
          type,
          channel: "EMAIL",
          status: "PENDING",
          subject,
          body,
        },
      });

      try {
        await sendEmail({ to: user.email, subject, html: body });
        await prisma.notification.update({
          where: { id: notification.id },
          data: { status: "SENT" },
        });
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
    }

    // Calendar sync is similarly best-effort and never blocks/throws.
    await syncCalendarEvent({ appointmentId, kind: mapTypeToCalendarKind(type) });
  } catch (err) {
    // Absolute last resort — a bug in this function itself must still not
    // propagate to the caller (the booking engine).
    console.error("[queueNotification] unexpected failure", err);
  }
}

function mapTypeToCalendarKind(type: NotificationType): "CREATE" | "UPDATE" | "DELETE" {
  if (type === "CANCELLATION") return "DELETE";
  if (type === "RESCHEDULE") return "UPDATE";
  return "CREATE";
}
