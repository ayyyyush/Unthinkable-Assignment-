import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/backend/requireAuth";
import { prisma } from "@/backend/db";
import { generatePostVisitSummary } from "@/backend/ai";
import { toErrorResponse, ForbiddenError, NotFoundError, ConflictError } from "@/backend/apiError";
import { writeAuditLog } from "@/backend/audit";
import { queueNotification } from "@/backend/notify";

const medicationSchema = z.object({
  name: z.string().min(1),
  dosage: z.string().min(1),
  frequencyPerDay: z.number().int().min(1).max(12),
  durationDays: z.number().int().min(1).max(365),
});

const bodySchema = z.object({
  notes: z.string().min(10, "Please add clinical notes before submitting"),
  medications: z.array(medicationSchema).default([]),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = requireAuth(req, ["DOCTOR"]);
    const { notes, medications } = bodySchema.parse(await req.json());

    const doctor = await prisma.doctorProfile.findUnique({ where: { userId: auth.sub } });
    if (!doctor) throw new NotFoundError("Doctor profile not found");

    const appointment = await prisma.appointment.findUnique({ where: { id: params.id } });
    if (!appointment) throw new NotFoundError("Appointment not found");
    if (appointment.doctorId !== doctor.id) {
      throw new ForbiddenError("This appointment does not belong to you");
    }
    if (appointment.status !== "CONFIRMED") {
      throw new ConflictError("Notes can only be added to a confirmed appointment");
    }

    const { clinicalNote, prescription } = await prisma.$transaction(async (tx) => {
      const clinicalNote = await tx.clinicalNote.create({
        data: { appointmentId: appointment.id, notes },
      });

      const prescription =
        medications.length > 0
          ? await tx.prescription.create({
              data: {
                clinicalNoteId: clinicalNote.id,
                patientId: appointment.patientId,
                medications,
              },
            })
          : null;

      await tx.appointment.update({ where: { id: appointment.id }, data: { status: "COMPLETED" } });

      await writeAuditLog(tx, {
        userId: auth.sub,
        action: "CLINICAL_NOTES_SUBMITTED",
        entityType: "Appointment",
        entityId: appointment.id,
      });

      return { clinicalNote, prescription };
    });

    // Post-visit AI summary, generated after commit — same reasoning as
    // the pre-visit summary: never let an OpenAI call hold a transaction
    // open, and never let its failure undo the doctor's already-saved notes.
    await generatePostVisitSummary(clinicalNote.id, notes).catch((err) => {
      console.error("[notes] post-visit summary generation failed unexpectedly", err);
    });

    // Schedule medication reminder jobs, one per dose per day of the course.
    if (prescription) {
      const meds = medications;
      const now = new Date();
      const reminderRows = meds.flatMap((med) =>
        Array.from({ length: med.durationDays }, (_, dayIndex) =>
          Array.from({ length: med.frequencyPerDay }, (_, doseIndex) => {
            const hourOffset = Math.floor((24 / med.frequencyPerDay) * doseIndex);
            const runAt = new Date(now);
            runAt.setDate(runAt.getDate() + dayIndex);
            runAt.setHours(9 + hourOffset, 0, 0, 0); // first dose at 9am local-server-time baseline
            return {
              patientId: appointment.patientId,
              appointmentId: appointment.id,
              kind: "MEDICATION_REMINDER",
              runAt,
              payload: { medicationName: med.name, dosage: med.dosage },
            };
          })
        ).flat()
      );
      if (reminderRows.length > 0) {
        await prisma.reminderJob.createMany({ data: reminderRows });
      }
    }

    // A single follow-up reminder, one week out.
    await prisma.reminderJob.create({
      data: {
        patientId: appointment.patientId,
        appointmentId: appointment.id,
        kind: "FOLLOW_UP",
        runAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return NextResponse.json({ success: true, clinicalNoteId: clinicalNote.id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
