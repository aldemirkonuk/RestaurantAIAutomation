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

/** Whole-unit month form via `formatMoney` (the shared formatter has no whole variant, so no narrow sign). */
export function fmtMoneyWhole(v: number | null | undefined, code: string | null | undefined): string {
  const n = num(v);
  return n === null ? EM : formatMoney(n, code, { maximumFractionDigits: 0 });
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
