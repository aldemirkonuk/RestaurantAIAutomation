/**
 * Event-prep reminder — the part that decides *whether* the job runs at all,
 * kept pure so it can be tested without NestJS DI, a database, or a mail
 * client.
 *
 * WHY THIS JOB IS OFF BY DEFAULT (F-154, 2026-10-02)
 * --------------------------------------------------
 * `event-prep-check` (08:00 America/New_York, every day) read every
 * `calendar_events` row dated two days out for each house the scheduler
 * serves, and sent one "event prep" email per row to the managers and staff who
 * take calendar reminders, through the shared Gmail sender every house's mail
 * goes out on. It had no arming flag, no `event_type` filter and no per-run
 * cap. A delivery is a calendar row, so a house with N deliveries due in two
 * days got N "Upcoming Event" mails.
 *
 * The owner-quarter sim house (Tuzlu Rüzgar) holds roughly 500 delivery rows
 * dated 2026-10-09. It is NOT served today — it has no
 * `scheduled_communications` row in `restaurant_feature_flags` (ADR 0022) — so
 * the 2026-10-07 run cannot reach it. Adding that one row would have meant
 * ~500 sends in one run, from the sender that ~500 purchase-order letters had
 * already pushed into Gmail's user-rate limit on 2026-10-02, taking every
 * house's verification, invite and reset mail down with it (F-136).
 *
 * Which entry types count as an event, how many mails one run may send, and
 * who receives them are open founder questions. They are settled before this
 * is armed, not defaulted here. See the 2026-10-02 amendment to ADR 0131.
 */

/**
 * The single env var that arms the event-prep reminder.
 *
 * Off by default and deliberately not wired to any other flag: there is no
 * combination of existing settings that turns this on as a side effect.
 */
export const EVENT_PREP_REMINDER_FLAG = "EVENT_PREP_REMINDERS_ENABLED";

/**
 * Is the event-prep reminder armed?
 *
 * The same allow-list as `RECURRING_ORDER_REMINDERS_ENABLED`
 * (`recurring-order-reminder.ts`) and `CALENDAR_REMINDERS_ENABLED`
 * (`calendar/reminder-window.ts`): only `"true"` and `"1"` — trimmed and
 * lower-cased, so `" TRUE "` also arms it — return true. Everything else reads
 * as OFF: unset, `""`, `"yes"`, `"on"`, `"enabled"`, `"false"`, a typo, or a
 * non-string.
 *
 * An allow-list turns every typo into silence; a deny-list would turn every
 * typo into a live mailer. Silence is the recoverable failure here.
 */
export function eventPrepRemindersEnabled(raw?: string | null): boolean {
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1";
}
