/**
 * The recipe sheet's reads and its one write.
 *
 * Keys are tenant-first, as `useCellarNextData.ts` keys the cellar's own reads
 * (`['cellar', 'register', activeRestaurantId, …]`), so a house switch never
 * shows the previous house's recipe or shelf:
 *   ['recipes', activeRestaurantId, cocktailId]              the drink's recipe
 *   ['recipes', activeRestaurantId, cocktailId, 'versions']  its saved versions
 *   ['recipes', 'shelf', activeRestaurantId, search]         the shelf picker
 *
 * A save invalidates `['recipes', rid, cid]`, which also covers the versions
 * key under it, so the sheet re-reads the saved lines and their costs at once
 * (gap G8) instead of waiting for a page reload.
 */
import { useEffect, useState } from 'react';
import { invalidateItemReads } from '../../../inventory/next/item-queries';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../contexts/AuthContext';
import { draftId, draftKey, dropDraft } from './drafts';
import { dishesApi, ownerOf, recipesApi, type DishBody, type DishChange, type MenuPrice, type PreviewCostBody, type RecipeOwner, type SaveRecipeBody } from '../../../../services/api/recipes';
import { getErrorStatus } from '../../../../services/api/client';
import { isUnreachable } from '../../../../lib/unreachable';
import { managesHouse } from '../../../communications/next/cm-format';

/** A cocktail's key is `['recipes', rid, id]`; a dish's has `'dish'` before the id. */
export const recipeKey = (rid: string | null | undefined, owner: string | RecipeOwner) => {
  const o = ownerOf(owner);
  return o.kind === 'dish' ? (['recipes', rid ?? null, 'dish', o.id] as const) : (['recipes', rid ?? null, o.id] as const);
};

export const dishesKey = (rid: string | null | undefined) => ['recipes', rid ?? null, 'dishes'] as const;

/**
 * The cocktail list's figures. Under the list's own key, so a drink added,
 * amended or retired refreshes its cost with it.
 */
export const drinkFiguresKey = (rid: string | null | undefined) => ['cellar', 'cocktails', rid ?? null, 'figures'] as const;

/**
 * How long a list's figures (costs, menu prices) are used as read before a
 * page mounted again reads them again. Every write that moves them (a recipe
 * saved, a drink or dish changed) invalidates them at once; this only stops a
 * return to the tab, or a remount, from re-pricing the whole house (App.tsx's
 * `refetchOnMount: 'always'` ignored any staleTime; r41 recipes audit, gap 5).
 */
export const LIST_FIGURES_FRESH_MS = 60_000;

/**
 * Every drink's cost a serve, for the cost and pour cost columns of
 * /cocktails. Read only for a role that sees the house's money.
 */
export function useDrinkFigures(enabled: boolean) {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: drinkFiguresKey(activeRestaurantId),
    enabled: Boolean(enabled && activeRestaurantId),
    queryFn: () => dishesApi.drinkFigures(activeRestaurantId as string),
    staleTime: LIST_FIGURES_FRESH_MS,
    refetchOnMount: true,
  });
  return {
    // A failed re-read keeps the last figures in the cache; they are not shown
    // beside the sentence that says none is shown, so an error blanks them.
    byId: q.data && !q.isError ? new Map(q.data.drinks.map((d) => [d.cocktailId, d])) : null,
    // The gateway read the drinks but could not price them: every cost is null.
    costsUnread: q.data && !q.isError ? q.data.costsUnread : false,
    loading: q.isLoading,
    error: q.isError ? reason(q.error) : null,
  };
}

/**
 * Where a list's menu prices are kept. Under the list's own key, so a dish or
 * drink added or changed (its name or its price) is read against the menu
 * again with it.
 */
export const menuPricesKey = (rid: string | null | undefined, side: 'dish' | 'drink') =>
  side === 'dish'
    ? ([...dishesKey(rid), 'menu-prices'] as const)
    : (['cellar', 'cocktails', rid ?? null, 'menu-prices'] as const);

/**
 * The current menu's price beside each dish or drink (r28 recipes audit,
 * gap 2). Read only for a role that sees the house's money. `byId` is null
 * until read; `currentMenus` 0 means no menu is current, so nothing compares.
 */
export function useMenuPrices(side: 'dish' | 'drink', enabled: boolean) {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: menuPricesKey(activeRestaurantId, side),
    enabled: Boolean(enabled && activeRestaurantId),
    queryFn: () => dishesApi.menuPrices(activeRestaurantId as string),
    staleTime: LIST_FIGURES_FRESH_MS,
    refetchOnMount: true,
  });
  // A read that fails after an earlier one answered leaves that older answer
  // in the cache. It is not shown: the page says the menu could not be read.
  const d = q.isError ? undefined : q.data;
  // An answer without its lists (an older gateway, a stub) compares nothing.
  const rows = d ? (side === 'dish' ? d.dishes : d.drinks) : null;
  const byId: Map<string, MenuPrice> | null = Array.isArray(rows)
    ? new Map(rows.map((x) => ['dishId' in x ? x.dishId : x.cocktailId, x.menu] as [string, MenuPrice]))
    : null;
  return {
    byId,
    currentMenus: byId && typeof d?.currentMenus === 'number' ? d.currentMenus : null,
    error: q.isError ? reason(q.error) : null,
  };
}

/** The house's dishes, by name: one read, nothing priced (their figures are `useDishFigures`). */
export function useDishes() {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: dishesKey(activeRestaurantId),
    enabled: Boolean(activeRestaurantId),
    queryFn: () => dishesApi.list(activeRestaurantId as string),
    staleTime: LIST_FIGURES_FRESH_MS,
    refetchOnMount: true,
  });
  return {
    data: q.data ?? null,
    loading: q.isLoading,
    error: q.isError ? reason(q.error) : null,
    refetch: q.refetch,
  };
}

/**
 * Under the list's own key, so every write that invalidates the dishes (a dish
 * added or changed, a recipe saved) reads the figures again with them.
 */
export const dishFiguresKey = (rid: string | null | undefined) => [...dishesKey(rid), 'figures'] as const;

/**
 * Every dish's cost a plate, whether it has a recipe, and its allergens, read
 * beside the names so the list never waits for the pricing (r41 recipes
 * audit, gap 2). Read for every role: allergens are not money. `costsUnread`
 * is a failed pricing read that kept everything else (gap 3); `error` is a
 * figures read that failed whole, which blanks only the figures.
 */
export function useDishFigures() {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: dishFiguresKey(activeRestaurantId),
    enabled: Boolean(activeRestaurantId),
    queryFn: () => dishesApi.dishFigures(activeRestaurantId as string),
    staleTime: LIST_FIGURES_FRESH_MS,
    refetchOnMount: true,
  });
  // A failed re-read keeps the last answer in the cache; it is not shown
  // beside the sentence that says none is shown.
  const d = q.isError ? undefined : q.data;
  return {
    byId: d ? new Map(d.dishes.map((f) => [f.dishId, f])) : null,
    costsUnread: d ? d.costsUnread : false,
    loading: q.isLoading,
    error: q.isError ? reason(q.error) : null,
  };
}

export function useCreateDish() {
  const { activeRestaurantId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DishBody) => dishesApi.create(activeRestaurantId as string, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: dishesKey(activeRestaurantId) }),
  });
}

/**
 * Change a dish's name, section or price. The list and the dish's own sheet
 * both read the price, so every recipe read of the house is refreshed.
 */
export function useUpdateDish(dishId: string) {
  const { activeRestaurantId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DishChange) => dishesApi.update(activeRestaurantId as string, dishId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recipes', activeRestaurantId ?? null] }),
  });
}

/** Set many dishes to the current menu's prices; every list and figure is read again. */
export function useTakeMenuPrices() {
  const { activeRestaurantId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => dishesApi.takeMenuPrices(activeRestaurantId as string, ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recipes', activeRestaurantId ?? null] }),
  });
}

/** Take the dishes the current menu does not print off the list; every list and figure is read again. */
export function useTakeOffMenu() {
  const { activeRestaurantId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => dishesApi.takeOffMenu(activeRestaurantId as string, ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recipes', activeRestaurantId ?? null] }),
  });
}

/** Take a dish off the list; the list is read again. */
export function useRemoveDish(dishId: string) {
  const { activeRestaurantId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => dishesApi.remove(activeRestaurantId as string, dishId),
    onSuccess: () => {
      // A removed dish stops using its goods: their "Used in" must not stay warm.
      invalidateItemReads(qc, activeRestaurantId);
      return qc.invalidateQueries({ queryKey: dishesKey(activeRestaurantId) });
    },
  });
}

/** The gateway's own sentence when it sent one, else the error's message. */
export function reason(e: unknown): string | null {
  if (!e) return null;
  const said = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof said === 'string' && said.trim()) return said.trim();
  // The transport's own words ("Network Error") say nothing to a person: the
  // request never got an answer, so say that.
  const sent = e as { code?: unknown; response?: unknown };
  if (sent.code === 'ERR_NETWORK' && !sent.response) return 'Mudavym could not be reached just now.';
  return e instanceof Error ? e.message : 'no reason given';
}

/**
 * The drink's recipe. `data` stays the last good read when a later re-read
 * fails, and `error` then says so; the sheet decides how to show both.
 */
export function useRecipe(cocktailId: string | RecipeOwner) {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: recipeKey(activeRestaurantId, cocktailId),
    enabled: Boolean(activeRestaurantId && cocktailId),
    queryFn: () => recipesApi.get(activeRestaurantId as string, cocktailId),
  });
  return {
    data: q.data ?? null,
    loading: q.isLoading,
    fetching: q.isFetching,
    error: q.isError ? reason(q.error) : null,
    /** The read got no answer at all (the gateway or the network is down): said in words, never as the transport's "Network Error". */
    unreachable: q.isError && isUnreachable(q.error),
    /** The HTTP status of a failed read; 404 means the drink is gone from this house. */
    status: q.isError ? getErrorStatus(q.error) : null,
    refetch: q.refetch,
  };
}

export function useRecipeVersions(cocktailId: string | RecipeOwner, enabled: boolean) {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: [...recipeKey(activeRestaurantId, cocktailId), 'versions'],
    enabled: enabled && Boolean(activeRestaurantId && cocktailId),
    queryFn: () => recipesApi.versions(activeRestaurantId as string, cocktailId),
  });
  return { data: q.data ?? null, loading: q.isLoading && enabled, error: q.isError ? reason(q.error) : null };
}

/** One earlier version's lines, read only when it is opened (round 17 D8). */
export function useRecipeVersion(cocktailId: string | RecipeOwner, versionId: string, enabled: boolean) {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: [...recipeKey(activeRestaurantId, cocktailId), 'versions', versionId],
    enabled: enabled && Boolean(activeRestaurantId && cocktailId && versionId),
    queryFn: () => recipesApi.version(activeRestaurantId as string, cocktailId, versionId),
    staleTime: 60_000,
  });
  return { data: q.data ?? null, loading: q.isLoading && enabled, error: q.isError ? reason(q.error) : null };
}

/** How long the draft must sit still before it is priced. */
export const PREVIEW_DEBOUNCE_MS = 400;

/**
 * What the unsaved draft would cost at today's prices, asked of the gateway
 * (which owns the unit table and the pricing; the web never prices). `body`
 * is null whenever the draft is not complete enough to price: then nothing is
 * asked. The ask waits for the draft to sit still, is keyed on the draft
 * itself so the same draft is never asked twice, and only ever answers for
 * the draft on the sheet now. A failed or pending ask returns null, and the
 * sheet keeps showing the saved figures.
 */
export function useCostPreview(cocktailId: string | RecipeOwner, body: PreviewCostBody | null) {
  const { activeRestaurantId } = useAuth();
  const key = body ? JSON.stringify(body) : null;
  const [settled, setSettled] = useState<string | null>(key);
  useEffect(() => {
    if (key === null) {
      setSettled(null);
      return;
    }
    const t = setTimeout(() => setSettled(key), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [key]);
  const ready = key !== null && settled === key;
  const q = useQuery({
    queryKey: [...recipeKey(activeRestaurantId, cocktailId), 'cost-preview', settled],
    enabled: ready && Boolean(activeRestaurantId && cocktailId),
    queryFn: () => recipesApi.previewCost(activeRestaurantId as string, cocktailId, JSON.parse(settled as string) as PreviewCostBody),
    staleTime: 60_000,
    retry: false,
  });
  return ready && q.isSuccess ? q.data : null;
}

export function useShelf(search: string, enabled: boolean) {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: ['recipes', 'shelf', activeRestaurantId ?? null, search],
    enabled: enabled && Boolean(activeRestaurantId),
    queryFn: () => recipesApi.shelf(activeRestaurantId as string, search),
    staleTime: 30_000,
  });
  return { data: q.data ?? null, loading: q.isLoading && enabled, error: q.isError ? reason(q.error) : null };
}

export function useSaveRecipe(cocktailId: string | RecipeOwner) {
  const { activeRestaurantId, user } = useAuth();
  const qc = useQueryClient();
  const storeKey = draftKey(user?.userId, activeRestaurantId, draftId(cocktailId));
  return useMutation({
    mutationFn: (body: SaveRecipeBody) => recipesApi.save(activeRestaurantId as string, cocktailId, body),
    // Here, not in the sheet: a save that finishes after the sheet was left
    // must still clear its draft, or the leave warning fires for saved work.
    onSuccess: () => {
      dropDraft(storeKey);
      // The goods this recipe names (and those it no longer names) change their "Used in".
      invalidateItemReads(qc, activeRestaurantId);
      // A dish's save moves its list row too (has a recipe, its cost).
      if (ownerOf(cocktailId).kind === 'dish') void qc.invalidateQueries({ queryKey: dishesKey(activeRestaurantId) });
      // A drink's save moves its cost on the cocktail list.
      else void qc.invalidateQueries({ queryKey: drinkFiguresKey(activeRestaurantId) });
      return qc.invalidateQueries({ queryKey: recipeKey(activeRestaurantId, cocktailId) });
    },
  });
}

/**
 * Who may change a recipe, and so who sees its money: an owner or manager of
 * THIS house. Read exactly as
 * /communications reads it (`managesHouse`, COMMS-W31): the role in the
 * session's house first, the account's role only while no house is active,
 * and a missing role counts as staff. The gateway refuses the write anyway;
 * this only keeps a control off the screen that would be refused.
 */
export function useCanEditRecipe(): boolean {
  const { activeRole, user } = useAuth();
  return managesHouse(activeRole, user?.role);
}

/**
 * The house's money: the cellar's one hook (`../useHouseMoney`), re-exported
 * so the sheet and the cocktail list keep importing it from here. It lived
 * here until the whole cellar moved onto it (r9, 2026-11-12); one copy, so
 * the sheet and the cellar can never say one figure two ways.
 */
export { useHouseMoney } from '../useHouseMoney';
