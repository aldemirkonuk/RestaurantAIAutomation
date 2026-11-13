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

/** Up to three places, so a whole gram or millilitre is never rounded away. */
function exact(n: number): string {
  return n.toLocaleString("en-GB", { maximumFractionDigits: 3 });
}

/**
 * A figure as the inventory list prints it (fmtQty in
 * apps/web/src/pages/inventory/next/ItemCards.tsx), so the dashboard and the
 * list never say the same stock two ways. Whole g, ml or mg of 1,000 or more
 * read a unit up, every gram kept: 2000 g is "2 kg", 1750 g "1.75 kg",
 * 1500 ml "1.5 l". A good kept each is a bare count ("40"), as the list
 * shows it. Any other unit keeps its word, with the list's thousands
 * separator ("1,250 bottles").
 */
export function amountIn(n: number, uom: string | null | undefined): string {
  const key = (uom ?? "").trim().toLowerCase();
  const up = new Map([
    ["g", "kg"],
    ["ml", "l"],
    ["mg", "g"],
  ]).get(key);
  if (up) {
    return Math.abs(n) >= 1000
      ? `${exact(n / 1000)} ${up}`
      : `${exact(n)} ${key}`;
  }
  if (key === "each") return exact(n);
  return `${exact(n)} ${unitWord(uom, n)}`;
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
