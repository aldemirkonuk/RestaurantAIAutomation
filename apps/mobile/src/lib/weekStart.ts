/**
 * The Monday of the week the phone is in, as the Team domain keys a week
 * (`YYYY-MM-DD`).
 *
 * Read from the phone's own calendar date. It used to move the date to Monday
 * on the local calendar and then print it with `toISOString()`, which prints
 * the UTC date: in Turkey (UTC+3) between 00:00 and 03:00 on a Monday that is
 * still Sunday in UTC, so the phone asked for the week that had just ended and
 * the waiter saw last week's shifts. West of UTC, a Monday evening printed
 * Tuesday. The house's own time zone is not on the phone; the phone's clock is
 * the waiter's, who is at the house.
 */
export function weekStartOf(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return localDate(d);
}

/** A local calendar date as `YYYY-MM-DD`, never shifted through UTC. */
export function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
