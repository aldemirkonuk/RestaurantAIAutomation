/**
 * ReceivingNext formatting — the same honesty contract as OrdersNext
 * (`pages/orders/next/format.ts`, copied per the one-format-file-per-page
 * precedent rather than imported across pages): an unknown renders as an em
 * dash, never as a zero. A zero is a claim; a dash is an admission.
 */

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

/** Whole-dollar form of the same. A summed window is a lower bound on the sum. */
export function fmtMoneyWholeFloor(v: number | null | undefined, atFloor: boolean): string {
  const n = num(v);
  if (n === null) return EM;
  return atFloor ? `${GE}${moneyWhole.format(n)}` : moneyWhole.format(n);
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
  color: 'var(--ink-3, #7C7365)',
} as const;
