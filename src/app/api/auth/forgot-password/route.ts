import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "@/backend/db";
import { toErrorResponse } from "@/backend/apiError";
import { rateLimitAuth } from "@/backend/rateLimit";
import { queuePasswordResetEmail } from "@/backend/verification";

const bodySchema = z.object({ email: z.string().email() });

export async function POST(req: NextRequest) {
  try {
    rateLimitAuth(req.headers.get("x-forwarded-for") ?? "unknown");
    const { email } = bodySchema.parse(await req.json());

    const user = await prisma.user.findUnique({ where: { email } });

    // Always return the same response whether or not the account exists —
    // otherwise this endpoint becomes an email-enumeration oracle.
    if (user) {
      const resetToken = crypto.randomBytes(32).toString("hex");
      await prisma.user.update({
        where: { id: user.id },
        data: { resetToken, resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      });
      await queuePasswordResetEmail(user.id, resetToken);
    }

    return NextResponse.json({
      message: "If an account exists for this email, a reset link has been sent.",
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
