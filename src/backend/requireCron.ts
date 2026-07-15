import { NextRequest } from "next/server";
import { env } from "./env";
import { UnauthorizedError } from "./requireAuth";

/**
 * Cron routes are hit by the scheduler (Vercel Cron / GitHub Actions /
 * cron-job.org), not by a logged-in user, so they can't use requireAuth.
 * Instead they require a shared secret passed as a bearer token, configured
 * as the trigger's own auth header — this stops the cleanup/reminder/retry
 * endpoints from being callable by anyone who finds the URL.
 */
export function requireCron(req: NextRequest): void {
  const header = req.headers.get("authorization");
  if (header !== `Bearer ${env.CRON_SECRET}`) {
    throw new UnauthorizedError("Invalid cron secret");
  }
}
