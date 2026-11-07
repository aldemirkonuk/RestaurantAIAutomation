/**
 * What a good is made of — the pure half (no database, no network).
 *
 * Migration `20270512091500_a_good_says_what_is_in_it.sql` holds the rules;
 * this file is where the gateway applies them before a write:
 *  - an unknown figure is `null`, never 0;
 *  - every figure is per 100 g or per 100 ml, and says which;
 *  - energy from ABV is integer arithmetic, so it equals the database's
 *    `round(abv_pct * 5.523, 1)` (a CHECK) by construction rather than by
 *    float luck; the spec compares every 0.1 % from 0.1 to 100.
 */

/** EU 1169/2011 Annex II, the same 14 as Turkey's Ek-1 list. Display order. */
export const ALLERGENS = [
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soy",
  "milk",
  "tree_nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const ALLERGEN_STATUSES = ["contains", "may_contain", "free"] as const;
export type AllergenStatus = (typeof ALLERGEN_STATUSES)[number];

export const BASES = ["100g", "100ml"] as const;
export type Basis = (typeof BASES)[number];

export const SOURCES = ["house", "pack_label", "open_food_facts", "usda_fdc"] as const;
export type NutritionSource = (typeof SOURCES)[number];

/** The figures, in the order the card shows them. Grams unless named. */
export const FIGURE_KEYS = [
  "energyKcal",
  "fatG",
  "saturatesG",
  "carbohydrateG",
  "sugarsG",
  "proteinG",
  "saltG",
] as const;
export type FigureKey = (typeof FIGURE_KEYS)[number];

export type Figures = Record<FigureKey, number | null> & { abvPct: number | null };

const MASS = new Set(["mg", "g", "kg"]);
const VOLUME = new Set(["ml", "l"]);
const DRINK_CONTAINERS = new Set(["bottle", "case", "keg", "glass", "shot"]);
const DRINK_KINDS = new Set([
  "wine",
  "beer",
  "whiskey",
  "spirit",
  "liqueur",
  "cocktail",
  "sake",
  "cider",
  "non_alcoholic",
  "soft_drink",
]);

/**
 * Per 100 g or per 100 ml, from the item's own unit and kind. A food kept in
 * packs or each has no answer here: the person picks, nothing is guessed.
 */
export function basisFor(kind: string | null, uom: string | null): Basis | null {
  if (uom && MASS.has(uom)) return "100g";
  if (uom && VOLUME.has(uom)) return "100ml";
  if (kind && DRINK_KINDS.has(kind) && (!uom || DRINK_CONTAINERS.has(uom))) return "100ml";
  return null;
}

/**
 * Energy from the alcohol alone, kcal per 100 ml: ABV% x 0.789 g/ml x 7
 * kcal/g (EU 1169/2011 Annex XIV), rounded to 0.1 exactly as Postgres does.
 * The ABV is first taken to the column's 0.1 %. Null for no ABV, or 0 %.
 */
export function kcalFromAbv(abvPct: number | null | undefined): number | null {
  if (abvPct === null || abvPct === undefined || !Number.isFinite(abvPct) || abvPct <= 0) return null;
  const tenths = Math.round(abvPct * 10); // abv_pct NUMERIC(4,1)
  const tenThousandths = tenths * 5523; // x 0.5523 per tenth = abv x 5.523, exact
  return Math.round(tenThousandths / 1000) / 10;
}

/** A figure as stored: a finite number at the column's scale, or null. Never 0 for missing. */
export function figureOrNull(v: unknown, places = 2): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export interface NutritionWrite {
  basis: Basis;
  figures: Figures;
  source: NutritionSource;
  sourceRef: string | null;
}

export type CheckedWrite =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; why: string };

const WORDS: Record<FigureKey | "abvPct", string> = {
  energyKcal: "Energy",
  fatG: "Fat",
  saturatesG: "Saturates",
  carbohydrateG: "Carbohydrate",
  sugarsG: "Sugars",
  proteinG: "Protein",
  saltG: "Salt",
  abvPct: "Alcohol",
};

/**
 * The figures a person confirmed, checked and turned into the database's
 * row. Every refusal is a sentence a person can act on. Energy is worked out
 * from ABV only when energy itself was left unknown, and is then marked so.
 */
export function checkWrite(w: NutritionWrite): CheckedWrite {
  const f = w.figures;
  const cap = w.basis === "100g" ? 100 : 150;
  const per = w.basis === "100g" ? "100 g" : "100 ml";
  for (const k of FIGURE_KEYS) {
    const v = f[k];
    if (v === null) continue;
    if (!Number.isFinite(v) || v < 0) return { ok: false, why: `${WORDS[k]} must be a number of 0 or more.` };
    if (k === "energyKcal" ? v > 900 : v > cap) {
      return { ok: false, why: `${WORDS[k]} of ${v}${k === "energyKcal" ? " kcal" : " g"} cannot fit in ${per}.` };
    }
  }
  if (f.saturatesG !== null && f.fatG !== null && f.saturatesG > f.fatG) {
    return { ok: false, why: "Saturates are part of the fat, so they cannot be more than the fat." };
  }
  if (f.sugarsG !== null && f.carbohydrateG !== null && f.sugarsG > f.carbohydrateG) {
    return { ok: false, why: "Sugars are part of the carbohydrate, so they cannot be more than it." };
  }
  if (f.abvPct !== null) {
    if (w.basis !== "100ml") return { ok: false, why: "Alcohol is a share of a volume, so these figures must be per 100 ml." };
    if (!Number.isFinite(f.abvPct) || f.abvPct < 0 || f.abvPct > 100) {
      return { ok: false, why: "Alcohol must be between 0 and 100 %." };
    }
  }
  const lookup = w.source === "open_food_facts" || w.source === "usda_fdc";
  const ref = w.sourceRef?.trim() || null;
  if (lookup && !ref) return { ok: false, why: "A looked-up figure must say what it was looked up by." };

  const fromAbv = f.energyKcal === null ? kcalFromAbv(f.abvPct) : null;
  return {
    ok: true,
    row: {
      basis: w.basis,
      energy_kcal: fromAbv ?? figureOrNull(f.energyKcal, 1),
      fat_g: figureOrNull(f.fatG),
      saturates_g: figureOrNull(f.saturatesG),
      carbohydrate_g: figureOrNull(f.carbohydrateG),
      sugars_g: figureOrNull(f.sugarsG),
      protein_g: figureOrNull(f.proteinG),
      salt_g: figureOrNull(f.saltG),
      abv_pct: figureOrNull(f.abvPct, 1),
      energy_from_abv: fromAbv !== null,
      source: w.source,
      source_ref: lookup ? ref : null,
    },
  };
}
