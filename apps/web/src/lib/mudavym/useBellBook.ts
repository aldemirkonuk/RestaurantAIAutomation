/**
 * The bell's book — the same register the rebuilt /notifications page reads,
 * read the same way.
 *
 * WHY NOT THE SHARED HOOK
 * -----------------------
 * `hooks/queries/useNotificationQueries` cannot tell the header the truth. It
 * returns `[]` on any failure in DEV, substitutes an IndexedDB cache for a live
 * read, and the service under it throws the gateway's `{ total, page, limit,
 * hasMore }` envelope away (`services/api/notifications.ts:101-107`) while
 * defaulting to `limit=20`. That is `notifications.md` §9 gap 3, verbatim:
 * "the header bell/sidebar badge should say so too". So the bell reads
 * `apiClient` directly and keeps the envelope, exactly as
 * `pages/notifications/next/useNotificationsNextData.ts` does.
 *
 * WHY NOT IMPORT THAT PAGE'S HOOK
 * -------------------------------
 * A shared component may not import from a page directory (the house rule the
 * dashboard's `fonts.ts` states: copy the helper, do not import across pages),
 * and that hook is built for a page — a 10-second poll, paging back through the
 * whole book, per-browser snoozes. The bell needs one page of unread and a
 * count. What IS copied, deliberately and with the citation, is the fold
 * freshness calculation, because the two surfaces must agree about which stamp
 * is the news.
 *
 * THE COUNT IS THE GATEWAY'S, AND A FAILED COUNT IS NOT ZERO
 * ----------------------------------------------------------
 * `GET /notifications/unread/count` (`notifications.controller.ts:122-133`,
 * `notifications.service.ts:872-899`) is a `count: 'exact', head: true` query
 * on `status = 'unread'` for this user and restaurant. When it fails, `unread`
 * is `null` and the bell says the count could not be read — it never renders a
 * confident `0`, which is the absence-reported-as-health shape (ADR 0020) and
 * the exact failure this file exists to avoid: a bell that is silent because
 * it is broken looks identical to a bell that is silent because the house is
 * calm.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient, getErrorMessage } from '../../services/api/client';
import type { Notification } from '../../services/api/notifications';
import { collapseStackedNotifications } from '../notificationStack';
import { publishUnreadCount, useSharedUnreadCount } from './unreadCount';
import { askRoleRecheck, newRoleChangeNotice } from '../roleRecheck';

/** How many unread lines the bell asks for. The whole book is one click away. */
export const BELL_PAGE = 25;

/**
 * LINES PUT TO SLEEP ON /notifications ARE ASLEEP HERE TOO (F-529)
 * ---------------------------------------------------------------
 * The page keeps a snooze in this browser only (`nt-snooze.ts` says why), under
 * this key per house (`useNotificationsNextData.ts`, `SNOOZE_PREFIX`). Copied,
 * not imported, for the reason in the header. The bell hides the same lines and
 * takes them off its number, and says how many it took off, because the
 * register itself still counts them. A line wakes here on the page's own three
 * edges (`resolveSnoozes`): its deadline, a newer stamp, or one more folded
 * repeat — and a line no longer unread is not asleep, it is settled.
 */
export const SNOOZE_PREFIX = 'mudavym.notifications.snooze.';

export interface BellSnooze {
  id: string;
  until: number;
  seenAt: number;
  seenFolded: number;
}

export function readBellSnoozes(restaurantId: string | null): BellSnooze[] {
  if (!restaurantId) return [];
  try {
    const raw = window.localStorage.getItem(SNOOZE_PREFIX + restaurantId);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is BellSnooze =>
        !!r &&
        typeof r.id === 'string' &&
        typeof r.until === 'number' &&
        typeof r.seenAt === 'number' &&
        typeof r.seenFolded === 'number',
    );
  } catch {
    return [];
  }
}

/**
 * THE CADENCE, AND WHY IT IS A STAIRCASE (founder's call, 2026-09-04)
 * ------------------------------------------------------------------
 * The founder asked for the bell to be right sooner than a minute, and was
 * told what each step costs. The answer was to walk it, not to jump:
 *
 *  1. **60 s now, plus a refresh whenever the window regains focus.** The bell
 *     is mounted on every rebuilt page that renders chrome (seventeen of the
 *     eighteen slugs in `MUDAVYM_PAGES`, all but the receiving door), whereas
 *     `/notifications` (`POLL_MS` = 10s there) is one surface a reader chose to
 *     open. At one poll per minute per open tab the chrome stays a reader, not
 *     a load generator, and the focus refresh removes the case that actually
 *     makes a badge look broken: a tab left open for an hour, brought back to
 *     the front, showing an hour-old count for up to a minute. Almost every
 *     "the bell was wrong" moment is a return-to-tab moment, so this buys most
 *     of the freshness of a fast poll for none of the traffic.
 *  2. **10 s next**, matching the page, once the gateway's unread-count query
 *     is measured under the real tenant fan-out. It is a `count: 'exact',
 *     head: true` on an indexed predicate, so the expected answer is that it is
 *     cheap — but "expected" is not measured, and a six-fold traffic increase
 *     on every page of the app is not a change to make on an expectation.
 *  3. **Realtime over the socket last**, and then no poll at all. The app
 *     already carries a socket — this file listens for its
 *     `ws:dashboard-invalidate` nudge below — so the endpoint is the honest one
 *     the count wants: the register tells the bell when it changed, instead of
 *     the bell asking once a minute per open tab whether it did. It is last
 *     because it needs a server-side per-user notification channel that does
 *     not exist yet; until it does, a poll that is slightly stale is honest and
 *     a socket that silently stops delivering is exactly the
 *     absence-reported-as-health failure (ADR 0020) this file is written to
 *     avoid.
 *
 * Recorded, dated, in DESIGN-FOUNDATION §3 item 2.
 */
export const BELL_POLL_MS = 60_000;

export interface BellFailure {
  status: number | null;
  message: string;
  /** 403/401 — understood and refused. Retrying changes nothing. */
  forbidden: boolean;
}

export function bellFailureOf(error: unknown): BellFailure {
  const raw = (error as { response?: { status?: unknown } } | null)?.response?.status;
  const status = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  return {
    status,
    message: getErrorMessage(error),
    forbidden: status === 403 || status === 401,
  };
}

export type BellRegister =
  | { state: 'loading' }
  | { state: 'unreadable'; failure: BellFailure }
  | { state: 'ready'; rows: Notification[] };

/**
 * For a folded line, the newest stamp inside its fold.
 *
 * Copied from `pages/notifications/next/nt-book.ts:49-67` because the two
 * surfaces must print the same pair of stamps and a page directory is not
 * importable from here. The defect it works around is
 * `lib/notificationStack.ts:59-65` — `pickStackWinner` keeps the burst with the
 * highest count regardless of date, so the surviving line can be older than the
 * news it stands for. `notifications.md` §13.23 is the real fix, in the shared
 * stacker; until it lands, every surface that folds must show both stamps or it
 * is quietly reporting an old alert as today's.
 */
export interface FoldFreshness {
  /** Epoch ms of the newest row in the fold; null when nothing is folded. */
  newestAt: number | null;
  /** True when the surviving line is older than the newest of its fold. */
  winnerIsStale: boolean;
}

function stampMs(n: Notification): number {
  const t = new Date(n.timestamp ?? n.createdAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function foldFreshness(
  raw: Notification[],
  winners: Notification[],
  foldedById: Record<string, number>,
): Record<string, FoldFreshness> {
  const out: Record<string, FoldFreshness> = {};
  for (const w of winners) {
    if (!foldedById[w.id]) continue;
    let newest = stampMs(w);
    for (const r of raw) {
      if (r.id === w.id) continue;
      // Same fold ⟺ the stacker itself collapses the pair to one line.
      if (collapseStackedNotifications([w, r]).items.length !== 1) continue;
      newest = Math.max(newest, stampMs(r));
    }
    out[w.id] = { newestAt: newest, winnerIsStale: newest > stampMs(w) };
  }
  return out;
}

function rowsOf(payload: unknown): Notification[] {
  if (Array.isArray(payload)) return payload as Notification[];
  const p = payload as { data?: unknown; notifications?: unknown; items?: unknown } | null;
  for (const candidate of [p?.data, p?.notifications, p?.items]) {
    if (Array.isArray(candidate)) return candidate as Notification[];
  }
  return [];
}

/**
 * How many ids one bulk request carries. The gateway filters with
 * `.in("id", ids)` (`notifications.service.ts` `markBulkAsRead` / `deleteBulk`),
 * which travels in the URL to the database, so a fold of six hundred is sent in
 * slices rather than as one request that a proxy could refuse for its length.
 */
const BULK_SLICE = 100;

function slices(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += BULK_SLICE) out.push(ids.slice(i, i + BULK_SLICE));
  return out;
}

/**
 * Rule off every row a line stands for (F-253). One id goes through the
 * single-row route as before; a fold goes through `PATCH /notifications/read/bulk`.
 */
export async function ruleOffRows(ids: string[]): Promise<void> {
  if (ids.length === 1) {
    await apiClient.patch(`/notifications/${ids[0]}/read`);
    return;
  }
  for (const part of slices(ids)) {
    await apiClient.patch('/notifications/read/bulk', { ids: part });
  }
}

/** Delete every row a line stands for; a fold goes through `DELETE /notifications/bulk`. */
export async function deleteRows(ids: string[]): Promise<void> {
  if (ids.length === 1) {
    await apiClient.delete(`/notifications/${ids[0]}`);
    return;
  }
  for (const part of slices(ids)) {
    await apiClient.delete('/notifications/bulk', { data: { ids: part } });
  }
}

function numOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export interface BellBook {
  register: BellRegister;
  /**
   * Unread rows the REGISTER holds, less the ones asleep in this browser.
   * `null` = the count could not be read.
   */
  unread: number | null;
  /** Unread rows hidden because they were put to sleep on /notifications here. */
  asleep: number;
  /** Why the count is unknown, in words. `null` when it is known. */
  unreadNote: string | null;
  /** The envelope's total for this query; null when the gateway did not say. */
  total: number | null;
  /** True when unread lines exist beyond the page asked for; null = not said. */
  hasMore: boolean | null;
  /** The rows after digest folding — repeated alerts collapse to one line. */
  items: Notification[];
  foldedById: Record<string, number>;
  foldedCount: number;
  folds: Record<string, FoldFreshness>;
  refreshing: boolean;
  /** The last thing that did not happen, in words. Cleared on the next try. */
  actionNote: string | null;
  refresh: () => void;
  markRead: (id: string) => void;
  /** Rule off these shown lines, each by its fold (F-1659). */
  ruleOffShown: (ids: string[]) => void;
}

/**
 * `open` gates the ROWS, not the count. The badge has to be right on every
 * page, so the count is polled; the twenty-five lines behind it are only worth
 * fetching once somebody looks.
 */
export function useBellBook(open: boolean): BellBook {
  const { user, activeRestaurantId } = useAuth();
  const userId = user?.userId ?? null;

  const [register, setRegister] = useState<BellRegister>({ state: 'loading' });
  // The count is the one every surface shares (F-256): this hook publishes
  // what it read, and draws whatever was read last — by the page, the rail
  // or itself — so ruling a line off anywhere moves the bell at once.
  const shared = useSharedUnreadCount(activeRestaurantId);
  const unread = shared?.count ?? null;
  const unreadNote = shared?.note ?? null;
  const [total, setTotal] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [actionNote, setActionNote] = useState<string | null>(null);

  const [snoozes, setSnoozes] = useState<BellSnooze[]>(() => readBellSnoozes(activeRestaurantId));

  const tenant = useRef<string | null>(activeRestaurantId);
  const alive = useRef(true);
  const roleNoticesSeen = useRef(new Set<string>());
  const wantRows = useRef(open);
  wantRows.current = open;

  // A restaurant switch must never leave the previous house's bell ringing.
  useEffect(() => {
    tenant.current = activeRestaurantId;
    setRegister({ state: 'loading' });
    setTotal(null);
    setHasMore(null);
    setActionNote(null);
    setSnoozes(readBellSnoozes(activeRestaurantId));
  }, [activeRestaurantId]);

  const read = useCallback(async () => {
    if (!userId || !activeRestaurantId) return; // identity still resolving
    const forTenant = activeRestaurantId;
    setRefreshing(true);

    const params = { userId, restaurantId: forTenant };
    // Asleep lines can only be taken off the number when their rows are read,
    // so a house with any snooze reads its page of rows even with the bell shut.
    const sleeping = readBellSnoozes(forTenant);
    setSnoozes(sleeping);

    const [countRes, bookRes] = await Promise.allSettled([
      apiClient.get('/notifications/unread/count', { params }),
      wantRows.current || sleeping.length > 0
        ? apiClient.get('/notifications', {
            params: { ...params, status: 'unread', limit: BELL_PAGE, page: 1 },
          })
        : Promise.resolve(null),
    ]);

    if (!alive.current || tenant.current !== forTenant) return;

    if (countRes.status === 'fulfilled') {
      const payload = countRes.value.data as { count?: unknown } | null;
      const n = numOf(payload?.count);
      publishUnreadCount({
        restaurantId: forTenant,
        count: n,
        note: n === null ? 'The register answered without a count, so the number is unknown.' : null,
      });
    } else {
      const f = bellFailureOf(countRes.reason);
      publishUnreadCount({
        restaurantId: forTenant,
        count: null,
        note: f.forbidden
          ? `Your account is not allowed to read this register (${f.status ?? 'refused'}).`
          : `The unread count could not be read (${f.message}).`,
      });
    }

    if (bookRes.status === 'rejected') {
      setRegister({ state: 'unreadable', failure: bellFailureOf(bookRes.reason) });
      setTotal(null);
      setHasMore(null);
    } else if (bookRes.value) {
      const payload = bookRes.value.data as { total?: unknown; hasMore?: unknown } | null;
      const rows = rowsOf(payload);
      // "Your role in this restaurant changed" (F-930): the desk follows it now.
      if (newRoleChangeNotice(rows, roleNoticesSeen.current)) askRoleRecheck();
      setRegister({ state: 'ready', rows });
      setTotal(numOf(payload?.total));
      setHasMore(typeof payload?.hasMore === 'boolean' ? payload.hasMore : null);
    }

    setRefreshing(false);
  }, [userId, activeRestaurantId]);

  useEffect(() => {
    alive.current = true;
    void read();
    return () => {
      alive.current = false;
    };
  }, [read]);

  // Opening the bell is a request for the rows, which the poll above skipped.
  useEffect(() => {
    if (open) void read();
  }, [open, read]);

  useEffect(() => {
    // A hidden tab skips its tick and reads once when it is shown again (F-450).
    const id = setInterval(() => {
      if (document.visibilityState !== 'hidden') void read();
    }, BELL_POLL_MS);
    const onLive = () => void read();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void read();
    };
    // The same two nudges the page and the legacy header already listen for.
    window.addEventListener('notification_sent', onLive);
    window.addEventListener('ws:dashboard-invalidate', onLive);
    // Step 1 of the cadence above: a tab returned to after an hour must not
    // print an hour-old count for up to a minute.
    window.addEventListener('focus', onLive);
    // A snooze written in another tab of this browser.
    window.addEventListener('storage', onLive);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('notification_sent', onLive);
      window.removeEventListener('ws:dashboard-invalidate', onLive);
      window.removeEventListener('focus', onLive);
      window.removeEventListener('storage', onLive);
    };
  }, [read]);

  const { items, foldedById, foldedCount, folds, asleep } = useMemo(() => {
    const rows = register.state === 'ready' ? register.rows : [];
    const stacked = collapseStackedNotifications(rows);
    const byId = new Map(snoozes.map((r) => [r.id, r]));
    const now = Date.now();
    let asleepRows = 0;
    let awakeFolded = 0;
    const awake = stacked.items.filter((n) => {
      const rec = byId.get(n.id);
      const folded = stacked.foldedById[n.id] ?? 0;
      const sleeping =
        !!rec &&
        String(n.status) === 'unread' &&
        now < rec.until &&
        stampMs(n) <= rec.seenAt &&
        folded <= rec.seenFolded;
      if (sleeping) asleepRows += 1 + folded;
      else awakeFolded += folded;
      return !sleeping;
    });
    return {
      items: awake,
      foldedById: stacked.foldedById,
      foldedCount: awakeFolded,
      folds: foldFreshness(rows, awake, stacked.foldedById),
      asleep: asleepRows,
    };
  }, [register, snoozes]);

  const markRead = useCallback(
    (id: string) => {
      setActionNote(null);
      // A folded line is every row it folds; ruling it off rules them all off.
      // The server finds the fold by its key, so the rows past this page of
      // BELL_PAGE go too: a burst of 60 no longer comes back with 35 (F-1125).
      // `opened=1`: this tap opens the line, so a crew note on it counts as
      // opened; the rows folded behind it and "Rule these off" never do (F-1663).
      apiClient
        .patch(`/notifications/${encodeURIComponent(id)}/read/fold?opened=1`)
        .then(() => read())
        .catch((err) => {
          const f = bellFailureOf(err);
          setActionNote(
            f.forbidden
              ? `Your account is not allowed to rule this line off (${f.status ?? 'refused'}). Nothing changed.`
              : `Ruling that line off did not reach the server (${f.message}). Nothing changed.`,
          );
        });
    },
    [read],
  );

  /**
   * Rule off the lines the bell shows, each by its fold as one click on it
   * does (F-1659). It used to rule off the house's whole unread book: lines
   * past this page and lines put to sleep went too, unseen. The caller names
   * the lines, and keeps approval lines out (the seal is answered, not ruled
   * off).
   */
  const ruleOffShown = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      setActionNote(null);
      void Promise.allSettled(
        ids.map((id) => apiClient.patch(`/notifications/${encodeURIComponent(id)}/read/fold`)),
      )
        .then((results) => {
          const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
          if (failed.length === 0) return;
          const n = failed.length;
          setActionNote(
            `${n} of ${ids.length} line${ids.length === 1 ? '' : 's'} did not reach the server (${bellFailureOf(failed[0].reason).message}). ${n === 1 ? 'It is' : 'They are'} still open.`,
          );
        })
        .finally(() => void read());
    },
    [read],
  );

  return {
    register,
    unread: unread === null ? null : Math.max(0, unread - asleep),
    asleep,
    unreadNote,
    total,
    hasMore,
    items,
    foldedById,
    foldedCount,
    folds,
    refreshing,
    actionNote,
    refresh: () => void read(),
    markRead,
    ruleOffShown,
  };
}
