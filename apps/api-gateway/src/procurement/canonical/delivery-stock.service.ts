import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { queueResearchIfLibraryLacks } from "../../inventory/house-item-research";
import { closeDeliveryItemToNameBookedElsewhere } from "../delivery-item-to-name";
import { isMass, isVolumeItemUnit, massFactor, volumeFactor } from "../documents/document-types";
import { LotUnitCost, perBottleLotCost, proposalPerBottle, toCentsAsBooked } from "./lot-unit-cost";
import { doorCountsOfPapers, withTheDoorsPack } from "./door-received";
import {
  LandedBlock,
  landDelivery,
  paidBottles,
  PaperHeaderRow,
  PaperLine,
  PaperNote,
  notHouseMoney,
} from "./paper-landed-cost";

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
  /**
   * Containers moved by this call. 0 with a non-empty `booked` = a retry. A
   * line into an item kept by weight (`kg`, `g`, `mg`) is not added in: its
   * delta is grams or kilos, never bottles (browser walk 2026-11-12 read
   * 3 kg of cheese and 6 bottles as "2506"). Each line's own `delta` says it.
   */
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
  /** How an invoice price became this cost (lane 1.4); absent for a proposal. */
  landed?: LandedBlock;
}

/** A lot a re-verify left at its cost, and why (QA 9a / 10a). */
export interface CostFlag {
  inventoryId: string;
  /** `refused`: its line now refuses a cost. `line_changed`: its cost no longer matches its line. */
  kind: "refused" | "line_changed";
  reason: string;
}

/** What `repairPrintedCost` did. */
export interface CostRepair {
  repaired: FinalisedItem[];
  flagged: CostFlag[];
}

export interface CostReceipt {
  deliveryId: string;
  finalised: FinalisedItem[];
  /** Items whose cost could not be settled, each with the reason. */
  stillProvisional: { inventoryId: string; reason: string }[];
  /** Per invoice: what it carries that is not cost, and what its tax did. */
  papers?: PaperNote[];
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
  qty?: number | string | null;
  price_base_qty?: number | string | null;
  price_base_uom?: string | null;
  line_total?: number | string | null;
  allowance?: number | string | null;
  deposit?: number | string | null;
  printed?: unknown;
  format_ml?: number | string | null;
  /** The house item's own unit (`restaurant_inventory.uom`), attached after the read (R8). */
  item_uom?: string | null;
  in_item_unit?: boolean;
}

/** The weights a house item may be kept in (`restaurant_inventory_uom_check`, ADR 0070). */
const ITEM_MASS: ReadonlySet<string> = new Set(["kg", "g", "mg"]);

/**
 * A line unit that is only a count, never a container of known size: unstated,
 * `bottle` (`procurement_document_lines.uom` defaults to it, so a line that
 * never said its unit reads `bottle`) and `each`. Into an item kept by weight it
 * is read as that many of the item's unit.
 */
const PLAIN_COUNT: ReadonlySet<string> = new Set(["", "bottle", "each"]);

/**
 * What a door-count line puts on the shelf, in the unit the ITEM is kept in
 * (R8). A container line into a container item is its `qty_bottles`, as
 * before. A weighed line converts into the item's weight (`3 kg` into a cheese
 * kept in `g` is 3000); it is refused by name when the item is not kept by
 * weight, when an item kept by weight is counted in containers, and when the
 * weight is not a whole number of the item's unit (ADR 0070: integer
 * quantities; `2.5 kg` into an item kept in `kg` is not booked as 2 or 3).
 *
 * A plain count into an item kept by weight (a line whose unit is unstated,
 * `bottle` — the column's default — or `each`) is the count in the item's own
 * unit, as it was before R8: the door has no kg or g picker, so a line typed
 * there never states a weight, and refusing it left weight-kept items with no
 * way to be booked (mail-receipts fix round, 2026-11-12, finding on #1109).
 * Only a container that is not a count (case, pack, split case, keg, liter)
 * is refused into such an item: its weight is not known.
 */
export function shelfQuantity(
  line: { qty_bottles: unknown; uom?: string | null; format_ml?: unknown },
  itemUom: string | null | undefined,
): { ok: true; qty: number } | { ok: false; reason: string } {
  const n = Number(line.qty_bottles ?? 0);
  if (!Number.isFinite(n) || n < 0)
    return { ok: false, reason: `the counted quantity reads ${String(line.qty_bottles)}, which is not a number` };
  const byVolume = volumeShelf(n, line, itemUom);
  if (byVolume) return byVolume;
  const weighed = isMass(line.uom);
  const keptByWeight = itemUom != null && ITEM_MASS.has(itemUom);
  if (!weighed && !keptByWeight) return { ok: true, qty: Math.round(n) };
  if (weighed && !itemUom)
    return { ok: false, reason: `this line is weighed in ${line.uom}, and the item it names states no unit, so how much of it this is cannot be put on the shelf` };
  if (weighed && !keptByWeight)
    return { ok: false, reason: `this line is weighed in ${line.uom}, but the item it names is kept in ${itemUom}s, and a weight is not a number of ${itemUom}s. It is NOT booked; keep the item by weight, or link the line to one that is.` };
  if (!weighed && PLAIN_COUNT.has(line.uom ?? "")) return { ok: true, qty: Math.round(n) };
  if (!weighed)
    return { ok: false, reason: `the item this line names is kept in ${itemUom}, but the line counts ${String(line.uom).replace("_", " ")}s, and what one weighs is not known. It is NOT booked; state the line's weight, or count it in ${itemUom}.` };
  const f = massFactor(String(line.uom), String(itemUom));
  if (f == null)
    return { ok: false, reason: `${line.uom} does not convert into ${itemUom}` };
  const exact = n * f;
  const whole = Math.round(exact);
  if (Math.abs(exact - whole) > 1e-9)
    return { ok: false, reason: `${n} ${line.uom} is ${exact} ${itemUom}, not a whole number of ${itemUom}, the unit the item is kept in. It is NOT rounded; keep the item in a finer unit (g), or count the line in one.` };
  return { ok: true, qty: whole };
}

/** What one bottle or keg of a line holds in ml, or null when not stated (r21). */
function sizeMl(v: unknown): number | null {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * r21: a line into an item kept by volume, or a litre line anywhere; null when
 * neither. `5 liter` into ml is 5000; `12 bottle` of 200 ml is 2400 (by
 * `format_ml`); a plain count with no size is the item's unit (the door's
 * rule); a case or keg with no size, or litres into a non-volume item (30
 * liters booked as 30 kegs), is refused by name.
 */
function volumeShelf(
  n: number,
  line: { uom?: string | null; format_ml?: unknown },
  itemUom: string | null | undefined,
): { ok: true; qty: number } | { ok: false; reason: string } | null {
  const measured = line.uom === "liter";
  if (!isVolumeItemUnit(itemUom)) {
    if (!measured) return null;
    return {
      ok: false,
      reason: itemUom
        ? `this line is measured in liters, but the item it names is kept in ${itemUom}s, and a liter is not a number of ${itemUom}s. It is NOT booked; keep the item in ml, or link the line to one that is.`
        : `this line is measured in liters, and the item it names states no unit, so how much of it this is cannot be put on the shelf`,
    };
  }
  if (isMass(line.uom))
    return { ok: false, reason: `this line is weighed in ${line.uom}, but the item it names is kept in ${itemUom}, and a weight is not a volume. It is NOT booked.` };
  const fmt = sizeMl(line.format_ml);
  let exact: number;
  let said: string;
  if (measured) {
    exact = n * (volumeFactor("liter", itemUom) as number);
    said = `${n} liter`;
  } else if (fmt != null) {
    exact = n * fmt * (volumeFactor("ml", itemUom) as number);
    said = `${n} of ${fmt} ml`;
  } else if (PLAIN_COUNT.has(line.uom ?? "")) {
    return { ok: true, qty: Math.round(n) };
  } else {
    return {
      ok: false,
      reason: `the item this line names is kept in ${itemUom}, but the line counts ${String(line.uom).replace("_", " ")}s and does not say how much one holds. It is NOT booked; state the line's size in ml, or count it in ${itemUom}.`,
    };
  }
  const whole = Math.round(exact);
  if (Math.abs(exact - whole) > 1e-9)
    return { ok: false, reason: `${said} is ${exact} ${itemUom}, not a whole number of ${itemUom}, the unit the item is kept in. It is NOT rounded; keep the item in ml.` };
  return { ok: true, qty: whole };
}

/** The item units in one counted unit of the line (R8 weight, r21 volume); null: read as is. */
function itemScale(line: LineRow): { factor: number; volume: boolean } | null {
  if (!line.item_uom) return null;
  if (isVolumeItemUnit(line.item_uom)) {
    if (line.uom === "liter") return { factor: volumeFactor("liter", line.item_uom) as number, volume: true };
    if (isMass(line.uom)) return null;
    const fmt = sizeMl(line.format_ml);
    return fmt == null ? null : { factor: fmt * (volumeFactor("ml", line.item_uom) as number), volume: true };
  }
  if (!isMass(line.uom)) return null;
  const f = massFactor(String(line.uom), line.item_uom);
  return f == null ? null : { factor: f, volume: false };
}

/**
 * A weighed line as the landed rule reads it (R8): its listed and free counts
 * in the ITEM's unit, so they meet the door's booking (also in that unit) and
 * the gatekeeper's price per one of it. `3 kg` into a cheese kept in `g` lists
 * 3000. Any other line is returned as it is.
 */
function inItemUnits(line: LineRow): LineRow {
  const scaled = itemScale(line);
  if (!scaled) return line;
  const f = scaled.factor;
  const scale = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? v : Number(v) * f);
  return {
    ...line,
    ...(scaled.volume ? { in_item_unit: true } : {}),
    qty_bottles: scale(line.qty_bottles) as LineRow["qty_bottles"],
    ...("free_goods_qty" in line ? { free_goods_qty: scale((line as { free_goods_qty?: unknown }).free_goods_qty) } : {}),
  } as LineRow;
}

const positiveOrZero = (v: unknown): number => {
  const n = v == null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * One invoice line's per-bottle price, cross-checked against its printed total
 * as landedCost will read that total (lane 1.4 audit follow-up).
 *
 * The gatekeeper reads `line_total` as the line before anything comes off. A
 * total printed AFTER the line's own allowance (iskonto), or with the line's
 * deposit inside it, is the same price — `reconcileLineValue` takes each out
 * exactly once — yet it missed the gatekeeper's 1% tolerance and was held as
 * "the price's unit is not what the line says", holding every other item on a
 * paper with charges too. So the gatekeeper is asked about every reading the
 * reconcile accepts: as printed, with the allowance put back, with the deposit
 * taken out, or both. A total that matches none of them is still refused
 * (24 bottles @ 264 printed as 528), and landedCost re-checks the reading it
 * uses at its own, tighter tolerance.
 */
function perBottleOfLine(line: LineRow): LotUnitCost {
  return perBottleLotCost(readableLine(line), { uom: line.item_uom });
}

/** The line with the reading of its printed total the gatekeeper accepts (as
 * printed, allowance put back, deposit taken out, or both), PAID bottles; the
 * line as printed when none does. A proposal is read in this line's base. */
function readableLine(line: LineRow): LineRow {
  const paid = paidLine(line);
  const total = Number(line.line_total);
  const item = { uom: line.item_uom };
  if (perBottleLotCost(paid, item).ok || line.line_total == null || !Number.isFinite(total))
    return paid;
  const allowance = positiveOrZero(line.allowance);
  const deposit = positiveOrZero(line.deposit);
  const readings: number[] = [];
  if (allowance > 0) readings.push(total + allowance);
  if (deposit > 0) readings.push(total - deposit);
  if (allowance > 0 && deposit > 0) readings.push(total + allowance - deposit);
  for (const reading of readings) {
    if (!(reading > 0)) continue;
    const read = { ...paid, line_total: reading };
    if (perBottleLotCost(read, item).ok) return read;
  }
  return paid;
}

/** QA 12b D1: the invoice line whose price base a door-count proposal is read
 * in — the item's own, else the delivery's only, unattached, invoice line.
 * Several lines count only when their printed prices settle one base. */
function baseLine(invoice: LineRow[], id: string | null): LineRow | undefined {
  const own = id ? invoice.filter((l) => l.inventory_id === id) : [];
  const lines = own.length ? own : invoice.length === 1 && !invoice[0].inventory_id ? invoice : [];
  if (lines.length === 1) return lines[0];
  const bases = new Set(lines.map((l) => {
    const c = perBottleOfLine(l);
    return c.ok ? c.bottles : NaN;
  }));
  return lines.length && bases.size === 1 && !bases.has(NaN) ? lines[0] : undefined;
}

/** A line as the unit gatekeeper reads it: a free bottle inside it has no
 * price, so its printed total is checked against the PAID bottles. */
function paidLine(l: LineRow): LineRow {
  return { ...l, qty_bottles: paidBottles(l) };
}

interface AgreedPrice {
  unitCost: number;
  provenance: "invoice" | "manual";
  source: "accepted_proposal" | "invoice_line";
  basis?: string;
  landed?: LandedBlock;
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
        "document_id, line_no, inventory_id, qty_bottles, unit_price, description, vendor_sku, uom, format_ml",
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

    // R8: what each line puts on the shelf is in its ITEM's unit.
    const units = await this.itemUnits(
      restaurantId,
      lines.map((l) => l.inventory_id ?? (lines.length === 1 ? delivery.value.orderInventoryId : null)),
    );
    if (!units.ok) return units;

    // A5 THE OTHER WAY ROUND (r24): what the order's own door already put on
    // the shelf, outside any delivery. The legacy door asks the delivery model
    // before it books; this is the delivery asking the legacy door.
    const elsewhere = delivery.value.orderId
      ? await this.bookedAtTheOrdersDoor(restaurantId, delivery.value.orderId)
      : ({ ok: true, value: new Map<string, number>() } as const);
    if (!elsewhere.ok) return elsewhere;

    // Pass 1: what each line puts on the shelf, in its item's unit, and what
    // THIS count says of each item in all. Two lines of one item in one count
    // (two wheels of a cheese, two cases of a wine) are one count of that item
    // and add up (browser walk 2026-11-12: 3 kg then 2.5 kg booked +3000 then
    // -500, leaving 2500 g on the shelf for 5500 g delivered).
    type Bookable = { line: LineRow; inventoryId: string; qty: number; weighed: boolean };
    const bookable: Bookable[] = [];
    const counted = new Map<string, number>();
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

      const atOrderDoor = elsewhere.value.get(inventoryId) ?? 0;
      if (atOrderDoor > 0) {
        notBooked.push({
          documentId,
          lineNo: line.line_no,
          label,
          reason: `this order's goods for this item were already put on the shelf at the order's own door (${atOrderDoor} there). Booking this count too would count them twice. It is NOT booked; correct the count at the order's door.`,
        });
        continue;
      }

      const itemUnit = units.value.get(inventoryId);
      const onShelf = shelfQuantity(line, itemUnit);
      if (!onShelf.ok) {
        notBooked.push({ documentId, lineNo: line.line_no, label, reason: onShelf.reason });
        continue;
      }
      const weighed = itemUnit === "kg" || itemUnit === "g" || itemUnit === "mg" || isVolumeItemUnit(itemUnit);
      bookable.push({ line, inventoryId, qty: onShelf.qty, weighed });
      counted.set(inventoryId, (counted.get(inventoryId) ?? 0) + onShelf.qty);
    }

    // Pass 2: move the difference between this count and what the delivery
    // already put on each shelf. Each line owns its slice of the item's count
    // (the running total before it, up to the running total after it) and
    // books only the part of its slice above what is already booked. So a
    // first count books every line in full, a retry books nothing, a retry
    // after a failure part-way books only the lines that were not booked, and
    // a corrected count higher than before books only the rise. A corrected
    // count LOWER than before gives the difference back once, on the item's
    // first line. The deltas of an item always add up to (this count − already
    // booked), and each line keeps its own idempotency key.
    const runningBefore = new Map<string, number>();
    for (const { line, inventoryId, qty, weighed } of bookable) {
      const lineNo = line.line_no as number;
      const before = runningBefore.get(inventoryId) ?? 0;
      const after = before + qty;
      runningBefore.set(inventoryId, after);
      const total = counted.get(inventoryId) ?? 0;
      const booked0 = already.value.get(inventoryId) ?? 0;
      const delta =
        total >= booked0
          ? Math.max(0, after - Math.max(booked0, before))
          : before === 0
            ? total - booked0
            : 0;
      if (delta === 0) {
        booked.push({
          documentId,
          lineNo,
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
        reason: `door count for delivery ${deliveryId}, document ${documentId} line ${lineNo}`,
        idempotencyKey: `delivery-line:${deliveryId}:${documentId}:${lineNo}`,
      });
      if (!moved.ok) return moved;

      if (!weighed) bottlesMoved += delta;
      booked.push({
        documentId,
        lineNo,
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
   *   2. the invoice's LANDED cost per accepted bottle (`landDelivery`,
   *      lane 1.4), each line first converted to ONE BOTTLE by
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
    only?: ReadonlySet<string>,
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

    const priced = await this.agreedPrices(
      restaurantId,
      deliveryId,
      booked.value,
    );
    if (!priced.ok) return priced;

    const finalised: FinalisedItem[] = [];
    const stillProvisional: { inventoryId: string; reason: string }[] = [];

    for (const [inventoryId] of items) {
      // `only`: a re-verify finishing a post that failed partway (QA round 15
      // (4)) posts the items whose lots are still provisional and no other.
      // The pairing rules below still see every booked item.
      if (only && !only.has(inventoryId)) continue;
      let price = priced.value.byItem.get(inventoryId) ?? null;
      // ONE item, ONE priced line: the pairing is not ambiguous, so it is not a
      // guess. Any other shape is left alone rather than matched by description.
      if (!price && items.length === 1 && priced.value.unattached.length === 1)
        price = priced.value.unattached[0];
      if (!price) {
        // QA 12b D1, kept through lane 1.4: one item, and the one accepted
        // proposal on the delivery names no line, so its refusal is this item's.
        const lone =
          items.length === 1 && priced.value.unattached.length === 0 && priced.value.unattachedRefused.length === 1
            ? `the invoice prices this item, but not per bottle: ${priced.value.unattachedRefused[0]}. The lot stays provisional.`
            : undefined;
        stillProvisional.push({
          inventoryId,
          reason:
            lone ??
            priced.value.held.get(inventoryId) ??
            "no agreed price reaches this item — the invoice line does not name it and no accepted proposal covers it. The lot stays provisional: a cost nobody agreed is not a final cost.",
        });
        continue;
      }

      const posted = await this.post(deliveryId, inventoryId, price, userId, `delivery ${deliveryId} verified (ADR 0103 A1)`);
      if (!posted.ok)
        return {
          ok: false,
          status: 503,
          error: `the delivery is VERIFIED but its cost could not be posted for item ${inventoryId}: ${posted.error}. The stock is correct and the lot stays provisional; verifying the delivery again posts the cost of every item still provisional, once.`,
        };
      finalised.push(posted.value);
    }

    return {
      ok: true,
      value: {
        deliveryId,
        finalised,
        stillProvisional,
        papers: priced.value.papers,
      },
    };
  }

  /**
   * QA round 15 (4): a RE-VERIFY finishes a VERIFIED post that failed partway.
   * Only items with a live lot of this delivery still `provisional` are posted,
   * through the same finalise_delivery_cost, which skips a lot already final at
   * that cost (so two retries post once). A FINAL lot is never touched here: a
   * hand revaluation, or a line edited after the cost posted (ADR 0103, QA 10a
   * (6)), is repairPrintedCost's to judge, not this method's.
   */
  async finishProvisional(
    restaurantId: string,
    deliveryId: string,
    userId: string | null,
  ): Promise<StockResult<CostReceipt>> {
    const delivery = await this.deliveryFor(restaurantId, deliveryId);
    if (!delivery.ok) return delivery;
    const lots = await this.db
      .getClient()
      .from("inventory_lots")
      .select("inventory_id, cost_state, qty")
      .eq("restaurant_id", restaurantId)
      .eq("delivery_id", deliveryId)
      .eq("stock_state", "live")
      .eq("cost_state", "provisional");
    if (lots.error)
      return { ok: false, status: 500, error: `the lots of delivery ${deliveryId} could not be read: ${lots.error.message}` };
    type Lot = { inventory_id: string | null; cost_state: string; qty: number };
    const open = new Set(
      ((lots.data ?? []) as Lot[])
        .filter((l) => l.cost_state === "provisional" && Number(l.qty) > 0 && l.inventory_id)
        .map((l) => l.inventory_id as string),
    );
    if (!open.size)
      return { ok: true, value: { deliveryId, finalised: [], stillProvisional: [] } };
    return this.finaliseAtVerified(restaurantId, deliveryId, userId, open);
  }

  /**
   * QA 9a (2): a RE-VERIFY revalues a final lot booked at its item's PRINTED
   * price (B1) or a proposal's raw price (10a (1)), when that is not the
   * per-bottle cost; a hand revaluation is left alone. A line that now refuses
   * keeps the cost and returns why. QA 10a (6): an invoice lot that no longer
   * matches its line is FLAGGED, never revalued (ADR 0103). Lines that name no
   * item are not repaired.
   */
  async repairPrintedCost(
    restaurantId: string,
    deliveryId: string,
    userId: string | null,
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
    const bookedNow = await this.bookedSoFar(deliveryId);
    if (!bookedNow.ok) return bookedNow;
    const priced = await this.agreedPrices(
      restaurantId,
      deliveryId,
      bookedNow.value,
    );
    if (!priced.ok) return priced;
    const { byItem, unattached, refused, printed, held, lineOnly } = priced.value;

    type Lot = { inventory_id: string; unit_cost: number | string | null; cost_state: string; cost_provenance: string | null; qty: number };
    const live = ((lots.data ?? []) as Lot[]).filter((l) => Number(l.qty) > 0);
    // The same single-item pairing `finaliseAtVerified` makes, so a lot it
    // costed from a line that names no item is not flagged as changed.
    const sole = new Set(live.map((l) => l.inventory_id)).size === 1 && unattached.length === 1 ? unattached[0] : undefined;

    const out: CostRepair = { repaired: [], flagged: [] };
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
        // QA 15 (2): when the paper's landed cost cannot be said, the line's own
        // per-bottle price still beats a final cost that is a case's price.
        const fix = price ?? lineOnly.get(id);
        if (!fix) {
          const waits = held.get(id);
          if (waits)
            out.flagged.push({ inventoryId: id, kind: "refused", reason: `its lot was finalised at the printed price ${booked}, and its cost per bottle cannot be said yet: ${waits.replace(/ The lot stays provisional.*$/, "")} It keeps that cost until someone revalues it.` });
          continue;
        }
        if (fix.unitCost === booked) continue;
        const posted = await this.post(deliveryId, id, fix, userId, `delivery ${deliveryId} re-verified: the printed ${booked} was booked as a bottle's cost (QA 7c B1)`);
        if (!posted.ok)
          return { ok: false, status: 503, error: `the cost of item ${id} could not be corrected: ${posted.error}. This is safe to retry.` };
        out.repaired.push(posted.value);
        continue;
      }
      if (lot.cost_provenance !== "invoice") continue;
      done.add(id);
      const now = price
        ? `its invoice now makes ${price.unitCost} a bottle`
        : why
          ? `its invoice line now refuses a cost: ${why}`
          : held.get(id)
            ? `its landed cost cannot be said now: ${held.get(id)!.replace(/ The lot stays provisional.*$/, "")}`
            : "no invoice line prices it any more";
      out.flagged.push({ inventoryId: id, kind: "line_changed", reason: `its lot was costed at ${booked} a bottle, but ${now}. The line was changed after the lot was costed, the lot was costed before the invoice's charges were shared over its bottles, or the lot was revalued by hand; it keeps ${booked} until someone revalues it.` });
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
        ...(price.landed ? { landed: price.landed } : {}),
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
        error: `The count is recorded but the shelf could not be moved (${rpc.error.message}). Nothing was lost and nothing was half-booked: every movement is keyed on (delivery, document, line), so retrying books exactly what is missing.`,
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
  /**
   * Each named item's own unit (`restaurant_inventory.uom`, ADR 0070), this
   * house only. A failed read is never "no unit": it stops the caller (ADR 0067).
   */
  private async itemUnits(
    restaurantId: string,
    ids: Array<string | null | undefined>,
  ): Promise<StockResult<Map<string, string | null>>> {
    const wanted = [...new Set(ids.filter((x): x is string => !!x))];
    const out = new Map<string, string | null>();
    for (let i = 0; i < wanted.length; i += 100) {
      const read = await this.db
        .getClient()
        .from("restaurant_inventory")
        .select("id, uom")
        .eq("restaurant_id", restaurantId)
        .in("id", wanted.slice(i, i + 100));
      if (read.error)
        return {
          ok: false,
          status: 500,
          error: `the units the items on this paper are kept in could not be read (${read.error.message}), so nothing was booked or costed. Retry is safe.`,
        };
      for (const r of (read.data ?? []) as Array<{ id: string; uom: string | null }>) out.set(r.id, r.uom);
    }
    return { ok: true, value: out };
  }

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

  /**
   * Per item, what an order's LEGACY door booked: its live movements that carry
   * the order and no delivery (`door-receipt:` events, `order-delivered:`). Read
   * a page at a time, so an order past the 1,000-row cap is read whole. A failed
   * read is not "nothing" (ADR 0067): the caller books nothing on it.
   */
  private async bookedAtTheOrdersDoor(
    restaurantId: string,
    orderId: string,
  ): Promise<StockResult<Map<string, number>>> {
    const totals = new Map<string, number>();
    const page = 1000;
    for (let from = 0; ; from += page) {
      const read = await this.db
        .getClient()
        .from("inventory_transactions")
        .select("id, inventory_id, quantity_change, delivery_id")
        .eq("restaurant_id", restaurantId)
        .eq("order_id", orderId)
        .eq("stock_type", "live")
        .is("delivery_id", null)
        .order("id", { ascending: true })
        .range(from, from + page - 1);
      if (read.error)
        return {
          ok: false,
          status: 503,
          error: `what order ${orderId}'s own door already booked could not be read (${read.error.message}), so nothing was booked. Booking without this answer is how one truck lands on the shelf twice.`,
        };
      const rows = (read.data ?? []) as { inventory_id: string | null; quantity_change: number | string | null; delivery_id?: string | null }[];
      for (const r of rows) {
        if (!r.inventory_id || r.delivery_id) continue;
        totals.set(r.inventory_id, (totals.get(r.inventory_id) ?? 0) + Number(r.quantity_change ?? 0));
      }
      if (rows.length < page) break;
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
   * agreement means. `unattached` holds settled prices that name no item, kept
   * separately so the single-item case above can use one without any
   * matching-by-description creeping in (`landDelivery` pairs invoice lines).
   */
  private async agreedPrices(
    restaurantId: string,
    deliveryId: string,
    booked: Map<string, number>,
  ): Promise<
    StockResult<{
      byItem: Map<string, AgreedPrice>;
      unattached: AgreedPrice[];
      refused: Map<string, string>;
      /** Items whose landed cost cannot be said, each with the sentence. */
      held: Map<string, string>;
      /** Refusals of accepted proposals that name no item (QA 12b D1). */
      unattachedRefused: string[];
      /** Each held item's own per-bottle line price: a re-verify's repair only. */
      lineOnly: Map<string, AgreedPrice>;
      papers: PaperNote[];
      /** Each item's printed prices that are NOT its per-bottle cost (QA 9a). */
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
    const printed = new Map<string, Set<number>>();
    const fed: PaperLine[] = [];
    const unattachedRefused: string[] = [];
    // Each item's own per-bottle line price, used only to repair a printed
    // price on a lot already final when its landed cost is held (QA 15 (2)).
    const lineOnly = new Map<string, AgreedPrice>();
    const lineClash = new Set<string>();

    // Each invoice's money columns: its charges and discount are shared over
    // its lines (F3), so a paper that cannot be read is not read as "none".
    let papers: PaperHeaderRow[] = [];
    if (invoiceIds.length) {
      const heads = await this.db
        .getClient()
        .from("procurement_documents")
        .select(
          "id, doc_number, currency, subtotal, discount_total, freight, fuel_surcharge, split_case_fee, delivery_fee, other_charges, deposit_total, tax, extracted_lines:extracted->lines",
        )
        .eq("restaurant_id", restaurantId)
        .in("id", invoiceIds);
      if (heads.error)
        return {
          ok: false,
          status: 500,
          error: `the invoices on delivery ${deliveryId} could not be read for their charges and discount: ${heads.error.message}`,
        };
      papers = (heads.data ?? []) as unknown as PaperHeaderRow[];
    }
    // QA 15 (5): an unreadable house is not "no currency named".
    let houseCurrency: string | null = null;
    if (papers.length) {
      const house = await this.db
        .getClient()
        .from("restaurants")
        .select("currency")
        .eq("id", restaurantId)
        .maybeSingle();
      if (house.error)
        return {
          ok: false,
          status: 500,
          error: `the currency this house keeps its costs in could not be read: ${house.error.message}`,
        };
      houseCurrency = ((house.data ?? null) as { currency?: string | null } | null)?.currency ?? null;
    }
    const moneyOfPaper = new Map(papers.map((r) => [r.id, notHouseMoney(r.currency, houseCurrency)]));

    const lineByKey = new Map<string, LineRow>();
    const invoiceLines: LineRow[] = [];
    const invoiceSet = new Set(invoiceIds);
    // r31 w2 F1: the pack the door gave a case the invoice sizes nowhere, per
    // `invoice:line`, and the items whose cost is read through it.
    const doorPacks = new Map<string, number>();
    const doorPacked = new Map<string, string>();
    if (invoiceIds.length && attached.some((r) => r.role === "door_count")) {
      const door = await doorCountsOfPapers(this.db.getClient(), restaurantId, invoiceIds);
      if (!door.ok)
        return {
          ok: false,
          status: 500,
          error: `what the door counted of the invoices on delivery ${deliveryId} ${door.error}, so no cost was settled`,
        };
      for (const [paper, count] of door.value)
        for (const [lineNo, pack] of count.packs) doorPacks.set(`${paper}:${lineNo}`, pack);
    }
    if (allIds.length) {
      const read = await this.db
        .getClient()
        .from("procurement_document_lines")
        .select(
          "document_id, line_no, inventory_id, qty, qty_bottles, free_goods_qty, unit_price, uom, pack_size, price_base_qty, price_base_uom, line_total, allowance, deposit, printed, description, vendor_sku, format_ml",
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
      const rows = ((read.data ?? []) as unknown as LineRow[]).map((line) => {
        if (!invoiceSet.has(line.document_id) || line.line_no == null) return line;
        const withPack = withTheDoorsPack(line, doorPacks.get(`${line.document_id}:${line.line_no}`));
        if (withPack.pack_from_door != null && line.inventory_id)
          doorPacked.set(
            line.inventory_id,
            `the invoice does not say how many bottles a ${String(line.uom).replace("_", " ")} holds; ${withPack.pack_from_door} is what the door counted`,
          );
        return withPack;
      });
      // R8: a weighed line is costed per one of its ITEM's unit.
      const units = await this.itemUnits(restaurantId, rows.map((l) => l.inventory_id));
      if (!units.ok) return units;
      for (const line of rows) {
        line.item_uom = line.inventory_id ? (units.value.get(line.inventory_id) ?? null) : null;
        lineByKey.set(`${line.document_id}:${line.line_no}`, line);
        // Only an INVOICE line is a price the vendor is asking for. A door
        // count carries no money at all (ADR 0104 D11), so it is indexed for
        // the proposal lookup and never read as a price.
        if (!invoiceSet.has(line.document_id)) continue;
        invoiceLines.push(line);
        // QA 7c B1: `unit_price` is as PRINTED, per its price base.
        const cost = perBottleOfLine(line);
        const id = line.inventory_id;
        // A printed price that IS the per-bottle cost was never a wrong unit.
        if (
          id &&
          "printed" in cost &&
          cost.printed != null &&
          !(cost.ok && cost.unitCost === cost.printed)
        )
          printed.set(id, (printed.get(id) ?? new Set<number>()).add(cost.printed).add(toCentsAsBooked(cost.printed)));
        if (id && cost.ok) {
          const prior = lineOnly.get(id);
          if (prior && prior.unitCost !== cost.unitCost) lineClash.add(id);
          else lineOnly.set(id, { unitCost: cost.unitCost, provenance: "invoice", source: "invoice_line", basis: cost.basis });
        } else if (id && !cost.ok && cost.kind === "refused") lineClash.add(id);
        // Every line goes to its paper, priced or not (a refusal holds).
        fed.push({ row: inItemUnits(line), cost });
      }
    }

    const landed = landDelivery({ papers, lines: fed, booked, houseCurrency });
    const refused = landed.refused;
    const held = landed.held;
    for (const [id, p] of [...lineOnly]) {
      const why = held.get(id);
      // A line price in another currency is no stand-in either (QA 15 (5)).
      if (!why || lineClash.has(id) || refused.has(id) || landed.foreign.has(id)) lineOnly.delete(id);
      else
        p.basis = `${p.basis}. The invoice's charges and discount are not in this cost, because its landed cost cannot be said: ${why.replace(/ The lot stays provisional.*$/, "")}`;
    }
    for (const [id, p] of landed.byItem) {
      const door = doorPacked.get(id);
      byItem.set(id, {
        ...p,
        provenance: "invoice",
        source: "invoice_line",
        ...(door ? { basis: p.basis ? `${p.basis} (${door})` : door } : {}),
      });
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
      const key = `${p.document_id}:${p.line_no}`;
      const keyed = lineByKey.get(key);
      const id = keyed?.inventory_id ?? landed.paired.get(key) ?? null;
      const said = Number(p.unit_price_proposed);
      // QA 10a (1): a settled price is a counter to its line's printed price,
      // so it is in that line's price base. QA 12b D1: a door count prints no
      // price, so a proposal keyed to it is read in the base of the item's
      // invoice line (or the delivery's only invoice line); none, or several
      // that disagree, and it is refused. A proposal on no line has no unit.
      const line = keyed && !invoiceSet.has(keyed.document_id) ? baseLine(invoiceLines, id) : keyed;
      const cost = line
        ? proposalPerBottle(p.unit_price_proposed, readableLine(line), { uom: line.item_uom })
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
        printed.set(id, (printed.get(id) ?? new Set<number>()).add(cost.printed).add(toCentsAsBooked(cost.printed)));
      // QA 15 (5): a settled price is in its line's money.
      const foreignWhy = line ? moneyOfPaper.get(line.document_id) : undefined;
      if (foreignWhy && said > 0) {
        const reason = `the accepted proposal's price ${said} is on an invoice not in this house's money: ${foreignWhy}`;
        if (!id) unattachedRefused.push(reason);
        else {
          byItem.delete(id);
          lineOnly.delete(id);
          held.set(id, `${reason}. The lot stays provisional.`);
        }
        continue;
      }
      if (!cost.ok) {
        if (cost.kind !== "refused") continue;
        const reason = line
          ? `the accepted proposal's price ${said} is read in its invoice line's unit, and ${cost.reason}`
          : cost.reason;
        if (!id) unattachedRefused.push(reason);
        else {
          byItem.delete(id);
          lineOnly.delete(id);
          refused.set(id, reason);
          held.set(id, `the invoice prices this item, but not per bottle: ${reason}. The lot stays provisional.`);
        }
        continue;
      }
      // A settled price is one a person put their name to, so its provenance is
      // `manual` — calling it `invoice` would claim a document said it. It
      // carries no share of the invoice's charges or discount.
      const agreed: AgreedPrice = {
        unitCost: cost.unitCost,
        provenance: "manual",
        source: "accepted_proposal",
        basis: `accepted proposal: ${cost.basis.replace(/^invoice price/, "price")}; a settled price carries no share of the invoice's charges or discount`,
      };
      if (id) {
        byItem.set(id, agreed);
        refused.delete(id);
        held.delete(id);
        lineOnly.delete(id);
      } else unattached.push(agreed);
    }

    return {
      ok: true,
      value: {
        byItem,
        unattached,
        refused,
        unattachedRefused,
        held,
        lineOnly,
        papers: landed.papers,
        printed,
      },
    };
  }
}
