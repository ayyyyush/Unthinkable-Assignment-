"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/frontend/apiClient";
import { useAuthStore } from "@/frontend/authStore";

const ROLE_HOME: Record<string, string> = {
  PATIENT: "/doctors",
  DOCTOR: "/dashboard",
  ADMIN: "/dashboard",
};

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{
        accessToken: string;
        user: { id: string; email: string; role: "PATIENT" | "DOCTOR" | "ADMIN"; firstName: string };
      }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      setAuth(res.accessToken, res.user);
      router.push(ROLE_HOME[res.user.role] ?? "/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-sm">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Harbor Clinic</p>
        <h1 className="mt-2 font-display text-3xl text-ink">Sign in</h1>

        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
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
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-border bg-surface p-2.5 text-ink"
          />
          {error && <p className="text-sm text-urgency-high">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary-500 py-2.5 text-white hover:bg-primary-600 disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-sm text-muted">
          Don&apos;t have an account?{" "}
          <a href="/register" className="text-primary-600 underline">
            Register
          </a>
        </p>
      </div>
    </main>
  );
}
