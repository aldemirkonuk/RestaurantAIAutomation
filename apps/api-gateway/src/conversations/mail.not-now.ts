/**
 * "Not now" (r110 mail, DD-r109-13): when a thread the house put off comes back.
 *
 * Worked out on the house's own clock, never UTC. "Tomorrow 09:00" is 09:00 on
 * the wall of the house the day after its today, whatever the clocks did in
 * between: on 2026-11-01 New York leaves summer time, so from Saturday noon it
 * is 14:00Z, not the 13:00Z that "now plus a day at today's offset" would say.
 */

export type NotNowChoice = "in_3_hours" | "tomorrow_9" | "monday_9";

export const NOT_NOW_CHOICES: readonly NotNowChoice[] = [
  "in_3_hours",
  "tomorrow_9",
  "monday_9",
];

export function isNotNowChoice(v: unknown): v is NotNowChoice {
  return typeof v === "string" && (NOT_NOW_CHOICES as readonly string[]).includes(v);
}

/** Whether a choice is a time on the house's wall (it needs the house's zone). */
export function needsHouseClock(choice: NotNowChoice): boolean {
  return choice !== "in_3_hours";
}

const PARTS = new Map<string, Intl.DateTimeFormat>();

function partsIn(zone: string, ms: number) {
  let f = PARTS.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    PARTS.set(zone, f);
  }
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(ms))) {
    if (x.type !== "literal") p[x.type] = Number(x.value);
  }
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** The zone's offset from UTC at an instant, in ms (wall minus UTC). */
function offsetAt(zone: string, ms: number): number {
  const p = partsIn(zone, ms);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant a wall time names in a zone. The offset is read at the answer,
 * not at "now": guess with the offset at the wall time read as UTC, then once
 * more at that guess, so a change of the clocks between now and then is kept.
 */
function wallToInstant(zone: string, y: number, m: number, d: number, hh: number): number {
  const asUtc = Date.UTC(y, m - 1, d, hh, 0, 0);
  const first = asUtc - offsetAt(zone, asUtc);
  return asUtc - offsetAt(zone, first);
}

/**
 * When a thread put off now comes back. `zone` is the house's IANA zone; it may
 * be null only for "in 3 hours", which is elapsed time and needs no clock.
 * Returns an ISO instant, or null when the choice needs a clock the house lacks.
 */
export function notNowUntil(
  choice: NotNowChoice,
  nowMs: number,
  zone: string | null,
): string | null {
  if (choice === "in_3_hours") return new Date(nowMs + 3 * 3_600_000).toISOString();
  if (!zone) return null;
  const today = partsIn(zone, nowMs);
  // The house's today as a calendar day; days are added on the calendar.
  const day = new Date(Date.UTC(today.year, today.month - 1, today.day));
  const weekday = day.getUTCDay(); // 0 Sunday .. 6 Saturday
  // "Monday" is the next Monday strictly after today: from a Monday, a week on.
  const ahead = choice === "tomorrow_9" ? 1 : (1 - weekday + 7) % 7 || 7;
  day.setUTCDate(day.getUTCDate() + ahead);
  return new Date(
    wallToInstant(zone, day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 9),
  ).toISOString();
}
