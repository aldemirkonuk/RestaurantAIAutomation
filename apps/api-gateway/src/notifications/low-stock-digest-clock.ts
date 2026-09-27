/**
 * LOW-STOCK DIGEST CLOCK
 * -----------------------
 * Pure functions that decide WHEN the hourly low-stock digest sweep
 * (`low-stock-alerts.service.ts`) should fire for one house, and WHAT zone a
 * house's clock runs on.
 *
 * No Nest, no database, no clock of its own — every function here takes the
 * instant and the house's stored fields as arguments, so it is exercised the
 * same way in a unit test as it runs in production (item 56 / ADR 0149).
 */

/**
 * ADR 0116:297-301 locked the rule for a house whose zone this server cannot
 * read: fall back to UTC and SAY SO on the page — never invent a zone. The
 * recommendation digest, the calendar reminders and the notification
 * producers already follow it; this is the third consumer (item 56, founder
 * fork F1, 2026-09-27 — "UTC, said on the page (Recommended)").
 *
 * Founder fork F1 is decided as of 2026-09-27 for this constant: UTC. If a
 * later founder ruling changes the fallback zone, only this constant and the
 * /notifications copy need to change — the sweep logic below does not name a
 * zone anywhere else.
 *
 * A CLAIMS row (ADR-0149-LOW-STOCK-DIGEST-FOLLOWS-THE-HOUSE-CLOCK) forbids
 * the literal "America/New_York" anywhere in the sweep service, so that zone
 * is spelled out in comments in words only ("New York"), never as the IANA
 * identifier, so a grep for the identifier stays a true negative.
 */
export const LOW_STOCK_DIGEST_FALLBACK_ZONE = "UTC";

/** Where a house's digest clock comes from. */
export type DigestClockSource = "house" | "country" | "fallback";

export interface DigestClock {
  /** An IANA zone name this Node build can resolve. */
  zone: string;
  source: DigestClockSource;
  /**
   * The raw value read from the house's own timezone column, kept for
   * logging even when it could not be used (null/blank/unresolvable).
   */
  recorded: string | null;
}

/**
 * `resolveZone` duplicated here rather than imported, because
 * `calendar/zoned-time.ts` has no barrel and this keeps the two pure modules
 * decoupled — the DST-resolution direction bug noted in that file
 * (candidate OD, not filed here) does not apply to this function: it only
 * validates the string, it never resolves a wall time to an instant.
 */
function resolveZone(zone: string | null | undefined): string | null {
  const name = typeof zone === "string" ? zone.trim() : "";
  if (!name) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name }).format(new Date(0));
    return name;
  } catch {
    return null;
  }
}

/**
 * The clock a house's low-stock digest should run on.
 *
 * House zone first. #435's `common/house-frame.ts` (country → zone, only
 * when that country keeps exactly one) is NOT wired in here: as of this
 * lane, #435 is still open on `origin/main` (checked via `gh pr view 435`),
 * so this lane does not copy that file. A Turkish house with no zone set
 * falls back to UTC instead of Europe/Istanbul until a follow-up wires the
 * country step in once #435 merges (see the PR body).
 */
export function digestClockFor(
  house:
    | { timezone?: string | null; country?: string | null }
    | null
    | undefined,
): DigestClock {
  const raw =
    house && typeof house.timezone === "string" ? house.timezone : null;
  const zone = resolveZone(house?.timezone);
  if (zone) return { zone, source: "house", recorded: raw };
  return {
    zone: LOW_STOCK_DIGEST_FALLBACK_ZONE,
    source: "fallback",
    recorded: raw,
  };
}

/** Rounds an instant to the nearest UTC hour, absorbing cron jitter of ±30 minutes. */
export function hourTick(at: Date): Date {
  return new Date(Math.round(at.getTime() / 3_600_000) * 3_600_000);
}

export interface WallReading {
  /** `YYYY-MM-DD` in `zone`. */
  dateKey: string;
  /** Minutes since local midnight in `zone` (0-1439). */
  minutes: number;
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    FORMATTERS.set(zone, f);
  }
  return f;
}

/** The house-local wall-clock date and minute-of-day at `instant`, in `zone`. */
export function houseWallAt(instant: Date, zone: string): WallReading {
  const parts = formatterFor(zone).formatToParts(instant);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const dateKey = `${get("year")}-${get("month")}-${get("day")}`;
  // hourCycle h23 still renders midnight as "24" on some ICU builds.
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return { dateKey, minutes: hour * 60 + minute };
}

function cmp(a: WallReading, b: WallReading): number {
  if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? -1 : 1;
  return a.minutes - b.minutes;
}

/**
 * Same rule as `isDigestTick`, but taking two already-computed wall
 * readings instead of an instant + zone. Exists so a caller that reads many
 * hours off the SAME pair of ticks (the digest sweep checks every
 * restaurant's own hour against one tick; the full-year property test in
 * `low-stock-digest-clock.spec.ts` checks all 24 hours against one tick) can
 * compute `houseWallAt` once per tick per zone and reuse it, rather than
 * re-running `Intl.DateTimeFormat` for every hour it tests.
 */
export function isDigestTickFromReadings(
  cur: WallReading,
  prev: WallReading,
  hour: number,
): boolean {
  const h = ((hour % 24) + 24) % 24;
  const target: WallReading = { dateKey: cur.dateKey, minutes: h * 60 };
  return cmp(cur, target) >= 0 && cmp(prev, target) < 0;
}

/**
 * True exactly on the one hourly tick that first reaches (or passes) `hour`
 * on the house's own local date.
 *
 * Ticks arrive every 60 minutes on the UTC hour, and every real UTC
 * fall-back offset change is 60 minutes or less, so the sequence of local
 * (date, minute) readings at consecutive ticks never goes backward, and it
 * crosses each (date, hour:00) target exactly once:
 *   - Spring-forward: the crossing tick is the first one after the gap (no
 *     day is skipped — NY's local hour 2 on 2026-03-08 simply arrives at the
 *     07:00Z tick, already past 03:00 local).
 *   - Fall-back: the repeated local hour does not cross the target again, so
 *     there is no double send.
 *   - Half-hour / 45-minute zones (India, Nepal, parts of Australia,
 *     Chatham) fire at the next top of the UTC hour after the target — e.g.
 *     Kolkata 12:30 for hour 12 — because the sweep stays hourly.
 */
export function isDigestTick(tick: Date, zone: string, hour: number): boolean {
  const cur = houseWallAt(tick, zone);
  const prev = houseWallAt(new Date(tick.getTime() - 3_600_000), zone);
  return isDigestTickFromReadings(cur, prev, hour);
}

/**
 * Parses a `notification_preferences.digest_time`-shaped string ("HH:MM")
 * into an hour 0-23.
 *
 * `null`/`""` gives 12 — this is NOT a new default, it is the existing
 * fallback already applied at the two call sites in
 * `getEffectiveLowStockPrefs` ("12:00"). Anything unreadable ("24:00",
 * "abc") gives `null`, so the caller can skip the house and warn instead of
 * silently doing nothing the way `parseInt` (which returns `NaN` and never
 * matched an hour) did before.
 */
export function digestHourOf(t: string | null | undefined): number | null {
  if (t === null || t === undefined || t === "") return 12;
  const m = /^(\d{1,2}):\d{2}$/.exec(t.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return hour;
}
