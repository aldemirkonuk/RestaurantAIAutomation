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
 * All seven registers now have a route of their own. `/spirits`,
 * `/non-alcoholic` and `/soft-drinks` were added to `App.tsx:321-323` by the
 * parent session on 2026-09-03 — this map and those routes have to move
 * together, because an entry here with no route behind it is a dead link and a
 * route with no entry here sends every in-page link to the query-string
 * fallback instead.
 *
 * `registerHref` keeps that fallback for exactly one reason: it is what any
 * register added to the vocabulary in future gets, for free, until somebody
 * gives it a route.
 */
export const REGISTER_ROUTE: Partial<Record<RegisterId, string>> = {
  wines: '/wines',
  beer: '/beer',
  whiskey: '/whiskey',
  cocktails: '/cocktails',
  spirits: '/spirits',
  non_alcoholic: '/non-alcoholic',
  soft_drinks: '/soft-drinks',
};

/** Where a register opens: its own route, or the parent with a query. */
export function registerHref(id: RegisterId): string {
  return REGISTER_ROUTE[id] ?? `/cellar?register=${id}`;
}

/* ── what this house's book is CALLED ──────────────────────────────────── */

/**
 * THE PARENT'S NAME, CHOSEN BY WHAT THE HOUSE POURS.
 *
 * The founder, fourth pass: *"What if there is only non-alcoholic, then what do
 * we do? do we say soft drinks? just drinks?"* — and then, on the answer:
 * **adaptive** — "The Cellar" when wine or spirits are on, "The Bar" when only
 * beer/cocktails/non-alcoholic, "Drinks" when only non-alcoholic and soft
 * drinks; one surface, the route stays `/cellar`.
 *
 * WHY A NAME AND NOT A ROUTE. The route, the sidebar entry and the breadcrumb
 * all stay `/cellar` — an adaptive URL would break every link, every bookmark
 * and every sentence anybody has ever written about this page. What adapts is
 * the one thing that was previously a small lie: the headline. A café that
 * pours Turkish coffee and ayran was being shown a page called The Cellar,
 * which is the same fault the four hard-coded registers had before the second
 * pass — presence asserted where there is none.
 *
 * WHY IT CANNOT FLICKER. The name is a pure function of the registers readout,
 * which is one authoritative row per (restaurant, register) in
 * `restaurant_cellar_registers`, inferred once and confirmed at onboarding. It
 * is stable for a house, not recomputed per render. While the readout is
 * unread the name is `The Cellar` — the route's own name, and the page says the
 * set has not been established rather than guessing a different one and
 * changing it a second later.
 *
 * "Soft drinks" is refused as a name for a deliberate reason: it is already the
 * name of one of the seven registers, so a parent called Soft drinks would
 * collide with its own child in the spine and in every sentence.
 */
export type HouseName = 'The Cellar' | 'The Bar' | 'Drinks';

/** Registers that make a house one that KEEPS bottles. */
const KEEPING: RegisterId[] = ['wines', 'spirits', 'whiskey'];
/** Registers that make a house one that POURS but does not keep. */
const POURING: RegisterId[] = ['beer', 'cocktails'];

export interface HouseNaming {
  name: HouseName;
  /** The sentence the page prints under the headline. */
  because: string;
  /** True when nothing has been established and the default was used. */
  unestablished: boolean;
}

/**
 * The ladder, closed and in order. `carried` is the set of registers this house
 * has on; an empty or unread set falls to the route's own name.
 */
export function houseNaming(carried: RegisterId[] | null): HouseNaming {
  if (carried === null || carried.length === 0) {
    return {
      name: 'The Cellar',
      because:
        'Which registers this house carries has not been established, so this page keeps the name its route has and claims nothing about what is poured here.',
      unestablished: true,
    };
  }
  const has = (ids: RegisterId[]) => ids.some((id) => carried.includes(id));

  if (has(KEEPING)) {
    return {
      name: 'The Cellar',
      because:
        'Called the Cellar because this house keeps bottles — wine or spirits are on its registers. Change which registers it carries in Settings.',
      unestablished: false,
    };
  }
  if (has(POURING)) {
    return {
      name: 'The Bar',
      because:
        'Called the Bar, not the Cellar, because this house pours beer or cocktails and keeps no wine or spirits. A bar without alcohol is still a bar — the trade has called them that for a century — so this name holds whether or not the alcohol is real.',
      unestablished: false,
    };
  }
  return {
    name: 'Drinks',
    because:
      'Called Drinks because nothing alcoholic is on this house’s registers. Not “soft drinks” — that is the name of one of the seven registers, and a parent cannot share a name with its own child.',
    unestablished: false,
  };
}

/**
 * The naming, taken straight off a registers readout — the ONE place the
 * `decidedBy === 'unknown'` guard is written.
 *
 * It exists because the fourth pass's first cut applied the rule at the root
 * and nowhere else: `/beer` and `/wines` still said "The Cellar" in their
 * breadcrumb, so a Drinks-only house read the truth on the parent and the old
 * lie one click deep. Three surfaces now call this, and none of them carries a
 * second copy of the rule.
 *
 * Structurally typed on purpose: the readout view-model lives in
 * `useCellarNextData`, which imports this file, so naming its type here would
 * close a cycle. What is actually needed is two fields.
 *
 * `'mixed'` is deliberately NOT treated as unknown: it means several registers
 * were decided by different routes, which is established, not unestablished.
 * Only `'unknown'` falls back to the route's own name.
 */
export function houseNamingFor(
  readout:
    | { carried: RegisterId[]; decidedBy: DecidedBy | 'mixed' }
    | null
    | undefined,
): HouseNaming {
  return houseNaming(
    readout && readout.decidedBy !== 'unknown' ? readout.carried : null,
  );
}

/* ── which view of the parent opens first ──────────────────────────────── */

/**
 * THE WHOLE-CELLAR VIEW AS THE DEFAULT, FOR A SMALL HOUSE.
 *
 * The founder's decision: a house whose confirmed registers row has **three or
 * fewer** registers opens `/cellar` on the whole view — every register in one
 * table — and a house with more opens on the parent, registers as their own
 * rows, with the whole view still one button away.
 *
 * WHY A THRESHOLD AT ALL. The whole view costs one read per register. For a
 * meyhane carrying five or six that is a real page load nobody asked to be
 * expensive, and the registers are worth reading one at a time. For a café
 * carrying two, the register cards ARE the whole cellar with an extra click in
 * front of them, and the flat table is simply the page.
 *
 * COMPUTED FROM THE SAME READOUT AS THE NAME, so the two can never disagree:
 * both are pure functions of `restaurant_cellar_registers`, which is inferred
 * once and confirmed at onboarding. Stable per house, not per session, and not
 * recomputed per render.
 *
 * AN UNREAD READOUT NEVER OPENS THE WHOLE VIEW, and this is the load-bearing
 * clause rather than a nicety: the whole view fires one read per carried
 * register, so opening it against a set nobody has established would fire reads
 * for registers this house may not have — asserting a set in the network layer
 * that the page refuses to assert in words. Unread falls to the parent, which
 * already says the set could not be read.
 *
 * AND A SET WITH NO NON-WINE REGISTER NEVER OPENS IT EITHER. `/wines` is served
 * by a different endpoint with the inventory overlay laid over it, so the whole
 * view deliberately excludes it (`WholeCellar.tsx`). A wines-only house is at
 * the threshold and would open on an empty table — the count would be right and
 * the page would be wrong. It falls to the parent, and says so.
 */
export const WHOLE_CELLAR_THRESHOLD = 3;

/** Registers the whole view can actually read. Wines are served elsewhere. */
const WHOLE_CELLAR_SERVES = (ids: RegisterId[]): RegisterId[] =>
  ids.filter((id) => id !== 'wines');

export interface ParentView {
  /** True when `/cellar` opens on the whole-cellar table. */
  whole: boolean;
  /** The sentence the page prints beside the naming rule. */
  because: string;
}

export function parentView(
  readout:
    | { carried: RegisterId[]; decidedBy: DecidedBy | 'mixed' }
    | null
    | undefined,
): ParentView {
  if (!readout || readout.decidedBy === 'unknown') {
    return {
      whole: false,
      because:
        'This page opens on its registers because the set this house carries has not been established. The whole-cellar table is one read per register, and it is not fired against a set nobody has confirmed.',
      };
  }
  const n = readout.carried.length;
  const servable = WHOLE_CELLAR_SERVES(readout.carried).length;

  if (n > WHOLE_CELLAR_THRESHOLD) {
    return {
      whole: false,
      because: `This house carries ${n} registers, so the page opens on them one at a time; the whole cellar in one table is a button away, and costs one read per register. Houses with ${WHOLE_CELLAR_THRESHOLD} or fewer open on it instead.`,
    };
  }
  if (servable === 0) {
    return {
      whole: false,
      because:
        'This house carries few enough registers to open on the whole cellar, and it carries only wines — which the whole-cellar table does not serve, because a wine row carries a stock figure and the other kinds cannot. Opening on it would open on an empty table, so the page opens on its registers.',
    };
  }
  return {
    whole: true,
    because: `This house carries ${n} register${n === 1 ? '' : 's'}, so the page opens on all of them at once rather than making you choose one first. Houses with more than ${WHOLE_CELLAR_THRESHOLD} open on their registers instead.`,
  };
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

/* ── the house's own record ────────────────────────────────────────────────
   DESIGN-FOUNDATION.md §6 names it as this page's exponential idea: "the
   house's own record on every bottle — first bought, what we have paid, what
   we poured … who quoted it". These are the words that record is rendered in.
   Every one of them can be the em dash, and the em dash means unknown, never
   none.                                                                     */

/**
 * A date of record: "2 Mar 2026", or the dash. Never "today", never a guess.
 *
 * THE TIMEZONE IS LOAD-BEARING HERE, and it was caught wrong in test before it
 * ever reached a screen. Two different kinds of value arrive at this function:
 *
 *  - a CALENDAR DATE — `procurement_documents.doc_date` is a Postgres `date`
 *    and arrives as `2026-03-02`. `new Date('2026-03-02')` parses that as UTC
 *    midnight, and rendering it in a timezone west of UTC prints **1 Mar**. An
 *    invoice dated the 2nd showing as the 1st is precisely the class of quiet
 *    error this whole register exists to refuse, so a date-only string is
 *    formatted in UTC and stays the day the document says.
 *  - an INSTANT — `pos_unresolved_lines.created_at` is a `timestamptz` and
 *    names a moment. That one IS rendered in the reader's own timezone,
 *    because "when did we last sell it" is a question about their evening.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return EM;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EM;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(DATE_ONLY.test(iso) ? { timeZone: 'UTC' } : {}),
  });
}

/** The five books, in the order the house would read them. */
export const BOOK_ORDER = ['menu', 'invoice', 'order', 'quote', 'pos'] as const;
export type HouseBookId = (typeof BOOK_ORDER)[number];

/**
 * The operator's word for each book, not the schema's. A row's strip of marks
 * is the fastest honest summary there is of "how well do we know this bottle".
 */
export const BOOK_LABEL: Record<HouseBookId, string> = {
  menu: 'on the list',
  invoice: 'invoiced',
  order: 'ordered',
  quote: 'quoted',
  pos: 'sold',
};

/** Which table each mark was read from — shown, so the claim is checkable. */
export const BOOK_SOURCE: Record<HouseBookId, string> = {
  menu: 'menu_items',
  invoice: 'procurement_document_lines, on documents of type invoice',
  order: 'procurement_order_items',
  quote: 'vendor_price_observations, this restaurant’s rows only',
  pos: 'pos_unresolved_lines — the till lines the POS bridge could not map to a wine',
};

/**
 * `vendor_price_observations.source_type`, in the vocabulary `/vendor-prices`
 * already uses. An unrecognised value is shown verbatim rather than bucketed:
 * the column has no CHECK constraint, and renaming a value we do not know
 * would be inventing provenance.
 */
export function quoteSource(v: string | null): string {
  switch (v) {
    case 'invoice': return 'an invoice';
    case 'catalogue': return 'a catalogue';
    case 'quote': return 'a quote';
    case 'rep_message': return 'a rep’s message';
    case 'social': return 'a social post';
    case 'manual': return 'a manual entry';
    case 'scrape': return 'a scraped page';
    default: return v ? `“${v}”` : 'an unstated source';
  }
}

/**
 * How this house's line reached the shared catalogue. Rendered on every row
 * that has a catalogue entry, because a weaker join presented with the same
 * confidence as a strong one is the quiet kind of lie.
 */
export function matchNote(matchedBy: 'exact' | 'contains' | null): string | null {
  if (matchedBy === 'exact')
    return 'This house’s own line and the catalogue entry carry the same words.';
  if (matchedBy === 'contains')
    return 'Matched loosely: every word of the catalogue entry appears in this house’s line, which carries more besides. A different bottle with the same words would match too.';
  return null;
}

/**
 * The sentence a register carries when this house's books hold nothing of the
 * kind. Never "you have none" — the books may simply not be here yet.
 */
export function noHouseRowsLine(id: RegisterId): string {
  return `Nothing in this house’s menu, invoices, orders, quotes or till lines names ${REGISTER_TITLE[id].toLowerCase()}. ${addRowsPrompt(id)}`;
}
