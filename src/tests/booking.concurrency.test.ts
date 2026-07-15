import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { holdSlot, confirmAppointment } from "@/backend/booking";

/**
 * ── What this test actually proves ────────────────────────────────────
 *
 * The claim under test isn't "the booking engine seems to work" — it's the
 * specific, falsifiable claim: given N truly concurrent requests for the
 * *same* slot, exactly one succeeds and the rest fail cleanly with a
 * ConflictError, with zero duplicate Appointment rows in the database
 * afterward, no matter how the requests interleave.
 *
 * `Promise.all` alone does not guarantee interleaving in Node (it's still
 * single-threaded JS), so the meaningful test is against the *database*:
 * we fire N real overlapping transactions against real Postgres and let
 * Postgres's row-level locking be the thing that's actually tested, not
 * our application code's assumptions about timing. This requires a real
 * Postgres instance (set TEST_DATABASE_URL) — it is intentionally not
 * mocked, since mocking Prisma here would only prove the mock behaves
 * correctly, not the database.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

describeIfDb("booking engine concurrency", () => {
  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  let doctorProfileId: string;
  let patientIds: string[] = [];
  let slotId: string;

  beforeAll(async () => {
    const doctorUser = await prisma.user.create({
      data: {
        email: `doctor-${Date.now()}@test.local`,
        passwordHash: "test",
        role: "DOCTOR",
        firstName: "Test",
        lastName: "Doctor",
        doctorProfile: { create: { specialization: "General Medicine" } },
      },
      include: { doctorProfile: true },
    });
    doctorProfileId = doctorUser.doctorProfile!.id;

    const patientUsers = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        prisma.user.create({
          data: {
            email: `patient-${Date.now()}-${i}@test.local`,
            passwordHash: "test",
            role: "PATIENT",
            firstName: "Test",
            lastName: `Patient${i}`,
            patientProfile: { create: {} },
          },
          include: { patientProfile: true },
        })
      )
    );
    patientIds = patientUsers.map((u) => u.patientProfile!.id);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const slot = await prisma.appointmentSlot.create({
      data: {
        doctorId: doctorProfileId,
        startTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
        status: "AVAILABLE",
      },
    });
    slotId = slot.id;
  });

  it("allows exactly one winner when 10 patients hold the same slot simultaneously", async () => {
    const attempts = await Promise.allSettled(
      patientIds.map((patientId) => holdSlot({ doctorId: doctorProfileId, slotId, patientId }))
    );

    const successes = attempts.filter((a) => a.status === "fulfilled");
    const failures = attempts.filter((a) => a.status === "rejected");

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(9);

    // Every failure must be the clean "already taken" error, not a 500 or
    // a Prisma unique-constraint exception leaking past the booking engine.
    for (const failure of failures as PromiseRejectedResult[]) {
      expect(failure.reason.name).toBe("ConflictError");
    }

    const slotRow = await prisma.appointmentSlot.findUniqueOrThrow({ where: { id: slotId } });
    expect(slotRow.status).toBe("HELD");

    const appointmentCount = await prisma.appointment.count({ where: { slotId } });
    expect(appointmentCount).toBe(1); // no duplicate Appointment rows
  });

  it("prevents a second confirm from double-booking after the first already confirmed", async () => {
    const first = await holdSlot({ doctorId: doctorProfileId, slotId, patientId: patientIds[0] });

    const confirmAttempts = await Promise.allSettled([
      confirmAppointment({
        appointmentId: first.appointment.id,
        patientId: patientIds[0],
        symptomText: "Persistent headache for three days.",
      }),
      confirmAppointment({
        appointmentId: first.appointment.id,
        patientId: patientIds[0],
        symptomText: "Persistent headache for three days.",
      }),
    ]);

    const successes = confirmAttempts.filter((a) => a.status === "fulfilled");
    expect(successes).toHaveLength(1);

    const slotRow = await prisma.appointmentSlot.findUniqueOrThrow({ where: { id: slotId } });
    expect(slotRow.status).toBe("BOOKED");
  });

  it("lets a new patient claim a slot after the original hold expires", async () => {
    // Simulate an expired hold directly rather than waiting 5 real minutes.
    await holdSlot({ doctorId: doctorProfileId, slotId, patientId: patientIds[0] });
    await prisma.appointmentSlot.update({
      where: { id: slotId },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });

    const second = await holdSlot({ doctorId: doctorProfileId, slotId, patientId: patientIds[1] });
    expect(second.slot.heldByPatientId).toBe(patientIds[1]);
  });
});
