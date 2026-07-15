import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/backend/requireAuth";
import { prisma } from "@/backend/db";
import { toErrorResponse, NotFoundError } from "@/backend/apiError";

export async function GET(req: NextRequest) {
  try {
    const auth = requireAuth(req, ["PATIENT"]);
    const patient = await prisma.patientProfile.findUnique({ where: { userId: auth.sub } });
    if (!patient) throw new NotFoundError("Patient profile not found");

    const appointments = await prisma.appointment.findMany({
      where: { patientId: patient.id, status: { not: "RESCHEDULED" } },
      include: {
        doctor: { include: { user: { select: { firstName: true, lastName: true } } } },
        slot: true,
        clinicalNote: { include: { patientSummary: true, prescription: true } },
      },
      orderBy: { slot: { startTime: "desc" } },
      take: 100,
    });

    return NextResponse.json({
      data: appointments.map((a) => ({
        id: a.id,
        status: a.status,
        startTime: a.slot.startTime,
        doctorName: `Dr. ${a.doctor.user.lastName}`,
        patientSummary: a.clinicalNote?.patientSummary ?? null,
        prescription: a.clinicalNote?.prescription ?? null,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
