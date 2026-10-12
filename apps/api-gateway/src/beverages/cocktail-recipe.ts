/**
 * A cocktail's recipe as stock and as cost (F-1329, OD-113: the founder's
 * S195 ruling, "the industry approach").
 *
 * A recipe line may name one of the house's own stock rows
 * (`cocktail_ingredients.inventory_id`) with an amount per serve. A till sale
 * of the cocktail takes each linked line off that row (pos-hub), and the cost
 * per serve is the sum of the linked lines' recorded costs. A line that names
 * no stock row takes nothing and costs nothing; it is said to be not linked.
 *
 * Pure, so the till and the register read one rule for what an amount is.
 */

/** One serve's amount of a linked line, as the stock it takes. */
export type RecipeMeasure =
  | { kind: "ml"; ml: number }
  | { kind: "units"; units: number }
  | { kind: "unread"; reason: string };

/**
 * Volume units, in ml. "oz" is the US fluid ounce, the bar's ounce (a jigger
 * is 1 / 1.5 oz); nothing here reads a UK ounce.
 */
const ML_PER: Record<string, number> = {
  ml: 1,
  cl: 10,
  dl: 100,
  l: 1000,
  lt: 1000,
  oz: 29.5735,
};

/** Whole things taken off a row counted in units (a bottle, a can, an egg). */
const UNIT_WORDS = new Set([
  "unit",
  "units",
  "each",
  "pc",
  "pcs",
  "piece",
  "pieces",
  "bottle",
  "bottles",
  "can",
  "cans",
  "adet",
  "şişe",
]);

/** What one serve of a recipe line takes, or why that cannot be said. */
export function recipeMeasure(quantity: unknown, unit: unknown): RecipeMeasure {
  const q = quantity == null || quantity === "" ? NaN : Number(quantity);
  if (!Number.isFinite(q) || q <= 0) {
    return {
      kind: "unread",
      reason:
        "the line has no amount, so how much one serve takes is not known",
    };
  }
  const word =
    typeof unit === "string"
      ? unit.trim().toLocaleLowerCase("tr").replace(/\.$/, "")
      : "";
  if (word in ML_PER) return { kind: "ml", ml: q * ML_PER[word] };
  if (UNIT_WORDS.has(word)) return { kind: "units", units: q };
  return {
    kind: "unread",
    reason: word
      ? `"${word}" is not a measure stock can be taken in; write it in ml, cl, oz or units`
      : "the line has an amount but no unit; write it in ml, cl, oz or units",
  };
}

/** The facts about one stock row that a line's cost needs. */
export interface StockRowCost {
  /** Recorded cost of one bottle or unit, or null when none is recorded. */
  unitCost: number | null;
  bottleMl: number | null;
}

/** One recipe line's cost per serve, or the reason it is withheld. */
export type LineCost =
  | { state: "not_linked" }
  | { state: "costed"; cost: number }
  | { state: "withheld"; reason: string };

export function lineCost(
  line: { inventory_id?: string | null; quantity?: unknown; unit?: unknown },
  stock: Map<string, StockRowCost>,
): LineCost {
  if (!line.inventory_id) return { state: "not_linked" };
  const row = stock.get(line.inventory_id);
  if (!row) {
    return {
      state: "withheld",
      reason: "the stock row it takes from could not be read",
    };
  }
  const m = recipeMeasure(line.quantity, line.unit);
  if (m.kind === "unread") return { state: "withheld", reason: m.reason };
  if (row.unitCost == null) {
    return { state: "withheld", reason: "its stock row has no recorded cost" };
  }
  if (m.kind === "units")
    return { state: "costed", cost: row.unitCost * m.units };
  if (row.bottleMl == null) {
    return {
      state: "withheld",
      reason:
        "its stock row has no bottle size, so a share of a bottle has no cost",
    };
  }
  return { state: "costed", cost: (row.unitCost * m.ml) / row.bottleMl };
}

/** A cocktail's cost per serve and margin, from its recipe lines. */
export interface ServeCost {
  /** Sum of the linked lines' costs; null when none is linked or any is withheld. */
  costPerServe: number | null;
  /** Price less cost per serve, and that as a share of price; null without both. */
  margin: number | null;
  marginPct: number | null;
  linked: number;
  notLinked: number;
  /** Why the cost is withheld, or null when it is not. */
  withheldReason: string | null;
}

export function serveCost(
  lines: Array<{
    inventory_id?: string | null;
    quantity?: unknown;
    unit?: unknown;
  }>,
  stock: Map<string, StockRowCost>,
  price: unknown,
): ServeCost {
  let total = 0;
  let linked = 0;
  let notLinked = 0;
  let withheldReason: string | null = null;
  for (const l of lines) {
    const c = lineCost(l, stock);
    if (c.state === "not_linked") {
      notLinked++;
      continue;
    }
    linked++;
    if (c.state === "withheld") withheldReason ??= c.reason;
    else total += c.cost;
  }
  const costPerServe =
    linked === 0 || withheldReason ? null : Math.round(total * 100) / 100;
  const p = price == null || price === "" ? NaN : Number(price);
  const priced = Number.isFinite(p) && p > 0;
  return {
    costPerServe,
    margin:
      costPerServe != null && priced
        ? Math.round((p - costPerServe) * 100) / 100
        : null,
    marginPct:
      costPerServe != null && priced
        ? Math.round(((p - costPerServe) / p) * 1000) / 10
        : null,
    linked,
    notLinked,
    withheldReason:
      linked === 0 ? "no recipe line is linked to stock" : withheldReason,
  };
}
