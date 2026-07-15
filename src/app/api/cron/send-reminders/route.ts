import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/backend/db";
import { requireCron } from "@/backend/requireCron";
import { toErrorResponse } from "@/backend/apiError";
import { sendEmail, renderEmail } from "@/backend/email";
import type { NotificationType } from "@prisma/client";

const KIND_TO_NOTIFICATION_TYPE: Record<string, NotificationType> = {
  APPOINTMENT_REMINDER: "APPOINTMENT_REMINDER",
  MEDICATION_REMINDER: "MEDICATION_REMINDER",
  FOLLOW_UP: "FOLLOW_UP_REMINDER",
};

/**
 * Runs every 5 minutes. Idempotent and safely re-runnable: each job is
 * claimed via a conditional update (status PENDING -> processing marker
 * via processedAt) before being acted on, so two overlapping cron
 * invocations (e.g. a slow run overlapping the next tick) can't send the
 * same reminder twice.
 */
export async function POST(req: NextRequest) {
  try {
    requireCron(req);
    const now = new Date();

    const dueJobs = await prisma.reminderJob.findMany({
      where: { status: "PENDING", runAt: { lte: now } },
      include: { patient: { include: { user: true } }, appointment: { include: { slot: true } } },
      take: 200, // bounded batch size so one cron tick can't run unbounded work
    });

    let sentCount = 0;

    for (const job of dueJobs) {
      // Claim the job first via a conditional update — if another
      // concurrent invocation already claimed it, count() will be 0 and we
      // skip, rather than sending a duplicate reminder.
      const claim = await prisma.reminderJob.updateMany({
        where: { id: job.id, status: "PENDING" },
        data: { status: "RETRYING", processedAt: now },
      });
      if (claim.count === 0) continue;

      const user = job.patient.user;
      const notificationType = KIND_TO_NOTIFICATION_TYPE[job.kind] ?? "FOLLOW_UP_REMINDER";

      const { subject, body } = renderEmail(notificationType, {
        recipientName: user.firstName,
        doctorName: job.appointment ? "your doctor" : "the clinic",
        patientName: `${user.firstName} ${user.lastName}`,
        startTime: job.appointment?.slot.startTime ?? now,
        timezone: user.timezone,
      });

      try {
        await sendEmail({ to: user.email, subject, html: body });
        await prisma.reminderJob.update({ where: { id: job.id }, data: { status: "SENT" } });
        sentCount += 1;
      } catch (err) {
        await prisma.reminderJob.update({
          where: { id: job.id },
          data: { status: "FAILED" },
        });
        console.error(`[send-reminders] job ${job.id} failed`, err);
      }
    }

    return NextResponse.json({ processed: dueJobs.length, sent: sentCount });
  } catch (err) {
    return toErrorResponse(err);
  }
}
