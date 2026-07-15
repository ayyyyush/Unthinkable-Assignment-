import { NextRequest, NextResponse } from "next/server";
import { rotateRefreshToken, refreshCookieOptions, REFRESH_COOKIE_NAME } from "@/backend/auth";
import { toErrorResponse, UnauthorizedError } from "@/backend/apiError";

export async function POST(req: NextRequest) {
  try {
    const presented = req.cookies.get(REFRESH_COOKIE_NAME)?.value;
    if (!presented) throw new UnauthorizedError("No refresh token presented");

    const { accessToken, refreshToken, refreshExpiresAt, user } = await rotateRefreshToken(presented);

    const res = NextResponse.json({
      accessToken,
      user: { id: user.id, email: user.email, role: user.role, firstName: user.firstName },
    });

    res.cookies.set(REFRESH_COOKIE_NAME, refreshToken, {
      ...refreshCookieOptions,
      expires: refreshExpiresAt,
    });

    return res;
  } catch (err) {
    // On any failure (invalid, expired, or reuse-detected), clear the
    // cookie so the client falls back to a fresh login rather than
    // retrying with a token we've already rejected.
    const res = toErrorResponse(err);
    res.cookies.delete(REFRESH_COOKIE_NAME);
    return res;
  }
}
