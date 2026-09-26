/**
 * A delivery that booked nothing asks an owner or a manager to name its item,
 * and naming it books the stock then — once, on the record.
 *
 * THE FOUNDER, 2026-09-22 (round 6u), verbatim pick: *"Deliver, flag to name
 * it (Recommended)"* — an order whose delivery names no house item, or
 * resolves to zero bottles, stays "delivered, nothing booked" with its
 * truthful notice AND raises a flag asking an owner/manager to name the item;
 * naming it books the stock then, once, audited. (ADR 0192, third amendment.)
 *
 * - The flag is one `delivery_item_to_name` row per order (20260926141300),
 *   raised by `markDelivered` after its delivered write, never instead of it.
 * - Naming is by the house item's ID, never by a name. Only an owner or a
 *   manager names (the role read strictly; a failed read refuses).
 * - "Once" has three holders: the unique order id (one flag), the open ->
 *   named write conditional on `open` (a second naming matches nothing), and
 *   the ledger key `order-delivered-live:<order>` — the same key markDelivered
 *   books under — which `apply_stock_movement` applies once.
 * - The naming is on the record twice: the flag row says who, when, which item
 *   and how many; `system_audit_log` gets a `delivery_item_named` row.
 * - A booking that fails puts the flag back to open (conditional on exactly
 *   the write this call made), so the naming can be tried again.
 *
 * WHAT IS REACHABLE, STATED: `procurement_orders.inventory_id` is NOT NULL in
 * every migration (baseline 20260805000000), so no stored order names no
 * item; markDelivered's no-item branch is kept and flags `no_item`, but the
 * case a house meets is `zero_bottles`. For it the order already names its
 * item, so naming it means confirming that item and stating how many bottles
 * came in.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  queueResearchIfLibraryLacks,
  type EnqueueOutcome,
} from "../inventory/house-item-research";
import { deliveryHasBookedOrder } from "./canonical/delivery-stock.service";

type Client = {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => any;
};

export type NameAskWhy = "no_item" | "zero_bottles";

/** The most bottles one naming may book: a typo guard, not a business rule. */
export const NAMED_BOTTLES_MAX = 100_000;

export const DELIVERY_ITEM_TO_NAME_COLUMNS =
  "id, restaurant_id, order_id, why, bottles_resolved, status, raised_by, raised_at, named_by, named_at, named_inventory_id, bottles_booked, updated_at, closed_at, closed_reason";

export type DeliveryItemToNameStatus = "open" | "named" | "booked_elsewhere";

export interface DeliveryItemToNameRow {
  id: string;
  restaurant_id: string;
  order_id: string;
  why: NameAskWhy;
  bottles_resolved: number;
  status: DeliveryItemToNameStatus;
  raised_by: string | null;
  raised_at: string;
  named_by: string | null;
  named_at: string | null;
  named_inventory_id: string | null;
  bottles_booked: number | null;
  updated_at: string;
  // 20260926141700 (founder, 2026-09-22: "Close by itself").
  closed_at: string | null;
  closed_reason: string | null;
}

export type RaiseOutcome =
  | { ok: true; created: boolean }
  | { ok: false; error: string };

/**
 * Raise the ask for one delivered order. Idempotent: one row per order (a
 * unique index), so a second raise finds the first. Never throws — the order
 * is already delivered; the caller says the outcome in the notice.
 */
export async function raiseDeliveryItemToName(
  client: Pick<Client, "from">,
  input: {
    restaurantId: string;
    orderId: string;
    why: NameAskWhy;
    bottlesResolved: number;
    raisedBy: string | null;
  },
): Promise<RaiseOutcome> {
  try {
    const { error } = await client.from("delivery_item_to_name").insert({
      restaurant_id: input.restaurantId,
      order_id: input.orderId,
      why: input.why,
      bottles_resolved: input.why === "zero_bottles" ? 0 : Math.max(0, Math.trunc(input.bottlesResolved)),
      raised_by: input.raisedBy,
    });
    if (error) {
      if ((error as { code?: string }).code === "23505") return { ok: true, created: false };
      return { ok: false, error: `the ask to name the item could not be recorded (${error.message})` };
    }
    return { ok: true, created: true };
  } catch (err: any) {
    return { ok: false, error: `the ask to name the item could not be recorded (${err?.message ?? String(err)})` };
  }
}

/** The notice's sentence about the ask. Null when no ask was due. */
export function nameAskWords(o: RaiseOutcome | null): string | null {
  if (o === null) return null;
  if (!o.ok) {
    return `An owner or a manager could not be asked to name it: ${o.error}. Nothing books this delivery's stock until it is named.`;
  }
  return "An owner or a manager is asked to name the item on Inventory; naming it books the stock then, once.";
}

export type CloseElsewhereOutcome =
  | { ok: true; closed: boolean }
  | { ok: false; error: string };

/** What booked the order's stock instead of naming; the ask's `closed_reason` names it. */
export type BookedElsewhereVia = "receiving_door" | "verification";

const BOOKED_ELSEWHERE_REASON: Record<BookedElsewhereVia, string> = {
  receiving_door: "The receiving door booked this order's stock before its item was named.",
  verification: "A verification booked this order's stock before its item was named.",
};

/**
 * When the receiving door or a verification books an order's stock, any
 * open `delivery_item_to_name` ask for that order is stale: the order no
 * longer needs naming to get its stock in. Closed once, conditional on
 * `open` — the founder's answer of 2026-09-22 (round 6z), verbatim pick (2):
 * "Close by itself (Recommended)". Never throws: the booking already
 * happened, and a failure to close is not a failure to book. A no-op
 * (`closed: false`) is not an error — most orders never had an ask.
 */
export async function closeDeliveryItemToNameBookedElsewhere(
  client: Pick<Client, "from">,
  input: { restaurantId: string; orderId: string; via: BookedElsewhereVia },
): Promise<CloseElsewhereOutcome> {
  try {
    const { data, error } = await client
      .from("delivery_item_to_name")
      .update({
        status: "booked_elsewhere",
        closed_at: new Date().toISOString(),
        closed_reason: BOOKED_ELSEWHERE_REASON[input.via],
      })
      .eq("restaurant_id", input.restaurantId)
      .eq("order_id", input.orderId)
      .eq("status", "open")
      .select("id");
    if (error) {
      return { ok: false, error: `the ask to name the item could not be closed (${error.message})` };
    }
    return { ok: true, closed: Array.isArray(data) && data.length > 0 };
  } catch (err: any) {
    return { ok: false, error: `the ask to name the item could not be closed (${err?.message ?? String(err)})` };
  }
}

/** What an owner or a manager sees per open ask. */
export interface DeliveryItemToNameView {
  orderId: string;
  orderNumber: string | null;
  why: NameAskWhy;
  /** What the delivery resolved to; 0 means the count must be stated when naming. */
  bottlesResolved: number;
  /** The item the order already names, by id (null only for a no-item order). */
  orderInventoryId: string | null;
  raisedAt: string;
}

/** This house's open asks. A failed read THROWS: it is never an empty list. */
export async function readOpenDeliveryItemsToName(
  client: Pick<Client, "from">,
  restaurantId: string,
): Promise<DeliveryItemToNameView[]> {
  const { data, error } = await client
    .from("delivery_item_to_name")
    .select(DELIVERY_ITEM_TO_NAME_COLUMNS)
    .eq("restaurant_id", restaurantId)
    .eq("status", "open")
    .order("raised_at", { ascending: true });
  if (error) {
    throw new InternalServerErrorException(
      `Which deliveries wait for their item to be named could not be read (${error.message}).`,
    );
  }
  const rows = (data ?? []) as DeliveryItemToNameRow[];
  if (rows.length === 0) return [];
  const { data: orders, error: ordersError } = await client
    .from("procurement_orders")
    .select("id, order_number, inventory_id")
    .eq("restaurant_id", restaurantId)
    .in(
      "id",
      rows.map((r) => r.order_id),
    );
  if (ordersError) {
    throw new InternalServerErrorException(
      `The orders waiting for their item to be named could not be read (${ordersError.message}).`,
    );
  }
  const byId = new Map(
    ((orders ?? []) as Array<{ id: string; order_number: string | null; inventory_id: string | null }>).map((o) => [
      o.id,
      o,
    ]),
  );
  return rows.map((r) => ({
    orderId: r.order_id,
    orderNumber: byId.get(r.order_id)?.order_number ?? null,
    why: r.why,
    bottlesResolved: r.bottles_resolved,
    orderInventoryId: byId.get(r.order_id)?.inventory_id ?? null,
    raisedAt: r.raised_at,
  }));
}

export interface NamedDelivery {
  orderId: string;
  inventoryId: string;
  bottlesBooked: number;
  /** Whether the `system_audit_log` row was written; the flag row is the record either way. */
  audited: boolean;
  /** The research queue's answer for an item the wine library lacks; null for a library wine. */
  research: EnqueueOutcome | null;
  says: string;
}

const ARRIVED = new Set(["DELIVERED", "PARTIALLY_RECEIVED", "COMPLETED"]);

/**
 * An owner or a manager names the item of a delivery that booked nothing, and
 * the stock is booked — once. Every refusal says what was not done.
 */
export async function nameDeliveredItem(
  deps: {
    client: Client;
    logger: Pick<Logger, "error" | "warn">;
    /** Strict: a failed role read THROWS, and that refuses. */
    isOwnerOrManager: (userId: string, restaurantId: string) => Promise<boolean>;
  },
  input: {
    restaurantId: string;
    orderId: string;
    userId: string;
    inventoryId: string;
    bottles?: number | null;
  },
): Promise<NamedDelivery> {
  const { client, logger } = deps;
  if (!input.userId?.trim()) {
    throw new ForbiddenException("A named person is required to name a delivery's item. Nothing was booked.");
  }

  // WHO: an owner or a manager, read strictly.
  let may: boolean;
  try {
    may = await deps.isOwnerOrManager(input.userId, input.restaurantId);
  } catch (err: any) {
    throw new ForbiddenException(
      `Whether you are an owner or a manager here could not be read (${err?.message ?? String(err)}), so the item was not named and nothing was booked.`,
    );
  }
  if (!may) {
    throw new ForbiddenException(
      "Only an owner or a manager names a delivery's item. Nothing was booked; ask one of them.",
    );
  }

  // THE ASK, by the order's id and the house.
  const { data: askData, error: askError } = await client
    .from("delivery_item_to_name")
    .select(DELIVERY_ITEM_TO_NAME_COLUMNS)
    .eq("restaurant_id", input.restaurantId)
    .eq("order_id", input.orderId)
    .maybeSingle();
  if (askError) {
    throw new InternalServerErrorException(
      `Whether this delivery waits for its item could not be read (${askError.message}). Nothing was booked.`,
    );
  }
  if (!askData) {
    throw new NotFoundException("This delivery is not waiting for its item to be named in this house. Nothing was booked.");
  }
  const ask = askData as DeliveryItemToNameRow;
  // A stale ask says WHY, instead of the generic "already named" 409 that
  // used to cover it silently (founder, 2026-09-22, round 6z, verbatim pick
  // 2: "Close by itself (Recommended)").
  if (ask.status === "booked_elsewhere") {
    throw new ConflictException({
      reason: "delivery_item_booked_elsewhere",
      orderId: input.orderId,
      closedAt: ask.closed_at,
      message: `${ask.closed_reason ?? "This order's stock was booked elsewhere before its item was named."} Nothing was booked.`,
    });
  }
  if (ask.status !== "open") {
    throw new ConflictException({
      reason: "delivery_item_already_named",
      orderId: input.orderId,
      namedAt: ask.named_at,
      bottlesBooked: ask.bottles_booked,
      message: `This delivery's item was already named${ask.named_at ? ` on ${ask.named_at}` : ""}, and ${ask.bottles_booked ?? "its"} bottles were booked then. Nothing was booked twice.`,
    });
  }

  // HOW MANY. What the delivery resolved to stands; a zero-bottle delivery
  // must say its count.
  let bottles: number;
  if (ask.bottles_resolved > 0) {
    if (input.bottles != null && input.bottles !== ask.bottles_resolved) {
      throw new BadRequestException(
        `This delivery resolved to ${ask.bottles_resolved} bottles; ${input.bottles} is not that number. Nothing was booked. Name the item without a count, or record the difference at verification.`,
      );
    }
    bottles = ask.bottles_resolved;
  } else {
    if (input.bottles == null) {
      throw new BadRequestException(
        "This delivery resolved to no bottles, so say how many bottles came in. Nothing was booked.",
      );
    }
    bottles = input.bottles;
  }
  if (!Number.isSafeInteger(bottles) || bottles < 1 || bottles > NAMED_BOTTLES_MAX) {
    throw new BadRequestException(
      `The bottles to book must be a whole number from 1 to ${NAMED_BOTTLES_MAX}; got ${String(bottles)}. Nothing was booked.`,
    );
  }

  // THE ORDER, by id and house: delivered, and naming the item it can.
  const { data: orderData, error: orderError } = await client
    .from("procurement_orders")
    .select("id, status, inventory_id, order_number")
    .eq("restaurant_id", input.restaurantId)
    .eq("id", input.orderId)
    .maybeSingle();
  if (orderError) {
    throw new InternalServerErrorException(`The order could not be read (${orderError.message}). Nothing was booked.`);
  }
  if (!orderData) throw new NotFoundException("No such order in this house. Nothing was booked.");
  const order = orderData as { id: string; status: string; inventory_id: string | null; order_number: string | null };
  if (!ARRIVED.has(String(order.status))) {
    throw new ConflictException(
      `This order reads "${String(order.status)}", not delivered, so its stock is not booked by naming. Nothing was booked.`,
    );
  }
  if (order.inventory_id && order.inventory_id !== input.inventoryId) {
    throw new BadRequestException(
      "This order is for another item. Name the order's own item, or correct the order first. Nothing was booked.",
    );
  }

  // THE ITEM, by id and house.
  const { data: itemData, error: itemError } = await client
    .from("restaurant_inventory")
    .select("id, shadow_stock, in_transit_quantity")
    .eq("restaurant_id", input.restaurantId)
    .eq("id", input.inventoryId)
    .maybeSingle();
  if (itemError) {
    throw new InternalServerErrorException(`The item could not be read (${itemError.message}). Nothing was booked.`);
  }
  if (!itemData) {
    throw new UnprocessableEntityException("That item is not an item of this house. Nothing was booked.");
  }
  const item = itemData as { shadow_stock?: number | null; in_transit_quantity?: number | null };

  // NOT BOOKED BY ANYTHING ELSE SINCE, read from the ledger (ADR 0192: what
  // an order received IS the ledger): the canonical door (ADR 0103 A5), the
  // door's case count (`door-receipt:` keys, which carry no delivery id) and
  // any earlier booking of this order. A failed read of either refuses.
  const door = await deliveryHasBookedOrder(client, input.orderId);
  if (!door.ok) {
    throw new InternalServerErrorException(`${door.error} The item was not named.`);
  }
  if (door.value.booked) {
    // The proactive close (receiving.service.ts, delivery-stock.service.ts)
    // should already have closed this ask the moment the door booked it; this
    // is the fallback for whatever race gets here first, so the ask never
    // stays `open` after this read reports it stale.
    await closeDeliveryItemToNameBookedElsewhere(client, {
      restaurantId: input.restaurantId,
      orderId: input.orderId,
      via: "receiving_door",
    });
    throw new ConflictException({
      reason: "delivery_item_booked_elsewhere",
      orderId: input.orderId,
      message:
        "The receiving door has booked this order's stock since it was delivered, so naming it would book the same bottles twice. Nothing was booked.",
    });
  }
  const { data: earlier, error: earlierError } = await client
    .from("inventory_transactions")
    .select("id, quantity_change, idempotency_key")
    .eq("restaurant_id", input.restaurantId)
    .eq("order_id", input.orderId)
    .eq("stock_type", "live")
    .limit(1);
  if (earlierError) {
    throw new InternalServerErrorException(
      `Whether this order's stock was booked before could not be read (${earlierError.message}). Nothing was booked.`,
    );
  }
  if (Array.isArray(earlier) && earlier.length > 0) {
    // Same fallback close as the door.value.booked branch above, for the
    // rows that check does not see: the door's own case count (`door-receipt:`
    // keys carry no delivery id) and a verification correction
    // (`receipt-verify:`). Best-effort on WHICH one, from the key it booked
    // under; either way the ask stops being listed as open.
    const bookedKey = String((earlier[0] as { idempotency_key?: string })?.idempotency_key ?? "");
    await closeDeliveryItemToNameBookedElsewhere(client, {
      restaurantId: input.restaurantId,
      orderId: input.orderId,
      via: bookedKey.startsWith("receipt-verify:") ? "verification" : "receiving_door",
    });
    throw new ConflictException({
      reason: "delivery_item_booked_elsewhere",
      orderId: input.orderId,
      message:
        "This order's stock was booked since it was delivered (at the door, at its verification, or by an earlier delivery). Nothing was booked twice.",
    });
  }

  // ONCE: open -> named, conditional on open. A second naming matches nothing.
  const namedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await client
    .from("delivery_item_to_name")
    .update({
      status: "named",
      named_by: input.userId,
      named_at: namedAt,
      named_inventory_id: input.inventoryId,
      bottles_booked: bottles,
    })
    .eq("id", ask.id)
    .eq("restaurant_id", input.restaurantId)
    .eq("status", "open")
    .select("id");
  if (claimError) {
    throw new InternalServerErrorException(`The item could not be named (${claimError.message}). Nothing was booked.`);
  }
  if (!Array.isArray(claimed) || claimed.length === 0) {
    throw new ConflictException(
      "Someone named this delivery's item a moment ago. Nothing was booked twice; the list shows what they named.",
    );
  }

  const putBackAsk = async (why: string) => {
    const { data: reopened, error: reopenError } = await client
      .from("delivery_item_to_name")
      .update({ status: "open", named_by: null, named_at: null, named_inventory_id: null, bottles_booked: null })
      .eq("id", ask.id)
      .eq("status", "named")
      .eq("named_at", namedAt)
      .eq("named_by", input.userId)
      .select("id");
    const back = !reopenError && Array.isArray(reopened) && reopened.length > 0;
    if (!back) {
      logger.error(
        `nameDeliveredItem: order ${input.orderId}'s booking failed (${why}) and its ask could not be reopened (${reopenError?.message ?? "no row matched this call's write"}).`,
      );
    }
    return back;
  };

  // The order now names the item it lacked (a no-item order only).
  let linkedOrder = false;
  if (!order.inventory_id) {
    const { data: linked, error: linkError } = await client
      .from("procurement_orders")
      .update({ inventory_id: input.inventoryId })
      .eq("restaurant_id", input.restaurantId)
      .eq("id", input.orderId)
      .is("inventory_id", null)
      .select("id");
    if (linkError || !Array.isArray(linked) || linked.length === 0) {
      const why = linkError?.message ?? "the order names an item now";
      const reopened = await putBackAsk(why);
      throw new ConflictException(
        `The order could not be linked to that item (${why}). Nothing was booked${reopened ? "; the delivery still waits for its item" : ""}.`,
      );
    }
    linkedOrder = true;
  }

  // THE BOOKING, under the key markDelivered books under.
  let bookingError: string | null = null;
  try {
    const shadowRelease = Math.min(bottles, Number(item.shadow_stock ?? 0) || 0);
    if (shadowRelease > 0) {
      const shadow = await client.rpc("apply_stock_movement", {
        p_inventory_id: input.inventoryId,
        p_stock_state: "shadow",
        p_delta: -shadowRelease,
        p_transaction_type: "adjustment",
        p_source: "order",
        p_reason: "shadow released when the delivery's item was named",
        p_order_id: input.orderId,
        p_idempotency_key: `order-delivered-shadow:${input.orderId}`,
        p_restaurant_id: input.restaurantId,
      });
      if (shadow?.error) {
        logger.warn(
          `nameDeliveredItem: order ${input.orderId}'s reserved (shadow) stock was not released (${shadow.error.message ?? String(shadow.error)})`,
        );
      }
    }
    const live = await client.rpc("apply_stock_movement", {
      p_inventory_id: input.inventoryId,
      p_stock_state: "live",
      p_delta: bottles,
      p_transaction_type: "purchase",
      p_source: "order",
      p_performed_by: input.userId,
      p_reason: "delivery's item named by an owner or a manager — physical receipt",
      // No unit cost: nobody has read an invoice here; the lot lands estimated
      // and verification settles it (as the door does).
      p_order_id: input.orderId,
      p_idempotency_key: `order-delivered-live:${input.orderId}`,
      p_restaurant_id: input.restaurantId,
    });
    if (live?.error) bookingError = live.error.message ?? String(live.error);
  } catch (err: any) {
    bookingError = err?.message ?? String(err);
  }
  if (bookingError) {
    const reopened = await putBackAsk(bookingError);
    if (linkedOrder) {
      const { error: unlinkError } = await client
        .from("procurement_orders")
        .update({ inventory_id: null })
        .eq("restaurant_id", input.restaurantId)
        .eq("id", input.orderId)
        .eq("inventory_id", input.inventoryId);
      if (unlinkError) {
        logger.error(`nameDeliveredItem: order ${input.orderId} stays linked to ${input.inventoryId} after a failed booking (${unlinkError.message}).`);
      }
    }
    throw new UnprocessableEntityException({
      reason: "delivery_item_not_booked",
      orderId: input.orderId,
      reopened,
      message: `The stock was not booked (${bookingError}).${reopened ? " The delivery still waits for its item; name it again once this is fixed." : " The ask could not be reopened; tell an administrator."}`,
    });
  }

  // After the booking, never undoing it: the display counter, the event, the
  // audit row, research. Each failure is said or logged, not swallowed.
  const inTransit = Number(item.in_transit_quantity ?? 0) || 0;
  if (inTransit > 0) {
    const { error: inTransitError } = await client
      .from("restaurant_inventory")
      .update({ in_transit_quantity: Math.max(0, inTransit - bottles) })
      .eq("restaurant_id", input.restaurantId)
      .eq("id", input.inventoryId);
    if (inTransitError) {
      logger.warn(`nameDeliveredItem: order ${input.orderId} booked, but the in-transit counter was not lowered (${inTransitError.message})`);
    }
  }
  const { error: eventError } = await client.from("inventory_events").insert({
    restaurant_id: input.restaurantId,
    inventory_id: input.inventoryId,
    event_type: "order_delivered",
    quantity_change: bottles,
    source: "procurement",
    idempotency_key: `order-delivered:${input.orderId}`,
    metadata: { orderId: input.orderId, namedBy: input.userId, via: "delivery_item_to_name" },
  });
  if (eventError) {
    logger.warn(`nameDeliveredItem: order ${input.orderId} booked, but its order_delivered event was not written (${eventError.message})`);
  }

  const sentence = `The delivery's item was named and ${bottles} bottles were booked.`;
  let audited = false;
  try {
    const { error: auditError } = await client.from("system_audit_log").insert({
      actor_type: "user",
      actor_id: input.userId,
      action: "delivery_item_named",
      entity_type: "procurement_order",
      entity_id: input.orderId,
      changes: {
        register: "deliveries",
        subject: input.orderId,
        why: ask.why,
        inventoryId: input.inventoryId,
        bottles,
        linkedOrder,
        askId: ask.id,
      },
      restaurant_id: input.restaurantId,
      reason: sentence,
    });
    if (auditError) {
      logger.error(`delivery_item_named happened but the audit row failed to write: ${auditError.message}`);
    } else {
      audited = true;
    }
  } catch (err: any) {
    logger.error(`delivery_item_named happened but the audit row failed to write: ${err?.message ?? String(err)}`);
  }

  const research = await queueResearchIfLibraryLacks(client, {
    restaurantId: input.restaurantId,
    inventoryId: input.inventoryId,
    queuedFrom: "delivery",
    sourceOrderId: input.orderId,
    queuedBy: input.userId,
  });
  if (research && !research.ok) {
    logger.error(`nameDeliveredItem: order ${input.orderId} booked, but its item was not queued for research: ${research.error}`);
  }

  const researchSays =
    research === null
      ? ""
      : !research.ok
        ? ` Whether this wine needs research could not be recorded: ${research.error}.`
        : research.status === "queued"
          ? " This wine is not in the wine library yet, so it is queued for research."
          : research.status === "not_findable"
            ? " Its name does not say which wine it is, so it was not sent for research; name it on Inventory."
            : "";
  const auditSays = audited ? "" : " The naming is on the delivery's record, but the audit log row could not be written.";

  return {
    orderId: input.orderId,
    inventoryId: input.inventoryId,
    bottlesBooked: bottles,
    audited,
    research,
    says: `${sentence}${researchSays}${auditSays}`,
  };
}
