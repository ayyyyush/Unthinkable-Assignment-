import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/backend/db";
import { toErrorResponse } from "@/backend/apiError";
import { SlotStatus } from "@prisma/client";

const querySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { from, to } = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const now = new Date();
    const rangeStart = from ? new Date(from) : now;
    // Default window matches the rolling 60-day slot generation horizon.
    const rangeEnd = to ? new Date(to) : new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    const slots = await prisma.appointmentSlot.findMany({
      where: {
        doctorId: params.id,
        startTime: { gte: rangeStart, lte: rangeEnd },
        // A slot reads as available if it's genuinely AVAILABLE, or if it's
        // HELD but that hold has already lapsed (lazy expiry — the cleanup
        // cron will eventually flip the row, but callers shouldn't have to
        // wait for a cron tick to see accurate live availability).
        OR: [
          { status: SlotStatus.AVAILABLE },
          { status: SlotStatus.HELD, holdExpiresAt: { lt: now } },
        ],
      },
      orderBy: { startTime: "asc" },
      select: { id: true, startTime: true, endTime: true },
    });

    return NextResponse.json({ data: slots });
  } catch (err) {
    return toErrorResponse(err);
  }
}
