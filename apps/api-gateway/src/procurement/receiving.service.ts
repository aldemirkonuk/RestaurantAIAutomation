import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { normalizeUom, toBottles, Uom } from "./documents/document-types";
import { ORDER_UNIT_TYPES } from "./order-units";

/**
 * ReceivingService — the door stage of a two-stage delivery.
 *
 * WHY A DELIVERY IS NOT ONE MOMENT
 *
 * The driver is double-parked with six more stops and often works for a
 * third-party carrier with no authority to adjust anything. The person at the
 * door is a porter or a prep cook, because the manager is not in until ten. It
 * is a sidewalk or a stairwell, hands are cold, there is no signal in the
 * walk-in. Cases are shrink-wrapped and nobody opens fourteen of them. What
 * actually gets counted is CASES, and the signature — the legally interesting
 * act — happens before any counting at all.
 *
 * Modelling that as one terminal transaction forces the receiver to either lie
 * or hold up the truck. So the door records what a person can honestly know in
 * thirty seconds, and the bottle count happens at 2pm by whoever breaks the
 * cases. verifyReceipt is unchanged and becomes that second stage.
 *
 * WHERE THE STOCK GOES, AND WHY THERE IS NO THIRD STOCK STATE
 *
 * The case count moves stock to LIVE immediately. The alternative — holding it
 * until someone counts bottles — means the wine is on the shelf while the system
 * says it is not, and a somm pouring a bottle that shows zero stock is how staff
 * learn to stop trusting the app.
 *
 * That leaves a real gap: for a few hours the number is knowingly approximate,
 * because a short case reads as a full one. It is tempting to model that as a
 * third stock state, but apply_stock_movement accepts only live|shadow and is the
 * write path for all of inventory — widening it to carry a receiving concern
 * would put a delivery-desk problem inside the ledger everything else depends on.
 *
 * Instead, provisional-ness is DERIVED: a delivery with a case count and no
 * bottle count is unverified, and that is a query over procurement_receipt_events,
 * not a column. Nothing about the stock number changes, so no other screen has to
 * learn a new state. The risk that actually matters is not the approximate hour —
 * it is that nobody ever counts, the case was short, and the shortfall silently
 * becomes shrinkage months later. So unverified deliveries AGE, and age is what
 * gets surfaced.
 */

/** The outcomes a receiver may record. Mirrors DoorModel.DoorOutcome. */
export const DOOR_OUTCOMES = ["accepted", "short", "refused"] as const;
export type DoorOutcome = (typeof DOOR_OUTCOMES)[number];

/** Why a delivery was turned away. Mirrors DoorModel.RefusalReason. */
export const DOOR_REFUSAL_REASONS = [
  "wrong_wine",
  "broken_case",
  "temperature",
  "other",
] as const;
export type DoorRefusalReason = (typeof DOOR_REFUSAL_REASONS)[number];

export interface DoorReceiptInput {
  restaurantId: string;
  orderId: string;
  userId: string;
  /** What was counted at the door, in whatever unit could be counted. */
  countedQty: number;
  countedUom?: string | null;
  /** Bottles per case, when the receiver knows it. Falls back to the order line. */
  packSize?: number | null;
  /**
   * Units refused, IN THE SAME UNIT AS `countedQty` — the name says so because
   * nothing else did.
   *
   * This field used to be `rejectedQty`, with its unit stated nowhere: not in
   * the type, not in the DTO, not in the column. The door sends both numbers in
   * BOXES and the service converted only one of them, so
   * `countedBottles - rejectedQty` subtracted boxes from bottles. Three refused
   * boxes at pack 12 booked 33 bottles of live stock for wine that was turned
   * away at the door; one broken box out of fourteen booked 167 instead of 156.
   *
   * The unit lives in the NAME rather than in a sibling `rejectedUom` field
   * because a second unit is a second thing that can disagree, and the physical
   * act has one unit: the receiver counting boxes rejects boxes. A name cannot
   * disagree with itself, and unlike a branded type it survives JSON — which is
   * the boundary this bug actually crossed.
   */
  rejectedQtyInCountedUom?: number;
  /**
   * DEPRECATED, and read only for receipts already sitting in a phone's outbox.
   *
   * A client shipped before this change queued `rejectedQty` in IndexedDB, in
   * the counted unit. Ignoring that field on the way in would make the fix
   * WORSE than the bug: a queued refusal would arrive with nothing rejected and
   * book the whole refused delivery into live stock. So it is read, interpreted
   * in `countedUom` — which is what that client always meant — and converted.
   *
   * Removable once no phone can still hold a receipt written by that client.
   */
  rejectedQty?: number;
  /** Photo of damage, rather than a typed reason. */
  damagePhotoPath?: string | null;
  /** Document photographed at the door — often a packing slip, not an invoice. */
  documentId?: string | null;
  /** Client-generated, stable across offline retries. */
  idempotencyKey?: string | null;
  /** When the tap actually happened, which may be well before it synced. */
  clientCapturedAt?: string | null;
  notes?: string | null;
  /** The receiver's word on how the delivery stands. */
  outcome?: DoorOutcome | null;
  /** Only ever set alongside `outcome: 'refused'`. */
  refusalReason?: DoorRefusalReason | null;
  /** Who signed. Initials, no ceremony. */
  signedByInitials?: string | null;
  /** The driver present, as the receiver typed it. */
  driverName?: string | null;
  /** What the order expected, IN THE SAME UNIT AS `countedQty`. */
  expectedQtyInCountedUom?: number | null;
}

/**
 * What the door is told back.
 *
 * `stockBooked` is the field that used to be a lie. The service warned on a
 * failed `apply_stock_movement` and then wrote `quantity_received`, the status
 * and `delivered_at` anyway, returning `stockDelta` as though the bottles were
 * on the shelf. Two facts have to be reported separately because they can
 * genuinely differ: the delivery is recorded (durable, the receiver is done)
 * and the shelf count moved (or did not).
 */
export interface DoorReceiptResult {
  alreadyRecorded: boolean;
  eventId?: string | null;
  countedQtyBottles: number;
  /** Every door receipt for this order so far, in bottles. */
  receivedQtyBottles?: number;
  /** Null — never 0 — when the movement did not happen. ADR 0016. */
  stockDelta: number | null;
  stockBooked: boolean;
  /** A sentence for the receiver when the stock did not move. Never a code. */
  stockIssue?: string;
}

export interface UnverifiedDelivery {
  orderId: string;
  orderNumber: string | null;
  countedQtyBottles: number;
  countedAt: string;
  ageHours: number;
  /** Escalation tier — drives how loudly this is surfaced, not whether it is. */
  severity: "fresh" | "stale" | "overdue";
}

/** Past this, an uncounted delivery stops being normal and starts being a risk. */
const STALE_AFTER_HOURS = 12;
const OVERDUE_AFTER_HOURS = 48;

@Injectable()
export class ReceivingService {
  private readonly logger = new Logger(ReceivingService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Record what happened at the door and book the stock.
   *
   * Idempotent on the client's key: the door flow retries over bad signal, and
   * the same tap must not book twice. Everything else about the delivery — the
   * invoice, the price, the four-way match — is deliberately absent. Asking a
   * porter in a stairwell to answer "does this match the PO?" is asking a
   * question they cannot answer, and the price of a wrong answer is a wrong
   * vendor claim.
   */
  async recordDoorReceipt(input: DoorReceiptInput): Promise<DoorReceiptResult> {
    const { data: order, error: orderErr } = await this.db
      .getClient()
      .from("procurement_orders")
      .select(
        "id, order_number, inventory_id, quantity, bottles_total, unit_type, quantity_received, status",
      )
      .eq("restaurant_id", input.restaurantId)
      .eq("id", input.orderId)
      .maybeSingle();
    if (orderErr) throw new Error(orderErr.message);
    if (!order) throw new NotFoundException("Order not found");

    // FAIL CLOSED ON THE UNIT — ADR 0011's rule, applied to the door.
    //
    // This was `normalizeUom(input.countedUom) ?? "case"`, and `"case"` is the
    // unit that MULTIPLIES. An absent or misspelt unit therefore took the one
    // fallback that inflates: 24 counted against a 12-pack booked 288 bottles,
    // silently, into live stock. ADR 0011 decided this exact class of error for
    // POS depletion — "a wrong number that nobody can see is worse than a
    // missing number that everybody can" — and the fallback here is the same
    // silent 12x guess that ADR removed from `sale_unit`.
    //
    // It differs from the ADR in ONE respect, deliberately. The ADR queues,
    // because a POS webhook arrives with no human present and a refusal would go
    // nowhere. At the door a human is standing there: a 400 IS the queue, it is
    // synchronous, and it names the question they can answer in two seconds
    // ("cases or bottles?"). The web door client already treats 4xx as a
    // permanent refusal and surfaces it rather than retrying (`doorOutbox.ts`).
    const uom: Uom | null = normalizeUom(input.countedUom);
    if (!uom) {
      this.logger.warn(
        `door receipt refused for order ${input.orderId}: unit ` +
          `${JSON.stringify(input.countedUom ?? null)} cannot be converted to bottles`,
      );
      throw new BadRequestException({
        reason: "unknown_counted_uom",
        message:
          `"${input.countedUom ?? "(no unit)"}" is not a unit this delivery can be counted in. ` +
          `Say one of: ${ORDER_UNIT_TYPES.join(", ")}. ` +
          `Nothing was booked — a guessed unit would have multiplied the delivery into live stock ` +
          `and surfaced later as a phantom overage against the invoice rather than as a bug.`,
      });
    }
    // Pack size is back-derived from the order's own bottles_total / quantity.
    // That derivation was worthless until `createOrder` started multiplying by
    // the pack size: it wrote bottles_total = quantity, so the ratio was always
    // 1 and every case count silently became a bottle count. The two fixes are
    // one fix — see `order-units.ts`.
    const packSize = this.resolvePackSize(input.packSize, order);
    const countedBottles = toBottles(
      Math.max(0, input.countedQty ?? 0),
      uom,
      packSize,
    );

    // BOTH quantities go through the SAME conversion. This is the whole of the
    // corruption that was here: `rejectedQty` was taken raw, in boxes, and
    // subtracted from a bottle count. See the field's doc comment.
    const rejectedInCountedUom = Math.max(
      0,
      input.rejectedQtyInCountedUom ?? input.rejectedQty ?? 0,
    );
    const rejectedBottles = toBottles(rejectedInCountedUom, uom, packSize);
    const expectedInCountedUom =
      input.expectedQtyInCountedUom == null
        ? null
        : Math.max(0, input.expectedQtyInCountedUom);
    const expectedBottles =
      expectedInCountedUom === null
        ? null
        : toBottles(expectedInCountedUom, uom, packSize);

    // The fallback key still exists for a caller that sends none, but it now
    // carries the rejected figure and a timestamp as well. `door:{orderId}:{n}`
    // alone silently swallowed a genuine SECOND TRUCK whose count happened to
    // match the first — which is exactly the case D3 exists to make work.
    const idempotencyKey =
      input.idempotencyKey ??
      `door:${input.orderId}:${countedBottles}:${rejectedBottles}:${
        input.clientCapturedAt ?? new Date().toISOString()
      }`;

    const eventRow = {
      restaurant_id: input.restaurantId,
      order_id: input.orderId,
      document_id: input.documentId ?? null,
      stage: "case_count",
      counted_qty: input.countedQty,
      counted_uom: uom,
      counted_qty_bottles: countedBottles,
      // The pair now says the same thing on both sides: `*_qty` in counted_uom,
      // `*_qty_bottles` in bottles. The row no longer mixes units.
      rejected_qty: rejectedInCountedUom,
      rejected_qty_bottles: rejectedBottles,
      damage_photo_path: input.damagePhotoPath ?? null,
      received_by: input.userId,
      client_captured_at: input.clientCapturedAt ?? null,
      idempotency_key: idempotencyKey,
      notes: input.notes ?? null,
      // The door's structured facts, in columns rather than in prose nothing
      // reads back. The CHECK constraints carry the same closed vocabularies.
      outcome: input.outcome ?? null,
      refusal_reason:
        input.outcome === "refused" ? (input.refusalReason ?? null) : null,
      signed_by_initials: input.signedByInitials ?? null,
      driver_name: input.driverName ?? null,
      expected_qty_bottles: expectedBottles,
    };

    const { data: event, error: evErr } = await this.db
      .getClient()
      .from("procurement_receipt_events")
      .insert(eventRow)
      .select("id, occurred_at")
      .maybeSingle();

    let eventId = event?.id ?? null;
    let alreadyRecorded = false;

    if (evErr) {
      if (evErr.code !== "23505") throw new Error(evErr.message);

      // 23505 on the idempotency index = this tap already landed.
      //
      // This used to return immediately, and that early return was the reason a
      // throw could not be the answer to a failed stock movement: attempt one
      // writes the event and fails the RPC, attempt two short-circuits here and
      // reports "already recorded" — so the retry that was supposed to fix the
      // stock instead certified the absence of it. Now the retry re-derives the
      // same totals and re-attempts the movement, which is free when it already
      // applied (apply_stock_movement is idempotent on p_idempotency_key,
      // `20260805130000:71-74`) and is the actual repair when it did not.
      alreadyRecorded = true;
      // The error is bound on purpose (ADR 0067). `maybeSingle()` returns
      // `data: null` for BOTH "no row" and "the query failed", and the branch
      // below reads a null `eventId` as a contradiction worth throwing over. So
      // without this, a transient read failure is reported to the operator as
      // "the unique index fired but the row is not visible" — a data-integrity
      // accusation standing in for a query that simply did not run.
      const { data: existing, error: existingError } = await this.db
        .getClient()
        .from("procurement_receipt_events")
        .select("id")
        .eq("restaurant_id", input.restaurantId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existingError) {
        throw new Error(
          `door receipt for order ${input.orderId} collided on its idempotency ` +
            `key, and the lookup for the existing event failed: ` +
            `${existingError.message}. The receipt was NOT recorded; retry is safe ` +
            `(apply_stock_movement is idempotent on p_idempotency_key).`,
        );
      }
      eventId = existing?.id ?? null;
      if (!eventId) {
        // The unique index fired but the row is not visible to this query. That
        // is a contradiction, not a retry, and reporting a receipt off the back
        // of it would be a guess.
        throw new Error(
          `door receipt for order ${input.orderId} collided on its idempotency key ` +
            `but the existing event could not be read back — nothing was booked.`,
        );
      }
    }

    // THE RUNNING TOTAL COMES FROM THE EVENTS, NOT FROM A MUTABLE COLUMN.
    //
    // Split deliveries are normal in wine. `quantity_received = acceptedBottles`
    // set the column ABSOLUTELY, so truck two with six boxes after truck one's
    // eight recorded six received, not fourteen, and the match line called truck
    // two short against the whole PO while the driver waited.
    //
    // Summing the events instead makes the total reconstructible from durable
    // rows, and makes a retry converge rather than accumulate: the sum is over a
    // SET of events, so re-running it after a duplicate key produces the same
    // number it produced the first time.
    const totals = await this.doorTotals(
      input.restaurantId,
      input.orderId,
      eventId,
    );

    // The ledger delta is THIS EVENT's accepted bottles, booked once under this
    // event's own idempotency key — except on the first door receipt for an
    // order, which must also reconcile against whatever the one-shot
    // markDelivered path already put on the shelf. That is the behaviour the
    // old `acceptedBottles - quantity_received` line existed for, kept, and now
    // scoped to the only receipt where it is correct.
    const acceptedBottles = Math.max(0, countedBottles - rejectedBottles);
    const alreadyBookedElsewhere = totals.priorEventCount
      ? 0
      : Number(order.quantity_received ?? 0);
    const delta = acceptedBottles - alreadyBookedElsewhere;

    let stockBooked = true;
    let stockIssue: string | undefined;

    if (!order.inventory_id) {
      // A null inventory_id books nothing. The old code's `if (delta !== 0 &&
      // order.inventory_id)` skipped the RPC and returned `stockDelta: delta`
      // regardless, so an order with no shelf reported a non-zero movement that
      // never happened.
      //
      // NOT a throw, unlike the RPC failure below. No number of retries links an
      // order to a shelf, so queueing this would put a permanently stuck item in
      // an outbox the receiver is meant to watch — and a queue that never drains
      // stops being read, which is how the next real failure hides. It is a 200
      // whose body says, in words the screen renders, that the delivery is
      // recorded and the shelf count is not.
      stockBooked = false;
      stockIssue =
        "The delivery is recorded, but this order is not linked to a shelf, " +
        "so the stock count did not move. A manager has to link it.";
      this.logger.warn(
        `door receipt for order ${input.orderId} has no inventory_id — ` +
          `${delta} bottles were NOT booked`,
      );
    } else if (delta === 0) {
      // Genuinely nothing to move: a full refusal, or a retry that already
      // booked. `apply_stock_movement` returns early on a zero delta anyway
      // (`20260805130000:58`), so this is the same outcome, stated rather than
      // inferred.
      stockBooked = true;
    } else {
      const { error: rpcErr } = await this.db
        .getClient()
        .rpc("apply_stock_movement", {
          p_inventory_id: order.inventory_id,
          p_stock_state: "live",
          p_delta: delta,
          // "receipt"/"receiving" are not valid inventory_transaction_type /
          // inventory_transaction_source enum values (see baseline migration
          // lines 126-153) — the RPC threw on the enum cast and every door
          // receipt silently booked zero stock while reporting success. The
          // closest real values are 'purchase' (goods arriving) and 'order'
          // (sourced from a procurement order).
          p_transaction_type: "purchase",
          p_source: "order",
          p_performed_by: input.userId,
          p_reason: `door case count for order ${order.order_number ?? input.orderId}`,
          // No p_unit_cost. Nobody has seen an invoice yet, so the lot lands as
          // cost_provenance='estimated' and verifyReceipt corrects it to landed
          // cost once the paperwork is in hand. Guessing a cost here would put an
          // unverified price into the books wearing the authority of a real one.
          p_order_id: input.orderId,
          // One movement per EVENT, so two trucks book twice and eight retries
          // of one truck book once.
          p_idempotency_key: `door-receipt:${eventId}`,
        });
      if (rpcErr) {
        // THE FAILURE IS MADE REAL, AND IT IS MADE RETRYABLE.
        //
        // This used to warn and fall through, then write `quantity_received`,
        // the status and `delivered_at`, and return `stockDelta` as though the
        // bottles were on the shelf. Nothing downstream could tell that receipt
        // from one that worked.
        //
        // 503 rather than a distinct 200 body, because a stock-movement failure
        // is the kind that a retry fixes and this one now converges: the event
        // row is already durable, the insert dedupes on the idempotency key, and
        // `apply_stock_movement` dedupes on `door-receipt:{eventId}`. So the
        // outbox re-sends and the second attempt books the stock that the first
        // could not.
        //
        // And the receiver never sees a bare 500. `doorOutbox.submitDoorReceipt`
        // treats a non-4xx as retryable, queues the receipt and returns
        // `synced: false`, so the screen says "Saved on this phone — it will send
        // itself when you are back inside." The tap still succeeds in one second
        // with a driver double-parked; only the ledger waits.
        //
        // Nothing is written to `procurement_orders` on this path. The order
        // stays as it was and the event row surfaces through `listUnverified`,
        // so the delivery is visible as outstanding rather than as complete.
        this.logger.error(
          `door receipt stock movement failed for ${input.orderId}: ${rpcErr.message}`,
        );
        throw new ServiceUnavailableException({
          reason: "stock_movement_failed",
          message:
            `The delivery was recorded but the shelf count could not be updated ` +
            `(${rpcErr.message}). Nothing was lost — this will be retried, and the ` +
            `delivery is already listed as counted-but-unverified.`,
        });
      }
    }

    // Only claim the shelf when the shelf actually moved. Writing
    // `quantity_received` on a failed movement is what made the screen agree
    // with a ledger that had never been touched.
    const orderUpdate: Record<string, unknown> = {
      // The order is NOT completed here. A case count is not a verified
      // receipt, and closing on it would strand the bottle count that catches
      // the short case.
      status: "PARTIALLY_RECEIVED",
      delivered_at: new Date().toISOString(),
      received_by: input.userId,
    };
    if (stockBooked) orderUpdate.quantity_received = totals.receivedBottles;

    await this.db
      .getClient()
      .from("procurement_orders")
      .update(orderUpdate)
      .eq("restaurant_id", input.restaurantId)
      .eq("id", input.orderId);

    return {
      alreadyRecorded,
      eventId,
      countedQtyBottles: countedBottles,
      receivedQtyBottles: totals.receivedBottles,
      // Null, not 0. A number here is a claim about the ledger, and there is no
      // number to make when the movement did not happen (ADR 0016).
      stockDelta: stockBooked ? delta : null,
      stockBooked,
      ...(stockIssue ? { stockIssue } : {}),
    };
  }

  /**
   * Accepted bottles across every door receipt for one order.
   *
   * Reads `counted_qty_bottles` and `rejected_qty_bottles` — both in bottles,
   * both NOT NULL for the rejected side since
   * `20260901220000_door_facts_are_columns.sql` — so the sum cannot repeat the
   * mixed-unit subtraction it exists to replace.
   *
   * `priorEventCount` counts the door events that are NOT the one just written,
   * which is what tells a first receipt (reconcile against markDelivered) from a
   * second truck (add to the running total).
   */
  private async doorTotals(
    restaurantId: string,
    orderId: string,
    currentEventId: string | null,
  ): Promise<{ receivedBottles: number; priorEventCount: number }> {
    const { data, error } = await this.db
      .getClient()
      .from("procurement_receipt_events")
      .select("id, counted_qty_bottles, rejected_qty_bottles")
      .eq("restaurant_id", restaurantId)
      .eq("order_id", orderId)
      .eq("stage", "case_count");
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    let receivedBottles = 0;
    let priorEventCount = 0;
    for (const r of rows) {
      const accepted = Math.max(
        0,
        Number(r.counted_qty_bottles ?? 0) -
          Number(r.rejected_qty_bottles ?? 0),
      );
      receivedBottles += accepted;
      if (r.id !== currentEventId) priorEventCount += 1;
    }
    return { receivedBottles, priorEventCount };
  }

  /**
   * What earlier trucks on this order already brought.
   *
   * The door asks this before the count so the match line can say "14 of 16 with
   * the earlier 8" instead of calling a second truck ten short against the whole
   * purchase order while the driver waits.
   *
   * It reads the receipt events rather than `procurement_orders.quantity_received`
   * for the same reason the write path does: the column is a cache, the events
   * are the record, and the column was being set absolutely by the very bug this
   * answers.
   *
   * `boxes` is null — never 0 — when the pack size is not knowable, because a
   * box count derived from a guessed pack is the error this whole area exists to
   * refuse.
   */
  async doorReceivedSoFar(restaurantId: string, orderId: string) {
    const { data: order, error: orderErr } = await this.db
      .getClient()
      .from("procurement_orders")
      .select("id, quantity, bottles_total, unit_type")
      .eq("restaurant_id", restaurantId)
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr) throw new Error(orderErr.message);
    if (!order) throw new NotFoundException("Order not found");

    const totals = await this.doorTotals(restaurantId, orderId, null);
    const packSize = this.resolvePackSize(null, order);
    // resolvePackSize falls to 1 rather than to 12, so a pack of 1 is either a
    // genuine bottle order or "not knowable". Only a case-unit order can be
    // stated in boxes at all, which is the same rule normalizeDoorOrder applies.
    const unit = String(order.unit_type ?? "").toLowerCase();
    const boxes =
      unit.startsWith("case") && packSize >= 1
        ? Math.round(totals.receivedBottles / packSize)
        : null;

    return {
      receivedQtyBottles: totals.receivedBottles,
      doorEventCount: totals.priorEventCount,
      packSize,
      receivedBoxes: boxes,
    };
  }

  /**
   * Deliveries counted by case and never counted by bottle.
   *
   * This is the whole safety net for booking stock at the door. The approximate
   * hour is fine; the delivery nobody ever went back to is how a short case
   * turns into unexplained shrinkage two months later, at which point it is
   * indistinguishable from theft and cannot be claimed from the vendor.
   */
  async listUnverified(restaurantId: string): Promise<UnverifiedDelivery[]> {
    // Newest-first: the cap below is a lifetime-event-count safety valve, not a
    // recency window, and a restaurant well past 500 lifetime events must still
    // see today's delivery. Ascending order here previously meant the cap kept
    // the OLDEST 500 events, so every new door count stopped surfacing once a
    // restaurant crossed that lifetime total.
    const { data, error } = await this.db
      .getClient()
      .from("procurement_receipt_events")
      .select("order_id, counted_qty_bottles, occurred_at, stage")
      .eq("restaurant_id", restaurantId)
      .order("occurred_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const byOrder = new Map<
      string,
      {
        counted: number;
        at: string;
        verified: boolean;
        caseCountAt: number | null;
      }
    >();
    for (const e of data ?? []) {
      if (!e.order_id) continue;
      const cur = byOrder.get(e.order_id) ?? {
        counted: 0,
        at: e.occurred_at,
        verified: false,
        caseCountAt: null,
      };
      // Rows are no longer guaranteed ascending, so pick the latest case_count
      // by comparing timestamps explicitly rather than trusting fetch order.
      if (e.stage === "case_count") {
        const t = new Date(e.occurred_at).getTime();
        if (cur.caseCountAt === null || t >= cur.caseCountAt) {
          cur.counted = Number(e.counted_qty_bottles ?? 0);
          cur.at = e.occurred_at;
          cur.caseCountAt = t;
        }
      }
      // Either a bottle count or an explicit reconcile closes the loop.
      if (e.stage === "bottle_count" || e.stage === "reconciled")
        cur.verified = true;
      byOrder.set(e.order_id, cur);
    }

    const open = [...byOrder.entries()].filter(([, v]) => !v.verified);
    if (!open.length) return [];

    const { data: orders } = await this.db
      .getClient()
      .from("procurement_orders")
      .select("id, order_number, status")
      .in(
        "id",
        open.map(([id]) => id),
      );
    const numbers = new Map(
      (orders ?? []).map((o) => [
        o.id,
        { number: o.order_number, status: o.status },
      ]),
    );

    const now = Date.now();
    return open
      .filter(([id]) => {
        // A delivery closed through the ordinary one-shot path is verified even
        // without a bottle_count event; only genuinely open ones belong here.
        const status = numbers.get(id)?.status;
        return status !== "COMPLETED" && status !== "CANCELLED";
      })
      .map(([orderId, v]) => {
        const ageHours = Math.max(
          0,
          (now - new Date(v.at).getTime()) / 3_600_000,
        );
        return {
          orderId,
          orderNumber: numbers.get(orderId)?.number ?? null,
          countedQtyBottles: v.counted,
          countedAt: v.at,
          ageHours: Math.round(ageHours),
          severity:
            ageHours >= OVERDUE_AFTER_HOURS
              ? ("overdue" as const)
              : ageHours >= STALE_AFTER_HOURS
                ? ("stale" as const)
                : ("fresh" as const),
        };
      })
      .sort((a, b) => b.ageHours - a.ageHours);
  }

  /**
   * The manager's queue: deliveries that need a decision, worst money first.
   *
   * Only discrepancies. A delivery that matched is not a task, and listing it
   * would bury the four that cost something under forty that did not — which is
   * how a queue stops being read.
   *
   * Sorted by dollars at risk rather than by date, because the reason to look at
   * this list is to recover money and the largest claim is the one worth the
   * phone call. Self-evidenced claims are marked: those are provable from the
   * vendor's own paperwork and are the ones worth starting with.
   */
  async managerQueue(restaurantId: string) {
    const [{ data: orders }, { data: credits }, unverified] = await Promise.all(
      [
        this.db
          .getClient()
          .from("procurement_orders")
          .select(
            "id, order_number, match_status, discrepancy_notes, backorder_quantity, invoice_quantity, quantity, match_verified_at, provider_id",
          )
          .eq("restaurant_id", restaurantId)
          .not("match_status", "is", null)
          .neq("match_status", "matched")
          .order("match_verified_at", { ascending: false })
          .limit(100),
        this.db
          .getClient()
          .from("procurement_credits")
          .select(
            "id, order_id, reason, summary, claimed_amount, state, self_evidenced, opened_at",
          )
          .eq("restaurant_id", restaurantId)
          .in("state", ["open", "requested", "promised"])
          .limit(200),
        this.listUnverified(restaurantId),
      ],
    );

    const creditsByOrder = new Map<string, any[]>();
    for (const c of credits ?? []) {
      if (!c.order_id) continue;
      creditsByOrder.set(c.order_id, [
        ...(creditsByOrder.get(c.order_id) ?? []),
        c,
      ]);
    }

    const items = (orders ?? []).map((o) => {
      const linked = creditsByOrder.get(o.id) ?? [];
      const atRisk = linked.reduce(
        (n, c) => n + Number(c.claimed_amount ?? 0),
        0,
      );
      return {
        orderId: o.id,
        orderNumber: o.order_number,
        verdict: o.match_status,
        summary: o.discrepancy_notes,
        backorderQty: o.backorder_quantity ?? 0,
        verifiedAt: o.match_verified_at,
        dollarsAtRisk: Math.round(atRisk * 100) / 100,
        selfEvidenced: linked.some((c) => c.self_evidenced),
        openClaims: linked.length,
      };
    });

    items.sort(
      (a, b) =>
        b.dollarsAtRisk - a.dollarsAtRisk ||
        // Provable claims outrank equally-valued unprovable ones — same money,
        // far better odds.
        Number(b.selfEvidenced) - Number(a.selfEvidenced),
    );

    return {
      items,
      unverified,
      totalAtRisk:
        Math.round(items.reduce((n, i) => n + i.dollarsAtRisk, 0) * 100) / 100,
    };
  }

  /**
   * Bottles per case.
   *
   * Falls back through what the order knows and finally to 1 — never to 12.
   * A guessed pack size multiplies a delivery twelvefold in the ledger, which is
   * a far worse error than under-counting a case, and it would be discovered as
   * a phantom overage against the invoice rather than as a bug.
   */
  private resolvePackSize(
    provided: number | null | undefined,
    order: { quantity?: number | null; bottles_total?: number | null },
  ): number {
    if (provided && provided >= 1) return Math.round(provided);
    const qty = Number(order.quantity ?? 0);
    const bottles = Number(order.bottles_total ?? 0);
    if (qty > 0 && bottles > 0) {
      const derived = Math.round(bottles / qty);
      if (derived >= 1) return derived;
    }
    return 1;
  }
}
