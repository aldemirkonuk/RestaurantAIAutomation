/**
 * CalendarNext formatting — dates, clocks, and the house honesty rule.
 *
 * Every helper takes `null | undefined` to mean "unknown" and returns the em
 * dash. Nothing here ever substitutes a zero, a midnight, or "today" for a
 * value the gateway did not send.
 *
 * Dates are handled as LOCAL `YYYY-MM-DD` keys throughout: `new Date('2026-09-04')`
 * parses as UTC and lands on the wrong calendar day west of Greenwich, which is
 * exactly the class of bug a calendar cannot afford (the shared
 * `lib/calendar-dates.ts` exists for the same reason).
 */

export const EM = '—';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const SANS = '"Plus Jakarta Sans", "DM Sans", system-ui, sans-serif';

/* ── Fraunces ─────────────────────────────────────────────────────────────
 * Copied from pages/dashboard/next/fonts.ts rather than imported: pages depend
 * on the foundation, never on each other (providers/next carries its own copy
 * of its formatters for the same reason). index.html loads the sans and the
 * mono but not the serif, and index.html is not this page's to edit.
 */
const FRAUNCES_LINK_ID = 'mudavym-fraunces';

export function ensureFraunces(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(FRAUNCES_LINK_ID)) return;
  const link = document.createElement('link');
  link.id = FRAUNCES_LINK_ID;
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..680;1,9..144,300..680&display=swap';
  document.head.appendChild(link);
}

/* ── Day keys ─────────────────────────────────────────────────────────────── */

export type CalView = 'month' | 'week' | 'day' | 'agenda';

export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a `YYYY-MM-DD` (or an ISO timestamp) as a LOCAL calendar day. */
export function parseDayKey(value: string): Date {
  const head = String(value).split('T')[0];
  const [y, m, d] = head.split('-').map(Number);
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/** Monday-first, matching the dashboard's SalesCalendar grid voice. */
export function startOfWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}

/** The window of days the current view actually shows — what we ask the gateway for. */
export function rangeFor(view: CalView, cursor: Date): { start: string; end: string } {
  if (view === 'day') return { start: dayKey(cursor), end: dayKey(cursor) };
  if (view === 'week') {
    const s = startOfWeek(cursor);
    return { start: dayKey(s), end: dayKey(addDays(s, 6)) };
  }
  if (view === 'agenda') {
    const s = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    return { start: dayKey(s), end: dayKey(addDays(s, 89)) };
  }
  // month — including the spill days the grid draws, so they are never blank-by-omission
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  return { start: dayKey(startOfWeek(first)), end: dayKey(addDays(startOfWeek(last), 6)) };
}

export function periodLabel(view: CalView, cursor: Date): string {
  if (view === 'day') {
    return cursor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
  if (view === 'week') {
    const s = startOfWeek(cursor);
    const e = addDays(s, 6);
    const sameMonth = s.getMonth() === e.getMonth();
    return sameMonth
      ? `${s.toLocaleDateString('en-US', { month: 'long' })} ${s.getDate()}–${e.getDate()}`
      : `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }
  if (view === 'agenda') return 'The next ninety days';
  return cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function longDay(key: string): string {
  const d = parseDayKey(key);
  if (Number.isNaN(d.getTime())) return EM;
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

/** "Today" / "Tomorrow" / "Thu 4 Sep" — a scanning label, never a claim. */
export function relDay(key: string, today = new Date()): string {
  const d = parseDayKey(key);
  if (Number.isNaN(d.getTime())) return EM;
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((d.getTime() - t.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
}

/* ── Clocks ───────────────────────────────────────────────────────────────── */

/** `HH:MM` from a raw `event_time` (which the gateway may send as `HH:MM:SS`). */
export function clock(raw: string | null | undefined): string {
  if (!raw) return EM;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(raw));
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : EM;
}

export function toMinutes(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(raw));
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(mins) ? mins : null;
}

export function fromMinutes(mins: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(mins)));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

export function snapMinutes(mins: number, step = 15): number {
  return Math.round(mins / step) * step;
}

/**
 * "14:00 – 15:30", "14:00", "All day", or the dash when nothing is recorded.
 *
 * A row can be `all_day` AND still carry an `event_time` — production has one
 * (Superbowl, 2026-02-08, all-day with 18:00 recorded). Saying only "All day"
 * would hide a value the tenant entered, so the recorded time is named.
 */
export function span(start: string | null, end: string | null, allDay: boolean): string {
  if (allDay) {
    const s = clock(start);
    return s === EM ? 'All day' : `All day · ${s} recorded`;
  }
  const s = clock(start);
  if (s === EM) return EM;
  const e = clock(end);
  return e === EM ? s : `${s} – ${e}`;
}

/** A count said in words, or nothing at all. Never "0 deliveries". */
export function countPhrase(n: number, one: string, many: string): string | null {
  if (n <= 0) return null;
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * "14 minutes ago" / "in 8 minutes" — for a job's last and next run, where the
 * exact instant matters less than whether it was recent.
 *
 * Returns the EM dash for an unreadable or absent instant, never "just now":
 * a missing timestamp must not read as a fresh one.
 */
export function sinceOrUntil(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return EM;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return EM;
  const deltaMs = at.getTime() - now.getTime();
  const ahead = deltaMs >= 0;
  const mins = Math.round(Math.abs(deltaMs) / 60000);
  const body =
    mins < 1
      ? 'less than a minute'
      : mins < 60
        ? `${mins} minute${mins === 1 ? '' : 's'}`
        : mins < 60 * 48
          ? `${Math.round(mins / 60)} hour${Math.round(mins / 60) === 1 ? '' : 's'}`
          : `${Math.round(mins / 1440)} days`;
  return ahead ? `in ${body}` : `${body} ago`;
}

/** A wall-clock instant in the reader's own locale, or the EM dash. */
export function stamp(iso: string | null | undefined): string {
  if (!iso) return EM;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return EM;
  return at.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
