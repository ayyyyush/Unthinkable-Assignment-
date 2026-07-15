import { z } from "zod";
import { env, integrations } from "./env";
import { prisma } from "./db";

// ── Prompt versioning ────────────────────────────────────────────────────
// Bumping these strings is how prompt changes are tracked against stored
// outputs — every AISummary/PatientSummary row records which version
// produced it, so a prompt regression can be traced to exactly the outputs
// it affected.
const PRE_VISIT_PROMPT_VERSION = "pre-visit-v1";
const POST_VISIT_PROMPT_VERSION = "post-visit-v1";

const preVisitSchema = z.object({
  urgency: z.enum(["LOW", "MEDIUM", "HIGH"]),
  chiefComplaint: z.string(),
  riskIndicators: z.array(z.string()).default([]),
  suggestedQuestions: z.array(z.string()).min(1).max(5),
  likelyDepartment: z.string(),
  confidenceLevel: z.number().min(0).max(1),
});
export type PreVisitSummary = z.infer<typeof preVisitSchema>;

const postVisitSchema = z.object({
  summaryText: z.string(),
  medicationSchedule: z
    .array(
      z.object({
        name: z.string(),
        dosage: z.string(),
        timesPerDay: z.number(),
        durationDays: z.number(),
      })
    )
    .default([]),
  followUpSteps: z.array(z.string()).default([]),
  lifestyleAdvice: z.array(z.string()).default([]),
  dietRecommendations: z.array(z.string()).default([]),
  // Populated only when clinical notes flag something urgent — patient copy
  // must read as a restatement of the doctor's own note, never as new
  // medical judgment invented by the model. See buildPostVisitPrompt.
  emergencyWarning: z.string().nullable(),
});
export type PostVisitSummary = z.infer<typeof postVisitSchema>;

async function callOpenAI(systemPrompt: string, userPrompt: string): Promise<unknown> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI response missing content");
  return JSON.parse(content);
}

/**
 * Retries twice (three attempts total), then falls back — matches the
 * assignment's explicit "retry twice, log failure, fallback, never crash"
 * contract. This is the single choke point every AI call goes through, so
 * that contract only has to be implemented once.
 */
async function callWithRetry<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodSchema<T>
): Promise<{ parsed: T | null; raw: unknown; attempts: number; isFallback: boolean }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await callOpenAI(systemPrompt, userPrompt);
      const parsed = schema.parse(raw);
      return { parsed, raw, attempts: attempt, isFallback: false };
    } catch (err) {
      lastError = err;
      console.error(`[ai] attempt ${attempt} failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.error("[ai] all attempts exhausted, falling back", lastError);
  return { parsed: null, raw: null, attempts: 3, isFallback: true };
}

const PRE_VISIT_SYSTEM = `You are a clinical intake assistant. Analyse the patient's self-reported symptoms and return ONLY a JSON object with keys: urgency (LOW|MEDIUM|HIGH), chiefComplaint (string), riskIndicators (string array), suggestedQuestions (string array, 3 items), likelyDepartment (string), confidenceLevel (0-1 float). You are assisting the doctor's triage, not diagnosing. Never claim certainty; when uncertain, set urgency conservatively higher and lower confidenceLevel.`;

const FALLBACK_PRE_VISIT: PreVisitSummary = {
  urgency: "MEDIUM",
  chiefComplaint: "Automated summary unavailable — please review the patient's raw symptom text below.",
  riskIndicators: [],
  suggestedQuestions: [
    "Can you describe when the symptoms started?",
    "Have symptoms worsened, improved, or stayed the same?",
    "Any relevant medical history the doctor should know?",
  ],
  likelyDepartment: "General Medicine",
  confidenceLevel: 0,
};

export async function generatePreVisitSummary(symptomId: string, symptomText: string) {
  let parsed: PreVisitSummary | null = null;
  let raw: unknown = null;
  let attempts = 1;
  let isFallback = true;

  if (integrations.aiEnabled) {
    const result = await callWithRetry(
      PRE_VISIT_SYSTEM,
      `Symptoms: ${symptomText}`,
      preVisitSchema
    );
    parsed = result.parsed;
    raw = result.raw;
    attempts = result.attempts;
    isFallback = result.isFallback;
  }

  const data = parsed ?? FALLBACK_PRE_VISIT;

  return prisma.aISummary.create({
    data: {
      symptomId,
      urgency: data.urgency,
      chiefComplaint: data.chiefComplaint,
      riskIndicators: data.riskIndicators,
      suggestedQuestions: data.suggestedQuestions,
      likelyDepartment: data.likelyDepartment,
      confidenceLevel: data.confidenceLevel,
      promptVersion: PRE_VISIT_PROMPT_VERSION,
      raw: raw ? JSON.parse(JSON.stringify(raw)) : undefined,
      isFallback,
      attempts,
    },
  });
}

function buildPostVisitPrompt(clinicalNotes: string): string {
  // Explicitly instructs the model to restate the doctor's own judgment
  // rather than introduce new medical conclusions — see the framing note
  // in the Phase 1 architecture doc. This is a patient-facing rewrite of
  // notes a licensed doctor already wrote, not independent advice.
  return `Clinical notes from the treating doctor: ${clinicalNotes}

Rewrite these notes for the patient in plain, reassuring language. Do not introduce any diagnosis, medication, or recommendation that is not already present in the notes above — you are translating the doctor's own decisions, not adding new ones. If the notes mention anything requiring urgent attention, set emergencyWarning to a short instruction to contact the doctor or emergency services immediately; otherwise set it to null. Always end the summary with: "This summary is provided for convenience and is not a substitute for professional medical advice."`;
}

const POST_VISIT_SYSTEM = `You convert a doctor's clinical notes into a patient-friendly summary. Return ONLY a JSON object with keys: summaryText (string), medicationSchedule (array of {name, dosage, timesPerDay, durationDays}), followUpSteps (string array), lifestyleAdvice (string array), dietRecommendations (string array), emergencyWarning (string or null). Never invent clinical facts not present in the source notes.`;

const FALLBACK_POST_VISIT: PostVisitSummary = {
  summaryText:
    "Your doctor has recorded notes from your visit. An automated summary could not be generated right now — please review the clinical notes directly or contact the clinic with any questions. This summary is provided for convenience and is not a substitute for professional medical advice.",
  medicationSchedule: [],
  followUpSteps: ["Contact the clinic if you have questions about your visit."],
  lifestyleAdvice: [],
  dietRecommendations: [],
  emergencyWarning: null,
};

export async function generatePostVisitSummary(clinicalNoteId: string, clinicalNotes: string) {
  let parsed: PostVisitSummary | null = null;
  let raw: unknown = null;
  let attempts = 1;
  let isFallback = true;

  if (integrations.aiEnabled) {
    const result = await callWithRetry(
      POST_VISIT_SYSTEM,
      buildPostVisitPrompt(clinicalNotes),
      postVisitSchema
    );
    parsed = result.parsed;
    raw = result.raw;
    attempts = result.attempts;
    isFallback = result.isFallback;
  }

  const data = parsed ?? FALLBACK_POST_VISIT;

  return prisma.patientSummary.create({
    data: {
      clinicalNoteId,
      summaryText: data.summaryText,
      medicationSchedule: data.medicationSchedule,
      followUpSteps: data.followUpSteps,
      lifestyleAdvice: data.lifestyleAdvice,
      dietRecommendations: data.dietRecommendations,
      emergencyWarning: data.emergencyWarning,
      promptVersion: POST_VISIT_PROMPT_VERSION,
      raw: raw ? JSON.parse(JSON.stringify(raw)) : undefined,
      isFallback,
      attempts,
    },
  });
}
