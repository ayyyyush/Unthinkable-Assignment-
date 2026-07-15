import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/backend/db";
import { hashPassword } from "@/backend/auth";
import { toErrorResponse } from "@/backend/apiError";

const bodySchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function POST(req: NextRequest) {
  try {
    const { token, newPassword } = bodySchema.parse(await req.json());

    const user = await prisma.user.findUnique({ where: { resetToken: token } });
    if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < new Date()) {
      return NextResponse.json(
        { error: "INVALID_TOKEN", message: "This reset link is invalid or has expired" },
        { status: 400 }
      );
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetToken: null, resetTokenExpiresAt: null },
    });

    // Every existing refresh token is revoked so a stolen session can't
    // survive a password reset — the whole point of the reset.
    await prisma.refreshToken.updateMany({ where: { userId: user.id }, data: { revoked: true } });

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
