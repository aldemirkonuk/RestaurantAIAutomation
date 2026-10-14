/** Mirrors apps/api-gateway/src/mobile/dto/mobile.dto.ts. */

export type DecisionKind =
  | "order_approval"
  | "draft_approval"
  | "receipt_verification"
  | "receipt_discrepancy"
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
  /** An alert's notice link, as the inbox opens it (F-1451). Absent from an
   *  older gateway. */
  actionUrl?: string | null;
}

export interface FeedResponse {
  items: FeedItem[];
  counts: {
    total: number;
    orderApprovals: number;
    draftApprovals: number;
    receiptVerifications: number;
    alerts: number;
    /** Orders, replies and deliveries waiting; notices are not decisions
     *  (F-1450). Absent from an older gateway. */
    decisions?: number;
  };
  generatedAt: string;
}

/**
 * Why tonight's sales are or are not known (F-674), from the gateway:
 * `known`, `no_register` (the register has never sent a check),
 * `zone_unset` (the house has no time zone), `unread` (the read failed),
 * `withheld` (this person does not hold the house's money: staff, F-957).
 * Absent on a pulse saved before the field existed.
 */
export type PulseSalesState = "known" | "no_register" | "zone_unset" | "unread" | "withheld";

export interface TodayPulse {
  salesState?: PulseSalesState;
  revenueToday: number | null;
  checksToday: number | null;
  /** Of `checksToday`, those that carried a net; `revenueToday` sums only
   *  these (F-1656). Absent from an older gateway. */
  netChecksToday?: number | null;
  /** Of `checksToday`, those whose prices include tax and whose tax could not
   *  be taken off (F-1656). Absent from an older gateway. */
  netNotRecordedByTaxToday?: number | null;
  revenueLastWeek: number | null;
  deltaPct: number | null;
  /**
   * Orders, replies and deliveries waiting; notices are not decisions
   * (F-1450). null when the decision feed could not be read — unknown, not
   * zero.
   */
  pendingDecisions: number | null;
  /** True when there were more unread notices than the feed reads, so more
   *  may be waiting than the count says (F-1450). Absent from an older gateway. */
  decisionsMore?: boolean;
  criticalCount: number | null;
  /** The house's midnight that opened tonight; null when it has no zone. */
  windowStart: string | null;
  windowEnd: string;
  generatedAt: string;
  /**
   * The house's money (`restaurants.currency`) and its formats tag, for every
   * money figure on the phone (F-885). null = not recorded: the figure prints
   * with no symbol, never as dollars. Absent from an older gateway.
   */
  currency?: string | null;
  locale?: string | null;
  /**
   * The house's zone, so a letter or an event is dated on the house's day
   * (F-1029). null = not recorded; absent from an older gateway.
   */
  timezone?: string | null;
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
  /** The open 86 (F-1434); null when it is not sold out. */
  soldOut?: { cause: string; startedAt: string } | null;
  /** false: whether it is sold out could not be read for this list. */
  soldOutReadable?: boolean;
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
   * The order's money, ISO 4217 (`procurement_orders.currency`). `null` = the
   * row names none; absent = the route did not read it. `/procurement/orders/:id`
   * selects `*`, so the receiving screen gets it (F-341).
   */
  currency?: string | null;
  /**
   * The agreement LINE's money (`procurement_order_items.currency`), sent by
   * `/procurement/orders/:id` only. The gateway compares a bill against this
   * first and `currency` second (F-800); read it through `agreedCurrency()`.
   * `null` = the line names none; absent = the route did not read the line.
   */
  agreedCurrency?: string | null;
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

/**
 * Mirrors the gateway's `mapCalendarEvent`
 * (apps/api-gateway/src/calendar/calendar.service.ts) — camelCase only (F-1071).
 * `eventDate` is the house's date (YYYY-MM-DD); `eventTime` a wall-clock
 * "HH:MM[:SS]" on the house's clock.
 */
export interface CalendarEvent {
  id: string;
  title?: string;
  eventType?: string;
  eventDate?: string;
  eventDateEnd?: string;
  allDay?: boolean;
  eventTime?: string;
  eventTimeEnd?: string;
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
