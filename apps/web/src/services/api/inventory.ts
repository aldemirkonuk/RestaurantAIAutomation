/**
 * Inventory API Service
 * 
 * Handles all inventory-related API calls to the NestJS backend.
 */

import { apiClient, getActiveRestaurantId, getErrorMessage } from './client';
import type {
  InventoryItem,
  InventorySummary,
  CreateInventoryItemRequest,
  UpdateInventoryItemRequest,
  ToastMappingRequest,
  BulkToastMappingRequest,
  BulkMappingResult,
} from './types';

const INVENTORY_PATH = '/inventory';

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
  getUnmappedToastItems,
  findByToastGuid,
  mapToastItem,
  bulkMapToastItems,
  unmapToastItem,
};

export default inventoryApi;
