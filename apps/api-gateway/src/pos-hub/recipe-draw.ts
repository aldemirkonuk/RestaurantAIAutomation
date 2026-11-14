/**
 * What one till line takes off the shelf when it sells a recipe: the plan,
 * worked out before anything is written (inventory r28, gap 1).
 *
 * Today a till line moves stock only when it is a wine with one mapped
 * `inventory_id` (`pos-hub.service.ts`, the `!it.is_wine` skip and
 * `record_glass_pour` / `apply_stock_movement`). No recipe is read. So for
 * every food and every spirit poured into a cocktail, usage a day, days of
 * cover and below-par move only when someone counts.
 *
 * This module is pure. It reads the recipe a line sold (`recipe_versions` and
 * `recipe_lines`, PR #863, ADR 0360) and the house's shelf items, and returns
 * either the draws or the reason the whole line waits. The writer, a later
 * slice, books each draw through the ledger under its own key.
 *
 * THE INVARIANTS, written before the cases that test them:
 *
 *  I1 Conservation. A line of `n` serves of a version that yields `Y` serves
 *     takes exactly `n * qty_base / Y` base units of each stocked line's item.
 *     The ledger holds whole units (ADR 0070). Across sales, booked units plus
 *     the carried remainder equal the exact draw: `settle` keeps
 *     `0 <= carry < one unit`. A good is never over-drawn, and never owed more
 *     than one of its own units.
 *  I2 All or nothing (proposal F6, "queue it, take nothing"). If any stocked
 *     line cannot be drawn, the whole line waits and takes nothing. Causes:
 *     not linked, not this house's, no unit, wrong measure, or a container
 *     with no size. Drawing the rest would book a Negroni as gin and Campari,
 *     and the variance would blame the vermouth on theft.
 *  I3 A void gives back what its sale took. It returns the movements booked
 *     under the sale's keys. It never re-explodes the recipe, which may have
 *     a newer version by then. That is the writer's rule, and the plan makes
 *     it possible by naming the version it used.
 *  I4 One key per item per line: `${saleKey}:r:${inventoryId}:${via}`. A replay
 *     moves nothing, and two lines of one recipe that use the same good merge
 *     into one draw.
 *  I5 House. Every item a line names must be in this house's shelf read
 *     (ADR 0141). A failed read cannot say yes.
 *  I6 Units never cross. Volume (tenths of a ml) draws from a good kept in
 *     ml or l, or pours from a bottle or keg of known size. Weight (mg)
 *     draws from mg, g or kg. A count (thousandths of an each) draws from
 *     each or from a count of containers. Anything else waits.
 *  I7 Exact arithmetic. Draws are carried as integer millionths of a base
 *     unit in BigInt, so `n * qty_base * 10^6` never loses a digit. The
 *     division by the yield truncates by under one millionth of a base unit
 *     per line per sale (under a ten-millionth of a ml). Truncation keeps a
 *     draw from ever exceeding the recipe.
 *
 * Untracked lines (garnish, ice, water) never draw (ADR 0360 F2). A recipe
 * with only untracked lines plans no draws and does not wait.
 */

export type BaseUnit = "ml10" | "mg" | "each_milli";

export interface RecipeLine {
  position: number;
  role: "stocked" | "untracked";
  /** null on a stocked line means "not linked yet" (ADR 0360 F2/F6). */
  inventoryId: string | null;
  label: string;
  /** Integer, in `baseUnit` (recipe_lines.qty_base, CHECK > 0). */
  qtyBase: number;
  baseUnit: BaseUnit;
}

export interface RecipeVersion {
  id: string;
  /** recipe_versions.yield_serves, CHECK > 0. */
  yieldServes: number;
  lines: RecipeLine[];
}

/** The two facts about a shelf item a draw needs. */
export interface ShelfItem {
  /** restaurant_inventory.uom: bottle, case, keg, pack, each, glass, shot, ml, l, mg, g, kg. */
  uom: string | null;
  bottleSizeMl: number | null;
}

/**
 * `book`: apply_stock_movement in the item's own unit.
 * `pour`: record_glass_pour in whole ml, from the open container.
 */
export type DrawVia = "book" | "pour";

export interface PlannedDraw {
  inventoryId: string;
  via: DrawVia;
  /**
   * The recipe measure this draw is counted in. One item reaches one via
   * from one base unit (route is a function of the item's uom), so lines
   * merged under one key always share it. The writer keys its carry by it.
   */
  baseUnit: BaseUnit;
  /** Exact draw, in millionths of the line's base unit (I7). */
  exactMicro: bigint;
  /** Base units in one ledger unit (10 for a ml, 1,000 for a g…). */
  basePerUnit: bigint;
  /** The recipe lines this draw adds up, by position. */
  positions: number[];
}

export type WaitReason =
  | "bad_quantity"
  | "bad_yield"
  | "unlinked"
  | "not_this_house"
  | "no_unit"
  | "measure_mismatch"
  | "no_container_size";

export interface LineWait {
  position: number | null;
  label: string | null;
  reason: WaitReason;
}

export type DrawPlan =
  | { kind: "draw"; versionId: string; draws: PlannedDraw[] }
  | { kind: "wait"; versionId: string; waits: LineWait[] };

export const MICRO = 1_000_000n;

const POURABLE = new Set(["bottle", "keg"]);
const CONTAINER_COUNT = new Set(["bottle", "case", "keg", "pack", "glass", "shot"]);

/** How a base unit reaches an item kept in `uom`, or why it cannot. */
export function route(
  base: BaseUnit,
  item: ShelfItem,
): { via: DrawVia; basePerUnit: bigint } | { wait: WaitReason } {
  const uom = item.uom;
  if (uom === null || uom === "") return { wait: "no_unit" };
  if (base === "ml10") {
    if (uom === "ml") return { via: "book", basePerUnit: 10n };
    if (uom === "l") return { via: "book", basePerUnit: 10_000n };
    if (POURABLE.has(uom)) {
      // record_glass_pour draws ml from the open container; it needs a size.
      return item.bottleSizeMl !== null && item.bottleSizeMl > 0
        ? { via: "pour", basePerUnit: 10n }
        : { wait: "no_container_size" };
    }
    return { wait: "measure_mismatch" };
  }
  if (base === "mg") {
    if (uom === "mg") return { via: "book", basePerUnit: 1n };
    if (uom === "g") return { via: "book", basePerUnit: 1_000n };
    if (uom === "kg") return { via: "book", basePerUnit: 1_000_000n };
    return { wait: "measure_mismatch" };
  }
  // each_milli
  if (uom === "each" || CONTAINER_COUNT.has(uom)) return { via: "book", basePerUnit: 1_000n };
  return { wait: "measure_mismatch" };
}

/**
 * The draws one till line makes, or why it waits (I1, I2, I5, I6, I7).
 *
 * `shelf` is the house-scoped read of the items the version names. An id
 * missing from it is not this house's (I5).
 */
export function planRecipeDraw(
  version: RecipeVersion,
  serves: number,
  shelf: ReadonlyMap<string, ShelfItem>,
): DrawPlan {
  const versionId = version.id;
  if (!Number.isSafeInteger(serves) || serves <= 0) {
    return { kind: "wait", versionId, waits: [{ position: null, label: null, reason: "bad_quantity" }] };
  }
  if (!Number.isSafeInteger(version.yieldServes) || version.yieldServes <= 0) {
    return { kind: "wait", versionId, waits: [{ position: null, label: null, reason: "bad_yield" }] };
  }
  const waits: LineWait[] = [];
  const merged = new Map<string, PlannedDraw>();
  for (const line of version.lines) {
    if (line.role !== "stocked") continue;
    const wait = (reason: WaitReason) => waits.push({ position: line.position, label: line.label, reason });
    if (line.inventoryId === null) {
      wait("unlinked");
      continue;
    }
    if (!Number.isSafeInteger(line.qtyBase) || line.qtyBase <= 0) {
      wait("bad_quantity");
      continue;
    }
    const item = shelf.get(line.inventoryId);
    if (!item) {
      wait("not_this_house");
      continue;
    }
    const r = route(line.baseUnit, item);
    if ("wait" in r) {
      wait(r.wait);
      continue;
    }
    const exactMicro = (BigInt(line.qtyBase) * BigInt(serves) * MICRO) / BigInt(version.yieldServes);
    // One item reaches one unit per `via` (route is a function of uom), so
    // this is the drawKey's own grain (I4).
    const key = `${line.inventoryId}:${r.via}`;
    const prior = merged.get(key);
    if (prior) {
      prior.exactMicro += exactMicro;
      prior.positions.push(line.position);
    } else {
      merged.set(key, {
        inventoryId: line.inventoryId,
        via: r.via,
        baseUnit: line.baseUnit,
        exactMicro,
        basePerUnit: r.basePerUnit,
        positions: [line.position],
      });
    }
  }
  if (waits.length > 0) return { kind: "wait", versionId, waits };
  return { kind: "draw", versionId, draws: [...merged.values()] };
}

/** The ledger key of one planned draw (I4). A void appends `:void`, as pos-hub does. */
export function drawKey(saleKey: string, d: Pick<PlannedDraw, "inventoryId" | "via">): string {
  return `${saleKey}:r:${d.inventoryId}:${d.via}`;
}

/**
 * Turn an exact draw into whole ledger units, carrying the remainder (I1).
 * This is the reference the writer must match. It runs inside the same
 * transaction as the movement, with the carry row locked.
 *
 *   units * basePerUnit * MICRO + carryOut === carryIn + exactMicro
 *   0n <= carryOut < basePerUnit * MICRO
 */
export function settle(
  exactMicro: bigint,
  basePerUnit: bigint,
  carryIn: bigint,
): { units: number; carryOut: bigint } {
  if (exactMicro < 0n || carryIn < 0n || basePerUnit <= 0n) {
    throw new RangeError("settle takes a draw, a unit and a carry that are not negative");
  }
  const unitMicro = basePerUnit * MICRO;
  const total = carryIn + exactMicro;
  const units = total / unitMicro;
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("draw too large to book");
  return { units: Number(units), carryOut: total % unitMicro };
}

/**
 * Give back a booked draw, for a void (writer invariant W7). The exact draw
 * leaves the carry, and the fewest whole units go back to the shelf that keep
 * the carry a true remainder:
 *
 *   carryOut + exactMicro === carryIn + units * basePerUnit * MICRO
 *   0n <= carryOut < basePerUnit * MICRO   (when carryIn is)
 *
 * When nothing drew the same good between a sale and its void, this gives
 * back exactly the units the sale booked and puts the carry back where it
 * was. When something did, the units can differ from the sale's by one, and
 * the books still add up: booked units plus the carry equal the exact draws
 * still standing. The recipe is never read again (I3): only the recorded
 * exact draw is.
 */
export function unsettle(
  exactMicro: bigint,
  basePerUnit: bigint,
  carryIn: bigint,
): { units: number; carryOut: bigint } {
  if (exactMicro < 0n || carryIn < 0n || basePerUnit <= 0n) {
    throw new RangeError("unsettle takes a draw, a unit and a carry that are not negative");
  }
  const unitMicro = basePerUnit * MICRO;
  if (exactMicro <= carryIn) return { units: 0, carryOut: carryIn - exactMicro };
  const owed = exactMicro - carryIn;
  const units = (owed + unitMicro - 1n) / unitMicro;
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("draw too large to give back");
  return { units: Number(units), carryOut: units * unitMicro - owed };
}

/** One draw as `record_recipe_draw` takes it. Big integers travel as strings. */
export interface DrawArg {
  inventory_id: string;
  via: DrawVia;
  base_unit: BaseUnit;
  base_per_unit: string;
  exact_micro: string;
}

/**
 * The arguments of `record_recipe_draw` for a plan that draws. The database
 * re-checks every item's house and route under its lock and settles the
 * carry there; this only carries the plan across. A plan that waits has
 * nothing to send.
 */
export function drawArgs(
  restaurantId: string,
  saleKey: string,
  cocktailId: string | null,
  plan: Extract<DrawPlan, { kind: "draw" }>,
  occurredAt: string | null,
): {
  p_restaurant: string;
  p_sale_key: string;
  p_version_id: string;
  p_cocktail_id: string | null;
  p_draws: DrawArg[];
  p_occurred_at: string | null;
} {
  return {
    p_restaurant: restaurantId,
    p_sale_key: saleKey,
    p_version_id: plan.versionId,
    p_cocktail_id: cocktailId,
    p_draws: plan.draws.map((d) => ({
      inventory_id: d.inventoryId,
      via: d.via,
      base_unit: d.baseUnit,
      base_per_unit: d.basePerUnit.toString(),
      exact_micro: d.exactMicro.toString(),
    })),
    p_occurred_at: occurredAt,
  };
}
