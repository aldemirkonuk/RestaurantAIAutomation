/**
 * A recipe line's amount and unit (proposal §4 F3).
 *
 * The units are the closed list the gateway accepts (`recipes.dto.ts`) and
 * nothing else. The ounce is the US fluid ounce, so its label says so.
 *
 * The amount box takes a comma as well as a point ("22,5"): a Turkish bar
 * writes decimals that way, and refusing it would be refusing the house's own
 * hand.
 */
export const RECIPE_UNITS = ['ml', 'cl', 'l', 'oz', 'tsp', 'tbsp', 'dash', 'barspoon', 'g', 'kg', 'each'] as const;
export type RecipeUnit = (typeof RECIPE_UNITS)[number];

export const UNIT_LABEL: Record<RecipeUnit, string> = {
  ml: 'ml', cl: 'cl', l: 'l', oz: 'US oz', tsp: 'tsp', tbsp: 'tbsp',
  dash: 'dash', barspoon: 'barspoon', g: 'g', kg: 'kg', each: 'each',
};

/**
 * 1,000 or 1.000: a thousand in one country, one in another (round 19: "1,000"
 * saved as 1). Not guessed; the sheet asks for it without the separator.
 */
export const AMBIGUOUS_AMOUNT = /^[1-9]\d{0,2}[.,]\d{3}$/;

/** "22,5" → 22.5; anything that is not a positive number, or could be two numbers → null. */
export function readQty(text: string): number | null {
  if (AMBIGUOUS_AMOUNT.test(text.trim())) return null;
  const s = text.trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$|^\.\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 1.5 → "1.5"; at most three decimals, trailing zeros trimmed. */
export function qtyText(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  return String(Math.round(n * 1000) / 1000);
}
