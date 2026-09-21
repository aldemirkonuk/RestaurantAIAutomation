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
  locations?: Array<{
    locationId: string;
    locationName?: string;
    qty: number;
    wac?: number;
  }>;
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
/** The gateway's `ShelfReceivedDto` (ADR 0192). Every field is null when `readable` is false. */
export interface ShelfReceived {
  readable: boolean;
  why: string | null;
  /** The ledger's sum, in `stockUom`. Never rounded. */
  quantityInStockUom: number | null;
  /** The item's stock unit — `bottle` for wine. */
  stockUom: string | null;
  packUnit: string | null;
  packSize: number | null;
  packs: number | null;
  looseInStockUom: number | null;
  /** "5 cases + 5 bottles". */
  words: string | null;
  /** Refused at the door, in bottles. */
  rejectedAtDoorBottles: number | null;
  /** Accepted at the door and not on the shelf yet, in bottles. */
  countedNotBookedBottles: number | null;
}

export interface ProcurementOrder {
  id: string;
  orderNumber?: string;
  wineName?: string;
  providerId?: string;
  /**
   * The vendor's name, joined from `providers` (2026-09-05). A name; `null`
   * (the route joined and found none); or the key ABSENT (this route does not
   * join). `/procurement/orders/:id` and `/orders/pending` — the two this app
   * calls — both join it.
   */
  providerName?: string | null;
  quantity?: number;
  bottlesTotal?: number;
  unitType?: string;
  priceUom?: string | null;
  pricePackSize?: number | null;
  /**
   * What this order RECEIVED — ADR 0192: the stock ledger's count for the
   * order's item, in the item's stock unit (bottles for wine), never rounded,
   * with `words` ("5 cases + 5 bottles"). The block with `readable: false` is
   * a failed read, never a zero; the key absent means the route did not read
   * the ledger. Read it through `lib/shelfReceived.ts`.
   *
   * It replaces `quantityReceived` / `quantityReceivedUom`, which carried a
   * column with four writers in two units that the gateway no longer reads. A
   * phone on an older build reads neither key now and falls back to the
   * ordered bottle count with its own sentence — never to a guessed unit.
   */
  received?: ShelfReceived;
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
