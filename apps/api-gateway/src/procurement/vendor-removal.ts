import { SupabaseClient } from "@supabase/supabase-js";
import { ORDER_CLOSED_STATUSES } from "./order-status";

/**
 * WHAT HAPPENS TO A VENDOR'S ORDERS WHEN THE HOUSE REMOVES IT (QA 3b H3; r25).
 *
 * #1283 made a removed vendor take no new order. Its standing orders stayed
 * active, so each run was refused and logged as a failure, and nothing said
 * what became of its open orders. The session's calls (2026-11-07 /goal):
 *
 *   - Standing orders are PAUSED, not ended: both an order's own recurrence
 *     and a legacy `recurring_orders` schedule. A pause can be undone if the
 *     vendor comes back; an end cannot.
 *   - Open orders are KEPT and COUNTED, not cancelled. Cancelling is a sealed
 *     act with a reason (ADR 0207) and an order already placed may be on a
 *     truck, so they stay on /orders for a person to settle.
 *   - The answer says both in one sentence for the page that removed it.
 *
 * Runs after the removal and never throws: a step that fails is `null` and
 * the sentence says so. A series left active still places nothing, because
 * `createOrder` refuses a removed vendor (#1283).
 */

export interface VendorRemovalOutcome {
  /** Order recurrences moved active -> paused. `null`: the write failed. */
  standingOrdersPaused: number | null;
  /** Legacy `recurring_orders` schedules switched off. `null`: the write failed. */
  schedulesPaused: number | null;
  /** This vendor's orders not yet delivered or closed. `null`: the count failed. */
  openOrders: number | null;
  /** The whole outcome, in the house's words. */
  message: string;
}

type Logger = { error: (m: string, meta?: unknown) => void };

/** `RECURRENCE_ACTS.PAUSED` in order-recurrence.service.ts; a literal here so this file imports no service. */
export const RECURRENCE_PAUSED_ACT = "order_recurrence_paused";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function settleRemovedVendorsOrders(
  client: SupabaseClient,
  restaurantId: string,
  providerId: string,
  actorUserId: string | null | undefined,
  logger?: Logger,
): Promise<VendorRemovalOutcome> {
  const now = new Date().toISOString();

  let standingOrdersPaused: number | null = null;
  try {
    const { data, error } = await client
      .from("procurement_orders")
      .update({
        recurrence_status: "paused",
        // `recurrence_status_by` is a uuid FK to public.users; anything else is NULL.
        recurrence_status_by: by(actorUserId),
        recurrence_status_at: now,
      })
      .eq("restaurant_id", restaurantId)
      .eq("provider_id", providerId)
      .eq("recurrence_status", "active")
      .select("id");
    if (error) throw error;
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    standingOrdersPaused = ids.length;
    await fileVendorRemovedPauses(client, restaurantId, providerId, ids, by(actorUserId), logger);
  } catch (err: any) {
    logger?.error("A removed vendor's standing orders could not be paused", {
      restaurantId,
      providerId,
      error: err?.message ?? String(err),
    });
  }

  let schedulesPaused: number | null = null;
  try {
    const { data, error } = await client
      .from("recurring_orders")
      .update({ active: false, updated_at: now })
      .eq("restaurant_id", restaurantId)
      .eq("provider_id", providerId)
      .eq("active", true)
      .select("id");
    if (error) throw error;
    schedulesPaused = (data ?? []).length;
  } catch (err: any) {
    logger?.error("A removed vendor's recurring schedules could not be switched off", {
      restaurantId,
      providerId,
      error: err?.message ?? String(err),
    });
  }

  let openOrders: number | null = null;
  try {
    const { count, error } = await client
      .from("procurement_orders")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .eq("provider_id", providerId)
      .not("status", "in", `(${ORDER_CLOSED_STATUSES.join(",")})`);
    if (error) throw error;
    openOrders = count ?? 0;
  } catch (err: any) {
    logger?.error("A removed vendor's open orders could not be counted", {
      restaurantId,
      providerId,
      error: err?.message ?? String(err),
    });
  }

  return {
    standingOrdersPaused,
    schedulesPaused,
    openOrders,
    message: removalSentence(standingOrdersPaused, schedulesPaused, openOrders),
  };
}

function by(actorUserId: string | null | undefined): string | null {
  return actorUserId && UUID.test(actorUserId) ? actorUserId : null;
}

/**
 * One `system_audit_log` row per paused series, in the shape
 * `fileRecurrenceAudit` writes for a pause by hand. `actorUserId` null: no
 * person. A failed write is logged and does not undo the pause.
 */
export async function fileVendorRemovedPauses(
  client: SupabaseClient,
  restaurantId: string,
  providerId: string,
  orderIds: string[],
  actorUserId: string | null,
  logger?: Logger,
): Promise<void> {
  if (orderIds.length === 0) return;
  const rows = orderIds.map((orderId) => ({
    actor_type: actorUserId ? "user" : "system",
    actor_id: actorUserId,
    action: RECURRENCE_PAUSED_ACT,
    entity_type: "procurement_order",
    entity_id: orderId,
    changes: {
      register: "orders",
      subject: orderId,
      from: "active",
      to: "paused",
      act: RECURRENCE_PAUSED_ACT,
      sealed: false,
      detail: { cause: "vendor_removed", providerId },
    },
    restaurant_id: restaurantId,
    reason: "Recurrence active -> paused: the vendor was removed",
  }));
  try {
    const { error } = await client.from("system_audit_log").insert(rows);
    if (error) throw error;
  } catch (err: any) {
    logger?.error("Standing orders were paused but their audit rows failed to write", {
      restaurantId,
      orderIds,
      error: err?.message ?? String(err),
    });
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** The outcome in the house's words. Exported for the spec. */
export function removalSentence(
  standing: number | null,
  schedules: number | null,
  open: number | null,
): string {
  const parts: string[] = ["The vendor was removed. No new order can be placed with them."];

  if (standing === null || schedules === null) {
    parts.push(
      "Their standing orders could not all be paused just now; none of them can place an order with this vendor.",
    );
  } else if (standing + schedules > 0) {
    parts.push(
      `${plural(standing + schedules, "standing order was", "standing orders were")} paused.`,
    );
  }

  if (open === null) {
    parts.push("Their open orders could not be counted just now; they stay on Orders as they are.");
  } else if (open > 0) {
    parts.push(
      `${plural(open, "open order stays", "open orders stay")} on Orders. ` +
        "You can still write to them about an order already placed.",
    );
  }
  return parts.join(" ");
}
