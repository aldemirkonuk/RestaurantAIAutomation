/**
 * ReceivingNext formatting — the same honesty contract as OrdersNext
 * (`pages/orders/next/format.ts`, copied per the one-format-file-per-page
 * precedent rather than imported across pages): an unknown renders as an em
 * dash, never as a zero. A zero is a claim; a dash is an admission.
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

/** Whole-dollar form for the recovered figure. Unknown stays a dash. */
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
  color: 'var(--ink-3, #7C7365)',
} as const;
