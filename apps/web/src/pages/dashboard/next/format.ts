/**
 * DashboardNext formatting helpers.
 *
 * House rule (CLAUDE.md / num sketches): an unknown value is an em dash.
 * It never renders as 0, never counts up, never draws as an empty bar.
 * Every helper here takes `null` to mean "unknown" and returns the dash.
 */

import { createContext, useContext } from 'react';
import { formatMoney, formatNumber } from '@/lib/utils';
import { currencyMinorUnits } from '@/lib/currency';

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

/**
 * Why a spend figure is not stated: delivered orders with no recorded cost.
 * The gateway withholds the figure rather than sum it short; the page says so
 * in words instead of drawing a $0. Null when none is uncosted.
 */
export function uncostedSaid(n: number | null | undefined): string | null {
  if (!n || n < 1) return null;
  return n === 1
    ? '1 delivered order has no recorded cost'
    : `${n} delivered orders have no recorded cost`;
}

/**
 * Why a spend figure is not stated, in a few words for a tile or a cell: the
 * delivered orders with no recorded cost, and the ones placed in money other
 * than the house's, by code. The gateway withholds such a figure rather than
 * add two monies together or leave an order out (nothing converts one into
 * the other). `houseUnread`: an order named a currency and the house's own
 * could not be read. Null when nothing is held back.
 */
export function heldBackSaid(
  uncosted: number | null | undefined,
  other?: Record<string, number> | null,
  houseUnread = false,
): string | null {
  const codes = Object.entries(other ?? {})
    .filter(([, n]) => typeof n === 'number' && n > 0)
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1));
  const n = codes.reduce((sum, [, k]) => sum + k, 0);
  if (n === 0) return uncostedSaid(uncosted);
  const head = `${n} delivered ${n === 1 ? 'order is' : 'orders are'}`;
  const where =
    codes.length === 1
      ? `in ${codes[0][0]}`
      : `in other currencies (${codes.map(([c, k]) => `${k} ${c}`).join(', ')})`;
  const money = houseUnread
    ? `${head} ${where} and the house’s currency could not be read`
    : `${head} ${where}, not the house’s money`;
  if (!uncosted || uncosted < 1) return money;
  return `${money}; ${uncosted} ${uncosted === 1 ? 'has' : 'have'} no recorded cost`;
}

/** One spend window's scanned deliveries with no order (gateway `scannedDeliveries`). */
export interface ScannedWindow {
  counted: number;
  uncosted: number;
  notInHouseCurrency: Record<string, number>;
}

const deliveries = (n: number) => `${n} scanned ${n === 1 ? 'delivery' : 'deliveries'}`;

/**
 * Why the scanned deliveries with no order hold a spend figure back (r36
 * invoices R3): verified deliveries whose papers carry no invoice total, or
 * whose papers are in money other than the house's. Null when they hold
 * nothing back.
 */
export function scannedHeldSaid(p: ScannedWindow | null | undefined): string | null {
  if (!p) return null;
  const codes = Object.entries(p.notInHouseCurrency ?? {})
    .filter(([, n]) => typeof n === 'number' && n > 0)
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1));
  const other = codes.reduce((sum, [, k]) => sum + k, 0);
  const parts: string[] = [];
  if (other > 0) {
    const where =
      codes.length === 1
        ? `in ${codes[0][0]}`
        : `in other currencies (${codes.map(([c, k]) => `${k} ${c}`).join(', ')})`;
    parts.push(`${deliveries(other)} ${other === 1 ? 'is' : 'are'} ${where}, not the house’s money`);
  }
  if (p.uncosted > 0) {
    parts.push(`${deliveries(p.uncosted)} ${p.uncosted === 1 ? 'has' : 'have'} no invoice total yet`);
  }
  return parts.length ? parts.join('; ') : null;
}

/**
 * Why a spend figure is withheld, all reasons together: the orders', then the
 * scanned deliveries'. When neither names one but the gateway sent a reason
 * (`unread`: a read that failed), the tile says the figure could not be read,
 * never nothing. Null when the figure is stated.
 */
export function spendWithheldSaid(input: {
  uncosted?: number | null;
  other?: Record<string, number> | null;
  houseUnread?: boolean;
  scanned?: ScannedWindow | null;
  unread?: string | null;
}): string | null {
  const said = [heldBackSaid(input.uncosted, input.other, input.houseUnread ?? false), scannedHeldSaid(input.scanned)]
    .filter((s): s is string => !!s)
    .join('; ');
  if (said) return said;
  return typeof input.unread === 'string' && input.unread.trim() !== '' ? 'could not be read just now' : null;
}

/**
 * What a stated spend figure is made of. With scanned deliveries in the
 * window it says so, since a house that only scans its papers has no orders
 * behind the figure; otherwise `ordersOnly`, the tile's own words.
 */
export function spendMadeOf(p: ScannedWindow | null | undefined, ordersOnly: string): string {
  const n = p && typeof p.counted === 'number' ? p.counted : 0;
  return n > 0 ? `delivered orders and ${deliveries(n)}` : ordersOnly;
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

/* ── the house's own money (r56, 2026-11-12) ─────────────────────────────── */

/** A money formatter: the figure in the house's currency, or the dash. */
export type Money = (v: number | null | undefined, mode?: 'compact' | 'full' | 'table') => string;

/**
 * What the page knows of the house's currency (`GET /settings/currency`):
 * still reading, a recorded ISO code, or none it can use (not recorded, or
 * the read failed). Never assumed to be dollars.
 */
export type HouseCurrencyState =
  | { state: 'reading' }
  | { state: 'recorded'; code: string }
  | { state: 'not_recorded' };

/**
 * Money in the house's currency. A recorded code formats through `Intl`
 * (compact cells as "TRY 4.2K", full figures up to the currency's own minor
 * units, table figures at exactly them). While the code is still being read
 * every figure is the dash; with no usable code a figure is a bare number
 * and the page says once why. It never prints `$` for a house whose money
 * is not dollars.
 */
export function houseMoney(c: HouseCurrencyState): Money {
  return (v, mode = 'full') => {
    if (v == null || Number.isNaN(v)) return DASH;
    if (c.state === 'reading') return DASH;
    if (c.state !== 'recorded' || !/^[A-Z]{3}$/.test(c.code)) return formatNumber(v, mode);
    const minor = currencyMinorUnits(c.code) ?? 2;
    const opts: Intl.NumberFormatOptions =
      mode === 'compact'
        ? Math.abs(v) >= 1_000
          ? { notation: 'compact', maximumFractionDigits: 1 }
          : { maximumFractionDigits: 0 }
        : mode === 'table'
          ? { minimumFractionDigits: minor, maximumFractionDigits: minor }
          : { minimumFractionDigits: 0, maximumFractionDigits: minor };
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: c.code, ...opts }).format(v);
    } catch {
      // A well-formed code Intl does not know still names the money.
      return `${formatNumber(v, mode)} ${c.code}`;
    }
  };
}

/** Outside a provider the page knows no currency: bare numbers, never `$`. */
export const HouseMoneyContext = createContext<Money>(houseMoney({ state: 'not_recorded' }));

export function useHouseMoney(): Money {
  return useContext(HouseMoneyContext);
}

/** The one sentence the page says when its money has no currency to print. */
export function currencyNotRecordedSaid(c: HouseCurrencyState): string | null {
  return c.state === 'not_recorded'
    ? 'This house’s currency is not recorded or could not be read, so its money is shown as plain numbers.'
    : null;
}
