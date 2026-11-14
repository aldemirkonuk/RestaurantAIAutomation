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
 * Most wine ids one GET /wines?ids= carries. Must stay at or under the
 * gateway's `WINE_IDS_MAX` (wines.dto.ts), which refuses a longer list.
 *
 * Every id went in one URL, so at about 420 ids (37 characters each, about
 * 15.5 KB) the request passed Node's 16 KB header limit and the whole library
 * join failed; names, vintages and grapes went missing from /inventory for a
 * house holding 500 wines (QA round 2, U-1). 100 ids is about 3.7 KB, well
 * under any proxy's limit, and 100 rows is far under PostgREST's 1,000-row cap.
 */
export const WINE_IDS_PER_REQUEST = 100;

/**
 * Most chunk requests in flight at once. One after another, 1,000 wines were
 * ten round trips in a row after the list itself, and the Type filter and the
 * producer and grape columns waited on all ten (inventory r36 audit, gap 12).
 * Four at a time keeps a 5,000-wine house from opening fifty requests at once.
 */
export const WINE_CHUNKS_AT_ONCE = 4;

/**
 * Get wines by IDs, in requests of at most `WINE_IDS_PER_REQUEST` ids, up to
 * `WINE_CHUNKS_AT_ONCE` of them at a time. The wines come back in the order
 * the ids were asked, whatever order the chunks answer in.
 *
 * Any chunk that fails fails the whole read: a library join with a third of
 * its wines missing would render as wines with no name, which is a failed
 * read shown as an empty one (ADR 0020). No chunk is started after one fails.
 */
export async function getWinesByIds(wineIds: string[]): Promise<Wine[]> {
  const unique = Array.from(new Set(wineIds.filter(Boolean)));
  if (unique.length === 0) return [];

  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += WINE_IDS_PER_REQUEST) {
    chunks.push(unique.slice(i, i + WINE_IDS_PER_REQUEST));
  }
  const answers: Wine[][] = new Array(chunks.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < chunks.length) {
      const at = next++;
      try {
        const response = await apiClient.get<Wine[]>(WINES_PATH, {
          params: { ids: chunks[at].join(',') },
        });
        answers[at] = response.data;
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(WINE_CHUNKS_AT_ONCE, chunks.length) }, worker));
  return answers.flat();
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
