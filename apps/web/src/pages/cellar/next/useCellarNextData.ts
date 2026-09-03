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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import { useWines } from '../../../hooks/queries/useWineQueries';
import { useInventory } from '../../../hooks/queries/useInventoryQueries';
import { useProviders } from '../../../hooks/queries/useProviderQueries';
import { useWineSubscription } from '../../../contexts/RealtimeContext';
import { queryKeys } from '../../../lib/query-keys';
import { apiClient } from '../../../services/api/client';
import type { Wine } from '../../../services/api/types';
import type { Provider } from '../../../services/api/providers';
import {
  knowledgeOf,
  num,
  refPrice,
  text,
  type Confidence,
  type DecidedBy,
  type Knowledge,
  type RegisterId,
} from './cellar-format';

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
  /**
   * The database's own classification of the row — wine / beer / spirit / sake
   * / cider / cocktail / non_alcoholic / unknown
   * (`20260817060000_beverage_kind_classification.sql:44-48`).
   *
   * It was computed by trigger from August and DROPPED by
   * `WinesService.mapWine` before it reached the browser, which is why the beer
   * and whiskey registers could not show a number at all. Carried onto the wire
   * in this pass (`apps/api-gateway/src/wines/wines.service.ts`, with a spec in
   * the same module). `undefined` means the query never selected the column —
   * a different sentence from `'unknown'`, which is the classifier's own
   * verdict.
   */
  beverageKind?: string;
  classificationStatus?: string;
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
  /**
   * What the library says this row IS. Null when the wire did not carry it —
   * never defaulted to 'wine', because a library that classified a row as beer
   * and a mapper that forgot to say so must not read the same.
   */
  beverageKind: string | null;
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
    beverageKind: text(w.beverageKind),
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

/* ── which registers this house carries ────────────────────────────────── */

/**
 * The readout from `GET /cellar/:rid/registers`, mirrored from the gateway's
 * own types (`apps/api-gateway/src/cellar/cellar-registers.service.ts`).
 *
 * Every field that can be unknown IS nullable here, and none of them defaults.
 * `carried: null` is a house nobody has asked and whose books hold nothing;
 * `inventoryRows: null` is a cellar that could not be read. Both are rendered
 * as words, never as a zero.
 */
export interface RegisterEvidenceVM {
  inventoryRows: number | null;
  menuRows: number | null;
  catalogueRows: number | null;
  nameOnly: boolean;
}

export interface RegisterReadoutVM {
  id: RegisterId;
  carried: boolean | null;
  decidedBy: DecidedBy;
  confidence: Confidence;
  basis: string;
  evidence: RegisterEvidenceVM;
  /** On, with nothing in this house's books behind it. Drives the ask. */
  needsEvidence: boolean;
  /**
   * OFF, with this house's own rows still behind it — the seasonal-menu case.
   * Null when both books were unreadable; never 0 in that case.
   */
  strandedItems: number | null;
}

export interface SourceStatusVM {
  readable: boolean;
  reason: string | null;
  rows: number | null;
}

export interface CellarRegistersVM {
  restaurantId: string;
  registers: RegisterReadoutVM[];
  carried: RegisterId[];
  decidedBy: DecidedBy | 'mixed';
  /** Null when the answers table could not be read — genuinely unknown. */
  awaitingConfirmation: boolean | null;
  needsEvidence: RegisterId[];
  /** Registers that are off with this house's items still behind them. */
  stranded: RegisterId[];
  sources: {
    answers: SourceStatusVM;
    inventory: SourceStatusVM;
    menu: SourceStatusVM;
    cocktails: SourceStatusVM;
    catalogue: SourceStatusVM;
  };
  unmappedKinds: Record<string, number>;
  unmappedCatalogueTypes: Record<string, number>;
}

/** One row of `public.beverages`, as the new gateway list returns it. */
export interface BeverageVM {
  id: string;
  beverage_type: string | null;
  name: string;
  display_name: string | null;
  producer: string | null;
  brand: string | null;
  country: string | null;
  region: string | null;
  abv_pct: number | null;
  volume_ml: number | null;
  package_format: string | null;
  price_reference: number | null;
}

export interface BeverageListVM {
  rows: BeverageVM[];
  count: number;
  truncated: boolean;
  limit: number;
  register: RegisterId | null;
  matchedTypes: string[];
  servedByThisTable: boolean;
  scope: 'tenant' | 'global-reference';
  scopeNote: string;
}

export interface CocktailVM {
  id: string;
  name: string;
  display_name: string | null;
  menu_section: string | null;
  method: string | null;
  glass: string | null;
  garnish: string | null;
  price: number | null;
  description: string | null;
}

export interface CocktailListVM {
  rows: CocktailVM[];
  count: number;
  truncated: boolean;
  referenceRows: number | null;
  recipesAvailable: false;
  scopeNote: string;
}

/* ── the house's own record on a row ───────────────────────────────────────
   Mirrored from `apps/api-gateway/src/beverages/house-record.ts`. Every field
   that can be unknown IS nullable, and a book that names a product nowhere is
   `null` rather than a zeroed block — so the row renders an em dash instead of
   a confident nought.                                                       */

export type HouseBook = 'menu' | 'invoice' | 'order' | 'quote' | 'pos';

export interface OnMenuVM {
  lines: number;
  bottlePrice: number | null;
  glassPrice: number | null;
  sections: string[];
}
export interface BoughtVM {
  lines: number;
  first: string | null;
  last: string | null;
  bottles: number | null;
  paidTotal: number | null;
  lastUnitPrice: number | null;
  lastFrom: string | null;
}
export interface OrderedVM {
  lines: number;
  lastAt: string | null;
  lastPrice: number | null;
  lastFrom: string | null;
}
export interface QuotedVM {
  count: number;
  lastAt: string | null;
  lastPrice: number | null;
  lastSource: string | null;
  lastFrom: string | null;
}
export interface PouredVM {
  lines: number;
  qty: number | null;
  revenue: number | null;
  firstAt: string | null;
  lastAt: string | null;
}
export interface HouseRecordVM {
  books: HouseBook[];
  firstSeen: string | null;
  onMenu: OnMenuVM | null;
  bought: BoughtVM | null;
  ordered: OrderedVM | null;
  quoted: QuotedVM | null;
  poured: PouredVM | null;
}

export interface CatalogueFactsVM {
  id: string;
  beverageType: string | null;
  country: string | null;
  region: string | null;
  abvPct: number | null;
  volumeMl: number | null;
  packageFormat: string | null;
  priceReference: number | null;
  /** How the house's line reached this row. Null on a catalogue-only row. */
  matchedBy: 'exact' | 'contains' | null;
}

export interface RegisterRowVM {
  key: string;
  name: string;
  producer: string | null;
  catalogue: CatalogueFactsVM | null;
  /** Null when nobody in this house has ever touched the row. */
  house: HouseRecordVM | null;
}

export interface RegisterSourceVM extends SourceStatusVM {
  truncated: boolean;
  limit: number;
}

export interface RegisterVM {
  restaurantId: string;
  register: RegisterId;
  rows: RegisterRowVM[];
  counts: {
    total: number;
    houseRows: number;
    matched: number;
    matchedLoosely: number;
    catalogueOnly: number;
  };
  catalogue: RegisterSourceVM & { matchedTypes: string[]; servedByThisTable: boolean };
  house: RegisterSourceVM;
  /**
   * OD-113, carried on the wire so the browser cannot invent a cheerier
   * sentence than the one the gateway stands behind.
   */
  stocking: { available: false; decision: 'OD-113'; reason: string };
  scopeNote: string;
  /** This house's own lines that no register in the seven can hold. */
  unregistered: { label: string; books: string[] }[];
}

/** One register, whole. The house's own rows, then the shared catalogue. */
export function useRegister(register: RegisterId | null) {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: ['cellar', 'register', activeRestaurantId, register],
    enabled: Boolean(activeRestaurantId) && register !== null && register !== 'wines',
    queryFn: async (): Promise<RegisterVM> => {
      const r = await apiClient.get(
        `/beverages/${activeRestaurantId}/registers/${register}`,
      );
      return r.data as RegisterVM;
    },
  });
  return {
    data: q.data ?? null,
    loading: q.isLoading,
    error: q.isError
      ? q.error instanceof Error
        ? q.error.message
        : 'no reason given'
      : null,
    refetch: () => void q.refetch(),
  };
}

/* ── the one register a house can write ────────────────────────────────────
   `public.cocktails` is the only table behind these registers that carries a
   `restaurant_id`, so it is the only one with a write path. There is no
   `useCreateBeverage`: inserting into the shared reference catalogue would be
   a tenant writing somebody else's table, and the register says so rather
   than rendering a button that should not exist.                            */

export interface CocktailInput {
  name?: string;
  displayName?: string;
  menuSection?: string;
  method?: string;
  glass?: string;
  garnish?: string;
  price?: number;
  description?: string;
}

export interface RecipeLineVM {
  id?: string;
  free_text?: string | null;
  freeText?: string;
  quantity?: number | null;
  unit?: string | null;
  sort_order?: number | null;
}

export function useCocktailWrites() {
  const { activeRestaurantId } = useAuth();
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['cellar', 'cocktails', activeRestaurantId] });
    void queryClient.invalidateQueries({ queryKey: ['cellar', 'register', activeRestaurantId] });
  };

  const create = useMutation({
    mutationFn: async (input: CocktailInput) => {
      const r = await apiClient.post(`/cocktails/${activeRestaurantId}`, input);
      return r.data;
    },
    onSuccess: invalidate,
  });

  const amend = useMutation({
    mutationFn: async (v: { id: string; input: CocktailInput }) => {
      const r = await apiClient.patch(
        `/cocktails/${activeRestaurantId}/${v.id}`,
        v.input,
      );
      return r.data;
    },
    onSuccess: invalidate,
  });

  const retire = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiClient.delete(`/cocktails/${activeRestaurantId}/${id}`);
      return r.data;
    },
    onSuccess: invalidate,
  });

  const setRecipe = useMutation({
    mutationFn: async (v: {
      id: string;
      lines: { freeText?: string; quantity?: number; unit?: string; sortOrder?: number }[];
    }) => {
      const r = await apiClient.put(
        `/cocktails/${activeRestaurantId}/${v.id}/ingredients`,
        { lines: v.lines },
      );
      return r.data;
    },
    onSuccess: invalidate,
  });

  return { create, amend, retire, setRecipe };
}

/** One cocktail's recipe lines. Read only when the leaf for it is open. */
export function useCocktailRecipe(cocktailId: string | null) {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: ['cellar', 'recipe', activeRestaurantId, cocktailId],
    enabled: Boolean(activeRestaurantId) && cocktailId !== null,
    queryFn: async () => {
      const r = await apiClient.get(
        `/cocktails/${activeRestaurantId}/${cocktailId}/ingredients`,
      );
      return r.data as {
        cocktailId: string;
        rows: RecipeLineVM[];
        count: number;
        writable: true;
      };
    },
  });
  return {
    data: q.data ?? null,
    loading: q.isLoading,
    error: q.isError
      ? q.error instanceof Error
        ? q.error.message
        : 'no reason given'
      : null,
  };
}

/** The read limit for a catalogue register. The response says if it was hit. */
export const CATALOGUE_READ_LIMIT = 300;

export function useCellarRegisters() {
  const { activeRestaurantId } = useAuth();
  const queryClient = useQueryClient();
  const key = ['cellar', 'registers', activeRestaurantId] as const;

  const q = useQuery({
    queryKey: key,
    enabled: Boolean(activeRestaurantId),
    queryFn: async (): Promise<CellarRegistersVM> => {
      const r = await apiClient.get(`/cellar/${activeRestaurantId}/registers`);
      return r.data as CellarRegistersVM;
    },
  });

  const save = useMutation({
    mutationFn: async (input: {
      registers: { id: RegisterId; carried: boolean }[];
      source: 'inferred' | 'confirmed' | 'manual';
    }): Promise<CellarRegistersVM> => {
      const r = await apiClient.put(
        `/cellar/${activeRestaurantId}/registers`,
        input,
      );
      return r.data as CellarRegistersVM;
    },
    // The server's own readout after the write is the new truth — the page does
    // NOT optimistically patch what it sent. A write that half-landed must show
    // what actually landed, not what was asked for.
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });

  return {
    data: q.data ?? null,
    loading: q.isLoading,
    error: q.isError
      ? q.error instanceof Error
        ? q.error.message
        : 'no reason given'
      : null,
    save,
    refetch: () => void q.refetch(),
  };
}

/** One catalogue register's rows, read only when that register is open. */
export function useBeverageRegister(register: RegisterId | null) {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: ['cellar', 'beverages', activeRestaurantId, register],
    enabled: Boolean(activeRestaurantId) && register !== null,
    queryFn: async (): Promise<BeverageListVM> => {
      const r = await apiClient.get(`/beverages/${activeRestaurantId}`, {
        params: { register, limit: CATALOGUE_READ_LIMIT },
      });
      return r.data as BeverageListVM;
    },
  });
  return {
    data: q.data ?? null,
    loading: q.isLoading,
    error: q.isError
      ? q.error instanceof Error
        ? q.error.message
        : 'no reason given'
      : null,
  };
}

export function useCocktailRegister(enabled: boolean) {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: ['cellar', 'cocktails', activeRestaurantId],
    enabled: Boolean(activeRestaurantId) && enabled,
    queryFn: async (): Promise<CocktailListVM> => {
      const r = await apiClient.get(`/cocktails/${activeRestaurantId}`, {
        params: { limit: CATALOGUE_READ_LIMIT },
      });
      return r.data as CocktailListVM;
    },
  });
  return {
    data: q.data ?? null,
    loading: q.isLoading,
    error: q.isError
      ? q.error instanceof Error
        ? q.error.message
        : 'no reason given'
      : null,
  };
}

export function useCellarNextData() {
  const { activeRestaurantId, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const registers = useCellarRegisters();

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

  /**
   * `beverage_kind` → titles, over the catalogue read this page already makes.
   * Null while the book is unread — never an empty map, which would print 0
   * beers over a read that never happened.
   */
  const libraryByKind: Map<string, number> | null = useMemo(() => {
    if (bottles === null) return null;
    const m = new Map<string, number>();
    for (const b of bottles) {
      // A row whose kind never arrived is counted as unclassified rather than
      // silently as a wine. `null` here means the wire did not carry the field.
      const k = b.beverageKind ?? '(not carried on the wire)';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [bottles]);

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

    /**
     * Which registers this house carries. Null while unread — and the parent
     * surface renders that as "still asking", never as "carries nothing".
     */
    registers: registers.data,
    registersLoading: registers.loading,
    registersError: registers.error,
    saveRegisters: registers.save,

    /**
     * What the wine library itself holds, per `beverage_kind`. This is the
     * field the gateway used to drop; it is here so a register can say how big
     * the LIBRARY is even where the house holds none of the kind. It is a
     * catalogue figure and every surface that prints it labels it as one.
     */
    libraryByKind,

    booking: winesQ.isLoading,
    bookError: winesQ.isError ? errorOf(winesQ.error) : null,
    cellarKnown: cellarByWine !== null,
    cellarError: inventoryQ.isError ? errorOf(inventoryQ.error) : null,
    vendorsError: providersQ.isError ? errorOf(providersQ.error) : null,

    refetch: () => {
      void winesQ.refetch();
      void inventoryQ.refetch();
      void providersQ.refetch();
      registers.refetch();
    },
  };
}

export type CellarData = ReturnType<typeof useCellarNextData>;
