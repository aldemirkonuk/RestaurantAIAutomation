/**
 * Wall-clock → instant, in the restaurant's own zone.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `calendar_events` stores a *wall clock*: `start_date date` + `start_time time`
 * with no zone attached. Until 2026-09-03 the iCal feed turned that pair into an
 * instant with `new Date('2026-08-03T09:00:00')`, which JavaScript resolves on
 * **the process's** clock. On Railway the gateway runs in UTC, so a 09:00
 * delivery in Palo Alto was published as 09:00Z — 02:00 local — and every
 * subscriber saw the whole book shifted by the server's offset. That was one of
 * the four suspects filed against "nobody has ever seen the iCal feed
 * subscribe" (calendar.md §9, ADR 0111 §5).
 *
 * There is no zone-aware date library in this gateway's dependencies (no luxon,
 * no date-fns-tz — `apps/api-gateway/package.json`), and adding one to convert
 * two integers is the wrong trade. `Intl.DateTimeFormat` already carries the
 * full IANA database in Node and is the supported way to ask "what was the
 * offset of this zone at this instant".
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not invent a zone. `resolveZone` returns null for a missing or
 * unrecognised IANA name, and the caller then publishes the event as RFC 5545
 * *floating* local time — "09:00 wherever the reader is" — which is the honest
 * rendering of a wall clock whose zone we do not know. Publishing it as UTC
 * would be a claim about a fact we do not have.
 */

/**
 * True when `zone` is an IANA name this Node build can resolve.
 *
 * `Intl.DateTimeFormat` throws `RangeError` on an unknown identifier, so this
 * is the only reliable test; there is no lookup table to consult.
 */
export function resolveZone(zone: string | null | undefined): string | null {
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
 * The offset of `timeZone` at `instant`, in milliseconds east of UTC.
 *
 * Computed by formatting the instant *in* the zone and reading the calendar
 * fields back: the difference between those fields read as UTC and the instant
 * itself is the offset. This is exact for every zone and every DST rule the
 * platform knows, including the half-hour and 45-minute ones.
 */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const field = (type: string): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };

  // `hour12: false` still renders midnight as "24" on some ICU versions.
  const hour = field("hour") % 24;

  const asIfUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    hour,
    field("minute"),
    field("second"),
  );

  return asIfUtc - instant.getTime();
}

/**
 * `YYYY-MM-DD` + `HH:mm` read in `timeZone` → the instant it names.
 *
 * Two passes, and the second one is not decoration: the offset depends on the
 * instant, and the instant depends on the offset. The first pass guesses with
 * the offset in force at the naive UTC reading; the second re-reads the offset
 * at the candidate instant, which is what makes a 01:30 on a spring-forward
 * Sunday land correctly instead of an hour out.
 *
 * A wall clock inside a DST gap (02:30 on a spring-forward morning, a time that
 * does not exist) resolves forward into the new offset rather than throwing —
 * the same choice `Temporal`'s `'compatible'` disambiguation makes.
 */
export function zonedWallClockToUtc(
  dateStr: string,
  timeStr: string | null | undefined,
  timeZone: string,
): Date {
  const [y, m, d] = dateStr.split("-").map((n) => Number(n));
  const [hh, mm] = String(timeStr || "00:00")
    .split(":")
    .map((n) => Number(n));

  const naiveUtc = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);

  let offset = zoneOffsetMs(new Date(naiveUtc), timeZone);
  let candidate = naiveUtc - offset;
  offset = zoneOffsetMs(new Date(candidate), timeZone);
  candidate = naiveUtc - offset;

  return new Date(candidate);
}

/**
 * `YYYY-MM-DD` → the UTC midnight of that calendar date.
 *
 * All-day events are published `VALUE=DATE`, and ical-generator renders a
 * date-only value from the Date's **UTC** fields
 * (`ical-generator/src/tools.ts:270-284`). Building the Date from server-local
 * midnight therefore shifts the published date by a day for any process east of
 * UTC. A calendar date has no zone, so UTC midnight is the correct carrier.
 */
export function calendarDateToUtcMidnight(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map((n) => Number(n));
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 0, 0, 0));
}
