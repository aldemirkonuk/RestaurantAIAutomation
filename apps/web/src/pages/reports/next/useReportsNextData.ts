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
 * (`apps/api-gateway/src/analytics/analytics.controller.ts:85`), so they go
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
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/services/api/client';
import { settingsApi } from '@/services/api/settings';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { failureOf, heldBackFailure, num, type Failure } from './rp-format';
import { CATALOGUE, defaultGraph, graphOrDefault, type ReadingRow } from './rp-catalogue';
import { readsRegister } from './rp-spec';
import { useGoalsDesk, type GoalsDesk } from './useGoalsDesk';
import { useReportExports, type ExportDesk } from './useReportExports';
import {
  ANALYSIS_IDS,
  DEFAULT_ON,
  DEFAULT_SLOTS,
  IDS_ADDED_IN_V3,
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

/** Exported so a write elsewhere (`useGoalsDesk`) can invalidate this read. */
export const ROOT = 'reports-next';

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

/**
 * v3 adds two analyses — the goals desk and the benchmark — and one rule about
 * what a MISSING id means. `encodeSheet` writes every id, on or off, so an id
 * that is absent from a stored blob cannot mean "the reader took it off": it
 * can only mean the analysis did not exist when that sheet was written. Those
 * are put back on (`IDS_ADDED_IN_V3`), which is why a reader who ruled off a
 * sheet last week still gets the goals desk the founder asked to be visible,
 * without a reader who deliberately took a cutting off having it forced back.
 */
const SHEET_PREF_KEY_VERSIONS = [1, 2, 3, 4];
/** v4: block order is the narrow reading order (`projectCuttings`). */
const SHEET_VERSION = 4;

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
  if (!s || !Array.isArray(s.blocks) || !SHEET_PREF_KEY_VERSIONS.includes(Number(s.v)))
    return defaultSheet();
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
  if (seen.size === 0) return defaultSheet();

  // An analysis introduced after this blob was written was never offered to
  // this reader, so its absence is not a decision. It lands at the foot, where
  // it cannot appear underneath something already being read.
  if (Number(s.v) < 3) {
    let foot = cuttings.reduce((m, c) => Math.max(m, c.slot.y + c.slot.h), 0);
    for (const id of IDS_ADDED_IN_V3) {
      if (seen.has(id)) continue;
      const slot = { ...DEFAULT_SLOTS[id], x: 0, y: foot };
      cuttings.push({ id, slot, graph: defaultGraph(id) });
      foot += slot.h;
    }
  }
  // Before v4 the blocks were written in catalogue order, which says nothing;
  // the reading order then was the wide sheet's, row then column.
  if (Number(s.v) < 4) cuttings.sort((a, b) => a.slot.y - b.slot.y || a.slot.x - b.slot.x);
  return { cuttings };
}

export function encodeSheet(state: SheetState): StoredSheet {
  const on = new Set(state.cuttings.map((c) => c.id));
  return {
    v: SHEET_VERSION,
    // The cuttings go first and in the sheet's own order: on a narrow ruling
    // two row-mates are clamped to the same column and the grid breaks the tie
    // by list order, so the order is the phone's reading order and must
    // survive a save (`liftCuttings`). Every id is still written, on or off,
    // so "I took that one off" is a stored fact rather than an absence a later
    // release could read as "never seen".
    blocks: [
      ...state.cuttings.map((c) => ({
        i: c.id,
        ...c.slot,
        g: c.graph,
        on: true,
      })),
      ...ANALYSIS_IDS.filter((id) => !on.has(id)).map((id) => ({
        i: id,
        on: false,
      })),
    ],
  };
}

/* ─────────────────────────────────────────────────────── the hook ──────── */

export interface ReportsNextData {
  restaurantId: string | null;
  /**
   * The goals desk's writes. It lives behind this hook rather than beside it so
   * the page has exactly ONE data seam: everything the page does to the
   * gateway — every read and the four writes — arrives through here, which is
   * what lets the render-contract tests hold the page still by mocking one
   * thing (`ReportsNext.test.tsx`).
   */
  goalsDesk: GoalsDesk;
  /**
   * The export desk (OD-81): a cutting written up by the gateway to a CSV and a
   * print page, with the status the server holds. Behind this seam for the same
   * reason as the goals desk.
   */
  exportDesk: ExportDesk;
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
  /**
   * The house's money, three states (`HouseCurrency`, services/api/settings.ts):
   * `stated` with a code; `unstated` (nobody recorded one); `unread` (the read
   * failed, or has not answered yet). Only `stated` prints a currency mark.
   */
  currency: HouseMoney;
  refetchAll: () => void;
}

export type HouseMoney =
  | { state: 'stated'; code: string }
  | { state: 'unstated'; code: null }
  | { state: 'unread'; code: null; pending: boolean };

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
  /** Puts a cutting the goals desk proposed onto the page's draft sheet. */
  placeCutting: (cut: { id: AnalysisId; graph: GraphType; days: number | null }) => void = () => {},
): ReportsNextData {
  const { activeRestaurantId, activeRole } = useAuth();
  const rid = activeRestaurantId;
  const qc = useQueryClient();
  const { preferences, updatePreferences, isLoading: prefsLoading } = useUserPreferences();

  const sheet = useMemo(() => decodeSheet(preferences?.[SHEET_PREF_KEY]), [preferences]);

  /** What is actually fetched: the sheet's readable cuttings, plus the feed
   *  the palette needs. The writing desk has no path and is never fetched. */
  const active = useMemo<AnalysisId[]>(() => {
    const ids = (showing ?? sheet.cuttings.map((c) => c.id)).filter(
      (id) => readsRegister(CATALOGUE[id]),
    );
    return ids.includes('reading') ? ids : ['reading', ...ids];
  }, [sheet, showing]);

  /**
   * The registers this reader is not sent (ADR 0348). A spec that names its
   * readers (`readers`, the endpoint's `@Roles`) is asked for only when the
   * house role is known and listed. Staff keep the page and every register
   * open to them; a held-back one says who it is written for and fires no
   * request, so the gateway's 403 is never walked into and nothing is retried.
   * The role read is `activeRole` alone, the role RolesGuard checks, never the
   * account-wide `user.role`, as `useReportExports` and `useGoalsDesk` do.
   */
  const heldBack = useMemo(() => {
    const out = new Set<AnalysisId>();
    for (const id of active) {
      const readers = CATALOGUE[id].readers;
      if (readers && (activeRole === null || !readers.includes(activeRole))) out.add(id);
    }
    return out;
  }, [active, activeRole]);

  /**
   * One raw payload per URL, shared by every register that reads it, so the
   * bench and spend pacing (both on /analytics/cashflow) cost one request
   * (audit G9). Same freshness as the registers.
   */
  const readRaw = (url: string) =>
    qc.fetchQuery({
      queryKey: [ROOT, 'raw', url],
      queryFn: async () => (await apiClient.get<unknown>(url)).data,
      staleTime: 60_000,
    });

  const results = useQueries({
    queries: active.map((id) => {
      const spec = CATALOGUE[id];
      return {
        queryKey: [ROOT, id, rid, spec.takesWindow ? tillDays : null],
        enabled: !!rid && !heldBack.has(id),
        staleTime: 60_000,
        retry: 1,
        queryFn: async () => {
          const ctx = { days: tillDays };
          if (spec.sources) {
            // A composed register (the bench): each source read once per
            // minute however many cuttings share it; a failed source is null,
            // which the register says, never a zero.
            const keys = Object.keys(spec.sources);
            const settled = await Promise.allSettled(
              keys.map((k) => readRaw(spec.sources![k](rid as string, ctx))),
            );
            return spec.select(
              Object.fromEntries(
                keys.map((k, i) => {
                  const r = settled[i];
                  return [k, r.status === 'fulfilled' ? r.value : null];
                }),
              ),
            );
          }
          return spec.select(await readRaw(spec.path!(rid as string, ctx)));
        },
      };
    }),
  });

  const registers = useMemo(() => {
    const map: Partial<Record<AnalysisId, Register<unknown>>> = {};
    active.forEach((id, i) => {
      const q = results[i];
      if (!q) return;
      const readers = CATALOGUE[id].readers;
      if (readers && heldBack.has(id)) {
        // Not in flight, not refused by the gateway, not empty: withheld.
        map[id] = {
          data: undefined,
          loading: false,
          failure: heldBackFailure(readers, activeRole),
          refetch: () => {},
        };
        return;
      }
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
  }, [active, results, heldBack, activeRole]);

  // One small read, cached with the registers, so every money figure on the
  // sheet prints in the house's own currency rather than `$` (audit G5).
  const currencyQuery = useQuery({
    queryKey: [ROOT, 'currency', rid],
    enabled: !!rid,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: () => settingsApi.houseCurrency(),
  });
  const currency = useMemo<HouseMoney>(() => {
    const c = currencyQuery.data;
    if (c && c.readable && typeof c.code === 'string' && /^[A-Z]{3}$/.test(c.code))
      return { state: 'stated', code: c.code };
    if (c && c.readable && c.code === null) return { state: 'unstated', code: null };
    return { state: 'unread', code: null, pending: currencyQuery.isPending };
  }, [currencyQuery.data, currencyQuery.isPending]);

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

  const goalsDesk = useGoalsDesk({ place: placeCutting, queryRoot: ROOT });
  const exportDesk = useReportExports({ queryRoot: ROOT });

  return {
    restaurantId: rid,
    goalsDesk,
    exportDesk,
    registers,
    reading,
    tillDays,
    setTillDays,
    sheet,
    saveSheet,
    sheetKnown: !prefsLoading,
    currency,
    refetchAll,
  };
}

export type { AnalysisId, Cutting, GraphType, SheetState };
