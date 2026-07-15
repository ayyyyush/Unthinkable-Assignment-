import { RateLimitError } from "./apiError";

// In-memory fixed-window limiter. This is intentionally simple: it's
// correct for a single Node process (e.g. one Vercel/Railway instance),
// which matches the "Option A — lean" deployment target. It is NOT correct
// across multiple horizontally-scaled instances, since each process has its
// own counters. If this app is ever scaled to multiple instances, swap the
// Map below for Upstash Redis (INCR + EXPIRE) behind the same
// `checkRateLimit` signature — no caller changes needed.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (bucket.count >= limit) {
    throw new RateLimitError("Too many requests. Please try again shortly.");
  }

  bucket.count += 1;
}

// Named limiters for the two endpoint classes explicitly called out as
// abuse-sensitive: auth (credential stuffing / brute force) and booking
// (slot-hold spam that would otherwise let one client lock out every slot).
export function rateLimitAuth(ip: string) {
  checkRateLimit(`auth:${ip}`, 10, 60_000); // 10 req/min per IP
}

export function rateLimitBooking(userId: string) {
  checkRateLimit(`booking:${userId}`, 20, 60_000); // 20 req/min per user
}
