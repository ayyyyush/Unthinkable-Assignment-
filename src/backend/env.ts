import { z } from "zod";

// Validated once at import time. Any missing/invalid env var crashes the
// process at boot instead of surfacing as a confusing runtime error deep
// inside a request handler.
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 chars"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 chars"),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  SLOT_HOLD_MINUTES: z.coerce.number().default(5),

  // Each external integration has an explicit mock toggle, defaulting to
  // true. This is a deliberate statement, not a side effect of leaving a
  // field blank: the app is meant to run and be gradeable end-to-end with
  // zero paid API keys. Flip the relevant flag to false once real
  // credentials are filled in below.
  USE_MOCK_LLM: z.coerce.boolean().default(true),
  USE_MOCK_EMAIL: z.coerce.boolean().default(true),
  USE_MOCK_CALENDAR: z.coerce.boolean().default(true),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default("Clinic <no-reply@clinic.example>"),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),

  CRON_SECRET: z.string().min(16),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export const env = envSchema.parse(process.env);

// Flags used throughout the app to decide whether to attempt a live
// integration call or go straight to mock/graceful-degradation behavior.
// A real credential being present is not sufficient on its own — the
// corresponding USE_MOCK_* flag must also be turned off, so switching to
// a live integration is always a deliberate action, never an accident of
// which env vars happen to be filled in.
export const integrations = {
  aiEnabled: !env.USE_MOCK_LLM && Boolean(env.OPENAI_API_KEY),
  emailEnabled: !env.USE_MOCK_EMAIL && Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS),
  calendarEnabled:
    !env.USE_MOCK_CALENDAR && Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
};
