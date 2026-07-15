import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Harbor Clinic</p>
      <h1 className="mt-3 max-w-lg font-display text-4xl text-ink">
        Appointments that come with context, not just a time slot.
      </h1>
      <p className="mt-3 max-w-md text-muted">
        Share your symptoms ahead of time, get reminders that matter, and stay in sync with your
        doctor by email and calendar.
      </p>
      <div className="mt-8 flex gap-3">
        <Link
          href="/login"
          className="rounded-md bg-primary-500 px-5 py-2.5 text-white hover:bg-primary-600"
        >
          Sign in
        </Link>
        <Link
          href="/register"
          className="rounded-md border border-border px-5 py-2.5 text-ink hover:border-primary-300"
        >
          Create account
        </Link>
      </div>
    </main>
  );
}
