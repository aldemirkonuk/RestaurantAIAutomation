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
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../contexts/AuthContext';
import { draftId, draftKey, dropDraft } from './drafts';
import {
  ownerOf,
  recipesApi,
  type PreviewCostBody,
  type RecipeOwner,
  type SaveRecipeBody,
  type StateWeightsBody,
} from '../../../../services/api/recipes';
import { getErrorStatus } from '../../../../services/api/client';
import { managesHouse } from '../../../communications/next/cm-format';

/** A cocktail's key is `['recipes', rid, id]`; a dish's has `'dish'` before the id. */
export const recipeKey = (rid: string | null | undefined, owner: string | RecipeOwner) => {
  const o = ownerOf(owner);
  return o.kind === 'dish' ? (['recipes', rid ?? null, 'dish', o.id] as const) : (['recipes', rid ?? null, o.id] as const);
};

export const dishesKey = (rid: string | null | undefined) => ['recipes', rid ?? null, 'dishes'] as const;

/** The gateway's own sentence when it sent one, else the error's message. */
export function reason(e: unknown): string | null {
  if (!e) return null;
  const said = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof said === 'string' && said.trim()) return said.trim();
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
      // A dish's save moves its list row too (has a recipe, its cost).
      if (ownerOf(cocktailId).kind === 'dish') void qc.invalidateQueries({ queryKey: dishesKey(activeRestaurantId) });
      return qc.invalidateQueries({ queryKey: recipeKey(activeRestaurantId, cocktailId) });
    },
  });
}

/**
 * States what one piece or one ml of a good weighs (r28 gap 7). A good is in
 * many recipes, so every recipe read of the house is read again: each sheet,
 * its cost preview, and the dish list's cost per plate.
 */
export function useStateWeights() {
  const { activeRestaurantId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: StateWeightsBody }) =>
      recipesApi.stateWeights(activeRestaurantId as string, itemId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recipes', activeRestaurantId ?? null] }),
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
