/**
 * OrdersNext formatting — one rule above all others: an unknown renders as an
 * em dash, never as a zero. A zero is a claim; a dash is an admission.
 */

import { formatMoney } from '@/lib/currency';

export const EM = '—';

/** A finite number or null. Guards against NaN and the API's occasional string. */
export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/*
 * MONEY, IN THE CURRENCY IT IS IN (PROCURE-01, 2026-10-07).
 *
 * `fmtMoney` and `fmtMoneyWhole` were `Intl.NumberFormat('en-US', { currency:
 * 'USD' })`, so every figure on /orders printed as dollars: a 1,200 EUR order
 * read "$1,200.00", and the month figure added lira, euros and dollars into one
 * "$" total. The gateway had sent each order's own `currency` all along
 * (`mapOrderRow`); the page dropped it.
 *
 * The currency is a THREE-state answer, the same discipline as `priceUom`:
 *
 *   'TRY'      the order names its money; printed by `lib/currency.ts`
 *              `formatMoney`, in that currency's own decimal places
 *   null       the row was read and names none; the amount and
 *              "currency not recorded" (`formatMoney`'s sentence)
 *   omitted    this caller never read the currency; the amount and
 *              "currency not read" — never "not recorded", because nothing
 *              looked, and never USD
 *
 * There is no USD anywhere in this file and no exchange rate anywhere in the
 * system (ADR 0117 rule 3).
 */

/** What a figure says when the caller never read the currency it is in. */
export const CURRENCY_NOT_READ = 'currency not read';

function notRead(n: number, digits: number): string {
  return `${n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} (${CURRENCY_NOT_READ})`;
}

/** An amount in its own currency. Unknown amount: a dash. See the block above. */
export function fmtMoney(v: number | null | undefined, currency?: string | null): string {
  const n = num(v);
  if (n === null) return EM;
  if (currency === undefined) return notRead(n, 2);
  return formatMoney(n, currency);
}

/** The whole-unit form for the month figure ("€12,480"). Unknown stays a dash. */
export function fmtMoneyWhole(v: number | null | undefined, currency?: string | null): string {
  const n = num(v);
  if (n === null) return EM;
  if (currency === undefined) return notRead(n, 0);
  return formatMoney(n, currency, { maximumFractionDigits: 0 });
}

/** One currency's share of a set of amounts. `currency` keeps all three states. */
export interface MoneyLine {
  currency: string | null | undefined;
  amount: number;
}

/**
 * Known amounts, ONE LINE PER CURRENCY — never one sum across currencies, and
 * nothing converted. ADR 0117 rule 3: "Nothing converts. There is no exchange
 * rate anywhere in this system. A reader that would compare or sum figures in
 * different currencies refuses in words instead." Lira and euros are two facts;
 * their sum is a third figure that is true of nothing.
 *
 * Unknown amounts are skipped: the caller counts them and says so ("2
 * unpriced"), never as a zero. An order that names no currency is its own line,
 * and so is one whose currency was not read — neither is folded into a currency
 * that was named. Lines come out by code, then "not recorded", then "not read",
 * so a re-render never reshuffles them.
 */
export function sumByCurrency(
  items: ReadonlyArray<{ amount: number | null; currency?: string | null }>,
): MoneyLine[] {
  const lines = new Map<string, MoneyLine>();
  for (const item of items) {
    const n = num(item.amount);
    if (n === null) continue;
    const key = moneyLineKey(item.currency);
    const line = lines.get(key);
    if (line) line.amount += n;
    else lines.set(key, { currency: item.currency, amount: n });
  }
  return [...lines.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, line]) => line);
}

/** A stable key per currency state. `~` sorts after every ISO code. */
export function moneyLineKey(currency: string | null | undefined): string {
  return currency === undefined ? '~not-read' : currency === null ? '~none' : currency;
}

/**
 * Lines for a sentence: "€1,500.00 · TRY 12,400.00". The separator is a middle
 * dot and never a plus, because the lines are not added.
 */
export function fmtMoneyLines(lines: readonly MoneyLine[], whole = false): string {
  return lines
    .map((l) => (whole ? fmtMoneyWhole(l.amount, l.currency) : fmtMoney(l.amount, l.currency)))
    .join(' · ');
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
