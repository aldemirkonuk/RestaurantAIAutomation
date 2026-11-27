/**
 * What is in one serve, from the figures each linked item states
 * (item_nutrition, #922). Pure, beside recipe-cost.ts, and as honest:
 * - a line counts only when linked to an item stating figures on its own
 *   basis (ml against per 100 ml, g against per 100 g), or when the house
 *   stated, for that very good, the weight that joins the two: what one piece
 *   weighs (a piece against per 100 g) or what one ml weighs (ml against per
 *   100 g, g against per 100 ml). Never a usual weight (r28 gap 7);
 * - any other line is named in notCounted and in each figure's missing,
 *   so it reads "unknown for <label>", never 0;
 * - a figure no counted line states is null; one some lines lack is atLeast;
 *   energy from ABV is the alcohol alone, so atLeast;
 * - per serve: divided by the yield, like the cost;
 * - alcohol is a figure like the others: the item's stated ABV (item_nutrition
 *   .abv_pct, per 100 ml) is millilitres of pure alcohol per 100 ml, so a
 *   line with no stated strength is "unknown for" it, never 0, and a weighed
 *   line counts only through the good's stated weight of one ml (a strength
 *   is a share of a volume);
 * - the one exception to "not counted is unknown": a line linked to an item
 *   that states 0% alcohol adds 0 alcohol whatever its amount or unit (zero
 *   of anything is zero, nothing is converted). "Top with tonic" with no
 *   amount, or a can counted in pieces, then leaves the alcohol firm. A line
 *   that states no strength stays unknown even if it looks like a garnish: a
 *   brandied cherry or an absinthe sugar cube is counted in pieces too, and
 *   understating alcohol is the direction that hurts;
 * - an allergen is free only when every line, untracked too, states it free;
 * - the lines that leave any allergen unstated are named (allergensUnstatedBy),
 *   so a sheet can say which ingredients stop "free of" being said, instead of
 *   saying nothing and reading as allergen-free.
 */
import type { BaseUnit } from "./recipe-cost";

export const FIGURE_KEYS = [
  "energyKcal",
  "fatG",
  "saturatesG",
  "carbohydrateG",
  "sugarsG",
  "proteinG",
  "saltG",
  "alcoholMl",
] as const;
export type FigureKey = (typeof FIGURE_KEYS)[number];

/** EU 1169/2011 Annex II, as item-nutrition/nutrition-figures.ts. */
export const ALLERGENS = ["gluten", "crustaceans", "eggs", "fish", "peanuts", "soy", "milk", "tree_nuts", "celery", "mustard", "sesame", "sulphites", "lupin", "molluscs"] as const;
export type Allergen = (typeof ALLERGENS)[number];
export type AllergenStatus = "contains" | "may_contain" | "free" | "not_stated";

/** One item_nutrition row as the gateway reads it (numerics already numbers or null). */
export interface ItemFigures extends Record<FigureKey, number | null> {
  basis: "100g" | "100ml";
  energyFromAbv: boolean;
}

export interface NutritionLineInput {
  label: string;
  role: "stocked" | "untracked";
  inventoryId: string | null;
  qtyBase: number;
  baseUnit: BaseUnit;
  /** null: the item states nothing (or the line is not linked). */
  figures: ItemFigures | null;
  /** What one piece of the linked good weighs, in g, as the house stated it; null when not stated. */
  pieceGrams?: number | null;
  /** What one ml of the linked good weighs, in g, as the house stated it; null when not stated. */
  mlGrams?: number | null;
  /** The item's stated allergens; an allergen absent here is not stated. */
  allergens: ReadonlyArray<{ allergen: string; status: string }>;
}

export interface ServeFigure {
  /** Per serve, rounded to 2 places; null when no counted line states it. */
  value: number | null;
  /** True when some line could not add to it, so the real figure is higher. */
  atLeast: boolean;
  /** Labels of the lines that could not add to it. */
  missing: string[];
}

export interface ServeNutrition {
  figures: Record<FigureKey, ServeFigure>;
  notCounted: Array<{ label: string; why: string }>;
  allergens: Record<Allergen, AllergenStatus>;
  /** Labels of the lines that leave at least one allergen not stated, in recipe order. */
  allergensUnstatedBy: string[];
  /** Lines counted in at least one figure, of all lines. */
  counted: number;
  of: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A stated weight (g) a bridge may use: finite and above 0, else none. */
const statedG = (v: number | null | undefined): number | null =>
  v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null;

/** The line's amount in ml or g (the per-100 figure's own unit), or why it cannot count. */
function amountOf(line: NutritionLineInput): { amount: number } | { why: string } {
  if (line.role === "untracked") return { why: "it is not counted from the shelf" };
  if (!line.inventoryId) return { why: "it is not linked to anything on the shelf" };
  if (!line.figures) return { why: "nothing is recorded about what is in it" };
  const qty = Number(line.qtyBase);
  if (!Number.isFinite(qty) || qty <= 0) return { why: "the recipe does not say how much" };
  const pieceG = statedG(line.pieceGrams);
  const mlG = statedG(line.mlGrams);
  if (line.baseUnit === "each_milli") {
    if (line.figures.basis !== "100g") return { why: "it is counted in pieces, not by weight or volume" };
    if (pieceG === null) return { why: "it is counted in pieces, and what one weighs is not stated" };
    return { amount: (qty / 1000) * pieceG };
  }
  if (line.baseUnit === "ml10") {
    if (line.figures.basis === "100ml") return { amount: qty / 10 };
    if (mlG === null) return { why: "it is measured by volume, but its figures are per 100 g and what one ml weighs is not stated" };
    return { amount: (qty / 10) * mlG };
  }
  if (line.figures.basis === "100g") return { amount: qty / 1000 };
  if (mlG === null) return { why: "it is weighed, but its figures are per 100 ml and what one ml weighs is not stated" };
  return { amount: qty / 1000 / mlG };
}

/** Linked to an item that states 0% alcohol (a strength is per 100 ml by the schema's CHECK). */
function statesNoAlcohol(l: NutritionLineInput): boolean {
  return l.role === "stocked" && Boolean(l.inventoryId) && l.figures?.basis === "100ml" && l.figures.alcoholMl === 0;
}

function leavesAllergenUnstated(l: NutritionLineInput): boolean {
  if (l.role === "untracked" || !l.inventoryId) return true;
  return ALLERGENS.some((a) => {
    const s = l.allergens.find((x) => x.allergen === a)?.status;
    return s !== "contains" && s !== "may_contain" && s !== "free";
  });
}

function allergenOf(lines: NutritionLineInput[], a: Allergen): AllergenStatus {
  const statuses = lines.map((l) => {
    if (l.role === "untracked" || !l.inventoryId) return "not_stated";
    const s = l.allergens.find((x) => x.allergen === a)?.status;
    return s === "contains" || s === "may_contain" || s === "free" ? s : "not_stated";
  });
  if (statuses.includes("contains")) return "contains";
  if (statuses.includes("may_contain")) return "may_contain";
  if (statuses.length > 0 && statuses.every((s) => s === "free")) return "free";
  return "not_stated";
}

export function serveNutrition(lines: NutritionLineInput[], yieldServes: number): ServeNutrition {
  const serves = Number.isInteger(yieldServes) && yieldServes > 0 ? yieldServes : NaN;
  const notCounted: ServeNutrition["notCounted"] = [];
  const counted: Array<{ line: NutritionLineInput; amount: number }> = [];
  const leftLines: NutritionLineInput[] = [];
  for (const line of lines) {
    const a = amountOf(line);
    if ("why" in a) {
      notCounted.push({ label: line.label, why: a.why });
      leftLines.push(line);
    } else counted.push({ line, amount: a.amount });
  }

  const figures = {} as Record<FigureKey, ServeFigure>;
  const usedLines = new Set<NutritionLineInput>();
  for (const k of FIGURE_KEYS) {
    // A not-counted line stating 0% adds 0 alcohol (see the header), so it is
    // not "unknown for" it; for every other figure it is.
    const zero = k === "alcoholMl" ? leftLines.filter(statesNoAlcohol) : [];
    let total: number | null = zero.length > 0 ? 0 : null;
    const missing = leftLines.filter((l) => !zero.includes(l)).map((l) => l.label);
    let atLeast = missing.length > 0;
    for (const { line, amount } of counted) {
      const per100 = line.figures![k];
      if (per100 === null || per100 === undefined) {
        missing.push(line.label);
        atLeast = true;
        continue;
      }
      usedLines.add(line);
      total = (total ?? 0) + (amount / 100) * Number(per100);
      if (k === "energyKcal" && line.figures!.energyFromAbv) atLeast = true;
    }
    const perServe = total === null ? null : total / serves;
    figures[k] = {
      value: perServe === null || !Number.isFinite(perServe) ? null : round2(perServe),
      atLeast: perServe !== null && atLeast,
      missing: [...new Set(missing)],
    };
  }

  const allergens = Object.fromEntries(ALLERGENS.map((a) => [a, allergenOf(lines, a)])) as Record<
    Allergen,
    AllergenStatus
  >;
  const allergensUnstatedBy = [...new Set(lines.filter(leavesAllergenUnstated).map((l) => l.label))];
  return { figures, notCounted, allergens, allergensUnstatedBy, counted: usedLines.size, of: lines.length };
}
