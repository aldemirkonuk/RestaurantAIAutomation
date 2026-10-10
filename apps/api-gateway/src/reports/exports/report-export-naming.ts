/**
 * The two places an export says WHEN: its file name, and its "Written" line.
 *
 * Both used to be raw UTC (F-413, wave-9 sim): the name was
 * `mudavym-<cutting>-<finished_at UTC date>` with no house and no window, so a
 * Los Angeles house writing at 18:00 got tomorrow's date and a 7-day and a
 * 90-day till export written the same day saved as "(1)". "Written" was an ISO
 * instant while every day inside the file is a house day (ADR 0296) — two
 * clocks in one file, neither labelled.
 *
 * Now both are on the house's clock. A house with no zone gets UTC, and the
 * file says it is UTC rather than passing it off as the house's day.
 *
 * Pure: no I/O, no clock. The zone is the one `readHouseZone` / `houseFrame`
 * resolved; the instant is the row's own `finished_at`.
 */
import { houseDayOf, shiftHouseDay } from "../../common/house-day";

const STAMP = new Map<string, Intl.DateTimeFormat>();

function stampFormatter(zone: string): Intl.DateTimeFormat {
  let f = STAMP.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    STAMP.set(zone, f);
  }
  return f;
}

/** `YYYY-MM-DD HH:MM` on `zone`'s wall clock. */
function wallClock(instant: Date, zone: string): string {
  const p: Record<string, string> = {};
  for (const part of stampFormatter(zone).formatToParts(instant))
    p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/**
 * The "Written" line: the instant on the house's clock, with the zone named.
 * A house with no zone is told it is reading UTC, never shown UTC as its own.
 */
export function writtenLabel(writtenAt: string, zone: string | null): string {
  const t = new Date(writtenAt);
  if (Number.isNaN(t.getTime())) return writtenAt;
  if (zone) return `${wallClock(t, zone)}, house time (${zone})`;
  return `${wallClock(t, "UTC")} UTC; this house has no time zone set, so this is not its own clock`;
}

/** The house's name as a file-name word: plain ASCII, lower case, hyphens. */
export function houseSlug(name: string | null | undefined): string {
  const slug = (name ?? "")
    // Turkish dotless i has no decomposition; everything else NFKD strips.
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "house";
}

export interface ExportNameInput {
  cutting: string;
  /** The till's day window; null for every cutting whose window the server fixes. */
  windowDays: number | null;
  /** When the file was written; null while it is still queued. */
  finishedAt: string | null;
  houseName: string | null;
  /** The house's resolved IANA zone, or null when it has none. */
  zone: string | null;
}

/**
 * The file name without its extension, or null while nothing is written.
 *
 * - till: `mudavym-<house>-till-<first day>-to-<last day>` — the window in
 *   house days, the same span `getPosRevenueWindow` reads (today included).
 * - every other cutting: `mudavym-<house>-<cutting>-as-of-<house day>` — its
 *   window is fixed and ends the day it was written.
 * - a house with no zone: the span asked for and the UTC day, marked `-utc`.
 *
 * The days come from `finished_at`. The till read happens moments before; an
 * export whose render straddles the house's midnight is named for the later
 * day. That is the one place the name and the file can disagree by a day.
 */
export function exportFileStem(input: ExportNameInput): string | null {
  if (!input.finishedAt) return null;
  const house = houseSlug(input.houseName);
  const day = input.zone
    ? houseDayOf(input.finishedAt, input.zone)
    : houseDayOf(input.finishedAt, "UTC");
  if (!day) return null;
  const till =
    input.cutting === "till" &&
    input.windowDays != null &&
    input.windowDays >= 1;
  if (!input.zone) {
    // No house days to name: the till read nothing (ADR 0296), so the name
    // carries the span asked for and the UTC day, marked as UTC.
    const span = till ? `-${input.windowDays}-days` : "";
    return `mudavym-${house}-${input.cutting}${span}-as-of-${day}-utc`;
  }
  if (till) {
    const from = shiftHouseDay(day, -((input.windowDays as number) - 1));
    return `mudavym-${house}-till-${from}-to-${day}`;
  }
  return `mudavym-${house}-${input.cutting}-as-of-${day}`;
}
