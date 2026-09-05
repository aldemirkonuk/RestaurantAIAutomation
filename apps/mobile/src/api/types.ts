/** Mirrors apps/api-gateway/src/mobile/dto/mobile.dto.ts. */

export type DecisionKind =
  | "order_approval"
  | "draft_approval"
  | "receipt_verification"
  | "alert";

export type FeedPriority = "low" | "medium" | "high" | "critical";

export interface FeedItem {
  id: string;
  kind: DecisionKind;
  title: string;
  subtitle: string;
  wineName: string | null;
  providerName: string | null;
  amount: number | null;
  quantity: number | null;
  priority: FeedPriority;
  score: number;
  createdAt: string;
  entityId: string;
  orderId: string | null;
  conversationId: string | null;
  notificationId: string | null;
  draftContent: string | null;
  meta: Record<string, any>;
}

export interface FeedResponse {
  items: FeedItem[];
  counts: {
    total: number;
    orderApprovals: number;
    draftApprovals: number;
    receiptVerifications: number;
    alerts: number;
  };
  generatedAt: string;
}

export interface TodayPulse {
  revenueToday: number | null;
  checksToday: number | null;
  revenueLastWeek: number | null;
  deltaPct: number | null;
  pendingDecisions: number;
  criticalCount: number;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
}

export interface InventoryItem {
  id: string;
  wine_name?: string;
  wineName?: string;
  producer?: string | null;
  vintage?: number | string | null;
  region?: string | null;
  varietal?: string | null;
  quantity?: number;
  minimum_stock?: number;
  unit_price?: number | null;
  wac?: number;
  costProvenance?: "invoice" | "estimated";
  lotLiveQty?: number;
  openMl?: number;
  // Phase 2d/2e analytics, embedded per item
  velocityPerDay?: number;
  daysOfCover?: number;
  reorderPoint?: number;
  reorderSuggested?: boolean;
  abcClass?: "A" | "B" | "C";
  deadStock?: boolean;
  daysSinceSale?: number;
  locations?: Array<{ locationId: string; locationName?: string; qty: number; wac?: number }>;
  [key: string]: any;
}

/**
 * One procurement order as `/procurement/orders/pending` and
 * `/procurement/orders/:id` send it — a subset of the gateway's
 * `OrderResponseDto` (`apps/api-gateway/src/procurement/dto/procurement.dto.ts`).
 *
 * NO INDEX SIGNATURE. It carried `[key: string]: any` until 2026-09-05, which
 * made every possible key legal: `order.totalPrice` — a name the route has
 * never sent — would have compiled here exactly as it did on the web, where it
 * printed "$0" over real money. `scripts/check_web_reads_gateway_dto_keys.py`
 * checks this type against the DTO and refuses an index signature, because a
 * type that declares everything cannot be checked against anything.
 *
 * It declares FEWER keys than the DTO on purpose; that direction is fine, and
 * the guard only fails a key the gateway does not send.
 */
export interface ProcurementOrder {
  id: string;
  orderNumber?: string;
  wineName?: string;
  providerId?: string;
  quantity?: number;
  unitType?: string;
  quotedPrice?: number;
  negotiatedPrice?: number;
  finalPrice?: number;
  totalCost?: number;
  status: string;
  requestedAt?: string;
  approvedAt?: string;
  deliveredAt?: string;
  isEmergency?: boolean;
}

export interface CalendarEvent {
  id: string;
  title?: string;
  event_type?: string;
  start_time?: string;
  end_time?: string;
  all_day?: boolean;
  metadata?: Record<string, any>;
  [key: string]: any;
}

/**
 * Mirrors the gateway's `mapNotificationRow`
 * (apps/api-gateway/src/notifications/notifications.service.ts:731) — the
 * server already camel-cases the row, so this is the wire shape, not a guess.
 */
export type NotificationStatus = "unread" | "read" | "archived";

export interface AppNotification {
  id: string;
  userId?: string;
  restaurantId?: string;
  type: string;
  title: string;
  message: string;
  priority?: FeedPriority;
  status: NotificationStatus;
  actionUrl?: string | null;
  actionLabel?: string | null;
  metadata?: Record<string, any> | null;
  readAt?: string | null;
  timestamp?: string;
  createdAt?: string;
}

/** `GET /notifications` paginates; `getNotifications` returns this envelope. */
export interface NotificationPage {
  data: AppNotification[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}
