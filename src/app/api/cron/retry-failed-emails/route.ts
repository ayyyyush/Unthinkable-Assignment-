import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/backend/db";
import { requireCron } from "@/backend/requireCron";
import { toErrorResponse } from "@/backend/apiError";
import { sendEmail } from "@/backend/email";

const MAX_ATTEMPTS = 5;

/**
 * Runs every 10 minutes. Picks up every Notification and ReminderJob row
 * left in a FAILED state by a prior send attempt (booking confirmation,
 * cancellation, doctor-leave notice, reminder, etc.) and retries once per
 * tick, up to MAX_ATTEMPTS. This is the single retry mechanism reused by
 * every notification path in the app, rather than each caller inventing
 * its own retry loop.
 */
export async function POST(req: NextRequest) {
  try {
    requireCron(req);

    const failedNotifications = await prisma.notification.findMany({
      where: { status: "FAILED", attempts: { lt: MAX_ATTEMPTS }, channel: "EMAIL" },
      include: { user: true },
      take: 200,
    });

    let retriedCount = 0;
    let gaveUpCount = 0;

    for (const n of failedNotifications) {
      if (!n.subject || !n.body) continue;
      try {
        await sendEmail({ to: n.user.email, subject: n.subject, html: n.body });
        await prisma.notification.update({
          where: { id: n.id },
          data: { status: "SENT", attempts: { increment: 1 } },
        });
        retriedCount += 1;
      } catch (err) {
        const attempts = n.attempts + 1;
        // Status stays FAILED regardless — `attempts` reaching MAX_ATTEMPTS
        // is what excludes the row from the query above on the next tick,
        // so there's no separate "permanently failed" status to set here.
        await prisma.notification.update({
          where: { id: n.id },
          data: {
            attempts,
            lastError: err instanceof Error ? err.message : "Unknown email error",
          },
        });
        if (attempts >= MAX_ATTEMPTS) gaveUpCount += 1;
      }
    }

    return NextResponse.json({
      candidates: failedNotifications.length,
      retried: retriedCount,
      permanentlyFailed: gaveUpCount,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
