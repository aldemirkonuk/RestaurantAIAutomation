import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { queueResearchIfLibraryLacks } from "../../inventory/house-item-research";
import { closeDeliveryItemToNameBookedElsewhere } from "../delivery-item-to-name";
import { perBottleLotCost, proposalPerBottle } from "./lot-unit-cost";

/**
 * DeliveryStockService — ADR 0103 A1 + A5: stock at the door, cost at VERIFIED.
 *
 * THE ONE BOOKING PATH.
 *
 * Before this file the repository had three receiving write paths and one
 * column that lied about all of them:
 *
 *   `recordDoorReceipt`  booked live stock per receipt EVENT, unit-safe,
 *                        idempotent on the event id.
 *   `markDelivered`      booked the whole order in one shot, keyed
 *                        `order-delivered:${orderId}` — so the second truck of
 *                        a split shipment found the key used and booked NOTHING
 *                        (v3.0-TECH-DEBT.md, 2026-09-06; ADR 0103 A2).
 *   the delivery model   booked nothing at all: the vendor lens measured 0
 *                        `inventory_transactions` and 0 lots touched for a
 *                        delivery that went all the way to VERIFIED.
 *   `inventory_lots.cost_state`  `DEFAULT 'final' NOT NULL` with NO writer —
 *                        165 of 165 production lots read `final`, so every lot
 *                        certified its own cost by absence.
 *
 * `bookAtTheDoor` is now the single function that turns a counted line into
 * stock, and every write it makes carries the delivery's name. Its idempotency
 * key is `(delivery_id, document_id, line_no)` — A2's rule, because the ORDER
 * is not the unit of delivery: one order can arrive on two trucks and one truck
 * can carry two vendors' invoices.
 *
 * WHAT IS PROVISIONAL, AND WHY THAT IS THE POINT.
 * A lot booked here has NO price. Not zero — absent (A6). Nobody has read an
 * invoice at the door, and a price of 0.00 is a claim that the goods were free.
 * The lot is `cost_state = 'provisional'`, so it is pourable and it is absent
 * from any figure that means "what this cost us", exactly as A1 says. It
 * becomes `final` in `finaliseAtVerified`, with the price the two sides agreed,
 * and the QUANTITY IS NEVER TOUCHED THERE — money moves, bottles do not.
 *
 * WHAT IS NOT BOOKED IS SAID, NEVER ASSUMED (A6).
 * A line that names no shelf, or counts nothing, does not silently disappear
 * and does not get matched to an item by its description — a wrong guess books
 * ten bottles onto the wrong wine. It comes back in `notBooked` with a reason,
 * and the caller renders it.
 */

/** One line the door counted, resolved (or not) to a shelf. */
export interface BookedLine {
  documentId: string;
  lineNo: number;
  inventoryId: string;
  /** The delta actually applied, in bottles. 0 = already booked. */
  delta: number;
  transactionId: string | null;
}

export interface UnbookedLine {
  documentId: string;
  lineNo: number;
  label: string;
  reason: string;
}

export interface BookingReceipt {
  deliveryId: string;
  documentId: string;
  booked: BookedLine[];
  notBooked: UnbookedLine[];
  /** Bottles moved by this call. 0 with a non-empty `booked` = a retry. */
  bottlesMoved: number;
  /**
   * Per item this call booked stock INTO that the wine library lacks: its
   * place on the research queue, or why it could not be queued (founder,
   * 2026-09-22: "Yes, same rule"). A library wine is not listed. The stock
   * stands either way.
   */
  research?: Array<
    | { inventoryId: string; status: "queued" | "not_findable" | "matched" }
    | { inventoryId: string; error: string }
  >;
}

export interface FinalisedItem {
  inventoryId: string;
  unitCost: number;
  provenance: "invoice" | "manual";
  lotsMatched: number;
  lotsFinalised: number;
  bottlesFinalised: number;
  source: "accepted_proposal" | "invoice_line";
  basis?: string;
}

/** A lot a re-verify left at its cost, and why (QA 9a / 10a). */
export interface CostFlag {
  inventoryId: string;
  /** `refused`: its line now refuses a cost. `line_changed`: its cost no longer matches its line. */
  kind: "refused" | "line_changed";
  reason: string;
}

/** What `repairPrintedCost` did, or in a dry run would do. */
export interface CostRepair {
  repaired: FinalisedItem[];
  flagged: CostFlag[];
  /** Every correction, posted or (dry run) not: booked cost to per-bottle cost. */
  changes: { inventoryId: string; from: number; to: number; source: FinalisedItem["source"] }[];
}

export interface CostReceipt {
  deliveryId: string;
  finalised: FinalisedItem[];
  /** Items whose cost could not be settled, each with the reason. */
  stillProvisional: { inventoryId: string; reason: string }[];
}

export type StockResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

interface LineRow {
  document_id: string;
  line_no: number | null;
  inventory_id: string | null;
  qty_bottles: number | string | null;
  unit_price: number | string | null;
  description: string | null;
  vendor_sku: string | null;
  uom?: string | null;
  pack_size?: number | string | null;
  price_base_qty?: number | string | null;
  price_base_uom?: string | null;
  line_total?: number | string | null;
  printed?: unknown;
}

/** QA 12b D1: the invoice line whose price base a door-count proposal is read
 * in — the item's own, else the delivery's only, unattached, invoice line.
 * Several lines count only when their printed prices settle one base. */
function baseLine(invoice: LineRow[], id: string | null): LineRow | undefined {
  const own = id ? invoice.filter((l) => l.inventory_id === id) : [];
  const lines = own.length ? own : invoice.length === 1 && !invoice[0].inventory_id ? invoice : [];
  if (lines.length === 1) return lines[0];
  const bases = new Set(lines.map((l) => {
    const c = perBottleLotCost(l);
    return c.ok ? c.bottles : NaN;
  }));
  return lines.length && bases.size === 1 && !bases.has(NaN) ? lines[0] : undefined;
}

interface AgreedPrice {
  unitCost: number;
  provenance: "invoice" | "manual";
  source: "accepted_proposal" | "invoice_line";
  basis?: string;
}

/**
 * THE CONSOLIDATION GUARANTEE (ADR 0103 A5), as a free function so the two
 * legacy receiving paths can ask it without taking a dependency on this module.
 *
 * `recordDoorReceipt` and `markDelivered` still exist — the web door outbox,
 * the orders screen and the mobile app call them, and retiring the endpoints is
 * a client change, not a service one. What they are no longer allowed to be is
 * a SECOND WRITER. Both ask this first, and a `true` means the bottles are
 * already on the shelf under the delivery's own (delivery, document, line)
 * keys, so booking them again would double the count.
 *
 * A FAILED READ IS NOT A `false` (ADR 0067). `ok: false` comes back and the
 * callers refuse to book on it: "I could not tell" must never resolve to "go
 * ahead", which is exactly how one delivery lands on the shelf twice.
 */
export async function deliveryHasBookedOrder(
  client: {
    from: (table: string) => any;
  },
  orderId: string,
): Promise<StockResult<{ booked: boolean; deliveryIds: string[] }>> {
  // The null filter is applied in JS rather than as `.not("delivery_id","is",
  // null)` so this reads through every Supabase-shaped client the repository
  // has, including the test doubles. The predicate is identical.
  const read = await client
    .from("inventory_transactions")
    .select("delivery_id")
    .eq("order_id", orderId);
  if (read?.error)
    return {
      ok: false,
      status: 503,
      error: `whether the delivery model has already booked stock for order ${orderId} could not be read (${read.error.message}), so nothing was booked. Booking without this answer is how one delivery lands on the shelf twice (ADR 0103 A5).`,
    };
  const ids = [
    ...new Set(
      ((read?.data ?? []) as { delivery_id: string | null }[])
        .map((r) => r.delivery_id)
        .filter((x): x is string => !!x),
    ),
  ];
  return { ok: true, value: { booked: ids.length > 0, deliveryIds: ids } };
}

/**
 * Why a give-back did not move the shelf, in words about giving back (r31
 * walk w2, F4). The booking's own sentence ("retrying books exactly what is
 * missing") was quoted inside the return notice, where nothing is being
 * booked. The ledger refuses a return that would leave fewer than none
 * ("stock would go negative: 4 + -6"); that is said as the shelf and the
 * return it could not hold. Anything else is said as it came, with no stop
 * of its own, so the caller's sentence can carry on after it.
 */
export function givingBackFailure(dbMessage: string): string {
  const below = /stock would go negative:\s*(-?\d+(?:\.\d+)?)\s*\+\s*-(\d+(?:\.\d+)?)/.exec(dbMessage);
  if (below) {
    const [, have, give] = below;
    return `giving it back would take the shelf below zero (${Number(have)} on hand, ${Number(give)} to give back)`;
  }
  return `the shelf could not be moved (${dbMessage.trim().replace(/[.\s]+$/, "")})`;
}

@Injectable()
export class DeliveryStockService {
  private readonly logger = new Logger(DeliveryStockService.name);

  constructor(private readonly db: DatabaseService) {}

  // -------------------------------------------------------------------------
  // The door
  // -------------------------------------------------------------------------

  /**
   * Book the stock a door count recorded, once per (delivery, document, line).
   *
   * A CORRECTION MOVES THE DELTA, IT DOES NOT EDIT (ADR 0104 D5). A second door
   * count on the same delivery is a different document, so it gets its own
   * keys; what it books is the difference between what it says the shelf should
   * hold for that item and what this delivery has already put there. Nothing is
   * rewritten and nothing is deleted — the ledger keeps both movements and the
   * arithmetic still lands on the corrected number.
   */
  async bookAtTheDoor(
    restaurantId: string,
    deliveryId: string,
    documentId: string,
    userId: string | null,
  ): Promise<StockResult<BookingReceipt>> {
    const delivery = await this.deliveryFor(restaurantId, deliveryId);
    if (!delivery.ok) return delivery;

    // A settled delivery does not book more stock. REJECTED and CANCELLED are
    // reversals' business; VERIFIED already had its cost posted.
    if (["CANCELLED", "REJECTED", "LAPSED"].includes(delivery.value.state))
      return {
        ok: false,
        status: 409,
        error: `This delivery is ${delivery.value.state}. Nothing new is booked onto it — a ${delivery.value.state} delivery either never took the goods or has already given them back.`,
      };

    const read = await this.db
      .getClient()
      .from("procurement_document_lines")
      .select(
        "document_id, line_no, inventory_id, qty_bottles, unit_price, description, vendor_sku",
      )
      .eq("restaurant_id", restaurantId)
      .eq("document_id", documentId);
    // ADR 0067: a failed read is never an empty one. Returning "0 lines, all
    // booked" here would be this stop's own version of finding 2.
    if (read.error)
      return {
        ok: false,
        status: 500,
        error: `the counted lines of document ${documentId} could not be read (${read.error.message}), so nothing was booked. Retry is safe — every booking is keyed on (delivery, document, line).`,
      };
    const lines = (read.data ?? []) as unknown as LineRow[];
    if (!lines.length)
      return {
        ok: false,
        status: 409,
        error: `Document ${documentId} has no lines, so there is nothing to book. A delivery nobody counted is "not counted" (ADR 0103 A6), never zero stock.`,
      };

    const booked: BookedLine[] = [];
    const notBooked: UnbookedLine[] = [];
    let bottlesMoved = 0;

    // What THIS delivery has already put on each shelf, so a corrected count
    // moves the difference rather than the whole number a second time.
    const already = await this.bookedSoFar(deliveryId);
    if (!already.ok) return already;

    for (const line of lines) {
      const label = line.description ?? line.vendor_sku ?? `line ${line.line_no}`;
      if (line.line_no == null) {
        notBooked.push({
          documentId,
          lineNo: -1,
          label,
          reason:
            "this line carries no line number, so it cannot be given an idempotency key — booking it could not be made safe to retry",
        });
        continue;
      }
      const inventoryId =
        line.inventory_id ??
        (lines.length === 1 ? delivery.value.orderInventoryId : null);
      if (!inventoryId) {
        notBooked.push({
          documentId,
          lineNo: line.line_no,
          label,
          reason:
            "this line names no item on the shelf. It is NOT booked and NOT guessed at from its description — a wrong guess puts the bottles on the wrong wine. Link the line to an item and re-post the count.",
        });
        continue;
      }

      const wanted = Math.round(Number(line.qty_bottles ?? 0));
      if (!Number.isFinite(wanted) || wanted < 0) {
        notBooked.push({
          documentId,
          lineNo: line.line_no,
          label,
          reason: `the counted quantity reads ${String(line.qty_bottles)}, which is not a number of bottles`,
        });
        continue;
      }

      const delta = wanted - (already.value.get(inventoryId) ?? 0);
      if (delta === 0) {
        booked.push({
          documentId,
          lineNo: line.line_no,
          inventoryId,
          delta: 0,
          transactionId: null,
        });
        continue;
      }

      const moved = await this.move({
        restaurantId,
        inventoryId,
        delta,
        deliveryId,
        orderId: delivery.value.orderId,
        userId,
        transactionType: delta > 0 ? "purchase" : "adjustment",
        reason: `door count for delivery ${deliveryId}, document ${documentId} line ${line.line_no}`,
        idempotencyKey: `delivery-line:${deliveryId}:${documentId}:${line.line_no}`,
      });
      if (!moved.ok) return moved;

      // The running total moves with the booking, so two lines of the SAME item
      // in one count add up instead of each claiming the whole delta.
      already.value.set(inventoryId, wanted);
      bottlesMoved += delta;
      booked.push({
        documentId,
        lineNo: line.line_no,
        inventoryId,
        delta,
        transactionId: moved.value,
      });
    }

    // THE SAME RULE AT THE DOOR (founder, 2026-09-22, verbatim pick: "Yes,
    // same rule (Recommended)"): every item this count booked stock into that
    // the wine library lacks is queued for research by its id, once per item.
    // After the bookings, never undoing them; a failure is listed and logged.
    const research: NonNullable<BookingReceipt["research"]> = [];
    const bookedInto = [...new Set(booked.filter((b) => b.delta > 0).map((b) => b.inventoryId))];
    for (const inventoryId of bookedInto) {
      const queued = await queueResearchIfLibraryLacks(this.db.getClient(), {
        restaurantId,
        inventoryId,
        queuedFrom: "receiving",
        sourceOrderId: delivery.value.orderId,
        queuedBy: userId,
      });
      if (queued === null) continue;
      if (queued.ok) {
        research.push({ inventoryId, status: queued.status });
      } else {
        this.logger.error(
          `bookAtTheDoor: delivery ${deliveryId} booked item ${inventoryId}, but it was not queued for research: ${queued.error}`,
        );
        research.push({ inventoryId, error: queued.error });
      }
    }

    // A STALE NAME ASK CLOSES BY ITSELF (founder, 2026-09-22, round 6z,
    // verbatim pick 2: "Close by itself (Recommended)"): this count just
    // booked the order's stock at the door, so any open delivery_item_to_name
    // ask for it no longer needs naming. Once per order, never per item; a
    // failure is logged, not surfaced (the booking stands either way). A
    // delivery with no order has no ask keyed to it, so there is none to close.
    const bookedOrderId = delivery.value.orderId;
    if (bookedInto.length > 0 && bookedOrderId) {
      const closed = await closeDeliveryItemToNameBookedElsewhere(this.db.getClient(), {
        restaurantId,
        orderId: bookedOrderId,
        via: "receiving_door",
      });
      if (!closed.ok) {
        this.logger.error(
          `bookAtTheDoor: delivery ${deliveryId} booked order ${bookedOrderId}, but its stale name-item ask was not closed: ${closed.error}`,
        );
      }
    }

    return {
      ok: true,
      value: { deliveryId, documentId, booked, notBooked, bottlesMoved, research },
    };
  }

  // -------------------------------------------------------------------------
  // Verification
  // -------------------------------------------------------------------------

  /**
   * Settle the cost of what the door booked (A1's second half).
   *
   * The agreed price comes from the record of the agreement, in this order:
   *   1. an ACCEPTED proposal on the line — the price the two sides settled on,
   *      which is the whole reason `RECONCILING` exists;
   *   2. the invoice line's own unit price, converted to ONE BOTTLE by
   *      `perBottleLotCost` or refused by name (QA round 7c B1).
   * A line with neither leaves its lot PROVISIONAL and says so. It never
   * becomes a final cost of zero, and it never becomes a final cost of
   * whatever the purchase order once quoted — that is the ADR 0078 defect this
   * repository already paid for once.
   *
   * QUANTITY IS NEVER TOUCHED HERE. `finalise_delivery_cost` writes no
   * `inventory_transactions` row at all: money moved, bottles did not.
   */
  async finaliseAtVerified(
    restaurantId: string,
    deliveryId: string,
    userId: string | null,
  ): Promise<StockResult<CostReceipt>> {
    const delivery = await this.deliveryFor(restaurantId, deliveryId);
    if (!delivery.ok) return delivery;

    const booked = await this.bookedSoFar(deliveryId);
    if (!booked.ok) return booked;
    const items = [...booked.value.entries()].filter(([, qty]) => qty !== 0);
    if (!items.length)
      return {
        ok: true,
        value: { deliveryId, finalised: [], stillProvisional: [] },
      };

    const priced = await this.agreedPrices(restaurantId, deliveryId);
    if (!priced.ok) return priced;

    const finalised: FinalisedItem[] = [];
    const stillProvisional: { inventoryId: string; reason: string }[] = [];

    for (const [inventoryId] of items) {
      let price = priced.value.byItem.get(inventoryId) ?? null;
      // ONE item, ONE priced line: the pairing is not ambiguous, so it is not a
      // guess. Any other shape is left alone rather than matched by description.
      if (!price && items.length === 1 && priced.value.unattached.length === 1)
        price = priced.value.unattached[0];
      if (!price) {
        const refused =
          priced.value.refused.get(inventoryId) ??
          (items.length === 1 &&
          priced.value.unattached.length === 0 &&
          priced.value.unattachedRefused.length === 1
            ? priced.value.unattachedRefused[0]
            : undefined);
        stillProvisional.push({
          inventoryId,
          reason: refused
            ? `the invoice prices this item, but not per bottle: ${refused}. The lot stays provisional.`
            : "no agreed price reaches this item — the invoice line does not name it and no accepted proposal covers it. The lot stays provisional: a cost nobody agreed is not a final cost.",
        });
        continue;
      }

      const posted = await this.post(deliveryId, inventoryId, price, userId, `delivery ${deliveryId} verified (ADR 0103 A1)`);
      if (!posted.ok)
        return {
          ok: false,
          status: 503,
          error: `the delivery is VERIFIED but its cost could not be posted for item ${inventoryId}: ${posted.error}. The stock is correct and the lot stays provisional; this is safe to retry.`,
        };
      finalised.push(posted.value);
    }

    return { ok: true, value: { deliveryId, finalised, stillProvisional } };
  }

  /**
   * QA 9a (2): a RE-VERIFY revalues a final lot booked at its item's PRINTED
   * price (B1) or a proposal's raw price (10a (1)), when that is not the
   * per-bottle cost; a hand revaluation is left alone. A line that now refuses
   * keeps the cost and returns why. QA 10a (6): an invoice lot that no longer
   * matches its line is FLAGGED, never revalued (ADR 0103). Lines that name no
   * item are not repaired.
   *
   * `dryRun` posts nothing and reports in `changes` what it would correct; the
   * one-off repair job uses it (QA 10a (7)).
   */
  async repairPrintedCost(
    restaurantId: string,
    deliveryId: string,
    userId: string | null,
    opts: { dryRun?: boolean } = {},
  ): Promise<StockResult<CostRepair>> {
    const delivery = await this.deliveryFor(restaurantId, deliveryId);
    if (!delivery.ok) return delivery;
    const lots = await this.db
      .getClient()
      .from("inventory_lots")
      .select("inventory_id, unit_cost, cost_state, cost_provenance, qty")
      .eq("delivery_id", deliveryId)
      .eq("stock_state", "live");
    if (lots.error)
      return { ok: false, status: 500, error: `the lots of delivery ${deliveryId} could not be read: ${lots.error.message}` };
    const priced = await this.agreedPrices(restaurantId, deliveryId);
    if (!priced.ok) return priced;
    const { byItem, unattached, refused, printed } = priced.value;

    type Lot = { inventory_id: string; unit_cost: number | string | null; cost_state: string; cost_provenance: string | null; qty: number };
    const live = ((lots.data ?? []) as Lot[]).filter((l) => Number(l.qty) > 0);
    // The same single-item pairing `finaliseAtVerified` makes, so a lot it
    // costed from a line that names no item is not flagged as changed.
    const sole = new Set(live.map((l) => l.inventory_id)).size === 1 && unattached.length === 1 ? unattached[0] : undefined;

    const out: CostRepair = { repaired: [], flagged: [], changes: [] };
    const done = new Set<string>();
    for (const lot of live) {
      const id = lot.inventory_id;
      const booked = Number(lot.unit_cost);
      if (done.has(id) || lot.cost_state !== "final") continue;
      const price = byItem.get(id) ?? sole;
      if (price?.unitCost === booked) continue;
      const why = refused.get(id);
      if (printed.get(id)?.has(booked)) {
        done.add(id);
        if (why) {
          out.flagged.push({ inventoryId: id, kind: "refused", reason: `its lot was finalised at the printed price ${booked}, which is not known to be a cost per bottle: ${why}. It keeps that cost until someone revalues it.` });
          continue;
        }
        if (!price) continue;
        out.changes.push({ inventoryId: id, from: booked, to: price.unitCost, source: price.source });
        if (opts.dryRun) continue;
        const posted = await this.post(deliveryId, id, price, userId, `delivery ${deliveryId} re-verified: the printed ${booked} was booked as a bottle's cost (QA 7c B1)`);
        if (!posted.ok)
          return { ok: false, status: 503, error: `the cost of item ${id} could not be corrected: ${posted.error}. This is safe to retry.` };
        out.repaired.push(posted.value);
        continue;
      }
      if (lot.cost_provenance !== "invoice") continue;
      done.add(id);
      const now = price
        ? `its invoice line now makes ${price.unitCost} a bottle`
        : why
          ? `its invoice line now refuses a cost: ${why}`
          : "no invoice line prices it any more";
      out.flagged.push({ inventoryId: id, kind: "line_changed", reason: `its lot was costed at ${booked} a bottle, but ${now}. The line was changed after the lot was costed, or the lot was revalued by hand; it keeps ${booked} until someone revalues it.` });
    }
    return { ok: true, value: out };
  }

  /** One `finalise_delivery_cost` call, and its receipt. */
  private async post(
    deliveryId: string,
    inventoryId: string,
    price: AgreedPrice,
    userId: string | null,
    reason: string,
  ): Promise<StockResult<FinalisedItem>> {
    const rpc = await this.db
      .getClient()
      .rpc("finalise_delivery_cost", {
        p_delivery_id: deliveryId,
        p_inventory_id: inventoryId,
        p_unit_cost: price.unitCost,
        p_cost_provenance: price.provenance,
        p_performed_by: userId,
        p_reason: price.basis ? `${reason}; ${price.basis}` : reason,
      });
    if (rpc.error) return { ok: false, status: 503, error: rpc.error.message };
    const receipt = (rpc.data ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      value: {
        inventoryId,
        unitCost: price.unitCost,
        provenance: price.provenance,
        lotsMatched: Number(receipt.lots_matched ?? 0),
        lotsFinalised: Number(receipt.lots_finalised ?? 0),
        bottlesFinalised: Number(receipt.bottles_finalised ?? 0),
        source: price.source,
        ...(price.basis ? { basis: price.basis } : {}),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Reversal
  // -------------------------------------------------------------------------

  /**
   * Give back what the door booked (D1's exits: REJECTED, CANCELLED).
   *
   * A reversal is a MOVEMENT, not a deletion: the ledger keeps the arrival and
   * the return, because "these bottles were here for six hours" is true and a
   * deleted row says it never happened. Keyed per item so a partial retry
   * converges.
   */
  async reverse(
    restaurantId: string,
    deliveryId: string,
    userId: string | null,
    why: string,
  ): Promise<StockResult<{ deliveryId: string; bottlesReturned: number }>> {
    const delivery = await this.deliveryFor(restaurantId, deliveryId);
    if (!delivery.ok) return delivery;

    const booked = await this.bookedSoFar(deliveryId);
    if (!booked.ok) return booked;

    let bottlesReturned = 0;
    for (const [inventoryId, qty] of booked.value.entries()) {
      if (qty <= 0) continue;
      const moved = await this.move({
        restaurantId,
        inventoryId,
        delta: -qty,
        deliveryId,
        orderId: delivery.value.orderId,
        userId,
        transactionType: "adjustment",
        reason: `delivery ${deliveryId} reversed: ${why}`,
        idempotencyKey: `delivery-reversal:${deliveryId}:${inventoryId}`,
        failed: givingBackFailure,
      });
      if (!moved.ok) return moved;
      bottlesReturned += qty;
    }
    return { ok: true, value: { deliveryId, bottlesReturned } };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * THE ONLY PLACE THIS SERVICE MOVES STOCK.
   *
   * Every receiving movement goes through `apply_stock_movement` — never a
   * direct write to a lot or to `restaurant_inventory.stock_live`, which is a
   * projection (`scripts/check_no_direct_stock_writes.sh`). The reference pair
   * is what tells the function this movement belongs to a delivery, which is
   * what makes the lot provisional and stamps both rows with the delivery id.
   */
  private async move(input: {
    restaurantId: string;
    inventoryId: string;
    delta: number;
    deliveryId: string;
    orderId: string | null;
    userId: string | null;
    transactionType: string;
    reason: string;
    idempotencyKey: string;
    /** The words when the shelf refuses, for a movement that is not a booking. */
    failed?: (dbMessage: string) => string;
  }): Promise<StockResult<string | null>> {
    const rpc = await this.db.getClient().rpc("apply_stock_movement", {
      p_inventory_id: input.inventoryId,
      p_stock_state: "live",
      p_delta: input.delta,
      p_transaction_type: input.transactionType,
      // 'order' is the enum member that means "sourced from a procurement
      // order"; 'receiving' is not one and casting it raises (ADR 0078 D3).
      p_source: "order",
      p_performed_by: input.userId,
      p_reason: input.reason,
      // NO PRICE AT THE DOOR (A6). Absent, not zero.
      p_order_id: input.orderId,
      p_idempotency_key: input.idempotencyKey,
      p_reference_type: "delivery",
      p_reference_id: input.deliveryId,
      // ADR 0141 — WHICH HOUSE this delivery is being booked for.
      //
      // The lines come from `procurement_document_lines` read with
      // `.eq("restaurant_id", restaurantId)`, so the LINE belongs to this
      // restaurant. `procurement_document_lines.inventory_id` is a plain FK to
      // `restaurant_inventory` with no tenant constraint on it, so a line of
      // ours may name an item that is not — and before this argument existed,
      // booking such a line moved the other house's shelf.
      p_restaurant_id: input.restaurantId,
    });
    if (rpc.error) {
      this.logger.error(
        `delivery ${input.deliveryId} stock movement failed for item ${input.inventoryId}: ${rpc.error.message}`,
      );
      return {
        ok: false,
        status: 503,
        error: input.failed
          ? input.failed(rpc.error.message)
          : `The count is recorded but the shelf could not be moved (${rpc.error.message}). Nothing was lost and nothing was half-booked: every movement is keyed on (delivery, document, line), so retrying books exactly what is missing.`,
      };
    }
    return { ok: true, value: (rpc.data as string | null) ?? null };
  }

  /**
   * HAS THE DELIVERY MODEL ALREADY BOOKED THIS ORDER'S STOCK? (A5)
   *
   * This is the whole of the consolidation guarantee. `recordDoorReceipt` and
   * `markDelivered` still exist — the web door outbox, the orders screen and
   * the mobile app all call them, and retiring the endpoints is a client
   * change, not a service one. What they no longer are is a SECOND WRITER: both
   * ask this question first, and a `true` means the bottles are already on the
   * shelf under the delivery's own keys, so booking them again would double the
   * count. They then record their event and say, in the response, that the
   * delivery owns the stock.
   *
   * A FAILED READ IS NOT A `false` (ADR 0067). It comes back as an error, and
   * the callers refuse to book on it — "I could not tell" must never resolve to
   * "go ahead and book", which is how a delivery gets counted twice.
   */
  async deliveryAlreadyBookedForOrder(
    orderId: string,
  ): Promise<StockResult<{ booked: boolean; deliveryIds: string[] }>> {
    return deliveryHasBookedOrder(this.db.getClient(), orderId);
  }

  /** Bottles this delivery has already put on each shelf, by item. */
  private async bookedSoFar(
    deliveryId: string,
  ): Promise<StockResult<Map<string, number>>> {
    const read = await this.db
      .getClient()
      .from("inventory_transactions")
      .select("inventory_id, quantity_change")
      .eq("delivery_id", deliveryId);
    if (read.error)
      return {
        ok: false,
        status: 500,
        error: `what delivery ${deliveryId} has already booked could not be read (${read.error.message}). Nothing was written — booking on top of an unknown total is how a delivery gets counted twice.`,
      };
    const totals = new Map<string, number>();
    for (const row of (read.data ?? []) as unknown as {
      inventory_id: string | null;
      quantity_change: number | string | null;
    }[]) {
      if (!row.inventory_id) continue;
      totals.set(
        row.inventory_id,
        (totals.get(row.inventory_id) ?? 0) + Number(row.quantity_change ?? 0),
      );
    }
    return { ok: true, value: totals };
  }

  private async deliveryFor(
    restaurantId: string,
    deliveryId: string,
  ): Promise<
    StockResult<{ state: string; orderId: string | null; orderInventoryId: string | null }>
  > {
    const read = await this.db
      .getClient()
      .from("deliveries")
      .select("id, state, order_id")
      .eq("restaurant_id", restaurantId)
      .eq("id", deliveryId)
      .maybeSingle();
    if (read.error)
      return {
        ok: false,
        status: 500,
        error: `delivery ${deliveryId} could not be read: ${read.error.message}`,
      };
    if (!read.data) return { ok: false, status: 404, error: "Delivery not found" };
    const row = read.data as unknown as { state: string; order_id: string | null };

    let orderInventoryId: string | null = null;
    if (row.order_id) {
      const order = await this.db
        .getClient()
        .from("procurement_orders")
        .select("inventory_id")
        .eq("restaurant_id", restaurantId)
        .eq("id", row.order_id)
        .maybeSingle();
      if (order.error)
        return {
          ok: false,
          status: 500,
          error: `the order behind delivery ${deliveryId} could not be read: ${order.error.message}`,
        };
      orderInventoryId =
        (order.data as unknown as { inventory_id: string | null } | null)
          ?.inventory_id ?? null;
    }
    return {
      ok: true,
      value: { state: row.state, orderId: row.order_id, orderInventoryId },
    };
  }

  /**
   * The prices the two sides ended up agreeing, by item.
   *
   * An ACCEPTED proposal beats the invoice line it is about: that is what
   * agreement means. `unattached` holds priced invoice lines that name no item,
   * kept separately so the single-item case above can use one without any
   * matching-by-description creeping in.
   */
  private async agreedPrices(
    restaurantId: string,
    deliveryId: string,
  ): Promise<
    StockResult<{
      byItem: Map<string, AgreedPrice>;
      unattached: AgreedPrice[];
      refused: Map<string, string>;
      unattachedRefused: string[];
      /** Each item's printed prices, in cents (QA 9a). */
      printed: Map<string, Set<number>>;
    }>
  > {
    const join = await this.db
      .getClient()
      .from("document_deliveries")
      .select("document_id, role")
      .eq("delivery_id", deliveryId);
    if (join.error)
      return {
        ok: false,
        status: 500,
        error: `the documents on delivery ${deliveryId} could not be read: ${join.error.message}`,
      };
    const attached = (join.data ?? []) as unknown as {
      document_id: string;
      role: string;
    }[];
    // Prices come from the INVOICE — that is what an invoice is for.
    const invoiceIds = attached
      .filter((r) => r.role === "invoice")
      .map((r) => r.document_id);
    /**
     * BUT A PROPOSAL IS KEYED TO WHATEVER DOCUMENT THE DIFFERENCE LIVES ON, AND
     * THAT IS USUALLY THE DOOR COUNT (measured live 2026-09-06).
     *
     * `recordedDifferences` keys a difference by the document the comparison
     * found it on, so the accepted proposal that settles a price is keyed to the
     * door count — the one document that actually carries `inventory_id`. Looking
     * the proposal's line up only among invoice lines therefore found nothing,
     * the settled price fell through to `unattached`, and a delivery whose price
     * WAS agreed came back "no agreed price reaches this item". The agreement
     * existed; the lookup could not see it.
     */
    const allIds = [...new Set(attached.map((r) => r.document_id))];

    const byItem = new Map<string, AgreedPrice>();
    const unattached: AgreedPrice[] = [];
    const refused = new Map<string, string>();
    const unattachedRefused: string[] = [];
    const printed = new Map<string, Set<number>>();

    const lineByKey = new Map<string, LineRow>();
    const invoiceLines: LineRow[] = [];
    const invoiceSet = new Set(invoiceIds);
    if (allIds.length) {
      const read = await this.db
        .getClient()
        .from("procurement_document_lines")
        .select(
          "document_id, line_no, inventory_id, qty_bottles, unit_price, uom, pack_size, price_base_qty, price_base_uom, line_total, printed, description, vendor_sku",
        )
        .eq("restaurant_id", restaurantId)
        .in("document_id", allIds)
        .order("document_id")
        .order("line_no");
      if (read.error)
        return {
          ok: false,
          status: 500,
          error: `the lines of the documents on delivery ${deliveryId} could not be read: ${read.error.message}`,
        };
      for (const line of (read.data ?? []) as unknown as LineRow[]) {
        lineByKey.set(`${line.document_id}:${line.line_no}`, line);
        // Only an INVOICE line is a price the vendor is asking for. A door
        // count carries no money at all (ADR 0104 D11), so it is indexed for
        // the proposal lookup and never read as a price.
        if (!invoiceSet.has(line.document_id)) continue;
        invoiceLines.push(line);
        // QA 7c B1: `unit_price` is as PRINTED, per its price base.
        const cost = perBottleLotCost({
          unit_price: line.unit_price,
          uom: line.uom,
          pack_size: line.pack_size,
          price_base_qty: line.price_base_qty,
          price_base_uom: line.price_base_uom,
          qty_bottles: line.qty_bottles,
          line_total: line.line_total,
          printed: line.printed,
        });
        const id = line.inventory_id;
        if (id && "printed" in cost && cost.printed != null)
          printed.set(id, (printed.get(id) ?? new Set<number>()).add(cost.printed));
        if (!cost.ok) {
          // A refusal on any line of an item holds, whatever line comes after.
          if (cost.kind === "refused") {
            if (!id) unattachedRefused.push(cost.reason);
            else if (!refused.has(id)) refused.set(id, cost.reason);
          }
          continue;
        }
        const agreed: AgreedPrice = {
          unitCost: cost.unitCost,
          provenance: "invoice",
          source: "invoice_line",
          basis: cost.basis,
        };
        if (!id) unattached.push(agreed);
        else {
          // Two lines of one item that disagree per bottle: neither is picked.
          const prior = byItem.get(id);
          if (prior && prior.unitCost !== agreed.unitCost && !refused.has(id))
            refused.set(id, `two invoice lines price it differently (${prior.basis}; ${agreed.basis})`);
          byItem.set(id, agreed);
        }
      }
    }
    // Before the proposals: a price both sides settled still wins.
    for (const id of refused.keys()) byItem.delete(id);

    const props = await this.db
      .getClient()
      .from("delivery_proposals")
      .select("document_id, line_no, unit_price_proposed, status")
      .eq("delivery_id", deliveryId)
      .eq("status", "accepted");
    if (props.error)
      return {
        ok: false,
        status: 500,
        error: `the accepted proposals on delivery ${deliveryId} could not be read: ${props.error.message}`,
      };
    for (const p of (props.data ?? []) as unknown as {
      document_id: string | null;
      line_no: number | null;
      unit_price_proposed: number | string | null;
    }[]) {
      if (p.unit_price_proposed == null) continue;
      const keyed = lineByKey.get(`${p.document_id}:${p.line_no}`);
      const id = keyed?.inventory_id ?? null;
      const said = Number(p.unit_price_proposed);
      // QA 10a (1): a settled price is a counter to its line's printed price,
      // so it is in that line's price base. QA 12b D1: a door count prints no
      // price, so a proposal keyed to it is read in the base of the item's
      // invoice line (or the delivery's only invoice line); none, or several
      // that disagree, and it is refused. A proposal on no line has no unit.
      const line = keyed && !invoiceSet.has(keyed.document_id) ? baseLine(invoiceLines, id) : keyed;
      const cost = line
        ? proposalPerBottle(p.unit_price_proposed, line)
        : !(said > 0)
          ? ({ ok: false, kind: "no_price" } as const)
          : ({
              ok: false,
              kind: "refused",
              reason: keyed
                ? `an accepted proposal settles a price of ${said} on the door count, which prints no price, and no single invoice line of this item says what unit that price is for`
                : `an accepted proposal settles a price of ${said} but names no invoice line, so what unit that price is for is not known`,
            } as const);
      if (id && "printed" in cost && cost.printed != null)
        printed.set(id, (printed.get(id) ?? new Set<number>()).add(cost.printed));
      if (!cost.ok) {
        if (cost.kind !== "refused") continue;
        const reason = line
          ? `the accepted proposal's price ${Number(p.unit_price_proposed)} is read in its invoice line's unit, and ${cost.reason}`
          : cost.reason;
        if (!id) unattachedRefused.push(reason);
        else {
          byItem.delete(id);
          refused.set(id, reason);
        }
        continue;
      }
      // A settled price is one a person put their name to, so its provenance is
      // `manual` — calling it `invoice` would claim a document said it.
      const agreed: AgreedPrice = {
        unitCost: cost.unitCost,
        provenance: "manual",
        source: "accepted_proposal",
        basis: `accepted proposal: ${cost.basis.replace(/^invoice price/, "price")}`,
      };
      if (id) {
        byItem.set(id, agreed);
        refused.delete(id);
      } else unattached.push(agreed);
    }

    return {
      ok: true,
      value: { byItem, unattached, refused, unattachedRefused, printed },
    };
  }
}
