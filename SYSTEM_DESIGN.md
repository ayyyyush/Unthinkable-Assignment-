# System Design Write-up

## Double-booking prevention

Every appointment slot is a row in `AppointmentSlot`, carrying a unique
constraint on `(doctorId, startTime)` — two rows for the same doctor at the
same start time cannot exist. That constraint is a safety net, not the
active mechanism: the actual booking action is a *conditional update*,
expressed as `UPDATE ... SET status = 'HELD' WHERE id = ? AND status =
'AVAILABLE'`, run inside a Postgres transaction alongside the `Appointment`
row it creates.

This matters because of how Postgres executes it. Row-level locking means
that when two concurrent transactions both attempt this update on the same
row, the database serializes them: the first to arrive wins the lock,
performs the update, and commits. The second transaction blocks until the
first releases the lock, then re-evaluates its own `WHERE` clause — and
finds `status` no longer equals `'AVAILABLE'`, because the winner already
changed it. Its update affects zero rows. The application checks exactly
that: if `updateMany` reports `count === 0`, the request throws a clean
`ConflictError` ("this slot is no longer available") instead of a duplicate
booking, a crash, or a generic 500.

This guarantee holds regardless of how many application server instances
are running concurrently, because the exclusivity lives in Postgres's row
lock, not in any in-process mutex or cache. That's also the reason this
build does not add a Redis distributed lock in front of it: a lock is, at
best, a latency optimization that avoids sending doomed requests to the
database — it cannot *replace* the database guarantee, because a lock whose
TTL expires mid-request would let two requests both believe they hold
exclusivity while Postgres still only commits one of their writes anyway.
For clinic-scale traffic (not a flash-sale burst), the added infrastructure
isn't earning its complexity.

## Slot hold mechanism

Because the symptom form must be completed *before* a booking is confirmed,
there's a real window — the time a patient spends typing — during which the
slot can't simply sit `AVAILABLE`, or someone else could take it mid-form.
`holdSlot` uses the same conditional-update pattern to flip a slot from
`AVAILABLE` to `HELD`, stamping `heldByPatientId` and a `holdExpiresAt` five
minutes out. `confirmAppointment` then requires the slot to still be `HELD`
*by that same patient* to flip it to `BOOKED`; if the hold lapsed, the
confirm fails cleanly and the patient is told to rebook.

Expiry is enforced in two places, deliberately redundant: at read time
(`holdSlot` and the slots-listing route treat a `HELD` row whose
`holdExpiresAt` has passed as available again, so no one has to wait on a
cron tick to see accurate availability) and by a `cleanup-holds` cron job
that actually releases the row back to `AVAILABLE` and cancels the
orphaned `PENDING_SYMPTOMS` appointment. Correctness never depends on the
cron having run recently — it exists purely so expired holds don't linger
indefinitely, not to prevent races.

## Doctor leave conflict handling

Marking a leave day is itself just an insert into `DoctorLeave` — it never
silently mutates history. The conflict-detection step queries every
`BOOKED` slot for that doctor within the leave date's UTC day range and
joins to its `Appointment`. Each conflicting appointment is cancelled
through the *same* `cancelAppointment`-equivalent logic used everywhere
else (status → `CANCELLED`, slot released, audit-logged) rather than a
separate, unaudited code path — deliberately, so leave-driven cancellations
can't drift from patient- or doctor-initiated ones. The slot itself is set
to `CANCELLED`, not `AVAILABLE`, so it's never silently re-offered for a day
the doctor is out. Each affected patient is emailed with up to three
alternative open slots for the same doctor, giving them a next action
instead of just bad news.

## Notification failure handling

Every notification — booking confirmation, cancellation, reschedule,
doctor-leave notice — is persisted as a `Notification` row *before* the send
is attempted, with status `PENDING`. A successful send flips it to `SENT`;
a failure flips it to `FAILED` and records the error, but the row survives
either way — this is what "maintain notification logs even if a send
fails" means concretely. A separate `retry-failed-emails` cron picks up
every `FAILED` row under a `MAX_ATTEMPTS` cap and retries it, so a
transient SMTP outage recovers on its own without a human resending
anything by hand. Crucially, none of this ever runs inside the booking
transaction, and none of it can throw back into the booking flow — a
`queueNotification` failure is caught and logged, never allowed to undo an
appointment that already committed.
