import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { requireAuth } from "@/backend/requireAuth";
import { prisma } from "@/backend/db";
import { hashPassword } from "@/backend/auth";
import { toErrorResponse, ConflictError } from "@/backend/apiError";
import { queueVerificationEmail } from "@/backend/verification";

export async function GET(req: NextRequest) {
  try {
    requireAuth(req, ["ADMIN"]);

    const doctors = await prisma.doctorProfile.findMany({
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        workingHours: true,
        _count: { select: { appointments: true, leaves: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      data: doctors.map((d) => ({
        id: d.id,
        firstName: d.user.firstName,
        lastName: d.user.lastName,
        email: d.user.email,
        specialization: d.specialization,
        slotDurationMinutes: d.slotDurationMinutes,
        workingHours: d.workingHours,
        appointmentCount: d._count.appointments,
        leaveCount: d._count.leaves,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const workingHourSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
});

const bodySchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  specialization: z.string().min(1),
  slotDurationMinutes: z.number().int().min(10).max(120).default(30),
  workingHours: z.array(workingHourSchema).min(1),
});

export async function POST(req: NextRequest) {
  try {
    requireAuth(req, ["ADMIN"]);
    const body = bodySchema.parse(await req.json());

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw new ConflictError("An account with this email already exists");

    // Admin-created doctor accounts get a random temp password + a
    // verification/activation email, rather than the admin choosing (and
    // therefore knowing) the doctor's password.
    const tempPassword = crypto.randomBytes(16).toString("hex");
    const passwordHash = await hashPassword(tempPassword);
    const emailVerifyToken = crypto.randomBytes(32).toString("hex");

    const doctorUser = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        firstName: body.firstName,
        lastName: body.lastName,
        role: "DOCTOR",
        emailVerifyToken,
        emailVerifyExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        doctorProfile: {
          create: {
            specialization: body.specialization,
            slotDurationMinutes: body.slotDurationMinutes,
            workingHours: { create: body.workingHours },
          },
        },
      },
      include: { doctorProfile: true },
    });

    await queueVerificationEmail(doctorUser.id, emailVerifyToken);

    return NextResponse.json(
      { id: doctorUser.doctorProfile!.id, email: doctorUser.email },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
