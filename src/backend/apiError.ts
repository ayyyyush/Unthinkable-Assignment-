import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { UnauthorizedError, ForbiddenError } from "./requireAuth";
import { RefreshTokenReuseError, RefreshTokenInvalidError } from "./auth";

export class ConflictError extends Error {}
export class NotFoundError extends Error {}
export class RateLimitError extends Error {}

/**
 * Every API route wraps its handler body in a try/catch that funnels into
 * this function. This guarantees a single consistent error response shape
 * across the whole API surface, rather than each route inventing its own
 * status codes and message format.
 */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", message: "Request validation failed", details: err.flatten() },
      { status: 400 }
    );
  }
  if (err instanceof UnauthorizedError || err instanceof RefreshTokenInvalidError) {
    return NextResponse.json({ error: "UNAUTHORIZED", message: err.message }, { status: 401 });
  }
  if (err instanceof RefreshTokenReuseError) {
    return NextResponse.json(
      { error: "SESSION_REVOKED", message: "Session invalidated; please log in again" },
      { status: 401 }
    );
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: "FORBIDDEN", message: err.message }, { status: 403 });
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: "NOT_FOUND", message: err.message }, { status: 404 });
  }
  if (err instanceof ConflictError) {
    return NextResponse.json({ error: "CONFLICT", message: err.message }, { status: 409 });
  }
  if (err instanceof RateLimitError) {
    return NextResponse.json({ error: "RATE_LIMITED", message: err.message }, { status: 429 });
  }

  // Unknown/unexpected errors: never leak internals (stack traces, SQL, etc.)
  // to the client. Log server-side for diagnosis.
  console.error("[unhandled_api_error]", err);
  return NextResponse.json(
    { error: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
    { status: 500 }
  );
}
