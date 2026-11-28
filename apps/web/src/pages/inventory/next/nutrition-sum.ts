/**
 * What is in a dish or a cocktail: the sum of its lines (founder /goal
 * 2026-11-07: "same thing for drinks (recipes)").
 *
 * Pure, and not wired anywhere yet: the recipe sheet that would show it is the
 * #863 stack, which another lane owns. The rules it keeps, so a wired card can
 * only say true things:
 * - a line's grams or millilitres times its per-100 figure; nothing else;
 * - a figure no line states stays null, never 0;
 * - a figure some lines do not state is the sum of those that do, marked
 *   "at least", with the lines it is missing named;
 * - grams are never turned into millilitres or back: that needs a density
 *   nobody has stated, so such a line is named as not counted;
 * - energy worked out from the ABV is the alcohol alone, so it is "at least";
 * - an allergen is "free" only when every line states it free.
 */
import {
  ALLERGENS,
  type Allergen,
  type AllergenStatus,
  type NutritionFigures,
  type StoredNutrition,
} from '../../../services/api/inventory';

export type SumKey = Exclude<keyof NutritionFigures, 'abvPct'>;
export const SUM_KEYS: readonly SumKey[] = ['energyKcal', 'proteinG', 'fatG', 'saturatesG', 'carbohydrateG', 'sugarsG', 'saltG'];

export interface RecipeLine {
  name: string;
  /** The amount the recipe uses, in `unit`; null when the recipe does not say. */
  quantity: number | null;
  unit: string;
  nutrition: Pick<StoredNutrition, 'basis' | 'energyFromAbv' | SumKey> | null;
  allergens: ReadonlyArray<{ allergen: Allergen; status: AllergenStatus }> | null;
}

export interface SummedFigure {
  /** null when no counted line states it; never 0 for "not known". */
  value: number | null;
  /** true when some line could not add to it, so the real figure is higher. */
  atLeast: boolean;
  /** The lines that could not add to it. */
  missing: string[];
}

export interface RecipeSum {
  figures: Record<SumKey, SummedFigure>;
  /** Lines left out of every figure, each with the reason in words. */
  notCounted: Array<{ name: string; why: string }>;
  allergens: Record<Allergen, AllergenStatus>;
}

const TO_BASE: Record<string, { per: '100g' | '100ml'; factor: number }> = {
  g: { per: '100g', factor: 1 },
  kg: { per: '100g', factor: 1000 },
  ml: { per: '100ml', factor: 1 },
  cl: { per: '100ml', factor: 10 },
  l: { per: '100ml', factor: 1000 },
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Why a line cannot be counted at all, or null when it can. */
function cannotCount(line: RecipeLine): string | null {
  if (line.quantity === null || !(line.quantity >= 0)) return 'the recipe does not say how much';
  const base = TO_BASE[line.unit.trim().toLowerCase()];
  if (!base) return `it is measured in ${line.unit}, not by weight or volume`;
  if (!line.nutrition) return 'nothing is recorded about what is in it';
  if (line.nutrition.basis !== base.per) {
    return base.per === '100g'
      ? 'it is weighed, but its figures are per 100 ml'
      : 'it is measured by volume, but its figures are per 100 g';
  }
  return null;
}

function allergenOf(lines: RecipeLine[], a: Allergen): AllergenStatus {
  const statuses = lines.map((l) => l.allergens?.find((x) => x.allergen === a)?.status ?? 'not_stated');
  if (statuses.includes('contains')) return 'contains';
  if (statuses.includes('may_contain')) return 'may_contain';
  if (statuses.length > 0 && statuses.every((s) => s === 'free')) return 'free';
  return 'not_stated';
}

export function sumRecipe(lines: RecipeLine[]): RecipeSum {
  const notCounted: RecipeSum['notCounted'] = [];
  const counted: Array<{ line: RecipeLine; amount: number }> = [];
  for (const line of lines) {
    const why = cannotCount(line);
    if (why) notCounted.push({ name: line.name, why });
    else counted.push({ line, amount: (line.quantity as number) * TO_BASE[line.unit.trim().toLowerCase()].factor });
  }
  const left = notCounted.map((n) => n.name);

  const figures = {} as Record<SumKey, SummedFigure>;
  for (const k of SUM_KEYS) {
    let total: number | null = null;
    const missing = [...left];
    let atLeast = left.length > 0;
    for (const { line, amount } of counted) {
      const per100 = line.nutrition![k];
      if (per100 === null) {
        missing.push(line.name);
        atLeast = true;
        continue;
      }
      total = (total ?? 0) + (amount / 100) * per100;
      if (k === 'energyKcal' && line.nutrition!.energyFromAbv) atLeast = true;
    }
    figures[k] = { value: total === null ? null : round2(total), atLeast: total !== null && atLeast, missing };
  }

  const allergens = Object.fromEntries(ALLERGENS.map((a) => [a, allergenOf(lines, a)])) as Record<Allergen, AllergenStatus>;
  return { figures, notCounted, allergens };
}
