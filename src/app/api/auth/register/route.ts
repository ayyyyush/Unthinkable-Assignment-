import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "@/backend/db";
import { hashPassword } from "@/backend/auth";
import { toErrorResponse, ConflictError } from "@/backend/apiError";
import { rateLimitAuth } from "@/backend/rateLimit";
import { queueVerificationEmail } from "@/backend/verification";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.enum(["PATIENT", "DOCTOR"]), // admins are provisioned directly, never via public signup
  timezone: z.string().default("UTC"),
  specialization: z.string().optional(), // required if role === DOCTOR
});

export async function POST(req: NextRequest) {
  try {
    rateLimitAuth(req.headers.get("x-forwarded-for") ?? "unknown");

    const body = bodySchema.parse(await req.json());

    if (body.role === "DOCTOR" && !body.specialization) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: "specialization is required for doctor accounts" },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      throw new ConflictError("An account with this email already exists");
    }

    const passwordHash = await hashPassword(body.password);
    const emailVerifyToken = crypto.randomBytes(32).toString("hex");

    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        firstName: body.firstName,
        lastName: body.lastName,
        role: body.role,
        timezone: body.timezone,
        emailVerifyToken,
        emailVerifyExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        ...(body.role === "PATIENT" ? { patientProfile: { create: {} } } : {}),
        ...(body.role === "DOCTOR"
          ? { doctorProfile: { create: { specialization: body.specialization! } } }
          : {}),
      },
    });

    await queueVerificationEmail(user.id, emailVerifyToken);

    return NextResponse.json(
      { id: user.id, email: user.email, role: user.role },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
