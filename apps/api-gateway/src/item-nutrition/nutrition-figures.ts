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
  | { ok: true; row: Record<string, unknown>; warnings: string[] }
  | { ok: false; why: string };

/**
 * The two macro rules (QA 20 on #923), with the same numbers as the web form's
 * `nutrition-check.ts` so a figure the form lets through is never refused here
 * for a different reason, and the gateway holds the rule for every other writer.
 *
 * - REFUSAL, per 100 g only: protein + fat + carbohydrate + salt cannot weigh
 *   more than 100 g (saturates and sugars are parts of fat and carbohydrate, so
 *   they are not added again). A label rounds each figure, so 0.5 g over is
 *   rounding, not a mistake. Per 100 ml there is no such ceiling: 100 ml of a
 *   syrup weighs ~140 g.
 * - WARNING, never a refusal: typed energy against 4 / 4 / 9 kcal per g of
 *   protein / carbohydrate / fat (Atwater), plus 7 kcal per g of alcohol when
 *   the figures are per 100 ml and the ABV is given. Only when protein, fat and
 *   carbohydrate are all stated: an unstated figure is never read as 0. A
 *   printed label departs from 4/4/9 legitimately (fibre, polyols, rounding).
 */
export const ATWATER = { protein: 4, carbohydrate: 4, fat: 9, alcohol: 7 } as const;
export const ETHANOL_G_PER_ML = 0.789;
export const ROUNDING_G = 0.5;
export const KCAL_TOLERANCE = { share: 0.2, floor: 20 } as const;

export function macrosOver100g(basis: Basis, f: Figures): string | null {
  if (basis !== "100g") return null;
  const total = (f.proteinG ?? 0) + (f.fatG ?? 0) + (f.carbohydrateG ?? 0) + (f.saltG ?? 0);
  if (total <= 100 + ROUNDING_G) return null;
  return `Protein, fat, carbohydrate and salt add up to ${Math.round(total * 10) / 10} g, which is more than 100 g in 100 g. Check the figures against the pack.`;
}

/** The energy the macros imply, or null when they cannot say. */
export function energyFromMacros(basis: Basis, f: Figures): number | null {
  if (f.proteinG === null || f.fatG === null || f.carbohydrateG === null) return null;
  const alcohol = basis === "100ml" && f.abvPct !== null ? f.abvPct * ETHANOL_G_PER_ML * ATWATER.alcohol : 0;
  return f.proteinG * ATWATER.protein + f.carbohydrateG * ATWATER.carbohydrate + f.fatG * ATWATER.fat + alcohol;
}

export function kcalDisagrees(basis: Basis, f: Figures): string | null {
  if (f.energyKcal === null) return null;
  const expected = energyFromMacros(basis, f);
  if (expected === null) return null;
  const allowed = Math.max(KCAL_TOLERANCE.floor, expected * KCAL_TOLERANCE.share);
  if (Math.abs(f.energyKcal - expected) <= allowed) return null;
  return `Energy is ${f.energyKcal} kcal, but the protein, fat and carbohydrate come to about ${Math.round(expected)} kcal (4, 4 and 9 kcal per gram${basis === "100ml" && f.abvPct !== null ? ", 7 per gram of alcohol" : ""}). It was saved as stated; check it against the pack.`;
}

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
  const over = macrosOver100g(w.basis, f);
  if (over) return { ok: false, why: over };
  const lookup = w.source === "open_food_facts" || w.source === "usda_fdc";
  const ref = w.sourceRef?.trim() || null;
  if (lookup && !ref) return { ok: false, why: "A looked-up figure must say what it was looked up by." };

  const fromAbv = f.energyKcal === null ? kcalFromAbv(f.abvPct) : null;
  const disagrees = kcalDisagrees(w.basis, f);
  return {
    ok: true,
    warnings: disagrees ? [disagrees] : [],
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
