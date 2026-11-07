/**
 * The house's shared formatters — the ones more than one page speaks.
 *
 * WHY THIS FILE EXISTS. `/providers`'s Terms section and `/settings`'s
 * VendorTerms section are two doors onto one register, so they must print a
 * cutoff, a delivery week and a minimum IDENTICALLY — a term that read one way
 * on the vendor's row and another way in the house-wide table would be two
 * facts wearing one name. Until 2026-09-04 they shared them by having
 * `pages/providers/next/` import `pages/settings/next/st-format.ts`: correct in
 * behaviour, wrong in shape. A page reaching into another page's module makes
 * the second page's private vocabulary load-bearing for the first, so nobody
 * can trim `st-format.ts` without reading `/providers`, and the next page that
 * needs a cutoff has to pick which page to borrow from.
 *
 * So the shared half is hoisted here and `st-format.ts` re-exports it. Nothing
 * about the output changed — these are the same functions, moved — and
 * `/settings` keeps importing its own module, because a page's formatters are
 * still the page's until a second page needs them.
 *
 * WHAT BELONGS HERE: a formatter two or more Mudavym pages use, and the words
 * they must agree on. What does NOT: a page's own copy, its section vocabulary,
 * its type faces. `EM` is here because the em dash is a house rule, not a page
 * preference — ADR 0020: an unknown is an em dash, never a zero and never a
 * confident "just now".
 */

export const EM = '—';

/* ── The vendor-terms vocabulary, spoken on two pages ─────────────────────── */

/**
 * Where one term came from. The gateway's four sources
 * (`vendor-terms/vendor-terms.service.ts`) collapse into three words on the
 * page, because "stated by a person" and "already on the vendor record" are
 * both the house's own answer — they differ only in which form somebody typed
 * it into, and the row says which.
 */
export type TermSource = 'stated' | 'vendor_record' | 'inferred' | 'unknown';

export const SOURCE_LABEL: Record<TermSource, string> = {
  stated: 'stated by the house',
  vendor_record: 'on the vendor record',
  inferred: 'inferred',
  unknown: 'unknown',
};

export const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

/** "Monday, Wednesday and Friday" — or the sentence for an empty statement. */
export function fmtWeekdays(days: number[] | null | undefined): string {
  if (!days) return EM;
  if (days.length === 0) return 'no fixed days';
  if (days.length === 7) return 'every day';
  const names = [...days].sort((a, b) => a - b).map((d) => WEEKDAY_NAMES[d] ?? String(d));
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Money, in the house's own currency.
 *
 * `restaurants.currency` is `DEFAULT 'USD'`, so a house that never set one is
 * indistinguishable from a house in dollars. The caller passes `isDefault` and
 * the register prints the caveat once, at the top, rather than beside every
 * figure — which would be true and unreadable.
 */
export function fmtMoney(
  value: number | null | undefined,
  /**
   * The house's ISO 4217 code, or `null` when nobody has been asked.
   *
   * `null` became reachable on 2026-09-05: `restaurants.currency` carried
   * `DEFAULT 'USD'` and every one of the fourteen production houses therefore
   * asserted dollars, two of them in Turkiye and one in London (ADR 0117 Q25).
   * With the default dropped, "not recorded" is a real state and this function
   * must render it as one. It does NOT fall back to USD, and it does not print a
   * bare symbol: a currency mark is a claim about the amount.
   */
  currency: string | null | undefined,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM;
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
    return `${value.toLocaleString('en-GB')} (currency not recorded)`;
  }
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
  } catch {
    // A well-formed ISO code `Intl` does not know. The number is still true.
    return `${value.toLocaleString('en-GB')} ${currency}`;
  }
}

/** "closes 14:00, the day before" / "closes 11:00 on the day". */
export function fmtCutoff(time: string | null, offsetDays: number | null): string {
  if (!time) return EM;
  if (offsetDays === null || offsetDays === undefined) return time;
  if (offsetDays === 0) return `${time}, same day`;
  if (offsetDays === 1) return `${time}, the day before`;
  return `${time}, ${offsetDays} days before`;
}

/* ── Dates ───────────────────────────────────────────────────────────────── */

/** Relative "last written" for a provenance line. EM when there is no date. */
export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return EM;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return EM;
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 90) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? 'an hour ago' : `${h} hours ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return d === 1 ? 'yesterday' : `${d} days ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Absolute date, for a `title=` on the relative one.
 *
 * Hoisted alongside `fmtWhen` rather than left behind it: the pair is one
 * idea — a date a person can read at a glance, with the exact one underneath —
 * and splitting them across two modules is how the exact half quietly stops
 * being applied.
 */
export function fmtExact(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const t = new Date(iso);
  return Number.isFinite(t.getTime()) ? t.toLocaleString() : undefined;
}
