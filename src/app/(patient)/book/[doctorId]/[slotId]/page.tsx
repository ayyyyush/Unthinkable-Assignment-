"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/frontend/apiClient";

type HoldState =
  | { phase: "acquiring" }
  | { phase: "held"; appointmentId: string; holdExpiresAt: string }
  | { phase: "failed"; message: string }
  | { phase: "expired" }
  | { phase: "confirmed" };

/**
 * Design rationale for holding the slot on mount rather than on a "Book
 * now" click: the hold is what makes the subsequent symptom form safe to
 * fill out at all. Deferring the hold until form submission would reopen
 * exactly the race window the hold exists to close — another patient could
 * take the slot while this one is still typing.
 */
export default function BookingPage() {
  const params = useParams<{ doctorId: string; slotId: string }>();
  const router = useRouter();
  const [state, setState] = useState<HoldState>({ phase: "acquiring" });
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [symptomText, setSymptomText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ appointmentId: string; holdExpiresAt: string }>("/api/appointments/hold", {
      method: "POST",
      body: JSON.stringify({ doctorId: params.doctorId, slotId: params.slotId }),
    })
      .then((res) => {
        if (!cancelled) setState({ phase: "held", ...res });
      })
      .catch((err: ApiError) => {
        if (!cancelled) {
          setState({
            phase: "failed",
            message:
              err.status === 409
                ? "This slot was just taken by someone else. Please pick another time."
                : err.message,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [params.doctorId, params.slotId]);

  useEffect(() => {
    if (state.phase !== "held") return;
    const expiresAt = new Date(state.holdExpiresAt).getTime();

    const tick = () => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) setState({ phase: "expired" });
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [state]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (state.phase !== "held") return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await apiFetch(`/api/appointments/${state.appointmentId}/confirm`, {
        method: "POST",
        body: JSON.stringify({ symptomText }),
      });
      setState({ phase: "confirmed" });
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong confirming your appointment."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-canvas px-6 py-12 md:px-16">
      <div className="mx-auto max-w-xl">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Harbor Clinic</p>
        <h1 className="mt-2 font-display text-3xl text-ink">Confirm your appointment</h1>

        {state.phase === "acquiring" && (
          <p className="mt-6 text-muted">Reserving this time slot…</p>
        )}

        {state.phase === "failed" && (
          <div className="mt-6 rounded-lg border border-urgency-high/30 bg-urgency-high/5 p-4">
            <p className="text-urgency-high">{state.message}</p>
            <button
              onClick={() => router.push("/doctors")}
              className="mt-3 rounded-md bg-primary-500 px-4 py-2 text-sm text-white hover:bg-primary-600"
            >
              Back to doctor search
            </button>
          </div>
        )}

        {state.phase === "expired" && (
          <div className="mt-6 rounded-lg border border-urgency-medium/30 bg-urgency-medium/5 p-4">
            <p className="text-urgency-medium">
              Your hold on this slot expired before you finished. No charge, nothing was booked —
              just pick a time again.
            </p>
            <button
              onClick={() => router.push("/doctors")}
              className="mt-3 rounded-md bg-primary-500 px-4 py-2 text-sm text-white hover:bg-primary-600"
            >
              Choose a new time
            </button>
          </div>
        )}

        {state.phase === "confirmed" && (
          <div className="mt-6 rounded-lg border border-primary-300 bg-primary-50 p-4">
            <p className="text-primary-700">
              You&apos;re booked. A confirmation email and calendar invite are on their way, and
              your doctor will see your symptom summary before the visit.
            </p>
            <button
              onClick={() => router.push("/patient/appointments")}
              className="mt-3 rounded-md bg-primary-500 px-4 py-2 text-sm text-white hover:bg-primary-600"
            >
              View my appointments
            </button>
          </div>
        )}

        {state.phase === "held" && (
          <>
            <div className="mt-6 flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <span className="text-sm text-muted">Time reserved for you</span>
              <HoldCountdown seconds={secondsLeft} />
            </div>

            <form onSubmit={handleSubmit} className="mt-6 space-y-3">
              <label htmlFor="symptoms" className="block font-display text-lg text-ink">
                Tell your doctor what&apos;s going on
              </label>
              <p className="text-sm text-muted">
                A quick summary of your symptoms helps your doctor prepare — the more specific,
                the better.
              </p>
              <textarea
                id="symptoms"
                required
                minLength={10}
                rows={6}
                value={symptomText}
                onChange={(e) => setSymptomText(e.target.value)}
                placeholder="e.g. Dull headache for the past 3 days, worse in the morning, over-the-counter pain relief hasn't helped..."
                className="w-full rounded-md border border-border bg-surface p-3 text-ink placeholder:text-muted/60"
              />
              {submitError && <p className="text-sm text-urgency-high">{submitError}</p>}
              <button
                type="submit"
                disabled={submitting || symptomText.trim().length < 10}
                className="w-full rounded-md bg-primary-500 py-2.5 text-white transition-colors hover:bg-primary-600 disabled:opacity-50"
              >
                {submitting ? "Confirming…" : "Confirm appointment"}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

function HoldCountdown({ seconds }: { seconds: number | null }) {
  if (seconds === null) return null;
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  const urgent = seconds <= 60;
  return (
    <span
      className={`font-mono text-lg tabular-nums ${urgent ? "text-urgency-medium" : "text-ink"}`}
    >
      {mm}:{ss.toString().padStart(2, "0")}
    </span>
  );
}
