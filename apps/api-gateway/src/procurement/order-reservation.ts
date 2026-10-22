import { Logger } from "@nestjs/common";

/**
 * LETTING GO OF AN ORDER'S RESERVATION AT THE DOOR (F-143).
 *
 * Approving an order reserves its quantity as shadow stock
 * (`procurement.service.ts` approveOrder → reserveOrderShadowStock). A door
 * receipt then books the accepted bottles as live stock — and, until this
 * file, never let go of the reservation. On hand is live + shadow, so every
 * door-received delivery counted twice (Tuzlu Rüzgar, 2026-10-02: 549
 * reservations totalling 1,899, zero releases).
 *
 * The founder's ruling (2026-10-02, verbatim pick "At the door
 * (Recommended)"): when the door receipt is signed, the accepted share is let
 * go; anything short stays reserved as a backorder. The key
 * `order-delivered-shadow:${orderId}` is reused so one delivery can never
 * release twice. The remainder is let go when the order closes
 * ([RECEIPTS-W58], "When the order closes (Recommended)") — a later change.
 *
 * HOW MUCH. The release converges on a TARGET rather than adding a delta:
 *
 *   target = min(reserved, floor(reserved × booked / bottles_total))
 *
 * `reserved` is what approval reserved FOR THIS ORDER, `booked` is the live
 * bottles the ledger holds for it. A reservation made in the order's own unit
 * (approval reserves `quantity`, so a case counts as one) therefore releases
 * its accepted share, and one made in bottles releases the bottles booked.
 * Each call releases `target − already released`, so a retry, a second truck
 * and a correction all land on the same number; a downward correction never
 * re-reserves.
 *
 * WHICH KEY. The first release for an order is keyed exactly
 * `order-delivered-shadow:${orderId}` — the key markDelivered and the
 * item-naming path use — so whichever of them lands first is the only first
 * release. Later releases are `…:${n}`, numbered by the releases already in
 * the ledger. Two callers reading the same ledger share a number, so at most
 * one of them moves stock (`uq_inventory_transactions_idem`); the other
 * re-reads and recomputes. A collision can under-release, never over-release.
 *
 * WHAT IT NEVER DOES. It never throws: the caller has already booked live
 * stock, and a failure here is returned as `issue` and logged (ADR 0067 —
 * absence is not health). It never releases for a cancelled order (the cancel
 * already released, without an order id), and never on an answer it could
 * not read.
 */

export interface ReservationRelease {
  /** Shadow units this call let go. */
  released: number;
  /** What the order's releases add up to once this call is done; null when unknown. */
  target: number | null;
  /** Set when something stopped the release. Logged as well. */
  issue?: string;
}

interface OrderRow {
  id: string;
  inventory_id: string | null;
  quantity: number | null;
  unit_type: string | null;
  bottles_total: number | null;
  approved_at: string | null;
  cancelled_at: string | null;
  cancel_reason_code: string | null;
  status: string | null;
}

interface LedgerRow {
  id: string;
  quantity_change: number | null;
  order_id: string | null;
  stock_type: string | null;
  transaction_type: string | null;
  source: string | null;
  transaction_date: string | null;
  delivery_id: string | null;
}

/** Approval's reservation lands this long after `approved_at` at most (Tuzlu: 0.06–0.59 s). */
export const LEGACY_RESERVE_WINDOW_MS = { before: 2_000, after: 10_000 } as const;
/** Units where quantity × pack size is the bottle count (order-units.ts). */
const MULTIPLYING = new Set(["case", "pack", "split_case"]);
const ATTEMPTS = 3;
const PAGE = 500;

const LEDGER_COLUMNS =
  "id, quantity_change, order_id, stock_type, transaction_type, source, transaction_date, delivery_id";

const logger = new Logger("OrderReservation");

export function firstReleaseKey(orderId: string): string {
  return `order-delivered-shadow:${orderId}`;
}

/** The key for the release that follows `priorReleases` releases already in the ledger. */
export function releaseKey(orderId: string, priorReleases: number): string {
  return priorReleases === 0
    ? firstReleaseKey(orderId)
    : `${firstReleaseKey(orderId)}:${priorReleases + 1}`;
}

/**
 * Let go of the accepted share of an order's reservation. Never throws.
 */
export async function releaseAcceptedShare(
  client: any,
  input: { restaurantId: string; orderId: string; via: string },
): Promise<ReservationRelease> {
  try {
    return await release(client, input);
  } catch (e: any) {
    return said(input, null, `the reservation could not be let go (${e?.message ?? String(e)})`);
  }
}

async function release(
  client: any,
  input: { restaurantId: string; orderId: string; via: string },
): Promise<ReservationRelease> {
  const { restaurantId, orderId } = input;
  const read = await client
    .from("procurement_orders")
    .select(
      "id, inventory_id, quantity, unit_type, bottles_total, approved_at, cancelled_at, cancel_reason_code, status",
    )
    .eq("restaurant_id", restaurantId)
    .eq("id", orderId)
    .maybeSingle();
  if (read?.error) return said(input, null, `the order could not be read (${read.error.message})`);
  const order = read?.data as OrderRow | null;
  if (!order || !order.inventory_id) return { released: 0, target: 0 };
  // A cancel already let go of the reservation — without an order id, so the
  // ledger cannot show it. Releasing again would take another order's stock.
  if (
    order.status === "CANCELLED" ||
    order.status === "REJECTED" ||
    order.cancelled_at ||
    order.cancel_reason_code
  )
    return { released: 0, target: 0 };
  const inventoryId = order.inventory_id;

  const reserved = await reservedFor(client, restaurantId, order);
  if (!reserved.ok) return said(input, null, reserved.issue);
  if (reserved.value === 0) return { released: 0, target: 0 };

  const expected = Number(order.bottles_total ?? 0);
  const quantity = Number(order.quantity ?? 0);
  const unit = String(order.unit_type ?? "").toLowerCase();
  // Before createOrder multiplied by the pack size, bottles_total was written
  // equal to quantity, so a case order's bottle figure cannot be trusted. Its
  // share is unknowable here; the order closing lets go of all of it.
  if (MULTIPLYING.has(unit) && expected <= quantity)
    return said(
      input,
      null,
      `this ${unit} order states ${expected} bottles for ${quantity} ${unit}s, so the accepted share of its reservation cannot be worked out; it is let go when the order closes`,
    );
  if (!(expected > 0))
    return said(input, null, `the order states ${expected} bottles, so no share of its reservation can be worked out`);

  let released = 0;
  let target: number | null = null;
  let reached = false;
  let issue: string | undefined;
  for (let attempt = 1; attempt <= ATTEMPTS && !reached && !issue; attempt++) {
    const ledger = await ordersLedger(client, restaurantId, orderId, inventoryId);
    if (!ledger.ok) {
      issue = ledger.issue;
      break;
    }
    const { releasedSoFar, priorReleases, booked } = ledger.value;
    target = Math.min(reserved.value, Math.floor((reserved.value * booked) / expected));
    let want = target - releasedSoFar;
    if (want <= 0) {
      reached = true;
      break;
    }

    const item = await client
      .from("restaurant_inventory")
      .select("shadow_stock, in_transit_quantity")
      .eq("restaurant_id", restaurantId)
      .eq("id", inventoryId)
      .maybeSingle();
    if (item?.error) {
      issue = `the item's reserved count could not be read (${item.error.message})`;
      break;
    }
    const shadow = Number(item?.data?.shadow_stock ?? 0) || 0;
    want = Math.min(want, shadow);
    if (want <= 0) {
      issue = `the item holds no reserved stock to let go, though this order's share says ${target - releasedSoFar} more`;
      break;
    }

    const rpc = await client.rpc("apply_stock_movement", {
      p_inventory_id: inventoryId,
      p_stock_state: "shadow",
      p_delta: -want,
      p_transaction_type: "adjustment",
      p_source: "order",
      p_reason: `accepted share of the order's reservation let go (${input.via})`,
      p_order_id: orderId,
      p_idempotency_key: releaseKey(orderId, priorReleases),
      p_restaurant_id: restaurantId,
    });
    if (rpc?.error) {
      const text = String(rpc.error.message ?? rpc.error);
      // Another caller took this key, or the stock moved under us: re-read.
      if (rpc.error.code === "23505" || /would go negative/.test(text)) continue;
      issue = `the reservation could not be let go (${text})`;
      break;
    }
    // The key may already have been used by a caller that read the same
    // ledger; then nothing moved. Only the ledger can say which.
    const after = await ordersLedger(client, restaurantId, orderId, inventoryId);
    if (!after.ok) {
      issue = after.issue;
      break;
    }
    released += Math.max(0, after.value.releasedSoFar - releasedSoFar);
    reached = after.value.releasedSoFar >= target;
  }

  if (released > 0) await clampInTransit(client, restaurantId, inventoryId);
  if (!issue && !reached)
    issue = `the order's share of its reservation (${target ?? "unknown"}) was not reached after ${ATTEMPTS} tries`;
  return issue ? said(input, target, issue, released) : { released, target };
}

type Read<T> = { ok: true; value: T } | { ok: false; issue: string };

/**
 * What approval reserved for this order.
 *
 * A reservation carrying the order's id is read as it stands. Approval has
 * never passed one (reserveOrderShadowStock sends no p_order_id), so for every
 * order approved so far the reservation is found by WHEN it was made: approval
 * writes `approved_at`, then reserves, within a second. It is attributed only
 * when exactly one such row exists and no other order on the item could own
 * it; anything else reserves nothing here and is let go at close.
 */
async function reservedFor(
  client: any,
  restaurantId: string,
  order: OrderRow,
): Promise<Read<number>> {
  const own = await pages(client, (q: any) =>
    q
      .from("inventory_transactions")
      .select(LEDGER_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .eq("inventory_id", order.inventory_id)
      .eq("order_id", order.id)
      .eq("stock_type", "shadow"),
  );
  if (!own.ok) return own;
  const forward = own.value
    .map((r) => Number(r.quantity_change))
    .filter((q) => q > 0)
    .reduce((a, b) => a + b, 0);
  if (forward > 0) return { ok: true, value: forward };

  if (!order.approved_at) return { ok: true, value: 0 };
  const at = Date.parse(order.approved_at);
  if (!Number.isFinite(at)) return { ok: true, value: 0 };
  const from = new Date(at - LEGACY_RESERVE_WINDOW_MS.before).toISOString();
  const to = new Date(at + LEGACY_RESERVE_WINDOW_MS.after).toISOString();

  const near = await client
    .from("inventory_transactions")
    .select(LEDGER_COLUMNS)
    .eq("restaurant_id", restaurantId)
    .eq("inventory_id", order.inventory_id)
    .eq("stock_type", "shadow")
    .is("order_id", null)
    .gte("transaction_date", from)
    .lte("transaction_date", to)
    .range(0, PAGE - 1);
  if (near?.error)
    return { ok: false, issue: `the order's reservation could not be read (${near.error.message})` };
  const candidates = ((near?.data ?? []) as LedgerRow[]).filter(
    (r) =>
      Number(r.quantity_change) > 0 &&
      r.transaction_type === "purchase" &&
      r.source === "order",
  );
  if (candidates.length === 0) return { ok: true, value: 0 };

  // Other orders on this item approved close enough to own any candidate.
  const span = LEGACY_RESERVE_WINDOW_MS.before + LEGACY_RESERVE_WINDOW_MS.after;
  const others = await client
    .from("procurement_orders")
    .select("id, approved_at")
    .eq("restaurant_id", restaurantId)
    .eq("inventory_id", order.inventory_id)
    .neq("id", order.id)
    .gte("approved_at", new Date(at - span).toISOString())
    .lte("approved_at", new Date(at + span).toISOString())
    .range(0, PAGE - 1);
  if (others?.error)
    return { ok: false, issue: `the orders sharing this item could not be read (${others.error.message})` };
  const windows = ((others?.data ?? []) as Array<{ approved_at: string | null }>)
    .map((o) => Date.parse(String(o.approved_at)))
    .filter((t) => Number.isFinite(t));
  const mine = candidates.filter((r) => {
    const t = Date.parse(String(r.transaction_date));
    return !windows.some(
      (w) => t >= w - LEGACY_RESERVE_WINDOW_MS.before && t <= w + LEGACY_RESERVE_WINDOW_MS.after,
    );
  });
  if (mine.length === 1) return { ok: true, value: Number(mine[0].quantity_change) };
  if (mine.length === 0 && candidates.length > 0)
    return {
      ok: false,
      issue: `another order on this item was approved within seconds of this one, so which reservation is this order's cannot be told; it is let go when the order closes`,
    };
  return {
    ok: false,
    issue: `${mine.length} reservations were made when this order was approved, so which is its own cannot be told; it is let go when the order closes`,
  };
}

/**
 * The order's own ledger on its item: what it has let go, how many times, and
 * what it has booked live. Booked is the larger of the delivery model's rows
 * and everything else's — the two are meant to be exclusive (ADR 0103 A5), and
 * when both booked one truck, summing them would let the whole reservation go.
 */
async function ordersLedger(
  client: any,
  restaurantId: string,
  orderId: string,
  inventoryId: string,
): Promise<Read<{ releasedSoFar: number; priorReleases: number; booked: number }>> {
  const rows = await pages(client, (q: any) =>
    q
      .from("inventory_transactions")
      .select(LEDGER_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .eq("inventory_id", inventoryId)
      .eq("order_id", orderId),
  );
  if (!rows.ok) return rows;
  let releasedSoFar = 0;
  let priorReleases = 0;
  let deliveryBooked = 0;
  let otherBooked = 0;
  for (const r of rows.value) {
    const q = Number(r.quantity_change);
    if (r.quantity_change == null || !Number.isSafeInteger(q))
      return { ok: false, issue: "the order's ledger holds an unreadable quantity" };
    if (r.stock_type === "shadow" && q < 0) {
      releasedSoFar += -q;
      priorReleases += 1;
    } else if (r.stock_type === "live") {
      if (r.delivery_id) deliveryBooked += q;
      else otherBooked += q;
    }
  }
  return {
    ok: true,
    value: {
      releasedSoFar,
      priorReleases,
      booked: Math.max(0, Math.max(deliveryBooked, otherBooked)),
    },
  };
}

async function pages(client: any, query: (c: any) => any): Promise<Read<LedgerRow[]>> {
  const out: LedgerRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await query(client).order("id", { ascending: true }).range(offset, offset + PAGE - 1);
    if (res?.error || !Array.isArray(res?.data))
      return { ok: false, issue: `the order's ledger could not be read (${res?.error?.message ?? "no rows came back"})` };
    out.push(...(res.data as LedgerRow[]));
    if (res.data.length < PAGE) return { ok: true, value: out };
  }
}

/**
 * `in_transit_quantity` is a display counter that rose with the reservation.
 * It is brought down to what is still reserved rather than decremented, so a
 * replay that moved nothing cannot take it down twice.
 */
async function clampInTransit(client: any, restaurantId: string, inventoryId: string) {
  const item = await client
    .from("restaurant_inventory")
    .select("shadow_stock, in_transit_quantity")
    .eq("restaurant_id", restaurantId)
    .eq("id", inventoryId)
    .maybeSingle();
  if (item?.error || !item?.data) return;
  const shadow = Math.max(0, Number(item.data.shadow_stock ?? 0) || 0);
  const inTransit = Number(item.data.in_transit_quantity ?? 0) || 0;
  if (inTransit <= shadow) return;
  const { error } = await client
    .from("restaurant_inventory")
    .update({ in_transit_quantity: shadow })
    .eq("restaurant_id", restaurantId)
    .eq("id", inventoryId);
  if (error)
    logger.warn(`item ${inventoryId}'s in-transit count was not brought down to ${shadow} (${error.message})`);
}

function said(
  input: { orderId: string; via: string },
  target: number | null,
  issue: string,
  released = 0,
): ReservationRelease {
  logger.warn(`order ${input.orderId} (${input.via}): ${issue}`);
  return { released, target, issue };
}
