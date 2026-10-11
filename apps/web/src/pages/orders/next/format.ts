/**
 * OrdersNext formatting — one rule above all others: an unknown renders as an
 * em dash, never as a zero. A zero is a claim; a dash is an admission.
 */

import { CURRENCY_NOT_RECORDED, currencyMinorUnits, inHouseMarks } from '@/lib/currency';
import type { GroupMark } from '@/lib/parseDecimal';
import { getHouseLocale } from '@/lib/houseCurrency';
import { getHouseZone } from '@/lib/houseZone';

export const EM = '—';

/**
 * What a staff page says where an amount would stand (F-441): the gateway sent
 * none, on purpose. Not a dash (that reads "unknown") and never a zero.
 */
export const AMOUNTS_WITHHELD = 'Amounts are for owners and managers.';

/** A finite number or null. Guards against NaN and the API's occasional string. */
export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * Money in the currency the order was placed in (F-341).
 *
 * Both formatters said `currency: 'USD'` until 2026-10-09, so a € or ₺ order
 * was sealed under a dollar sign. The caller now names the money: the order's
 * own `procurement_orders.currency`, else the house's (`OrderRowVM.currency`
 * resolves that). A code nobody recorded prints the number and says so, never
 * a guessed symbol (`lib/currency.ts`). Each currency keeps its own decimals.
 *
 * Printed en-US, then re-marked with the house's grouping when the caller
 * passes it (`useHouseGroupMark`, F-942): a lira house reads "₺1.250,00", the
 * way the order sheet reads what it types. The symbol stays where it was.
 */
function inCurrency(
  n: number,
  currency: string | null | undefined,
  opts: { whole?: boolean; grouping?: boolean; group?: GroupMark | null } = {},
): string {
  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  const digits = opts.whole ? 0 : currencyMinorUnits(code) ?? 2;
  const shape = {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: opts.grouping ?? true,
  };
  let printed: string;
  if (/^[A-Z]{3}$/.test(code)) {
    try {
      printed = new Intl.NumberFormat('en-US', { style: 'currency', currency: code, ...shape }).format(n);
    } catch {
      printed = `${new Intl.NumberFormat('en-US', shape).format(n)} ${code}`;
    }
  } else {
    printed = `${new Intl.NumberFormat('en-US', shape).format(n)} (${CURRENCY_NOT_RECORDED})`;
  }
  return inHouseMarks(printed, ',', opts.group ?? null);
}

export function fmtMoney(
  v: number | null | undefined,
  currency: string | null | undefined,
  group: GroupMark | null = null,
): string {
  const n = num(v);
  return n === null ? EM : inCurrency(n, currency, { group });
}

/** Whole units for the month figure (€12,480). Unknown stays a dash. */
export function fmtMoneyWhole(
  v: number | null | undefined,
  currency: string | null | undefined,
  group: GroupMark | null = null,
): string {
  const n = num(v);
  return n === null ? EM : inCurrency(n, currency, { whole: true, group });
}

/**
 * The working's figure: no grouping, as the working always printed it ("× €420.00").
 * Its decimal mark is the house's when the caller passes the group mark (F-942):
 * a lira house reads "× ₺420,00", as it reads every other figure on the page.
 */
export function fmtWorking(
  n: number,
  currency: string | null | undefined,
  group: GroupMark | null = null,
): string {
  return inCurrency(n, currency, { grouping: false, group });
}

/** One currency's part of a sum; `currency: null` is "the order names none". */
export interface MoneyInCurrency {
  currency: string | null;
  amount: number;
}

/**
 * A sum that never adds two currencies (F-341) — the gateway's
 * `spendByCurrency` (dashboard.service.ts, F-339) on the page's rows: one
 * entry per currency, in cents, and `total` is one figure only while the
 * amounts name at most one currency. There is no exchange rate to add by.
 */
export function sumByCurrency(
  items: Array<{ amount: number | null; currency: string | null | undefined }>,
): { total: number | null; byCurrency: MoneyInCurrency[] } {
  const by = new Map<string | null, number>();
  for (const it of items) {
    if (it.amount === null) continue;
    const code =
      typeof it.currency === 'string' && it.currency.trim() ? it.currency.trim().toUpperCase() : null;
    by.set(code, Math.round(((by.get(code) ?? 0) + it.amount) * 100) / 100);
  }
  const byCurrency = Array.from(by, ([currency, amount]) => ({ currency, amount }));
  const named = byCurrency.filter((c) => c.currency !== null).length;
  return {
    total: named > 1 ? null : Math.round(byCurrency.reduce((s, c) => s + c.amount, 0) * 100) / 100,
    byCurrency,
  };
}

export function fmtInt(v: number | null | undefined): string {
  const n = num(v);
  return n === null ? EM : String(Math.round(n));
}

/*
 * Dates are the house's (F-1135, rehit of F-001): written the house's way
 * (`getHouseLocale`) and read on the house's clock (`getHouseZone`; the page
 * calls `useHouseZone` so it re-renders when that lands), so an order placed at 23:30 in Istanbul is not filed under
 * the next day on a London laptop. With no zone known yet, the device's clock
 * stands in, as everywhere else. Digits only, in the house's day and month
 * order, so every word on the page stays English (ADR 0207 q7, F-1279 and
 * F-1344): a Turkish house reads "11/10", never "11 Eki".
 */
function zoned(zone: string | null | undefined): { timeZone?: string } {
  return zone ? { timeZone: zone } : {};
}

/** The calendar day of `d` on the house's clock, as `YYYY-MM-DD`. */
function dayOf(d: Date, zone: string | null | undefined): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', ...zoned(zone) }).format(d);
}

export function fmtDate(iso: string | null | undefined, zone: string | null = getHouseZone()): string {
  if (!iso) return EM;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EM;
  const thisYear = dayOf(d, zone).slice(0, 4) === dayOf(new Date(), zone).slice(0, 4);
  return new Intl.DateTimeFormat(getHouseLocale(), {
    day: 'numeric',
    month: 'numeric',
    ...(thisYear ? {} : { year: 'numeric' as const }),
    ...zoned(zone),
  }).format(d);
}

/** A date with its time on the house's clock, "11/10, 09:00": three vendor
 *  answers on one day must be told apart (F-1344). */
export function fmtDateTime(iso: string | null | undefined, zone: string | null = getHouseZone()): string {
  const day = fmtDate(iso, zone);
  if (day === EM) return EM;
  const clock = new Intl.DateTimeFormat(getHouseLocale(), { hour: '2-digit', minute: '2-digit', ...zoned(zone) });
  return `${day}, ${clock.format(new Date(iso as string))}`;
}

/** When a read landed: "17:58" today, "30/09, 17:58" on another day (ORD-W15). */
export function fmtReadTime(ms: number, zone: string | null = getHouseZone()): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return EM;
  const clock = new Intl.DateTimeFormat(getHouseLocale(), { hour: '2-digit', minute: '2-digit', ...zoned(zone) });
  return dayOf(d, zone) === dayOf(new Date(), zone)
    ? clock.format(d)
    : `${fmtDate(d.toISOString(), zone)}, ${clock.format(d)}`;
}

/** m:ss for the auto-send countdown. Clamped at zero — time owed, not negative. */
export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* Type stacks. Fraunces is not loaded app-wide; Georgia is the honest fallback
   (the OrdersNext stub set this precedent). Figures always sit in the mono. */
export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const SANS = '"DM Sans", "Plus Jakarta Sans", system-ui, sans-serif';
