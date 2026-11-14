import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

/**
 * OPENING STOCK STATES ITS COST (r36 invoices audit R1).
 *
 * Stock that arrived with no invoice (the shelf a house already had on day 1,
 * a menu-scan import, an item added with no price, a count that found more)
 * was booked as a lot with no cost, and nothing let anyone say what it cost.
 * Sales draw the oldest lot first, so a new house's first sales took exactly
 * those lots and its cost of goods was withheld.
 *
 * This states one cost per one of the item's own unit (a bottle, a gram, a
 * millilitre: ADR 0070) for the item's lots that came from no delivery and no
 * order and have no settled cost. `state_opening_lot_cost` restates them,
 * keeps their prior cost, and settles every bottle already sold from them.
 * A delivery's or an order's lots are never touched: their paper settles
 * them. A lot that already has a final cost is not corrected here.
 *
 * The cost is in the house's own money; no other currency is taken.
 */
export interface StatedOpeningCost {
  inventoryId: string;
  unitCost: number;
  lotsStated: number;
  unitsStated: number;
  emptyLotsStated: number;
  drawsSettled: number;
  /** One sentence for the person who stated it. */
  said: string;
}

/** A stated cost: a finite number above nothing, at most six decimal places. */
export function readStatedCost(raw: unknown): { ok: true; cost: number } | { ok: false; reason: string } {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n))
    return { ok: false, reason: `the cost reads ${JSON.stringify(raw ?? null)}, which is not a number` };
  if (!(n > 0))
    return { ok: false, reason: `a cost must be more than nothing (got ${n}); a free bottle is recorded as a sample, not as an opening cost` };
  if (Math.round(n * 1e6) / 1e6 !== n)
    return { ok: false, reason: `${n} has more than six decimal places, the precision a lot's cost is kept at` };
  return { ok: true, cost: n };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * What of an item still waits for a stated cost: the lots `state_opening_lot_cost`
 * would restate, read with the same filter (no delivery, no order, no settled
 * cost, this house, this stock state). A lot already sold out is counted too:
 * the function settles what left it, and those sales are what keeps cost of
 * goods withheld, so a page that offered the act only while bottles remain on
 * the shelf would hide it exactly when the shelf is empty.
 */
export interface UncostedOpeningStock {
  inventoryId: string;
  /** Lots with no settled cost from no delivery and no order, sold out ones included. */
  lots: number;
  /** What those lots still hold, in the item's own unit. */
  units: number;
  /** Of `lots`, the ones already sold or used to nothing. */
  emptyLots: number;
}

/** The filter of state_opening_lot_cost, row by row (kept as one predicate so the two cannot drift apart unseen). */
export function awaitsStatedCost(lot: {
  delivery_id: string | null;
  source_order_id: string | null;
  cost_state: string | null;
  unit_cost: number | string | null;
}): boolean {
  return (
    lot.delivery_id === null &&
    lot.source_order_id === null &&
    (lot.cost_state === "provisional" || lot.unit_cost === null)
  );
}

const PAGE = 1000;

@Injectable()
export class OpeningCostService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Read what of one item waits for a stated cost. Paged past the 1000-row
   * read cap; an item rarely has that many lots, but a cap that is hit
   * silently would undercount, and a smaller count is not a safe guess here.
   */
  async uncosted(
    restaurantId: string,
    inventoryId: string,
    stockState: "live" | "shadow" = "live",
  ): Promise<UncostedOpeningStock> {
    let lots = 0;
    let units = 0;
    let emptyLots = 0;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.db
        .getClient()
        .from("inventory_lots")
        .select("id, qty, delivery_id, source_order_id, cost_state, unit_cost")
        .eq("restaurant_id", restaurantId)
        .eq("inventory_id", inventoryId)
        .eq("stock_state", stockState)
        .is("delivery_id", null)
        .is("source_order_id", null)
        .or("cost_state.eq.provisional,unit_cost.is.null")
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error)
        throw new HttpException(
          `What of this item still has no cost could not be read (${error.message}).`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      const rows = (data ?? []) as Array<{
        qty: number | string | null;
        delivery_id: string | null;
        source_order_id: string | null;
        cost_state: string | null;
        unit_cost: number | string | null;
      }>;
      for (const lot of rows) {
        if (!awaitsStatedCost(lot)) continue;
        const qty = Number(lot.qty);
        lots += 1;
        if (Number.isFinite(qty) && qty > 0) units += qty;
        else emptyLots += 1;
      }
      if (rows.length < PAGE) break;
    }
    return { inventoryId, lots, units, emptyLots };
  }

  async state(
    restaurantId: string,
    inventoryId: string,
    rawCost: unknown,
    performedBy: string,
    stockState: "live" | "shadow" = "live",
  ): Promise<StatedOpeningCost> {
    const read = readStatedCost(rawCost);
    if (!read.ok)
      throw new HttpException(`${read.reason}. Nothing was changed.`, HttpStatus.BAD_REQUEST);

    const { data, error } = await this.db.getClient().rpc("state_opening_lot_cost", {
      p_restaurant_id: restaurantId,
      p_inventory_id: inventoryId,
      p_unit_cost: read.cost,
      p_performed_by: performedBy,
      p_stock_state: stockState,
    });
    if (error) {
      if (/not found/i.test(error.message))
        throw new HttpException("This item is not on this house's shelf. Nothing was changed.", HttpStatus.NOT_FOUND);
      throw new HttpException(
        `The cost could not be stated (${error.message}). Nothing was changed; it is safe to try again.`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    const r = (data ?? {}) as Record<string, unknown>;
    const num = (k: string) => (Number.isFinite(Number(r[k])) ? Number(r[k]) : 0);
    const lots = num("lots_stated");
    const units = num("units_stated");
    const draws = num("draws_settled");
    const said =
      lots === 0
        ? "This item has no stock without a cost from outside a delivery, so nothing was stated. Stock from a delivery is costed when the delivery is verified."
        : `Stated on ${plural(lots, "lot")} (${plural(units, "unit")} on the shelf)` +
          (draws > 0 ? `; what already left them is costed at it too (${plural(draws, "draw")}).` : ".");
    return {
      inventoryId,
      unitCost: Number(r.unit_cost ?? read.cost),
      lotsStated: lots,
      unitsStated: units,
      emptyLotsStated: num("empty_lots_stated"),
      drawsSettled: draws,
      said,
    };
  }
}
