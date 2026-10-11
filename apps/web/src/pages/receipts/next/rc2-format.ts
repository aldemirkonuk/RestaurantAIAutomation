/**
 * ReceiptsNext formatting — E48/E49 carried: an unknown is an em dash; a
 * tri-state null (a check that could not run) is never rendered as a pass.
 */

import { currencyLabel, formatMoney, inHouseMarks } from '@/lib/currency';
import { displayGroupMark, parseDecimal, type GroupMark } from '@/lib/parseDecimal';
import { getHouseLocale } from '@/lib/houseCurrency';
import { getHouseZone } from '@/lib/houseZone';

export const EM = '—';

/** ADR 0051 clause 2 — a windowed count renders as a floor, never as a total. */
export const GE = '≥';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const SANS = '"DM Sans", "Plus Jakarta Sans", system-ui, sans-serif';

/**
 * Money, in the currency the DOCUMENT is in — or the sentence saying it has
 * none.
 *
 * Until 2026-09-06 this interpolated the amount straight after a literal dollar
 * sign, so every figure on this page printed one whatever the vendor billed —
 * including the two TRY invoices production already holds (measured 2026-09-05,
 * `20260905120000_a_house_names_its_money.sql`). The currency now travels with
 * the number because `procurement_documents.currency` was always in the
 * payload and this function simply never asked for it.
 *
 * `undefined` currency is DELIBERATELY not the same as an omitted argument: a
 * caller that has no currency to give gets the number and the caveat from
 * `formatMoney`, which is honest and legible, rather than a wrong symbol. The
 * argument is required so a caller has to think about it — the same reason
 * `PriceCurrencyClaim` has no default form on the gateway side.
 */
export function fmtMoney(
  n: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (n == null || !Number.isFinite(Number(n))) return EM;
  const said = formatMoney(Number(n), currency);
  // THE SIGN, WHERE THE MONEY HAS ONE OF ITS OWN (walk-through W25,
  // 2026-10-01): the queue printed "$547.47" beside "TRY 11,186.40". When the
  // default display fell back to the bare code, ask for the narrow sign, and
  // use it only when it is one character from Unicode's currency-symbol block
  // (₺ ₽ ₴ ₸ …). A narrow "$", "kr" or "£" is shared by several monies, so
  // ARS or SEK keep their code; a money already shown with a sign (CA$) is
  // never touched.
  if (currency && /^[A-Z]{3}$/.test(currency) && said.includes(currency)) {
    try {
      const glyph = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
      })
        .formatToParts(0)
        .find((x) => x.type === 'currency')?.value;
      if (glyph && /^[\u20A0-\u20CF]$/.test(glyph))
        return said.replace(currency, glyph).replace(/^(\D*?[^\d\s-])\s+(?=\d)/, '$1');
    } catch {
      // An engine without narrowSymbol keeps the code, which is still honest.
    }
  }
  return said;
}

/** A server's sentence may come without its full stop; the next one needs it. */
export function sentence(t: string): string {
  const s = t.trim();
  return /[.!?…]$/.test(s) ? s : `${s}.`;
}

/** "Turkish lira (TRY)": the money's name first, its code after (W23). */
export function moneyName(code: string): string {
  const label = currencyLabel(code);
  const prefix = `${code} - `;
  return label.startsWith(prefix) ? `${label.slice(prefix.length)} (${code})` : code;
}

/**
 * A date, the house's way (F-1209, same family as F-903 and F-1135).
 *
 * Two kinds of value arrive here:
 *  - a CALENDAR DATE — `doc_date` is a Postgres `date` (`2026-03-02`, no time,
 *    no zone). Parsed bare, JS reads it as UTC midnight and renders the PRIOR
 *    day west of UTC, so it is written in UTC and stays the day the paper
 *    says. Rolled-over impossibilities ('2026-02-30') are refused, not
 *    silently normalized.
 *  - an INSTANT — a claim's `opened_at`, `requested_at`, a letter's `sentAt`
 *    — names a moment, and its day is the HOUSE's (`getHouseZone`; the page
 *    calls `useHouseZone` so it re-renders when that lands). With no zone
 *    known yet, the device's clock stands in, as everywhere else.
 *
 * Written in the house's formats (`getHouseLocale`), with the year when it is
 * not this year on the house's calendar — a claim opened last March must not
 * read like one opened this March. Digits only, in the house's day and month
 * order, so every word on the page stays English (ADR 0207 q7, F-1279): a
 * Turkish house reads "11/10", never "11 Eki".
 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function zoned(zone: string | null): { timeZone?: string } {
  return zone ? { timeZone: zone } : {};
}

function yearOf(d: Date, zone: string | null): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', ...zoned(zone) }).format(d);
}

export function fmtDate(
  iso: string | null | undefined,
  zone: string | null = getHouseZone(),
  now: Date = new Date(),
): string {
  if (!iso) return EM;
  const m = DATE_ONLY.exec(iso);
  let d: Date;
  let at: string | null;
  if (m) {
    const [y, mo, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    d = new Date(Date.UTC(y, mo - 1, day));
    if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== day) return EM;
    at = 'UTC';
  } else {
    d = new Date(iso);
    at = zone;
  }
  if (!Number.isFinite(d.getTime())) return EM;
  const thisYear = yearOf(d, at) === yearOf(now, zone);
  return new Intl.DateTimeFormat(getHouseLocale(), {
    month: 'numeric',
    day: 'numeric',
    ...(thisYear ? {} : { year: 'numeric' as const }),
    ...zoned(at),
  }).format(d);
}

/**
 * Extraction / match confidence, as the model stated it.
 *
 * ADR 0051 clause 1: a confidence the record does not hold renders as the em
 * dash. There is no default, no "assume high", and no rounding a null to 0% —
 * "the model was 0% sure" and "nobody recorded how sure the model was" are
 * different claims, and this screen asks a human to trust the reading.
 */
export function fmtConfidence(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return EM;
  const v = Number(n);
  // Stored as numeric(4,3) in [0,1]; anything outside that is not a confidence
  // and must not be dressed as one.
  if (v < 0 || v > 1) return EM;
  return `${Math.round(v * 100)}%`;
}

/**
 * What the SERVER said, not what the transport guessed.
 *
 * An axios rejection's `.message` is "Request failed with status code 403" —
 * the same sentence for a permission refusal, a stale document, and a bad
 * patch. The gateway's own sentence is in `response.data.message` (Nest's
 * HttpException body), and it is the only text that tells the manager what to
 * do. A network failure has no server sentence, and must say so rather than
 * borrow one.
 */
export function serverMessage(e: unknown, fallback: string): string {
  const r = (e as { response?: { data?: unknown; status?: number } } | null)?.response;
  const body = r?.data as { message?: unknown; error?: unknown } | undefined;
  const raw = body?.message ?? body?.error;
  const text = Array.isArray(raw) ? raw.join('; ') : typeof raw === 'string' ? raw : null;
  // In the house's words (walk-through W24, 2026-10-01): no "(HTTP 409)"
  // after the server's own sentence, no "(Network Error)" after ours.
  if (text && text.trim()) return text.trim();
  if (r?.status) return 'Mudavym refused it and gave no reason.';
  const transport = e as { request?: unknown; code?: unknown } | null;
  if (transport?.request != null || transport?.code === 'ERR_NETWORK' || transport?.code === 'ECONNABORTED')
    return `${fallback.replace(/\.$/, '')}: no answer came back. Check the connection, then try again.`;
  if (e instanceof Error && e.message) return `${fallback} (${e.message})`;
  return fallback;
}

/**
 * Why a read failed, as the clause inside "Could not read the claims (…)".
 * The same three cases `serverMessage` tells apart, and never the client
 * library's own words (walk-through W26, 2026-10-01): "(Network Error)" and
 * "(Request failed with status code 500)" are not sentences a manager can act on.
 */
export function failureReason(e: unknown): string {
  const r = (e as { response?: { data?: unknown; status?: number } } | null)?.response;
  const body = r?.data as { message?: unknown; error?: unknown } | undefined;
  const raw = body?.message ?? body?.error;
  const text = Array.isArray(raw) ? raw.join('; ') : typeof raw === 'string' ? raw : null;
  if (text && text.trim()) return text.trim().replace(/\.$/, '');
  if (r?.status) return 'refused, with no reason given';
  const transport = e as { request?: unknown; code?: unknown } | null;
  if (transport?.request != null || transport?.code === 'ERR_NETWORK' || transport?.code === 'ECONNABORTED')
    return 'no answer came back';
  return 'the reason is not known';
}

/**
 * The signed URL the detail endpoint mints lives 3600s
 * (documents.controller.ts:195). Treat it as spent a little early: a link that
 * dies mid-render shows a broken image, and on the receipts screen a broken
 * image reads as "there is no paper" rather than "the link aged out".
 */
const SIGNED_URL_TTL_MS = 3_600_000;
const SIGNED_URL_GRACE_MS = 5 * 60_000;

/**
 * A signed link is spent once it is inside the grace window of its hour.
 * `fetchedAt` of 0 means "never fetched", which is not "expired" — react-query
 * reports exactly that before a query has landed.
 */
export function isSignedUrlExpired(fetchedAt: number, now: number): boolean {
  if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return false;
  return now - fetchedAt > SIGNED_URL_TTL_MS - SIGNED_URL_GRACE_MS;
}

/**
 * Parse an edited money/number cell; empty clears to null, junk is rejected.
 *
 * F-1021 (sim wave 37, 2026-10-10): this was a bare `Number()`, so a lira
 * house correcting a unit price to "1.250" saved 1.25 and "1.250,00" was
 * refused with no word why. It now reads by the house's own marks
 * (`lib/parseDecimal.ts`); `group` is `useHouseGroupMark()`.
 */
export function parseCell(raw: string, group: GroupMark | null = null): number | null | 'invalid' {
  const t = raw.trim();
  if (t === '' || t === EM) return null;
  return parseDecimal(t, group) ?? 'invalid';
}

/**
 * A cell's figure as it sits in the box, with the house's decimal mark: a lira
 * house sees "1,25", not "1.25" (F-1021). No thousands mark, so the box reads
 * back exactly what it holds.
 */
export function cellText(value: number | null, group: GroupMark | null): string {
  if (value == null) return '';
  const s = String(value);
  return group === '.' ? s.replace('.', ',') : s;
}

/**
 * A line figure in the house's marks — money in the document's currency, a
 * quantity bare — for the correction strip and the "extracted" note (F-1021):
 * "1250 → 1.25" read as no change in a house that groups with ".".
 */
export function lineFigure(
  n: number | null | undefined,
  currency: string | null | undefined,
  money: boolean,
  group: GroupMark | null,
): string {
  if (n == null || !Number.isFinite(Number(n))) return EM;
  const printed = money ? fmtMoney(n, currency) : Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 });
  return inHouseMarks(printed, displayGroupMark(), group);
}
