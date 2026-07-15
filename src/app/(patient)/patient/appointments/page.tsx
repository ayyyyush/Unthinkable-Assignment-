"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/frontend/apiClient";

interface PatientAppointment {
  id: string;
  status: string;
  startTime: string;
  doctorName: string;
  patientSummary: {
    summaryText: string;
    followUpSteps: string[];
    lifestyleAdvice: string[];
    dietRecommendations: string[];
    emergencyWarning: string | null;
  } | null;
  prescription: { medications: { name: string; dosage: string }[] } | null;
}

export default function PatientAppointmentsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["patient-appointments"],
    queryFn: () => apiFetch<{ data: PatientAppointment[] }>("/api/patient/appointments"),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/appointments/${id}/cancel`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["patient-appointments"] }),
  });

  const [cancelError, setCancelError] = useState<string | null>(null);

  return (
    <main className="min-h-screen bg-canvas px-6 py-12 md:px-16">
      <div className="mx-auto max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Harbor Clinic</p>
        <h1 className="mt-2 font-display text-4xl text-ink">Your appointments</h1>

        {isLoading && <p className="mt-6 text-muted">Loading…</p>}
        {cancelError && <p className="mt-4 text-sm text-urgency-high">{cancelError}</p>}

        <div className="mt-6 space-y-4">
          {data?.data.map((appt) => (
            <div key={appt.id} className="rounded-lg border border-border bg-surface p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-display text-lg text-ink">{appt.doctorName}</p>
                  <p className="text-sm text-muted">
                    {new Date(appt.startTime).toLocaleString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    · {appt.status}
                  </p>
                </div>
                {appt.status === "CONFIRMED" && (
                  <button
                    onClick={() =>
                      cancelMutation.mutate(appt.id, {
                        onError: (err) =>
                          setCancelError(err instanceof ApiError ? err.message : "Failed to cancel"),
                      })
                    }
                    className="rounded-md border border-border px-3 py-1.5 text-sm text-ink hover:border-urgency-high hover:text-urgency-high"
                  >
                    Cancel
                  </button>
                )}
              </div>

              {appt.patientSummary && (
                <div className="mt-4 rounded-md border border-primary-300/50 bg-primary-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-primary-700">
                    Visit summary
                  </p>
                  <p className="mt-1 text-sm text-ink">{appt.patientSummary.summaryText}</p>

                  {appt.patientSummary.emergencyWarning && (
                    <div className="mt-3 rounded-md border border-urgency-high/40 bg-urgency-high/10 p-3">
                      <p className="text-sm font-medium text-urgency-high">
                        {appt.patientSummary.emergencyWarning}
                      </p>
                    </div>
                  )}

                  {appt.patientSummary.followUpSteps.length > 0 && (
                    <>
                      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted">
                        Follow-up steps
                      </p>
                      <ul className="mt-1 list-disc pl-5 text-sm text-ink">
                        {appt.patientSummary.followUpSteps.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </>
                  )}

                  {appt.prescription && appt.prescription.medications.length > 0 && (
                    <>
                      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted">
                        Medication
                      </p>
                      <ul className="mt-1 list-disc pl-5 text-sm text-ink">
                        {appt.prescription.medications.map((m, i) => (
                          <li key={i}>
                            {m.name} — {m.dosage}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
