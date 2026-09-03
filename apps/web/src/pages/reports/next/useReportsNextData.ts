/**
 * ReportsNext data layer — every figure on the sheet, and nothing else.
 *
 * Pass one hard-wired seven queries. This one reads the SHEET: whatever
 * analyses the reader has laid on the paper are the analyses that are fetched,
 * through `useQueries`, one query each so a single failure never blanks the
 * rest. Taking a cutting off stops its request; putting one on starts it. The
 * catalogue (`rp-catalogue.tsx`) owns the path and the decoder for each id, so
 * this file knows about HTTP and tenancy and nothing about analytics.
 *
 * The insight feed is fetched whether or not "The reading" is on the sheet,
 * because the ⌘K palette searches it. That is the one query the reader cannot
 * turn off, and it is stated here rather than hidden in the palette.
 *
 * Every catalogue path is behind the class-level `JwtAuthGuard`
 * (`apps/api-gateway/src/analytics/analytics.controller.ts:84`), so they go
 * through the shared `apiClient` — a raw `fetch` sends no bearer token and
 * 401s into a silently empty panel, which is exactly the failure ADR 0020
 * exists to stop. `src/__tests__/no-raw-gateway-fetch.test.ts` enforces it.
 *
 * Tenant-keying: every query key carries `activeRestaurantId`, so switching
 * restaurant refetches rather than re-labelling the previous tenant's rows.
 *
 * The honesty contract, in one line: this file NEVER substitutes a zero for a
 * missing value. The engine returns `null` for "unknown" in a dozen places
 * (`financial.inventoryValue`, `financial.cogs`, `forecast.totalForecastDemand`,
 * `menuEngineering.items[].marginPerBottle`); the catalogue's decoders preserve
 * those nulls, and the cuttings render them as em dashes.
 */

import { useCallback, useMemo } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/services/api/client';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { failureOf, num, type Failure } from './rp-format';
import { CATALOGUE, defaultGraph, graphOrDefault, type ReadingRow } from './rp-catalogue';
import {
  ANALYSIS_IDS,
  DEFAULT_ON,
  DEFAULT_SLOTS,
  isAnalysisId,
  isGraphType,
  type AnalysisId,
  type Cutting,
  type GraphType,
  type SheetState,
} from './rp-sheet';

export type { ReadingRow } from './rp-catalogue';

/* ────────────────────────────────────────────── one register's state ───── */

/**
 * A register is exactly one of four things, and the sheet renders four
 * different surfaces for them: in flight, refused, answered-and-empty,
 * answered. `loading` and `failure` are never both true.
 */
export interface Register<T> {
  data: T | undefined;
  loading: boolean;
  failure: Failure | null;
  refetch: () => void;
}

const ROOT = 'reports-next';

/* ────────────────────────────────────────────────── the sheet itself ───── */

/**
 * The arrangement is a USER preference, not tenant data — the same reader
 * keeps their sheet across restaurants — so it rides the existing per-user
 * preferences API (`PATCH /users/:id/preferences`, deep-merged server-side by
 * `user-preferences.service.ts`) under its own key. A NEW key on purpose:
 * writing to the legacy page's `dashboardBlocks` would rewrite a layout in a
 * block vocabulary the legacy canvas cannot read.
 *
 * v2 adds `g` (the drawing) and `on` (whether the cutting is on the sheet at
 * all) to each block. A v1 blob — position only, with `hidden` — still decodes:
 * the ids did not change, so an arrangement saved by the first pass survives
 * into this one with every cutting drawn its default way.
 */
const SHEET_PREF_KEY = 'reportsSheet';
const SHEET_VERSION = 2;

interface StoredBlock {
  i?: unknown;
  x?: unknown;
  y?: unknown;
  w?: unknown;
  h?: unknown;
  /** v2: the drawing this cutting is set to. */
  g?: unknown;
  /** v2: on the sheet at all. */
  on?: unknown;
  /** v1: taken off the sheet. */
  hidden?: unknown;
}

interface StoredSheet {
  v?: number;
  blocks?: StoredBlock[];
}

export function defaultSheet(): SheetState {
  return {
    cuttings: DEFAULT_ON.map((id) => ({
      id,
      slot: DEFAULT_SLOTS[id],
      graph: defaultGraph(id),
    })),
  };
}

/**
 * Decode defensively: a stored sheet is user input that has been through a
 * JSONB column. An unknown id is dropped, a missing slot falls back to its
 * default, a graph type the analysis no longer supports falls back to that
 * analysis's first truthful drawing — so adding a cutting, or withdrawing a
 * drawing that turned out to be a lie, never orphans a saved sheet, and a
 * corrupt blob degrades to the default rather than to a blank page.
 *
 * A sheet the reader deliberately emptied is NOT the same as a corrupt one:
 * an empty sheet whose blob still named known ids is honoured as empty.
 */
export function decodeSheet(stored: unknown): SheetState {
  const s = stored as StoredSheet | undefined;
  if (!s || !Array.isArray(s.blocks) || (s.v !== 1 && s.v !== 2)) return defaultSheet();
  const cuttings: Cutting[] = [];
  const seen = new Set<AnalysisId>();
  for (const b of s.blocks) {
    const id = b?.i;
    if (!isAnalysisId(id) || seen.has(id)) continue;
    seen.add(id);
    if (b?.on === false || b?.hidden === true) continue;
    const x = num(b?.x);
    const y = num(b?.y);
    const w = num(b?.w);
    const h = num(b?.h);
    const slot =
      x !== null && y !== null && w !== null && h !== null
        ? { x, y, w: Math.max(2, w), h: Math.max(2, h) }
        : DEFAULT_SLOTS[id];
    const graph = isGraphType(b?.g) ? graphOrDefault(id, b.g) : defaultGraph(id);
    cuttings.push({ id, slot, graph });
  }
  return seen.size > 0 ? { cuttings } : defaultSheet();
}

export function encodeSheet(state: SheetState): StoredSheet {
  const byId = new Map(state.cuttings.map((c) => [c.id, c]));
  return {
    v: SHEET_VERSION,
    // Every id is written, on or off, so "I took that one off" is a stored
    // fact rather than an absence a later release could read as "never seen".
    blocks: ANALYSIS_IDS.map((id) => {
      const c = byId.get(id);
      return c ? { i: id, ...c.slot, g: c.graph, on: true } : { i: id, on: false };
    }),
  };
}

/* ─────────────────────────────────────────────────────── the hook ──────── */

export interface ReportsNextData {
  restaurantId: string | null;
  /** One entry per analysis currently being read. Absent = not on the sheet. */
  registers: Partial<Record<AnalysisId, Register<unknown>>>;
  /** Always read, on the sheet or not: the ⌘K palette searches it. */
  reading: Register<ReadingRow[]>;
  /** The till window is the ONLY period control on the page — see the note. */
  tillDays: number;
  setTillDays: (days: number) => void;
  sheet: SheetState;
  saveSheet: (next: SheetState) => void;
  /** False while the preferences API has not answered — the sheet is not yet the reader's. */
  sheetKnown: boolean;
  refetchAll: () => void;
}

export function useReportsNextData(
  tillDays: number,
  setTillDays: (d: number) => void,
  /**
   * The ids on screen RIGHT NOW, when that is not yet what is saved — the
   * arrangement draft. Without it, swapping a cutting for another analysis
   * while arranging would show a skeleton until the sheet was ruled off,
   * because the fetch would still be following the saved sheet. The reader
   * must be able to see what they are choosing before they commit to it.
   */
  showing: AnalysisId[] | null = null,
): ReportsNextData {
  const { activeRestaurantId } = useAuth();
  const rid = activeRestaurantId;
  const qc = useQueryClient();
  const { preferences, updatePreferences, isLoading: prefsLoading } = useUserPreferences();

  const sheet = useMemo(() => decodeSheet(preferences?.[SHEET_PREF_KEY]), [preferences]);

  /** What is actually fetched: the sheet's readable cuttings, plus the feed
   *  the palette needs. The writing desk has no path and is never fetched. */
  const active = useMemo<AnalysisId[]>(() => {
    const ids = (showing ?? sheet.cuttings.map((c) => c.id)).filter(
      (id) => CATALOGUE[id].path !== null,
    );
    return ids.includes('reading') ? ids : ['reading', ...ids];
  }, [sheet, showing]);

  const results = useQueries({
    queries: active.map((id) => {
      const spec = CATALOGUE[id];
      return {
        queryKey: [ROOT, id, rid, spec.takesWindow ? tillDays : null],
        enabled: !!rid,
        staleTime: 60_000,
        retry: 1,
        queryFn: async () => {
          const { data } = await apiClient.get<unknown>(spec.path!(rid as string, { days: tillDays }));
          return spec.select(data);
        },
      };
    }),
  });

  const registers = useMemo(() => {
    const map: Partial<Record<AnalysisId, Register<unknown>>> = {};
    active.forEach((id, i) => {
      const q = results[i];
      if (!q) return;
      map[id] = {
        data: q.data,
        loading: q.isPending,
        failure: q.isError ? failureOf(q.error) : null,
        refetch: () => void q.refetch(),
      };
    });
    return map;
    // `results` is a fresh array each render; the ids and their states are what
    // actually matter, and recomputing a map of eight entries is free.
  }, [active, results]);

  const reading = (registers.reading ?? {
    data: undefined,
    loading: true,
    failure: null,
    refetch: () => {},
  }) as Register<ReadingRow[]>;

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
    registers,
    reading,
    tillDays,
    setTillDays,
    sheet,
    saveSheet,
    sheetKnown: !prefsLoading,
    refetchAll,
  };
}

export type { AnalysisId, Cutting, GraphType, SheetState };
