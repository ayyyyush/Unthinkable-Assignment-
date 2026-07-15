import { NextRequest } from "next/server";
import { verifyAccessToken, AccessTokenPayload } from "./auth";
import type { Role } from "@prisma/client";

export class UnauthorizedError extends Error {}
export class ForbiddenError extends Error {}

/**
 * Extracts and verifies the bearer access token, optionally enforcing role
 * membership. This is called explicitly at the top of every protected route
 * handler rather than relying solely on UI-level hiding — RBAC that only
 * exists in the frontend is not RBAC.
 */
export function requireAuth(req: NextRequest, allowedRoles?: Role[]): AccessTokenPayload {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing bearer token");
  }

  const token = header.slice("Bearer ".length);
  let payload: AccessTokenPayload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new UnauthorizedError("Invalid or expired access token");
  }

  if (allowedRoles && !allowedRoles.includes(payload.role)) {
    throw new ForbiddenError(`Role ${payload.role} is not permitted to access this resource`);
  }

  return payload;
}
