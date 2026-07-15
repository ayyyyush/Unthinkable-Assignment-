import { prisma } from "./db";
import { sendEmail } from "./email";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

function shell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html><body style="font-family:-apple-system,Arial,sans-serif;background:#f4f4f5;padding:24px;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;">
<h2 style="margin-top:0;color:#111827;">${title}</h2>${bodyHtml}
</div></body></html>`;
}

export async function queueVerificationEmail(userId: string, token: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;

  const link = `${APP_URL}/verify-email?token=${token}`;
  try {
    await sendEmail({
      to: user.email,
      subject: "Verify your email",
      html: shell(
        "Verify your email",
        `<p>Hi ${user.firstName},</p><p>Please confirm your email address to activate your account:</p><p><a href="${link}">${link}</a></p><p>This link expires in 24 hours.</p>`
      ),
    });
  } catch (err) {
    // Verification email failure shouldn't fail registration — the user
    // can request a resend. Logged for the retry cron / support visibility.
    console.error("[queueVerificationEmail] failed", err);
  }
}

export async function queuePasswordResetEmail(userId: string, token: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;

  const link = `${APP_URL}/reset-password?token=${token}`;
  try {
    await sendEmail({
      to: user.email,
      subject: "Reset your password",
      html: shell(
        "Reset your password",
        `<p>Hi ${user.firstName},</p><p>Click below to reset your password. If you didn't request this, ignore this email.</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour.</p>`
      ),
    });
  } catch (err) {
    console.error("[queuePasswordResetEmail] failed", err);
  }
}
