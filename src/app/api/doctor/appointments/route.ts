import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/backend/requireAuth";
import { prisma } from "@/backend/db";
import { toErrorResponse, NotFoundError } from "@/backend/apiError";

export async function GET(req: NextRequest) {
  try {
    const auth = requireAuth(req, ["DOCTOR"]);
    const doctor = await prisma.doctorProfile.findUnique({ where: { userId: auth.sub } });
    if (!doctor) throw new NotFoundError("Doctor profile not found");

    const appointments = await prisma.appointment.findMany({
      where: { doctorId: doctor.id, status: { in: ["CONFIRMED", "COMPLETED"] } },
      include: {
        patient: { include: { user: { select: { firstName: true, lastName: true } } } },
        slot: true,
        symptom: { include: { aiSummary: true } },
        clinicalNote: { include: { patientSummary: true, prescription: true } },
      },
      orderBy: { slot: { startTime: "asc" } },
      take: 100,
    });

    return NextResponse.json({
      data: appointments.map((a) => ({
        id: a.id,
        status: a.status,
        startTime: a.slot.startTime,
        endTime: a.slot.endTime,
        patientName: `${a.patient.user.firstName} ${a.patient.user.lastName}`,
        symptomText: a.symptom?.rawText ?? null,
        aiSummary: a.symptom?.aiSummary ?? null,
        hasNotes: Boolean(a.clinicalNote),
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
