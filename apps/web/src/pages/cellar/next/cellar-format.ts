/**
 * Cellar formatting — the house honesty rule in one place: an unknown is an
 * em dash, never a zero and never a guess.
 *
 * Three of these exist because the wire lies by omission on this page:
 *  - `price_reference` is mapped by the gateway as `price: row.price_reference ?? 0`
 *    (wines.service.ts:82) — so a bottle with no reference price arrives as the
 *    number 0. `money()` treats 0 as unknown for that field on purpose (see
 *    `refPrice`), because "$0" is a claim the library cannot support.
 *  - `retailPriceAvg` is null on all 442 rows (v3.0-TECH-DEBT.md:543-549 —
 *    the sentence is at :547; an earlier draft of this file cited :432-440,
 *    which is an unrelated roadmap section), so
 *    the market column renders the dash for every bottle until an enrichment
 *    producer exists. It is not hard-coded to a dash — a real value would show.
 *  - `vintage` absent is the dash, not "NV". "NV" asserts non-vintage; missing
 *    asserts nothing.
 */

export const EM = '—';

/**
 * The page's one sans stack. The serif and mono stacks are NOT duplicated here
 * — `.cl-serif` and `.cl-num` in cellar-next.css own them, so a font stack has
 * exactly one home and a change to it cannot half-land.
 */
export const SANS = '"Plus Jakarta Sans", "DM Sans", system-ui, sans-serif';

/**
 * Fraunces — the house serif. index.html loads the sans and the mono but not
 * Fraunces, and index.html is a shared file this page may not touch, so the
 * page injects the stylesheet itself, once. Georgia carries the text until (or
 * if) the webfont lands, so nothing here can break the page. (Copied from
 * dashboard/next/fonts.ts by the wave rule — pages do not import each other.)
 */
const FRAUNCES_LINK_ID = 'mudavym-fraunces';

export function ensureFraunces(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(FRAUNCES_LINK_ID)) return;
  const link = document.createElement('link');
  link.id = FRAUNCES_LINK_ID;
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..680;1,9..144,300..680&display=swap';
  document.head.appendChild(link);
}

/** A finite number, or null. Guards NaN and the API's occasional string. */
export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** A non-empty trimmed string, or null. `'Unknown'` from the wire is not data. */
export function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t === '' || t.toLowerCase() === 'unknown' || t.toLowerCase() === 'n/a') return null;
  return t;
}

/** Money of record, or the dash. */
export function money(v: number | null | undefined): string {
  const n = num(v);
  if (n === null) return EM;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The gateway's `price` field, read honestly: 0 is its "no reference price"
 * sentinel (`price_reference ?? 0`), not a price of zero.
 */
export function refPrice(v: unknown): number | null {
  const n = num(v);
  return n === null || n === 0 ? null : n;
}

/** "750ml" / "1.5L" / the dash. */
export function volume(ml: number | null | undefined): string {
  const n = num(ml);
  if (n === null || n <= 0) return EM;
  return n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 1 : 2)}L` : `${n}ml`;
}

/** A vintage year, or the dash. Never "NV" — that is a claim, absence is not. */
export function year(v: number | null | undefined): string {
  const n = num(v);
  if (n === null || n < 1000) return EM;
  return String(n);
}

/** Plain count, or the dash. */
export function count(v: number | null | undefined): string {
  const n = num(v);
  return n === null ? EM : n.toLocaleString('en-US');
}

/**
 * Enrichment provenance, as the gateway states it (`data_enrichment.knowledge`,
 * BEVERAGE_CATALOGUE_ARCHITECTURE.md §9.3). 76% of the library is `inferred` —
 * a typical profile for the grape and region, not a fact about THIS bottle —
 * and the cellar book says which is which rather than flattening them.
 */
export type Knowledge = 'known' | 'inferred' | 'unknown';

export function knowledgeOf(v: unknown): Knowledge | null {
  return v === 'known' || v === 'inferred' || v === 'unknown' ? v : null;
}

export function knowledgeLabel(k: Knowledge | null): string {
  if (k === 'known') return 'recalled';
  if (k === 'inferred') return 'reasoned';
  if (k === 'unknown') return 'unrecorded';
  return 'unattributed';
}

export function knowledgeNote(k: Knowledge | null): string {
  if (k === 'known') return 'These notes are recorded facts about this bottle.';
  if (k === 'inferred')
    return 'These notes were reasoned from the grape and the region — a typical profile, not a tasting of this bottle.';
  if (k === 'unknown') return 'Enrichment ran and recorded nothing for this bottle.';
  return 'This bottle carries no provenance mark, so the standing of its notes is unstated.';
}

/** The four registers of the cellar, in the founder's own order. */
export type RegisterId = 'wines' | 'beer' | 'whiskey' | 'cocktails';

export const REGISTER_ORDER: RegisterId[] = ['wines', 'beer', 'whiskey', 'cocktails'];

export const REGISTER_TITLE: Record<RegisterId, string> = {
  wines: 'Wines',
  beer: 'Beer',
  whiskey: 'Whiskey',
  cocktails: 'Cocktails',
};

export const REGISTER_PATH: Record<RegisterId, string> = {
  wines: '/wines',
  beer: '/beer',
  whiskey: '/whiskey',
  cocktails: '/cocktails',
};
