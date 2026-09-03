/**
 * What each register is, and — for the three that are not wired — exactly what
 * is missing and what shape the register would take.
 *
 * MEASURED, not assumed, on 2026-09-02 in this worktree:
 *
 *  - `apps/api-gateway/src/**` declares **52 `@Controller(...)` routes across
 *    50 files** (`grep -rn "^@Controller(" apps/api-gateway/src --include="*.ts"`,
 *    re-counted 2026-09-02; an earlier draft said 48). None of them is
 *    `beverages`, `cocktails` or `spirits` — that grep filtered for those three
 *    names returns zero — and the only catalogue controller is
 *    `@Controller("wines")` (apps/api-gateway/src/wines/wines.controller.ts:30).
 *  - The tables DO exist: `public.beverages`
 *    (supabase/migrations/20260817070000_beverages_table.sql:217) and
 *    `public.cocktails` + `public.cocktail_ingredients`
 *    (20260817090000_cocktails.sql:27,60), with the beverage views at
 *    20260817080000 and the classifier at 20260817060000.
 *  - `master_wine_library.beverage_kind` classifies every catalogue row as one
 *    of wine / beer / spirit / sake / cider / cocktail / non_alcoholic /
 *    unknown (20260817060000_beverage_kind_classification.sql:44-48) — but
 *    `WinesService.mapWine` does not carry it onto the wire, so the browser
 *    cannot even COUNT the beer rows, let alone list them. That is why these
 *    three registers show no number at all rather than a zero.
 *  - `cocktail_ingredients` is created empty and stays empty by design
 *    ("recipes are not in the extracted data", 20260817090000_cocktails.sql:20-25).
 *
 * The field lists below are column names read out of those migrations. They
 * describe a SCHEMA, not a tenant: no row, no count, no measurement.
 */

import type { RegisterId } from './cellar-format';

export interface ShapeField {
  id: string;
  label: string;
  description: string;
}

export interface RegisterState {
  /** True only when an endpoint actually serves this register today. */
  wired: boolean;
  /** The register's own sentence on the parent surface. */
  oneLine: string;
  /** Where the rows would come from, named exactly. */
  table: string;
  /** What is missing, named exactly, so the gap is actionable. */
  missing: string;
  /** The columns that already exist, so the shape is visible without rows. */
  fields: ShapeField[];
}

const BEVERAGE_FIELDS: ShapeField[] = [
  { id: 'name', label: 'Name · display name', description: 'text, with the derived descriptive name' },
  { id: 'brand', label: 'Producer · brand', description: 'text' },
  { id: 'beverage_type', label: 'Type', description: "text, defaulting to 'other'" },
  { id: 'origin', label: 'Country · region', description: 'text' },
  { id: 'abv_pct', label: 'ABV', description: 'numeric percent' },
  { id: 'volume_ml', label: 'Volume · package format', description: 'integer ml, text format' },
  { id: 'price_reference', label: 'Reference price', description: 'numeric — a market hint, never this house’s price' },
  { id: 'codes', label: 'Barcode · SKU · UPC · EAN', description: 'text' },
  { id: 'identity_key', label: 'Identity key · status', description: 'deterministic merge key, trigger-maintained' },
  { id: 'sensory', label: 'Body · acidity · sweetness', description: 'text, real columns — populated only where extraction found them' },
];

const COCKTAIL_FIELDS: ShapeField[] = [
  { id: 'name', label: 'Name · display name', description: 'text' },
  { id: 'menu_section', label: 'Menu section', description: 'text — the house’s own section header' },
  { id: 'method', label: 'Method', description: 'text — shaken, stirred, built' },
  { id: 'glass', label: 'Glass', description: 'text' },
  { id: 'garnish', label: 'Garnish', description: 'text' },
  { id: 'price', label: 'Price', description: 'numeric' },
  { id: 'description', label: 'Description', description: 'text' },
  { id: 'ingredients', label: 'Ingredients', description: 'cocktail_ingredients — created empty and still empty; recipes were never extracted' },
];

export const REGISTER_STATE: Record<RegisterId, RegisterState> = {
  wines: {
    wired: true,
    oneLine: 'The master library as this house sees it, with the cellar laid over it.',
    table: 'public.master_wine_library, via GET /wines',
    missing: '',
    fields: [],
  },
  beer: {
    wired: false,
    oneLine: 'The table exists and is empty of a way in: no endpoint serves beer.',
    table: 'public.beverages (beverage_type = beer)',
    missing:
      'No gateway controller serves this table. The wine catalogue’s own classifier already tags every row as wine / beer / spirit / cocktail, but the gateway drops that field before it reaches the browser — so this register cannot even report how many beers the library holds.',
    fields: BEVERAGE_FIELDS,
  },
  whiskey: {
    wired: false,
    oneLine: 'The table exists and is empty of a way in: no endpoint serves spirits.',
    table: 'public.beverages (beverage_type = spirit)',
    missing:
      'No gateway controller serves this table. Whiskey shares the beverages register with every other spirit; the classifier that separates them lives in the database and stops there.',
    fields: BEVERAGE_FIELDS,
  },
  cocktails: {
    wired: false,
    oneLine: 'Recipes, not catalogue rows — and the recipe half was never extracted.',
    table: 'public.cocktails + public.cocktail_ingredients',
    missing:
      'No gateway controller serves these tables, and the ingredients table was created empty on purpose: the cocktail sections of the scanned menus need their own extraction pass before a single recipe exists to show.',
    fields: COCKTAIL_FIELDS,
  },
};
