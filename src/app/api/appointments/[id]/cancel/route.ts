import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/backend/requireAuth";
import { cancelAppointment } from "@/backend/booking";
import { toErrorResponse, ForbiddenError, NotFoundError } from "@/backend/apiError";
import { prisma } from "@/backend/db";

const bodySchema = z.object({ reason: z.string().max(500).optional() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = requireAuth(req, ["PATIENT", "DOCTOR"]);
    const { reason } = bodySchema.parse(await req.json().catch(() => ({})));

    const appointment = await prisma.appointment.findUnique({
      where: { id: params.id },
      include: { patient: true, doctor: true },
    });
    if (!appointment) throw new NotFoundError("Appointment not found");

    const isOwningPatient = auth.role === "PATIENT" && appointment.patient.userId === auth.sub;
    const isOwningDoctor = auth.role === "DOCTOR" && appointment.doctor.userId === auth.sub;
    if (!isOwningPatient && !isOwningDoctor) {
      throw new ForbiddenError("You are not part of this appointment");
    }

    await cancelAppointment({ appointmentId: params.id, actingUserId: auth.sub, reason });

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
