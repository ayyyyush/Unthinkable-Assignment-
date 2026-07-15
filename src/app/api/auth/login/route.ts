import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/backend/db";
import { verifyPassword, signAccessToken, issueRefreshToken, refreshCookieOptions, REFRESH_COOKIE_NAME } from "@/backend/auth";
import { toErrorResponse, UnauthorizedError } from "@/backend/apiError";
import { rateLimitAuth } from "@/backend/rateLimit";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    rateLimitAuth(req.headers.get("x-forwarded-for") ?? "unknown");

    const { email, password } = bodySchema.parse(await req.json());

    const user = await prisma.user.findUnique({ where: { email } });
    // Deliberately identical error for "no such user" and "wrong password" —
    // distinguishing them lets an attacker enumerate valid emails.
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const accessToken = signAccessToken({ sub: user.id, role: user.role });
    const { token: refreshToken, expiresAt } = await issueRefreshToken(user.id);

    const res = NextResponse.json({
      accessToken,
      user: { id: user.id, email: user.email, role: user.role, firstName: user.firstName },
    });

    res.cookies.set(REFRESH_COOKIE_NAME, refreshToken, {
      ...refreshCookieOptions,
      expires: expiresAt,
    });

    return res;
  } catch (err) {
    return toErrorResponse(err);
  }
}
