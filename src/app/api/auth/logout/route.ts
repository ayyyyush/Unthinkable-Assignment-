import { NextRequest, NextResponse } from "next/server";
import { revokeRefreshToken, REFRESH_COOKIE_NAME } from "@/backend/auth";
import { toErrorResponse } from "@/backend/apiError";

export async function POST(req: NextRequest) {
  try {
    const presented = req.cookies.get(REFRESH_COOKIE_NAME)?.value;
    if (presented) {
      await revokeRefreshToken(presented);
    }
    const res = NextResponse.json({ success: true });
    res.cookies.delete(REFRESH_COOKIE_NAME);
    return res;
  } catch (err) {
    return toErrorResponse(err);
  }
}
