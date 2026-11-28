/**
 * The words of "What's in it" (NutritionCard, NutritionForm): figures,
 * allergens and sources, in the house's words. A figure nobody stated is "not
 * known", never 0, and an allergen nobody stated is never read as "free".
 */
import type { Allergen, ItemNutrition, NutritionBasis, StoredNutrition } from '../../../services/api/inventory';

export const ALLERGEN_WORDS: Record<Allergen, string> = {
  gluten: 'gluten',
  crustaceans: 'crustaceans',
  eggs: 'eggs',
  fish: 'fish',
  peanuts: 'peanuts',
  soy: 'soy',
  milk: 'milk',
  tree_nuts: 'tree nuts',
  celery: 'celery',
  mustard: 'mustard',
  sesame: 'sesame',
  sulphites: 'sulphites',
  lupin: 'lupin',
  molluscs: 'molluscs',
};

export const PER: Record<NutritionBasis, string> = { '100g': 'Per 100 g', '100ml': 'Per 100 ml' };

/** A figure in words: "not known" for null, never 0. */
export function figureWords(v: number | null, unit: 'kcal' | 'g' | '%'): string {
  if (v === null) return 'not known';
  const n = v.toLocaleString('en-GB', { maximumFractionDigits: unit === 'kcal' ? 0 : 1 });
  return unit === '%' ? `${n} %` : `${n} ${unit}`;
}

export const SOURCE_WORDS: Record<StoredNutrition['source'], (ref: string | null) => string> = {
  house: () => 'The house’s own figures',
  pack_label: () => 'From the pack’s label',
  open_food_facts: (ref) => `From Open Food Facts${ref ? ` (barcode ${ref})` : ''}, checked by the house`,
  usda_fdc: (ref) => `From USDA FoodData Central${ref ? ` (entry ${ref})` : ''}, checked by the house`,
};

function list(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** The allergens as sentences. Silence is never read as "free". */
export function allergenLines(allergens: ItemNutrition['allergens']): string[] {
  const by = (s: string) => allergens.filter((a) => a.status === s).map((a) => ALLERGEN_WORDS[a.allergen]);
  const contains = by('contains');
  const may = by('may_contain');
  const free = by('free');
  const unstated = by('not_stated');
  if (unstated.length === allergens.length) {
    return ['No allergens are stated yet. That does not mean it has none.'];
  }
  const lines: string[] = [];
  if (contains.length) lines.push(`Contains ${list(contains)}.`);
  if (may.length) lines.push(`May contain ${list(may)}.`);
  if (free.length) lines.push(`Stated free of ${list(free)}.`);
  if (unstated.length) lines.push(`Not stated: ${list(unstated)}.`);
  return lines;
}
