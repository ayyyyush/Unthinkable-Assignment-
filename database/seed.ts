import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const SLOT_DURATION_MIN = 30;
const ROLLING_WINDOW_DAYS = 60;

/**
 * Materializes AppointmentSlot rows from a doctor's WorkingHour rows over a
 * rolling window. This mirrors exactly what a production "regenerate slots"
 * job would do — the seed script isn't a shortcut, it's the same generator
 * a real cron would call to extend the window forward each night.
 */
async function generateSlotsForDoctor(doctorProfileId: string) {
  const workingHours = await prisma.workingHour.findMany({ where: { doctorId: doctorProfileId } });
  const now = new Date();

  const slotsToCreate: { doctorId: string; startTime: Date; endTime: Date }[] = [];

  for (let dayOffset = 1; dayOffset <= ROLLING_WINDOW_DAYS; dayOffset++) {
    const day = new Date(now);
    day.setUTCDate(day.getUTCDate() + dayOffset);
    const dayOfWeek = day.getUTCDay();

    const hoursForDay = workingHours.filter((wh) => wh.dayOfWeek === dayOfWeek);
    for (const wh of hoursForDay) {
      for (let minute = wh.startMinute; minute + SLOT_DURATION_MIN <= wh.endMinute; minute += SLOT_DURATION_MIN) {
        const startTime = new Date(day);
        startTime.setUTCHours(0, minute, 0, 0);
        const endTime = new Date(startTime.getTime() + SLOT_DURATION_MIN * 60 * 1000);
        slotsToCreate.push({ doctorId: doctorProfileId, startTime, endTime });
      }
    }
  }

  // skipDuplicates relies on the same (doctorId, startTime) unique
  // constraint that protects the booking engine — re-running the seed is
  // always safe.
  await prisma.appointmentSlot.createMany({ data: slotsToCreate, skipDuplicates: true });
  return slotsToCreate.length;
}

async function main() {
  const passwordHash = await bcrypt.hash("Password123!", 12);

  await prisma.user.upsert({
    where: { email: "admin@clinic.example" },
    update: {},
    create: {
      email: "admin@clinic.example",
      passwordHash,
      role: "ADMIN",
      firstName: "Alex",
      lastName: "Admin",
      emailVerified: true,
    },
  });

  const doctorSeeds = [
    { email: "dr.patel@clinic.example", firstName: "Anika", lastName: "Patel", specialization: "Cardiology" },
    { email: "dr.chen@clinic.example", firstName: "Wei", lastName: "Chen", specialization: "Dermatology" },
    { email: "dr.osei@clinic.example", firstName: "Kwame", lastName: "Osei", specialization: "General Medicine" },
  ];

  for (const d of doctorSeeds) {
    const doctorUser = await prisma.user.upsert({
      where: { email: d.email },
      update: {},
      create: {
        email: d.email,
        passwordHash,
        role: "DOCTOR",
        firstName: d.firstName,
        lastName: d.lastName,
        emailVerified: true,
        doctorProfile: {
          create: {
            specialization: d.specialization,
            slotDurationMinutes: SLOT_DURATION_MIN,
            workingHours: {
              // Mon-Fri, 09:00-17:00 UTC
              create: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
                dayOfWeek,
                startMinute: 9 * 60,
                endMinute: 17 * 60,
              })),
            },
          },
        },
      },
      include: { doctorProfile: true },
    });

    const created = await generateSlotsForDoctor(doctorUser.doctorProfile!.id);
    console.log(`Seeded ${created} slots for Dr. ${d.lastName}`);
  }

  await prisma.user.upsert({
    where: { email: "patient@clinic.example" },
    update: {},
    create: {
      email: "patient@clinic.example",
      passwordHash,
      role: "PATIENT",
      firstName: "Jordan",
      lastName: "Rivera",
      emailVerified: true,
      patientProfile: { create: { medicalHistory: "No known allergies." } },
    },
  });

  console.log("Seed complete. All seeded users share password: Password123!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
