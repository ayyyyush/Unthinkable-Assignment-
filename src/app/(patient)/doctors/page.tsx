"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/frontend/apiClient";

interface Doctor {
  id: string;
  firstName: string;
  lastName: string;
  specialization: string;
  bio: string | null;
  timezone: string;
}

interface Slot {
  id: string;
  startTime: string;
  endTime: string;
}

const SPECIALIZATIONS = ["", "Cardiology", "Dermatology", "General Medicine"];

export default function DoctorSearchPage() {
  const router = useRouter();
  const [specialization, setSpecialization] = useState("");
  const [expandedDoctorId, setExpandedDoctorId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["doctors", specialization],
    queryFn: () =>
      apiFetch<{ data: Doctor[] }>(
        `/api/doctors/search${specialization ? `?specialization=${encodeURIComponent(specialization)}` : ""}`
      ),
  });

  return (
    <main className="min-h-screen bg-canvas px-6 py-12 md:px-16">
      <div className="mx-auto max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Harbor Clinic</p>
        <h1 className="mt-2 font-display text-4xl text-ink">Find a doctor</h1>
        <p className="mt-2 text-muted">
          Search by specialization and see real availability — no back-and-forth needed to book.
        </p>

        <div className="mt-8 flex flex-wrap gap-2">
          {SPECIALIZATIONS.map((s) => (
            <button
              key={s || "all"}
              onClick={() => setSpecialization(s)}
              className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
                specialization === s
                  ? "border-primary-500 bg-primary-500 text-white"
                  : "border-border bg-surface text-muted hover:border-primary-300"
              }`}
            >
              {s || "All specialties"}
            </button>
          ))}
        </div>

        <div className="mt-8 space-y-4">
          {isLoading && <p className="text-muted">Loading doctors…</p>}
          {data?.data.length === 0 && (
            <p className="text-muted">No doctors match that specialty right now.</p>
          )}

          {data?.data.map((doctor) => (
            <DoctorCard
              key={doctor.id}
              doctor={doctor}
              expanded={expandedDoctorId === doctor.id}
              onToggle={() =>
                setExpandedDoctorId(expandedDoctorId === doctor.id ? null : doctor.id)
              }
              onPickSlot={(slotId) => router.push(`/book/${doctor.id}/${slotId}`)}
            />
          ))}
        </div>
      </div>
    </main>
  );
}

function DoctorCard({
  doctor,
  expanded,
  onToggle,
  onPickSlot,
}: {
  doctor: Doctor;
  expanded: boolean;
  onToggle: () => void;
  onPickSlot: (slotId: string) => void;
}) {
  const { data: slots } = useQuery({
    queryKey: ["slots", doctor.id],
    queryFn: () => apiFetch<{ data: Slot[] }>(`/api/doctors/${doctor.id}/slots`),
    enabled: expanded,
  });

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-display text-xl text-ink">
            Dr. {doctor.firstName} {doctor.lastName}
          </h2>
          <p className="text-sm text-primary-600">{doctor.specialization}</p>
          {doctor.bio && <p className="mt-1 text-sm text-muted">{doctor.bio}</p>}
        </div>
        <button
          onClick={onToggle}
          className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm text-ink hover:border-primary-300"
        >
          {expanded ? "Hide times" : "See availability"}
        </button>
      </div>

      {expanded && (
        <div className="mt-4 border-t border-border pt-4">
          {!slots && <p className="text-sm text-muted">Loading availability…</p>}
          {slots?.data.length === 0 && (
            <p className="text-sm text-muted">No open slots in the next 60 days.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {slots?.data.slice(0, 12).map((slot) => (
              <button
                key={slot.id}
                onClick={() => onPickSlot(slot.id)}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-ink hover:border-primary-500 hover:text-primary-600"
              >
                {new Date(slot.startTime).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
