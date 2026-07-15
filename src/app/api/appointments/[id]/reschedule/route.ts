import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/backend/requireAuth";
import { rescheduleAppointment } from "@/backend/booking";
import { prisma } from "@/backend/db";
import { toErrorResponse, NotFoundError } from "@/backend/apiError";
import { rateLimitBooking } from "@/backend/rateLimit";

const bodySchema = z.object({ newSlotId: z.string().min(1) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = requireAuth(req, ["PATIENT"]);
    rateLimitBooking(auth.sub);

    const { newSlotId } = bodySchema.parse(await req.json());

    const patient = await prisma.patientProfile.findUnique({ where: { userId: auth.sub } });
    if (!patient) throw new NotFoundError("Patient profile not found");

    const newAppointment = await rescheduleAppointment({
      appointmentId: params.id,
      newSlotId,
      patientId: patient.id,
    });

    return NextResponse.json({ appointmentId: newAppointment.id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
