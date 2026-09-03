/**
 * What serves each register, stated exactly.
 *
 * REWRITTEN 2026-09-03 (second pass). The first version of this file existed to
 * say "nothing serves beer, whiskey or cocktails" — which was true when it was
 * written and is no longer. Three things changed on the gateway in this pass:
 *
 *  1. `WinesService.mapWine` now carries `beverage_kind` and
 *     `classification_status` onto the wire (`wines.service.ts`), so the browser
 *     can finally COUNT what the library already classified.
 *  2. `apps/api-gateway/src/beverages/` serves `public.beverages` and
 *     `public.cocktails` read-only, tenant-named and JWT-guarded.
 *  3. `apps/api-gateway/src/cellar/` decides which registers a house carries.
 *
 * So the honest sentences here are now about SCOPE and about the two registers
 * that still have no source, not about missing controllers:
 *
 *  - `public.beverages` has **no `restaurant_id`**
 *    (`20260817070000_beverages_table.sql:217`). Its rows are a shared reference
 *    catalogue, and every surface that shows them says so. They are not stock.
 *  - `restaurant_inventory` is keyed on `master_wine_id →
 *    master_wine_library`, so a keg or a bottle of rye **cannot be stocked,
 *    counted, ordered or received** until the inventory identity axis is
 *    decided (page note §9.6, OD-113). Beer and spirits are therefore
 *    browsable catalogues with no cellar column, and each says so.
 *  - `cocktail_ingredients` was created empty and is still empty by design
 *    (`20260817090000_cocktails.sql:20-25`) — the register can list names and
 *    never a recipe.
 *  - **Soft drinks have no source at all.** No value of `beverages.beverage_type`
 *    separates a cola from a kombucha (measured 2026-09-03: the distinct values
 *    are whiskey, agave_spirit, beer, liqueur, amaro, sake, brandy, gin,
 *    spirit_other, rum, non_alcoholic, vodka, cider). A soft-drinks register
 *    shows the ask, not a number.
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
  /** What is still missing, named exactly. Empty when nothing is. */
  missing: string;
}

const CATALOGUE_ONLY =
  'These are the shared reference catalogue, not this house’s stock: `restaurant_inventory` is keyed on the wine library, so nothing of this kind can be counted into the cellar until the inventory identity axis is decided.';

export const REGISTER_SOURCE: Record<RegisterId, RegisterSource> = {
  wines: {
    wired: true,
    served: 'GET /wines, with GET /inventory laid over it',
    oneLine: 'The master library as this house sees it, with the cellar laid over it.',
    scopeNote: '',
    stockable: true,
    missing: '',
  },
  beer: {
    wired: true,
    served: 'GET /beverages/:rid?register=beer (beverage_type = beer)',
    oneLine: 'The beer catalogue. Browsable now; not yet countable as stock.',
    scopeNote: CATALOGUE_ONLY,
    stockable: false,
    missing: '',
  },
  whiskey: {
    wired: true,
    served: 'GET /beverages/:rid?register=whiskey (beverage_type = whiskey)',
    oneLine: 'Whiskey, separated from the rest of the spirits by its own type.',
    scopeNote: CATALOGUE_ONLY,
    stockable: false,
    missing: '',
  },
  spirits: {
    wired: true,
    served:
      'GET /beverages/:rid?register=spirits (whiskey, agave_spirit, brandy, vodka, gin, rum, liqueur, amaro, spirit_other)',
    oneLine: 'Every spirit, whiskey included. The wider register whiskey sits inside.',
    scopeNote: CATALOGUE_ONLY,
    stockable: false,
    missing: '',
  },
  cocktails: {
    wired: true,
    served: 'GET /cocktails/:rid (this restaurant’s rows only)',
    oneLine: 'Recipes, not catalogue rows — and the recipe half was never extracted.',
    scopeNote:
      'Only cocktails this restaurant owns. Rows with no restaurant are unattributed reference data from the demo corpus and are counted apart, never listed as this house’s.',
    stockable: false,
    missing:
      '`cocktail_ingredients` was created empty on purpose — the cocktail sections of the scanned menus need their own extraction pass before a single recipe exists. This register can list names and nothing else.',
  },
  non_alcoholic: {
    wired: true,
    served: 'GET /beverages/:rid?register=non_alcoholic (beverage_type = non_alcoholic)',
    oneLine: 'What the house pours to someone who is not drinking.',
    scopeNote: CATALOGUE_ONLY,
    stockable: false,
    missing: '',
  },
  soft_drinks: {
    wired: false,
    served: 'nothing',
    oneLine: 'On the menu, never in a catalogue: no column separates a cola from a kombucha.',
    scopeNote: '',
    stockable: false,
    missing:
      'No value of `beverages.beverage_type` distinguishes a soft drink from any other non-alcoholic drink, so this register has no rows to show — not zero rows, none to ask for. It counts what the menu names and nothing else.',
  },
};
