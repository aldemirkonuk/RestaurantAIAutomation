/**
 * Floor pushes (ADR 0352). Only the existing device store
 * (`notification_push_devices`, through NotificationsService) — the floor adds
 * no subscription table. Web push only: Expo is a sub-question on OD-237's row.
 *
 * - The house is named in every push and its id is in the data: a device has
 *   no house and a person may hold several (ADR 0164).
 * - The STAFF copy carries the house, the table and state words only: no
 *   minutes, no names, no reasons ("Nothing for now").
 * - TTL is late_after_min × 60 s, urgency high, a 10 s send timeout; a timeout
 *   counts as not sent.
 * - "Sent" means the push service accepted it, never that someone saw it.
 */
import type { NotificationsService, WebPushReport } from "../notifications/notifications.service";

export const FLOOR_PUSH_TIMEOUT_MS = 10_000;

export type FloorPushWord = "Food up" | "Late" | "Needs a visit";

export interface FloorPushTarget {
  restaurantId: string;
  houseName: string | null;
  tableId: string;
  tableLabel: string;
  word: FloorPushWord;
  lateAfterMin: number;
  /** Manager copies may say more (who, why); staff copies never do. */
  managerDetail?: string | null;
}

export function staffCopy(t: FloorPushTarget) {
  const house = t.houseName?.trim() || "Your house";
  return {
    type: "floor_alert",
    title: house,
    body: `Table ${t.tableLabel} · ${t.word}`,
    data: { url: "/floor/me", restaurant_id: t.restaurantId, table_id: t.tableId },
    requireInteraction: true,
  };
}

export function managerCopy(t: FloorPushTarget) {
  const house = t.houseName?.trim() || "Your house";
  return {
    type: "floor_alert",
    title: `${house} · floor`,
    body: [`Table ${t.tableLabel} · ${t.word}`, t.managerDetail].filter(Boolean).join(" — "),
    data: { url: "/floor", restaurant_id: t.restaurantId, table_id: t.tableId },
    requireInteraction: true,
  };
}

export async function pushTo(
  notifications: NotificationsService,
  userId: string,
  payload: ReturnType<typeof staffCopy>,
  lateAfterMin: number,
): Promise<WebPushReport> {
  return notifications.sendWebPushReported(userId, payload, {
    ttlSeconds: Math.max(60, Math.round(lateAfterMin * 60)),
    urgency: "high",
    timeoutMs: FLOOR_PUSH_TIMEOUT_MS,
  });
}
