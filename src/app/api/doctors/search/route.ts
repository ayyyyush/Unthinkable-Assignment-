import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/backend/db";
import { toErrorResponse } from "@/backend/apiError";

const querySchema = z.object({
  specialization: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export async function GET(req: NextRequest) {
  try {
    const { specialization, page, pageSize } = querySchema.parse(
      Object.fromEntries(req.nextUrl.searchParams)
    );

    const where = specialization
      ? { specialization: { contains: specialization, mode: "insensitive" as const } }
      : {};

    const [doctors, total] = await Promise.all([
      prisma.doctorProfile.findMany({
        where,
        include: { user: { select: { firstName: true, lastName: true, timezone: true } } },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { user: { lastName: "asc" } },
      }),
      prisma.doctorProfile.count({ where }),
    ]);

    return NextResponse.json({
      data: doctors.map((d) => ({
        id: d.id,
        firstName: d.user.firstName,
        lastName: d.user.lastName,
        specialization: d.specialization,
        bio: d.bio,
        slotDurationMinutes: d.slotDurationMinutes,
        timezone: d.user.timezone,
      })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
