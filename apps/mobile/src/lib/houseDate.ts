/**
 * The house's calendar date, and the Monday of its week (F-252).
 *
 * The Team tab used `new Date().toISOString().slice(0, 10)`, which is the UTC
 * date: after 17:00 in a Los Angeles house it is already tomorrow, so "On
 * tonight" listed tomorrow's rota. `currentWeekStart` set a local Monday and
 * then serialised it in UTC, which on a Monday evening started the week a day
 * late. Web fixed the same pair in `apps/web/src/pages/team/next/tm-format.ts`
 * (`mondayOf`); this is that fix, read in the house's zone when it is known.
 */

/**
 * YYYY-MM-DD for `now` in `timeZone`, or in the phone's own zone when the house
 * states none (or names one this device cannot read).
 */
export function houseDateKey(now: Date, timeZone?: string | null): string {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(now);
      const get = (t: string) => parts.find((p) => p.type === t)?.value;
      const y = get("year");
      const m = get("month");
      const d = get("day");
      if (y && m && d) return `${y}-${m}-${d}`;
    } catch {
      // An unknown zone falls through to the phone's own date.
    }
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The Monday of the week holding `dateKey` (YYYY-MM-DD), UTC arithmetic only. */
export function mondayOfKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d));
  const day = (anchor.getUTCDay() + 6) % 7; // Mon=0
  anchor.setUTCDate(anchor.getUTCDate() - day);
  return anchor.toISOString().slice(0, 10);
}

/** `dateKey` (YYYY-MM-DD) moved by `days`, UTC arithmetic only. */
export function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * "YYYY-MM-DD HH:MM" for `now` on the house's clock (the gateway's `clockAt`),
 * or the phone's own when the house states no zone it can read.
 */
export function houseClockKey(now: Date, timeZone?: string | null): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(now);
      const get = (t: string) => parts.find((p) => p.type === t)?.value;
      const h = get("hour");
      const m = get("minute");
      if (h && m) return `${houseDateKey(now, timeZone)} ${h}:${m}`;
    } catch {
      // An unknown zone falls through to the phone's own clock.
    }
  }
  return `${houseDateKey(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
