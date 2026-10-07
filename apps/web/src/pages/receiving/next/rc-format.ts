/**
 * ReceivingNext formatting — the same honesty contract as OrdersNext
 * (`pages/orders/next/format.ts`, copied per the one-format-file-per-page
 * precedent rather than imported across pages): an unknown renders as an em
 * dash, never as a zero. A zero is a claim; a dash is an admission.
 */

import { CURRENCY_NOT_RECORDED, currencyMinorUnits } from '@/lib/currency';

export const EM = '—';

/**
 * The floor marker. ADR 0051 clause 2: a windowed count renders as a floor
 * (`≥ n`) when its window is full, never as a total it cannot know. Every
 * figure on this page that comes out of a capped server query is a floor —
 * the queue caps items at 100, the uncounted list at 500, the credit rows at
 * 200 (unordered) and the recovery stats at 5000 (also unordered).
 */
export const GE = '≥';

/** A finite number or null. Guards against NaN and the API's occasional string. */
export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * The key the gateway files a claim with no stated currency under
 * (`CURRENCY_UNRECORDED`, apps/api-gateway/src/procurement/documents/
 * credit-ledger.ts). Not an ISO 4217 code on purpose: `currencyCode` finds no
 * code in it, so the money formatters below say the currency was not recorded
 * instead of borrowing one.
 */
export const CURRENCY_UNRECORDED = 'UNRECORDED';

/**
 * A stated ISO 4217 code, trimmed and upper-cased, or null when the money does
 * not say which currency it is in. Null is "not recorded", never USD.
 */
export function currencyCode(currency: string | null | undefined): string | null {
  if (typeof currency !== 'string') return null;
  const code = currency.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

const moneyByKey = new Map<string, Intl.NumberFormat | null>();
function currencyFormatter(code: string, digits: number): Intl.NumberFormat | null {
  const key = `${code}:${digits}`;
  const hit = moneyByKey.get(key);
  if (hit !== undefined) return hit;
  let fmt: Intl.NumberFormat | null = null;
  try {
    fmt = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  } catch {
    // A well-formed code `Intl` does not know: the caller prints the code itself.
    fmt = null;
  }
  moneyByKey.set(key, fmt);
  return fmt;
}

/**
 * Money in the currency it is in, or the number with the sentence saying the
 * currency was not recorded.
 *
 * NEVER USD BY DEFAULT. This page's formatters used to be two `Intl` instances
 * pinned to US dollars, so a lira house's recovered money and every
 * credit draft printed `$` (scenario walk 2026-10-07, PROCURE-03). The rule is
 * the product's (`formatMoney` in lib/currency.ts; founder, 2026-09-06, batch
 * 63: the house states its currency and nothing is converted): a missing code
 * is said in words, a code `Intl` does not know is printed beside the number.
 *
 * `whole` drops the minor units (the recovered headline and the queue's at-risk
 * totals). Otherwise the currency's own decimal places are used — yen have none
 * and a Bahraini dinar has three — and two when the currency is not recorded.
 */
function sayMoney(n: number, currency: string | null | undefined, whole: boolean): string {
  const code = currencyCode(currency);
  const digits = whole ? 0 : (code ? currencyMinorUnits(code) : null) ?? 2;
  const bare = n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (code === null) return `${bare} (${CURRENCY_NOT_RECORDED})`;
  const fmt = currencyFormatter(code, digits);
  return fmt ? fmt.format(n) : `${bare} ${code}`;
}

/** Money with its minor units, in the stated currency. Unknown stays a dash. */
export function fmtMoney(v: number | null | undefined, currency: string | null | undefined): string {
  const n = num(v);
  return n === null ? EM : sayMoney(n, currency, false);
}

/** Whole-unit money, in the stated currency. Unknown stays a dash. */
export function fmtMoneyWhole(
  v: number | null | undefined,
  currency: string | null | undefined,
): string {
  const n = num(v);
  return n === null ? EM : sayMoney(n, currency, true);
}

export function fmtInt(v: number | null | undefined): string {
  const n = num(v);
  return n === null ? EM : String(Math.round(n));
}

/**
 * A count that may be a floor. `atFloor` is the caller's claim that the
 * server's window was full, so the true figure is at least this one.
 *
 * Unknown still wins over the marker: `≥ —` would assert a bound on a number
 * nobody has.
 */
export function fmtIntFloor(v: number | null | undefined, atFloor: boolean): string {
  const n = num(v);
  if (n === null) return EM;
  return atFloor ? `${GE}${Math.round(n)}` : String(Math.round(n));
}

/**
 * Whole-money form of the same, with the floor marker. A summed window is a
 * lower bound on the sum. `currency` is required: the floor marker must never
 * sit in front of a symbol nobody stated, and a missing code reads "currency
 * not recorded" (see `sayMoney`).
 */
export function fmtMoneyWholeFloor(
  v: number | null | undefined,
  atFloor: boolean,
  currency: string | null | undefined,
): string {
  const n = num(v);
  if (n === null) return EM;
  const body = sayMoney(n, currency, true);
  return atFloor ? `${GE}${body}` : body;
}

/**
 * Whole-money form in a STATED currency (fixer review, 2026-09-18: "a priced
 * receipt needs its currency" — a vendor-box subtotal must never sum, or print,
 * across currencies as if they were one). An order with no currency reads
 * "currency not recorded"; it used to borrow USD.
 */
export function fmtMoneyWholeCcy(v: number | null | undefined, currency: string | null): string {
  return fmtMoneyWhole(v, currency);
}

/**
 * The unit a procurement order is actually denominated in
 * (`procurement_orders.unit_type`: bottle|case|keg|pack|split_case|each|liter).
 *
 * This exists because the door counts BOTTLES and the order is placed in
 * whatever the distributor sells — so "5" on a case order is five cases, not
 * five bottles. ADR 0054 fixed that arithmetic server-side; the pack size lives
 * on the order row and is NOT re-derivable here, so this function never
 * multiplies. It only names the unit it was given.
 */
const UNIT_PLURAL: Record<string, [string, string]> = {
  bottle: ['bottle', 'bottles'],
  case: ['case', 'cases'],
  keg: ['keg', 'kegs'],
  pack: ['pack', 'packs'],
  split_case: ['split case', 'split cases'],
  each: ['unit', 'units'],
  liter: ['litre', 'litres'],
};

export function fmtUnits(qty: number | null | undefined, unitType: string | null | undefined): string {
  const n = num(qty);
  if (n === null) return EM;
  const rounded = Math.round(n);
  const key = (unitType ?? '').trim().toLowerCase();
  const pair = UNIT_PLURAL[key];
  // An unrecognised unit is shown verbatim rather than folded into "bottles":
  // guessing the unit is the whole defect this replaced.
  if (!pair) return key ? `${rounded} ${key}` : `${rounded} (unit unknown)`;
  return `${rounded} ${rounded === 1 ? pair[0] : pair[1]}`;
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

/** "3h ago" / "2d ago" for queue ages. Unknown stays a dash. */
export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return EM;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return EM;
  const h = Math.max(0, Math.round((Date.now() - t) / 3_600_000));
  if (h < 1) return 'under an hour ago';
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/* Type stacks — the OrdersNext precedent: Fraunces is not loaded app-wide,
   Georgia is the honest fallback. Figures always sit in the mono. */
export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const SANS = '"DM Sans", "Plus Jakarta Sans", system-ui, sans-serif';

/** The mono caption label used across the page. */
export const capStyle = {
  fontFamily: MONO,
  fontSize: 9,
  fontWeight: 500,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-4, #665D50)',
} as const;
