/**
 * A menu's dates on the HOUSE's clock (menu r21).
 *
 * The founder's goal for the menu software says "dates in the house time
 * zone". #1086 moved the kept menus off the UTC day onto "this device's
 * clock", which is right only while the owner stands in the house: a house in
 * Istanbul read from a laptop in Detroit was told its 06:05 menu was "read
 * 2026-11-11 22:05", the evening before. The gateway now sends the house's
 * IANA zone with the kept menus and with a plan (`timezone`, menus.service.ts
 * houseZoneOf); every date on /menu is said in it.
 *
 * With no usable zone (none set, not a zone, not readable) the device's clock
 * is used, and the page says so once (venueTime.ts rule 2: an unlabelled local
 * time is the defect; ADR 0067: absence is said, never defaulted).
 */

const pad = (n: number) => String(n).padStart(2, '0');

interface ClockParts {
  y: string
  m: string
  d: string
  h: string
  min: string
  s: string
}

/** Whether a zone can be used to say a date (a real IANA name). */
export function zoneUsable(zone: string | null | undefined): zone is string {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function partsOf(date: Date, zone: string | null | undefined): ClockParts {
  if (zoneUsable(zone)) {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const p: Record<string, string> = {};
    for (const part of f.formatToParts(date)) p[part.type] = part.value;
    return { y: p.year, m: p.month, d: p.day, h: p.hour === '24' ? '00' : p.hour, min: p.minute, s: p.second };
  }
  return {
    y: String(date.getFullYear()),
    m: pad(date.getMonth() + 1),
    d: pad(date.getDate()),
    h: pad(date.getHours()),
    min: pad(date.getMinutes()),
    s: pad(date.getSeconds()),
  };
}

/** "YYYY-MM-DD" of a moment on the house's clock (the device's without a zone); null when it is not a moment. */
export function houseDay(iso: string, zone: string | null | undefined): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const p = partsOf(date, zone);
  return `${p.y}-${p.m}-${p.d}`;
}

/** "YYYY-MM-DD HH:MM" (with `second`, ":SS") on the house's clock; null when it is not a moment. */
export function houseMoment(iso: string, zone: string | null | undefined, second = false): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const p = partsOf(date, zone);
  return `${p.y}-${p.m}-${p.d} ${p.h}:${p.min}${second ? `:${p.s}` : ''}`;
}

/**
 * One sentence for a page whose dates fell back to the device's clock, or null
 * when they are on the house's. `reason` is the gateway's (timezoneReason).
 */
export function deviceClockNote(zone: string | null | undefined, reason: string | null | undefined): string | null {
  if (zoneUsable(zone)) return null;
  const why = reason ?? "the house's time zone was not sent";
  return `Dates and times here are on this device's clock: ${why}. Set the house's time zone in Settings.`;
}
