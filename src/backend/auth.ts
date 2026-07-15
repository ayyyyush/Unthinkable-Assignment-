import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { prisma } from "./db";
import { env } from "./env";
import type { Role } from "@prisma/client";

const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface AccessTokenPayload {
  sub: string; // userId
  role: Role;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: `${env.ACCESS_TOKEN_TTL_MIN}m`,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

// ── Refresh tokens ───────────────────────────────────────────────────────
//
// Refresh tokens are opaque random strings, never JWTs — the DB is the
// source of truth for revocation, which a stateless JWT can't give us.
// Only a SHA-256 hash is persisted, so a DB read never discloses a usable
// token (mirrors how passwords are stored, for the same reason).
//
// Rotation + reuse detection: every refresh call issues a brand new token
// and immediately revokes the one that was just used. If a *revoked* token
// is presented again, that's a signal someone is replaying a stolen token —
// so we revoke the entire family (every token descended from that login),
// forcing a fresh login everywhere.

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateOpaqueToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

export async function issueRefreshToken(userId: string, familyId?: string) {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      familyId: familyId ?? crypto.randomUUID(),
      expiresAt,
    },
  });

  return { token, expiresAt };
}

export class RefreshTokenReuseError extends Error {
  constructor() {
    super("Refresh token reuse detected; session family revoked");
    this.name = "RefreshTokenReuseError";
  }
}

export class RefreshTokenInvalidError extends Error {
  constructor() {
    super("Refresh token is invalid or expired");
    this.name = "RefreshTokenInvalidError";
  }
}

/**
 * Validates a presented refresh token, rotates it, and returns a new
 * access + refresh token pair. Throws RefreshTokenReuseError if the token
 * had already been rotated away (theft signal) or RefreshTokenInvalidError
 * for any other invalid/expired case.
 */
export async function rotateRefreshToken(presentedToken: string) {
  const tokenHash = hashToken(presentedToken);
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!existing) throw new RefreshTokenInvalidError();

  if (existing.revoked) {
    // This exact token was already rotated away once before. Someone is
    // presenting an old, superseded token — revoke every token in the
    // family so a stolen token can't be used again even via a different
    // path, and force the legitimate user to log in again.
    await prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId },
      data: { revoked: true },
    });
    throw new RefreshTokenReuseError();
  }

  if (existing.expiresAt < new Date()) {
    throw new RefreshTokenInvalidError();
  }

  const { token: newToken, expiresAt } = await issueRefreshToken(
    existing.userId,
    existing.familyId
  );
  const newHash = hashToken(newToken);
  const created = await prisma.refreshToken.findUnique({ where: { tokenHash: newHash } });

  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revoked: true, replacedById: created?.id },
  });

  const accessToken = signAccessToken({ sub: existing.userId, role: existing.user.role });

  return { accessToken, refreshToken: newToken, refreshExpiresAt: expiresAt, user: existing.user };
}

export async function revokeRefreshToken(presentedToken: string) {
  const tokenHash = hashToken(presentedToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash },
    data: { revoked: true },
  });
}

// ── Cookie helpers ───────────────────────────────────────────────────────

export const REFRESH_COOKIE_NAME = "refresh_token";

export const refreshCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/api/auth",
};
