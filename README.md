# Harbor Clinic — Healthcare Appointment & Follow-up Manager

A full-stack appointment platform with separate **patient**, **doctor**, and **admin**
portals. Patients book slots and describe symptoms, an LLM drafts a pre-visit summary for
the doctor, the doctor logs notes + a prescription and the LLM turns that into a
patient-friendly summary, and both sides get email + Google Calendar updates at every step.

The app runs **out of the box with zero paid API keys** — LLM, email, and Google Calendar
all have a mock mode (`USE_MOCK_*=true` in `.env`, the default in `.env.example`). Swap in
real credentials later without touching any code.

---

## 1. Tech Stack

- **Framework:** Next.js 15 (App Router) — frontend and backend in one codebase, TypeScript strict
- **Database:** PostgreSQL, via Prisma ORM
- **Auth:** JWT access tokens + rotating httpOnly-cookie refresh tokens, role-based (`PATIENT` / `DOCTOR` / `ADMIN`)
- **LLM:** OpenAI (pluggable), mock fallback
- **Email:** Nodemailer (SMTP), mock fallback (logs to console)
- **Calendar:** Google Calendar API (OAuth 2.0), mock fallback
- **Background jobs:** cron-triggered API routes (no separate worker process) for slot-hold cleanup, reminders, and notification retries
- **Testing:** Vitest, including a dedicated concurrency proof for the booking engine

Why this stack over a more "enterprise-looking" split (separate NestJS service +
Redis/BullMQ): correctness for booking comes from a Postgres transaction + unique
constraint, not a distributed lock, so a second framework and a message queue would add
surface area without adding safety. Full reasoning in `SYSTEM_DESIGN.md`.

---

## 2. Project Structure

Organized the same way a split frontend/backend/database repo would be, adapted to how
Next.js actually works: `database/` holds the schema and seed, `src/backend/` holds every
piece of server-only logic, and `src/frontend/` holds client-only code. The one constraint
that doesn't bend: Next.js's router requires pages and API route handlers to physically live
under `src/app/` to be routable at all — so that folder is a thin layer of route handlers and
page components that import from `backend/` and `frontend/`, not a place where logic lives.

```
healthcare-app/
├── database/
│   ├── schema.prisma              # full data model, heavily commented
│   └── seed.ts                    # demo doctors/patient/admin + 60 days of slots
├── src/
│   ├── backend/                   # server-only logic — never imported by client components
│   │   ├── booking.ts             # the booking engine — hold/confirm/cancel/reschedule
│   │   ├── ai.ts                  # LLM calls, retry-twice + fallback, mock mode
│   │   ├── email.ts               # SMTP + templates, mock mode
│   │   ├── calendar.ts            # Google OAuth2 + event sync, mock mode
│   │   ├── auth.ts                # password hashing, JWT, refresh-token rotation
│   │   ├── requireAuth.ts         # RBAC guard used by every protected route
│   │   ├── requireCron.ts         # shared-secret guard for cron routes
│   │   ├── apiError.ts            # one error shape for the whole API
│   │   ├── rateLimit.ts           # per-IP/user limiter for auth + booking
│   │   └── notify.ts / audit.ts   # notification dispatch + audit logging
│   ├── frontend/                  # client-only code
│   │   ├── apiClient.ts           # typed fetch wrapper, transparent token refresh
│   │   └── authStore.ts           # zustand auth state (in-memory access token)
│   ├── app/                       # Next.js App Router — pages + API routes
│   │   │                          # (routing requires these to live under app/;
│   │   │                          #  everything here just imports backend/ or frontend/)
│   │   ├── api/
│   │   │   ├── auth/              # register, login, refresh, logout, password reset, verify
│   │   │   ├── doctors/           # search, live slot availability
│   │   │   ├── appointments/      # hold, confirm, cancel, reschedule
│   │   │   ├── doctor/            # doctor's appointment list, notes, leave
│   │   │   ├── patient/           # patient's appointment list
│   │   │   ├── admin/             # doctor management, analytics
│   │   │   └── cron/              # cleanup-holds, send-reminders, retry-failed-emails
│   │   ├── (patient)/             # doctor search, booking flow, appointment history
│   │   ├── (doctor)/dashboard/    # today's/upcoming appointments, AI summary, notes form
│   │   ├── (admin)/dashboard/     # analytics + doctor management
│   │   └── login/ register/       # auth pages
│   └── tests/
│       └── booking.concurrency.test.ts   # the concurrency proof — see §9
├── SYSTEM_DESIGN.md                # 800-word design write-up (deliverable #4)
└── README.md
```

---

## 3. Setup Guide

### Prerequisites
- Node.js 18+
- PostgreSQL running locally, or a free Neon/Supabase connection string

### Install & run

```bash
npm install
cp .env.example .env        # defaults already run in full mock mode
npx prisma migrate dev      # creates the schema
npm run prisma:seed         # demo doctors/patient/admin + 60 days of slots
npm run dev                 # http://localhost:3000
```

### Demo logins (after `npm run prisma:seed`)

| Role | Email | Password |
|---|---|---|
| Admin | `admin@clinic.example` | `Password123!` |
| Doctor | `dr.patel@clinic.example` (also `dr.chen@…`, `dr.osei@…`) | `Password123!` |
| Patient | `patient@clinic.example` | `Password123!` |

### Tests

```bash
# Concurrency proof — requires a real Postgres (deliberately not mocked,
# since mocking Prisma here would only prove the mock behaves correctly):
TEST_DATABASE_URL="postgresql://..." npm test
```

### Background jobs

No long-running worker process — instead, three routes are meant to be hit on a schedule
(Vercel Cron, GitHub Actions, or cron-job.org), authenticated with `CRON_SECRET` as a bearer
token:

| Route | Suggested frequency | Purpose |
|---|---|---|
| `POST /api/cron/cleanup-holds` | every 1 min | releases expired 5-minute slot holds |
| `POST /api/cron/send-reminders` | every 5 min | sends due appointment/medication/follow-up reminders |
| `POST /api/cron/retry-failed-emails` | every 10 min | retries failed notification sends, up to 5 attempts |

---

## 4. Database Schema

Full schema: `database/schema.prisma`. Key models:

**User** — role-based (`PATIENT` / `DOCTOR` / `ADMIN`, no separate Admin table), password
hash, timezone, email verification + reset tokens.

**DoctorProfile** / **PatientProfile** — role-specific fields only (specialization,
working hours, leave days / medical history).

**AppointmentSlot** — `id, doctorId, startTime, endTime, status[AVAILABLE|HELD|BOOKED|CANCELLED], heldByPatientId, holdExpiresAt`. **Unique constraint on `(doctorId, startTime)`** — this, plus the conditional status transition in `booking.ts`, is what makes double-booking impossible at the database level (see `SYSTEM_DESIGN.md`).

**Appointment** — links a slot to a patient/doctor, status lifecycle
`PENDING_SYMPTOMS → CONFIRMED → COMPLETED`, or `CANCELLED` / `RESCHEDULED`.

**Symptom / AISummary** — raw patient text + structured pre-visit LLM output (urgency,
chief complaint, risk indicators, suggested questions, department, confidence).

**ClinicalNote / Prescription / PatientSummary** — doctor's notes, structured medications,
and the structured post-visit patient-friendly LLM output.

**ReminderJob, CalendarEvent, Notification, AuditLog, RefreshToken** — background-job
queue, calendar sync state, notification log (kept even on send failure), audit trail, and
rotating refresh tokens with reuse detection.

---

## 5. API Reference

All responses share one shape: success bodies are plain JSON; errors are
`{ error: "CODE", message: string }` with a matching HTTP status — see `src/backend/apiError.ts`.
Protected routes need `Authorization: Bearer <accessToken>`.

**Auth**
- `POST /api/auth/register` — patient or doctor self-registration
- `POST /api/auth/login`
- `POST /api/auth/refresh` — rotates the refresh token (cookie-based)
- `POST /api/auth/logout`
- `POST /api/auth/forgot-password` / `reset-password` / `verify-email`

**Doctors**
- `GET /api/doctors/search?specialization=&page=&pageSize=` — public
- `GET /api/doctors/:id/slots?from=&to=` — public, live availability

**Appointments** (patient-authenticated)
- `POST /api/appointments/hold {doctorId, slotId}`
- `POST /api/appointments/:id/confirm {symptomText}`
- `POST /api/appointments/:id/cancel {reason?}`
- `POST /api/appointments/:id/reschedule {newSlotId}`

**Doctor**
- `GET /api/doctor/appointments`
- `POST /api/doctor/appointments/:id/notes {notes, medications[]}`
- `POST /api/doctor/leave {date, reason?}` — detects conflicts, cancels affected bookings, notifies patients with alternative slots

**Patient**
- `GET /api/patient/appointments`

**Admin**
- `GET|POST /api/admin/doctors`
- `GET /api/admin/analytics`

**Cron** (bearer `CRON_SECRET`) — see §3 table above.

---

## 6. LLM Prompts Used

**Pre-visit summary** (`src/backend/ai.ts :: generatePreVisitSummary`, prompt version `pre-visit-v1`):
> "You are a clinical intake assistant. Analyse the patient's self-reported symptoms and
> return ONLY a JSON object with keys: urgency (LOW|MEDIUM|HIGH), chiefComplaint,
> riskIndicators, suggestedQuestions, likelyDepartment, confidenceLevel (0-1). You are
> assisting the doctor's triage, not diagnosing. Never claim certainty; when uncertain, set
> urgency conservatively higher and lower confidenceLevel."

**Post-visit summary** (`generatePostVisitSummary`, prompt version `post-visit-v1`):
> "Rewrite these clinical notes for the patient in plain, reassuring language. Do not
> introduce any diagnosis, medication, or recommendation that is not already present in the
> notes — you are translating the doctor's own decisions, not adding new ones. If the notes
> mention anything requiring urgent attention, set emergencyWarning to a short instruction
> to contact the doctor or emergency services immediately; otherwise null. Always end with:
> 'This summary is provided for convenience and is not a substitute for professional medical
> advice.'"

Both calls go through one retry/fallback choke point: 3 attempts total, Zod-validated
structured JSON, falling back to a safe static response (never blocking booking or visit
completion) if every attempt fails or `USE_MOCK_LLM=true`. Every stored summary records
which prompt version produced it.

---

## 7. Google Calendar Setup (optional — mock mode works without this)

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Google Calendar API**.
2. Create OAuth 2.0 credentials (type: Web application). Add `{APP_URL}/api/calendar/oauth/callback` as an authorized redirect URI.
3. Copy the Client ID/Secret into `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
4. Set `USE_MOCK_CALENDAR=false`.
5. Each user connects their own calendar via the OAuth consent flow (`getGoogleAuthUrl` in `src/backend/calendar.ts`); tokens are stored per-user in `GoogleCalendarAuth`. Users who never connect simply don't get calendar sync — booking still succeeds.

Until then, `USE_MOCK_CALENDAR=true` (the default) skips calendar sync silently so booking/cancel/reschedule flows work end-to-end for demo/grading purposes.

---

## 8. Email Setup (optional — mock mode logs to console)

Set `USE_MOCK_EMAIL=false` and fill `SMTP_HOST/PORT/USER/PASS` (e.g. Gmail app password,
SendGrid SMTP relay, or Mailgun SMTP) in `.env`. In mock mode every email is logged to the
server console instead of sent, so you can verify content during grading without setting up
SMTP.

---

## 9. Testing — the concurrency proof

`src/tests/booking.concurrency.test.ts` proves the specific, falsifiable claim that matters
most: given N truly concurrent hold/confirm requests for the *same* slot, exactly one
succeeds and the rest fail cleanly, with zero duplicate `Appointment` rows afterward. It
runs against a real Postgres instance rather than a mocked Prisma client, since mocking the
database would only prove the mock behaves correctly, not that Postgres's row-level locking
actually prevents the race. See `SYSTEM_DESIGN.md` for the full explanation of why this
approach is race-free.

---

## 10. Deployment

- **App:** Vercel — set the same env vars as `.env.example` (mock flags or real values), build command `next build`.
- **Database:** Neon or Supabase free tier, put the connection string in `DATABASE_URL`.
- **Cron:** Vercel Cron (or GitHub Actions / cron-job.org) hitting the three `/api/cron/*` routes on the schedule in §3, with `CRON_SECRET` as the bearer token.

---

## What's deliberately not in this pass

A separate NestJS service, Redis + BullMQ, full Docker/CI, and a complete enterprise
UI/test suite were all considered and scoped out — they add infrastructure without adding
correctness beyond what Postgres transactions already guarantee (§1, `SYSTEM_DESIGN.md`).
Also out of scope: full Swagger/OpenAPI docs, a dedicated admin working-hours editor UI, and
browser E2E tests — the concurrency test is the one explicitly called out as most important,
so that's the one built out in full.
