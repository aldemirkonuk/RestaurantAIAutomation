/**
 * A good in its own words. A low-stock row's stock and par are in its own
 * `uom` (ADR 0070), so a flour reads "200 g", not "200 bottles". Mirrors
 * `unitWord` in apps/web/src/pages/dashboard/next/RailPanels.tsx.
 */

/** restaurant_inventory_uom_check's vocabulary, in the house's words. */
const UNIT_WORDS: Record<string, [one: string, many: string]> = {
  bottle: ["bottle", "bottles"],
  case: ["case", "cases"],
  keg: ["keg", "kegs"],
  pack: ["pack", "packs"],
  each: ["unit", "units"],
  glass: ["glass", "glasses"],
  shot: ["shot", "shots"],
  ml: ["ml", "ml"],
  l: ["l", "l"],
  mg: ["mg", "mg"],
  g: ["g", "g"],
  kg: ["kg", "kg"],
};

/**
 * The unit word after a figure. A row that carries no unit comes from a view
 * that held wines only, so it reads in bottles, as it always did. An unknown
 * unit is shown as written rather than folded into "bottles".
 */
export function unitWord(uom: string | null | undefined, n: number): string {
  const key = (uom ?? "").trim().toLowerCase();
  if (!key) return n === 1 ? "bottle" : "bottles";
  const pair = UNIT_WORDS[key];
  if (!pair) return key;
  return n === 1 ? pair[0] : pair[1];
}

/** "200 g", "1 bottle", "6 bottles". */
export function quantityIn(n: number, uom: string | null | undefined): string {
  return `${n} ${unitWord(uom, n)}`;
}

/**
 * The noun for a set of goods: "wine" only when every one is a wine (a row
 * with no kind is from the wines-only view), else "good". A beer and a flour
 * are goods, not wines.
 */
export function goodsNoun(
  kinds: Array<string | null | undefined>,
  n: number,
): string {
  const allWine = kinds.every((k) => !k || k.trim().toLowerCase() === "wine");
  const word = allWine ? "wine" : "good";
  return n === 1 ? word : `${word}s`;
}

/** True when the row's stock is counted in bottles (no unit: a wines-only row). */
export function isBottles(uom: string | null | undefined): boolean {
  const key = (uom ?? "").trim().toLowerCase();
  return key === "" || key === "bottle";
}
