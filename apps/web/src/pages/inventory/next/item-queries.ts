/**
 * The three reads a good's drawer starts first, as query options. The drawer
 * (ItemDrawer.tsx) and the list's hover prefetch (use-item-prefetch.ts) both
 * build their queries here, so they share keys and functions and an opened
 * drawer finds what the hover already fetched. Staff get the same cost
 * withholding because the same gateway functions run.
 */
import type { QueryClient } from '@tanstack/react-query';
import { getItemFigures, getItemNutrition, getItemUsedIn, inventoryItemKeys } from '../../../services/api/inventory';
import { getItemDishes, getItemDrinks } from '../../../services/api/itemDishes';

export const figuresQuery = (restaurantId: string, id: string) => ({
  queryKey: inventoryItemKeys.figures(restaurantId, id),
  queryFn: () => getItemFigures(id, restaurantId || undefined),
  staleTime: 30_000,
  retry: false as const,
  // The app default is 'always', which refetches a cache the hover just filled. `true` honours staleTime;
  // a count or write-off invalidates the ['inventory'] prefix, so a write still rereads these.
  refetchOnMount: true as const,
});

export const nutritionQuery = (restaurantId: string, id: string) => ({
  queryKey: inventoryItemKeys.nutrition(restaurantId, id),
  queryFn: () => getItemNutrition(id, restaurantId || undefined),
  staleTime: 60_000,
  retry: false as const,
  // The app default is 'always', which refetches a cache the hover just filled. `true` honours staleTime;
  // a count or write-off invalidates the ['inventory'] prefix, so a write still rereads these.
  refetchOnMount: true as const,
});

export const usedInQuery = (restaurantId: string, id: string) => ({
  queryKey: inventoryItemKeys.usedIn(restaurantId, id),
  queryFn: () => getItemUsedIn(id, restaurantId || undefined),
  staleTime: 60_000,
  retry: false as const,
  // The app default is 'always', which refetches a cache the hover just filled. `true` honours staleTime;
  // a count or write-off invalidates the ['inventory'] prefix, so a write still rereads these.
  refetchOnMount: true as const,
});

// The headline "Used in N dishes, M drinks" waits for these two as well as used-in, so a hover warms all three.
// Their keys sit under the used-in key, so one invalidation of used-in marks all three stale.
export const dishesQuery = (restaurantId: string, id: string) => ({
  queryKey: [...inventoryItemKeys.usedIn(restaurantId, id), 'dishes'] as const,
  queryFn: () => getItemDishes(id, restaurantId || undefined),
  staleTime: 60_000,
  retry: false as const,
  refetchOnMount: true as const,
});

export const drinksQuery = (restaurantId: string, id: string) => ({
  queryKey: [...inventoryItemKeys.usedIn(restaurantId, id), 'drinks'] as const,
  queryFn: () => getItemDrinks(id, restaurantId || undefined),
  staleTime: 60_000,
  retry: false as const,
  refetchOnMount: true as const,
});

/**
 * A warm cache is never wrong: a write that moves what a good is used in or what it
 * cost (a recipe saved, a line changed or deleted, a receipt verified) marks every
 * good's used-in (with its dishes and drinks), figures and the list's use counts
 * stale for this house, so the next open or hover asks again. A recipe line names
 * its good only by id inside the body, so the house's goods are marked, not one.
 */
export function invalidateItemReads(qc: QueryClient, restaurantId: string | null | undefined) {
  if (!restaurantId) return;
  void qc.invalidateQueries({ queryKey: ['inventory', 'use-counts', restaurantId] });
  void qc.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey;
      return k[0] === 'inventory' && k[1] === 'item' && k[2] === restaurantId && (k[4] === 'used-in' || k[4] === 'figures');
    },
  });
}
