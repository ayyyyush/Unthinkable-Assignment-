"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/frontend/apiClient";

interface Analytics {
  totalPatients: number;
  totalDoctors: number;
  upcomingConfirmedAppointments: number;
  appointmentsByStatus: Record<string, number>;
}

interface Doctor {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  specialization: string;
  slotDurationMinutes: number;
  appointmentCount: number;
  leaveCount: number;
}

export default function AdminDashboardPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: analytics } = useQuery({
    queryKey: ["admin-analytics"],
    queryFn: () => apiFetch<Analytics>("/api/admin/analytics"),
  });

  const { data: doctors } = useQuery({
    queryKey: ["admin-doctors"],
    queryFn: () => apiFetch<{ data: Doctor[] }>("/api/admin/doctors"),
  });

  return (
    <main className="min-h-screen bg-canvas px-6 py-12 md:px-16">
      <div className="mx-auto max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Harbor Clinic</p>
        <h1 className="mt-2 font-display text-4xl text-ink">Admin</h1>

        <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Patients" value={analytics?.totalPatients} />
          <StatCard label="Doctors" value={analytics?.totalDoctors} />
          <StatCard label="Upcoming visits" value={analytics?.upcomingConfirmedAppointments} />
          <StatCard
            label="Cancelled"
            value={analytics?.appointmentsByStatus?.CANCELLED ?? 0}
          />
        </section>

        <section className="mt-10">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl text-ink">Doctors</h2>
            <button
              onClick={() => setShowForm(!showForm)}
              className="rounded-md bg-primary-500 px-4 py-2 text-sm text-white hover:bg-primary-600"
            >
              {showForm ? "Cancel" : "Add doctor"}
            </button>
          </div>

          {showForm && (
            <AddDoctorForm
              onCreated={() => {
                setShowForm(false);
                queryClient.invalidateQueries({ queryKey: ["admin-doctors"] });
              }}
            />
          )}

          <div className="mt-4 space-y-3">
            {doctors?.data.map((d) => (
              <div key={d.id} className="rounded-lg border border-border bg-surface p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-display text-lg text-ink">
                      Dr. {d.firstName} {d.lastName}
                    </p>
                    <p className="text-sm text-primary-600">{d.specialization}</p>
                  </div>
                  <p className="text-sm text-muted">
                    {d.appointmentCount} appointments · {d.leaveCount} leave days
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="font-display text-3xl text-ink">{value ?? "–"}</p>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}

function AddDoctorForm({ onCreated }: { onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/admin/doctors", {
        method: "POST",
        body: JSON.stringify({
          email,
          firstName,
          lastName,
          specialization,
          slotDurationMinutes: 30,
          // Default Mon-Fri 9-5 UTC; admin can adjust working hours later
          // from a dedicated settings view (not built in this pass).
          workingHours: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
            dayOfWeek,
            startMinute: 9 * 60,
            endMinute: 17 * 60,
          })),
        }),
      }),
    onSuccess: onCreated,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to create doctor"),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <input
        required
        placeholder="First name"
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
        className="rounded-md border border-border p-2 text-sm"
      />
      <input
        required
        placeholder="Last name"
        value={lastName}
        onChange={(e) => setLastName(e.target.value)}
        className="rounded-md border border-border p-2 text-sm"
      />
      <input
        required
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="col-span-2 rounded-md border border-border p-2 text-sm"
      />
      <input
        required
        placeholder="Specialization"
        value={specialization}
        onChange={(e) => setSpecialization(e.target.value)}
        className="col-span-2 rounded-md border border-border p-2 text-sm"
      />
      {error && <p className="col-span-2 text-sm text-urgency-high">{error}</p>}
      <button
        type="submit"
        disabled={mutation.isPending}
        className="col-span-2 rounded-md bg-primary-500 py-2 text-sm text-white hover:bg-primary-600 disabled:opacity-50"
      >
        {mutation.isPending ? "Creating…" : "Create doctor account"}
      </button>
    </form>
  );
}
