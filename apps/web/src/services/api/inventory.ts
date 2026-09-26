/**
 * Inventory API Service
 * 
 * Handles all inventory-related API calls to the NestJS backend.
 */

import { apiClient, getActiveRestaurantId } from './client';
import type {
  InventoryItem,
  InventorySummary,
  CreateInventoryItemRequest,
  UpdateInventoryItemRequest,
  ToastMappingRequest,
  BulkMappingResult,
  BulkCreateInventoryRequest,
  BulkCreateInventoryResult,
} from './types';

const INVENTORY_PATH = '/inventory';

/**
 * The snake_case keys the gateway hands back unmapped. `GET /inventory/:id`
 * runs rows through the gateway's `mapInventoryItem` (camelCase laid over the
 * raw row), but `GET /inventory/:id/low-stock` returns `v_low_stock_items` rows
 * untouched (`apps/api-gateway/src/database/database.service.ts:55-63`):
 * `wine_name`, `producer`, `vintage`, `stock_live`, `threshold_min`,
 * `master_wine_id`. Every reader that trusted the declared `InventoryItem` type
 * rendered "Unknown wine" with blank counts over seven named wines
 * (`.planning/v3.0-TECH-DEBT.md`, 2026-09-03 intelligence lens, defect 1).
 */
interface RawInventoryRow {
  restaurant_id?: string;
  master_wine_id?: string;
  provider_id?: string | null;
  wine_name?: string | null;
  wine_producer?: string | null;
  producer?: string | null;
  wine_vintage?: number | null;
  vintage?: number | null;
  provider_name?: string | null;
  stock_live?: number | null;
  physical_stock?: number | null;
  shadow_stock?: number | null;
  threshold_min?: number | null;
  threshold_max?: number | null;
  toast_item_guid?: string | null;
  is_active?: boolean | null;
  created_at?: string;
  updated_at?: string;
  last_counted_at?: string | null;
  bottle_size_ml?: number | null;
  retail_price_avg?: number | null;
  markup_ratio?: number | null;
  menu_price_glass?: number | null;
  /** The house bottle price (ADR 0193: one column, menu_price_current). */
  menu_price_current?: number | null;
}

/**
 * Normalize one inventory row to the declared `InventoryItem` shape whichever
 * casing the gateway used. camelCase wins when both are present, so a row the
 * gateway already mapped passes through unchanged and the function is
 * idempotent. Applied at the service boundary by `getLowStockItems` (the one
 * inventory read that serves raw view rows) and by the TanStack inventory hooks.
 *
 * Absent values stay absent: a view row carries no `bottle_size_ml`, and this
 * does not invent one — the renderer that wants a default applies its own.
 */
export function normalizeInventoryItem(
  item: Partial<InventoryItem> & RawInventoryRow
): InventoryItem {
  return {
    ...item,
    restaurantId: item.restaurantId ?? item.restaurant_id,
    wineId: item.wineId ?? item.master_wine_id,
    providerId: item.providerId ?? item.provider_id ?? undefined,
    wineName: item.wineName ?? item.wine_name ?? undefined,
    wineProducer: item.wineProducer ?? item.wine_producer ?? item.producer ?? undefined,
    wineVintage: item.wineVintage ?? item.wine_vintage ?? item.vintage ?? undefined,
    providerName: item.providerName ?? item.provider_name ?? undefined,
    stockLive: item.stockLive ?? item.stock_live ?? 0,
    physicalStock: item.physicalStock ?? item.physical_stock ?? undefined,
    shadowStock: item.shadowStock ?? item.shadow_stock ?? 0,
    thresholdMin: item.thresholdMin ?? item.threshold_min ?? 0,
    thresholdMax: item.thresholdMax ?? item.threshold_max ?? 0,
    toastItemGuid: item.toastItemGuid ?? item.toast_item_guid ?? undefined,
    isActive: item.isActive ?? item.is_active ?? true,
    createdAt: item.createdAt ?? item.created_at,
    updatedAt: item.updatedAt ?? item.updated_at,
    bottleSizeMl: item.bottleSizeMl ?? item.bottle_size_ml ?? undefined,
    menuPriceGlass: item.menuPriceGlass ?? item.menu_price_glass ?? undefined,
    menuPriceBottle: item.menuPriceBottle ?? item.menu_price_current ?? undefined,
    retailPriceAvg: item.retailPriceAvg ?? item.retail_price_avg ?? undefined,
    markupRatio: item.markupRatio ?? item.markup_ratio ?? undefined,
    lastCountedAt: item.lastCountedAt ?? item.last_counted_at ?? null,
    wac: item.wac ?? undefined,
    costProvenance: item.costProvenance ?? undefined,
    lotLocationCount: item.lotLocationCount ?? undefined,
    openMl: item.openMl ?? 0,
    velocityPerDay: item.velocityPerDay ?? undefined,
    daysOfCover: item.daysOfCover ?? undefined,
    reorderPoint: item.reorderPoint ?? undefined,
    reorderSuggested: item.reorderSuggested ?? false,
    abcClass: item.abcClass ?? undefined,
    deadStock: item.deadStock ?? false,
    daysSinceSale: item.daysSinceSale ?? undefined,
    analyticsReadable: item.analyticsReadable ?? true,
    locations: item.locations ?? [],
  } as InventoryItem;
}

export interface ItemActivity {
  daily: Array<{ date: string; out: number; in: number }>;
  /** 7 rows (Mon..Sun) x 8 slots (4pm..11pm) of depletion counts, last 28d */
  heat: number[][];
  totalOut28d: number;
  /** Bottles booked ONTO the shelf in 28d — deliveries, adjustments, returns. */
  totalIn28d: number;
  /** What the door counted, in words, so an empty series is not read as silence. */
  includes: { out: string; in: string; window: string };
}

/**
 * Depletion activity for one item — velocity series + busy-hours heatmap.
 */
export async function getItemActivity(
  itemId: string,
  restaurantId?: string
): Promise<ItemActivity> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');
  const response = await apiClient.get<ItemActivity>(
    `${INVENTORY_PATH}/${id}/item/${itemId}/activity`
  );
  return response.data;
}

/**
 * Ledger reconcile — sets the physical count as truth (clears shadow, writes
 * an auditable transaction). Also powers manual +/- adjustments: pass the
 * resulting actual count.
 */
export async function reconcileItem(
  inventoryId: string,
  body: { wineId: string; actualCount: number; notes?: string }
): Promise<unknown> {
  const response = await apiClient.post(
    `/inventory-ledger/inventory/${inventoryId}/reconcile`,
    body
  );
  return response.data;
}

/**
 * Get all inventory items for the active restaurant
 */
export async function getInventory(restaurantId?: string): Promise<InventoryItem[]> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.get<InventoryItem[]>(`${INVENTORY_PATH}/${id}`);
  return response.data;
}

/**
 * Create a new inventory item
 */
export async function createInventoryItem(
  data: CreateInventoryItemRequest,
  restaurantId?: string
): Promise<InventoryItem> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.post<InventoryItem>(
    `${INVENTORY_PATH}/${id}/items`,
    data
  );
  return response.data;
}

/**
 * Create many inventory items in one call.
 *
 * Unlike `createInventoryItem`, a line whose wine is already in inventory is not
 * a 409 — the quantity is appended to the existing item, which is what receiving
 * a case of something you already carry actually means. Lines carrying a
 * `wineDraft` instead of a `wineId` are resolved against the Master Library
 * server-side (exact signature, then name+producer) and get a provisional row
 * when nothing matches. Per-line failures never abort the batch.
 */
export async function bulkCreateInventoryItems(
  data: BulkCreateInventoryRequest,
  restaurantId?: string
): Promise<BulkCreateInventoryResult> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.post<BulkCreateInventoryResult>(
    `${INVENTORY_PATH}/${id}/items/bulk`,
    data
  );
  return response.data;
}

/**
 * Get low stock items.
 *
 * The endpoint serves `v_low_stock_items` rows as the database names them, so
 * the read is normalized here — the declared return type is the delivered one.
 */
export async function getLowStockItems(restaurantId?: string): Promise<InventoryItem[]> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.get<Array<Partial<InventoryItem> & RawInventoryRow>>(
    `${INVENTORY_PATH}/${id}/low-stock`
  );
  return response.data.map(normalizeInventoryItem);
}

/**
 * Get inventory summary statistics
 */
export async function getInventorySummary(restaurantId?: string): Promise<InventorySummary> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.get<InventorySummary>(`${INVENTORY_PATH}/${id}/summary`);
  return response.data;
}

/**
 * Get a single inventory item
 */
export async function getInventoryItem(
  itemId: string,
  restaurantId?: string
): Promise<InventoryItem> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.get<InventoryItem>(
    `${INVENTORY_PATH}/${id}/item/${itemId}`
  );
  return response.data;
}

/**
 * Update an inventory item
 */
export async function updateInventoryItem(
  itemId: string,
  data: UpdateInventoryItemRequest,
  restaurantId?: string
): Promise<InventoryItem> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.patch<InventoryItem>(
    `${INVENTORY_PATH}/${id}/item/${itemId}`,
    data
  );
  return response.data;
}

/**
 * Move bottles of a wine between storage locations (null = unassigned). Multi-location.
 */
export async function transferStock(
  itemId: string,
  body: {
    fromLocationId?: string | null;
    toLocationId?: string | null;
    qty: number;
    reason?: string;
  },
  restaurantId?: string
): Promise<InventoryItem> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.post<InventoryItem>(
    `${INVENTORY_PATH}/${id}/item/${itemId}/transfer`,
    body
  );
  return response.data;
}

/**
 * Record by-the-glass pours (POS-primary, manual override). Depletes open-bottle ml.
 */
export async function recordPour(
  itemId: string,
  body: {
    pours?: number;
    pourMl?: number | null;
    locationId?: string | null;
    source?: string;
    reason?: string;
    idempotencyKey?: string | null;
  },
  restaurantId?: string
): Promise<{ pour: any; item: InventoryItem | null }> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  // Client-generated so a retry over flaky signal can't double-pour once
  // pour_events.idempotency_key is mandatory (spine repair, decision A12).
  const idempotencyKey =
    body.idempotencyKey ??
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? `pour:${itemId}:${crypto.randomUUID()}`
      : `pour:${itemId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`);

  const response = await apiClient.post<{ pour: any; item: InventoryItem | null }>(
    `${INVENTORY_PATH}/${id}/item/${itemId}/pour`,
    { ...body, idempotencyKey }
  );
  return response.data;
}

/**
 * Spot count (decisions E40-E43) — immediate reconciliation via
 * apply_stock_movement(reconciliation/mobile_count). Idempotency key is
 * client-generated as count:{inventoryId}:{clientCountId} so a retry over a
 * flaky connection cannot double-apply the same count.
 */
export async function recordSpotCount(
  itemId: string,
  body: {
    countedQty: number;
    stockState?: 'live' | 'shadow';
    clientCountId?: string;
    reason?: string;
    performedBy?: string | null;
  },
  restaurantId?: string
): Promise<{ item: InventoryItem | null }> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const clientCountId =
    body.clientCountId ??
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`);

  const response = await apiClient.post<{ item: InventoryItem | null }>(
    `${INVENTORY_PATH}/${id}/item/${itemId}/count`,
    { ...body, clientCountId }
  );
  return response.data;
}

/**
 * Photo counting (decision E46) — a vision suggestion only, never a stock
 * write. The caller drops the response into the same quantity field the
 * voice path fills; the human still has to call recordSpotCount to commit.
 */
export async function estimateCountFromPhoto(
  itemId: string,
  imageBase64: string,
  restaurantId?: string
): Promise<{ suggestedQty: number | null; confidence: 'low' | 'medium' | 'high'; note: string }> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.post<{
    suggestedQty: number | null;
    confidence: 'low' | 'medium' | 'high';
    note: string;
  }>(`${INVENTORY_PATH}/${id}/item/${itemId}/count-photo-estimate`, { imageBase64 });
  return response.data;
}

// ==================== Toast Mapping Endpoints ====================

/**
 * Get inventory items without Toast GUID mapping
 */
export async function getUnmappedToastItems(restaurantId?: string): Promise<InventoryItem[]> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.get<InventoryItem[]>(
    `${INVENTORY_PATH}/${id}/toast/unmapped`
  );
  return response.data;
}

/**
 * Find inventory item by Toast item GUID
 */
export async function findByToastGuid(
  toastItemGuid: string,
  restaurantId?: string
): Promise<InventoryItem | null> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  try {
    const response = await apiClient.get<InventoryItem>(
      `${INVENTORY_PATH}/${id}/toast/lookup/${encodeURIComponent(toastItemGuid)}`
    );
    return response.data;
  } catch (error: any) {
    if (error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Map a Toast item GUID to an inventory item
 */
export async function mapToastItem(
  mapping: ToastMappingRequest,
  restaurantId?: string
): Promise<InventoryItem> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.post<InventoryItem>(
    `${INVENTORY_PATH}/${id}/toast/map`,
    mapping
  );
  return response.data;
}

/**
 * Bulk map Toast items to inventory
 */
export async function bulkMapToastItems(
  mappings: ToastMappingRequest[],
  restaurantId?: string
): Promise<BulkMappingResult> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.post<BulkMappingResult>(
    `${INVENTORY_PATH}/${id}/toast/map/bulk`,
    { mappings }
  );
  return response.data;
}

/**
 * Soft-delete an inventory item (sets is_active = false, keeps history)
 */
export async function deleteInventoryItem(
  itemId: string,
  restaurantId?: string
): Promise<{ success: boolean }> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.delete<{ success: boolean }>(
    `${INVENTORY_PATH}/${id}/item/${itemId}`
  );
  return response.data;
}

/**
 * Remove Toast item mapping from an inventory item
 */
export async function unmapToastItem(
  inventoryId: string,
  restaurantId?: string
): Promise<InventoryItem> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.delete<InventoryItem>(
    `${INVENTORY_PATH}/${id}/toast/map/${inventoryId}`
  );
  return response.data;
}

// ── Auction lot records — an auction lot's own details, kept. Built
// 2026-09-21 (founder answer 2), closing the gap AuctionLotStart.tsx and
// inventory.md §9 named 2026-09-06 (ADR 0083). ──────────────────────────────

export interface AuctionLotRecord {
  id: string;
  inventoryId: string;
  auctionHouse: string;
  /** Optional since 2026-09-21 (founder answer 11): null is "not stated". */
  lotNumber: string | null;
  saleDate: string;
  hammerPrice: number;
  buyersPremium: number;
  currency: string;
  bottles: number;
  /** The house's currency when recorded; null on a record from before 2026-09-21. */
  houseCurrency?: string | null;
  exchangeRate?: number | null;
  houseUnitCost?: number | null;
  /** What the book was given per bottle, in houseCurrency; null on an older record. */
  bookedUnitCost?: number | null;
  recordedByName: string;
  createdAt: string;
}

export interface CreateAuctionLotRecordInput {
  inventoryId: string;
  auctionHouse: string;
  /** null or absent = not stated (optional since 2026-09-21, founder answer 11). */
  lotNumber?: string | null;
  saleDate: string;
  hammerPrice: number;
  buyersPremium: number;
  /** ISO-4217, never inferred — exactly what the sheet's currency picker held. */
  currency: string;
  bottles: number;
  /** What the person said one unit of the lot's currency was worth in the house's (founder answer 10). */
  exchangeRate?: number | null;
  /** What the person typed as each bottle's cost in the house's currency; wins when present. */
  houseUnitCost?: number | null;
  /** The per-bottle cost the bottles were carried in at, in the house's currency. */
  bookedUnitCost: number;
}

export async function createAuctionLotRecord(
  data: CreateAuctionLotRecordInput
): Promise<AuctionLotRecord> {
  const response = await apiClient.post<AuctionLotRecord>(
    `${INVENTORY_PATH}/auction-lots`,
    data
  );
  return response.data;
}

export async function fetchAuctionLotRecords(inventoryId: string): Promise<AuctionLotRecord[]> {
  const params = new URLSearchParams({ inventoryId });
  const response = await apiClient.get<AuctionLotRecord[]>(
    `${INVENTORY_PATH}/auction-lots?${params.toString()}`
  );
  return response.data;
}

/**
 * A house item the wine library does not have, and where it stands on the
 * research queue (founder, 2026-09-21, ADR 0192's amendment). `flag` is set
 * only for an item whose name cannot identify a wine.
 */
export interface HouseItemResearch {
  inventoryId: string;
  status: 'queued' | 'matched' | 'not_findable';
  reason: string;
  flag: string | null;
  updatedAt: string;
  /** True once the enrich chain has been handed this item (founder, 2026-09-22). */
  researchStarted?: boolean;
}

/** This house's research rows; the house comes from the sign-in. A failed read throws. */
export async function fetchHouseItemResearch(): Promise<HouseItemResearch[]> {
  const response = await apiClient.get<{ items: HouseItemResearch[] }>(`${INVENTORY_PATH}/research`);
  return response.data.items;
}

// ==================== Export all functions ====================

export const inventoryApi = {
  getInventory,
  createInventoryItem,
  getLowStockItems,
  getInventorySummary,
  getInventoryItem,
  updateInventoryItem,
  transferStock,
  recordPour,
  recordSpotCount,
  estimateCountFromPhoto,
  deleteInventoryItem,
  getUnmappedToastItems,
  findByToastGuid,
  mapToastItem,
  bulkMapToastItems,
  unmapToastItem,
  createAuctionLotRecord,
  fetchAuctionLotRecords,
};

export default inventoryApi;
