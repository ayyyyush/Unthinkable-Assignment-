import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/backend/requireAuth";
import { prisma } from "@/backend/db";
import { toErrorResponse } from "@/backend/apiError";

export async function GET(req: NextRequest) {
  try {
    requireAuth(req, ["ADMIN"]);

    const [totalPatients, totalDoctors, statusCounts, upcomingCount] = await Promise.all([
      prisma.patientProfile.count(),
      prisma.doctorProfile.count(),
      prisma.appointment.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.appointment.count({
        where: { status: "CONFIRMED", slot: { startTime: { gte: new Date() } } },
      }),
    ]);

    return NextResponse.json({
      totalPatients,
      totalDoctors,
      upcomingConfirmedAppointments: upcomingCount,
      appointmentsByStatus: Object.fromEntries(
        statusCounts.map((s) => [s.status, s._count._all])
      ),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
