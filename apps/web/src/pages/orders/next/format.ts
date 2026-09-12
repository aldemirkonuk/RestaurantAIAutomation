/**
 * OrdersNext formatting — one rule above all others: an unknown renders as an
 * em dash, never as a zero. A zero is a claim; a dash is an admission.
 */

export const EM = '—';

/** A finite number or null. Guards against NaN and the API's occasional string. */
export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function fmtMoney(v: number | null | undefined): string {
  const n = num(v);
  return n === null ? EM : money.format(n);
}

/** Whole-dollar form for the month figure ($12,480). Unknown stays a dash. */
const moneyWhole = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export function fmtMoneyWhole(v: number | null | undefined): string {
  const n = num(v);
  return n === null ? EM : moneyWhole.format(n);
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
