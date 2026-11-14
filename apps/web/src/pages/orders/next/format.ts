/**
 * OrdersNext formatting — one rule above all others: an unknown renders as an
 * em dash, never as a zero. A zero is a claim; a dash is an admission.
 */

import { formatMoney } from '@/lib/currency';
import { fmtMoney as fmtMoneyIn } from '../../receipts/next/rc2-format';

export const EM = '—';

/** A finite number or null. Guards against NaN and the API's occasional string. */
export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Money in the ORDER's own currency via the shared receipts formatter; no code prints bare with its caveat. */
export function fmtMoney(v: number | null | undefined, code: string | null | undefined): string {
  const n = num(v);
  return n === null ? EM : fmtMoneyIn(n, code);
}

/**
 * Whole-unit month form, with the same sign as every other amount on the page.
 *
 * `formatMoney` prints the code where the default display has no sign of its
 * own, so a lira month read "TRY 12,480" beside rows reading "₺2,520.00" (r10
 * walk). The narrow sign is asked of Intl and used only when it is one
 * character from Unicode's currency-symbol block (₺ ₽ ₴ …), the rule of the
 * receipts formatter the rows use: a narrow "$", "kr" or "£" is shared by
 * several monies, so those keep their code.
 *
 * A zero with no currency prints "0": no orders is the same amount in every
 * money, and "0 (currency not recorded)" said a caveat about nothing.
 */
export function fmtMoneyWhole(v: number | null | undefined, code: string | null | undefined): string {
  const n = num(v);
  if (n === null) return EM;
  const iso = typeof code === 'string' && /^[A-Z]{3}$/.test(code) ? code : null;
  if (n === 0 && iso === null) return '0';
  const said = formatMoney(n, iso, { maximumFractionDigits: 0 });
  if (iso === null || !said.includes(iso)) return said;
  try {
    const glyph = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: iso,
      currencyDisplay: 'narrowSymbol',
    })
      .formatToParts(0)
      .find((x) => x.type === 'currency')?.value;
    if (glyph && /^[\u20A0-\u20CF]$/.test(glyph))
      return said.replace(iso, glyph).replace(/^(\D*?[^\d\s-])\s+(?=\d)/, '$1');
  } catch {
    // An engine without narrowSymbol keeps the code, which is still honest.
  }
  return said;
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
