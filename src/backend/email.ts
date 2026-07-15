import nodemailer from "nodemailer";
import { env, integrations } from "./env";
import type { NotificationType } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transporter;
}

export async function sendEmail(params: { to: string; subject: string; html: string }) {
  if (!integrations.emailEnabled) {
    // No SMTP configured (e.g. local dev without credentials). Log instead
    // of throwing so the rest of the flow (booking, tests) isn't blocked
    // on an integration that was never wired up in this environment.
    console.info(`[email:disabled] would send "${params.subject}" to ${params.to}`);
    return;
  }

  await getTransporter().sendMail({
    from: env.EMAIL_FROM,
    to: params.to,
    subject: params.subject,
    html: params.html,
  });
}

interface RenderContext {
  recipientName: string;
  doctorName: string;
  patientName: string;
  startTime: Date;
  timezone: string;
}

const SUBJECTS: Record<NotificationType, string> = {
  BOOKING_CONFIRMATION: "Your appointment is confirmed",
  APPOINTMENT_REMINDER: "Reminder: your upcoming appointment",
  CANCELLATION: "Your appointment has been cancelled",
  RESCHEDULE: "Your appointment has been rescheduled",
  MEDICATION_REMINDER: "Time to take your medication",
  DOCTOR_LEAVE: "Your appointment needs to be rebooked",
  FOLLOW_UP_REMINDER: "Follow-up reminder from your doctor",
};

function shell(title: string, bodyHtml: string): string {
  // A single, deliberately simple HTML shell shared by every template —
  // consistent branding without a heavyweight template engine dependency.
  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, Arial, sans-serif; background:#f4f4f5; padding:24px;">
    <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;">
      <h2 style="margin-top:0;color:#111827;">${title}</h2>
      ${bodyHtml}
      <p style="color:#9ca3af;font-size:12px;margin-top:32px;">This is an automated message from your clinic's appointment system.</p>
    </div>
  </body>
</html>`;
}

export function renderEmail(
  type: NotificationType,
  ctx: RenderContext
): { subject: string; body: string } {
  const subject = SUBJECTS[type];
  const when = formatInTimeZone(ctx.startTime, ctx.timezone, "EEEE, MMMM d 'at' h:mm a zzz");

  const messages: Record<NotificationType, string> = {
    BOOKING_CONFIRMATION: `<p>Hi ${ctx.recipientName},</p><p>Your appointment with ${ctx.doctorName} is confirmed for <strong>${when}</strong>.</p>`,
    APPOINTMENT_REMINDER: `<p>Hi ${ctx.recipientName},</p><p>This is a reminder of your appointment with ${ctx.doctorName} on <strong>${when}</strong>.</p>`,
    CANCELLATION: `<p>Hi ${ctx.recipientName},</p><p>Your appointment with ${ctx.doctorName} scheduled for ${when} has been cancelled.</p>`,
    RESCHEDULE: `<p>Hi ${ctx.recipientName},</p><p>Your appointment with ${ctx.doctorName} has been moved to <strong>${when}</strong>.</p>`,
    MEDICATION_REMINDER: `<p>Hi ${ctx.recipientName},</p><p>It's time to take your prescribed medication.</p>`,
    DOCTOR_LEAVE: `<p>Hi ${ctx.recipientName},</p><p>${ctx.doctorName} is unavailable on the date of your appointment (${when}). Please choose a new time — we're sorry for the inconvenience.</p>`,
    FOLLOW_UP_REMINDER: `<p>Hi ${ctx.recipientName},</p><p>Following up after your visit with ${ctx.doctorName}. Please reach out if your symptoms haven't improved.</p>`,
  };

  return { subject, body: shell(subject, messages[type]) };
}
