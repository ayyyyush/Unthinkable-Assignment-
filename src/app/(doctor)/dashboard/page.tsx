"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/frontend/apiClient";

interface AISummary {
  urgency: "LOW" | "MEDIUM" | "HIGH" | null;
  chiefComplaint: string | null;
  riskIndicators: string[];
  suggestedQuestions: string[];
  likelyDepartment: string | null;
  confidenceLevel: number | null;
  isFallback: boolean;
}

interface DoctorAppointment {
  id: string;
  status: string;
  startTime: string;
  endTime: string;
  patientName: string;
  symptomText: string | null;
  aiSummary: AISummary | null;
  hasNotes: boolean;
}

const URGENCY_STYLES: Record<string, string> = {
  LOW: "bg-urgency-low/10 text-urgency-low border-urgency-low/30",
  MEDIUM: "bg-urgency-medium/10 text-urgency-medium border-urgency-medium/30",
  HIGH: "bg-urgency-high/10 text-urgency-high border-urgency-high/30",
};

export default function DoctorDashboardPage() {
  const queryClient = useQueryClient();
  const [openNotesFor, setOpenNotesFor] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["doctor-appointments"],
    queryFn: () => apiFetch<{ data: DoctorAppointment[] }>("/api/doctor/appointments"),
  });

  const now = Date.now();
  const upcoming = data?.data.filter((a) => new Date(a.startTime).getTime() >= now) ?? [];
  const past = data?.data.filter((a) => new Date(a.startTime).getTime() < now) ?? [];

  return (
    <main className="min-h-screen bg-canvas px-6 py-12 md:px-16">
      <div className="mx-auto max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Harbor Clinic</p>
        <h1 className="mt-2 font-display text-4xl text-ink">Your schedule</h1>

        <section className="mt-8">
          <h2 className="font-display text-xl text-ink">Upcoming</h2>
          {isLoading && <p className="mt-3 text-muted">Loading…</p>}
          {!isLoading && upcoming.length === 0 && (
            <p className="mt-3 text-muted">No upcoming appointments.</p>
          )}
          <div className="mt-4 space-y-4">
            {upcoming.map((appt) => (
              <AppointmentCard
                key={appt.id}
                appt={appt}
                notesOpen={openNotesFor === appt.id}
                onToggleNotes={() => setOpenNotesFor(openNotesFor === appt.id ? null : appt.id)}
                onNotesSaved={() => {
                  setOpenNotesFor(null);
                  queryClient.invalidateQueries({ queryKey: ["doctor-appointments"] });
                }}
              />
            ))}
          </div>
        </section>

        {past.length > 0 && (
          <section className="mt-10">
            <h2 className="font-display text-xl text-ink">Past</h2>
            <div className="mt-4 space-y-4">
              {past.map((appt) => (
                <AppointmentCard
                  key={appt.id}
                  appt={appt}
                  notesOpen={openNotesFor === appt.id}
                  onToggleNotes={() => setOpenNotesFor(openNotesFor === appt.id ? null : appt.id)}
                  onNotesSaved={() => {
                    setOpenNotesFor(null);
                    queryClient.invalidateQueries({ queryKey: ["doctor-appointments"] });
                  }}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function AppointmentCard({
  appt,
  notesOpen,
  onToggleNotes,
  onNotesSaved,
}: {
  appt: DoctorAppointment;
  notesOpen: boolean;
  onToggleNotes: () => void;
  onNotesSaved: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-display text-lg text-ink">{appt.patientName}</h3>
          <p className="text-sm text-muted">
            {new Date(appt.startTime).toLocaleString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
        </div>
        {appt.aiSummary?.urgency && (
          <span
            className={`rounded-full border px-3 py-1 text-xs font-medium ${URGENCY_STYLES[appt.aiSummary.urgency]}`}
          >
            {appt.aiSummary.urgency} urgency
          </span>
        )}
      </div>

      {appt.symptomText && (
        <div className="mt-4 rounded-md bg-canvas p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Patient-submitted symptoms
          </p>
          <p className="mt-1 text-sm text-ink">{appt.symptomText}</p>
        </div>
      )}

      {appt.aiSummary && (
        <div className="mt-3 rounded-md border border-primary-300/50 bg-primary-50 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-primary-700">
              AI pre-visit summary
            </p>
            {appt.aiSummary.isFallback && (
              <span className="text-xs text-muted">Fallback — model unavailable</span>
            )}
          </div>
          <p className="mt-1 text-sm text-ink">{appt.aiSummary.chiefComplaint}</p>
          {appt.aiSummary.suggestedQuestions.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-ink">
              {appt.aiSummary.suggestedQuestions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted">
            Likely department: {appt.aiSummary.likelyDepartment} · Confidence:{" "}
            {appt.aiSummary.confidenceLevel != null
              ? `${Math.round(appt.aiSummary.confidenceLevel * 100)}%`
              : "n/a"}
          </p>
        </div>
      )}

      <div className="mt-4">
        {appt.hasNotes ? (
          <span className="text-sm text-muted">Notes submitted for this visit.</span>
        ) : (
          <button
            onClick={onToggleNotes}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-ink hover:border-primary-300"
          >
            {notesOpen ? "Cancel" : "Add clinical notes"}
          </button>
        )}
      </div>

      {notesOpen && <NotesForm appointmentId={appt.id} onSaved={onNotesSaved} />}
    </div>
  );
}

function NotesForm({ appointmentId, onSaved }: { appointmentId: string; onSaved: () => void }) {
  const [notes, setNotes] = useState("");
  const [medName, setMedName] = useState("");
  const [medDosage, setMedDosage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/doctor/appointments/${appointmentId}/notes`, {
        method: "POST",
        body: JSON.stringify({
          notes,
          medications: medName
            ? [{ name: medName, dosage: medDosage || "as directed", frequencyPerDay: 2, durationDays: 7 }]
            : [],
        }),
      }),
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to save notes"),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      className="mt-4 space-y-3 border-t border-border pt-4"
    >
      <textarea
        required
        minLength={10}
        rows={4}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Clinical notes from the visit…"
        className="w-full rounded-md border border-border bg-canvas p-3 text-sm text-ink"
      />
      <div className="flex gap-2">
        <input
          value={medName}
          onChange={(e) => setMedName(e.target.value)}
          placeholder="Medication (optional)"
          className="flex-1 rounded-md border border-border bg-canvas p-2 text-sm text-ink"
        />
        <input
          value={medDosage}
          onChange={(e) => setMedDosage(e.target.value)}
          placeholder="Dosage"
          className="w-32 rounded-md border border-border bg-canvas p-2 text-sm text-ink"
        />
      </div>
      {error && <p className="text-sm text-urgency-high">{error}</p>}
      <button
        type="submit"
        disabled={mutation.isPending || notes.trim().length < 10}
        className="rounded-md bg-primary-500 px-4 py-2 text-sm text-white hover:bg-primary-600 disabled:opacity-50"
      >
        {mutation.isPending ? "Saving…" : "Save notes & generate patient summary"}
      </button>
    </form>
  );
}
