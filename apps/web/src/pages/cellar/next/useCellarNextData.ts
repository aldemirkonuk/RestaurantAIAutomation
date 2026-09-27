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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import { useInventory } from '../../../hooks/queries/useInventoryQueries';
import { useProviders } from '../../../hooks/queries/useProviderQueries';
import { useWineSubscription } from '../../../contexts/RealtimeContext';
import { animate, ink } from '../../../lib/mudavym/motion';
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
  type HandlingFacts,
  type Knowledge,
  type RegisterId,
} from './cellar-format';

/** The read limit the catalogue query asks for; shown to the reader when hit. */
export const BOOK_READ_LIMIT = 500;

/**
 * Mirrors `apps/api-gateway/src/cellar/dto/hold-ceremony.ts` HOLD_CEREMONIES,
 * by hand: a web page does not import gateway code, so this vocabulary is
 * typed here too — outside `check_web_reads_gateway_dto_keys.py`'s MIRRORS
 * list on purpose, same as `provenance` and `structure` below.
 *
 * FIXED 2026-09-19 (cellar re-verification, blocking), alongside the
 * gateway's own copy: two ceremonies, not three — `hold` (the default: the
 * press-and-hold gesture, then one "are you sure?" question) and `auto` (the
 * same gesture, but the write fires the instant it completes, no follow-up
 * question). The hold is the one deliberate act in both; see
 * `hold-ceremony.ts`'s own header for the full correction and `OrderCeremony.tsx`
 * for the two shapes this renders as.
 */
export const HOLD_CEREMONIES = ['hold', 'auto'] as const;
export type HoldCeremony = (typeof HOLD_CEREMONIES)[number];

/** Mirrors the same file's `GAZETTEER_MEASURE_IDS` — the tile ids "In the building tonight" can draw. */
export const GAZETTEER_MEASURE_IDS = [
  'bottles',
  'titles',
  'par',
  'offbook',
  'parUnset',
  'registers',
] as const;
export type GazetteerMeasureId = (typeof GAZETTEER_MEASURE_IDS)[number];

/** Mirrors the gateway's own `DEFAULT_GAZETTEER_MEASURES`. */
export const DEFAULT_GAZETTEER_MEASURES: GazetteerMeasureId[] = [
  'bottles',
  'titles',
  'par',
  'offbook',
];

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
  /**
   * ADR 0160 sec110 Owed #4/#11 — "the wine's own detail". Mirrors the
   * gateway's `mapWine` `structure` block (`wines.service.ts`), flat exactly
   * as the wire sends it; `toWineStructure` below reshapes the four handling
   * fields into `WineStructureVM.handling` for the page's own use. Present
   * only when the row carried at least one of the six source columns — same
   * undefined-vs-null discipline as `provenance`.
   */
  structure?: {
    body?: string | null;
    acidity?: string | null;
    tannins?: string | null;
    sweetness?: string | null;
    primaryAromas?: string[] | null;
    servingTempCelsius?: number | null;
    glassType?: string | null;
    decantingRecommended?: boolean | null;
    agingPotentialYears?: number | null;
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
  /** Pours per bottle — the gateway's own computed default, or this row's override. Null only if the gateway omitted it. */
  glassesPerBottle: number | null;
  /** This house's own by-the-glass price — a real column a manager sets, never the library's reference price. */
  menuPriceGlass: number | null;
  /** This house's own whole-bottle price (ADR 0193: `menu_price_current`, one column) — set by a manager or a menu update, never the library's reference price. Same shape as `menuPriceGlass`. */
  menuPriceBottle: number | null;
  /** Null = unmeasured (the analytics join has nothing for this row yet), told apart from a failed read via `analyticsReadable`. */
  velocityPerDay: number | null;
  daysSinceSale: number | null;
  /**
   * False means the `inventory_analytics` join itself could not be read for
   * this batch — a failed read, distinct from a row with genuinely nothing
   * sold. Defaults `true` (matching `services/api/inventory.ts`'s own
   * default), which is the read-before-this-field behaviour, never worse.
   */
  analyticsReadable: boolean;
}

/**
 * "The wine's own detail" — ADR 0160 sec110 Owed #4/#11, sketch 121's
 * `.band`. Body/acidity/tannin/sweetness plus typical aromas, and the four
 * serving-handling facts nested under `handling` (`HandlingFacts`,
 * `cellar-format.ts`) because sketch 121 draws them as one whole-or-nothing
 * sentence, never as four independent facts.
 */
export interface WineStructureVM {
  body: string | null;
  acidity: string | null;
  tannins: string | null;
  sweetness: string | null;
  primaryAromas: string[];
  handling: HandlingFacts;
}

/** `w.structure` reshaped for the page: `null` only when the wire carried none of the six columns. */
function toWineStructure(s: WireWine['structure']): WineStructureVM | null {
  if (!s) return null;
  return {
    body: text(s.body),
    acidity: text(s.acidity),
    tannins: text(s.tannins),
    sweetness: text(s.sweetness),
    primaryAromas: Array.isArray(s.primaryAromas)
      ? s.primaryAromas.filter((a): a is string => typeof a === 'string' && a.trim() !== '')
      : [],
    handling: {
      servingTempCelsius: num(s.servingTempCelsius),
      glassType: text(s.glassType),
      decantingRecommended: typeof s.decantingRecommended === 'boolean' ? s.decantingRecommended : null,
      agingPotentialYears: num(s.agingPotentialYears),
    },
  };
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
  /** ADR 0160 sec110 Owed #4/#11 — "the wine's own detail". Null when the wire carried none of it. */
  structure: WineStructureVM | null;
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
    structure: toWineStructure(w.structure),
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
  /**
   * Rows with no `thresholdMin` recorded at all — coverage, not stock
   * health, and a different fact from `belowPar` (at-or-under a minimum the
   * row DOES record). ADR 0160 sec110 item 2's "one or two more" gazetteer
   * measures. Null while unknown.
   */
  parUnset: number | null;
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
  /**
   * The reading count per menu LINE (gateway `MenuLineTally`): how many lines
   * the register reader read, placed in a register, and could not place.
   * `null` is a menu that could not be read — never three zeroes. Optional
   * only because a readout from before the field existed does not carry it;
   * absent, the page claims nothing about menu lines at all.
   */
  menuLines?: MenuLineTallyVM | null;
}

/** Mirrors the gateway's `MenuLineTally` (cellar/cellar-registers.ts). */
export interface MenuLineTallyVM {
  read: number;
  placed: number;
  notPlaced: number;
}

/**
 * One menu line the register reader could not place — the rows behind
 * `menuLines.notPlaced`, from `GET /cellar/:rid/registers/unplaced` (OD-140,
 * founder 2026-09-25: "Separate list endpoint"). Mirrors the gateway's
 * `UnplacedMenuLinesReadout`. The gateway builds the list from the same query
 * and the same `placeMenuLine` rule as the count, and a failed read is an
 * error response, never an empty list.
 */
export interface UnplacedMenuLineVM {
  id: string;
  category: string | null;
  name: string | null;
}

export interface UnplacedMenuLinesVM {
  restaurantId: string;
  read: number;
  lines: UnplacedMenuLineVM[];
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

/* ── live: a stock move arrives before the refetch does ─────────────────── */

/**
 * THE REALTIME PATH, AND WHY THE SHIPPING ONE FELT SLOW.
 *
 * The founder: *"The realtime update must be super fast and smooth."*
 *
 * What was there. `WebsocketGateway.emitStockUpdate` pushes `stock:updated` to
 * the `restaurant:<id>` room (`websocket.gateway.ts:358-367`), the browser's
 * socket handler re-dispatches it as a window `inventory_change` CustomEvent
 * (`lib/websocket.tsx:485-498`), and `useInventory` answers by INVALIDATING the
 * inventory query (`hooks/queries/useInventoryQueries.ts:59-65`). So the row
 * only changes after a whole extra HTTP round trip to `/inventory/:rid` — the
 * socket saved nothing except the polling interval. That is the "not smooth"
 * the founder is describing, and it is an architecture, not a jank.
 *
 * What this does instead. The event already CARRIES the new figure
 * (`stock_after`), so the cached row is patched with it the moment it lands and
 * the cell repaints on the next frame. The invalidation still happens — the
 * push is a hint, the read is the truth — but it now reconciles behind a row
 * that is already correct instead of in front of one that is stale.
 *
 * TWO PRODUCERS, TWO SHAPES, ONE EVENT NAME — and this reader accepts both.
 * `lib/websocket.tsx:492` dispatches `{ inventory_id, stock_after, ... }` while
 * `contexts/RealtimeContext.tsx:376` dispatches `{ type, wineId, quantity }`.
 * Neither is wrong and neither knows about the other; a reader that assumed one
 * would silently ignore half the traffic, which is the absence-reported-as-
 * health fault wearing a socket. Filed for a single shape in the page note §9.
 *
 * TENANCY. A payload carrying a `restaurant_id` that is not the active one is
 * dropped rather than applied. The gateway rooms already scope this, but a
 * window event is a shared bus and the page does not get to assume.
 */
export interface LiveTouch {
  /** Inventory row id, when the payload named one. */
  inventoryId: string | null;
  /** Wine id, when it named that instead. */
  wineId: string | null;
  stockAfter: number | null;
  /** performance.now() at receipt — the clock the latency is measured against. */
  at: number;
}

interface WireStockEvent {
  inventory_id?: unknown;
  restaurant_id?: unknown;
  stock_after?: unknown;
  wineId?: unknown;
  quantity?: unknown;
  type?: unknown;
}

export function readStockEvent(
  detail: unknown,
  activeRestaurantId: string | null,
): LiveTouch | null {
  const d = (detail as { new?: unknown } | null)?.new ?? detail;
  if (d === null || typeof d !== 'object') return null;
  const e = d as WireStockEvent;
  const rid = typeof e.restaurant_id === 'string' ? e.restaurant_id : null;
  // A payload from another house is dropped, never applied to this one's rows.
  if (rid !== null && activeRestaurantId !== null && rid !== activeRestaurantId) {
    return null;
  }
  const inventoryId = typeof e.inventory_id === 'string' ? e.inventory_id : null;
  const wineId = typeof e.wineId === 'string' ? e.wineId : null;
  if (inventoryId === null && wineId === null) return null;
  const after =
    typeof e.stock_after === 'number'
      ? e.stock_after
      : typeof e.quantity === 'number'
        ? e.quantity
        : null;
  return { inventoryId, wineId, stockAfter: after, at: performance.now() };
}

export interface CellarLive {
  /** Inventory row ids touched since mount, newest wins. Drives the ink flash. */
  touched: Record<string, number>;
  /**
   * Milliseconds from the event landing in this tab to the frame that showed
   * it. The transport leg is measured separately and stated in MOTIONS.md —
   * this figure is the half this page is responsible for.
   */
  lastApplyMs: number | null;
}

export function useCellarLive(): CellarLive {
  const { activeRestaurantId } = useAuth();
  const queryClient = useQueryClient();
  const [touched, setTouched] = useState<Record<string, number>>({});
  const [lastApplyMs, setLastApplyMs] = useState<number | null>(null);
  const ridRef = useRef(activeRestaurantId);
  ridRef.current = activeRestaurantId;

  useEffect(() => {
    const onChange = (event: Event) => {
      const touch = readStockEvent(
        (event as CustomEvent).detail,
        ridRef.current,
      );
      if (touch === null) return;

      // The optimistic patch. Every cached inventory list for this tenant is
      // updated in place; nothing is inserted, because a row this page has
      // never read is not a row this page may invent.
      if (touch.stockAfter !== null) {
        queryClient.setQueriesData<unknown>(
          { queryKey: queryKeys.inventory.lists() },
          (old: unknown) => {
            if (!Array.isArray(old)) return old;
            let hit = false;
            const next = old.map((row) => {
              const r = row as { id?: string; wineId?: string };
              const match =
                (touch.inventoryId !== null && r.id === touch.inventoryId) ||
                (touch.wineId !== null && r.wineId === touch.wineId);
              if (!match) return row;
              hit = true;
              return { ...(row as object), stockLive: touch.stockAfter };
            });
            return hit ? next : old;
          },
        );
      }

      const key = touch.inventoryId ?? touch.wineId;
      if (key !== null) setTouched((t) => ({ ...t, [key]: Date.now() }));

      // Measured on the frame the browser actually painted, not on the line
      // after setState — a number taken before the paint is not a latency.
      requestAnimationFrame(() => {
        setLastApplyMs(Math.round(performance.now() - touch.at));
      });

      // The read is still the truth. It reconciles behind a correct row now.
      void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
    };

    window.addEventListener('inventory_change', onChange);
    return () => window.removeEventListener('inventory_change', onChange);
  }, [queryClient]);

  return { touched, lastApplyMs };
}

/**
 * The ink flash on a row a live event just moved. `ink` is the house's 160ms
 * micro-state token; nothing translates, so a row that changes under the
 * reader's eye does not push the rows below it.
 */
export function useInkOnChange(
  el: HTMLElement | null,
  stamp: number | undefined,
) {
  const seen = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (el === null || stamp === undefined || stamp === seen.current) return;
    seen.current = stamp;
    animate(
      el,
      [
        { background: 'var(--seal-tint)' },
        { background: 'transparent' },
      ],
      ink,
    );
  }, [el, stamp]);
}

/* ── the floor: zones, and whether anybody has ever looked at them ─────── */

export type ZoneProvenance = 'unconfirmed' | 'confirmed' | 'renamed' | 'created';

export interface ZoneVM {
  id: string;
  name: string;
  zone: string | null;
  section: string | null;
  capacityBottles: number | null;
  /** Counted from the inventory rows assigned to it. Null = could not count. */
  itemsAssigned: number | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  provenance: ZoneProvenance;
}

export interface ZonesVM {
  restaurantId: string;
  confirmed: ZoneVM[];
  unconfirmed: ZoneVM[];
  counts: { confirmed: number; unconfirmed: number; total: number };
  readable: boolean;
  reason: string | null;
  confirmable: boolean;
  scopeNote: string;
}

/**
 * The house's zones. Read only for the floor strip, which draws the confirmed
 * ones and counts the rest in a sentence.
 */
export function useZones() {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: ['cellar', 'zones', activeRestaurantId],
    enabled: Boolean(activeRestaurantId),
    queryFn: async (): Promise<ZonesVM> => {
      const r = await apiClient.get(`/cellar/${activeRestaurantId}/zones`);
      return r.data as ZonesVM;
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

/**
 * Confirming a zone's name, or renaming it. The actor is NOT sent: the gateway
 * takes it from the signed token, because a body cannot name who decided this.
 */
export function useConfirmZone() {
  const { activeRestaurantId } = useAuth();
  const queryClient = useQueryClient();
  const m = useMutation({
    mutationFn: async (input: { zoneId: string; name?: string }) => {
      const r = await apiClient.put(
        `/cellar/${activeRestaurantId}/zones/${input.zoneId}`,
        input.name === undefined ? {} : { name: input.name },
      );
      return r.data as { zone: ZoneVM; provenance: ZoneProvenance };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['cellar', 'zones', activeRestaurantId],
      });
    },
  });
  return {
    confirm: m.mutateAsync,
    saving: m.isPending,
    error: m.isError
      ? m.error instanceof Error
        ? m.error.message
        : 'no reason given'
      : null,
  };
}

/* ── the whole cellar at once: direction B, one flat book ───────────────── */

export interface WholeRowVM extends RegisterRowVM {
  register: RegisterId;
}

export interface WholeCellarVM {
  rows: WholeRowVM[];
  /** Per register: whether it answered, and with how many rows. */
  reads: { register: RegisterId; loading: boolean; error: string | null; rows: number | null }[];
  loading: boolean;
  /** True when at least one register could not be read — stated, never hidden. */
  partial: boolean;
}

/**
 * Every register the house carries, in one list.
 *
 * NOT FETCHED UNTIL ASKED FOR. Six register reads is a real cost and the parent
 * does not spend it on a page load nobody asked to be expensive; the section is
 * opened by a button and the reads fire then. That is also the honest shape:
 * "see everything at once" is a deliberate act, and the page says what it is
 * about to do before it does it.
 *
 * WINES ARE NOT IN HERE, and the reason is a real one rather than an omission:
 * `/wines` is served by a different endpoint with the inventory overlay laid
 * over it, so a wine row and a beer row are not the same shape. The whole-cellar
 * view says so in one line rather than pretending the shapes match — which is
 * exactly the trade direction B makes and the reason the four-child IA existed.
 */
export function useWholeCellar(
  enabled: boolean,
  carried: RegisterId[] | null,
): WholeCellarVM {
  const { activeRestaurantId } = useAuth();
  const registers = (carried ?? []).filter((r) => r !== 'wines');

  const results = useQueries({
    queries: registers.map((register) => ({
      queryKey: ['cellar', 'register', activeRestaurantId, register],
      enabled: enabled && Boolean(activeRestaurantId),
      queryFn: async (): Promise<RegisterVM> => {
        const r = await apiClient.get(
          `/beverages/${activeRestaurantId}/registers/${register}`,
        );
        return r.data as RegisterVM;
      },
    })),
  });

  return useMemo(() => {
    const rows: WholeRowVM[] = [];
    const reads: WholeCellarVM['reads'] = [];
    let loading = false;
    let partial = false;
    results.forEach((q, i) => {
      const register = registers[i];
      const error = q.isError
        ? q.error instanceof Error
          ? q.error.message
          : 'no reason given'
        : null;
      if (q.isLoading) loading = true;
      if (error !== null) partial = true;
      reads.push({
        register,
        loading: q.isLoading,
        error,
        rows: q.data ? q.data.rows.length : null,
      });
      for (const r of q.data?.rows ?? []) rows.push({ ...r, register });
    });
    return { rows, reads, loading, partial };
    // `registers` is derived from `carried` on every render; the results array
    // is the stable dependency the query client hands back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, carried]);
}

/* ── the record behind ONE row: the series a column opens ──────────────── */

export interface SeriesPointVM {
  at: string;
  value: number;
  unit: 'money' | 'count';
}

export interface LedgerEntryVM {
  at: string | null;
  label: string;
  who: string | null;
  qty: number | null;
  unitPrice: number | null;
  total: number | null;
  note: string | null;
  matchedBy: 'exact' | 'contains';
}

export interface BookRecordVM {
  book: 'menu' | 'invoice' | 'order' | 'quote' | 'pos';
  readable: boolean;
  reason: string | null;
  rows: number | null;
  price: SeriesPointVM[];
  quantity: SeriesPointVM[];
  ledger: LedgerEntryVM[];
  source: string;
}

export interface RowRecordVM {
  restaurantId: string;
  label: string;
  matchRule: string;
  books: BookRecordVM[];
  named: BookRecordVM['book'][];
  nothingNamesIt: boolean;
}

/**
 * Every line of this house's five books that names one row.
 *
 * Enabled only when a label is chosen, so opening a register costs nothing:
 * this read happens on the gesture, not on the page. Keyed by tenant AND label
 * so a branch switch cannot show the previous house's ledger under the same
 * bottle — the exact failure the tenant-keying rule exists for.
 */
export function useRowRecord(label: string | null) {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: ['cellar', 'row-record', activeRestaurantId, label],
    enabled: Boolean(activeRestaurantId) && label !== null && label.trim() !== '',
    queryFn: async (): Promise<RowRecordVM> => {
      const r = await apiClient.get(
        `/beverages/${activeRestaurantId}/row-record`,
        { params: { label } },
      );
      return r.data as RowRecordVM;
    },
  });
  return {
    data: q.data ?? null,
    loading: q.isLoading || q.isFetching,
    error: q.isError
      ? q.error instanceof Error
        ? q.error.message
        : 'no reason given'
      : null,
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

/**
 * The menu lines the register reader could not place — read only when the
 * owner asks ("Show me the N it could not place" on /cellar): the caller
 * mounts only once the disclosure is open. The list is the whole unplaced
 * part of a menu, and the count beside the control already came with the
 * registers readout. No retry: a failed read is said as a failure at once,
 * not after three silent attempts.
 */
export function useUnplacedMenuLines() {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: ['cellar', 'registers', 'unplaced', activeRestaurantId] as const,
    enabled: Boolean(activeRestaurantId),
    retry: false,
    queryFn: async (): Promise<UnplacedMenuLinesVM> => {
      const r = await apiClient.get(
        `/cellar/${encodeURIComponent(activeRestaurantId ?? '')}/registers/unplaced`,
      );
      return r.data as UnplacedMenuLinesVM;
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

/**
 * The two per-house choices `GET/PUT /cellar/:restaurantId/settings` reads
 * and writes — the order-hold ceremony (ADR 0160 sec110 item 6) and which
 * "in the building tonight" tiles show (item 2). Both live on
 * `restaurant_cellar_settings` (migration 20260922230000). Mirrors
 * `CellarSettingsService`'s own `CellarSettingsReadout` shape and its
 * unread-default fallback on the gateway side (`cellar-settings.service.ts`)
 * exactly, so a read that has not resolved yet and a read that failed both
 * hand the reader the SAME honest "hold, unconfigured" shape the server
 * itself falls back to — never a guess dressed up as a saved choice.
 * `BottleLeaf.tsx` and `CellarSection.tsx` each call this directly; it is
 * NOT threaded through `useCellarNextData()` itself, so a page that never
 * opens a bottle or Settings never pays for the read.
 */
export interface CellarSettingsVM {
  restaurantId: string;
  holdCeremony: HoldCeremony;
  /** True only once a person has actually saved a ceremony choice. */
  holdCeremonyConfigured: boolean;
  gazetteerMeasures: GazetteerMeasureId[];
  /** True only once a person has actually saved a measure list. */
  gazetteerMeasuresConfigured: boolean;
  setBy: string | null;
  setAt: string | null;
  /** False while unread or on a failed read — never true on a guess. */
  readable: boolean;
  readError: string | null;
}

export function useCellarSettings() {
  const { activeRestaurantId } = useAuth();
  const queryClient = useQueryClient();
  const key = ['cellar', 'settings', activeRestaurantId] as const;

  const q = useQuery({
    queryKey: key,
    enabled: Boolean(activeRestaurantId),
    queryFn: async (): Promise<CellarSettingsVM> => {
      const r = await apiClient.get(`/cellar/${activeRestaurantId}/settings`);
      return r.data as CellarSettingsVM;
    },
  });

  // The same unread-default the gateway itself falls back to on a missing
  // row or a failed read (`CellarSettingsService.read`) — so "never asked
  // yet" and "asked and failed" both read as the house's honest default
  // rather than as a value somebody chose.
  const fallback: CellarSettingsVM = {
    restaurantId: activeRestaurantId ?? '',
    holdCeremony: 'hold',
    holdCeremonyConfigured: false,
    gazetteerMeasures: DEFAULT_GAZETTEER_MEASURES,
    gazetteerMeasuresConfigured: false,
    setBy: null,
    setAt: null,
    readable: false,
    readError: q.isError ? (q.error instanceof Error ? q.error.message : 'no reason given') : null,
  };

  const save = useMutation({
    mutationFn: async (
      input: Partial<{ holdCeremony: HoldCeremony; gazetteerMeasures: GazetteerMeasureId[] }>,
    ): Promise<CellarSettingsVM> => {
      const r = await apiClient.put(`/cellar/${activeRestaurantId}/settings`, input);
      return r.data as CellarSettingsVM;
    },
    // The server's own readout after the write is the new truth, same
    // discipline as `useCellarRegisters`' own save — no optimistic patch of
    // what was asked for.
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });

  return {
    data: q.data ?? fallback,
    loading: q.isLoading,
    save,
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
  const live = useCellarLive();

  /**
   * The book's pagination (cellar confirmer BLOCKER, fixed). "Load 500 more"
   * used to widen a single request's `limit` by one page each press — 500,
   * then 1000 — but `GET /wines` validates `limit` against
   * `WINE_SEARCH_MAX_LIMIT` (500, `wines.dto.ts` `@Max`), so the second press
   * asked for something the gateway refuses and the book silently stopped
   * growing past 500 titles. This pages by `offset` at the SAME fixed
   * `limit` instead, straight against `apiClient` rather than through
   * `useWines`/`searchWines` — the real client contract a regression must
   * break, not a mocked hook (`cellar-book.test.tsx`). The read is also now
   * ordered by `id` as a tie-breaker (`wines.service.ts`), so paging cannot
   * see a row twice or miss one on a `name` tie.
   */
  const winesQ = useInfiniteQuery({
    queryKey: [...queryKeys.wines.all, 'book', BOOK_READ_LIMIT] as const,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<WireWine[]> => {
      const r = await apiClient.get('/wines', {
        params: { limit: BOOK_READ_LIMIT, offset: pageParam },
      });
      return r.data as WireWine[];
    },
    // A page shorter than the fixed limit IS the end of the library — never
    // requested again. A full page means there may be more; the next offset
    // is simply how many titles have been read so far.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < BOOK_READ_LIMIT
        ? undefined
        : allPages.reduce((sum, page) => sum + page.length, 0),
  });
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
        glassesPerBottle: num(it.glassesPerBottle),
        menuPriceGlass: num(it.menuPriceGlass),
        menuPriceBottle: num(it.menuPriceBottle),
        velocityPerDay: num(it.velocityPerDay),
        daysSinceSale: num(it.daysSinceSale),
        analyticsReadable: it.analyticsReadable ?? true,
      });
    }
    return m;
  }, [inventoryQ.data]);

  const bottles: BottleVM[] | null = useMemo(() => {
    if (!winesQ.data) return null;
    const inv = cellarByWine ?? new Map<string, CellarRow>();
    const rows = winesQ.data.pages.flat() as WireWine[];
    return rows.map((w) => toBottle(w, inv));
  }, [winesQ.data, cellarByWine]);

  const building: BuildingVM = useMemo(() => {
    const rows = inventoryQ.data;
    if (!rows) return { titles: null, bottles: null, belowPar: null, parUnset: null, offBook: null };
    let bottleCount = 0;
    let below = 0;
    let unset = 0;
    for (const it of rows) {
      const stock = num(it.stockLive) ?? 0;
      const min = num(it.thresholdMin);
      bottleCount += stock;
      // "Below par" is only claimable where the row states its own minimum.
      if (min !== null && stock <= min) below += 1;
      // Coverage, not stock health: a row with no par recorded at all is
      // neither "below" nor "healthy" — it is unmeasured.
      if (min === null) unset += 1;
    }
    const known = bottles === null ? null : new Set(bottles.map((b) => b.id));
    return {
      titles: rows.length,
      bottles: bottleCount,
      belowPar: below,
      parUnset: unset,
      offBook: known === null ? null : rows.filter((r) => !known.has(r.wineId)).length,
    };
  }, [inventoryQ.data, bottles]);

  // True while a full page has been read and there may be more the reader
  // has not asked for yet; false once a page shorter than the limit came
  // back, which IS the whole library, not a wall.
  const bookTruncated = winesQ.hasNextPage;
  /** How many titles the book has actually read so far, across every page loaded. */
  const bookLimit = winesQ.data
    ? winesQ.data.pages.reduce((sum, page) => sum + page.length, 0)
    : 0;

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

    /**
     * Live stock moves that have landed in this tab and been applied to the
     * cached rows already. `touched` drives the ink flash; `lastApplyMs` is the
     * measured half of the latency this page owns (event in this tab → painted
     * frame). The transport half is measured separately and stated in
     * MOTIONS.md, because a page cannot honestly claim a number it did not time.
     */
    live,

    booking: winesQ.isLoading,
    bookError: winesQ.isError ? errorOf(winesQ.error) : null,
    /** Titles read so far — equals `bottles.length`; named separately because the reader cites it beside `bookTruncated` before `bottles` has loaded at all. */
    bookLimit,
    /** True only while a SECOND (or later) page is in flight — never during the first page's own load. */
    loadingMoreBook: winesQ.isFetchingNextPage,
    /** Pages by offset at the fixed `BOOK_READ_LIMIT` — never widens `limit`. No-ops once `bookTruncated` is false. */
    loadMoreBook: () => {
      void winesQ.fetchNextPage();
    },
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
