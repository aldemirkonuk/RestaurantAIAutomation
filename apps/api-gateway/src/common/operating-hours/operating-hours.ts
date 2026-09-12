/**
 * Operating hours: does the venue know when it is open, and is it open now?
 *
 * This is the TypeScript mirror of `scripts/simulate/hours.py` (ADR 0093 D1).
 * Both run `datasets/sim/fixtures/operating-hours-cases.json`, so the two cannot
 * drift silently — the same lockstep pattern `scripts/test_simulate.py` uses for
 * `WINE_WORDS`. Add cases to the fixture, never to one suite alone.
 *
 * Contract (`restaurants.operating_hours`)
 * ---------------------------------------
 *     {"mon": [{"open": "12:00", "close": "23:00"}], ..., "sun": []}
 *
 * - All seven keys are required. `[]` means closed that day. At most three
 *   ranges per day, non-overlapping, sorted by `open`.
 * - `close <= open` means the range crosses midnight into the next local day,
 *   and such a range must be the day's last.
 * - Times are local to `restaurants.timezone` (IANA). `close` is exclusive.
 * - `null` means the hours are unknown. Unknown is never coerced to closed —
 *   see `isOpenAt`, which answers `null` with a reason rather than `false`
 *   (ADR 0020).
 *
 * DST, by hand
 * ------------
 * The gateway has no timezone library (`apps/api-gateway/package.json` carries
 * neither luxon nor date-fns-tz, checked 2026-09-02), so wall-time → instant is
 * done with `Intl.DateTimeFormat`. The behaviour it must reproduce is Python's
 * `zoneinfo` at `fold=0`:
 *
 *   - an AMBIGUOUS wall time (the fall-back hour happens twice) resolves to its
 *     FIRST occurrence;
 *   - a NON-EXISTENT wall time (the spring-forward gap) resolves with the
 *     PRE-transition offset.
 *
 * `wallToInstant` below does that by probing the zone's offset a day either side
 * of the wall time, which brackets any single transition.
 *
 * A MEASURED DEVIATION FROM THE FIXTURE'S PROSE. The fixture's `_contract`
 * offers a shorter recipe — `c1 = guess - offsetAt(guess)`, `c2 = guess -
 * offsetAt(c1)`, take whichever round-trips, else `c1` — and says `zoneinfo`
 * with `fold=0` "behaves exactly this way". It does not, universally. Swept at
 * ten-minute resolution over all of 2026 against `zoneinfo` (2026-09-02):
 *
 *     America/Chicago, /New_York, /Los_Angeles, /Sao_Paulo,
 *     Europe/Istanbul, Asia/Tokyo, Asia/Tehran, UTC ..... 0 disagreements
 *     Europe/Berlin, Europe/London,
 *     Australia/Sydney, Pacific/Auckland ................ 12 each
 *
 * The recipe anchors on the offset at the wall time READ AS UTC, which lands
 * before the transition for a negative-offset zone and after it for a positive
 * one. So in a positive-offset zone it picks the SECOND occurrence of an
 * ambiguous time and the POST-transition offset in a gap — the opposite of
 * `fold=0` in both cases, for the two transition hours of the year. Every zone
 * this repo uses today is negative-offset or DST-free (35 America/Chicago, 12
 * America/New_York, 7 America/Los_Angeles, 3 Europe/Istanbul), which is why the
 * fixture — whose cases are Chicago, Istanbul and UTC — cannot see it. The
 * brief's binding requirement is "the semantics are the Python module's, line
 * for line", so this file implements those and the spec pins the divergence
 * with hard-coded `zoneinfo` answers. `scripts/simulate/hours.py` is correct as
 * written (it uses `zoneinfo` directly); it is the fixture's PROSE that
 * overstates the equivalence, and the fixture is not this builder's to edit.
 */

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/** Monday-first, matching Python's `date.weekday()`. */
export const WEEKDAYS: readonly Weekday[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;

export const MAX_RANGES_PER_DAY = 3;

export interface HourRange {
  open: string;
  close: string;
}

export type OperatingHours = Record<Weekday, HourRange[]>;

export type OpenReason =
  | "hours_unknown"
  | "hours_invalid"
  | "timezone_unknown"
  | "closed_day"
  | "outside_hours";

export interface ServiceWindow {
  start: Date;
  end: Date;
}

export interface OpenState {
  /** `null` is never a verdict — it always carries a `reason`. */
  open: boolean | null;
  reason?: OpenReason;
  window?: ServiceWindow;
}

/** The value is not a valid operating-hours object. `.errors` lists every fault. */
export class OperatingHoursError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join("; "));
    this.name = "OperatingHoursError";
    this.errors = errors;
    // ES2021 target with a class extending a built-in: restore the prototype so
    // `instanceof OperatingHoursError` holds after transpilation.
    Object.setPrototypeOf(this, OperatingHoursError.prototype);
  }
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/** `close <= open` — the range runs past midnight into the next local day. */
export function crossesMidnight(range: HourRange): boolean {
  return minutesOf(range.close) <= minutesOf(range.open);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate the JSON shape. Throws `OperatingHoursError` listing EVERY fault, not
 * the first — the PUT endpoint hands the whole list back so an editor can show
 * all of them at once.
 */
export function parseOperatingHours(raw: unknown): OperatingHours {
  const errors: string[] = [];
  if (!isPlainObject(raw)) {
    throw new OperatingHoursError([
      "operating_hours must be an object keyed mon..sun",
    ]);
  }
  const unknown = Object.keys(raw)
    .filter((k) => !(WEEKDAYS as readonly string[]).includes(k))
    .sort();
  if (unknown.length > 0) {
    errors.push(`unknown keys: ${unknown.join(", ")}`);
  }
  const missing = WEEKDAYS.filter((d) => !(d in raw));
  if (missing.length > 0) {
    errors.push(`missing keys: ${missing.join(", ")}`);
  }

  const out = {} as OperatingHours;
  for (const day of WEEKDAYS) {
    if (missing.includes(day)) continue;
    const rangesRaw = raw[day];
    if (!Array.isArray(rangesRaw)) {
      errors.push(`${day}: must be a list of ranges`);
      continue;
    }
    if (rangesRaw.length > MAX_RANGES_PER_DAY) {
      errors.push(`${day}: more than ${MAX_RANGES_PER_DAY} ranges`);
      continue;
    }
    const ranges: HourRange[] = [];
    for (let i = 0; i < rangesRaw.length; i++) {
      const r = rangesRaw[i];
      if (!isPlainObject(r) || !("open" in r) || !("close" in r)) {
        errors.push(`${day}[${i}]: a range is {open, close}`);
        continue;
      }
      const o = r.open;
      const c = r.close;
      if (!(typeof o === "string" && HHMM.test(o))) {
        errors.push(
          `${day}[${i}].open: not HH:MM (00:00–23:59): ${JSON.stringify(o)}`,
        );
        continue;
      }
      if (!(typeof c === "string" && HHMM.test(c))) {
        errors.push(
          `${day}[${i}].close: not HH:MM (00:00–23:59): ${JSON.stringify(c)}`,
        );
        continue;
      }
      if (o === c) {
        errors.push(`${day}[${i}]: open equals close`);
        continue;
      }
      ranges.push({ open: o, close: c });
    }
    // Ordering and overlap, only over the ranges that parsed.
    for (let i = 1; i < ranges.length; i++) {
      const prev = ranges[i - 1];
      const cur = ranges[i];
      if (crossesMidnight(prev)) {
        errors.push(
          `${day}: a range crossing midnight must be the last of the day`,
        );
        break;
      }
      if (minutesOf(cur.open) < minutesOf(prev.close)) {
        errors.push(
          `${day}: ranges overlap or are unsorted (${prev.open}-${prev.close} then ${cur.open}-${cur.close})`,
        );
        break;
      }
    }
    out[day] = ranges;
  }

  if (errors.length > 0) throw new OperatingHoursError(errors);
  return out;
}

/** The inverse of parse — the shape stored on `restaurants.operating_hours`. */
export function toJson(hours: OperatingHours): Record<Weekday, HourRange[]> {
  const out = {} as Record<Weekday, HourRange[]>;
  for (const day of WEEKDAYS) {
    out[day] = (hours[day] ?? []).map((r) => ({
      open: r.open,
      close: r.close,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Timezone arithmetic. No dependency; `Intl` is the only tz database available.
// ---------------------------------------------------------------------------

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/** Throws `RangeError` for an unknown IANA zone — that is the detection. */
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = FORMATTERS.get(timeZone);
  if (cached) return cached;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  FORMATTERS.set(timeZone, fmt);
  return fmt;
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallPartsAt(timeZone: string, instant: Date): WallParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: string): number => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : 0;
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Milliseconds the zone is ahead of UTC at `instant`. */
function offsetMsAt(timeZone: string, instant: Date): number {
  const p = wallPartsAt(timeZone, instant);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUtc - instant.getTime();
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A local wall time to the instant it names — `zoneinfo` with `fold=0`.
 *
 * The two probes are a day either side of the wall time, which brackets any one
 * transition, so `offBefore` is always the pre-transition offset and `offAfter`
 * the post-transition one. Anchoring on the wall time read as UTC instead (the
 * fixture's shorter recipe) picks the wrong side of the transition in any
 * positive-offset zone — see the module docstring for the sweep that measured it.
 */
export function wallToInstant(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const offBefore = offsetMsAt(timeZone, new Date(guess - ONE_DAY_MS));
  const offAfter = offsetMsAt(timeZone, new Date(guess + ONE_DAY_MS));
  const t1 = guess - offBefore; // with the pre-transition offset
  const t2 = guess - offAfter; //  with the post-transition offset
  const roundTrips = (ms: number): boolean => {
    const p = wallPartsAt(timeZone, new Date(ms));
    return (
      p.year === year &&
      p.month === month &&
      p.day === day &&
      p.hour === hour &&
      p.minute === minute
    );
  };
  const ok1 = roundTrips(t1);
  const ok2 = roundTrips(t2);
  // Ambiguous: the wall time happens twice. fold=0 is the FIRST occurrence,
  // which is always the earlier instant whichever way the offset moved.
  if (ok1 && ok2) return new Date(Math.min(t1, t2));
  if (ok1) return new Date(t1);
  if (ok2) return new Date(t2);
  // The wall time does not exist — a spring-forward gap. fold=0 uses the
  // PRE-transition offset, so t1, never t2.
  return new Date(t1);
}

function assertZone(timezone: string | null | undefined): string {
  if (typeof timezone !== "string" || timezone.length === 0) {
    throw new RangeError("timezone_unknown");
  }
  try {
    formatterFor(timezone);
  } catch {
    throw new RangeError("timezone_unknown");
  }
  return timezone;
}

function zoneOrNull(timezone: string | null | undefined): string | null {
  try {
    return assertZone(timezone);
  } catch {
    return null;
  }
}

function parseLocalDate(localDate: string): {
  year: number;
  month: number;
  day: number;
} {
  const m = typeof localDate === "string" ? YMD.exec(localDate) : null;
  if (!m) throw new RangeError(`localDate must be YYYY-MM-DD: ${localDate}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // Round-trip through Date.UTC so 2026-02-30 is rejected rather than rolled.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    throw new RangeError(`localDate is not a real date: ${localDate}`);
  }
  return { year, month, day };
}

/** Monday-first index, matching Python's `date.weekday()`. */
function weekdayOf(year: number, month: number, day: number): Weekday {
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // Sun = 0
  return WEEKDAYS[(jsDay + 6) % 7];
}

function addDays(
  d: { year: number; month: number; day: number },
  delta: number,
): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(d.year, d.month - 1, d.day + delta));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

// ---------------------------------------------------------------------------
// The two answers
// ---------------------------------------------------------------------------

/**
 * UTC `[start, end)` windows whose OPEN falls on `localDate` in the venue's zone.
 *
 * Throws `OperatingHoursError` on an invalid or unknown shape and `RangeError`
 * on an unknown timezone — callers that want a soft answer use `isOpenAt`.
 */
export function serviceWindows(
  hours: OperatingHours | unknown,
  timezone: string,
  localDate: string,
): ServiceWindow[] {
  if (hours === null || hours === undefined) {
    throw new OperatingHoursError(["hours_unknown"]);
  }
  const parsed = parseOperatingHours(hours);
  const zone = assertZone(timezone);
  const date = parseLocalDate(localDate);
  const dayKey = weekdayOf(date.year, date.month, date.day);

  const windows: ServiceWindow[] = [];
  for (const r of parsed[dayKey] ?? []) {
    const [oh, om] = r.open.split(":").map(Number);
    const [ch, cm] = r.close.split(":").map(Number);
    const start = wallToInstant(zone, date.year, date.month, date.day, oh, om);
    const endDate = crossesMidnight(r) ? addDays(date, 1) : date;
    const end = wallToInstant(
      zone,
      endDate.year,
      endDate.month,
      endDate.day,
      ch,
      cm,
    );
    windows.push({ start, end });
  }
  windows.sort((a, b) => a.start.getTime() - b.start.getTime());
  return windows;
}

/**
 * Open, closed, or unknown at `instant`.
 *
 * `open: null` is returned — never `false` — when the hours or the timezone are
 * not known or not parseable. Reasons: `hours_unknown`, `hours_invalid`,
 * `timezone_unknown`, `closed_day` (no range opens on that local day and none
 * from the previous day reaches it), `outside_hours`.
 */
export function isOpenAt(
  hours: unknown,
  timezone: string | null | undefined,
  instant: Date,
): OpenState {
  if (hours === null || hours === undefined) {
    return { open: null, reason: "hours_unknown" };
  }
  let parsed: OperatingHours;
  try {
    parsed = parseOperatingHours(hours);
  } catch {
    return { open: null, reason: "hours_invalid" };
  }
  const zone = zoneOrNull(timezone);
  if (zone === null) return { open: null, reason: "timezone_unknown" };

  const local = wallPartsAt(zone, instant);
  const localDate = { year: local.year, month: local.month, day: local.day };
  const iso = (d: { year: number; month: number; day: number }): string =>
    `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

  // A window from the PREVIOUS local day may run past midnight into this one.
  const candidates = [
    ...serviceWindows(parsed, zone, iso(addDays(localDate, -1))),
    ...serviceWindows(parsed, zone, iso(localDate)),
  ];
  const t = instant.getTime();
  for (const w of candidates) {
    if (w.start.getTime() <= t && t < w.end.getTime()) {
      return { open: true, window: w };
    }
  }
  const dayKey = weekdayOf(localDate.year, localDate.month, localDate.day);
  if ((parsed[dayKey] ?? []).length === 0) {
    return { open: false, reason: "closed_day" };
  }
  return { open: false, reason: "outside_hours" };
}
