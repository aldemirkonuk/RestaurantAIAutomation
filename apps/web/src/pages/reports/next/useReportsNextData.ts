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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/services/api/client';
import { settingsApi } from '@/services/api/settings';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { useAuthStore } from '@/stores/authStore';
import { failureOf, failureReason, heldBackFailure, num, type Failure } from './rp-format';
import { CATALOGUE, defaultGraph, graphOrDefault, type ReadingRow } from './rp-catalogue';
import { readsRegister, type HouseRole } from './rp-spec';
import { defaultIdsFor } from './rp-readable';
import type { ComboPick } from './rp-combo';
import { useGoalsDesk, type GoalsDesk } from './useGoalsDesk';
import { useReportExports, type ExportDesk } from './useReportExports';
import { sameOwner, warmRead, warmWrite, type WarmOwner } from './rp-warm';
import {
  ANALYSIS_IDS,
  DEFAULT_SLOTS,
  IDS_ADDED_IN_V3,
  isAnalysisId,
  isGraphType,
  SHEET_MIN_H,
  SHEET_MIN_W,
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
  /**
   * Set while a till window just picked is still being read (r41 gap 4): the
   * figures in `data` are the window read before it, for this house, kept on
   * screen so the chart does not blank to a skeleton. The cutting draws them
   * over `shownDays` and says `readingDays` is being read. Never set across
   * houses, and never over a failure: a new window that fails says so.
   */
  /** `compare`: whether the kept read was the 2N compare read (#2072); it is drawn with the compare it was read with. */
  standIn?: { shownDays: number; readingDays: number; compare?: boolean };
}

/**
 * How long a register's figures count as fresh (r41 gap 5). The sheet's
 * figures move by the sale or by the hour, and each register behind it is a
 * whole-window read, so coming back to the tab after a minute re-read about
 * eleven registers and every window behind them. A return after this long
 * still reads afresh (the app's `refetchOnWindowFocus`), and Refresh always
 * does (`refetchAll`).
 */
export const REGISTER_FRESH_MS = 5 * 60_000;

/** Exported so a write elsewhere (`useGoalsDesk`) can invalidate this read. */
export const ROOT = 'reports-next';

/** A lens the gateway answered as withheld for the reader's role. */
const WITHHELD = Symbol('withheld for this role');

/** Who a lens the gateway withheld is written for (ADR 0348, ADR 0145). */
const GATEWAY_READERS: readonly HouseRole[] = ['owner', 'manager'];

/**
 * Did the gateway withhold this lens from the reader's role? Its money lenses
 * answer `withheldForRole: [classes]` and the till `salesWithheld: true`
 * (ADR 0348 decision 3); either is a register written for someone else, not
 * an empty one.
 */
export function withheldByGateway(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const d = raw as { withheldForRole?: unknown; salesWithheld?: unknown };
  return (Array.isArray(d.withheldForRole) && d.withheldForRole.length > 0) || d.salesWithheld === true;
}
/**
 * The till windows the chips offer (one list: the chips, `tillDaysOf` and the
 * hover warm all read it). A year is the window an owner reads a season against
 * (audit G19); the gateway allows 1–365 house days.
 */
export const TILL_WINDOWS = [7, 30, 90, 365] as const;

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
  /** The bars-and-line pick, `{ b, l }` (measure keys). Optional in v4. */
  c?: unknown;
  /** v1: taken off the sheet. */
  hidden?: unknown;
}

interface StoredSheet {
  v?: number;
  blocks?: StoredBlock[];
}

/**
 * The house sheet for `role`: what that role can read (r36 reports gap 3,
 * `rp-readable.ts`). An unknown role gets the house sheet unchanged.
 */
export function defaultSheet(role: HouseRole | null = null): SheetState {
  const { ids, slots } = defaultIdsFor(role);
  return {
    cuttings: ids.map((id) => ({
      id,
      slot: slots[id],
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
export function decodeSheet(stored: unknown, role: HouseRole | null = null): SheetState {
  const s = stored as StoredSheet | undefined;
  if (!s || !Array.isArray(s.blocks) || !SHEET_PREF_KEY_VERSIONS.includes(Number(s.v)))
    return defaultSheet(role);
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
        ? { x, y, w: Math.max(SHEET_MIN_W, w), h: Math.max(SHEET_MIN_H, h) }
        : DEFAULT_SLOTS[id];
    const graph = isGraphType(b?.g) ? graphOrDefault(id, b.g) : defaultGraph(id);
    const combo = decodeCombo(b?.c);
    cuttings.push(combo ? { id, slot, graph, combo } : { id, slot, graph });
  }
  if (seen.size === 0) return defaultSheet(role);

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

/** A stored bars-and-line pick, or nothing: two short, different keys. */
function decodeCombo(c: unknown): ComboPick | undefined {
  const o = c as { b?: unknown; l?: unknown } | null | undefined;
  const key = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 64;
  if (!o || typeof o !== 'object' || !key(o.b) || !key(o.l) || o.b === o.l) return undefined;
  return { bars: o.b as string, line: o.l as string };
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
        ...(c.combo ? { c: { b: c.combo.bars, l: c.combo.line } } : {}),
      })),
      ...ANALYSIS_IDS.filter((id) => !on.has(id)).map((id) => ({
        i: id,
        on: false,
      })),
    ],
  };
}

/** How long a signed-in session may wait for its house before the page says it has none. */
const HOUSE_WAIT_MS = 3000;

/** The house the stored session names (its token's `restaurantId`), or null. */
function tokenNamesHouse(): boolean {
  try {
    const token = window.localStorage.getItem('accessToken');
    const payload = token ? JSON.parse(atob(token.split('.')[1] ?? '')) : null;
    return typeof payload?.restaurantId === 'string' && payload.restaurantId.length > 0;
  } catch {
    return false;
  }
}

/* ─────────────────────────────────────────────────────── the hook ──────── */

export interface ReportsNextData {
  restaurantId: string | null;
  /** The house role the registers are gated on (`activeRole`); null while unknown. */
  role?: HouseRole | null;
  /**
   * True while sign-in is still settling and no house is known yet. That is
   * not "no house": the page holds the sheet's footprint instead of printing the
   * no-restaurant note for a few frames and then dropping the footer by ~2,700 px.
   */
  housePending?: boolean;
  /**
   * When the oldest kept read on screen was read (rp-warm.ts), while its
   * register reads again; null when every register on screen is this load's.
   */
  warmAt?: number | null;
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
  /**
   * Reads, ahead of the click, what a till window would show. Same query key
   * and read as the cutting itself, so the click renders from cache. A window
   * already held fresh is not read again.
   */
  warmTillWindow: (days: number) => void;
  sheet: SheetState;
  /**
   * Writes the sheet to the reader's preferences and settles when the gateway
   * has answered — rejecting if it refused, and rejecting WITHOUT writing while
   * the sheet is not known, so the house sheet can never be saved over the
   * reader's own. The page stamps "Ruled off." only after this resolves.
   */
  saveSheet: (next: SheetState) => Promise<void>;
  /**
   * True once the account's preferences have answered, so `sheet` is the
   * reader's own. Read from `isPlaceholderData`, not `isLoading`: the
   * preferences query has `placeholderData: {}`, so `isLoading` is false before
   * the gateway has said anything (`useUserPreferences.ts`, its own note).
   */
  sheetKnown: boolean;
  /**
   * True when the gateway keeps the till's takings from this reader (staff, or a role not yet
   * known: its `salesGateFor` reads those as staff). The page then offers no compare at all,
   * rather than a button the withheld read takes back.
   */
  salesKept: boolean;
  /**
   * The house's money, three states (`HouseCurrency`, services/api/settings.ts):
   * `stated` with a code; `unstated` (nobody recorded one); `unread` (the read
   * failed, or has not answered yet). Only `stated` prints a currency mark.
   */
  currency: HouseMoney;
  /**
   * Why the reader's own sheet cannot be known, when it cannot: the read
   * failed, or no one is signed in so there is nothing to read. `sheet` is
   * then the house sheet, and the page says so and keeps arranging shut. Null
   * while the read is simply in flight, and once it has answered.
   */
  sheetUnread: string | null;
  /**
   * Set when a refetch failed AFTER a good load: the last good sheet stays on
   * screen under its own label and Arrange stays open, and this says the
   * refresh failed (ADR 0020). Never set on a cold-load failure — that is
   * `sheetUnread`.
   */
  sheetStale: string | null;
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
  /**
   * The analysis a full-screen link names (`flatAsked`, rp-flat-visit.ts). It
   * is read even when it is not on the sheet, so the link opens it; the sheet
   * itself is not changed.
   */
  alsoRead: AnalysisId | null = null,
  /** Lay the till beside the same-length window just before it (`?compare=prior`). */
  tillCompare = false,
): ReportsNextData {
  const { activeRestaurantId, activeRole, loading: authLoading } = useAuth();
  const rid = activeRestaurantId;
  // The house resolves a beat after sign-in settles (the branches read), so
  // `rid` is null for a few frames of a reload. A session whose token names a
  // house is waiting, not houseless; after HOUSE_WAIT_MS the page says so.
  const waitingForHouse = !rid && (authLoading || tokenNamesHouse());
  const [houseWaitOver, setHouseWaitOver] = useState(false);
  useEffect(() => {
    if (!waitingForHouse) return;
    const id = setTimeout(() => setHouseWaitOver(true), HOUSE_WAIT_MS);
    return () => clearTimeout(id);
  }, [waitingForHouse]);
  const qc = useQueryClient();
  const {
    preferences,
    updatePreferencesAsync,
    isPlaceholderData: prefsPlaceholder,
    error: prefsError,
  } = useUserPreferences();
  // The preferences query is disabled without a user id, and a disabled query
  // keeps its placeholder forever — so the placeholder alone would leave the
  // sheet unknown forever. Read the id the hook itself keys on.
  const userId = useAuthStore((s) => s.user?.userId) ?? null;
  // `error` first: a failed read leaves `{}` behind, which would otherwise look
  // like a perfectly good answer of "no sheet saved" (GroundChoiceSync.tsx
  // reads the same three in the same order).
  const answeredCleanly = userId !== null && !prefsError && !prefsPlaceholder;
  // A good answer, once had, stays the reader's sheet: a later background
  // refetch that fails keeps the last good data (React Query retains it) and
  // sets `error`, but the sheet on screen is still theirs (or the house's, if
  // that is what they saved) and is safe to arrange. Only a failure BEFORE any
  // good answer leaves the house sheet standing in for theirs.
  const hadGoodAnswerFor = useRef<string | null>(null);
  if (answeredCleanly) hadGoodAnswerFor.current = userId;
  const hadGoodAnswer = userId !== null && hadGoodAnswerFor.current === userId;
  const sheetKnown = answeredCleanly || (hadGoodAnswer && !prefsPlaceholder);
  const sheetStale = hadGoodAnswer && prefsError
    ? 'The sheet could not be refreshed just now; what is shown is the last one that loaded.'
    : null;
  const sheetUnread =
    userId === null
      ? 'No one is signed in, so there is no arrangement of yours to read: the house sheet is shown, and arranging is off.'
      : prefsError && !hadGoodAnswer
        ? `Your own arrangement of this sheet could not be read (${failureReason(
            failureOf(prefsError) ?? { status: null, message: '' },
          )}), so the house sheet is shown. Arranging is off until it can be read.`
        : null;

  const sheet = useMemo(
    () => decodeSheet(preferences?.[SHEET_PREF_KEY], activeRole),
    [preferences, activeRole],
  );

  /** What is actually fetched: the sheet's readable cuttings, plus the feed
   *  the palette needs. The writing desk has no path and is never fetched. */
  const active = useMemo<AnalysisId[]>(() => {
    const ids = (showing ?? sheet.cuttings.map((c) => c.id)).filter(
      (id) => readsRegister(CATALOGUE[id]),
    );
    const withReading = ids.includes('reading') ? ids : ['reading' as AnalysisId, ...ids];
    return alsoRead && !withReading.includes(alsoRead) && readsRegister(CATALOGUE[alsoRead])
      ? [...withReading, alsoRead]
      : withReading;
  }, [sheet, showing, alsoRead]);

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
      staleTime: REGISTER_FRESH_MS,
    });

  /* Warm start (r108 g8, rp-warm.ts): a whole successful read is kept in this
     tab's sessionStorage for 15 minutes under (user, house, role), and a reload
     or a new tab paints it as PLACEHOLDER data while the register reads again.
     Placeholder, not initialData: it is never written into the cache as a read,
     so the read always goes out, a failed read again drops it rather than
     showing kept money as current, and a role that is learnt after mount still
     finds it. No role yet, no warm read. */
  const owner = useMemo<WarmOwner | null>(
    () => (userId && rid && activeRole ? { userId, restaurantId: rid, role: activeRole } : null),
    [userId, rid, activeRole],
  );
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  /** When each kept read on screen was read, by its warm key. */
  const warmSeen = useRef(new Map<string, number>());
  const warmFor = (key: string) => {
    const e = warmRead(owner, key);
    if (e) warmSeen.current.set(key, e.at);
    return e?.data;
  };

  const warmKeyOf = (id: AnalysisId, days: number) => {
    const spec = CATALOGUE[id];
    return JSON.stringify([id, spec.takesWindow ? days : null, spec.takesWindow && tillCompare ? 'prior' : null]);
  };

  /** One cutting's read for one till window — shared by the cutting and the warm-up (perf-p6-4). */
  const readOf = useCallback(
    (id: AnalysisId, days: number) => {
      const warmKey = warmKeyOf(id, days);
      /** Keep the read only when it is whole: every source it reads answered (r108 g8), and
          the reader is still who, and in the house, it was asked for: a read that lands
          after a house switch is that house's and never the new one's (#2353). */
      const keepFor =
        (started: WarmOwner | null) =>
        <T,>(out: T, whole: boolean): T => {
          const now = ownerRef.current;
          if (whole && started && now && started.restaurantId === rid && sameOwner(started, now))
            warmWrite(now, warmKey, out);
          return out;
        };
      const spec = CATALOGUE[id];
      return {
        queryKey: [ROOT, id, rid, spec.takesWindow ? days : null, spec.takesWindow && tillCompare ? 'prior' : null],
        staleTime: REGISTER_FRESH_MS,
        queryFn: async () => {
          // The owner is captured when the read starts, not when it lands (#2353).
          const keep = keepFor(ownerRef.current);
          const ctx = { days, compare: tillCompare };
          // The gateway withheld a lens for this reader's role, though the
          // page thought it could read it (a role changed since the session's
          // was read): never handed to `select`, which would read it as empty.
          if (spec.sources) {
            // A composed register (the bench): each source read once per
            // minute however many cuttings share it; a failed source is null,
            // which the register says, never a zero. One withheld source
            // withholds the register (integ 2026-11-27: #1436 on #1051).
            const keys = Object.keys(spec.sources);
            const settled = await Promise.allSettled(
              keys.map((k) => readRaw(spec.sources![k](rid as string, ctx))),
            );
            if (settled.some((r) => r.status === 'fulfilled' && withheldByGateway(r.value)))
              return WITHHELD;
            return keep(
              spec.select(
              Object.fromEntries(
                keys.map((k, i) => {
                  const r = settled[i];
                  return [k, r.status === 'fulfilled' ? r.value : null];
                }),
              ),
              ),
              settled.every((r) => r.status === 'fulfilled'),
            );
          }
          const shownUrl = spec.shownPath?.(rid as string, ctx) ?? null;
          if (shownUrl && spec.withShown) {
            // The window the card shows, beside the doubled read it is split from:
            // only the doubled read failing fails the register; a failed shown read
            // is null, which the register says as a dash, never a guess.
            const [whole, shown] = await Promise.allSettled([
              readRaw(spec.path!(rid as string, ctx)),
              readRaw(shownUrl),
            ]);
            if (whole.status === 'rejected') throw whole.reason;
            if (withheldByGateway(whole.value)) return WITHHELD;
            const shownRead =
              shown.status === 'fulfilled' && !withheldByGateway(shown.value) ? spec.select(shown.value) : null;
            return keep(spec.withShown(spec.select(whole.value), shownRead), shownRead !== null);
          }
          const data = await readRaw(spec.path!(rid as string, ctx));
          if (withheldByGateway(data)) return WITHHELD;
          return keep(spec.select(data), true);
        },
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- readRaw reads only `qc`
    [rid, tillCompare, qc],
  );

  const warmKeys = active.map((id) => warmKeyOf(id, tillDays));
  /**
   * A till the gateway kept from this reader (`salesWithheld`, read as
   * WITHHELD) is kept whatever the window: the role decides it, not the days.
   * Once a read has said so for this house, role and compare setting, a window
   * click keeps that read's key, so it fires no request and draws no "Reading
   * the last N days" stand-in over one sentence (#2358, r109: the walk's
   * 425-1520 ms staff switch). It is asked again when the house, the role or
   * the compare setting moves, or the cached read stops saying withheld.
   */
  const heldWindow = useRef<{ rid: string; role: string | null; days: number; compare: boolean } | null>(null);
  const hw = heldWindow.current;
  const readDays =
    hw &&
    hw.rid === rid &&
    hw.role === activeRole &&
    hw.compare === tillCompare &&
    active.some((id) => CATALOGUE[id].takesWindow && qc.getQueryData(readOf(id, hw.days).queryKey) === WITHHELD)
      ? hw.days
      : tillDays;

  const results = useQueries({
    queries: active.map((id, at) => ({
      ...readOf(id, readDays),
      enabled: !!rid && !heldBack.has(id),
      retry: 1,
      placeholderData: () => (heldBack.has(id) ? undefined : warmFor(warmKeys[at])),
    })),
  });

  active.forEach((id, i) => {
    const d = results[i]?.data;
    if (!CATALOGUE[id].takesWindow || d === undefined || !rid) return;
    heldWindow.current = d === WITHHELD ? { rid, role: activeRole, days: readDays, compare: tillCompare } : null;
  });

  /** Starts one till window's reads; resolves when they have all landed or failed. */
  const warmWindow = useCallback(
    (days: number): Promise<unknown> => {
      if (!rid || days === tillDays) return Promise.resolve();
      const reads: Promise<unknown>[] = [];
      for (const id of active) {
        if (!CATALOGUE[id].takesWindow || heldBack.has(id)) continue;
        reads.push(qc.prefetchQuery({ ...readOf(id, days), retry: 1 }));
      }
      return Promise.all(reads);
    },
    [rid, tillDays, active, heldBack, qc, readOf],
  );

  /**
   * The register handed out last time, per id, with what it was made from. A
   * register whose read has not changed is the SAME object again, so a cutting
   * memoised on it does not redraw for another cutting's read (perf-p4-5,
   * r108): a till-window click changes the till's register and no other.
   */
  const warmTillWindow = useCallback((days: number) => void warmWindow(days), [warmWindow]);

  // Nothing is read ahead on its own. The other till windows are read only on
  // a pointer, focus or touch (`warmTillWindow`), so the first load never pays
  // for reads nobody asked for (p9-2: the idle warm-up pushed settle from
  // 2790 to 4923 ms at 375).

  const kept = useRef<
    Partial<Record<AnalysisId, { reg: Register<unknown>; from: readonly unknown[] }>>
  >({});
  const registers = useMemo(() => {
    const map: Partial<Record<AnalysisId, Register<unknown>>> = {};
    const same = (id: AnalysisId, from: readonly unknown[], make: () => Register<unknown>) => {
      const prev = kept.current[id];
      if (prev && prev.from.length === from.length && prev.from.every((v, k) => v === from[k])) {
        map[id] = prev.reg;
        return;
      }
      const reg = make();
      kept.current[id] = { reg, from };
      map[id] = reg;
    };
    active.forEach((id, i) => {
      const q = results[i];
      if (!q) return;
      if (CATALOGUE[id].takesWindow && rid) {
        if (q.isSuccess) {
          lastWindow.current.set(id, { rid, days: tillDays, compare: tillCompare, data: q.data });
        } else if (q.isPending && !heldBack.has(id)) {
          const kept = lastWindow.current.get(id);
          if (kept && kept.rid === rid && kept.days !== tillDays) {
            map[id] = {
              data: kept.data,
              loading: false,
              failure: null,
              refetch: () => void q.refetch(),
              standIn: { shownDays: kept.days, readingDays: tillDays, compare: kept.compare },
            };
            return;
          }
        }
      }
      const readers = CATALOGUE[id].readers;
      if (readers && heldBack.has(id)) {
        // Not in flight, not refused by the gateway, not empty: withheld.
        same(id, ['held', activeRole], () => ({
          data: undefined,
          loading: false,
          failure: heldBackFailure(readers, activeRole),
          refetch: () => {},
        }));
        return;
      }
      // The gateway withheld a lens for this reader's role (ADR 0348, #1436):
      // never handed to a view, which would read it as empty.
      if (q.data === WITHHELD) {
        same(id, ['withheld', activeRole, q.refetch], () => ({
          data: undefined,
          loading: false,
          failure: heldBackFailure(readers ?? GATEWAY_READERS, activeRole ?? 'staff'),
          refetch: () => void q.refetch(),
        }));
        return;
      }
      same(id, ['read', q.data, q.isPending, q.error, q.refetch], () => ({
        data: q.data,
        loading: q.isPending,
        failure: q.isError ? failureOf(q.error) : null,
        refetch: () => void q.refetch(),
      }));
    });
    return map;
    // `results` is a fresh array each render; the ids and their states are what
    // actually matter, and recomputing a map of eight entries is free.
  }, [active, results, heldBack, activeRole, rid, tillDays, tillCompare]);

  /** The oldest kept read still on screen, while its register reads again; null with none. */
  const warmAt = active.reduce<number | null>((oldest, _id, i) => {
    if (!results[i]?.isPlaceholderData) return oldest;
    const at = warmSeen.current.get(warmKeys[i]);
    return at == null ? oldest : oldest == null ? at : Math.min(oldest, at);
  }, null);

  // One small read, cached with the registers, so every money figure on the
  // sheet prints in the house's own currency rather than `$` (audit G5).
  const currencyQuery = useQuery({
    queryKey: [ROOT, 'currency', rid],
    enabled: !!rid,
    staleTime: 5 * 60_000,
    retry: 1,
    // The house's money is kept with its reads, so a warm sheet is not all dashes.
    placeholderData: () => warmFor('currency') as Awaited<ReturnType<typeof settingsApi.houseCurrency>> | undefined,
    queryFn: async () => {
      const started = ownerRef.current;
      const c = await settingsApi.houseCurrency();
      const now = ownerRef.current;
      if (c?.readable && started && now && started.restaurantId === rid && sameOwner(started, now))
        warmWrite(now, 'currency', c);
      return c;
    },
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
    async (next: SheetState): Promise<void> => {
      if (!sheetKnown)
        throw new Error('The sheet is not known yet, so it was not saved over the one you keep.');
      await updatePreferencesAsync({ [SHEET_PREF_KEY]: encodeSheet(next) });
    },
    [sheetKnown, updatePreferencesAsync],
  );

  const refetchAll = useCallback(() => {
    void qc.invalidateQueries({ queryKey: [ROOT] });
  }, [qc]);

  const goalsDesk = useGoalsDesk({ place: placeCutting, queryRoot: ROOT });
  const exportDesk = useReportExports({ queryRoot: ROOT });

  return {
    restaurantId: rid,
    role: activeRole,
    housePending: waitingForHouse && !houseWaitOver,
    goalsDesk,
    exportDesk,
    registers,
    reading,
    tillDays,
    setTillDays,
    warmTillWindow,
    sheet,
    saveSheet,
    sheetKnown,
    salesKept: activeRole !== 'owner' && activeRole !== 'manager',
    sheetUnread,
    sheetStale,
    currency,
    refetchAll,
    warmAt,
  };
}

export type { AnalysisId, Cutting, GraphType, SheetState };
