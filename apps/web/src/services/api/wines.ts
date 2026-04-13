/**
 * Wines API Service
 * 
 * Handles all wine library-related API calls.
 * Uses both Supabase direct access and NestJS backend.
 */

import { apiClient, getActiveRestaurantId } from './client';
import { createInventoryItem } from './inventory';
import type {
  Wine,
  WineSearchParams,
  PaginationParams,
  PaginatedResponse,
} from './types';

const WINES_PATH = '/wines';

/**
 * Search wines in the master wine library
 */
export async function searchWines(
  params?: WineSearchParams & PaginationParams
): Promise<Wine[]> {
  const query: Record<string, unknown> = { ...params };
  if (params?.page && params?.limit) {
    query.offset = (params.page - 1) * params.limit;
    delete query.page;
  }

  const response = await apiClient.get<Wine[]>(WINES_PATH, {
    params: query,
  });

  return response.data;
}

/**
 * Get wine by ID
 */
export async function getWineById(wineId: string): Promise<Wine | null> {
  try {
    const response = await apiClient.get<Wine>(`${WINES_PATH}/${wineId}`);
    return response.data;
  } catch (error: any) {
    if (error?.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Get wines by IDs
 */
export async function getWinesByIds(wineIds: string[]): Promise<Wine[]> {
  if (wineIds.length === 0) return [];

  const response = await apiClient.get<Wine[]>(WINES_PATH, {
    params: { ids: wineIds.join(',') },
  });
  return response.data;
}

/**
 * Get wine categories (types)
 */
export async function getWineCategories(): Promise<string[]> {
  const response = await apiClient.get<string[]>(`${WINES_PATH}/meta/categories`);
  return response.data;
}

/**
 * Get wine regions
 */
export async function getWineRegions(country?: string): Promise<string[]> {
  const response = await apiClient.get<string[]>(`${WINES_PATH}/meta/regions`, {
    params: { country },
  });
  return response.data;
}

/**
 * Get wine countries
 */
export async function getWineCountries(): Promise<string[]> {
  const response = await apiClient.get<string[]>(`${WINES_PATH}/meta/countries`);
  return response.data;
}

/**
 * Get wine suggestions based on text input (for autocomplete)
 */
export async function getWineSuggestions(
  text: string,
  limit: number = 10
): Promise<Wine[]> {
  if (!text || text.length < 2) return [];

  const response = await apiClient.get<Wine[]>(`${WINES_PATH}/suggestions`, {
    params: { text, limit },
  });
  return response.data;
}

/**
 * Get similar wines (by category, region, or price range)
 */
export async function getSimilarWines(
  wineId: string,
  limit: number = 5
): Promise<Wine[]> {
  const response = await apiClient.get<Wine[]>(`${WINES_PATH}/${wineId}/similar`, {
    params: { limit },
  });
  return response.data;
}

/**
 * Add wine to restaurant inventory (via API)
 */
export async function addWineToInventory(
  wineId: string,
  initialStock: number,
  thresholdMin: number = 6,
  thresholdMax: number = 24,
  providerId?: string,
  restaurantId?: string
): Promise<any> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');

  return createInventoryItem(
    {
      wineId,
      providerId,
      stockLive: initialStock,
      thresholdMin,
      thresholdMax,
    },
    id
  );
}

// ==================== Export all functions ====================

export const winesApi = {
  searchWines,
  getWineById,
  getWinesByIds,
  getWineCategories,
  getWineRegions,
  getWineCountries,
  getWineSuggestions,
  getSimilarWines,
  addWineToInventory,
};

export default winesApi;
