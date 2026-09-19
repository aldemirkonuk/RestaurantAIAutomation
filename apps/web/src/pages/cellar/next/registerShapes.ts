/**
 * What serves each register, stated exactly.
 *
 * REWRITTEN 2026-09-03 (third pass), and the rewrite is a correction rather
 * than an addition. The previous version said, of five of the seven registers,
 * that they were "browsable catalogues with no cellar column" and, of soft
 * drinks, that the register had "no rows to show — not zero rows, none to ask
 * for". Every word of that was true of `public.beverages`. It was never true of
 * the house.
 *
 * `public.beverages` has no `restaurant_id`
 * (`20260817070000_beverages_table.sql:217`), so it can only ever answer "what
 * exists". Five other tables DO carry one and DO carry the product's name, and
 * between them they answer "what THIS house pours":
 *
 *   menu_items                  what the house lists, and charges
 *   procurement_document_lines  what the house has been invoiced, and when
 *   procurement_order_items     what the house has ordered
 *   vendor_price_observations   who quoted it, at what, off which source
 *   pos_unresolved_lines        what the house has actually sold
 *
 * `public.house_beverage_ledger` (migration 20260903120000) assembles them, and
 * every register below is now served by the house's own books first and the
 * shared catalogue second — including soft drinks, which no `beverage_type` can
 * reach and which the house's menu and till name perfectly well.
 *
 * WHAT IS STILL WITHHELD. Stocking, on every one of them.
 * `restaurant_inventory` is keyed on `master_wine_id → master_wine_library`, so
 * a keg, a bottle of rye and a case of cola have no stock row to write to. That
 * is OD-113 and it is undecided, so `stockable` stays false and the register
 * renders the control disabled with the reason rather than hiding it.
 *
 * `cocktail_ingredients` is no longer "empty by design": it was empty because
 * the extraction pass never ran, and since this pass a bartender can write a
 * recipe into it (`PUT /cocktails/:rid/:id/ingredients`).
 */

import type { RegisterId } from './cellar-format';

export interface RegisterSource {
  /** True when an endpoint returns rows for this register today. */
  wired: boolean;
  /** Which read serves it. Named exactly, so the claim is checkable. */
  served: string;
  /** The register's own sentence on the parent surface. */
  oneLine: string;
  /** What the rows are NOT — the scope sentence. Empty when there is none. */
  scopeNote: string;
  /** True when this house can hold stock of the kind at all. */
  stockable: boolean;
  /** True when the house can WRITE a row of this register. Cocktails only. */
  writable: boolean;
  /** What is still missing, named exactly. Empty when nothing is. */
  missing: string;
}

const HOUSE_FIRST =
  'This house’s own record comes first — first bought, what was paid, what was poured, who quoted it — read from its menu, invoices, orders, quotes and till. The shared catalogue is laid over it, and rows nobody here has touched are labelled as belonging to nobody.';

const NOT_STOCK =
  'Nothing of this kind can be counted into the cellar yet: restaurant_inventory is keyed on the wine library, so stocking waits on the identity axis (OD-113).';

export const REGISTER_SOURCE: Record<RegisterId, RegisterSource> = {
  wines: {
    wired: true,
    served: 'GET /wines, with GET /inventory laid over it',
    oneLine: 'The master library as this house sees it, with the cellar laid over it.',
    scopeNote: '',
    stockable: true,
    writable: false,
    missing: '',
  },
  beer: {
    wired: true,
    served:
      'GET /beverages/:rid/registers/beer — house_beverage_ledger, with beverage_type in (beer, ale, lager) laid over it',
    oneLine: 'Every beer this house has bought, listed, quoted or poured.',
    scopeNote: HOUSE_FIRST,
    stockable: false,
    writable: false,
    missing: NOT_STOCK,
  },
  whiskey: {
    wired: true,
    served:
      'GET /beverages/:rid/registers/whiskey — house_beverage_ledger, with beverage_type in (whiskey, whisky, bourbon) laid over it',
    oneLine: 'Whiskey, separated from the rest of the spirits by its own type.',
    scopeNote: HOUSE_FIRST,
    stockable: false,
    writable: false,
    missing: NOT_STOCK,
  },
  spirits: {
    wired: true,
    served:
      'GET /beverages/:rid/registers/spirits — house_beverage_ledger, with whiskey, agave_spirit, brandy, vodka, gin, rum, liqueur, amaro and spirit_other laid over it',
    oneLine: 'Every spirit, whiskey included. The wider register whiskey sits inside.',
    scopeNote: HOUSE_FIRST,
    stockable: false,
    writable: false,
    missing: NOT_STOCK,
  },
  cocktails: {
    wired: true,
    served:
      'GET /cocktails/:rid for this house’s own list, with POST/PATCH/DELETE and PUT …/ingredients; GET /beverages/:rid/registers/cocktails for what the menu and the till say',
    oneLine: 'The one register this house can write — and the only one with a recipe.',
    scopeNote:
      'Only cocktails this restaurant owns. Rows with no restaurant are unattributed reference data from the demo corpus and are counted apart, never listed as this house’s.',
    stockable: false,
    writable: true,
    missing:
      'A cocktail cannot yet deplete its base spirit: that needs a stock row for the spirit, which is the same OD-113 gate. Recipes themselves are no longer missing — cocktail_ingredients has a writer as of this pass.',
  },
  non_alcoholic: {
    wired: true,
    served:
      'GET /beverages/:rid/registers/non_alcoholic — house_beverage_ledger, with beverage_type = non_alcoholic laid over it',
    oneLine: 'What the house pours to someone who is not drinking.',
    scopeNote: HOUSE_FIRST,
    stockable: false,
    writable: false,
    missing: NOT_STOCK,
  },
  soft_drinks: {
    // Served since this pass — by the house's own books, which is the only
    // place a cola was ever visible. The shared catalogue still cannot answer.
    wired: true,
    served:
      'GET /beverages/:rid/registers/soft_drinks — house_beverage_ledger alone. No beverage_type serves this register.',
    oneLine: 'On the menu and at the till, never in a catalogue — and that is enough.',
    scopeNote:
      'Every row here is this house’s own. No value of beverages.beverage_type separates a cola from a kombucha, so the shared catalogue contributes nothing to this register and is not asked.',
    stockable: false,
    writable: false,
    missing: NOT_STOCK,
  },
};
