/**
 * The house's calendar, as plain arithmetic — no reads, no React. `houseZone.ts`
 * reads the zone; this module turns it into days and midnights.
 *
 * F-927 / F-929 (2026-10-10): "until tomorrow" was 24 hours from the click and
 * "expires tomorrow" was any time under 24 hours away — so a snooze set at
 * 10:00 woke at 10:00 the next day, and an invite expiring at 23:00 tonight
 * read "tomorrow". A day word names a calendar day on the HOUSE's clock, so
 * these helpers count calendar days in the house's zone and find the instant
 * its clock reads 00:00.
 *
 * With no zone (or one this browser cannot read) the device's clock stands in,
 * as everywhere else.
 */

function partsIn(zone: string, at: number): Record<string, number> | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(new Date(at));
    const out: Record<string, number> = {};
    for (const p of parts) if (p.type !== 'literal') out[p.type] = Number(p.value);
    return out.year && out.month && out.day ? out : null;
  } catch {
    return null;
  }
}

/**
 * The house's calendar day at `now`, as a LOCAL-midnight Date — so the pages'
 * existing local-getter helpers (`dayKey`, `mondayOf`, `getDate`) read the
 * house's day off it unchanged. No zone (or one this browser cannot read)
 * gives the device's day.
 */
export function houseToday(zone: string | null | undefined, now: Date = new Date()): Date {
  const p = zone ? partsIn(zone, now.getTime()) : null;
  if (p) return new Date(p.year, p.month - 1, p.day);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * The instant the house's clock reads `h`:`mi` on calendar day `y`-`m`-`d`
 * (`m` 1-based; an overflowing day or month rolls over). `null` with no zone,
 * or one this browser cannot read. The gateway's `zonedWallClockToUtc`, in
 * the same two passes: a time inside a spring-forward gap lands in the new
 * offset, an hour on.
 */
export function houseInstant(
  zone: string | null | undefined,
  y: number,
  m: number,
  d: number,
  h = 0,
  mi = 0,
): number | null {
  const wall = Date.UTC(y, m - 1, d, h, mi);
  const offsetAt = (at: number): number | null => {
    const p = zone ? partsIn(zone, at) : null;
    if (!p) return null;
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000;
  };
  const first = offsetAt(wall);
  if (first === null) return null;
  // Twice: the offset at the guess can differ from the offset at the wall
  // clock when a clock change falls between them.
  const second = offsetAt(wall - first);
  return wall - (second ?? first);
}

/**
 * The instant the house's clock reads 00:00 on calendar day `y`-`m`-`d`
 * (`m` 1-based; an overflowing day or month rolls over, so `d + 1` on the 31st
 * is the 1st of the next month).
 */
export function houseMidnight(zone: string | null | undefined, y: number, m: number, d: number): number {
  const at = houseInstant(zone, y, m, d);
  if (at !== null) return at;
  const day = new Date(Date.UTC(y, m - 1, d));
  return new Date(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()).getTime();
}

/**
 * Whole calendar days from `from`'s house day to `to`'s house day: 0 for the
 * same day, 1 for the next, however few hours apart they are.
 */
export function houseDaysBetween(zone: string | null | undefined, from: number, to: number): number {
  const a = houseToday(zone, new Date(from));
  const b = houseToday(zone, new Date(to));
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
      86_400_000,
  );
}

/** "6:00 PM" on the house's clock. */
export function houseClockTime(zone: string | null | undefined, at: number): string {
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  if (zone) {
    try {
      return new Date(at).toLocaleTimeString('en-US', { ...opts, timeZone: zone });
    } catch {
      /* a zone name this browser cannot read: the device's clock stands in */
    }
  }
  return new Date(at).toLocaleTimeString('en-US', opts);
}

/**
 * The house's wall clock at `at`, as `YYYY-MM-DDTHH:MM:SS` — comparable as a
 * string with an entry's own `${date}T${time}` (F-1109). No zone (or one this
 * browser cannot read) gives the device's clock.
 */
export function houseWallClock(zone: string | null | undefined, at: number): string {
  const p = zone ? partsIn(zone, at) : null;
  const d = new Date(at);
  const [y, mo, da, h, mi, s] = p
    ? [p.year, p.month, p.day, p.hour, p.minute, p.second]
    : [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];
  const two = (n: number) => String(n).padStart(2, '0');
  return `${y}-${two(mo)}-${two(da)}T${two(h)}:${two(mi)}:${two(s)}`;
}
