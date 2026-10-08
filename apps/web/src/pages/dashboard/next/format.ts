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

/**
 * The label on a hold-to-approve die.
 *
 * An approval gesture must never carry a money figure the payload did not
 * contain. Until 2026-09-05 this card read `order.totalPrice`, a key
 * `OrderResponseDto` has never sent, and `formatMoney(undefined)` is `"$0"` —
 * so the die read "Hold to approve · $0" over every real order on the queue.
 * A dash is no better on a control this small: it reads as a rendering fault
 * rather than as an absence. With no total the die says only what it does.
 */
export function approveLabel(total: number | null | undefined): string {
  return total == null || Number.isNaN(total)
    ? 'Hold to approve'
    : `Hold to approve · ${formatMoney(total, 'full')}`;
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

/**
 * DASH-W20 (2026-10-01): a moment's calendar day on the HOUSE's clock. The
 * gateway buckets every figure in the house's zone (`stats.timezone`); the
 * page's "today", its greeting and its day panels must use the same clock or
 * a Chicago house viewed from another zone shows two different todays. No
 * zone yet (or one the browser cannot read) falls back to the device's.
 */
export function dateIn(d: Date, zone?: string | null): string {
  if (!zone) return localDateStr(d);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return localDateStr(d);
  }
}

/** DASH-W20: the hour (0-23) on the house's clock; the device's without a zone. */
export function hourIn(d: Date, zone?: string | null): number {
  if (!zone) return d.getHours();
  try {
    const h = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(d),
    );
    return Number.isFinite(h) ? h % 24 : d.getHours();
  } catch {
    return d.getHours();
  }
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

/**
 * DASH-W32 (P5, found in P7): a calendar event's kind in the house's words.
 * The keys are the gateway's CalendarEventType (calendar.dto.ts); `custom`
 * and anything unknown say nothing rather than print a code.
 */
const EVENT_KIND_WORDS: Record<string, string> = {
  delivery: 'delivery',
  order: 'order',
  meeting: 'meeting',
  inventory: 'stock',
  tasting: 'tasting',
  reminder: 'reminder',
  recurring: 'repeats',
  holiday: 'holiday',
  delivery_eta: 'delivery expected',
  provider_birthday: 'vendor’s birthday',
  provider_unavailable: 'vendor away',
  inventory_count: 'stock count',
  high_volume_expected: 'busy day expected',
};

export function eventKindWords(type: string | null | undefined): string | null {
  if (!type) return null;
  return EVENT_KIND_WORDS[type.toLowerCase()] ?? null;
}
