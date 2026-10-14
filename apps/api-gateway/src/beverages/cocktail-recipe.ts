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
  /**
   * F-1587: whether that cost is proven without tax (margin advice's
   * `costTaxProof`). Read only for a house whose till prices include tax.
   */
  costTax?: "pre_tax" | "includes_tax" | "not_stated";
  /** The row's name, as a refusal names it. */
  name?: string;
}

/**
 * F-1587: what a house whose till prices include tax adds to a cocktail's
 * margin (ADR 0341 §6, margin advice's rule): the rate its price holds, or why
 * no rate does. Omitted for every other house, whose margin is as before.
 */
export type ServeTax =
  | {
      rate: number;
      /**
       * F-1615: which rate the margin used, in plain words for the margin
       * cell; the whole-house rate says so too (F-1669).
       */
      note?: string;
    }
  | { refusal: string };

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
  /**
   * F-1587, only for a house whose till prices include tax: why there is a
   * cost and no margin, or null when the margin is stated on the price
   * without tax.
   */
  marginRefusal?: string | null;
  /**
   * F-1615: which till category's rate the stated margin is without, when
   * the owner chose it for cocktails. Present only with a stated margin.
   */
  marginTaxNote?: string;
}

export function serveCost(
  lines: Array<{
    inventory_id?: string | null;
    quantity?: unknown;
    unit?: unknown;
  }>,
  stock: Map<string, StockRowCost>,
  price: unknown,
  tax?: ServeTax,
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
  const menu = price == null || price === "" ? NaN : Number(price);
  const priced = Number.isFinite(menu) && menu > 0;
  // F-1587: on an inclusive house the margin is on the price without tax,
  // and only when every linked line's cost is proven without tax too.
  const marginRefusal =
    tax && costPerServe != null && priced
      ? serveTaxRefusal(lines, stock, tax)
      : null;
  const p = tax && "rate" in tax ? menu / (1 + tax.rate) : menu;
  const stated = costPerServe != null && priced && marginRefusal === null;
  return {
    costPerServe,
    margin: stated ? Math.round((p - costPerServe) * 100) / 100 : null,
    marginPct: stated ? Math.round(((p - costPerServe) / p) * 1000) / 10 : null,
    linked,
    notLinked,
    withheldReason:
      linked === 0 ? "no recipe line is linked to stock" : withheldReason,
    ...(tax ? { marginRefusal } : {}),
    ...(stated && tax && "note" in tax && tax.note
      ? { marginTaxNote: tax.note }
      : {}),
  };
}

/** Why a costed cocktail on an inclusive house has no margin, or null (F-1587). */
function serveTaxRefusal(
  lines: Array<{ inventory_id?: string | null }>,
  stock: Map<string, StockRowCost>,
  tax: ServeTax,
): string | null {
  if ("refusal" in tax) return tax.refusal;
  for (const l of lines) {
    const row = l.inventory_id ? stock.get(l.inventory_id) : undefined;
    if (!row || row.costTax === "pre_tax") continue;
    const what = row.name
      ? `the recorded cost of ${row.name}`
      : "a linked line's recorded cost";
    return row.costTax === "includes_tax"
      ? `No margin: ${what} includes tax. Your till prices include tax, so margin is worked out without tax, and only a cost recorded without tax can be used.`
      : `No margin: cost basis not stated. Your till prices include tax, so margin is worked out without tax, and ${what} does not say whether tax is inside it.`;
  }
  return null;
}

/**
 * F-1474: the cocktails an 86 reaches. A cocktail cannot be served while any
 * recipe line linked to stock takes from a row with an open stock-out
 * (`stock_outs`, ended_at null). Each is named by the line's own words, the
 * way the bar wrote it, so the owner reads which bottle stops the drink.
 */
export function cocktailsSoldOut(
  lines: Array<{
    cocktail_id: string;
    inventory_id?: string | null;
    free_text?: string | null;
  }>,
  out: Set<string>,
): Map<string, string[]> {
  const by = new Map<string, string[]>();
  for (const l of lines) {
    if (!l.inventory_id || !out.has(l.inventory_id)) continue;
    const list = by.get(l.cocktail_id) ?? [];
    const word = l.free_text?.trim() || "a linked ingredient";
    if (!list.includes(word)) list.push(word);
    by.set(l.cocktail_id, list);
  }
  return by;
}

/**
 * F-1474: how a menu line's name is compared with a cocktail's -- the till's
 * rule (pos-hub's cocktailNameKey, F-1329): trimmed, one space between words,
 * case folded, the Turkish dotted and dotless i read as one letter. Exact
 * after that; nothing fuzzier names a recipe.
 */
export function cocktailNameKey(name: string | null | undefined): string {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[ıİI]/g, "i")
    .toLowerCase();
}

/**
 * F-1668: the price each cocktail's line on a live menu carries, by the
 * cocktail it names (the till's name rule, `cocktailNameKey`; a name two
 * cocktails share names neither, as readMenuCocktails reads it). A cocktail's
 * margin is worked out on its own /cocktails price, which no menu writes, so
 * a menu read that moves a Negroni from 450 to 520 left the margin on 450
 * with nothing said. The row now carries the menu's price beside its own.
 * Each line gives its glass, bottle or own price, whichever it carries; the
 * distinct prices come back sorted, and a cocktail on no line is absent.
 */
export function cocktailMenuPrices(
  cocktails: Array<{ id: string; name?: unknown; display_name?: unknown }>,
  lines: Array<Record<string, unknown>>,
): Map<string, number[]> {
  const byName = new Map<string, string>();
  const shared = new Set<string>();
  for (const c of cocktails) {
    for (const key of new Set(
      [c.name, c.display_name]
        .filter((v): v is string => typeof v === "string" && v !== "")
        .map(cocktailNameKey),
    )) {
      if (byName.has(key) && byName.get(key) !== c.id) shared.add(key);
      else byName.set(key, c.id);
    }
  }
  for (const key of shared) byName.delete(key);
  const out = new Map<string, Set<number>>();
  for (const l of lines) {
    const id = byName.get(cocktailNameKey(l.name as string));
    if (!id) continue;
    for (const v of [l.by_glass_price, l.bottle_price, l.price]) {
      const p = v == null || v === "" ? NaN : Number(v);
      if (!Number.isFinite(p) || p <= 0) continue;
      const set = out.get(id) ?? new Set<number>();
      set.add(Math.round(p * 100) / 100);
      out.set(id, set);
    }
  }
  return new Map(
    [...out].map(([id, set]) => [id, [...set].sort((a, b) => a - b)]),
  );
}
