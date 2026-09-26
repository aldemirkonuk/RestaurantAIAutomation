import { normalizeUom, type Uom } from "./documents/document-types";

/**
 * What an order line has RECEIVED — ADR 0192, the founder's answer of
 * 2026-09-21 ("Shelf count from ledger").
 *
 * ===========================================================================
 * THE DEFINITION, IN ONE SENTENCE
 * ===========================================================================
 * "Received" is the sum of `inventory_transactions.quantity_change` for
 * (this order, this order's item, `stock_type = 'live'`), in the ITEM's stock
 * unit (`restaurant_inventory.uom`, which is `bottle` for wine), never rounded.
 *
 * It is shown as "5 cases + 5 bottles" from the order's own pack size, and as
 * bottles alone when the pack size is not known. Two further facts travel
 * BESIDE it and are never folded into it:
 *
 *   * rejected at the door — `procurement_receipt_events.rejected_qty_bottles`;
 *   * counted at the door but not on the shelf — door-accepted bottles the
 *     ledger does not hold (a stock movement that failed, or an order whose
 *     item the door could not book to).
 *
 * THE SIBLINGS (ADR 0192 amendment, founder answer 8, 2026-09-21). The same
 * reading answers what the order's four other quantity columns used to hold,
 * in BOTTLES, and the app no longer reads or writes those columns:
 *
 *   * accepted  — the ledger count above (the verification's correction is
 *                 what moves it); there is no second "accepted" number;
 *   * rejected  — at the door (above) and at verification: the latest
 *                 `reconciled` event's `rejected_qty_bottles`, passing over a
 *                 one-tap confirmation, which states no refusal (below);
 *   * invoiced  — the `invoice_qty_bottles` of the latest `reconciled` event
 *                 that STATES one (null = no invoice has been verified);
 *   * backorder — the order's bottles less the ledger count, never below
 *                 zero (null when the order's bottles are not known exactly).
 *
 * ===========================================================================
 * WHY THE LEDGER AND NOT `procurement_orders.quantity_received`
 * ===========================================================================
 * The column had four writers that disagreed on its unit (three wrote the
 * order's unit, the door wrote bottles), on gross versus net (the door wrote
 * accepted, `verifyReceipt` wrote accepted + rejected), and on completeness
 * (the canonical delivery path never wrote it; `markDelivered` wrote it even
 * when its own stock movement failed). The ledger is the one record every
 * booking path writes with the order id: the door, the one-tap delivery, the
 * delivery paperwork and the desk's corrections. The app no longer reads or
 * writes the column at all; `scripts/check_no_quantity_received_column.py`
 * holds that line.
 *
 * ===========================================================================
 * THREE STATES ON THE WIRE
 * ===========================================================================
 *   * key ABSENT      — this route did not read the ledger;
 *   * `readable:true` — the reading below;
 *   * `readable:false` — a read failed, and `why` says which. NEVER a zero: a
 *     shelf we could not read and a shelf with nothing on it are different
 *     facts, and a desk that pre-filled "0" from a failed read would book a
 *     correction against it.
 */

/**
 * THE ONE-TAP CONFIRMATION (ADR 0192, fifth amendment; founder, 2026-09-26,
 * round 6, verbatim option: "Yes, keep last invoice (Recommended) — It writes a
 * history line with the counted bottles. The invoice figure from an earlier
 * check stays readable instead of turning into 'unknown'.").
 *
 * A verification that states no count, no invoice and no refusal — the mobile
 * Today card's "Counts match", which posts `{ adjustments: [] }` — writes a
 * `reconciled` event with the bottles the ledger holds, no invoice, and this
 * `outcome` (the receiver's word, from the column's own list: the delivery was
 * accepted as booked). A full verification leaves `outcome` null, so the word
 * is what tells the two apart; nothing is inferred from an absent number.
 *
 * Such a line is a verification (it sets `verifiedAt`), but it RESTATES
 * nothing: the invoice and the desk's refusal are read from the latest event
 * that states them, so an earlier check's invoice figure stays readable and
 * its refusal is not turned into a zero nobody counted.
 */
export const COUNTS_CONFIRMED_OUTCOME = "accepted";

/** A `reconciled` event written by the one-tap confirmation, not by a full verification. */
export function isCountsConfirmation(e: {
  stage?: string | null;
  outcome?: string | null;
}): boolean {
  return e.stage === "reconciled" && e.outcome === COUNTS_CONFIRMED_OUTCOME;
}

/** The `reason` code when a caller tries to type a received count onto an order. */
export const RECEIVED_IS_NOT_TYPED_IN = "received_is_the_ledger";

/** The sentence `updateOrder` refuses a typed received count with. */
export const RECEIVED_IS_THE_LEDGER =
  "What an order received is what the stock ledger booked for it (ADR 0192), so it cannot " +
  "be set on the order by hand. Nothing was changed. Record the delivery at the receiving " +
  "door, with POST /procurement/orders/:id/deliver, or by verifying the receipt, and the " +
  "count follows from the stock that actually moved.";

/** Units whose one-of-them is several bottles. The same set the door and verify use. */
const MULTIPLYING: ReadonlySet<Uom> = new Set<Uom>(["case", "pack", "split_case"]);

/** Door-accepted bottles can only be set against a ledger kept in one of these. */
const BOTTLE_LIKE = new Set(["bottle", "each"]);

/**
 * `verifyReceipt`'s corrections carry this key prefix
 * (`procurement.service.ts` `applyReceiptAdjustment`). They are the desk's
 * reconciliation of the door's count, so they are part of what is RECEIVED but
 * not part of what the door's count is compared against: a desk that counted
 * two fewer than the door has not left two bottles "counted but not booked".
 */
const DESK_CORRECTION_KEY_PREFIX = "receipt-verify:";

export type ShelfReceived =
  | {
      readable: true;
      why: null;
      /** The ledger sum, in `stockUom`. An integer; never rounded. */
      quantityInStockUom: number;
      /** `restaurant_inventory.uom` for the order's item. `bottle` for wine. */
      stockUom: string;
      /** The order's multiplying unit (`case`, `pack`, `split_case`), or null. */
      packUnit: string | null;
      /** Bottles in one `packUnit`, exact, or null when the order does not state one. */
      packSize: number | null;
      /** Whole packs in the count, or null when there is no pack view. */
      packs: number | null;
      /** What is left after the whole packs, in `stockUom`, or null with `packs`. */
      looseInStockUom: number | null;
      /** "5 cases + 5 bottles", "60 bottles", "0 bottles". */
      words: string;
      /** Refused at the door, in bottles, from the door's own events. */
      rejectedAtDoorBottles: number;
      /**
       * Accepted at the door and not on the shelf, in bottles. Null when the
       * item's stock unit is not a bottle count, because the door's bottles
       * cannot be set against a keg or a litre ledger.
       */
      countedNotBookedBottles: number | null;
      /** Refused at verification, in bottles, from the latest full verification (a one-tap confirmation states none); null = never verified. */
      rejectedAtDeskBottles: number | null;
      /** What the verified invoice billed, in bottles, from the latest verification that stated one; null = no invoice verified. */
      invoicedBottles: number | null;
      /** When the latest verification was recorded; null = never verified. */
      verifiedAt: string | null;
      /** The order's quantity in bottles, exact, or null when it is not known exactly. */
      orderedBottles: number | null;
      /** Ordered bottles the ledger does not hold yet; null when either side is not a bottle count. */
      backorderBottles: number | null;
    }
  | {
      readable: false;
      /** Which read failed, in a sentence a screen can print. */
      why: string;
      quantityInStockUom: null;
      stockUom: null;
      packUnit: null;
      packSize: null;
      packs: null;
      looseInStockUom: null;
      words: null;
      rejectedAtDoorBottles: null;
      countedNotBookedBottles: null;
      rejectedAtDeskBottles: null;
      invoicedBottles: null;
      verifiedAt: null;
      orderedBottles: null;
      backorderBottles: null;
    };

export function shelfUnreadable(why: string): ShelfReceived {
  return {
    readable: false,
    why,
    quantityInStockUom: null,
    stockUom: null,
    packUnit: null,
    packSize: null,
    packs: null,
    looseInStockUom: null,
    words: null,
    rejectedAtDoorBottles: null,
    countedNotBookedBottles: null,
    rejectedAtDeskBottles: null,
    invoicedBottles: null,
    verifiedAt: null,
    orderedBottles: null,
    backorderBottles: null,
  };
}

/** The noun for `n` of a unit. `split_case` reads as two words. */
export function unitNoun(unit: string, n: number): string {
  const one = Math.abs(n) === 1;
  switch (unit) {
    case "bottle":
      return one ? "bottle" : "bottles";
    case "case":
      return one ? "case" : "cases";
    case "pack":
      return one ? "pack" : "packs";
    case "split_case":
      return one ? "split case" : "split cases";
    case "keg":
      return one ? "keg" : "kegs";
    case "glass":
      return one ? "glass" : "glasses";
    case "shot":
      return one ? "shot" : "shots";
    // Mass, volume and "each" do not take a plural.
    default:
      return unit;
  }
}

/**
 * Whole packs and what is left, in one pure step. NEVER rounds: 65 bottles at
 * 12 a case is 5 cases and 5 bottles, not "5" and not "5.42".
 */
export function packsAndLoose(
  quantity: number,
  packSize: number,
): { packs: number; loose: number } {
  const packs = Math.floor(quantity / packSize);
  return { packs, loose: quantity - packs * packSize };
}

/** "5 cases + 5 bottles" / "5 cases" / "7 bottles" / "0 bottles". */
export function shelfWords(input: {
  quantity: number;
  stockUom: string;
  packUnit: string | null;
  packs: number | null;
  loose: number | null;
}): string {
  const { quantity, stockUom, packUnit, packs, loose } = input;
  if (packUnit === null || packs === null || loose === null || packs === 0) {
    return `${quantity} ${unitNoun(stockUom, quantity)}`;
  }
  const whole = `${packs} ${unitNoun(packUnit, packs)}`;
  return loose === 0 ? whole : `${whole} + ${loose} ${unitNoun(stockUom, loose)}`;
}

/**
 * The two facts the founder asked to travel BESIDE the count (ADR 0192):
 * " (1 bottle rejected at the door; 24 bottles counted at the door and not on
 * the shelf yet)", or "" when neither is above zero or the reading failed.
 * Never folded into the count, never dropped from a sentence that states it.
 */
export function besideTheShelf(received: ShelfReceived): string {
  if (!received.readable) return "";
  const parts: string[] = [];
  const rejected = received.rejectedAtDoorBottles;
  if (rejected > 0)
    parts.push(`${rejected} ${unitNoun("bottle", rejected)} rejected at the door`);
  const pending = received.countedNotBookedBottles;
  if (pending !== null && pending > 0)
    parts.push(
      `${pending} ${unitNoun("bottle", pending)} counted at the door and not on the shelf yet`,
    );
  const desk = received.rejectedAtDeskBottles;
  if (desk !== null && desk > 0)
    parts.push(`${desk} ${unitNoun("bottle", desk)} rejected at verification`);
  const owed = received.backorderBottles;
  if (owed !== null && owed > 0)
    parts.push(`${owed} ${unitNoun("bottle", owed)} still on backorder`);
  return parts.length ? ` (${parts.join("; ")})` : "";
}

/** What one order contributes to the reading. Every field is a raw row value. */
export interface ShelfOrderRow {
  id: string;
  inventory_id?: string | null;
  unit_type?: string | null;
  quantity?: number | string | null;
  bottles_total?: number | string | null;
}

export interface ShelfLedgerRow {
  order_id: string;
  inventory_id: string;
  quantity_change: unknown;
  idempotency_key?: string | null;
}

export interface ShelfDoorEvent {
  order_id: string;
  counted_qty_bottles: unknown;
  rejected_qty_bottles: unknown;
  /** `case_count` (the door) or `reconciled` (a verification); absent = the door. */
  stage?: string | null;
  invoice_qty_bottles?: unknown;
  /** On a `reconciled` event, `accepted` marks the one-tap confirmation (`COUNTS_CONFIRMED_OUTCOME`). */
  outcome?: string | null;
  occurred_at?: string | null;
}

export interface ShelfOrderLine {
  order_id: string;
  unit_type?: string | null;
  bottles_per_unit?: unknown;
}

/**
 * The order's pack, by the rule `resolveOrderMatchUnits` applies: the LINE's
 * `bottles_per_unit` when exactly one line states it, else `bottles_total /
 * quantity` when that divides exactly, else unknown. A pack size is never
 * rounded into existence: 65 bottles on a 6-case order is not "pack 11".
 */
export function orderPack(
  order: ShelfOrderRow,
  lines: ShelfOrderLine[],
): { unit: Uom | null; size: number | null } {
  const stated = lines.filter((l) => l.bottles_per_unit != null);
  const line = stated.length === 1 ? stated[0] : null;
  const rawUnit = (line?.unit_type ?? order.unit_type ?? "").toString().trim();
  // The column's own declared default is bottles, so an absent unit is a bottle.
  const unit: Uom | null = rawUnit === "" ? "bottle" : normalizeUom(rawUnit);
  if (line) {
    const size = Number(line.bottles_per_unit);
    return { unit, size: Number.isSafeInteger(size) && size >= 1 ? size : null };
  }
  const quantity = Number(order.quantity);
  const bottles = Number(order.bottles_total);
  if (
    Number.isFinite(quantity) &&
    quantity > 0 &&
    Number.isFinite(bottles) &&
    bottles > 0 &&
    Number.isInteger(bottles / quantity) &&
    bottles / quantity >= 1
  ) {
    return { unit, size: bottles / quantity };
  }
  return { unit, size: null };
}

/**
 * Compose one order's reading from rows already read. Pure; every read
 * happened before this and every failure was reported before this.
 */
export function composeShelfReceived(input: {
  order: ShelfOrderRow;
  stockUom: string | null;
  ledger: ShelfLedgerRow[];
  doorEvents: ShelfDoorEvent[];
  lines: ShelfOrderLine[];
}): ShelfReceived {
  const { order } = input;
  if (!order.inventory_id) {
    return shelfUnreadable(
      "This order is not linked to an item, so no stock can be booked against it " +
        "and what it received cannot be read from the shelf.",
    );
  }
  if (!input.stockUom) {
    return shelfUnreadable(
      "This order's item states no stock unit, so its shelf count cannot be stated in one.",
    );
  }
  const stockUom = input.stockUom.trim().toLowerCase();

  let quantity = 0;
  let notDesk = 0;
  for (const row of input.ledger) {
    if (row.order_id !== order.id || row.inventory_id !== order.inventory_id) continue;
    const change = Number(row.quantity_change);
    if (row.quantity_change == null || !Number.isSafeInteger(change)) {
      return shelfUnreadable(
        "This order's ledger holds a quantity that is not a whole number, so its shelf count was not added up.",
      );
    }
    quantity += change;
    if (!String(row.idempotency_key ?? "").startsWith(DESK_CORRECTION_KEY_PREFIX))
      notDesk += change;
  }
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    return shelfUnreadable(
      `This order's ledger adds up to ${quantity}, which is not a count that can be on a shelf. ` +
        "It needs a manager's reconciliation before it is shown as received.",
    );
  }

  let doorAccepted = 0;
  let doorRejected = 0;
  // The verification of record is the LATEST `reconciled` event: a re-verify
  // restates the whole delivery, so events are not added up across runs.
  // Each figure is read from the latest event that STATES it (ADR 0192, fifth
  // amendment): the invoice from the latest event with an invoice, the desk's
  // refusal from the latest full verification. A one-tap confirmation is the
  // latest verification (`desk`) but states neither.
  const later = (a: ShelfDoorEvent | null, b: ShelfDoorEvent) =>
    !a || String(b.occurred_at ?? "") >= String(a.occurred_at ?? "");
  let desk: ShelfDoorEvent | null = null;
  let deskRefusal: ShelfDoorEvent | null = null;
  let deskInvoice: ShelfDoorEvent | null = null;
  for (const e of input.doorEvents) {
    if (e.order_id !== order.id) continue;
    if (e.stage === "reconciled") {
      if (later(desk, e)) desk = e;
      if (!isCountsConfirmation(e) && later(deskRefusal, e)) deskRefusal = e;
      if (e.invoice_qty_bottles != null && later(deskInvoice, e)) deskInvoice = e;
      continue;
    }
    const counted = Number(e.counted_qty_bottles ?? 0);
    const rejected = Number(e.rejected_qty_bottles ?? 0);
    if (!Number.isFinite(counted) || !Number.isFinite(rejected)) {
      return shelfUnreadable(
        "A door count on this order holds a number that cannot be read, so what the door rejected was not added up.",
      );
    }
    doorAccepted += Math.max(0, counted - rejected);
    doorRejected += Math.max(0, rejected);
  }

  let rejectedAtDeskBottles: number | null = null;
  let invoicedBottles: number | null = null;
  if (desk) {
    // Only confirmations so far: the desk verified and refused nothing.
    const rejected = deskRefusal ? Number(deskRefusal.rejected_qty_bottles ?? 0) : 0;
    const invoiced = deskInvoice ? Number(deskInvoice.invoice_qty_bottles) : null;
    if (!Number.isFinite(rejected) || (invoiced !== null && !Number.isFinite(invoiced))) {
      return shelfUnreadable(
        "The verification on this order holds a number that cannot be read, so what it rejected or was invoiced was not added up.",
      );
    }
    rejectedAtDeskBottles = Math.max(0, rejected);
    invoicedBottles = invoiced === null ? null : Math.max(0, invoiced);
  }

  const pack = orderPack(
    order,
    input.lines.filter((l) => l.order_id === order.id),
  );
  // The order's bottles, exactly, or unknown: a bottle order is its quantity;
  // a pack order is its quantity times a pack size read exactly. Never a
  // rounded guess — a backorder computed from one would be a number nobody
  // counted.
  const orderedQty = Number(order.quantity);
  const orderedBottles: number | null = !Number.isSafeInteger(orderedQty) || orderedQty < 0
    ? null
    : pack.unit === "bottle" || pack.unit === "each"
      ? orderedQty
      : pack.unit !== null && MULTIPLYING.has(pack.unit) && pack.size !== null
        ? orderedQty * pack.size
        : null;
  const packView =
    stockUom === "bottle" &&
    pack.unit !== null &&
    MULTIPLYING.has(pack.unit) &&
    pack.size !== null &&
    pack.size > 1;
  const split = packView ? packsAndLoose(quantity, pack.size as number) : null;
  const packUnit = packView ? (pack.unit as string) : null;

  return {
    readable: true,
    why: null,
    quantityInStockUom: quantity,
    stockUom,
    packUnit,
    packSize: packView ? pack.size : null,
    packs: split ? split.packs : null,
    looseInStockUom: split ? split.loose : null,
    words: shelfWords({
      quantity,
      stockUom,
      packUnit,
      packs: split ? split.packs : null,
      loose: split ? split.loose : null,
    }),
    rejectedAtDoorBottles: doorRejected,
    countedNotBookedBottles: BOTTLE_LIKE.has(stockUom)
      ? Math.max(0, doorAccepted - notDesk)
      : null,
    rejectedAtDeskBottles,
    invoicedBottles,
    verifiedAt: desk ? (desk.occurred_at ?? null) : null,
    orderedBottles,
    backorderBottles:
      orderedBottles !== null && BOTTLE_LIKE.has(stockUom)
        ? Math.max(0, orderedBottles - quantity)
        : null,
  };
}

/** Enough of a supabase-js client to read four tables. Structural, so tests pass literals. */
type Db = { from(table: string): any };

const CHUNK = 100;
const PAGE = 1000;

function chunks<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** Every page of one filtered read. A failed page is thrown with the table named. */
async function readAll(
  table: string,
  query: (from: number, to: number) => PromiseLike<{ data: any; error: any }>,
): Promise<any[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error || !Array.isArray(data)) {
      throw new Error(
        `${table} could not be read (${error?.message ?? "no rows array came back"})`,
      );
    }
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

/**
 * The shelf reading for every order passed in, in FOUR reads however many
 * orders there are (per 100 ids): the ledger, the door's events, the items'
 * stock units and the order lines. A list of fifty orders is four round trips,
 * not two hundred.
 *
 * A failed read is reported on EVERY order it covered, as `readable:false`
 * with the table named. It never becomes a zero.
 *
 * Tenant scope: every read is filtered by `restaurantId`, which the caller
 * takes from the token. The order ids come from rows the caller already read
 * under the same scope.
 */
export async function readShelfReceived(
  db: Db,
  restaurantId: string,
  orders: ShelfOrderRow[],
): Promise<Map<string, ShelfReceived>> {
  const out = new Map<string, ShelfReceived>();
  const wanted = orders.filter((o) => o && typeof o.id === "string");
  if (!wanted.length) return out;

  for (const batch of chunks(wanted, CHUNK)) {
    const ids = batch.map((o) => o.id);
    const itemIds = [
      ...new Set(
        batch
          .map((o) => o.inventory_id)
          .filter((x): x is string => typeof x === "string" && x !== ""),
      ),
    ];
    try {
      const [ledger, doorEvents, items, lines] = await Promise.all([
        readAll("The stock ledger", (from, to) =>
          db
            .from("inventory_transactions")
            .select("id, order_id, inventory_id, quantity_change, idempotency_key")
            .eq("restaurant_id", restaurantId)
            .in("order_id", ids)
            .eq("stock_type", "live")
            .order("id", { ascending: true })
            .range(from, to),
        ),
        readAll("The door's counts and the verifications", (from, to) =>
          db
            .from("procurement_receipt_events")
            .select(
              "id, order_id, stage, outcome, counted_qty_bottles, rejected_qty_bottles, invoice_qty_bottles, occurred_at",
            )
            .eq("restaurant_id", restaurantId)
            .in("order_id", ids)
            .in("stage", ["case_count", "reconciled"])
            .order("id", { ascending: true })
            .range(from, to),
        ),
        itemIds.length
          ? readAll("The items' stock units", (from, to) =>
              db
                .from("restaurant_inventory")
                .select("id, uom")
                .eq("restaurant_id", restaurantId)
                .in("id", itemIds)
                .order("id", { ascending: true })
                .range(from, to),
            )
          : Promise.resolve([]),
        readAll("The order lines", (from, to) =>
          db
            .from("procurement_order_items")
            .select("id, order_id, unit_type, bottles_per_unit")
            .eq("restaurant_id", restaurantId)
            .in("order_id", ids)
            .order("id", { ascending: true })
            .range(from, to),
        ),
      ]);
      const uomByItem = new Map<string, string | null>(
        items.map((r: any) => [String(r.id), r.uom == null ? null : String(r.uom)]),
      );
      for (const order of batch) {
        out.set(
          order.id,
          composeShelfReceived({
            order,
            stockUom: order.inventory_id
              ? (uomByItem.get(order.inventory_id) ?? null)
              : null,
            ledger,
            doorEvents,
            lines,
          }),
        );
      }
    } catch (err: any) {
      const why =
        `What this order received could not be read: ${err?.message ?? String(err)}. ` +
        "Nothing is shown in its place; try again when the ledger is available.";
      for (const order of batch) out.set(order.id, shelfUnreadable(why));
    }
  }
  return out;
}

/** One order. The same reads, the same failure rule. */
export async function readOneShelfReceived(
  db: Db,
  restaurantId: string,
  order: ShelfOrderRow,
): Promise<ShelfReceived> {
  const map = await readShelfReceived(db, restaurantId, [order]);
  return (
    map.get(order.id) ??
    shelfUnreadable("What this order received could not be read.")
  );
}
