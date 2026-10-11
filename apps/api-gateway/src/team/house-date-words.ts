/*
 * The house's way of writing a calendar day, for the sentences the team pages
 * send (publish notice, note title, call-out, cover push, time-off answer).
 * Kept apart from ScheduleService because TeamService needs it too, and the
 * two services import each other's class.
 */

/** "2026-10-09" → "Fri 9 Oct", the date as the refusal says it. */
export function dayWords(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * A day as the house writes a date (F-1150): "05.10.2026" in a Turkish house,
 * "10/5/2026" in an American one — digits only, so every word stays English
 * (ADR 0207). With no locale known, the refusal's "Mon 5 Oct". Named for the
 * week's Monday it first printed; a shift's day and a time-off span use it too
 * (F-1229).
 */
export function weekWords(iso: string, locale: string | null): string {
  if (!locale) return dayWords(iso);
  try {
    return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(
      locale,
      {
        day: "numeric",
        month: "numeric",
        year: "numeric",
        timeZone: "UTC",
      },
    );
  } catch {
    return dayWords(iso);
  }
}
