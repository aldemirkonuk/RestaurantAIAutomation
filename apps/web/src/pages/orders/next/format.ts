/**
 * OrdersNext formatting — one rule above all others: an unknown renders as an
 * em dash, never as a zero. A zero is a claim; a dash is an admission.
 */

import { CURRENCY_NOT_RECORDED, currencyMinorUnits } from '@/lib/currency';

export const EM = '—';

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
 */
function inCurrency(
  n: number,
  currency: string | null | undefined,
  opts: { whole?: boolean; grouping?: boolean } = {},
): string {
  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  const digits = opts.whole ? 0 : currencyMinorUnits(code) ?? 2;
  const shape = {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: opts.grouping ?? true,
  };
  if (/^[A-Z]{3}$/.test(code)) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, ...shape }).format(n);
    } catch {
      return `${new Intl.NumberFormat('en-US', shape).format(n)} ${code}`;
    }
  }
  return `${new Intl.NumberFormat('en-US', shape).format(n)} (${CURRENCY_NOT_RECORDED})`;
}

export function fmtMoney(v: number | null | undefined, currency: string | null | undefined): string {
  const n = num(v);
  return n === null ? EM : inCurrency(n, currency);
}

/** Whole units for the month figure (€12,480). Unknown stays a dash. */
export function fmtMoneyWhole(
  v: number | null | undefined,
  currency: string | null | undefined,
): string {
  const n = num(v);
  return n === null ? EM : inCurrency(n, currency, { whole: true });
}

/** The working's figure: no grouping, as the working always printed it ("× €420.00"). */
export function fmtWorking(n: number, currency: string | null | undefined): string {
  return inCurrency(n, currency, { grouping: false });
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

const sameYear = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const otherYear = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return EM;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EM;
  return d.getFullYear() === new Date().getFullYear() ? sameYear.format(d) : otherYear.format(d);
}

const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

/** When a read landed: "17:58" today, "30 Sept, 17:58" on another day (ORD-W15). */
export function fmtReadTime(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return EM;
  return d.toDateString() === new Date().toDateString()
    ? clock.format(d)
    : `${fmtDate(d.toISOString())}, ${clock.format(d)}`;
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
