import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { normalizeUom, toBottles, Uom } from "./documents/document-types";

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

export interface DoorReceiptInput {
  restaurantId: string;
  orderId: string;
  userId: string;
  /** What was counted at the door, in whatever unit could be counted. */
  countedQty: number;
  countedUom?: string | null;
  /** Bottles per case, when the receiver knows it. Falls back to the order line. */
  packSize?: number | null;
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
  async recordDoorReceipt(input: DoorReceiptInput) {
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

    const uom: Uom = normalizeUom(input.countedUom) ?? "case";
    const packSize = this.resolvePackSize(input.packSize, order);
    const countedBottles = toBottles(
      Math.max(0, input.countedQty ?? 0),
      uom,
      packSize,
    );
    const rejectedQty = Math.max(0, input.rejectedQty ?? 0);

    const idempotencyKey =
      input.idempotencyKey ?? `door:${input.orderId}:${countedBottles}`;

    const { data: event, error: evErr } = await this.db
      .getClient()
      .from("procurement_receipt_events")
      .insert({
        restaurant_id: input.restaurantId,
        order_id: input.orderId,
        document_id: input.documentId ?? null,
        stage: "case_count",
        counted_qty: input.countedQty,
        counted_uom: uom,
        counted_qty_bottles: countedBottles,
        rejected_qty: rejectedQty,
        damage_photo_path: input.damagePhotoPath ?? null,
        received_by: input.userId,
        client_captured_at: input.clientCapturedAt ?? null,
        idempotency_key: idempotencyKey,
        notes: input.notes ?? null,
      })
      .select("id, occurred_at")
      .maybeSingle();

    // 23505 on the idempotency index = this tap already landed. Returning the
    // existing state is the correct response to a retry, not an error.
    if (evErr) {
      if (evErr.code === "23505")
        return { alreadyRecorded: true, countedQtyBottles: countedBottles };
      throw new Error(evErr.message);
    }

    // Book only the difference against what this order has already put on the
    // shelf, so a door count that follows markDelivered corrects rather than
    // doubles.
    const alreadyBooked = Number(order.quantity_received ?? 0);
    const acceptedBottles = Math.max(0, countedBottles - rejectedQty);
    const delta = acceptedBottles - alreadyBooked;

    if (delta !== 0 && order.inventory_id) {
      const { error: rpcErr } = await this.db
        .getClient()
        .rpc("apply_stock_movement", {
          p_inventory_id: order.inventory_id,
          p_stock_state: "live",
          p_delta: delta,
          p_transaction_type: "receipt",
          p_source: "receiving",
          p_performed_by: input.userId,
          p_reason: `door case count for order ${order.order_number ?? input.orderId}`,
          // No p_unit_cost. Nobody has seen an invoice yet, so the lot lands as
          // cost_provenance='estimated' and verifyReceipt corrects it to landed
          // cost once the paperwork is in hand. Guessing a cost here would put an
          // unverified price into the books wearing the authority of a real one.
          p_order_id: input.orderId,
          p_idempotency_key: `door-receipt:${event?.id}`,
        });
      if (rpcErr)
        this.logger.warn(
          `door receipt stock movement failed for ${input.orderId}: ${rpcErr.message}`,
        );
    }

    await this.db
      .getClient()
      .from("procurement_orders")
      .update({
        quantity_received: acceptedBottles,
        // The order is NOT completed here. A case count is not a verified
        // receipt, and closing on it would strand the bottle count that catches
        // the short case.
        status: "PARTIALLY_RECEIVED",
        delivered_at: new Date().toISOString(),
        received_by: input.userId,
      })
      .eq("restaurant_id", input.restaurantId)
      .eq("id", input.orderId);

    return {
      alreadyRecorded: false,
      eventId: event?.id ?? null,
      countedQtyBottles: countedBottles,
      stockDelta: delta,
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
    const { data, error } = await this.db
      .getClient()
      .from("procurement_receipt_events")
      .select("order_id, counted_qty_bottles, occurred_at, stage")
      .eq("restaurant_id", restaurantId)
      .order("occurred_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);

    const byOrder = new Map<
      string,
      { counted: number; at: string; verified: boolean }
    >();
    for (const e of data ?? []) {
      if (!e.order_id) continue;
      const cur = byOrder.get(e.order_id) ?? {
        counted: 0,
        at: e.occurred_at,
        verified: false,
      };
      if (e.stage === "case_count") {
        cur.counted = Number(e.counted_qty_bottles ?? 0);
        cur.at = e.occurred_at;
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
