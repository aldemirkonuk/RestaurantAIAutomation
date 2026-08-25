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

export interface ItemActivity {
  daily: Array<{ date: string; out: number }>;
  /** 7 rows (Mon..Sun) x 8 slots (4pm..11pm) of depletion counts, last 28d */
  heat: number[][];
  totalOut28d: number;
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
 * Get low stock items
 */
export async function getLowStockItems(restaurantId?: string): Promise<InventoryItem[]> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  const response = await apiClient.get<InventoryItem[]>(`${INVENTORY_PATH}/${id}/low-stock`);
  return response.data;
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
};

export default inventoryApi;
