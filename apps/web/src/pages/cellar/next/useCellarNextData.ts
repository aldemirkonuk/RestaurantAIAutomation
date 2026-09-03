/**
 * CellarNext data — every figure on this page comes from one of three reads,
 * and nothing is defaulted into existence.
 *
 *   GET /wines?limit=500       the book   (master_wine_library, global catalogue)
 *   GET /inventory/:rid        the building (this tenant's rows — the overlay)
 *   GET /providers?restaurantId  the vendors who can be ordered from
 *
 * What this hook deliberately does NOT do, because the legacy mapper did and it
 * was the page's worst defect (wines.md §10):
 *
 *  - it never writes `body`, `sweetness`, `acidity`, `alcohol`, `aromas` or
 *    `flavors`. Those six were hard-coded constants for all 442 rows
 *    (lib/wine-library.ts:32-37) and were exported as if measured;
 *  - it never writes `liveStock: null, threshold: 6` for a catalogue-only
 *    bottle (lib/wine-library.ts:38-39). A bottle with no inventory row has
 *    `cellar: null` — "not in the building", which is a different sentence
 *    from "we have none";
 *  - it never fabricates a provider block. `provider` is read from the real
 *    inventory row, or it is null.
 *
 * Tenancy: `/inventory` and `/providers` are keyed on `activeRestaurantId`
 * (useInventory keys its own query; providers is passed the id), so a branch
 * switch drops the previous tenant's overlay. `/wines` is deliberately NOT
 * tenant-keyed, and the precise reason matters: `master_wine_library` DOES have
 * a nullable `restaurant_id` column (baseline_from_production.sql, the
 * `CREATE TABLE public.master_wine_library` block), but it is written only by
 * `submitWine` as attribution for who proposed a row
 * (`wines.service.ts:177`) and **no read path filters on it** — `searchWines`
 * (`wines.service.ts:352-410`) never touches it. So the catalogue behaves as a
 * global library even though the column exists; the tenant-specific half of
 * every row on this page is the inventory overlay, and that half IS keyed.
 */

import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import { useWines } from '../../../hooks/queries/useWineQueries';
import { useInventory } from '../../../hooks/queries/useInventoryQueries';
import { useProviders } from '../../../hooks/queries/useProviderQueries';
import { useWineSubscription } from '../../../contexts/RealtimeContext';
import { queryKeys } from '../../../lib/query-keys';
import type { Wine } from '../../../services/api/types';
import type { Provider } from '../../../services/api/providers';
import { knowledgeOf, num, refPrice, text, type Knowledge } from './cellar-format';

/** The read limit the catalogue query asks for; shown to the reader when hit. */
export const BOOK_READ_LIMIT = 500;

/**
 * The gateway returns provenance on every `select("*")` read (wines.service.ts
 * mapWine, the `...(row.library_tier !== undefined || …)` branch), but
 * `services/api/types.ts` does not declare it. Typed here rather than widened
 * there: the shared type is outside this page's paths.
 */
type WireWine = Wine & {
  provenance?: {
    tier?: number;
    reviewStatus?: string;
    knowledge?: string;
    observedAt?: string;
  };
};

/** What the cellar actually holds for one bottle. Null when it holds none. */
export interface CellarRow {
  inventoryId: string;
  stockLive: number;
  thresholdMin: number | null;
  providerId: string | null;
  providerName: string | null;
  lastCountedAt: string | null;
}

export interface BottleVM {
  id: string;
  name: string;
  producer: string | null;
  grape: string | null;
  country: string | null;
  region: string | null;
  appellation: string | null;
  style: string | null;
  vintage: number | null;
  /** `price_reference`, with the gateway's 0-sentinel read as "unrecorded". */
  listPrice: number | null;
  /** `retail_price_avg` — null on every row today; never substituted. */
  marketPrice: number | null;
  bottleSizeMl: number | null;
  description: string | null;
  tastingNotes: string | null;
  pairingNotes: string | null;
  imageUrl: string | null;
  knowledge: Knowledge | null;
  observedAt: string | null;
  cellar: CellarRow | null;
}

function toBottle(w: WireWine, inv: Map<string, CellarRow>): BottleVM {
  return {
    id: w.id,
    name: text(w.displayName) ?? text(w.name) ?? 'Untitled bottle',
    producer: text(w.producer),
    grape: text(w.grapeVariety),
    country: text(w.country),
    region: text(w.region),
    appellation: text(w.appellation),
    style: text(w.category),
    vintage: num(w.vintage),
    listPrice: refPrice(w.price),
    marketPrice: num(w.retailPriceAvg),
    bottleSizeMl: num(w.bottleSizeMl),
    description: text(w.description),
    tastingNotes: text(w.tastingNotes),
    pairingNotes: text(w.pairingNotes),
    imageUrl: text(w.imageUrl),
    knowledge: knowledgeOf(w.provenance?.knowledge),
    observedAt: text(w.provenance?.observedAt),
    cellar: inv.get(w.id) ?? null,
  };
}

/** Everything the building holds, counted from real inventory rows only. */
export interface BuildingVM {
  /** Rows in this tenant's cellar. Null while unknown. */
  titles: number | null;
  /** Sum of `stockLive` across those rows. Null while unknown. */
  bottles: number | null;
  /** Rows at or under their own recorded minimum. Null while unknown. */
  belowPar: number | null;
  /** Rows whose wine is not in the 500 titles this read returned. */
  offBook: number | null;
}

export function useCellarNextData() {
  const { activeRestaurantId, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const winesQ = useWines({ limit: BOOK_READ_LIMIT });
  const inventoryQ = useInventory();
  const providersQ = useProviders(activeRestaurantId ?? '');

  // Live catalogue edits arrive as a `wine_update` window event from the
  // websocket bridge (RealtimeContext) — the book re-reads itself rather than
  // going stale behind an edit made elsewhere in the house.
  useWineSubscription(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.wines.all });
    }, [queryClient]),
  );

  const cellarByWine = useMemo(() => {
    if (!inventoryQ.data) return null;
    const m = new Map<string, CellarRow>();
    for (const it of inventoryQ.data) {
      if (!it.wineId) continue;
      m.set(it.wineId, {
        inventoryId: it.id,
        stockLive: num(it.stockLive) ?? 0,
        thresholdMin: num(it.thresholdMin),
        providerId: it.providerId ?? null,
        providerName: text(it.providerName),
        lastCountedAt: it.lastCountedAt ?? null,
      });
    }
    return m;
  }, [inventoryQ.data]);

  const bottles: BottleVM[] | null = useMemo(() => {
    if (!winesQ.data) return null;
    const inv = cellarByWine ?? new Map<string, CellarRow>();
    return (winesQ.data as WireWine[]).map((w) => toBottle(w, inv));
  }, [winesQ.data, cellarByWine]);

  const building: BuildingVM = useMemo(() => {
    const rows = inventoryQ.data;
    if (!rows) return { titles: null, bottles: null, belowPar: null, offBook: null };
    let bottleCount = 0;
    let below = 0;
    for (const it of rows) {
      const stock = num(it.stockLive) ?? 0;
      const min = num(it.thresholdMin);
      bottleCount += stock;
      // "Below par" is only claimable where the row states its own minimum.
      if (min !== null && stock <= min) below += 1;
    }
    const known = bottles === null ? null : new Set(bottles.map((b) => b.id));
    return {
      titles: rows.length,
      bottles: bottleCount,
      belowPar: below,
      offBook: known === null ? null : rows.filter((r) => !known.has(r.wineId)).length,
    };
  }, [inventoryQ.data, bottles]);

  const bookTruncated = (winesQ.data?.length ?? 0) >= BOOK_READ_LIMIT;

  const errorOf = (e: unknown) => (e instanceof Error ? e.message : 'no reason given');

  return {
    activeRestaurantId,
    /**
     * True while AuthContext is still resolving the session and its branches.
     * Kept separate from `activeRestaurantId === null` on purpose: on a cold
     * load the id is null for a beat even when the account HAS a branch (it is
     * in localStorage but the context has not read it back yet), and rendering
     * "no restaurant is active on this account" in that beat states a
     * permission fact that is not true. Measured live against the dev server
     * 2026-09-02: the denied state flashed on every cold load before this split.
     */
    authLoading,
    bottles,
    building,
    providers: (providersQ.data ?? null) as Provider[] | null,
    bookTruncated,

    booking: winesQ.isLoading,
    bookError: winesQ.isError ? errorOf(winesQ.error) : null,
    cellarKnown: cellarByWine !== null,
    cellarError: inventoryQ.isError ? errorOf(inventoryQ.error) : null,
    vendorsError: providersQ.isError ? errorOf(providersQ.error) : null,

    refetch: () => {
      void winesQ.refetch();
      void inventoryQ.refetch();
      void providersQ.refetch();
    },
  };
}

export type CellarData = ReturnType<typeof useCellarNextData>;
