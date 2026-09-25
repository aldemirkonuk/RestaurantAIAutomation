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

/**
 * One reading, offered to the house library for de-duplication — never a
 * stock write. `POST /wines/submissions` (`wines.controller.ts:99`,
 * `WineSubmissionsService#submitWine`) queues the row into
 * `master_wine_library_submissions` with `status: 'pending'`; a background
 * dedup pass later decides whether it matches an existing bottle or becomes a
 * new one. This is the write side of "Photograph the label" (ADR 0160 sec110
 * item 5) and of any other "is this the bottle?" confirmation — confirming
 * submits the reading, it puts nothing on a shelf.
 */
export interface WineSubmissionInput {
  name: string
  producer: string
  vintage?: number | null
  priceReference?: number | null
  primaryType?: string
  grapeVariety?: string
  country?: string
  region?: string
  appellation?: string
  subRegion?: string
  bottleSizeMl?: number
}

export async function submitWine(input: WineSubmissionInput): Promise<{ id: string; status: string }> {
  const response = await apiClient.post<{ id: string; status: string }>(
    `${WINES_PATH}/submissions`,
    input
  )
  return response.data
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
  submitWine,
};

export default winesApi;
