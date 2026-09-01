/**
 * DashboardNext formatting helpers.
 *
 * House rule (CLAUDE.md / num sketches): an unknown value is an em dash.
 * It never renders as 0, never counts up, never draws as an empty bar.
 * Every helper here takes `null` to mean "unknown" and returns the dash.
 */

import { formatMoney, formatNumber } from '@/lib/utils';

export const DASH = '—';

/** Money or the dash. `mode` follows lib/utils' FormatMode. */
export function money(v: number | null | undefined, mode: 'compact' | 'full' | 'table' = 'full'): string {
  return v == null || Number.isNaN(v) ? DASH : formatMoney(v, mode);
}

/** Plain figure or the dash. */
export function figure(v: number | null | undefined, mode: 'compact' | 'full' = 'full'): string {
  return v == null || Number.isNaN(v) ? DASH : formatNumber(v, mode);
}

/** Local-time YYYY-MM-DD (the gateway keys calendar days by date string). */
export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a YYYY-MM-DD string as a LOCAL date (new Date('YYYY-MM-DD') is UTC). */
export function parseDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? DASH;
}

/** "Thursday, August 28" from a YYYY-MM-DD string. */
export function longDay(dateStr: string): string {
  return parseDateStr(dateStr).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

/** Relative time for feeds — honest about unknowns. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return DASH;
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "HH:MM" from a raw calendar_events.event_time (which may be null). */
export function eventTime(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}
