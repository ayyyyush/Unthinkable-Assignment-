import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/backend/requireAuth";
import { prisma } from "@/backend/db";
import { holdSlot } from "@/backend/booking";
import { toErrorResponse, NotFoundError } from "@/backend/apiError";
import { rateLimitBooking } from "@/backend/rateLimit";

const bodySchema = z.object({
  doctorId: z.string().min(1),
  slotId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const auth = requireAuth(req, ["PATIENT"]);
    rateLimitBooking(auth.sub);

    const { doctorId, slotId } = bodySchema.parse(await req.json());

    const patient = await prisma.patientProfile.findUnique({ where: { userId: auth.sub } });
    if (!patient) throw new NotFoundError("Patient profile not found");

    const { appointment, holdExpiresAt } = await holdSlot({
      doctorId,
      slotId,
      patientId: patient.id,
    });

    return NextResponse.json(
      { appointmentId: appointment.id, holdExpiresAt },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
