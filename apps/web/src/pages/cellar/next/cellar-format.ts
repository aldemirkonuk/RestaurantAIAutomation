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

/* ── the registers ─────────────────────────────────────────────────────── */

/**
 * THE SEVEN REGISTERS (founder, 2026-09-03). The four the page shipped with
 * were a global constant drawn identically for every tenant, which told a
 * non-alcoholic house it had an empty whiskey programme. The set is now the
 * house's own: `GET /cellar/:rid/registers` decides which of these seven are
 * on, and this array is only the vocabulary and its order.
 *
 * `whiskey` ⊂ `spirits` and `soft_drinks` ⊂ `non_alcoholic` on purpose — a
 * whiskey bar is a different house from a cocktail bar that stocks bourbon.
 */
export type RegisterId =
  | 'wines'
  | 'beer'
  | 'whiskey'
  | 'cocktails'
  | 'spirits'
  | 'non_alcoholic'
  | 'soft_drinks';

export const REGISTER_ORDER: RegisterId[] = [
  'wines',
  'beer',
  'whiskey',
  'spirits',
  'cocktails',
  'non_alcoholic',
  'soft_drinks',
];

export const REGISTER_TITLE: Record<RegisterId, string> = {
  wines: 'Wines',
  beer: 'Beer',
  whiskey: 'Whiskey',
  cocktails: 'Cocktails',
  spirits: 'Spirits',
  non_alcoholic: 'Non-alcoholic',
  soft_drinks: 'Soft drinks',
};

/**
 * The four registers that have a route of their own in `App.tsx`. The other
 * three open on the parent as `?register=<id>`, which is deep-linkable and
 * needs no route — `App.tsx` is outside this page's paths and adding three
 * routes there is filed in the page note §9 rather than done here.
 */
export const REGISTER_ROUTE: Partial<Record<RegisterId, string>> = {
  wines: '/wines',
  beer: '/beer',
  whiskey: '/whiskey',
  cocktails: '/cocktails',
};

/** Where a register opens: its own route, or the parent with a query. */
export function registerHref(id: RegisterId): string {
  return REGISTER_ROUTE[id] ?? `/cellar?register=${id}`;
}

/* ── how a register's answer was reached ───────────────────────────────── */

/** Mirrors the gateway's `DecidedBy` (cellar/cellar-registers.ts). */
export type DecidedBy = 'inferred' | 'confirmed' | 'manual' | 'unknown';
export type Confidence = 'certain' | 'likely' | 'none' | 'unknown';

/**
 * The one-line answer to "how was this decided, and where do I change it?" —
 * the sentence the founder asked for. Four sentences, because the four states
 * are genuinely different and flattening them is what produced a cellar that
 * lied to a non-alcoholic house.
 */
export function decidedLine(decidedBy: DecidedBy | 'mixed'): string {
  switch (decidedBy) {
    case 'confirmed':
      return 'These registers are the ones the house confirmed. Change them in Settings.';
    case 'manual':
      return 'These registers were switched on by hand. Change them in Settings.';
    case 'mixed':
      return 'Some of these registers the house confirmed; the rest were read from its own books. Change them in Settings.';
    case 'inferred':
      return 'These registers were read from this house’s own cellar and menu, and nobody has confirmed them yet. Change them in Settings.';
    default:
      return 'Nothing has been counted or put on a menu yet, so which registers this house carries is unknown — not empty. Set them in Settings.';
  }
}

/** The sentence for one register, with its own evidence. */
export function confidenceLabel(c: Confidence): string {
  if (c === 'certain') return 'certain';
  if (c === 'likely') return 'likely';
  if (c === 'none') return 'nothing found';
  return 'unknown';
}

/**
 * The ask when a register is on and this house's books hold nothing of the
 * kind — **register by register**, not one blanket sentence.
 *
 * AMENDED 2026-09-03 after the founder's backtest of this notice
 * (`backtest-register-prompt-2026-09-03.md` §6.1). One sentence for all seven
 * registers produces the very fate the inline shape was chosen to avoid, just
 * entered through futility instead of interruption: telling a house to "add
 * the items to /inventory" for beer is telling it to do something the software
 * cannot yet accept, because `restaurant_inventory` is keyed on the wine
 * library. Asked once for the impossible, an operator stops reading the notice.
 *
 * So each sentence names what is actually actionable TODAY for that register,
 * and where it is not, it says why rather than asking anyway.
 */
export function addRowsPrompt(id: RegisterId): string {
  switch (id) {
    case 'wines':
      return 'Add your wines to /inventory, or put them on the menu, so the cellar can count them.';
    case 'beer':
      return 'Put your beers on the menu. /inventory cannot hold a keg yet — it is keyed on the wine library — so the menu is what the house can see today.';
    case 'whiskey':
      return 'Put your whiskies on the menu. /inventory cannot hold a bottle of rye yet — it is keyed on the wine library.';
    case 'spirits':
      return 'Put your spirits on the menu. /inventory cannot hold them yet — it is keyed on the wine library.';
    case 'cocktails':
      return 'Add the cocktail list to the menu. Recipes cannot be recorded at all yet: cocktail_ingredients was created empty and the extraction pass has not run.';
    case 'non_alcoholic':
      return 'Put what you pour to a non-drinker on the menu. /inventory cannot hold it yet — it is keyed on the wine library.';
    default:
      return 'Put your soft drinks on the menu. No catalogue column separates a cola from a kombucha, so the menu is the only place the house can see them.';
  }
}

/**
 * The ask when a register is OFF and this house's books still hold items of
 * the kind — the seasonal-menu case (backtest §6.3, scenario 4). Ending a
 * season on schedule is a correct, deliberate act, so this is never a warning
 * and never a confirm dialog: it says what is still there and offers the two
 * real choices.
 */
export function strandedPrompt(id: RegisterId, n: number): string {
  const what =
    id === 'cocktails'
      ? n === 1 ? 'cocktail' : 'cocktails'
      : id === 'wines'
        ? n === 1 ? 'wine' : 'wines'
        : id === 'whiskey'
          ? n === 1 ? 'whisky' : 'whiskies'
          : `${REGISTER_TITLE[id].toLowerCase()} ${n === 1 ? 'line' : 'lines'}`;
  return `${n.toLocaleString('en-US')} ${what} ${n === 1 ? 'is' : 'are'} still in this house’s books.`;
}
