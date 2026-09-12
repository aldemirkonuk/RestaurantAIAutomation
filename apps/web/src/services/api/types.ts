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

export interface Order {
  id: string;
  restaurantId: string;
  wineId: string;
  providerId: string;
  inventoryId?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  status: OrderStatus;
  requestedAt: string;
  approvedAt?: string;
  deliveredAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  // Joined fields
  wineName?: string;
  wineProducer?: string;
  providerName?: string;
  orderNumber?: string;
  recurrence?: {
    frequency: 'daily' | 'weekly' | 'monthly';
    interval?: number;
    nextDate?: string;
  };
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
