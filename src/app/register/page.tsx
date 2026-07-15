"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/frontend/apiClient";

export default function RegisterPage() {
  const router = useRouter();
  const [role, setRole] = useState<"PATIENT" | "DOCTOR">("PATIENT");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          firstName,
          lastName,
          role,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          ...(role === "DOCTOR" ? { specialization } : {}),
        }),
      });
      setSuccess(true);
      setTimeout(() => router.push("/login"), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6 py-12">
      <div className="w-full max-w-sm">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Harbor Clinic</p>
        <h1 className="mt-2 font-display text-3xl text-ink">Create your account</h1>

        <div className="mt-6 flex gap-2">
          {(["PATIENT", "DOCTOR"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={`flex-1 rounded-md border px-3 py-2 text-sm ${
                role === r
                  ? "border-primary-500 bg-primary-500 text-white"
                  : "border-border bg-surface text-muted"
              }`}
            >
              {r === "PATIENT" ? "I'm a patient" : "I'm a doctor"}
            </button>
          ))}
        </div>

        {success ? (
          <p className="mt-6 text-primary-700">
            Account created — check your email to verify, then sign in.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-3">
            <div className="flex gap-2">
              <input
                required
                placeholder="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-1/2 rounded-md border border-border bg-surface p-2.5 text-ink"
              />
              <input
                required
                placeholder="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-1/2 rounded-md border border-border bg-surface p-2.5 text-ink"
              />
            </div>
            <input
              required
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-border bg-surface p-2.5 text-ink"
            />
            <input
              required
              type="password"
              minLength={8}
              placeholder="Password (min 8 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-border bg-surface p-2.5 text-ink"
            />
            {role === "DOCTOR" && (
              <input
                required
                placeholder="Specialization"
                value={specialization}
                onChange={(e) => setSpecialization(e.target.value)}
                className="w-full rounded-md border border-border bg-surface p-2.5 text-ink"
              />
            )}
            {error && <p className="text-sm text-urgency-high">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-primary-500 py-2.5 text-white hover:bg-primary-600 disabled:opacity-50"
            >
              {loading ? "Creating account…" : "Create account"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
