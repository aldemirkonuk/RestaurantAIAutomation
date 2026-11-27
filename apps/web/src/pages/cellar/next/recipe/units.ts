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
 * The unit as a reader says it after an amount: "2 dashes", "1 dash", "2
 * barspoons" (browser walk 2026-11-11, R3: "2 dash"). Symbols and
 * abbreviations (ml, US oz, tsp) and "each" do not take a plural.
 */
const PLURAL: Partial<Record<RecipeUnit, string>> = { dash: 'dashes', barspoon: 'barspoons' };
export function unitWord(unit: RecipeUnit, qty: number | null | undefined): string {
  const many = PLURAL[unit];
  return many && qty != null && Number.isFinite(qty) && qty !== 1 ? many : UNIT_LABEL[unit];
}

/** "2 dashes", "30 ml", or the amount alone when no unit is known. */
export function amountWithUnit(qty: number, unit: RecipeUnit | '' | null | undefined): string {
  const known = unit && (RECIPE_UNITS as readonly string[]).includes(unit) ? unitWord(unit as RecipeUnit, qty) : unit ?? '';
  return `${qtyText(qty)} ${known}`.trim();
}

/**
 * 1,000 or 1.000: a thousand in one country, one in another (round 19: "1,000"
 * saved as 1). Not guessed; the sheet asks for it without the separator.
 */
export const AMBIGUOUS_AMOUNT = /^[1-9]\d{0,2}[.,]\d{3}$/;

/**
 * Units where a thousand in one serve is not a thing a bar pours: "1.125 oz"
 * is 1⅛ oz, "1.500 l" is a litre and a half. There the separator is a decimal.
 * ml and g stay ambiguous ("1.000 ml" is a real European batch), and so does
 * `each` or no unit at all.
 */
const DECIMAL_WHEN_THREE_DIGITS: readonly (RecipeUnit | '' | null | undefined)[] = [
  'oz', 'tsp', 'tbsp', 'dash', 'barspoon', 'cl', 'l', 'kg',
];

/** True when `text` could be a thousand or a decimal and the unit does not settle it. */
export function readsAsThousandAmbiguous(text: string, unit?: RecipeUnit | '' | null): boolean {
  return AMBIGUOUS_AMOUNT.test(text.trim()) && !DECIMAL_WHEN_THREE_DIGITS.includes(unit);
}

/** "22,5" → 22.5; anything that is not a positive number, or could be two numbers → null. */
export function readQty(text: string, unit?: RecipeUnit | '' | null): number | null {
  if (readsAsThousandAmbiguous(text, unit)) return null;
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
