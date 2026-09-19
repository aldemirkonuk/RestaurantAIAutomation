import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { deliveryHasBookedOrder } from "./canonical/delivery-stock.service";
import { comparableUnits, normalizeUom, toBottles, Uom } from "./documents/document-types";
import { ORDER_UNIT_TYPES } from "./order-units";
import {
  formatVerdictCursor,
  parseVerdictCursor,
  readableLedgerRefusal,
  verdictCursorFilter,
} from "./receiving-verdict-ledger";

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

/** Mirrors the CHECK on receiving_line_verdicts.verdict (ADR 0149 row 23). */
export const LINE_VERDICT_WORDS = [
  "accepted",
  "short",
  "refused",
  "damaged",
] as const;
export type LineVerdictWord = (typeof LINE_VERDICT_WORDS)[number];

export interface AppendLineVerdictInput {
  restaurantId: string;
  orderId: string;
  userId: string;
  verdict: LineVerdictWord;
  /** What the person counted, in the unit they counted in — never re-multiplied. */
  qty: number;
  uom: string;
  /** The person's statement that this portion arrived beyond what was ordered. */
  beyondOrder?: boolean;
  reason: string;
  evidence?: unknown;
  /** The row this portion is taken from, on the same order and line. */
  supersedes?: string | null;
  /** In bottles — the named row's own comparison unit. NULL = all of it. */
  supersedesQtyBottles?: number | null;
  clientCapturedAt?: string | null;
  idempotencyKey?: string | null;
}

export interface LineVerdictRow {
  id: string;
  orderId: string;
  lineNo: number;
  verdict: LineVerdictWord;
  qty: number;
  uom: string;
  qtyBottles: number;
  beyondOrder: boolean;
  reason: string;
  evidence: unknown;
  supersedes: string | null;
  supersedesQtyBottles: number | null;
  recordedBy: string;
  /** Null with a stated reason when the person register cannot be read — never "nobody". */
  recordedByName: string | null;
  recordedByNameUnavailable: string | null;
  recordedAt: string;
  clientCapturedAt: string | null;
}

export interface CurrentVerdictLine {
  verdict: LineVerdictWord;
  beyondOrder: boolean;
  /**
   * 'bottle' for every row whose unit converts (bottle/case/pack/split_case/
   * each); the opaque unit itself ('keg' | 'liter') otherwise. A keg row and
   * a bottle row of the same verdict are never merged into one bucket —
   * that would invent a conversion `toBottles` deliberately refuses to make
   * (fixer review, 2026-09-18).
   */
  currentUnit: "bottle" | "keg" | "liter";
  /** Quantity in `currentUnit`. Named `currentQty`, not `currentBottles` — it is not always bottles. */
  currentQty: number;
  entryCount: number;
  lastRecordedAt: string;
  /**
   * The server's own arithmetic for this bucket, e.g. "12 + 6 − 2 = 16" —
   * every row's own quantity that contributed, in `unit`, added, then what
   * later rows (in ANY bucket) took from any of them subtracted, equalling
   * `currentQty`. Null when there is nothing to show (one untaken row: the
   * bucket total already IS that row's own quantity). Computed here, from
   * the same rows the view derives from — the client never recomputes it
   * (fixer review, 2026-09-18: the figure must open to its sources).
   */
  arithmetic: string | null;
}

export interface LineVerdictLedger {
  /** Oldest first, per the ledger's own convention — a struck-through row stays in the list. */
  entries: LineVerdictRow[];
  /** The derivation, not the latest row. Empty when the line carries no verdict yet. */
  current: CurrentVerdictLine[];
  /**
   * The order's own pack size, so the client never re-derives "5 cases = 60
   * bottles" itself — it renders exactly this conversion, stated once.
   */
  packSize: number;
  orderedUnitType: string | null;
  /**
   * The order's own quantity and bottle total, stated as stored — never
   * `orderedQty * packSize` recomputed here or on the client. Null when the
   * order itself carries no figure yet.
   */
  orderedQty: number | null;
  orderedBottles: number | null;
  /** True when older entries exist beyond this page ("page or group, never grow without end"). */
  hasEarlier: boolean;
  /** Pass back as `before` to fetch the next page of older entries. */
  earliestCursor: string | null;
  /** Total rows ever appended to this order+line, for the "N total entries" caption. */
  totalEntries: number;
  /**
   * `max(orderedBottles, sum of every 'bottle'-unit current bucket) minus
   * that same sum` — the invariant sketch 107 asks for (fixer review,
   * 2026-09-18): every bottle counted, one way or another, either stands in
   * a current bucket or is named here as not yet counted. `max()` rather
   * than a bare subtraction so a beyond-order portion that pushes the total
   * past `orderedBottles` reads as 0 remaining, never a negative "not
   * counted". Null when `orderedBottles` itself is null — there is no basis
   * to reconcile against. keg/liter buckets carry no comparable "ordered"
   * figure today and are not part of this sum.
   */
  notCountedBottles: number | null;
}

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

    // ADR 0103 A5 — ONE BOOKING PATH. If the delivery model has already booked
    // this order's stock (a door count posted through
    // `POST /procurement/documents/door-count` against a delivery), then these
    // bottles are ALREADY on the shelf under the delivery's own keys and this
    // path must not put them there a second time. The event row is still
    // written — the door's evidence is the point of this endpoint — and the
    // response says who owns the stock.
    //
    // A read that FAILS is not a "no" (ADR 0067): the movement is refused and
    // the outbox retries, because booking on an unknown answer is the double
    // count this check exists to prevent.
    const owned = await deliveryHasBookedOrder(
      this.db.getClient(),
      input.orderId,
    );
    if (!owned.ok)
      throw new ServiceUnavailableException({
        reason: "delivery_ownership_unknown",
        message: owned.error,
      });

    if (owned.value.booked) {
      stockBooked = false;
      stockIssue =
        `The count is recorded. The shelf was NOT moved here because delivery ` +
        `${owned.value.deliveryIds.join(", ")} already booked this order's stock ` +
        `at the door (ADR 0103 A1/A5) — booking it again would double the count. ` +
        `Correct the count on the delivery and the difference is moved there.`;
      this.logger.log(
        `door receipt for order ${input.orderId} did not book: delivery ` +
          `${owned.value.deliveryIds.join(", ")} owns this order's stock`,
      );
    } else if (!order.inventory_id) {
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
          // ADR 0141 — the house this receipt is for. `order.inventory_id` was
          // read off an order selected with `.eq("restaurant_id", ...)`, so the
          // ORDER belongs here; the column it carries has no tenant constraint,
          // so the ITEM does not follow from that. The primitive is told which
          // house the movement is for and refuses if the item is not its.
          p_restaurant_id: input.restaurantId,
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
    // ⚠️ THIS WRITE IS IN BOTTLES, AND IT IS THE ONLY ONE THAT IS.
    //
    // `markDelivered` and `updateOrder` write `quantity_received` in the
    // ORDER's own unit — the DTO field is literally called
    // `quantityReceivedInOrderUom` — and `verifyReceipt` reads it back as
    // `stockedQtyInCountedUom`, where `computeMatch` multiplies it by the pack
    // size a second time. MEASURED on a 5-case order of a twelve-pack counted
    // at the door: stocked reads 720 bottles instead of 60 and `ledgerDelta`
    // is −660, so `applyReceiptAdjustment` takes 660 bottles out of live
    // stock. Whether an invoice is on file changes only the WORD the manager
    // sees — "unmatched" without one, "matched" with a matching one — and
    // not the −660, which is identical either way.
    //
    // Nothing is corrupted retrospectively. Production `exzueerziesmczwlhomd`,
    // measured by the coordinating session via SQL on 2026-09-02:
    // `procurement_receipt_events` = 0 rows, and 0 of 2 `procurement_orders`
    // carry a non-null, non-zero `quantity_received`. The door has never run
    // there, so the exposure is the first real door-to-desk delivery.
    //
    // Left as bottles rather than converted, because choosing between the two
    // units has costs on both sides and this column is `integer`, so a
    // bottles→cases conversion rounds a part-case delivery away. Filed in
    // `.planning/v3.0-TECH-DEBT.md` for the founder rather than guessed at.
    //
    // Nothing here depends on the choice: the read at `alreadyBookedElsewhere`
    // above only ever fires on the FIRST door receipt for an order, so this
    // path never reads back its own write.
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
            "id, order_number, match_status, discrepancy_notes, backorder_quantity, invoice_quantity, quantity, match_verified_at, provider_id, currency",
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

    // The vendor box (sketch 107, direction A) needs a name to group by — F2 in
    // 06-pages/receiving.md §15: the old hook read `providerName`, which
    // `mapOrderRow` never emitted. A failed lookup here is named, not silently
    // dropped: `providerNamesUnavailable` lets the grid say so instead of
    // grouping every row under "unknown vendor" as if that were measured.
    const providerIds = Array.from(
      new Set((orders ?? []).map((o) => o.provider_id).filter(Boolean)),
    ) as string[];
    let providerNameById = new Map<string, string>();
    let providerNamesUnavailable = false;
    if (providerIds.length > 0) {
      const { data: providers, error: providersErr } = await this.db
        .getClient()
        .from("providers")
        .select("id, name")
        .in("id", providerIds);
      if (providersErr) {
        providerNamesUnavailable = true;
      } else {
        providerNameById = new Map(
          (providers ?? []).map((p: any) => [p.id as string, p.name as string]),
        );
      }
    }

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
        providerId: o.provider_id ?? null,
        providerName: o.provider_id
          ? (providerNameById.get(o.provider_id) ?? null)
          : null,
        // Fixer review, 2026-09-18: a vendor box's subtotal must never sum
        // across currencies — `procurement_orders.currency` (20260906170000)
        // lets the client group by it instead of assuming every row is USD.
        currency: o.currency ?? null,
      };
    });

    items.sort(
      (a, b) =>
        b.dollarsAtRisk - a.dollarsAtRisk ||
        // Provable claims outrank equally-valued unprovable ones — same money,
        // far better odds.
        Number(b.selfEvidenced) - Number(a.selfEvidenced),
    );

    // Confirmer review, 2026-09-18: this used to be one number summed across
    // every item's currency (a €40 order added straight into a USD total, so
    // "AT RISK $711" was not any real amount of any real currency). Grouped
    // per currency instead — the same rule the vendor boxes already apply to
    // their own subtotals (RcManagerQueue.tsx groupByVendor) — so the header
    // never fabricates a cross-currency sum.
    const byCurrency = new Map<string, number>();
    for (const i of items) {
      const ccy = i.currency ?? "";
      byCurrency.set(
        ccy,
        Math.round(((byCurrency.get(ccy) ?? 0) + i.dollarsAtRisk) * 100) / 100,
      );
    }
    const totalAtRiskByCurrency = Array.from(byCurrency, ([currency, amount]) => ({
      currency: currency || null,
      amount,
    }));

    return {
      items,
      unverified,
      // Kept for the legacy /receiving desk (ReceivingHome.tsx), which reads
      // this as a single USD-formatted number and is retired, not rebuilt
      // (ADR 0149) — still summed across currencies, exactly as it always
      // was. The next-gen desk below reads totalAtRiskByCurrency instead.
      totalAtRisk:
        Math.round(items.reduce((n, i) => n + i.dollarsAtRisk, 0) * 100) / 100,
      totalAtRiskByCurrency,
      providerNamesUnavailable,
    };
  }

  /**
   * Every name in `userIds`, resolved from `public.users`, in one round trip.
   *
   * A failed READ is not the same fact as "this id has no name" — the caller
   * must be able to render "could not look up" rather than "nobody", so a
   * lookup that threw is reported through `unavailableReason`, per id, rather
   * than folded into the same null a genuinely nameless id would return.
   */
  private async resolveNames(
    userIds: string[],
  ): Promise<{ nameById: Map<string, string>; unavailableReason: string | null }> {
    const ids = Array.from(new Set(userIds)).filter(Boolean);
    if (ids.length === 0) return { nameById: new Map(), unavailableReason: null };
    const { data, error } = await this.db
      .getClient()
      .from("users")
      .select("user_id, name")
      .in("user_id", ids);
    if (error) {
      return {
        nameById: new Map(),
        unavailableReason: `the people register could not be read (${error.message})`,
      };
    }
    return {
      nameById: new Map(
        (data ?? []).map((u: any) => [u.user_id as string, u.name as string]),
      ),
      unavailableReason: null,
    };
  }

  /** The same bucket key `receiving_line_verdict_current` groups rows by. */
  private verdictUnit(uom: string): "bottle" | "keg" | "liter" {
    return uom === "keg" || uom === "liter" ? (uom as "keg" | "liter") : "bottle";
  }

  /**
   * The derivation rule (sketch 107) made legible: for each surviving bucket
   * of `receiving_line_verdict_current`, the arithmetic that produced its
   * `current_qty` — every contributing row's own quantity added, then what
   * was taken from any of them subtracted — plus the top-level "not counted"
   * invariant against the order's own bottle total. Reads the WHOLE
   * (unbounded by page) row set for this order+line, since the arithmetic
   * needs rows this page's `limit` may not include; that set is one order's
   * worth of verdict rows, not the whole ledger table, so this is cheap.
   *
   * Fixer review, 2026-09-18 (major: "the derived box does not print the
   * arithmetic"): the client used to show only the final number. Every
   * figure here is server-computed from the rows themselves — the client
   * renders it, never recomputes it.
   */
  private async deriveCurrentWithArithmetic(
    restaurantId: string,
    orderId: string,
    lineNo: number,
    orderedBottles: number | null,
  ): Promise<{ current: CurrentVerdictLine[]; notCountedBottles: number | null }> {
    const [{ data: currentRows, error: currentErr }, { data: allRows, error: allErr }] =
      await Promise.all([
        this.db
          .getClient()
          .from("receiving_line_verdict_current")
          .select("verdict, beyond_order, unit, current_qty, entry_count, last_recorded_at")
          .eq("restaurant_id", restaurantId)
          .eq("order_id", orderId)
          .eq("line_no", lineNo),
        this.db
          .getClient()
          .from("receiving_line_verdicts")
          .select("id, verdict, beyond_order, uom, qty_bottles, supersedes, supersedes_qty_bottles")
          .eq("restaurant_id", restaurantId)
          .eq("order_id", orderId)
          .eq("line_no", lineNo),
      ]);
    if (currentErr)
      throw new InternalServerErrorException(
        `Could not read the derived current state for order ${orderId}: ${currentErr.message}`,
      );
    if (allErr)
      throw new InternalServerErrorException(
        `Could not read the verdict rows for order ${orderId}: ${allErr.message}`,
      );

    const rows = (allRows ?? []) as any[];
    const takenFrom = new Map<string, number>();
    for (const r of rows) {
      if (!r.supersedes) continue;
      const target = rows.find((t) => t.id === r.supersedes);
      const amount = r.supersedes_qty_bottles == null
        ? Number(target?.qty_bottles ?? 0)
        : Number(r.supersedes_qty_bottles);
      takenFrom.set(r.supersedes, (takenFrom.get(r.supersedes) ?? 0) + amount);
    }

    const arithmeticByKey = new Map<string, string>();
    const bucketed = new Map<string, any[]>();
    for (const r of rows) {
      const key = `${r.verdict}|${!!r.beyond_order}|${this.verdictUnit(r.uom)}`;
      bucketed.set(key, [...(bucketed.get(key) ?? []), r]);
    }
    for (const [key, bucketRows] of bucketed) {
      const gross = bucketRows.map((r) => Number(r.qty_bottles));
      const taken = bucketRows.reduce((n, r) => n + (takenFrom.get(r.id) ?? 0), 0);
      const net = gross.reduce((a, b) => a + b, 0) - taken;
      // Trivial case (one row, nothing taken from it) — the bucket total
      // already IS that row's own quantity; nothing to show.
      if (gross.length <= 1 && taken === 0) continue;
      const sentence = taken > 0
        ? `${gross.join(' + ')} − ${taken} = ${net}`
        : `${gross.join(' + ')} = ${net}`;
      arithmeticByKey.set(key, sentence);
    }

    const current: CurrentVerdictLine[] = ((currentRows ?? []) as any[]).map((c) => {
      const key = `${c.verdict}|${!!c.beyond_order}|${c.unit}`;
      return {
        verdict: c.verdict,
        beyondOrder: !!c.beyond_order,
        currentUnit: c.unit,
        currentQty: Number(c.current_qty),
        entryCount: Number(c.entry_count),
        lastRecordedAt: c.last_recorded_at,
        arithmetic: arithmeticByKey.get(key) ?? null,
      };
    });

    // The invariant: every ORDERED bottle either stands in a current,
    // within-order 'bottle' bucket or is not yet counted. keg/liter buckets
    // carry no comparable "ordered" figure and are excluded from this sum,
    // per the same rule that keeps them out of the 'bottle' bucket above.
    // beyondOrder buckets are excluded too (confirmer review, 2026-09-18):
    // they hold bottles delivered/refused BEYOND what this order asked for,
    // so folding them in here let a beyond-order refusal silently pay down
    // the within-order remainder — e.g. 24 ordered, 18 accepted within order
    // + 6 refused beyond order summed to 24 and printed "not counted 0",
    // while 6 of the original 24 were still unaccounted for. Sketch 107's
    // rule keeps the two sums apart; this is the within-order sum only.
    const totalCountedBottlesWithinOrder = current
      .filter((c) => c.currentUnit === "bottle" && !c.beyondOrder)
      .reduce((n, c) => n + c.currentQty, 0);
    const notCountedBottles =
      orderedBottles == null
        ? null
        : Math.max(orderedBottles, totalCountedBottlesWithinOrder) - totalCountedBottlesWithinOrder;

    return { current, notCountedBottles };
  }

  /**
   * The append-only receiving verdict ledger for one order+line (ADR 0149 row
   * 23; sketch 107, "The derivation rule"). Oldest first — the ledger's own
   * convention, so a struck-through row still reads as history in order.
   *
   * "Page or group, never grow without end" (the founder's scale question,
   * sketch 107 Owed): this returns at most `limit` entries, newest of the
   * unread ones first internally, reordered to oldest-first for display, with
   * `hasEarlier`/`earliestCursor` so the sheet can fetch further back on
   * request rather than rendering an ever-growing list.
   */
  async listLineVerdicts(
    restaurantId: string,
    orderId: string,
    opts: { lineNo?: number; limit?: number; before?: string | null } = {},
  ): Promise<LineVerdictLedger> {
    const lineNo = opts.lineNo ?? 1;
    const limit = Math.min(50, Math.max(1, opts.limit ?? 10));

    const { data: order, error: orderErr } = await this.db
      .getClient()
      .from("procurement_orders")
      .select("id, quantity, bottles_total, unit_type")
      .eq("id", orderId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (orderErr)
      throw new InternalServerErrorException(
        `Could not read order ${orderId}: ${orderErr.message}`,
      );
    if (!order)
      throw new NotFoundException(
        `No order ${orderId} on this restaurant — nothing to show a ledger for.`,
      );

    let pageQuery = this.db
      .getClient()
      .from("receiving_line_verdicts")
      .select(
        "id, order_id, line_no, verdict, qty, uom, qty_bottles, beyond_order, reason, evidence, supersedes, supersedes_qty_bottles, recorded_by, recorded_at, client_captured_at",
      )
      .eq("restaurant_id", restaurantId)
      .eq("order_id", orderId)
      .eq("line_no", lineNo)
      .order("recorded_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);
    if (opts.before) {
      // Strictly before the cursor row under (recorded_at desc, id desc) — a
      // timestamp-only comparison skips every row tied with the boundary row.
      const cursor = parseVerdictCursor(opts.before);
      if (!cursor)
        throw new BadRequestException(
          "`before` must be an `earliestCursor` returned by this ledger — nothing was read.",
        );
      pageQuery = cursor.id
        ? pageQuery.or(verdictCursorFilter({ ...cursor, id: cursor.id }))
        : pageQuery.lt("recorded_at", cursor.recordedAt);
    }

    const orderedBottles = order.bottles_total == null ? null : Number(order.bottles_total);
    const [{ data: rows, error: rowsErr }, { current, notCountedBottles }, { count: totalEntries, error: countErr }] =
      await Promise.all([
        pageQuery,
        this.deriveCurrentWithArithmetic(restaurantId, orderId, lineNo, orderedBottles),
        this.db
          .getClient()
          .from("receiving_line_verdicts")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", restaurantId)
          .eq("order_id", orderId)
          .eq("line_no", lineNo),
      ]);
    // A failed read is a server-side fault, not a client mistake — 5xx, not
    // the 400 this used to throw (fixer review, 2026-09-18).
    if (rowsErr)
      throw new InternalServerErrorException(
        `Could not read the verdict ledger for order ${orderId}: ${rowsErr.message}`,
      );
    if (countErr)
      throw new InternalServerErrorException(
        `Could not count the verdict ledger for order ${orderId}: ${countErr.message}`,
      );

    const fetched = (rows ?? []) as any[];
    const hasEarlier = fetched.length > limit;
    const page = hasEarlier ? fetched.slice(0, limit) : fetched;
    const ascending = [...page].reverse(); // oldest first for display

    const { nameById, unavailableReason } = await this.resolveNames(
      ascending.map((r) => r.recorded_by as string),
    );

    const entries: LineVerdictRow[] = ascending.map((r) => ({
      id: r.id,
      orderId: r.order_id,
      lineNo: r.line_no,
      verdict: r.verdict,
      qty: Number(r.qty),
      uom: r.uom,
      qtyBottles: Number(r.qty_bottles),
      beyondOrder: !!r.beyond_order,
      reason: r.reason,
      evidence: r.evidence ?? null,
      supersedes: r.supersedes ?? null,
      supersedesQtyBottles:
        r.supersedes_qty_bottles == null ? null : Number(r.supersedes_qty_bottles),
      recordedBy: r.recorded_by,
      recordedByName: nameById.get(r.recorded_by) ?? null,
      recordedByNameUnavailable: unavailableReason,
      recordedAt: r.recorded_at,
      clientCapturedAt: r.client_captured_at ?? null,
    }));

    return {
      entries,
      current,
      packSize: this.resolvePackSize(null, order),
      orderedUnitType: order.unit_type ?? null,
      orderedQty: order.quantity == null ? null : Number(order.quantity),
      orderedBottles,
      hasEarlier,
      earliestCursor: page.length > 0 ? formatVerdictCursor(page[page.length - 1]) : null,
      totalEntries: totalEntries ?? entries.length,
      notCountedBottles,
    };
  }

  /**
   * Append one verdict row. Never edits or replaces — ADR 0149 row 23.
   *
   * Idempotent on the caller's key, same contract as the door
   * (`recordDoorReceipt`): a retry after a dropped response must not write a
   * second row. The over-take and same-order-and-line invariants are enforced
   * by the database trigger (`receiving_line_verdicts_guard_supersedes`) —
   * this method's own checks exist to turn that into a sentence a manager can
   * act on rather than a raw Postgres error.
   */
  /** case | pack | split_case multiply by the order's pack size; the rest never do. */
  private isCaseLikeUnit(uom: Uom): boolean {
    return uom === "case" || uom === "pack" || uom === "split_case";
  }

  /**
   * Bottles per case, or null when it cannot be derived. Unlike
   * `resolvePackSize` (used for display, where a stated-but-unknown pack
   * falls back to 1 as a visible guess) this NEVER falls back — a case-like
   * verdict with no derivable pack size is refused outright by the caller,
   * because a guessed pack size multiplies a delivery, and a wrong multiply
   * is worse than a rejected append (fixer review, 2026-09-18).
   */
  private derivePackSize(
    order: { quantity?: number | null; bottles_total?: number | null },
  ): number | null {
    const qty = Number(order.quantity ?? 0);
    const bottles = Number(order.bottles_total ?? 0);
    if (qty > 0 && bottles > 0) {
      const derived = Math.round(bottles / qty);
      if (derived >= 1) return derived;
    }
    return null;
  }

  async appendLineVerdict(
    input: AppendLineVerdictInput,
  ): Promise<{ entry: LineVerdictRow; current: CurrentVerdictLine[] }> {
    const lineNo = 1; // every procurement_orders row is one line today (see the migration's header note).

    if (input.idempotencyKey) {
      const { data: existing, error: existingErr } = await this.db
        .getClient()
        .from("receiving_line_verdicts")
        .select("id")
        .eq("restaurant_id", input.restaurantId)
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (existingErr)
        throw new InternalServerErrorException(
          `Could not check for an earlier append with this key: ${existingErr.message}`,
        );
      if (existing) {
        const ledger = await this.listLineVerdicts(input.restaurantId, input.orderId, {
          lineNo,
          limit: 50,
        });
        const entry = ledger.entries.find((e) => e.id === existing.id);
        if (entry) return { entry, current: ledger.current };
        // The row exists but fell outside a 50-row page — vanishingly unlikely
        // for a fresh append, and not a reason to fail the retry.
      }
    }

    const { data: order, error: orderErr } = await this.db
      .getClient()
      .from("procurement_orders")
      .select("id, quantity, bottles_total, unit_type")
      .eq("id", input.orderId)
      .eq("restaurant_id", input.restaurantId)
      .maybeSingle();
    if (orderErr)
      throw new InternalServerErrorException(`Could not read the order: ${orderErr.message}`);
    if (!order)
      throw new NotFoundException(
        `No order ${input.orderId} on this restaurant — nothing to append a verdict to.`,
      );
    const orderedBottles = order.bottles_total == null ? null : Number(order.bottles_total);

    const canonicalUom = normalizeUom(input.uom);
    if (!canonicalUom)
      throw new BadRequestException(
        `"${input.uom}" is not a unit this can convert to bottles — nothing was appended. Use one of: ${ORDER_UNIT_TYPES.join(", ")}.`,
      );

    // Units honesty (fixer review, 2026-09-18): a case-like verdict with no
    // derivable pack size used to fall back to a pack of 1 — "damaged 1
    // case" silently booked as qty_bottles=1, i.e. one bottle. Fail closed
    // instead: refuse the append and name what to do.
    let qtyBottles: number;
    if (this.isCaseLikeUnit(canonicalUom as Uom)) {
      const packSize = this.derivePackSize(order);
      if (packSize == null)
        throw new BadRequestException(
          `This order's pack size is not known, so a "${canonicalUom}" verdict cannot be safely converted to bottles — nothing was appended. Record this portion in bottle or each instead, or add the order's pack size first.`,
        );
      qtyBottles = toBottles(input.qty, canonicalUom as Uom, packSize);
    } else {
      // bottle | each | keg | liter never multiply by a pack size.
      qtyBottles = toBottles(input.qty, canonicalUom as Uom, 1);
    }

    if (input.supersedes) {
      const { data: target, error: targetErr } = await this.db
        .getClient()
        .from("receiving_line_verdicts")
        .select("id, qty_bottles, uom, order_id, line_no, restaurant_id")
        .eq("id", input.supersedes)
        // Fixer review, 2026-09-18: unscoped by restaurant, this could echo
        // another house's row back — including that row's own qty_bottles —
        // and the over-take message the trigger raises (which names the
        // target's order id) would then be passed to this caller verbatim.
        .eq("restaurant_id", input.restaurantId)
        .maybeSingle();
      if (targetErr)
        throw new InternalServerErrorException(
          `Could not read the row this takes from: ${targetErr.message}`,
        );
      if (!target)
        throw new NotFoundException(
          `${input.supersedes} does not name an existing verdict row on this restaurant — nothing was appended.`,
        );
      // Units honesty: a keg or a litre never converts to bottles (or to
      // each other's unit) — comparableUnits is the same rule
      // `receiving_line_verdicts_guard_supersedes` enforces in the database;
      // checked here too so the refusal reads as a sentence, not a raw
      // trigger error, and the migration's own comment on WHY this is a
      // trigger (not just an app check) still holds.
      if (!comparableUnits(target.uom as Uom, canonicalUom as Uom))
        throw new BadRequestException(
          `Cannot take a "${canonicalUom}" portion from a row counted in "${target.uom}" — keg and liter never convert to another unit. Nothing was appended.`,
        );
      if (input.supersedesQtyBottles != null && input.supersedesQtyBottles > Number(target.qty_bottles))
        throw new ConflictException(
          `Cannot take ${input.supersedesQtyBottles} from a row of ${target.qty_bottles} — the database will refuse this and nothing was appended.`,
        );
    }

    const { data: inserted, error: insertErr } = await this.db
      .getClient()
      .from("receiving_line_verdicts")
      .insert({
        restaurant_id: input.restaurantId,
        order_id: input.orderId,
        line_no: lineNo,
        verdict: input.verdict,
        qty: input.qty,
        uom: canonicalUom,
        qty_bottles: qtyBottles,
        beyond_order: input.beyondOrder ?? false,
        reason: input.reason,
        evidence: input.evidence ?? null,
        supersedes: input.supersedes ?? null,
        supersedes_qty_bottles: input.supersedesQtyBottles ?? null,
        recorded_by: input.userId,
        client_captured_at: input.clientCapturedAt ?? null,
        idempotency_key: input.idempotencyKey ?? null,
      })
      .select(
        "id, order_id, line_no, verdict, qty, uom, qty_bottles, beyond_order, reason, evidence, supersedes, supersedes_qty_bottles, recorded_by, recorded_at, client_captured_at",
      )
      .single();

    if (insertErr) {
      const code = (insertErr as any).code;
      // 23505 on the idempotency index — a race with an identical retry.
      // Re-reading it BY THE KEY (not by guessing the row from its content)
      // converges rather than failing a request whose write actually
      // already landed. Matching on reason+verdict+qty (the earlier shape)
      // could return an unrelated row that merely used the same words.
      if (code === "23505" && input.idempotencyKey) {
        const { data: raced, error: racedErr } = await this.db
          .getClient()
          .from("receiving_line_verdicts")
          .select(
            "id, order_id, line_no, verdict, qty, uom, qty_bottles, beyond_order, reason, evidence, supersedes, supersedes_qty_bottles, recorded_by, recorded_at, client_captured_at",
          )
          .eq("restaurant_id", input.restaurantId)
          .eq("idempotency_key", input.idempotencyKey)
          .maybeSingle();
        if (!racedErr && raced) {
          const { nameById: racedNameById, unavailableReason: racedUnavailable } =
            await this.resolveNames([raced.recorded_by]);
          const { current: racedCurrent } = await this.deriveCurrentWithArithmetic(
            input.restaurantId,
            input.orderId,
            lineNo,
            orderedBottles,
          );
          return {
            entry: {
              id: raced.id,
              orderId: raced.order_id,
              lineNo: raced.line_no,
              verdict: raced.verdict,
              qty: Number(raced.qty),
              uom: raced.uom,
              qtyBottles: Number(raced.qty_bottles),
              beyondOrder: !!raced.beyond_order,
              reason: raced.reason,
              evidence: raced.evidence ?? null,
              supersedes: raced.supersedes ?? null,
              supersedesQtyBottles:
                raced.supersedes_qty_bottles == null ? null : Number(raced.supersedes_qty_bottles),
              recordedBy: raced.recorded_by,
              recordedByName: racedNameById.get(raced.recorded_by) ?? null,
              recordedByNameUnavailable: racedUnavailable,
              recordedAt: raced.recorded_at,
              clientCapturedAt: raced.client_captured_at ?? null,
            },
            current: racedCurrent,
          };
        }
      }
      // A business-rule refusal from our own triggers (append-only, the
      // over-take guard, the unit-comparability guard added above) raises a
      // plain `raise exception`, which Postgres reports as SQLSTATE P0001 —
      // surfaced as a 409 so a manager reads it as "the ledger disagrees".
      // Anything else (constraint violations aside, which the DTO and the
      // checks above should already have caught, or an actual database
      // fault) is not this request's fault and is a 5xx, not a 400/409.
      if (code === "P0001") {
        // The trigger's own text names row UUIDs and bare `%` arithmetic — see
        // `readableLedgerRefusal`. An unrecognised one is logged, not echoed:
        // it can carry another row's order id.
        const sentence = readableLedgerRefusal(insertErr.message);
        if (!sentence)
          this.logger.warn(
            `verdict ledger refused an append with an unrecognised trigger message: ${insertErr.message}`,
          );
        throw new ConflictException(
          sentence ?? "The ledger refused this append. Nothing was appended.",
        );
      }
      throw new InternalServerErrorException(insertErr.message);
    }

    const { nameById, unavailableReason } = await this.resolveNames([inserted.recorded_by]);
    const entry: LineVerdictRow = {
      id: inserted.id,
      orderId: inserted.order_id,
      lineNo: inserted.line_no,
      verdict: inserted.verdict,
      qty: Number(inserted.qty),
      uom: inserted.uom,
      qtyBottles: Number(inserted.qty_bottles),
      beyondOrder: !!inserted.beyond_order,
      reason: inserted.reason,
      evidence: inserted.evidence ?? null,
      supersedes: inserted.supersedes ?? null,
      supersedesQtyBottles:
        inserted.supersedes_qty_bottles == null
          ? null
          : Number(inserted.supersedes_qty_bottles),
      recordedBy: inserted.recorded_by,
      recordedByName: nameById.get(inserted.recorded_by) ?? null,
      // Fixer review, 2026-09-18: a failed people-register read used to be
      // hardcoded to null here — an em dash rendered as though nobody
      // recorded the entry, the exact "absence reported as health" pattern
      // `listLineVerdicts` already avoids by passing this through.
      recordedByNameUnavailable: unavailableReason,
      recordedAt: inserted.recorded_at,
      clientCapturedAt: inserted.client_captured_at ?? null,
    };

    const { current } = await this.deriveCurrentWithArithmetic(
      input.restaurantId,
      input.orderId,
      lineNo,
      orderedBottles,
    );

    return { entry, current };
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
