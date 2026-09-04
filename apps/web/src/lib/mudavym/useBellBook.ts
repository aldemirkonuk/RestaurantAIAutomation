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

/** How many unread lines the bell asks for. The whole book is one click away. */
export const BELL_PAGE = 25;

/**
 * The bell polls slower than the page (`POLL_MS` there is 10s). The bell is
 * mounted on EVERY rebuilt page; the page is one surface a reader chose to
 * open. A minute is the interval at which a header badge stops being wrong
 * without turning the chrome into a load generator.
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

function numOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export interface BellBook {
  register: BellRegister;
  /** Unread rows the REGISTER holds. `null` = the count could not be read. */
  unread: number | null;
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
  markAllRead: () => void;
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
  const [unread, setUnread] = useState<number | null>(null);
  const [unreadNote, setUnreadNote] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [actionNote, setActionNote] = useState<string | null>(null);

  const tenant = useRef<string | null>(activeRestaurantId);
  const alive = useRef(true);
  const wantRows = useRef(open);
  wantRows.current = open;

  // A restaurant switch must never leave the previous house's bell ringing.
  useEffect(() => {
    tenant.current = activeRestaurantId;
    setRegister({ state: 'loading' });
    setUnread(null);
    setUnreadNote(null);
    setTotal(null);
    setHasMore(null);
    setActionNote(null);
  }, [activeRestaurantId]);

  const read = useCallback(async () => {
    if (!userId || !activeRestaurantId) return; // identity still resolving
    const forTenant = activeRestaurantId;
    setRefreshing(true);

    const params = { userId, restaurantId: forTenant };

    const [countRes, bookRes] = await Promise.allSettled([
      apiClient.get('/notifications/unread/count', { params }),
      wantRows.current
        ? apiClient.get('/notifications', {
            params: { ...params, status: 'unread', limit: BELL_PAGE, page: 1 },
          })
        : Promise.resolve(null),
    ]);

    if (!alive.current || tenant.current !== forTenant) return;

    if (countRes.status === 'fulfilled') {
      const payload = countRes.value.data as { count?: unknown } | null;
      const n = numOf(payload?.count);
      setUnread(n);
      setUnreadNote(
        n === null ? 'The register answered without a count, so the number is unknown.' : null,
      );
    } else {
      const f = bellFailureOf(countRes.reason);
      setUnread(null);
      setUnreadNote(
        f.forbidden
          ? `Your account is not allowed to read this register (${f.status ?? 'refused'}).`
          : `The unread count could not be read (${f.message}).`,
      );
    }

    if (bookRes.status === 'rejected') {
      setRegister({ state: 'unreadable', failure: bellFailureOf(bookRes.reason) });
      setTotal(null);
      setHasMore(null);
    } else if (bookRes.value) {
      const payload = bookRes.value.data as { total?: unknown; hasMore?: unknown } | null;
      setRegister({ state: 'ready', rows: rowsOf(payload) });
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
    const id = setInterval(() => void read(), BELL_POLL_MS);
    const onLive = () => void read();
    // The same two nudges the page and the legacy header already listen for.
    window.addEventListener('notification_sent', onLive);
    window.addEventListener('ws:dashboard-invalidate', onLive);
    return () => {
      clearInterval(id);
      window.removeEventListener('notification_sent', onLive);
      window.removeEventListener('ws:dashboard-invalidate', onLive);
    };
  }, [read]);

  const { items, foldedById, foldedCount, folds } = useMemo(() => {
    const rows = register.state === 'ready' ? register.rows : [];
    const stacked = collapseStackedNotifications(rows);
    return {
      items: stacked.items,
      foldedById: stacked.foldedById,
      foldedCount: stacked.foldedCount,
      folds: foldFreshness(rows, stacked.items, stacked.foldedById),
    };
  }, [register]);

  const markRead = useCallback(
    (id: string) => {
      setActionNote(null);
      apiClient
        .patch(`/notifications/${id}/read`)
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

  const markAllRead = useCallback(() => {
    if (!userId || !activeRestaurantId) return;
    setActionNote(null);
    apiClient
      .patch('/notifications/read/all', undefined, {
        params: { userId, restaurantId: activeRestaurantId },
      })
      .then(() => read())
      .catch((err) => {
        setActionNote(
          `Ruling this house’s open lines off failed (${bellFailureOf(err).message}). Nothing changed.`,
        );
      });
  }, [userId, activeRestaurantId, read]);

  return {
    register,
    unread,
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
    markAllRead,
  };
}
