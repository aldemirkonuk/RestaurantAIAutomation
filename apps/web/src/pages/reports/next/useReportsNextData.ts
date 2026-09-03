/**
 * ReportsNext data layer — every figure on the sheet, and nothing else.
 *
 * Eight registers, each its own query so one failure never blanks the sheet:
 *
 *   reading   GET /analytics/insights/:rid?limit=       the engine's sentences
 *   till      GET /analytics/pos-revenue/:rid?days=     POS sales (OD-85)
 *   pacing    GET /analytics/cashflow/:rid              spend pacing + projection
 *   week      GET /analytics/seasonality/:rid           weekday demand profile
 *   quadrants GET /analytics/menu-engineering/:rid      margin × velocity
 *   ahead     GET /analytics/forecast/:rid?horizon=     Holt-Winters demand
 *   ledger    GET /analytics/financial/:rid             capital efficiency
 *
 * All seven are behind a class-level `JwtAuthGuard`
 * (`apps/api-gateway/src/analytics/analytics.controller.ts:82`), so they go
 * through the shared `apiClient` — a raw `fetch` sends no bearer token and
 * 401s into a silently empty panel, which is exactly the failure ADR 0020
 * exists to stop. `src/__tests__/no-raw-gateway-fetch.test.ts` enforces it.
 *
 * Tenant-keying: every query key carries `activeRestaurantId`, so switching
 * restaurant refetches rather than re-labelling the previous tenant's rows.
 *
 * The honesty contract, in one line: this file NEVER substitutes a zero for a
 * missing value. The engine already returns `null` for "unknown" in a dozen
 * places (`financial.inventoryValue`, `posRevenue.revenue`,
 * `menuEngineering.items[].marginPerBottle`); the mapping below preserves
 * those nulls, and the components render them as em dashes.
 */

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/services/api/client';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { failureOf, num, type Failure } from './rp-format';
import { DEFAULT_SHEET, REPORT_BLOCK_IDS, type ReportBlockId, type Slot } from './rp-sheet';

/* ─────────────────────────────────────────────── gateway DTO shapes ────── */

export interface ReadingRow {
  ruleKey: string;
  sentence: string;
  category: string;
  score: number;
  entityLabel: string | null;
}

export interface TillWindow {
  posConnected: boolean;
  /** null — never 0 — when no POS has ever landed a check. */
  revenue: number | null;
  checkCount: number | null;
  from: string;
  to: string;
  days: number;
  dailySeries: Array<{ date: string; revenue: number }>;
}

export interface PacingRegister {
  basis?: { outflow?: string };
  spendLast30d: number | null;
  spendPrev30d: number | null;
  paceDeltaPct: number | null;
  projectedNext4Weeks: number[] | null;
  committedOpenOrders: number | null;
  openOrderCount: number | null;
}

export interface WeekRegister {
  weekdayProfile: Array<{ day: string; mean: number; stdev: number; n: number }>;
  bestDay: string | null;
  worstDay: string | null;
  trendPerDayPct: number | null;
}

export interface QuadrantItem {
  id: string;
  name: string;
  velocityPerDay: number;
  /** null when the row has no recorded cost — it has NO quadrant, not "dog". */
  marginPerBottle: number | null;
  marginPct: number | null;
  quadrant: string | null;
}

export interface QuadrantRegister {
  basis?: { velocity?: string; margin?: string };
  costCoverage?: { total: number; priced: number; unpriced: number; complete: boolean };
  medians: { velocityPerDay: number | null; marginPerBottle: number | null };
  counts: Record<string, number>;
  items: QuadrantItem[];
}

export interface AheadRegister {
  model: string;
  horizon: number;
  history: { dates: string[]; values: number[] };
  forecast: Array<{ date: string; value: number }>;
  totalForecastDemand: number | null;
  accuracy: { mape: number | null; scoredPoints: number; basis: string } | null;
}

export interface LedgerRegister {
  basis?: Record<string, string>;
  costCoverage?: { total: number; priced: number; unpriced: number; complete: boolean };
  inventoryValue: number | null;
  cogs: number | null;
  revenue: number | null;
  grossMargin: number | null;
  cogsRatio: number | null;
  inventoryTurnover: number | null;
  daysInventoryOutstanding: number | null;
  gmroi: number | null;
  deadStockCapital: number | null;
}

/* ────────────────────────────────────────────── one register's state ───── */

/**
 * A register is exactly one of four things, and the sheet renders four
 * different surfaces for them. `data === null` is impossible by construction:
 * a query either has not answered (loading), refused (failure), or answered.
 */
export interface Register<T> {
  data: T | undefined;
  loading: boolean;
  failure: Failure | null;
  refetch: () => void;
}

function registerOf<T>(q: UseQueryResult<T>): Register<T> {
  return {
    data: q.data,
    loading: q.isPending,
    failure: q.isError ? failureOf(q.error) : null,
    refetch: () => void q.refetch(),
  };
}

/* ───────────────────────────────────────────────────── the queries ─────── */

const ROOT = 'reports-next';

function useRegister<T>(
  rid: string | null,
  name: string,
  path: string,
  select: (raw: unknown) => T,
  extraKey: unknown = null,
): Register<T> {
  const q = useQuery<T>({
    queryKey: [ROOT, name, rid, extraKey],
    enabled: !!rid,
    staleTime: 60_000,
    retry: 1,
    queryFn: async () => {
      const { data } = await apiClient.get<unknown>(path);
      return select(data);
    },
  });
  return registerOf(q);
}

/** The engine's own sentences. Never reworded, never composed here. */
function selectReading(raw: unknown): ReadingRow[] {
  const body = (raw ?? {}) as { insights?: unknown[] };
  const rows = Array.isArray(body.insights) ? body.insights : [];
  return rows
    .map((r) => {
      const row = r as Record<string, unknown>;
      const candidate = String(row.candidate_key ?? row.candidateKey ?? '');
      const entity = String(row.entity_key ?? row.entityKey ?? '');
      return {
        ruleKey: `insight:${candidate}${entity ? `:${entity}` : ''}`,
        sentence: String(row.sentence ?? ''),
        category: String(row.category ?? 'sales'),
        score: num(row.score) ?? 0,
        entityLabel: (row.entity_label ?? row.entityLabel ?? null) as string | null,
      };
    })
    .filter((r) => r.sentence !== '')
    .sort((a, b) => b.score - a.score);
}

/* ────────────────────────────────────────────────── the sheet itself ───── */

/**
 * The arrangement is a USER preference, not tenant data — the same reader
 * keeps their sheet across restaurants — so it rides the existing per-user
 * preferences API (`PATCH /users/:id/preferences`, deep-merged server-side by
 * `user-preferences.service.ts`) under its own key. A NEW key on purpose:
 * writing to the legacy page's `dashboardBlocks` would rewrite a layout in a
 * block vocabulary the legacy canvas cannot read.
 */
const SHEET_PREF_KEY = 'reportsSheet';
const SHEET_VERSION = 1;

export interface SheetState {
  slots: Record<ReportBlockId, Slot>;
  hidden: ReportBlockId[];
}

interface StoredSheet {
  v?: number;
  blocks?: Array<{ i?: string; x?: unknown; y?: unknown; w?: unknown; h?: unknown; hidden?: unknown }>;
}

/**
 * Decode defensively: a stored sheet is user input that has been through a
 * JSONB column. An unknown id is dropped, a missing one falls back to its
 * default slot — so adding a block in a later release never orphans a saved
 * sheet, and a corrupt blob degrades to the default rather than to a blank page.
 */
export function decodeSheet(stored: unknown): SheetState {
  const slots = { ...DEFAULT_SHEET };
  const hidden: ReportBlockId[] = [];
  const s = stored as StoredSheet | undefined;
  if (!s || s.v !== SHEET_VERSION || !Array.isArray(s.blocks)) return { slots, hidden };
  for (const b of s.blocks) {
    const id = String(b?.i ?? '') as ReportBlockId;
    if (!REPORT_BLOCK_IDS.includes(id)) continue;
    const x = num(b?.x);
    const y = num(b?.y);
    const w = num(b?.w);
    const h = num(b?.h);
    if (x !== null && y !== null && w !== null && h !== null) {
      slots[id] = { x, y, w: Math.max(2, w), h: Math.max(2, h) };
    }
    if (b?.hidden === true) hidden.push(id);
  }
  return { slots, hidden };
}

export function encodeSheet(state: SheetState): StoredSheet {
  return {
    v: SHEET_VERSION,
    blocks: REPORT_BLOCK_IDS.map((id) => ({
      i: id,
      ...state.slots[id],
      hidden: state.hidden.includes(id),
    })),
  };
}

/* ─────────────────────────────────────────────────────── the hook ──────── */

export interface ReportsNextData {
  restaurantId: string | null;
  reading: Register<ReadingRow[]>;
  till: Register<TillWindow>;
  pacing: Register<PacingRegister>;
  week: Register<WeekRegister>;
  quadrants: Register<QuadrantRegister>;
  ahead: Register<AheadRegister>;
  ledger: Register<LedgerRegister>;
  /** The till window is the ONLY period control on the page — see the note. */
  tillDays: number;
  setTillDays: (days: number) => void;
  sheet: SheetState;
  saveSheet: (next: SheetState) => void;
  /** False while the preferences API has not answered — the sheet is not yet the reader's. */
  sheetKnown: boolean;
  refetchAll: () => void;
}

export function useReportsNextData(tillDays: number, setTillDays: (d: number) => void): ReportsNextData {
  const { activeRestaurantId } = useAuth();
  const rid = activeRestaurantId;
  const qc = useQueryClient();
  const { preferences, updatePreferences, isLoading: prefsLoading } = useUserPreferences();

  const reading = useRegister<ReadingRow[]>(
    rid,
    'reading',
    `/analytics/insights/${rid}?limit=40`,
    selectReading,
  );
  const till = useRegister<TillWindow>(
    rid,
    'till',
    `/analytics/pos-revenue/${rid}?days=${tillDays}`,
    (raw) => {
      const d = (raw ?? {}) as Partial<TillWindow>;
      return {
        posConnected: d.posConnected === true,
        revenue: num(d.revenue),
        checkCount: num(d.checkCount),
        from: String(d.from ?? ''),
        to: String(d.to ?? ''),
        days: num(d.days) ?? tillDays,
        dailySeries: Array.isArray(d.dailySeries) ? d.dailySeries : [],
      };
    },
    tillDays,
  );
  const pacing = useRegister<PacingRegister>(rid, 'pacing', `/analytics/cashflow/${rid}`, (raw) => {
    const d = (raw ?? {}) as Record<string, unknown>;
    return {
      basis: d.basis as PacingRegister['basis'],
      spendLast30d: num(d.spendLast30d),
      spendPrev30d: num(d.spendPrev30d),
      paceDeltaPct: num(d.paceDeltaPct),
      projectedNext4Weeks: Array.isArray(d.projectedNext4Weeks)
        ? (d.projectedNext4Weeks as number[])
        : null,
      committedOpenOrders: num(d.committedOpenOrders),
      openOrderCount: num(d.openOrderCount),
    };
  });
  const week = useRegister<WeekRegister>(rid, 'week', `/analytics/seasonality/${rid}`, (raw) => {
    const d = (raw ?? {}) as Record<string, unknown>;
    return {
      weekdayProfile: Array.isArray(d.weekdayProfile)
        ? (d.weekdayProfile as WeekRegister['weekdayProfile'])
        : [],
      bestDay: (d.bestDay ?? null) as string | null,
      worstDay: (d.worstDay ?? null) as string | null,
      trendPerDayPct: num(d.trendPerDayPct),
    };
  });
  const quadrants = useRegister<QuadrantRegister>(
    rid,
    'quadrants',
    `/analytics/menu-engineering/${rid}`,
    (raw) => {
      const d = (raw ?? {}) as Record<string, unknown>;
      const items = Array.isArray(d.items) ? (d.items as Record<string, unknown>[]) : [];
      return {
        basis: d.basis as QuadrantRegister['basis'],
        costCoverage: d.costCoverage as QuadrantRegister['costCoverage'],
        medians: {
          velocityPerDay: num((d.medians as Record<string, unknown>)?.velocityPerDay),
          marginPerBottle: num((d.medians as Record<string, unknown>)?.marginPerBottle),
        },
        counts: (d.counts ?? {}) as Record<string, number>,
        items: items.map((i) => ({
          id: String(i.id ?? ''),
          name: String(i.name ?? ''),
          velocityPerDay: num(i.velocityPerDay) ?? 0,
          marginPerBottle: num(i.marginPerBottle),
          marginPct: num(i.marginPct),
          quadrant: (i.quadrant ?? null) as string | null,
        })),
      };
    },
  );
  const ahead = useRegister<AheadRegister>(
    rid,
    'ahead',
    `/analytics/forecast/${rid}?horizon=14`,
    (raw) => {
      const d = (raw ?? {}) as Record<string, unknown>;
      const h = (d.history ?? {}) as Record<string, unknown>;
      return {
        model: String(d.model ?? ''),
        horizon: num(d.horizon) ?? 14,
        history: {
          dates: Array.isArray(h.dates) ? (h.dates as string[]) : [],
          values: Array.isArray(h.values) ? (h.values as number[]) : [],
        },
        forecast: Array.isArray(d.forecast) ? (d.forecast as AheadRegister['forecast']) : [],
        totalForecastDemand: num(d.totalForecastDemand),
        accuracy: (d.accuracy ?? null) as AheadRegister['accuracy'],
      };
    },
  );
  const ledger = useRegister<LedgerRegister>(rid, 'ledger', `/analytics/financial/${rid}`, (raw) => {
    const d = (raw ?? {}) as Record<string, unknown>;
    return {
      basis: d.basis as Record<string, string>,
      costCoverage: d.costCoverage as LedgerRegister['costCoverage'],
      inventoryValue: num(d.inventoryValue),
      cogs: num(d.cogs),
      revenue: num(d.revenue),
      grossMargin: num(d.grossMargin),
      cogsRatio: num(d.cogsRatio),
      inventoryTurnover: num(d.inventoryTurnover),
      daysInventoryOutstanding: num(d.daysInventoryOutstanding),
      gmroi: num(d.gmroi),
      deadStockCapital: num(d.deadStockCapital),
    };
  });

  const sheet = useMemo(() => decodeSheet(preferences?.[SHEET_PREF_KEY]), [preferences]);

  const saveSheet = useCallback(
    (next: SheetState) => {
      updatePreferences({ [SHEET_PREF_KEY]: encodeSheet(next) });
    },
    [updatePreferences],
  );

  const refetchAll = useCallback(() => {
    void qc.invalidateQueries({ queryKey: [ROOT] });
  }, [qc]);

  return {
    restaurantId: rid,
    reading,
    till,
    pacing,
    week,
    quadrants,
    ahead,
    ledger,
    tillDays,
    setTillDays,
    sheet,
    saveSheet,
    sheetKnown: !prefsLoading,
    refetchAll,
  };
}
