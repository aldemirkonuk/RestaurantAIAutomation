/**
 * A sale belongs to the house's day — ADR 0296.
 *
 * THE RULE, IN ONE PLACE
 * ----------------------
 * The founder, 2026-10-04, asked where a house's business day ends:
 * *"Midnight, by close (Recommended)"*. So a check is filed on the date its
 * house's own clock read when it CLOSED, else when it opened, and the day ends
 * at midnight on that clock. `houseDayOf` holds the rule; a reader that files a
 * check on a day calls it and nothing else, so a later change (a 04:00
 * close-out, the house's service windows) is a change to this file.
 *
 * Until this file, every POS reader cut the day on the UTC prefix of a
 * timestamp (`(closed_at || opened_at).substring(0, 10)`). For a house in Los
 * Angeles that files every dinner after 17:00 on the next day: Tuzlu Rüzgar's
 * opening day read 9 checks and $1,636.50 against the 52 and $10,945 it took,
 * and the Wednesday it was shut read the Tuesday's dinner (F-086).
 *
 * THE ZONE: the house's own, else its country's only zone (ADR 0207 question 6,
 * `house-frame.ts`), else NONE. Never UTC: the founder's 2026-09-03 call that
 * an unset value reads as unknown (ADR 0116) and DASH-G2 rule it out, so a
 * caller holding no zone states figures as unknown and says why
 * (`HOUSE_ZONE_UNSET`). A failed read of the house record throws; it is never
 * folded into "no zone", which would make a database fault read as a settings
 * gap.
 *
 * A WINDOW is a range of house dates `[from, to]`, both inclusive.
 * `houseDayBounds` turns it into instants: the read takes rows from
 * `HOUSE_DAY_LOOKBACK_MS` before the first midnight (a check opened the night
 * before and closed after midnight is filed on `from`, so it must be read) up
 * to the midnight that ends `to`, and the fold then drops every row whose house
 * day falls outside the range — so one day's figure no longer changes with the
 * window it is read in (A-027: Aug 23 read $26,564.91 at 43 days and $22,363.81
 * at 42). A check opened more than 24 h before the window and closed inside it
 * is missed; ADR 0296 says so, as ADR 0290 does for the dashboard month.
 *
 * Pure apart from `readHouseZone`, which reads one row by primary key.
 */

import { houseFrame, type ZoneSource } from "./house-frame";
import {
  localMidnight,
  shiftLocalDate,
} from "../notifications/producers/service-day";

/** How far before the window's first midnight a check's open is read. */
export const HOUSE_DAY_LOOKBACK_MS = 24 * 3_600_000;

/**
 * The one sentence for a house with no zone. Gateway copy; the web page that
 * links to Settings says the same thing in its own file.
 */
export const HOUSE_ZONE_UNSET =
  "This house's time zone isn't set, so no sale can be filed on the house's day yet. An owner or manager can set it in Settings, under Time zone.";

export interface HouseZone {
  /** The IANA zone the house's days are read in; null when none is known. */
  zone: string | null;
  source: ZoneSource;
}

/** The subset of a Supabase client this file uses. */
interface ZoneReadClient {
  from: (table: string) => any;
}

/**
 * The house's zone, from its own row (by primary key).
 *
 * A read error THROWS. A missing row and a row with no usable zone both answer
 * `{ zone: null }` — the caller then states its figures as unknown — because
 * neither is a fault of the read.
 */
export async function readHouseZone(
  client: ZoneReadClient,
  restaurantId: string,
): Promise<HouseZone> {
  const { data, error } = await client
    .from("restaurants")
    .select("timezone, country")
    .eq("id", restaurantId)
    .maybeSingle();
  if (error)
    throw new Error(
      `The house's time zone could not be read: ${error.message ?? String(error)}`,
    );
  const frame = houseFrame(
    (data ?? null) as { timezone?: string | null; country?: string | null },
  );
  return { zone: frame.zone, source: frame.zoneSource };
}

/**
 * One formatter per zone. Building an `Intl.DateTimeFormat` costs about 50 µs
 * and formatting with a built one about 1 µs (measured in this Node build,
 * 2026-10-04); a 365-day till folds tens of thousands of checks, so the
 * formatter is built once per zone, not once per row.
 */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(zone);
  if (!f) {
    // en-CA renders YYYY-MM-DD — the same choice `service-day.ts`
    // `localDateIn` makes, so the two can never file one instant differently.
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    FORMATTERS.set(zone, f);
  }
  return f;
}

/**
 * The house date (`YYYY-MM-DD`) an instant falls on, or null when the instant
 * is missing or does not parse. Throws `RangeError` for a zone this runtime
 * does not know — `readHouseZone` only ever hands out zones it resolved.
 */
export function houseDayOf(
  instant: string | Date | null | undefined,
  zone: string,
): string | null {
  if (instant === null || instant === undefined || instant === "") return null;
  const t = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(t.getTime())) return null;
  return formatterFor(zone).format(t);
}

/**
 * The instant a check is filed by: when it closed, else when it opened
 * (founder, 2026-10-04: "Midnight, by close").
 */
export function checkInstant(row: {
  closed_at?: string | null;
  opened_at?: string | null;
}): string | null {
  return row.closed_at || row.opened_at || null;
}

/** The house day a check is filed on, or null when it carries no usable time. */
export function houseDayOfCheck(
  row: { closed_at?: string | null; opened_at?: string | null },
  zone: string,
): string | null {
  return houseDayOf(checkInstant(row), zone);
}

/** Today on the house's clock. */
export function houseToday(zone: string, now: Date = new Date()): string {
  return formatterFor(zone).format(now);
}

/** A house date moved by whole days, calendar-safe (no clock involved). */
export function shiftHouseDay(day: string, days: number): string {
  return shiftLocalDate(day, days);
}

export interface HouseDayBounds {
  /** Where a read keyed on a check's OPEN starts: `startIso` less the lookback. */
  readFromIso: string;
  /** The midnight that opens `from`, on the house's clock. */
  startIso: string;
  /** The midnight that ends `to` (exclusive), on the house's clock. */
  endIso: string;
}

/**
 * The instants bounding house dates `[from, to]`. DST-correct: a 23-hour or
 * 25-hour day is bounded by its own two midnights (`service-day.ts`
 * `localMidnight`, two-pass).
 */
export function houseDayBounds(
  from: string,
  to: string,
  zone: string,
): HouseDayBounds {
  const start = localMidnight(from, zone).getTime();
  const end = localMidnight(shiftLocalDate(to, 1), zone).getTime();
  return {
    readFromIso: new Date(start - HOUSE_DAY_LOOKBACK_MS).toISOString(),
    startIso: new Date(start).toISOString(),
    endIso: new Date(end).toISOString(),
  };
}
