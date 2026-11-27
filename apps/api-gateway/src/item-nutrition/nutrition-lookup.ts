/**
 * A lookup's answer turned into a DRAFT the house confirms — pure, no network.
 *
 * Nothing here is saved. The card shows the draft, a person reads it against
 * the pack, and only their PUT writes it (inventory proposal §4 K4).
 *
 *  - A figure the source does not give is null, never 0.
 *  - Allergens from Open Food Facts are what the pack LISTS: "contains" and
 *    "may contain" only. Nothing a lookup says ever becomes "free"; an
 *    allergen the pack does not list stays "not stated".
 *  - Every worked-out figure says so in `notes` (salt from sodium, kcal
 *    from kJ). Per 100 g or per 100 ml is read from the product's own
 *    quantity, and a disagreement with the item's unit is said, not fixed.
 */
import { FIGURE_KEYS, figureOrNull, type Allergen, type Basis, type Figures } from "./nutrition-figures";

export interface NutritionDraft {
  source: "open_food_facts" | "usda_fdc";
  sourceRef: string;
  productName: string | null;
  basis: Basis;
  figures: Figures;
  allergens: Array<{ allergen: Allergen; status: "contains" | "may_contain" }>;
  notes: string[];
  attribution: string;
}

export interface LookupChoice {
  source: "open_food_facts" | "usda_fdc";
  ref: string;
  name: string;
  brand: string | null;
}

export const OFF_ATTRIBUTION =
  "From Open Food Facts (openfoodfacts.org), shared under the Open Database License. Figures there are added by volunteers; check them against the pack.";
export const FDC_ATTRIBUTION = "From USDA FoodData Central (fdc.nal.usda.gov), public domain.";

/** Open Food Facts' allergen tags for the 14 (its taxonomy names, English). */
const OFF_ALLERGEN: Record<string, Allergen> = {
  "en:gluten": "gluten",
  "en:crustaceans": "crustaceans",
  "en:eggs": "eggs",
  "en:fish": "fish",
  "en:peanuts": "peanuts",
  "en:soybeans": "soy",
  "en:milk": "milk",
  "en:nuts": "tree_nuts",
  "en:celery": "celery",
  "en:mustard": "mustard",
  "en:sesame-seeds": "sesame",
  "en:sulphur-dioxide-and-sulphites": "sulphites",
  "en:lupin": "lupin",
  "en:molluscs": "molluscs",
};

const noFigures = (): Figures => ({
  energyKcal: null,
  fatG: null,
  saturatesG: null,
  carbohydrateG: null,
  sugarsG: null,
  proteinG: null,
  saltG: null,
  abvPct: null,
});

const num = (v: unknown): number | null => figureOrNull(v, 4);

/** Per 100 ml for a product sold by volume, per 100 g by weight, else null. */
function offBasis(p: Record<string, unknown>): Basis | null {
  const unit = String(p.product_quantity_unit ?? "").toLowerCase();
  if (unit === "ml" || unit === "l" || unit === "cl") return "100ml";
  if (unit === "g" || unit === "kg") return "100g";
  const q = String(p.quantity ?? "").toLowerCase();
  if (/\d\s*(ml|cl|l)\b/.test(q)) return "100ml";
  if (/\d\s*(g|kg)\b/.test(q)) return "100g";
  return null;
}

/** An Open Food Facts product (api/v2/product/{barcode}.json `product`) as a draft. */
export function draftFromOpenFoodFacts(
  barcode: string,
  product: Record<string, unknown>,
  itemBasis: Basis | null,
): NutritionDraft {
  const n = (product.nutriments ?? {}) as Record<string, unknown>;
  const notes: string[] = [];
  const figures = noFigures();

  figures.fatG = num(n.fat_100g);
  figures.saturatesG = num(n["saturated-fat_100g"]);
  figures.carbohydrateG = num(n.carbohydrates_100g);
  figures.sugarsG = num(n.sugars_100g);
  figures.proteinG = num(n.proteins_100g);

  const kcal = num(n["energy-kcal_100g"]);
  const kj = num(n["energy-kj_100g"]) ?? num(n.energy_100g);
  if (kcal !== null) figures.energyKcal = figureOrNull(kcal, 1);
  else if (kj !== null) {
    figures.energyKcal = figureOrNull(kj / 4.184, 1);
    notes.push("Energy was given in kJ only; kcal is worked out from it (÷ 4.184).");
  }

  const salt = num(n.salt_100g);
  const sodium = num(n.sodium_100g);
  if (salt !== null) figures.saltG = figureOrNull(salt);
  else if (sodium !== null) {
    figures.saltG = figureOrNull(sodium * 2.5);
    notes.push("Salt was not given; it is worked out from sodium (× 2.5).");
  }

  const own = offBasis(product);
  const basis: Basis = own ?? itemBasis ?? "100g";
  if (!own) notes.push(`The product does not say whether it is sold by weight or volume; these are read as per ${basis === "100g" ? "100 g" : "100 ml"}.`);
  else if (itemBasis && own !== itemBasis) {
    notes.push(
      `The product is sold by ${own === "100ml" ? "volume" : "weight"}, so these are per ${own === "100ml" ? "100 ml" : "100 g"}; this item is kept by ${itemBasis === "100ml" ? "volume" : "weight"}. Check before saving.`,
    );
  }

  const abv = num(n.alcohol_100g) ?? num(n.alcohol);
  if (abv !== null && abv > 0) {
    if (basis === "100ml") figures.abvPct = figureOrNull(abv, 1);
    else notes.push("The pack gives an alcohol figure, but these are per 100 g, so it is left out: alcohol is a share of a volume.");
  }

  for (const k of FIGURE_KEYS) {
    if (figures[k] !== null && (figures[k] as number) < 0) figures[k] = null;
  }
  if (FIGURE_KEYS.every((k) => figures[k] === null) && figures.abvPct === null) {
    notes.push("Open Food Facts has no figures per 100 g or 100 ml for this product.");
  }

  const allergens = new Map<Allergen, "contains" | "may_contain">();
  for (const t of (product.traces_tags as unknown[]) ?? []) {
    const a = OFF_ALLERGEN[String(t)];
    if (a) allergens.set(a, "may_contain");
  }
  for (const t of (product.allergens_tags as unknown[]) ?? []) {
    const a = OFF_ALLERGEN[String(t)];
    if (a) allergens.set(a, "contains");
  }
  if (allergens.size > 0) {
    notes.push("Allergens are what the pack lists. One it does not list stays not stated, never free.");
  }

  const name = [product.product_name, product.brands].map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
  return {
    source: "open_food_facts",
    sourceRef: barcode,
    productName: name.length ? name.join(" · ") : null,
    basis,
    figures,
    allergens: [...allergens].map(([allergen, status]) => ({ allergen, status })),
    notes,
    attribution: OFF_ATTRIBUTION,
  };
}

/** FoodData Central nutrient numbers (legacy SR codes), per 100 g. */
const FDC: Record<string, keyof Figures> = {
  "208": "energyKcal",
  "204": "fatG",
  "606": "saturatesG",
  "205": "carbohydrateG",
  "269": "sugarsG",
  "203": "proteinG",
};
/** Atwater energy (kcal), used only when 208 is absent (Foundation foods). */
const FDC_ENERGY_FALLBACK = ["958", "957"];

/** A FoodData Central food (`/v1/food/{id}`, full or abridged) as a draft. Figures are per 100 g. */
export function draftFromFoodDataCentral(fdcId: string, food: Record<string, unknown>): NutritionDraft {
  const amounts = new Map<string, number>();
  for (const raw of (food.foodNutrients as unknown[]) ?? []) {
    const r = raw as Record<string, unknown>;
    const nutrient = (r.nutrient ?? {}) as Record<string, unknown>;
    const number = String(nutrient.number ?? r.number ?? "");
    const amount = num(r.amount ?? r.value);
    if (number && amount !== null && !amounts.has(number)) amounts.set(number, amount);
  }
  const figures = noFigures();
  const notes: string[] = [];
  for (const [code, key] of Object.entries(FDC)) {
    const v = amounts.get(code);
    if (v !== undefined) figures[key] = figureOrNull(v, key === "energyKcal" ? 1 : 2);
  }
  if (figures.energyKcal === null) {
    const alt = FDC_ENERGY_FALLBACK.map((c) => amounts.get(c)).find((v) => v !== undefined);
    if (alt !== undefined) figures.energyKcal = figureOrNull(alt, 1);
  }
  const sodiumMg = amounts.get("307");
  if (sodiumMg !== undefined) {
    figures.saltG = figureOrNull((sodiumMg / 1000) * 2.5);
    notes.push("Salt is worked out from sodium (× 2.5).");
  }
  notes.push("FoodData Central has no allergen information; state allergens yourself.");
  return {
    source: "usda_fdc",
    sourceRef: fdcId,
    productName: typeof food.description === "string" ? food.description : null,
    basis: "100g",
    figures,
    allergens: [],
    notes,
    attribution: FDC_ATTRIBUTION,
  };
}
