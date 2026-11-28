/**
 * Two checks on the figures typed into NutritionForm (QA 20 / QA 21, #938).
 *
 * - macros_over_100g (a REFUSAL): per 100 g, protein + fat + carbohydrate +
 *   salt cannot weigh more than 100 g (saturates and sugars are parts of fat and
 *   carbohydrate, so they are not added again). Per 100 ml there is no such
 *   ceiling: syrup and honey weigh more than 100 g in 100 ml, so it is not checked.
 * - kcal_vs_macros (a WARNING): energy against 4 / 4 / 9 kcal per g of protein /
 *   carbohydrate / fat (Atwater), plus 7 kcal per g of alcohol when the figures are
 *   per 100 ml and the alcohol is given. Only when protein, fat and carbohydrate are
 *   all stated: an unstated figure is never read as 0.
 *
 * Why the second is a warning and not a refusal: a printed label legitimately
 * departs from 4/4/9 (fibre counts 2 kcal/g, polyols and erythritol less, rounding),
 * and the label is what the house is copying. Refusing would stop it stating a
 * pack truthfully; it is told, and decides.
 */
import type { NutritionBasis, NutritionFigures } from '../../../services/api/inventory';

export const ATWATER = { protein: 4, carbohydrate: 4, fat: 9, alcohol: 7 } as const;
/** Grams of alcohol in 1 ml of ethanol. */
export const ETHANOL_G_PER_ML = 0.789;
/** A label rounds each figure; this much over 100 g is rounding, not a mistake. */
export const ROUNDING_G = 0.5;
/** The stated energy may differ from the worked one by this share, or this many kcal. */
export const KCAL_TOLERANCE = { share: 0.2, floor: 20 } as const;

type Figs = Partial<Record<keyof NutritionFigures, number | null>>;

export function macrosOver100g(basis: NutritionBasis | '', f: Figs): string | null {
  if (basis !== '100g') return null;
  const total = (f.proteinG ?? 0) + (f.fatG ?? 0) + (f.carbohydrateG ?? 0) + (f.saltG ?? 0);
  if (total <= 100 + ROUNDING_G) return null;
  return `Protein, fat, carbohydrate and salt add up to ${Math.round(total * 10) / 10} g, which is more than 100 g in 100 g. Check the figures against the pack.`;
}

/** The energy the macros imply, or null when they cannot say. */
export function energyFromMacros(basis: NutritionBasis | '', f: Figs): number | null {
  if (f.proteinG == null || f.fatG == null || f.carbohydrateG == null) return null;
  const alcohol = basis === '100ml' && f.abvPct != null ? f.abvPct * ETHANOL_G_PER_ML * ATWATER.alcohol : 0;
  return f.proteinG * ATWATER.protein + f.carbohydrateG * ATWATER.carbohydrate + f.fatG * ATWATER.fat + alcohol;
}

export function kcalDisagrees(basis: NutritionBasis | '', f: Figs): string | null {
  if (f.energyKcal == null) return null;
  const expected = energyFromMacros(basis, f);
  if (expected === null) return null;
  const allowed = Math.max(KCAL_TOLERANCE.floor, expected * KCAL_TOLERANCE.share);
  if (Math.abs(f.energyKcal - expected) <= allowed) return null;
  return `Energy is ${f.energyKcal} kcal, but the protein, fat and carbohydrate come to about ${Math.round(expected)} kcal (4, 4 and 9 kcal per gram). Fibre and sugar alcohols can explain a gap; if the pack says so, you can still save.`;
}
