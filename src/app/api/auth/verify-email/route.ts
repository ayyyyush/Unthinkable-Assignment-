import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/backend/db";
import { toErrorResponse } from "@/backend/apiError";

const querySchema = z.object({ token: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    const { token } = querySchema.parse(await req.json());

    const user = await prisma.user.findUnique({ where: { emailVerifyToken: token } });
    if (!user || !user.emailVerifyExpiresAt || user.emailVerifyExpiresAt < new Date()) {
      return NextResponse.json(
        { error: "INVALID_TOKEN", message: "This verification link is invalid or has expired" },
        { status: 400 }
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, emailVerifyToken: null, emailVerifyExpiresAt: null },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
