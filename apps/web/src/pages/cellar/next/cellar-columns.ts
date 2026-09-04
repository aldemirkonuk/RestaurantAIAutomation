/**
 * WHAT A CELLAR COLUMN REPRESENTS — the vocabulary, per register and for the
 * whole cellar at once.
 *
 * The founder's fourth-pass note: *"research what should the columns represent
 * and help us visualize … what each bev have different columns based on their
 * features, beers might have diff (pilsner, IPA, maya, gaz oranı…) … We show
 * more general columns when they want to see the whole menu inventories at once
 * right?"*
 *
 * THE RULE A COLUMN HAS TO PASS, AND WHY IT IS THIS RULE
 * =====================================================
 * Three tests, in order. A column that fails one is not drawn by default; the
 * reason it is not drawn is carried on the column itself and is readable from
 * the header menu, so a missing column is never a silent decision.
 *
 *   1. IS THERE A WRITER?  A column whose source has no writer can only ever
 *      render an em dash. It is not a column, it is a promise.
 *   2. DOES IT VARY?  A column that is the same value on every row sorts
 *      nothing and filters nothing. `master_wine_library.bottle_size_ml` is
 *      750 on 4,226 of 4,226 rows (measured 2026-09-03) — "Format" on the wine
 *      register is the Body filter's mistake wearing a different label, and
 *      Body was removed for exactly this in the first pass.
 *   3. IS IT OURS?  A fact about this house (what we paid, what we sold) and a
 *      fact about the bottle (its region) are different claims, and the
 *      register says which is which rather than mixing them in one grammar.
 *
 * WHAT THE FIELD'S OWN TOOLS PUT ON A ROW
 * =======================================
 * Measured against the tools the brief named, and the answer is consistent
 * across all of them: **the trade's registers are commercial, not chemical.**
 *
 *   CellarTracker's bulk import takes four REQUIRED columns — Vintage,
 *   UserWine1 (the wine), Quantity, BottleSize — and everything else is
 *   optional; the optional list is Storage Location, Bin, Current Value, Begin
 *   / End Drinking, Store, Purchase Date, Cost, Currency, Bottle Note,
 *   Consumption Date, Consumption Revenue, critics' scores…  Almost all of it
 *   is the OWNER'S record, not the bottle's chemistry.
 *   https://support.cellartracker.com/article/26-migrating-from-another-system
 *
 *   Backbar's own guide to a bar inventory spreadsheet names eight columns:
 *   item/product name, item cost, sale price, product type, subtype, vendor,
 *   size, varietal or style.
 *   https://academy.getbackbar.com/how-to-create-a-liquor-inventory-spreadsheet
 *
 *   BinWise tracks each product by depletion rate, cost and movement, with
 *   supplier and par level per row and actual pour cost for any date range.
 *   https://home.binwise.com/binwise-pro ·
 *   https://home.binwise.com/blog/setting-par-level-inventory
 *
 *   Partender's row is a bottle level as a fraction of full, resolving to value
 *   on hand in wholesale AND retail dollars, with price-change alerts and a
 *   usage/variance report. https://appdemo.partender.com/pricing.html
 *
 *   BevSpot's per-item figure is *usage* — the by-volume amount consumed —
 *   because it is what generates pars, exposes over-pouring and builds the
 *   order. https://bevspot.com/ordering/
 *
 *   Untappd for Business, the one tool in the list that is a BEER tool, makes
 *   only three fields required on a menu item — Beer Name, Brewery, Style — and
 *   ABV and IBU are optional; the API's beer object is
 *   `name, abv, style, brewery, rating`, and the price lives on a *container*
 *   with its own size. https://docs.business.untappd.com/ ·
 *   https://help.business.untappd.com/support/solutions/articles/16000102385-how-do-i-add-a-new-beer-to-my-untappd-for-business-menu-
 *
 *   Whisky Advocate's 5,000+ reviews are searchable by price, score, style and
 *   brand — not by age or cask. https://whiskyadvocate.com/ratings-reviews
 *
 * THE FOUNDER'S BEER COLUMNS, ANSWERED HONESTLY
 * =============================================
 * "pilsner, IPA" is *style*, and it belongs on the row: it is the one beer
 * field every serious tool makes required (Untappd, above).
 *
 * "maya" (yeast) and "gaz oranı" (carbonation) do not. The field's own
 * canonical taxonomy is the BJCP style guideline, and its Vital Statistics line
 * is exactly five numbers — `IBU · SRM · OG · FG · ABV`. Carbonation appears in
 * the *Mouthfeel* paragraph as prose ("Medium to medium-high carbonation") and
 * yeast in *Characteristic Ingredients* as prose ("American or English yeast
 * with a clean or slightly fruity profile"). Verified on 21A American IPA:
 * https://www.bjcp.org/style/2021/21/21A/american-ipa/
 * They are a brewer's recipe facts, not a bar's register facts — and a column
 * of prose sorts nothing. They are carried on the reading stand where prose
 * belongs, never as columns.
 *
 * WHAT THIS SCHEMA CAN ACTUALLY FILL — MEASURED, NOT ASSUMED
 * ==========================================================
 * Counted 2026-09-03 against the live database this gateway reads
 * (`exzueerziesmczwlhomd`), 609 non-deleted `public.beverages` rows:
 *
 *   populated:  name 609, producer 609, country 609, region 524, beverage_type
 *               609, price_reference 294
 *   ZERO:       abv_pct 0, volume_ml 0, package_format 0, age_years 0,
 *               cask_finish 0, expression 0, proof 0, body 0, acidity 0,
 *               serving_temp_celsius 0, glass_type 0, barcode 0, sku 0, upc 0,
 *               and type_attributes is `{}` on all 609.
 *
 * So the ABV and Format columns the register drew this morning were em dashes
 * on 100% of rows, in every register. Every whisky column the founder would
 * want (age, cask, proof) is a real column in
 * `20260817070000_beverages_table.sql:262-266` with no writer — the migration
 * says so itself: "Left NULL at migration time — parsing is separate, future
 * work". None of them needs a migration; all of them need a writer.
 *
 * `master_wine_library`, 3,562 non-deleted rows: vintage 3,118 · appellation
 * 2,259 · grape_variety 3,514 · primary_type 3,562 · price_reference 3,345 ·
 * retail_price_avg **0** · bottle_size_ml 750 on every row.
 *
 * `restaurant_inventory`, 206 rows: `total_revenue` and `times_ordered_count`
 * are NOT NULL on all 206 **and zero on all 206** — a default with no writer.
 * They are the most dangerous candidates on this page, because a column built
 * on them renders "0 sold · ₺0" as though it had been counted. They are
 * refused here by name.
 *
 * `cocktails`, 55 rows: menu_section 55 · price 44 · method 0 · glass 0 ·
 * garnish 0 · description 0 · restaurant_id 0. `cocktail_ingredients`: 0 rows.
 *
 * NO MIGRATION IS PROPOSED. Every column the research asks for is already a
 * column somewhere (`beverages.type_attributes` for style/IBU,
 * `beverages.age_years`/`cask_finish`/`proof` for whisky,
 * `procurement_document_lines.pack_size` for a case size,
 * `cocktail_ingredients.quantity`/`unit` for a cost per pour) or is derivable
 * from the house's own books. What is missing is writers, and a writer is not
 * this page's to build.
 */

import type { RegisterId } from './cellar-format';

/** Which book of the house a column reads from, or the shared catalogue. */
export type ColumnSide = 'house' | 'catalogue' | 'cellar';

/**
 * The series a column opens when its cell is acted on. `null` means the column
 * has no series — a word, or a state rather than a history.
 */
export type ColumnSeries =
  | 'menu'
  | 'invoice'
  | 'order'
  | 'quote'
  | 'pos'
  | null;

export interface CellarColumn {
  id: string;
  label: string;
  kind: 'figure' | 'word';
  side: ColumnSide;
  /** The table, named exactly, so the claim on the header menu is checkable. */
  source: string;
  /** What the column means, in the operator's words. Shown on the header menu. */
  meaning: string;
  /**
   * The measured fill, as of 2026-09-03. Null where the figure is per-tenant
   * and cannot be stated once for everybody (the house's own books).
   */
  fill: string | null;
  /** Drawn by default. False = offered in the header menu with `why` beside it. */
  on: boolean;
  /** Why a column is off by default. Empty when it is on. */
  why: string;
  /** Which book this column's cell opens. */
  series: ColumnSeries;
}

const NO_WRITER = (what: string, where: string) =>
  `${what} is a real column (${where}) with no writer on this database — measured 0 of 609 rows. Drawing it would be a column of em dashes on every row.`;

/* ── the spine every register shares: this house's own record ───────────── */

const NAME: CellarColumn = {
  id: 'name',
  label: 'Bottle',
  kind: 'word',
  side: 'house',
  source: 'the row itself',
  meaning:
    'What this house calls it, taken from the longest label any of its own books recorded — or from the shared catalogue when only the catalogue knows it.',
  fill: null,
  on: true,
  why: '',
  series: null,
};

const BOOKS: CellarColumn = {
  id: 'books',
  label: 'Our record',
  kind: 'word',
  side: 'house',
  source: 'house_beverage_ledger (menu · invoice · order · quote · till)',
  meaning:
    'One mark per book of this house that names the row. Five marks means we list it, were invoiced for it, ordered it, were quoted it and sold it. No marks means the shared catalogue knows it and we have never touched it.',
  fill: null,
  on: true,
  why: '',
  series: null,
};

const LISTED: CellarColumn = {
  id: 'listed',
  label: 'On the list',
  kind: 'figure',
  side: 'house',
  source: 'menu_items.bottle_price / by_glass_price',
  meaning:
    'What we charge for it. The bottle price where there is one, otherwise the price by the glass — the cell says which.',
  fill: null,
  on: true,
  why: '',
  series: 'menu',
};

const FIRST: CellarColumn = {
  id: 'first',
  label: 'First bought',
  kind: 'figure',
  side: 'house',
  source: 'procurement_document_lines, on documents of type invoice',
  meaning:
    'The date of the earliest invoice line naming it. An order is what we asked for; an invoice is what we were charged, and only the invoice supports the word "bought".',
  fill: null,
  on: true,
  why: '',
  series: 'invoice',
};

const PAID: CellarColumn = {
  id: 'paid',
  label: 'Paid',
  kind: 'figure',
  side: 'house',
  source: 'procurement_document_lines.line_total, summed over invoice lines',
  meaning:
    'Everything this house has been charged for it, across every invoice. Open the cell for the ledger those lines make — what was bought, when, from whom, at what.',
  fill: null,
  on: true,
  why: '',
  series: 'invoice',
};

const SOLD: CellarColumn = {
  id: 'sold',
  label: 'Sold',
  kind: 'figure',
  side: 'house',
  source: 'pos_unresolved_lines.qty',
  meaning:
    'How many the till has rung up. Unresolved lines only, and that is the point: a resolved line was mapped to a wine and is counted against that wine instead.',
  fill: null,
  on: true,
  why: '',
  series: 'pos',
};

const CHARGED: CellarColumn = {
  id: 'charged',
  label: 'Taken',
  kind: 'figure',
  side: 'house',
  source: 'pos_unresolved_lines.price · qty',
  meaning:
    'What the till actually took for it — the price charged, not the price listed. The two differ every time somebody comps, discounts or rings the wrong button, and the difference is the only place a menu price is ever checked.',
  fill: null,
  on: true,
  why: '',
  series: 'pos',
};

const QUOTE: CellarColumn = {
  id: 'quote',
  label: 'Last quote',
  kind: 'figure',
  side: 'house',
  source: 'vendor_price_observations.normalized_unit_price',
  meaning:
    'The most recent price a vendor quoted THIS house, normalised to one unit so a case price and a bottle price are not on the same axis.',
  fill:
    '0 rows in the whole database on 2026-09-03 — no scraper or invoice parser has written a tenant-scoped observation yet.',
  on: true,
  why: '',
  series: 'quote',
};

const ORDERED: CellarColumn = {
  id: 'ordered',
  label: 'Last ordered',
  kind: 'figure',
  side: 'house',
  source: 'procurement_order_items, through procurement_orders.requested_at',
  meaning:
    'When we last asked a vendor for it, and at what. Deliberately apart from Paid: an order is a request, and a request is not a charge.',
  fill: null,
  on: false,
  why: 'Off by default because Paid answers the same question with a stronger book behind it. Turn it on to see what was asked for against what was charged.',
  series: 'order',
};

/** The house's spine, in reading order. Shared by every register. */
export const HOUSE_SPINE: CellarColumn[] = [
  NAME,
  BOOKS,
  LISTED,
  FIRST,
  PAID,
  SOLD,
  CHARGED,
  QUOTE,
  ORDERED,
];

/* ── catalogue columns, per register ────────────────────────────────────── */

const TYPE: CellarColumn = {
  id: 'type',
  label: 'Type',
  kind: 'word',
  side: 'catalogue',
  source: 'beverages.beverage_type',
  meaning:
    'The library’s own class for the bottle — whiskey, agave_spirit, amaro, non_alcoholic. Coarse on purpose: it decides which register a row belongs to, not how it tastes.',
  fill: '609 of 609 catalogue rows.',
  on: true,
  why: '',
  series: null,
};

const ORIGIN: CellarColumn = {
  id: 'origin',
  label: 'Origin',
  kind: 'word',
  side: 'catalogue',
  source: 'beverages.region, beverages.country',
  meaning: 'Where it is from, region first.',
  fill: 'country 609 of 609; region 524 of 609.',
  on: true,
  why: '',
  series: null,
};

const ABV: CellarColumn = {
  id: 'abv',
  label: 'ABV',
  kind: 'figure',
  side: 'catalogue',
  source: 'beverages.abv_pct',
  meaning:
    'Strength by volume. Optional even on Untappd, which is the one beer tool in the field study; required by nobody.',
  fill: '0 of 609.',
  on: false,
  why: NO_WRITER('abv_pct', '20260817070000_beverages_table.sql:228'),
  series: null,
};

const FORMAT: CellarColumn = {
  id: 'format',
  label: 'Format',
  kind: 'figure',
  side: 'catalogue',
  source: 'beverages.volume_ml, beverages.package_format',
  meaning:
    'What it comes in — a 330ml can, a 50l keg, a 750ml bottle. The one field a beer register genuinely needs that a wine register does not.',
  fill: '0 of 609 for both columns.',
  on: false,
  why: NO_WRITER(
    'volume_ml / package_format',
    '20260817070000_beverages_table.sql:229-230',
  ),
  series: null,
};

const STYLE_BEER: CellarColumn = {
  id: 'style',
  label: 'Style',
  kind: 'word',
  side: 'catalogue',
  source: 'beverages.type_attributes ->> style',
  meaning:
    'Pilsner, IPA, Gose. The founder’s first beer column, and the field agrees: Untappd makes Style one of only three REQUIRED fields on a menu beer.',
  fill: 'type_attributes is {} on all 609 rows, so 0 of 57 beers carry a style.',
  on: false,
  why:
    'The column exists (type_attributes is JSONB and needs no migration) and has never been written to. It is the single highest-value writer this register is waiting on — a beer register without a style is a list of brand names.',
  series: null,
};

const IBU: CellarColumn = {
  id: 'ibu',
  label: 'IBU',
  kind: 'figure',
  side: 'catalogue',
  source: 'beverages.type_attributes ->> ibu',
  meaning:
    'Bitterness. One of the five numbers BJCP puts in a style’s Vital Statistics (IBU · SRM · OG · FG · ABV).',
  fill: '0 of 57 beers.',
  on: false,
  why:
    'Same absent writer as Style. Carbonation ("gaz oranı") and yeast ("maya") are deliberately NOT offered here: BJCP keeps both in prose — Mouthfeel and Characteristic Ingredients — and prose does not sort. They belong on the reading stand.',
  series: null,
};

const AGE: CellarColumn = {
  id: 'age',
  label: 'Age',
  kind: 'figure',
  side: 'catalogue',
  source: 'beverages.age_years',
  meaning: 'The age statement — the youngest whisky in the bottle.',
  fill: '0 of 272 whiskies.',
  on: false,
  why: NO_WRITER('age_years', '20260817070000_beverages_table.sql:262'),
  series: null,
};

const CASK: CellarColumn = {
  id: 'cask',
  label: 'Cask',
  kind: 'word',
  side: 'catalogue',
  source: 'beverages.cask_finish',
  meaning:
    'The wood it matured in. The trade holds that cask and distillery explain more of the flavour than region does.',
  fill: '0 of 272.',
  on: false,
  why: NO_WRITER('cask_finish', '20260817070000_beverages_table.sql:263'),
  series: null,
};

const PROOF: CellarColumn = {
  id: 'proof',
  label: 'Proof',
  kind: 'figure',
  side: 'catalogue',
  source: 'beverages.proof',
  meaning: 'Strength on the American scale — twice ABV.',
  fill: '0 of 272.',
  on: false,
  why: NO_WRITER('proof', '20260817070000_beverages_table.sql:265'),
  series: null,
};

/* ── the wine register keeps its own catalogue columns ──────────────────── */

const WINE_STYLE: CellarColumn = {
  id: 'style',
  label: 'Style',
  kind: 'word',
  side: 'catalogue',
  source: 'master_wine_library.primary_type',
  meaning: 'Red, white, sparkling, rosé, orange, fortified, dessert.',
  fill: '3,562 of 3,562.',
  on: true,
  why: '',
  series: null,
};

const VINTAGE: CellarColumn = {
  id: 'vintage',
  label: 'Vintage',
  kind: 'figure',
  side: 'catalogue',
  source: 'master_wine_library.vintage',
  meaning:
    'The year. One of CellarTracker’s four required import columns, and the only catalogue fact a sommelier will correct you on.',
  fill: '3,118 of 3,562.',
  on: true,
  why: '',
  series: null,
};

const GRAPE: CellarColumn = {
  id: 'grape',
  label: 'Grape',
  kind: 'word',
  side: 'catalogue',
  source: 'master_wine_library.grape_variety',
  meaning:
    'The varietal. Backbar’s spreadsheet guide calls it the eighth column and the one that makes a list navigable.',
  fill: '3,514 of 3,562.',
  on: false,
  why: 'Off by default only for width — it is real, and one of the best-filled columns on the page.',
  series: null,
};

const WINE_ORIGIN: CellarColumn = {
  id: 'country',
  label: 'Origin',
  kind: 'word',
  side: 'catalogue',
  source: 'master_wine_library.region, .country, .appellation',
  meaning: 'Region and country; the appellation opens on the stand.',
  fill: 'country 3,562; region 3,529; appellation 2,259.',
  on: true,
  why: '',
  series: null,
};

const LIST: CellarColumn = {
  id: 'list',
  label: 'List',
  kind: 'figure',
  side: 'catalogue',
  source: 'master_wine_library.price_reference',
  meaning:
    'The library’s reference price. A market hint the catalogue carries, never this house’s price — ours is On the list.',
  fill: '3,345 of 3,562.',
  on: true,
  why: '',
  series: null,
};

const MARKET: CellarColumn = {
  id: 'market',
  label: 'Market',
  kind: 'figure',
  side: 'catalogue',
  source: 'master_wine_library.retail_price_avg',
  meaning: 'What it goes for elsewhere. The column the price-watch would read.',
  fill: '0 of 3,562.',
  on: false,
  why:
    'Null on every row and its writer has no deployed worker. Kept in the vocabulary rather than deleted because its absence is the roadmap item, not the column.',
  series: null,
};

const WINE_FORMAT: CellarColumn = {
  id: 'wineformat',
  label: 'Format',
  kind: 'figure',
  side: 'catalogue',
  source: 'master_wine_library.bottle_size_ml',
  meaning: 'Bottle size.',
  fill: '750 ml on 4,226 of 4,226 rows — a constant, not a measurement.',
  on: false,
  why:
    'A column with one value sorts nothing and filters nothing. This is the Body filter’s mistake in another suit, and Body was removed for it in the first pass.',
  series: null,
};

const ON_HAND: CellarColumn = {
  id: 'onhand',
  label: 'On hand',
  kind: 'figure',
  side: 'cellar',
  source: 'restaurant_inventory.stock_live',
  meaning:
    'Bottles in the building. Wines only — restaurant_inventory is keyed on master_wine_id, so a keg has no stock row (OD-113).',
  fill: null,
  on: true,
  why: '',
  series: null,
};

const PAR: CellarColumn = {
  id: 'par',
  label: 'Par',
  kind: 'figure',
  side: 'cellar',
  source: 'restaurant_inventory.threshold_min',
  meaning:
    'The row’s own minimum. Every serious bar tool in the study puts par on the row — BinWise, Backbar and BevSpot all generate the order from it.',
  fill: '206 of 206 inventory rows carry one.',
  on: false,
  why: 'Off by default for width. Real, and the column the reorder decision is actually made on.',
  series: null,
};

const COUNTED: CellarColumn = {
  id: 'counted',
  label: 'Last counted',
  kind: 'figure',
  side: 'cellar',
  source: 'restaurant_inventory.last_counted_at',
  meaning: 'When somebody last put hands on it.',
  fill: '4 of 206 rows.',
  on: false,
  why: 'Almost never written. Offered rather than drawn, so the emptiness is a choice the operator makes with the figure in front of them.',
  series: null,
};

/* ── cocktails: a recipe’s columns, not a bottle’s ──────────────────── */

const SECTION: CellarColumn = {
  id: 'section',
  label: 'Section',
  kind: 'word',
  side: 'catalogue',
  source: 'cocktails.menu_section',
  meaning: 'Where it sits on the list.',
  fill: '55 of 55.',
  on: true,
  why: '',
  series: null,
};

const PRICE: CellarColumn = {
  id: 'price',
  label: 'Price',
  kind: 'figure',
  side: 'catalogue',
  source: 'cocktails.price',
  meaning: 'What the list says it costs.',
  fill: '44 of 55.',
  on: true,
  why: '',
  series: null,
};

const BUILD: CellarColumn = {
  id: 'method',
  label: 'Build',
  kind: 'word',
  side: 'catalogue',
  source: 'cocktails.method',
  meaning:
    'Shaken, stirred, built. One of the six fields every cocktail spec sheet in the trade carries — name, ingredients, method, glass, ice, garnish.',
  fill: '0 of 55.',
  on: false,
  why: 'The column exists and the extraction pass never wrote it. A bartender can now type one (PATCH /cocktails/:rid/:id).',
  series: null,
};

const GLASS: CellarColumn = {
  id: 'glass',
  label: 'Glass',
  kind: 'word',
  side: 'catalogue',
  source: 'cocktails.glass',
  meaning: 'What it is served in.',
  fill: '0 of 55.',
  on: false,
  why: 'Same absent extraction as Build, same writer.',
  series: null,
};

const GARNISH: CellarColumn = {
  id: 'garnish',
  label: 'Garnish',
  kind: 'word',
  side: 'catalogue',
  source: 'cocktails.garnish',
  meaning: 'What goes on top.',
  fill: '0 of 55.',
  on: false,
  why: 'Same absent extraction as Build, same writer.',
  series: null,
};

const RECIPE: CellarColumn = {
  id: 'recipe',
  label: 'Recipe',
  kind: 'figure',
  side: 'catalogue',
  source: 'cocktail_ingredients',
  meaning:
    'How many lines the recipe has. The cost per pour every bar tool computes is this table times each ingredient’s price — derivable the moment there are lines, and needing no migration.',
  fill: '0 rows in the table; it gained its first writer this pass.',
  on: true,
  why: '',
  series: null,
};

/* ── the sets ───────────────────────────────────────────────────────────── */

const CATALOGUE_BY_REGISTER: Record<RegisterId, CellarColumn[]> = {
  wines: [WINE_STYLE, VINTAGE, WINE_ORIGIN, GRAPE, LIST, MARKET, WINE_FORMAT, ON_HAND, PAR, COUNTED],
  beer: [STYLE_BEER, IBU, TYPE, ORIGIN, ABV, FORMAT],
  whiskey: [AGE, CASK, PROOF, TYPE, ORIGIN, ABV],
  spirits: [TYPE, ORIGIN, ABV, FORMAT],
  cocktails: [SECTION, PRICE, RECIPE, BUILD, GLASS, GARNISH],
  non_alcoholic: [TYPE, ORIGIN, FORMAT],
  soft_drinks: [TYPE, ORIGIN, FORMAT],
};

/**
 * One register's columns: the house's spine first, the catalogue's after.
 * The order is the argument — what we know about it comes before what a
 * stranger recorded about it.
 */
export function columnsFor(register: RegisterId): CellarColumn[] {
  if (register === 'cocktails') {
    // A cocktail has no producer and no invoice line of its own; its record is
    // the menu and the till, and the rest of the spine would be dead columns.
    return [NAME, BOOKS, SOLD, CHARGED, ...CATALOGUE_BY_REGISTER.cocktails];
  }
  return [...HOUSE_SPINE, ...CATALOGUE_BY_REGISTER[register]];
}

/**
 * THE GENERAL SET — the whole cellar at once.
 *
 * The founder: *"We show more general columns when they want to see the whole
 * menu inventories at once right?"* Yes, and the test for a general column is
 * harsher than the test for a register column: **it has to mean the same thing
 * in every register.** A beer's ABV and a wine's vintage do not survive that;
 * what we paid for a keg and what we paid for a Burgundy do.
 *
 * `On hand` is deliberately NOT in this set. It is real for wines and
 * structurally absent for the other six (OD-113), so as a general column it
 * would be an em dash on most of the page — the same fault the register-level
 * ABV column had. The whole-cellar view says that once, in words, instead.
 */
export const WHOLE_CELLAR_COLUMNS: CellarColumn[] = [
  NAME,
  {
    id: 'register',
    label: 'Register',
    kind: 'word',
    side: 'house',
    source: 'the register this row was read from',
    meaning:
      'Which of this house’s registers holds it. The only column that exists solely in this view, and the reason the view is legible: a whisky, a keg and a Burgundy in one list need to say which is which.',
    fill: null,
    on: true,
    why: '',
    series: null,
  },
  BOOKS,
  LISTED,
  PAID,
  SOLD,
  CHARGED,
  QUOTE,
];

/** Every column in the vocabulary, deduplicated by (register, id). */
export function allColumnsFor(register: RegisterId): CellarColumn[] {
  return columnsFor(register);
}

/** The default-on subset, which is what the table draws. */
export function defaultColumns(register: RegisterId): CellarColumn[] {
  return columnsFor(register).filter((c) => c.on);
}

/**
 * A column's one-paragraph account of itself, for the header menu. Source,
 * meaning, measured fill — the "research view" the founder asked for, attached
 * to the column rather than to a help page nobody opens.
 */
export function columnAccount(c: CellarColumn): string[] {
  const lines = [c.meaning, `Read from ${c.source}.`];
  if (c.fill) lines.push(`Filled: ${c.fill}`);
  if (!c.on && c.why) lines.push(c.why);
  return lines;
}
