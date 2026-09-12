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
  [key: string]: any;
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
