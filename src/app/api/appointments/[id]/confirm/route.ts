import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/backend/requireAuth";
import { prisma } from "@/backend/db";
import { confirmAppointment } from "@/backend/booking";
import { generatePreVisitSummary } from "@/backend/ai";
import { toErrorResponse, NotFoundError } from "@/backend/apiError";

const bodySchema = z.object({
  symptomText: z.string().min(10, "Please describe your symptoms in a bit more detail"),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = requireAuth(req, ["PATIENT"]);
    const { symptomText } = bodySchema.parse(await req.json());

    const patient = await prisma.patientProfile.findUnique({ where: { userId: auth.sub } });
    if (!patient) throw new NotFoundError("Patient profile not found");

    const { symptom } = await confirmAppointment({
      appointmentId: params.id,
      patientId: patient.id,
      symptomText,
    });

    // Runs after the booking transaction has already committed. AI is an
    // enhancement, not a gate: the appointment is confirmed regardless of
    // whether this call succeeds — generatePreVisitSummary never throws
    // (it falls back internally), so it can't undo the confirmation above.
    //
    // NOTE on serverless: we await it here rather than truly firing-and-
    // forgetting, because a serverless function's execution can be frozen
    // the instant the response is sent — an un-awaited promise is not
    // guaranteed to finish. This does add OpenAI's latency to the request,
    // an acceptable trade-off given retries are capped at 3 short attempts.
    // If that latency becomes a problem, move this into `waitUntil()`
    // (Vercel) or a queued job instead — the function itself doesn't change.
    await generatePreVisitSummary(symptom.id, symptomText).catch((err) => {
      console.error("[confirm] pre-visit summary generation failed unexpectedly", err);
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
