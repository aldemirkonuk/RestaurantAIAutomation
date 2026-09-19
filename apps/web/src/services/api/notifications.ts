import { apiClient, getActiveRestaurantId } from "./client";
import type { NotificationFilters } from "../../lib/query-keys";

export type NotificationType =
  | "inventory_low_stock"
  | "order_pending"
  | "order_delivered"
  | "price_change"
  | "delivery_scheduled"
  | "calendar_reminder"
  | "payment_due"
  | "report"
  | "system"
  | "ai_suggestion"
  | "draft_ready"
  | "constraint_triggered"
  | "unknown_sender"
  | "invoice_received";

export interface Notification {
  id: string;
  userId: string;
  restaurantId: string;
  type: NotificationType;
  title: string;
  message: string;
  status: "read" | "unread";
  priority: "low" | "medium" | "high" | "critical";
  actionUrl?: string;
  actionLabel?: string;
  metadata?: Record<string, any>;
  timestamp: string;
  readAt?: string;
  createdAt: string;
}

export interface NotificationPreferences {
  userId: string;
  email: boolean;
  push: boolean;
  sms: boolean;
  categories: {
    inventory: boolean;
    orders: boolean;
    calendar: boolean;
    system: boolean;
    ai: boolean;
  };
  quietHours?: {
    enabled: boolean;
    startTime: string; // HH:mm format
    endTime: string;
  };
  lowStock?: {
    enabled: boolean;
    instantFirstAlert: boolean;
    criticalImmediate: boolean;
    digestFrequency: "daily" | "off";
    digestTime: string; // HH:mm format
  };
  ordersMode?: "both" | "in_app" | "off";
  reportsMode?: "both" | "in_app" | "off";
  updatedAt?: string;
}

export interface CreateNotificationInput {
  userId: string;
  restaurantId: string;
  type: NotificationType;
  title: string;
  message: string;
  priority?: "low" | "medium" | "high" | "critical";
  actionUrl?: string;
  actionLabel?: string;
  metadata?: Record<string, any>;
}

/**
 * Fetch notifications for a user
 */
export async function fetchNotifications(
  userId: string,
  filters?: NotificationFilters,
): Promise<Notification[]> {
  const params = new URLSearchParams();
  params.append("userId", userId);
  // The gateway scopes this read from the JWT's restaurantId and IGNORES any
  // restaurant sent here — a query parameter is not a tenant boundary. Sending
  // it anyway keeps the request self-describing in logs and network traces,
  // where the absence of a restaurant is what made the Antalya bleed look like
  // correct behaviour: one owner, two venues, one undifferentiated pile of 20.
  const activeRestaurantId = getActiveRestaurantId();
  if (activeRestaurantId) {
    params.append("restaurantId", activeRestaurantId);
  }

  if (filters?.type) {
    params.append("type", filters.type);
  }
  if (filters?.status) {
    params.append("status", filters.status);
  }
  if (filters?.dateFrom) {
    params.append("dateFrom", filters.dateFrom);
  }
  if (filters?.dateTo) {
    params.append("dateTo", filters.dateTo);
  }

  const response = await apiClient.get<
    | Notification[]
    | {
        data?: Notification[];
        notifications?: Notification[];
        items?: Notification[];
      }
  >(`/notifications?${params.toString()}`);
  const raw = response.data;
  if (Array.isArray(raw)) return raw;
  return (
    (raw as any)?.data ??
    (raw as any)?.notifications ??
    (raw as any)?.items ??
    []
  );
}

/**
 * Fetch unread notifications for a user
 */
export async function fetchUnreadNotifications(
  userId: string,
): Promise<Notification[]> {
  const response = await apiClient.get<Notification[]>(
    `/notifications/unread?userId=${userId}`,
  );
  return response.data;
}

/**
 * Get unread notification count
 */
export async function fetchUnreadCount(userId: string): Promise<number> {
  const response = await apiClient.get<{ count: number }>(
    `/notifications/unread/count?userId=${userId}`,
  );
  return response.data.count;
}

/**
 * Mark a notification as read
 */
export async function markNotificationAsRead(
  id: string,
): Promise<Notification> {
  const response = await apiClient.patch<Notification>(
    `/notifications/${id}/read`,
  );
  return response.data;
}

/**
 * Mark a notification back to unread (NEW-474)
 */
export async function markNotificationAsUnread(
  id: string,
): Promise<Notification> {
  const response = await apiClient.patch<Notification>(
    `/notifications/${id}/unread`,
  );
  return response.data;
}

/**
 * Mark multiple notifications as read
 */
export async function markNotificationsAsRead(ids: string[]): Promise<void> {
  await apiClient.patch("/notifications/read/bulk", { ids });
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllNotificationsAsRead(
  userId: string,
): Promise<void> {
  await apiClient.patch(`/notifications/read/all?userId=${userId}`);
}

/**
 * Archive a notification
 */
export async function archiveNotification(id: string): Promise<Notification> {
  const response = await apiClient.patch<Notification>(
    `/notifications/${id}/archive`,
  );
  return response.data;
}

/**
 * Delete a notification
 */
export async function deleteNotification(id: string): Promise<void> {
  await apiClient.delete(`/notifications/${id}`);
}

/**
 * Delete multiple notifications
 */
export async function deleteNotifications(ids: string[]): Promise<void> {
  await apiClient.delete("/notifications/bulk", { data: { ids } });
}

/**
 * Delete all read notifications for a user
 */
export async function deleteAllReadNotifications(
  userId: string,
): Promise<void> {
  await apiClient.delete(`/notifications/read/all?userId=${userId}`);
}

/**
 * Fetch notification preferences for a user
 */
export async function fetchNotificationPreferences(
  userId: string,
): Promise<NotificationPreferences> {
  const response = await apiClient.get<NotificationPreferences>(
    `/notifications/preferences?userId=${userId}`,
  );
  return response.data;
}

/**
 * Update notification preferences
 */
export async function updateNotificationPreferences(
  userId: string,
  preferences: Partial<Omit<NotificationPreferences, "userId">>,
): Promise<NotificationPreferences> {
  const response = await apiClient.patch<NotificationPreferences>(
    `/notifications/preferences?userId=${userId}`,
    // userId must be in the body too: the API's UpdatePreferencesDto requires it
    // and the global ValidationPipe (forbidNonWhitelisted) rejects a missing one.
    { ...preferences, userId },
  );
  return response.data;
}

/**
 * Create a notification (typically used by system/backend)
 */
export async function createNotification(
  data: CreateNotificationInput,
): Promise<Notification> {
  const response = await apiClient.post<Notification>("/notifications", data);
  return response.data;
}

/**
 * Send a test notification
 */
export async function sendTestNotification(
  userId: string,
  channel: "email" | "push" | "sms",
): Promise<void> {
  await apiClient.post("/notifications/test", { userId, channel });
}

// ===========================================================================
// POST /notifications/send-email — the house writes to its own people
// ===========================================================================

export interface HouseEmailInput {
  to: string[];
  subject: string;
  body_html: string;
  body_text?: string;
  cc?: string[];
  bcc?: string[];
}

export interface HouseEmailReceipt {
  success: true;
  message_id: string | null;
  timestamp: string;
  recipients: { to: number; cc: number; bcc: number };
  audited: boolean;
}

/**
 * Send one email as the active house (ADR 0149 answer 15, 2026-09-16).
 *
 * The gateway sends only for an owner or a manager of the active house, and
 * only to the house's members and the contacts in its vendor book; anything
 * else is refused with a sentence naming why. Goes through `apiClient` so the
 * session token rides along — the three callers used bare `axios`, which
 * carried no token and so were answered 401 by the guarded route.
 *
 * Throws on any refusal or failure; read the reason with `houseEmailRefusal`.
 */
export async function sendHouseEmail(
  input: HouseEmailInput,
): Promise<HouseEmailReceipt> {
  const body: HouseEmailInput = {
    to: input.to,
    subject: input.subject,
    body_html: input.body_html,
  };
  if (input.body_text) body.body_text = input.body_text;
  if (input.cc && input.cc.length > 0) body.cc = input.cc;
  if (input.bcc && input.bcc.length > 0) body.bcc = input.bcc;
  const response = await apiClient.post<HouseEmailReceipt>(
    "/notifications/send-email",
    body,
  );
  return response.data;
}

/**
 * The gateway's own words for a refused or failed send, as one sentence.
 * A validation refusal carries a list of messages; they are joined. A request
 * that never reached the gateway says so rather than inventing a reason.
 */
export function houseEmailRefusal(error: unknown): string {
  const e = error as {
    response?: { status?: number; data?: { message?: unknown } };
    message?: unknown;
  };
  const words = e?.response?.data?.message;
  if (Array.isArray(words) && words.length > 0) {
    return (
      words.map((w) => String(w).trim().replace(/\.+$/, "")).join(". ") + "."
    );
  }
  if (typeof words === "string" && words.trim()) return words;
  if (e?.response?.status) {
    return `The email was not sent (the server answered ${e.response.status}).`;
  }
  return typeof e?.message === "string" && e.message
    ? `The email was not sent: ${e.message}`
    : "The email was not sent: the server could not be reached.";
}

/**
 * Get notification history (for analytics/debugging)
 */
export async function fetchNotificationHistory(
  userId: string,
  days: number = 30,
): Promise<Notification[]> {
  const response = await apiClient.get<Notification[]>(
    `/notifications/history?userId=${userId}&days=${days}`,
  );
  return response.data;
}

/**
 * Subscribe to push notifications
 */
export async function subscribeToPushNotifications(
  userId: string,
  subscription: PushSubscription,
): Promise<void> {
  await apiClient.post("/notifications/push/subscribe", {
    userId,
    subscription: subscription.toJSON(),
  });
}

/**
 * Unsubscribe from push notifications
 */
export async function unsubscribeFromPushNotifications(
  userId: string,
): Promise<void> {
  await apiClient.post("/notifications/push/unsubscribe", { userId });
}

// ===========================================================================
// Held low-stock crossings (POS lens, absence-as-health 8)
// ===========================================================================

/**
 * A wine that crossed below par and that nobody has been told about yet.
 *
 * The alert ledger used to stamp `last_alerted_at` before the cooldown and the
 * manager's preferences had decided whether anything would be sent, so a held
 * crossing and a crossing that never happened looked identical: 7 rows recorded
 * as alerted against 2 notifications covering 3 wines. "Tonight's digest will
 * cover it" and "nothing is wrong" are different facts.
 */
export interface HeldLowStockCrossing {
  inventory_id: string;
  wine_name: string | null;
  level: "low" | "critical" | string;
  held_at: string;
  /** `instant_cooldown` — another alert fired recently. `prefs` — the manager asked to batch these. */
  reason: "instant_cooldown" | "prefs" | null;
}

export interface HeldLowStockResponse {
  restaurant_id: string;
  held: HeldLowStockCrossing[];
  summary: { count: number; critical: number; oldest_held_at: string | null };
}

export async function fetchHeldLowStock(
  restaurantId: string,
): Promise<HeldLowStockResponse> {
  const { data } = await apiClient.get<HeldLowStockResponse>(
    `/notifications/low-stock/held/${restaurantId}`,
  );
  return data;
}
