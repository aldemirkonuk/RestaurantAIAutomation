/**
 * How many bottles one consumption line is (ADR 0297).
 *
 * `wine_consumption_log.quantity` counts SERVINGS in the line's own mode, not
 * bottles (ADR 0011). The POS mirror writes it that way
 * (pos-hub.service.ts:1583-1587, :1625): a bottle line is `quantity` bottles,
 * and a glass line is `quantity` pours whose millilitres sit in `volume_ml`.
 * Every demand reader used to take `quantity` as bottles, so a 150 ml glass
 * counted as a whole bottle and a 50 ml rakı single as fifteen times what it
 * poured (AW02).
 *
 * The rule here is the only converter the readers use:
 *
 *   - a `bottle` line with a `quantity` of 0 or more is that many bottles,
 *     whatever the bottle's size;
 *   - a `glass` line is its millilitres over the item's STATED bottle size
 *     (`restaurant_inventory.bottle_size_ml`, positive only, the same test as
 *     pos-hub's `loadInventoryVolumes`);
 *   - a glass line of an item with no stated size rests on the 750 ml stand-in
 *     the stock itself moves by, and is labelled as resting on it;
 *   - anything else (no mode, a bottle line with no `quantity` of 0 or more,
 *     or a glass line with no positive millilitres) has NO bottle figure. It
 *     is never 1 and never 0.
 *
 * `master_wine_library.bottle_size_ml` is never read: its 750 is a default,
 * not a reading (ADR 0124).
 *
 * Pure: no I/O, so every reader converts the same way and the claims guard
 * can hold one file to it.
 */

/**
 * The size an unsized item's stock moves by. `record_glass_pour` COALESCEs a
 * missing `bottle_size_ml` to 750 before it takes a pour off the open bottle
 * (supabase/migrations/20261222100000_a_pos_sale_is_dated_by_its_check.sql:318,
 * the newest migration that defines it), and pos-hub mirrors the same number
 * (RPC_DEFAULT_BOTTLE_ML, pos-hub.service.ts:33). Demand counted
 * on any other size would disagree with the stock figure it is set beside.
 * The founder's fork 1 answer (ADR 0297): "750 ml stand-in (Recommended)",
 * labelled, and dropped per item as soon as its size is stated. It goes with
 * the stock's own stand-in when R7 ("One wine at a time (Recommended)", ADR
 * 0115) retires it.
 */
export const STOCK_STAND_IN_BOTTLE_ML = 750;

/** Where a line's bottle figure came from. */
export type BottleHow = "bottle" | "stated_size" | "stand_in" | "uncounted";

export interface LineBottles {
  /** Bottles this line moved; null when the line carries no bottle figure. */
  bottles: number | null;
  how: BottleHow;
}

/** The raw row as a reader selects it. Every field may be missing. */
export interface ConsumptionUnitsRow {
  consumption_type?: unknown;
  quantity?: unknown;
  volume_ml?: unknown;
  restaurant_inventory?: { bottle_size_ml?: unknown } | null;
}

function finite(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * A size is a reading only when it is a positive number (pos-hub's
 * inventoryVolumesFromRow, pos-hub.service.ts:58-62).
 */
function statedSize(v: unknown): number | null {
  const n = finite(v);
  return n !== null && n > 0 ? n : null;
}

export function bottlesOf(row: ConsumptionUnitsRow): LineBottles {
  const mode = row?.consumption_type;
  if (mode === "bottle") {
    const q = finite(row.quantity);
    // A bottle line never reads the size: `quantity` already IS bottles.
    if (q !== null && q >= 0) return { bottles: q, how: "bottle" };
    return { bottles: null, how: "uncounted" };
  }
  if (mode === "glass") {
    const ml = finite(row.volume_ml);
    if (ml === null || ml <= 0) return { bottles: null, how: "uncounted" };
    const size = statedSize(row.restaurant_inventory?.bottle_size_ml);
    if (size !== null) return { bottles: ml / size, how: "stated_size" };
    return { bottles: ml / STOCK_STAND_IN_BOTTLE_ML, how: "stand_in" };
  }
  return { bottles: null, how: "uncounted" };
}

/** Servings in the line's own mode (ADR 0011); null when not a number. */
export function servingsOf(row: ConsumptionUnitsRow): number | null {
  return finite(row?.quantity);
}

/** Millilitres the line recorded; null when not a number. */
export function volumeMlOf(row: ConsumptionUnitsRow): number | null {
  return finite(row?.volume_ml);
}

export interface UnitsCoverage {
  /** Lines the figure was built from. */
  lines: number;
  /** Glass lines with a bottle figure (stated size or stand-in). */
  glassLines: number;
  /** Glass lines resting on the 750 ml stand-in. */
  standInLines: number;
  /** Distinct items those stand-in lines belong to. */
  standInItems: number;
  /** Lines with no bottle figure. */
  uncountedLines: number;
  /** Distinct items those uncounted lines belong to. */
  uncountedItems: number;
  /** True when every line has a bottle figure. An empty window is complete. */
  complete: boolean;
}

export function summarizeUnits(
  lines: Array<{ how: BottleHow; inventoryId?: string | null }>,
): UnitsCoverage {
  let glassLines = 0;
  let standInLines = 0;
  let uncountedLines = 0;
  const standIn = new Set<string>();
  const uncounted = new Set<string>();
  for (const l of lines) {
    const item = String(l.inventoryId ?? "");
    if (l.how === "stated_size" || l.how === "stand_in") glassLines += 1;
    if (l.how === "stand_in") {
      standInLines += 1;
      standIn.add(item);
    } else if (l.how === "uncounted") {
      uncountedLines += 1;
      uncounted.add(item);
    }
  }
  return {
    lines: lines.length,
    glassLines,
    standInLines,
    standInItems: standIn.size,
    uncountedLines,
    uncountedItems: uncounted.size,
    complete: uncountedLines === 0,
  };
}

/**
 * Every cause `bottlesOf` has for a line with no bottle figure. A sentence
 * that names the cause names all three: a bottle line with a quantity below
 * 0 is one, as much as a glass line with no millilitres (ADR 0297).
 */
const UNCOUNTED_CAUSES =
  "no bottle or glass mode, a bottle line with no quantity of 0 or more, or a glass line with no millilitres above 0";

function n(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The per-line truth, as a sentence a `basis` string can carry. Built from
 * the coverage, never written by hand, on the pattern of costBasisSentence
 * (inventory-cost.ts): a basis must describe the lines it actually covered.
 */
export function unitsBasisSentence(cov: UnitsCoverage): string {
  if (cov.lines === 0) return "no consumption lines in this window";
  const parts = [
    "bottles by each line's own mode: a bottle line is its quantity, a glass line is its millilitres over the item's stated bottle size",
  ];
  if (cov.standInLines > 0)
    parts.push(
      `${n(cov.standInLines, "glass line", "glass lines")} across ${n(cov.standInItems, "item", "items")} with no stated bottle size ${cov.standInLines === 1 ? "rests" : "rest"} on the ${STOCK_STAND_IN_BOTTLE_ML} ml stand-in the stock moves by, until the size is stated`,
    );
  else if (cov.glassLines > 0)
    parts.push("every glass line's item states its bottle size");
  if (cov.uncountedLines > 0)
    parts.push(
      `${n(cov.uncountedLines, "line", "lines")} across ${n(cov.uncountedItems, "item", "items")} ${cov.uncountedLines === 1 ? "carries" : "carry"} no bottle figure (${UNCOUNTED_CAUSES}), so every figure resting on ${cov.uncountedLines === 1 ? "it" : "them"} is null rather than guessed`,
    );
  else parts.push("every line has a bottle figure");
  return parts.join("; ");
}

/**
 * The label a figure carries: the counts of the lines it was built from,
 * stand-in lines and items included, and the sentence that says so. Fork 1
 * (ADR 0297) is the stand-in "labelled", with the counts of the lines and
 * items resting on it, so a figure that carries one never carries the other
 * alone.
 */
export interface UnitsLabel extends UnitsCoverage {
  basis: string;
}

export function unitsLabel(
  lines: Array<{ how: BottleHow; inventoryId?: string | null }>,
): UnitsLabel {
  const cov = summarizeUnits(lines);
  return { ...cov, basis: unitsBasisSentence(cov) };
}

/**
 * A total that would rest on a line with no bottle figure is refused, never
 * summed short (ADR 0020, ADR 0086). The goal reads "could not be read" with
 * this message (goals.service.ts listGoalsWithProgress).
 */
export class UncountedConsumptionError extends Error {
  constructor(readonly coverage: UnitsCoverage) {
    super(
      `Bottles sold could not be counted: ${n(coverage.uncountedLines, "consumption line", "consumption lines")} across ${n(coverage.uncountedItems, "item", "items")} ${coverage.uncountedLines === 1 ? "has" : "have"} no bottle figure (${UNCOUNTED_CAUSES}), so a total would be short rather than true.`,
    );
    this.name = "UncountedConsumptionError";
  }
}
