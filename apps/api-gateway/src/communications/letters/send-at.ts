/**
 * Send at a house-clock time (r110 mail-gap g1).
 *
 * The writer picks a CHOICE ("in an hour", "tomorrow 08:00", "Monday 08:00"),
 * never an instant: the client's clock and zone are not the house's. The
 * server reads the choice as a wall time in the house's own zone first and
 * only then turns it into UTC, so "08:00" is 08:00 in the house on both sides
 * of a DST change. A wall time that does not exist (inside a spring-forward
 * gap) goes to the next minute that does.
 *
 * Pure: no database, no clock. `queue` reads the zone and the time and passes
 * them in.
 */
import { zonedWallClockToUtc } from "../../calendar/zoned-time";

export const SEND_AT_CHOICES = ["in_1h", "tomorrow_0800", "monday_0800"] as const;
export type SendAtChoice = (typeof SEND_AT_CHOICES)[number];

/** The latest a chosen time may be: 30 days from now. */
export const SEND_AT_MAX_MS = 30 * 86_400_000;

/** What the letter records (`email_headers.send_at_chosen`). */
export interface SendAtChosen {
  choice: SendAtChoice;
  /** The house's wall time it leaves at, `YYYY-MM-DD HH:mm`. */
  local: string;
  /** The IANA zone that wall time is read in. */
  zone: string;
}

export const SEND_AT_NO_ZONE =
  "This house's time zone isn't set, so a letter cannot be set to leave at a time on the house's clock. An owner or manager can set it in Settings, under Time zone. Nothing was queued and nothing was sent.";

const FORMATS = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  let f = FORMATS.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    FORMATS.set(zone, f);
  }
  return f;
}

/** The house's wall clock at an instant: `{ date: YYYY-MM-DD, time: HH:mm }`. */
export function houseWall(ms: number, zone: string): { date: string; time: string } {
  const parts = formatter(zone).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = String(Number(get("hour")) % 24).padStart(2, "0");
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${hour}:${get("minute")}` };
}

const key = (w: { date: string; time: string }) => `${w.date} ${w.time}`;

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The instant a house wall time names. Inside a spring-forward gap the wall
 * time does not exist; the answer is the first minute after the gap (02:30 on
 * a Berlin spring-forward morning leaves at 03:00, not 03:30).
 */
export function houseWallToInstant(date: string, time: string, zone: string): number {
  const want = `${date} ${time}`;
  let at = zonedWallClockToUtc(date, time, zone).getTime();
  if (key(houseWall(at, zone)) === want) return at;
  // A gap: land on a minute at or after the wanted one, then walk back to the
  // first such minute. Bounded: no zone's gap is longer than a day.
  for (let i = 0; i < 1440 && key(houseWall(at, zone)) < want; i += 1) at += 60_000;
  for (let i = 0; i < 1440 && key(houseWall(at - 60_000, zone)) >= want; i += 1) at -= 60_000;
  return at;
}

/** A choice read on the house's clock: the instant it leaves and what to record. */
export function houseClockSendAt(
  choice: SendAtChoice,
  nowMs: number,
  zone: string,
): { atMs: number; chosen: SendAtChosen } {
  const today = houseWall(nowMs, zone).date;
  let atMs: number;
  if (choice === "in_1h") {
    atMs = nowMs + 3_600_000;
  } else if (choice === "tomorrow_0800") {
    atMs = houseWallToInstant(addDays(today, 1), "08:00", zone);
  } else {
    // The next Monday after today, never today: "Monday" is a day ahead.
    const ahead = (1 - weekday(today) + 7) % 7 || 7;
    atMs = houseWallToInstant(addDays(today, ahead), "08:00", zone);
  }
  return { atMs, chosen: { choice, local: key(houseWall(atMs, zone)), zone } };
}

/** Why a chosen instant is out of bounds, or null when it is inside them. */
export function sendAtOutOfBounds(atMs: number, nowMs: number, undoMs: number | null): string | null {
  if (atMs < nowMs + (undoMs ?? 0)) {
    return "That time is sooner than the window to pull a letter back. Send it now instead. Nothing was queued and nothing was sent.";
  }
  if (atMs > nowMs + SEND_AT_MAX_MS) {
    return "A letter can be set to leave at most 30 days ahead. Nothing was queued and nothing was sent.";
  }
  return null;
}
