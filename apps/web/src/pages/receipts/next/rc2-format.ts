/**
 * ReceiptsNext formatting — E48/E49 carried: an unknown is an em dash; a
 * tri-state null (a check that could not run) is never rendered as a pass.
 */

import { currencyLabel, formatMoney } from '@/lib/currency';

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
 * `doc_date` is a Postgres `date` value (no time, no zone). Parsed bare, JS
 * reads it as UTC midnight and renders the PRIOR day west of UTC — construct
 * it as a local calendar day instead. Rolled-over impossibilities
 * ('2026-02-30') are refused, not silently normalized. (Backported from
 * documents-reports/next/so-format.ts's parseDay.)
 */
function parseDay(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d
    ? date
    : new Date(NaN);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return EM;
  const d = parseDay(iso) ?? new Date(iso);
  if (!Number.isFinite(d.getTime())) return EM;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

/** Parse an edited money/number cell; empty clears to null, junk is rejected. */
export function parseCell(raw: string): number | null | 'invalid' {
  const t = raw.trim().replace(/^\$/, '');
  if (t === '' || t === EM) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : 'invalid';
}
