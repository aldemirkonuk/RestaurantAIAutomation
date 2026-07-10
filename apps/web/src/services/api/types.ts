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
  producer: string;
  vintage?: number;
  price: number;
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
  todaySales?: number;
  weekSales?: number;
  monthSales?: number;
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
