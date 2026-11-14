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

@Injectable()
export class OpeningCostService {
  constructor(private readonly db: DatabaseService) {}

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
