/**
 * API Type Definitions
 * 
 * Shared types for API requests and responses.
 * These types should match the DTOs in the NestJS backend.
 */

// ==================== Pagination ====================

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

// ==================== Inventory Types ====================

export type SaleType = 'bottle' | 'glass' | 'both';
export type MeasurementUnit = 'ml' | 'oz';

export interface InventoryItem {
  id: string;
  restaurantId: string;
  wineId: string;
  providerId?: string;
  stockLive: number;
  physicalStock?: number;
  shadowStock?: number;
  thresholdMin: number;
  thresholdMax: number;
  toastItemGuid?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Set only by a spot count (recordSpotCount / apply_stock_movement source=mobile_count), never by a generic field edit. */
  lastCountedAt?: string | null;
  bottleSizeMl: number;
  bottleSizeOz: number;
  saleType?: SaleType;
  pourSizeMl?: number;
  pourSizeOz?: number;
  menuPriceGlass?: number;
  glassesPerBottle?: number;
  glassesPerBottleOverride?: number;
  // Joined fields
  wineName?: string;
  wineProducer?: string;
  wineVintage?: number;
  providerName?: string;
  // Pricing intelligence (Phase-10: retail_price_avg from master_wine_library; markup on the inventory row)
  retailPriceAvg?: number;
  markupRatio?: number;
  // Phase 2: weighted-average cost + provenance + lot spread derived from inventory_lots
  wac?: number;
  costProvenance?: 'invoice' | 'estimated';
  lotLiveQty?: number;
  lotLocationCount?: number;
  openMl?: number;
  // Phase 2 (2d/2e) analytics
  velocityPerDay?: number;
  daysOfCover?: number;
  reorderPoint?: number;
  reorderSuggested?: boolean;
  abcClass?: 'A' | 'B' | 'C';
  deadStock?: boolean;
  daysSinceSale?: number;
  locations?: WineLocationBreakdown[];
}

export interface WineLocationBreakdown {
  locationId: string | null;
  qty: number;
  wac: number | null;
}

export interface InventorySummary {
  totalItems: number;
  totalBottles: number;
  totalVolumeMl: number;
  totalVolumeOz: number;
  lowStockCount: number;
  criticalCount: number;
  healthyCount: number;
  toastMappedCount?: number;
  toastUnmappedCount?: number;
}

export interface UpdateInventoryItemRequest {
  providerId?: string;
  stockLive?: number;
  shadowStock?: number;
  thresholdMin?: number;
  thresholdMax?: number;
  toastItemGuid?: string;
  isActive?: boolean;
  bottleSizeMl?: number;
  saleType?: SaleType;
  pourSizeMl?: number;
  menuPriceGlass?: number;
  glassesPerBottleOverride?: number;
}

export interface CreateInventoryItemRequest {
  wineId: string;
  providerId?: string;
  stockLive: number;
  costPerBottle?: number;
  costProvenance?: CostProvenance;
  storageLocationId?: string;
  notes?: string;
  thresholdMin?: number;
  thresholdMax?: number;
  toastItemGuid?: string;
  bottleSizeMl?: number;
  saleType?: SaleType;
  pourSizeMl?: number;
  menuPriceGlass?: number;
  glassesPerBottleOverride?: number;
}

/**
 * How a lot's unit cost was established. `sample` means deliberately zero-cost
 * (free sample / consignment) — counted as stock, excluded from WAC.
 */
export type CostProvenance = 'invoice' | 'manual' | 'estimated' | 'sample';

/** Identity for a wine that may not exist in the Master Library yet. */
export interface WineDraft {
  name: string;
  producer?: string;
  vintage?: number | null;
  country?: string;
  region?: string;
  grapeVariety?: string;
}

/**
 * One row of a bulk receipt. Supply `wineId` for a known Master Library wine,
 * or `wineDraft` to have the server resolve-or-create a provisional library row.
 */
export interface BulkInventoryLine {
  wineId?: string;
  wineDraft?: WineDraft;
  stockLive?: number;
  costPerBottle?: number | null;
  costProvenance?: CostProvenance;
  storageLocationId?: string | null;
  providerId?: string | null;
  thresholdMin?: number;
  thresholdMax?: number;
  bottleSizeMl?: number;
  saleType?: SaleType;
  pourSizeMl?: number;
  menuPriceGlass?: number;
}

export interface BulkCreateInventoryRequest {
  items: BulkInventoryLine[];
  /** Free-text provenance for the audit trail, e.g. 'menu_scan' or 'manual_receipt'. */
  source?: string;
  reason?: string;
}

export interface BulkInventoryLineResult {
  index: number;
  /** `stock_added` = the wine was already in inventory, so the quantity was appended to it. */
  status: 'created' | 'stock_added' | 'reactivated' | 'failed';
  inventoryId?: string;
  masterWineId?: string;
  wineName: string;
  /** false = no library match, so a provisional (tier 3) row was created. */
  libraryMatched?: boolean;
  libraryTier?: number | null;
  error?: string;
}

export interface BulkCreateInventoryResult {
  created: number;
  stockAdded: number;
  reactivated: number;
  failed: number;
  results: BulkInventoryLineResult[];
}

export interface ToastMappingRequest {
  inventoryId: string;
  toastItemGuid: string;
}

export interface BulkToastMappingRequest {
  mappings: ToastMappingRequest[];
}

export interface BulkMappingResult {
  success: string[];
  failed: { inventoryId: string; error: string }[];
}

// ==================== Order Types ====================

export type OrderStatus =
  | 'draft'
  | 'negotiating'
  | 'pending'
  | 'pending_approval'
  | 'approved'
  | 'ordered'
  | 'in_transit'
  | 'delivered'
  /** Accepted less than was ordered; the remainder is still owed as a backorder. */
  | 'partially_received'
  | 'verified'
  | 'completed'
  | 'cancelled'
  | 'rejected';

/**
 * Normalize any order status value to the canonical lowercase form.
 * Handles UPPER_CASE values from agents and mixed-case from legacy data.
 */
export function normalizeOrderStatus(raw: string | undefined | null): OrderStatus {
  if (!raw) return 'pending';
  const lower = raw.toLowerCase().replace(/-/g, '_');
  const map: Record<string, OrderStatus> = {
    draft: 'draft',
    negotiating: 'negotiating',
    pending: 'pending',
    pending_approval: 'pending_approval',
    approved: 'approved',
    ordered: 'ordered',
    in_transit: 'in_transit',
    intransit: 'in_transit',
    delivered: 'delivered',
    partially_received: 'partially_received',
    verified: 'verified',
    completed: 'completed',
    cancelled: 'cancelled',
    canceled: 'cancelled',
    rejected: 'rejected',
  };
  return map[lower] ?? 'pending';
}

/**
 * The status vocabulary the gateway actually SENDS — `ProcurementOrderStatus`
 * in `apps/api-gateway/src/procurement/dto/procurement.dto.ts:19`, in
 * SCREAMING_SNAKE. `OrderStatus` above is the lowercase vocabulary this app's
 * own screens use; the two are different alphabets and `Order.status` is the
 * first one. Convert with `normalizeOrderStatus` — never compare a wire status
 * to a lowercase literal.
 */
export type OrderWireStatus =
  | 'PENDING'
  | 'APPROVAL_NEEDED'
  | 'NEGOTIATING'
  | 'APPROVED'
  | 'CONFIRMED'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  /** Accepted less than was ordered; the remainder stays open as a backorder. */
  | 'PARTIALLY_RECEIVED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'FAILED';

/**
 * One procurement order as `GET /procurement/orders`, `/orders/pending`,
 * `/orders/history` and `/orders/:id` send it.
 *
 * THIS TYPE IS A CLAIM ABOUT THE WIRE, AND IT WAS WRONG FOR MONTHS.
 * It used to declare `unitPrice`, `totalPrice`, `wineId`, `providerName`,
 * `wineProducer`, `notes`, `createdAt`, `updatedAt` and `recurrence` — nine
 * names `OrderResponseDto` has never sent. Nothing failed: `formatMoney(
 * undefined)` is `"$0"`, `a ?? b * c` is `NaN`, `x || y * 0` is `0`, and
 * `typeof x === 'number'` is false so the clause vanishes. Every one of those
 * readings type-checked, and three of them printed a confident wrong number on
 * a screen a human approves money from. Measured 2026-09-05 (ADR 0119 §13.11).
 *
 * The key set below is now exactly `OrderResponseDto`
 * (`apps/api-gateway/src/procurement/dto/procurement.dto.ts:699`), optional
 * where the DTO is optional, and `scripts/check_web_reads_gateway_dto_keys.py`
 * fails CI if the two drift apart again. Add a key here only after the DTO
 * declares it.
 */
export interface Order {
  id: string;
  orderNumber: string;
  restaurantId: string;
  /** The inventory row this order is for. There is no `wineId` on the wire. */
  inventoryId: string;
  providerId: string;
  /** In `unitType`, NOT necessarily in bottles. `bottlesTotal` is the bottles. */
  quantity: number;
  unitType?: string;
  bottlesTotal?: number;
  quotedPrice?: number;
  negotiatedPrice?: number;
  /** The agreed price per `priceUom`. This is the field the old `unitPrice` meant. */
  finalPrice?: number;
  /** The order's total. This is the field the old `totalPrice` meant. */
  totalCost?: number;
  status: OrderWireStatus;
  requestedAt?: string;
  approvedAt?: string;
  deliveredAt?: string;
  completedAt?: string;
  isEmergency?: boolean;
  priorityLevel?: number;
  /** Joined from `inventory.wine_name`. There is no producer on the wire. */
  wineName?: string;
  /**
   * The vendor's NAME, joined from `providers` on `provider_id` (2026-09-05).
   * THREE values, and the third one matters: a name; `null` (the route joined
   * and got nothing — print "the vendor is not named on this order", never a
   * blank); or the KEY ABSENT (this route does not join `providers`, so it
   * knows nothing either way). `/procurement/orders`, `/orders/history`,
   * `/orders/pending` and `/orders/:id` all join it.
   *
   * This key used to be declared here and never sent, which is how the
   * receiving door's credit-note letter came to be addressed "To the vendor"
   * on every order it had ever opened.
   */
  providerName?: string | null;
  /**
   * `procurement_orders.quantity_received` — what has been booked against this
   * order so far. A number; `null` (read, and nothing received); or the KEY
   * ABSENT (this route does not read the column).
   *
   * NEVER USE IT WITHOUT `quantityReceivedUom`. The column has four writers
   * and two units; on an order placed in cases the reading is ambiguous by the
   * pack size and the unit key is `null` to say so.
   */
  quantityReceived?: number | null;
  /**
   * The unit `quantityReceived` is stated in — ADR 0070. A unit; `null` (this
   * row CANNOT state it — a refusal, not a default); or the key absent
   * alongside `quantityReceived`.
   */
  quantityReceivedUom?: string | null;
  /**
   * The unit `finalPrice` is stated in — ADR 0119, read from the order LINE.
   * THREE values: a unit; `null` (the line was read and states none, which is
   * the price register's refusal); or the KEY ABSENT (this route does not read
   * the line and knows nothing either way). Only `/procurement/orders` and
   * `/orders/history` carry them. Reading absent as "unstated" is the
   * absence-reported-as-health fault — use `undefined` vs `null` deliberately.
   */
  priceUom?: string | null;
  /** Bottles in one `priceUom`. Travels with it: both, neither, or both absent. */
  pricePackSize?: number | null;
  /**
   * The recurrence, six keys that travel together — ADR 0125's addendum,
   * 2026-09-05. Read with the same three-state discipline as `priceUom`:
   *
   *   a value      this order repeats, and this is the rule
   *   null         this route READ the recurrence and this order does not repeat
   *   key absent   this route does not read it, and knows nothing either way
   *
   * This closes `.planning/v3.0-TECH-DEBT.md` "The orders wire" item 2. Until
   * this landed, `Order` declared a `recurrence` key `OrderResponseDto` has
   * never sent, so `useOrdersNextData.toRow` set `recurring = false` for every
   * row and the rebuilt page's Recurring station could never fill. The key is
   * now the DTO's own name, and `scripts/check_web_reads_gateway_dto_keys.py`
   * is what stops it drifting again.
   *
   * Only `/procurement/orders` and `/procurement/orders/:id` carry them — both
   * select `*`. A route that selects a column list sends none of the six.
   */
  recurrenceFrequency?: string | null;
  /** Weekly/biweekly: a weekday, 0 = Monday. Monthly/quarterly: 1..28. */
  recurrenceAnchorDay?: number | null;
  /** The next date this order comes round, YYYY-MM-DD. Derived, never typed. */
  recurrenceNextDueOn?: string | null;
  /** active | paused | ended. */
  recurrenceStatus?: string | null;
  /** Set on a CHILD occurrence; null on the order that carries the rule. */
  recurrenceParentOrderId?: string | null;
  /** The occurrence this child was raised for. Travels with the parent id. */
  recurrenceOccurrenceOn?: string | null;
}

export interface CreateOrderRequest {
  wineId: string;
  providerId: string;
  quantity: number;
  unitPrice: number;
  notes?: string;
}

export interface UpdateOrderRequest {
  status?: OrderStatus;
  notes?: string;
  quantity?: number;
  unitPrice?: number;
  locationId?: string;
}

// ==================== Wine Types ====================

export interface Wine {
  id: string;
  name: string;
  /**
   * Full descriptive name ("2016 Gravner Ribolla Friuli-Venezia Giulia"),
   * derived server-side. Prefer this over `name` for anything user-facing —
   * it disambiguates vintage variants that otherwise render identically
   * (three Château Pétrus rows all read "Château Pétrus" via `name` alone).
   * Undefined only if the endpoint didn't select it; falls back to `name`.
   */
  displayName?: string;
  producer: string;
  vintage?: number;
  price: number;
  /**
   * Average retail/market price from the master library — the same field the
   * inventory read model surfaces as `marketPrice`, so a library row and an
   * inventory row agree on what "market" means. Undefined until the price
   * enrichment pipeline populates `master_wine_library.retail_price_avg`.
   */
  retailPriceAvg?: number;
  bottleSizeMl: number;
  bottleSizeOz: number;
  category?: string;
  region?: string;
  country?: string;
  appellation?: string;
  grapeVariety?: string;
  description?: string;
  tastingNotes?: string;
  pairingNotes?: string;
  imageUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WineSearchParams {
  search?: string;
  type?: string;
  region?: string;
  country?: string;
  minPrice?: number;
  maxPrice?: number;
  sortBy?: 'name' | 'price' | 'vintage' | 'type';
  sortOrder?: 'asc' | 'desc';
}

// ==================== Calendar Types ====================

export interface CalendarEvent {
  id: string;
  restaurantId: string;
  title: string;
  description?: string;
  eventType: string;
  eventDate: string;
  eventDateEnd?: string;
  allDay: boolean;
  eventTime?: string;
  status: 'pending' | 'approved' | 'dismissed' | 'completed' | 'cancelled';
  isRecurring: boolean;
  recurrenceRuleId?: string;
  parentEventId?: string;
  occurrenceDate?: string;
  createdAt: string;
  updatedAt: string;
  // Related fields
  providerId?: string;
  orderId?: string;
  providerName?: string;
}

export interface CreateCalendarEventRequest {
  title: string;
  description?: string;
  eventType: string;
  eventDate: string;
  eventDateEnd?: string;
  allDay?: boolean;
  eventTime?: string;
  providerId?: string;
  orderId?: string;
}

export interface RecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  daysOfWeek?: number[];
  dayOfMonth?: number;
  endType: 'never' | 'after_count' | 'on_date';
  endAfterCount?: number;
  endOnDate?: string;
}

// ==================== Toast Types ====================

export interface ToastMenu {
  guid: string;
  name: string;
  description?: string;
  isActive: boolean;
  groups: ToastMenuGroup[];
}

export interface ToastMenuGroup {
  guid: string;
  name: string;
  description?: string;
  items: ToastMenuItem[];
}

export interface ToastMenuItem {
  guid: string;
  name: string;
  description?: string;
  price: number;
  category?: string;
  isAvailable: boolean;
}

export interface ToastSalesData {
  id: string;
  orderGuid: string;
  itemName: string;
  wineType?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  timestamp: string;
  serverName?: string;
  tableName?: string;
  source: string;
}

export interface ToastSalesResponse {
  sales: ToastSalesData[];
  total: number;
  totalRevenue: number;
  startTime: string;
  endTime: string;
}

// ==================== Dashboard Types ====================

export interface DashboardStats {
  totalWines: number;
  totalBottles: number;
  totalVolumeMl: number;
  totalVolumeOz: number;
  lowStockItems: number;
  pendingOrders: number;
  /**
   * Money paid to VENDORS for delivered procurement orders — cost, not income.
   * These were `todaySales` / `weekSales` / `monthSales`, and `monthSales` was
   * displayed as "Total Revenue" on the dashboard. Sales revenue would come
   * from POS checks and is not part of this payload.
   */
  todayProcurementSpend?: number;
  weekProcurementSpend?: number;
  monthProcurementSpend?: number;
}

/** Vendor spend summary returned by `GET /dashboard/summary/:id`. */
export interface ProcurementSpendSummary {
  totalProcurementSpend: number;
  monthlyProcurementSpend: number;
  totalBottlesDelivered: number;
  spendByMonth: Array<{ month: string; spend: number; bottles: number }>;
}

export interface DashboardWidget {
  id: string;
  type: string;
  title: string;
  data: any;
}

// ==================== Event Types ====================

export type EventType = 
  | 'inventory_update'
  | 'stock_adjustment'
  | 'order_created'
  | 'order_updated'
  | 'order_delivered'
  | 'low_stock_alert'
  | 'calendar_reminder'
  | 'pos_sale'
  | 'pos_order_created'
  | 'pos_order_closed';

export type SourcePage = 
  | 'dashboard'
  | 'inventory'
  | 'orders'
  | 'calendar'
  | 'wines'
  | 'reports'
  | 'toast_webhook'
  | 'system';

export interface AppEvent {
  id: string;
  restaurantId: string;
  userId?: string;
  eventType: EventType;
  sourcePage: SourcePage;
  payload: Record<string, any>;
  schemaVersion: number;
  idempotencyKey?: string;
  traceId?: string;
  correlationId?: string;
  createdAt: string;
}

export interface CreateEventRequest {
  eventType: EventType;
  sourcePage: SourcePage;
  payload: Record<string, any>;
  idempotencyKey?: string;
  traceId?: string;
  correlationId?: string;
}

// ==================== Notification Types ====================

export interface Notification {
  id: string;
  restaurantId: string;
  userId?: string;
  type: string;
  title: string;
  message: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'unread' | 'read' | 'dismissed';
  actionUrl?: string;
  actionLabel?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  readAt?: string;
}

// ==================== Provider Types ====================

export interface Provider {
  id: string;
  name: string;
  companyName?: string;
  email: string;
  phone?: string;
  whatsapp?: string;
  preferredMethod: 'email' | 'phone' | 'whatsapp' | 'sms';
  address?: string;
  city?: string;
  state?: string;
  specialties?: string[];
  minimumOrder?: number;
  leadTimeDays?: number;
  reliabilityScore?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
