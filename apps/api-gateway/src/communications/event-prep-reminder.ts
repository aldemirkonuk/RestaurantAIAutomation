/**
 * Event-prep reminder — the part that decides *whether* the job runs at all,
 * kept pure so it can be tested without NestJS DI, a database, or a mail
 * client.
 *
 * WHY THIS JOB IS OFF BY DEFAULT (ADR 0264)
 * ----------------------------------------
 * Armed, `event-prep-check` (08:00 America/New_York, every day) reads every
 * `calendar_events` row dated two days out for each house the scheduler
 * serves, and sends one "event prep" email per row to the managers and staff
 * who take calendar reminders, through the shared Gmail sender every house's
 * mail goes out on. It has no `event_type` filter and no per-run cap. A
 * delivery is a calendar row (procurement writes one per order, titled
 * `Delivery: <order number>`), so a house with N deliveries due in two days
 * gets N "Event Prep - Delivery: ..." mails.
 *
 * A house is served when it is `DEFAULT_RESTAURANT_ID` or has an enabled
 * `scheduled_communications` row in `restaurant_feature_flags` (ADR 0022). One
 * such row on a house holding hundreds of deliveries for one day means hundreds
 * of sends in one run, from the one sender whose rate limit, once hit, stops
 * every house's verification, invite and reset mail with it.
 *
 * Which entry types count as an event, how many mails one run may send, who
 * receives them, and when this job moves off the shared sender are open
 * founder questions. They are settled before this is armed, not defaulted
 * here. ADR 0264 records them, the default house's loss of the job while it
 * is off, and the one variable that arms it.
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
