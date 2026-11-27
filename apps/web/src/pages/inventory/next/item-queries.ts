/**
 * The three reads a good's drawer starts first, as query options. The drawer
 * (ItemDrawer.tsx) and the list's hover prefetch (use-item-prefetch.ts) both
 * build their queries here, so they share keys and functions and an opened
 * drawer finds what the hover already fetched. Staff get the same cost
 * withholding because the same gateway functions run.
 */
import { getItemFigures, getItemNutrition, getItemUsedIn, inventoryItemKeys } from '../../../services/api/inventory';

export const figuresQuery = (restaurantId: string, id: string) => ({
  queryKey: inventoryItemKeys.figures(restaurantId, id),
  queryFn: () => getItemFigures(id, restaurantId || undefined),
  staleTime: 30_000,
  retry: false as const,
});

export const nutritionQuery = (restaurantId: string, id: string) => ({
  queryKey: inventoryItemKeys.nutrition(restaurantId, id),
  queryFn: () => getItemNutrition(id, restaurantId || undefined),
  staleTime: 60_000,
  retry: false as const,
});

export const usedInQuery = (restaurantId: string, id: string) => ({
  queryKey: inventoryItemKeys.usedIn(restaurantId, id),
  queryFn: () => getItemUsedIn(id, restaurantId || undefined),
  staleTime: 60_000,
  retry: false as const,
});
