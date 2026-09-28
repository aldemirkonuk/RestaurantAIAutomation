/**
 * The composer's words. An unknown is an em dash, a window is a window, and a
 * provenance chip never invents a date it was not given.
 */

export const EM = '—';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const SANS = '"DM Sans", "Plus Jakarta Sans", system-ui, sans-serif';

const dayFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const clockFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return EM;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? dayFmt.format(d) : EM;
}

export function fmtClock(iso: string | null | undefined): string {
  if (!iso) return EM;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? clockFmt.format(d) : EM;
}

/**
 * The window a sentence was computed over. Both ends or neither — a half-known
 * window printed as "12 Aug — —" reads as an open-ended claim the engine never
 * made.
 */
export function fmtWindow(start: string | null, end: string | null): string {
  if (!start || !end) return EM;
  return `${fmtDay(start)} to ${fmtDay(end)}`;
}

/** "2 minutes", "45 seconds" — the undo window said the way a person reads it. */
export function fmtWindowLength(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return EM;
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** Seconds left before a queued letter leaves, floored at zero. */
export function secondsLeft(dispatchAt: string | null, now = Date.now()): number | null {
  if (!dispatchAt) return null;
  const at = new Date(dispatchAt).getTime();
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

const CATEGORY_LABELS: Record<string, string> = {
  order_confirmation: 'Order confirmation',
  price_query: 'Price query',
  delivery_dispute: 'Delivery dispute',
  invoice_mismatch: 'Invoice mismatch',
  promotion_reply: 'Promotion reply',
};

export function categoryLabel(category: string | null | undefined): string {
  if (!category) return EM;
  return CATEGORY_LABELS[category] ?? category.replace(/_/g, ' ');
}

/**
 * Whether an address looks like an address at all.
 *
 * Deliberately loose: the book, not this function, decides whether a letter may
 * go to it. This only decides whether "add to the book" is worth offering, and
 * a stricter pattern here would refuse real addresses before the server ever
 * saw them.
 */
export function looksLikeAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
