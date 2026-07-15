import { google } from "googleapis";
import { prisma } from "./db";
import { env, integrations } from "./env";

export function getOAuthClient() {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI
  );
}

export const GOOGLE_CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

export function getGoogleAuthUrl(state: string): string {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline", // required to receive a refresh_token
    prompt: "consent",
    scope: GOOGLE_CALENDAR_SCOPES,
    state,
  });
}

export async function exchangeCodeForTokens(code: string) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

async function getAuthedClientForUser(userId: string) {
  const auth = await prisma.googleCalendarAuth.findUnique({ where: { userId } });
  if (!auth) return null;

  const client = getOAuthClient();
  client.setCredentials({
    access_token: auth.accessToken,
    refresh_token: auth.refreshToken,
    expiry_date: auth.expiresAt.getTime(),
  });

  // Persist rotated access tokens so subsequent calls don't need to
  // re-refresh every time.
  client.on("tokens", async (tokens) => {
    if (tokens.access_token) {
      await prisma.googleCalendarAuth.update({
        where: { userId },
        data: {
          accessToken: tokens.access_token,
          expiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600_000),
        },
      });
    }
  });

  return client;
}

interface SyncParams {
  appointmentId: string;
  kind: "CREATE" | "UPDATE" | "DELETE";
}

/**
 * Best-effort calendar sync for both patient and doctor. Every failure path
 * (no OAuth grant, API down, expired refresh token) is caught and recorded
 * on the CalendarEvent row rather than thrown — a Google outage must never
 * block or roll back a booking action.
 */
export async function syncCalendarEvent({ appointmentId, kind }: SyncParams) {
  if (!integrations.calendarEnabled) return;

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      patient: { include: { user: true } },
      doctor: { include: { user: true } },
      slot: true,
      calendarEvents: true,
    },
  });
  if (!appointment) return;

  for (const user of [appointment.patient.user, appointment.doctor.user]) {
    const existing = appointment.calendarEvents.find((e) => e.userId === user.id);

    try {
      const client = await getAuthedClientForUser(user.id);
      if (!client) continue; // user never connected their calendar — skip silently

      const calendar = google.calendar({ version: "v3", auth: client });

      if (kind === "DELETE") {
        if (existing?.googleEventId) {
          await calendar.events.delete({ calendarId: "primary", eventId: existing.googleEventId });
        }
        continue;
      }

      const eventBody = {
        summary:
          user.id === appointment.patient.user.id
            ? `Appointment with Dr. ${appointment.doctor.user.lastName}`
            : `Appointment with ${appointment.patient.user.firstName} ${appointment.patient.user.lastName}`,
        start: { dateTime: appointment.slot.startTime.toISOString() },
        end: { dateTime: appointment.slot.endTime.toISOString() },
      };

      if (kind === "CREATE" || !existing?.googleEventId) {
        const created = await calendar.events.insert({ calendarId: "primary", requestBody: eventBody });
        await prisma.calendarEvent.upsert({
          where: { id: existing?.id ?? "__none__" },
          create: {
            appointmentId,
            userId: user.id,
            googleEventId: created.data.id ?? undefined,
            status: "SENT",
          },
          update: { googleEventId: created.data.id ?? undefined, status: "SENT", attempts: { increment: 1 } },
        });
      } else {
        await calendar.events.update({
          calendarId: "primary",
          eventId: existing.googleEventId,
          requestBody: eventBody,
        });
        await prisma.calendarEvent.update({
          where: { id: existing.id },
          data: { status: "SENT", attempts: { increment: 1 } },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown calendar error";
      if (existing) {
        await prisma.calendarEvent.update({
          where: { id: existing.id },
          data: { status: "FAILED", lastError: message, attempts: { increment: 1 } },
        });
      } else {
        await prisma.calendarEvent.create({
          data: { appointmentId, userId: user.id, status: "FAILED", lastError: message, attempts: 1 },
        });
      }
    }
  }
}
