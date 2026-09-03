/**
 * NotificationsNext data — the day-book's two registers, read live.
 *
 * Why this hook exists rather than `hooks/queries/useNotificationQueries`:
 * the shared `useNotifications` hook cannot tell this page the truth. It
 * returns `[]` on any failure in DEV (`useNotificationQueries.ts:60-63`),
 * silently substitutes an IndexedDB cache for a live read (`:52-57`), and the
 * service throws away the gateway's `{ total, hasMore }` envelope
 * (`services/api/notifications.ts:104-106`) — so the page could not say how
 * much of the book it is showing. The legacy page then discarded `error`
 * outright (`pages/Notifications.tsx:157`), which is the defect this rebuild
 * exists to remove: a watchdog that cannot say it is blind.
 *
 * Every read here goes through the authenticated `apiClient`, is keyed by
 * `activeRestaurantId`, and lands in exactly one of three states:
 *
 *   loading    — the request is genuinely in flight
 *   unreadable — it came back refused (403/401) or broken; SAY WHICH
 *   ready      — a real answer, including a real empty book
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient, getErrorMessage } from '@/services/api/client';
import type { Notification } from '@/services/api/notifications';
import { collapseStackedNotifications } from '@/lib/notificationStack';
import { num } from './nt-format';

/* ───────────────────────────────────────────── the shape of a failure ──── */

export interface FailureVM {
  status: number | null;
  message: string;
  /** 403/401 — understood and refused. Retrying changes nothing. */
  forbidden: boolean;
}

export function failureOf(error: unknown): FailureVM {
  const status =
    num((error as { response?: { status?: unknown } } | null)?.response?.status) ?? null;
  return {
    status,
    message: getErrorMessage(error),
    forbidden: status === 403 || status === 401,
  };
}

export type Register<T> =
  | { state: 'loading' }
  | { state: 'unreadable'; failure: FailureVM }
  | { state: 'ready'; rows: T[] };

/* ─────────────────────────────────────────────────── the book envelope ─── */

/** The gateway's page-size cap — `notifications.dto.ts` `@Max(100)`. */
export const BOOK_PAGE = 100;

/** The live-update contract the page note promises (§8): a 10-second poll. */
export const POLL_MS = 10_000;

export interface BookVM {
  register: Register<Notification>;
  /** Rows the gateway says exist for this user+restaurant; null when unknown. */
  total: number | null;
  /** True when the gateway says more pages remain; null when it did not say. */
  hasMore: boolean | null;
  /** How many pages of {@link BOOK_PAGE} have been asked for. */
  pages: number;
}

/** The `{ data, total, page, limit, hasMore }` envelope the gateway sends. */
interface BookEnvelope {
  total?: unknown;
  hasMore?: unknown;
}

export type OneTapStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'expired';

/** `OneTapActionResponseDto`, as it reaches the browser. */
export interface OneTapAction {
  id: string;
  restaurantId: string;
  /**
   * The AUTHOR. `createSystemAction` inserts no `user_id`
   * (`one-tap-actions.service.ts:366-382`) while `POST /one-tap-actions`
   * stamps the caller (`:150-152`), so an absent author is the structural
   * proof that the house raised this row rather than a person here.
   */
  userId?: string | null;
  actionType: string;
  title: string;
  description?: string;
  actionUrl?: string;
  priority: string;
  status: OneTapStatus;
  createdAt: string;
  executedAt?: string;
  expiresAt?: string;
}

export interface CreateOneTapInput {
  title: string;
  description?: string;
  actionUrl?: string;
  priority: 'low' | 'medium' | 'high';
}

/* ─────────────────────────────────────────────── set-aside (per browser) ─ */

const SET_ASIDE_PREFIX = 'mudavym.notifications.setAside.';

function readSetAside(restaurantId: string | null): Set<string> {
  if (!restaurantId) return new Set();
  try {
    const raw = window.localStorage.getItem(SET_ASIDE_PREFIX + restaurantId);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeSetAside(restaurantId: string | null, ids: Set<string>): void {
  if (!restaurantId) return;
  try {
    window.localStorage.setItem(SET_ASIDE_PREFIX + restaurantId, JSON.stringify([...ids]));
  } catch {
    /* storage blocked — the set-aside does not persist, and the page says so */
  }
}

/* ───────────────────────────────────────────────────────────── the hook ── */

export interface BookStack {
  /** Rows after digest stacking — repeated alerts collapse to one line. */
  items: Notification[];
  foldedById: Record<string, number>;
  foldedCount: number;
}

export interface NotificationsNextData {
  book: BookVM;
  stack: BookStack;
  actions: Register<OneTapAction>;
  /** Wall-clock of the last completed read of the book; null before the first. */
  lastReadAt: Date | null;
  /** True while a poll or a manual refresh is in flight. */
  refreshing: boolean;
  setAside: Set<string>;
  /** The last thing that did not happen, in words. Cleared on the next try. */
  failureNote: string | null;
  refresh: () => void;
  readFurtherBack: () => void;
  markRead: (id: string) => void;
  markUnread: (id: string) => void;
  archive: (id: string) => void;
  remove: (id: string) => void;
  markAllRead: () => void;
  putAside: (id: string) => void;
  restoreAside: () => void;
  executeAction: (id: string) => Promise<void>;
  cancelAction: (id: string) => Promise<void>;
  createAction: (input: CreateOneTapInput) => Promise<void>;
}

export function useNotificationsNextData(): NotificationsNextData {
  const { user, activeRestaurantId } = useAuth();
  const userId = user?.userId ?? null;

  const [book, setBook] = useState<BookVM>({
    register: { state: 'loading' },
    total: null,
    hasMore: null,
    pages: 1,
  });
  const [actions, setActions] = useState<Register<OneTapAction>>({ state: 'loading' });
  const [lastReadAt, setLastReadAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [failureNote, setFailureNote] = useState<string | null>(null);
  const [setAside, setSetAside] = useState<Set<string>>(() => readSetAside(activeRestaurantId));

  const pagesRef = useRef(1);
  const alive = useRef(true);
  const tenant = useRef<string | null>(activeRestaurantId);
  /** Mirror of the rendered rows, so an optimistic write can be rolled back. */
  const rowsRef = useRef<Notification[] | null>(null);

  // A restaurant switch must never leave the previous tenant's rows on screen.
  useEffect(() => {
    tenant.current = activeRestaurantId;
    pagesRef.current = 1;
    rowsRef.current = null;
    setBook({ register: { state: 'loading' }, total: null, hasMore: null, pages: 1 });
    setActions({ state: 'loading' });
    setLastReadAt(null);
    setFailureNote(null);
    setSetAside(readSetAside(activeRestaurantId));
  }, [activeRestaurantId]);

  const publish = useCallback((vm: BookVM) => {
    rowsRef.current = vm.register.state === 'ready' ? vm.register.rows : null;
    setBook(vm);
  }, []);

  const read = useCallback(async () => {
    if (!userId || !activeRestaurantId) return; // identity still resolving — stay loading
    const forTenant = activeRestaurantId;
    const wanted = pagesRef.current;
    setRefreshing(true);

    const [bookRes, actionRes] = await Promise.allSettled([
      apiClient.get('/notifications', {
        params: { userId, restaurantId: forTenant, limit: BOOK_PAGE, page: 1 },
      }),
      apiClient.get('/one-tap-actions', { params: { restaurantId: forTenant } }),
    ]);

    // Older pages are asked for one at a time and appended: the gateway caps
    // `limit` at 100 (`notifications.dto.ts` @Max(100)), so "further back" is
    // more requests, never a bigger one.
    //
    // `deepest` is the envelope of the LAST page actually read, and it — not
    // page 1's — decides `hasMore`. The gateway computes `hasMore` per queried
    // page as `count > offset + limit` (`notifications.service.ts:821`), so
    // page 1's answer is the constant `total > 100`: it can never clear, and
    // taking it verbatim left "Read further back" offered forever once a
    // restaurant passed a hundred lines, even after every row was on screen.
    const older: Notification[] = [];
    let olderFailure: FailureVM | null = null;
    let deepest: BookEnvelope | null = null;
    for (let p = 2; p <= wanted; p++) {
      try {
        const res = await apiClient.get('/notifications', {
          params: { userId, restaurantId: forTenant, limit: BOOK_PAGE, page: p },
        });
        older.push(...rowsOf(res.data));
        deepest = res.data as BookEnvelope | null;
      } catch (err) {
        olderFailure = failureOf(err);
        break;
      }
    }
    if (!alive.current || tenant.current !== forTenant) return;

    if (bookRes.status === 'rejected') {
      const failure = failureOf(bookRes.reason);
      rowsRef.current = null;
      setBook((b) => ({ ...b, register: { state: 'unreadable', failure } }));
    } else {
      const payload = bookRes.value.data as BookEnvelope | null;
      // The deepest page read is the one that knows whether anything is left.
      const edge = deepest ?? payload;
      publish({
        register: { state: 'ready', rows: [...rowsOf(payload), ...older] },
        total: num(edge?.total) ?? num(payload?.total),
        hasMore: typeof edge?.hasMore === 'boolean' ? edge.hasMore : null,
        pages: wanted,
      });
    }
    setFailureNote(
      olderFailure ? `Pages further back could not be read (${olderFailure.message}).` : null,
    );

    setActions(
      actionRes.status === 'rejected'
        ? { state: 'unreadable', failure: failureOf(actionRes.reason) }
        : { state: 'ready', rows: actionsOf(actionRes.value.data) },
    );
    setLastReadAt(new Date());
    setRefreshing(false);
  }, [userId, activeRestaurantId, publish]);

  useEffect(() => {
    alive.current = true;
    void read();
    return () => {
      alive.current = false;
    };
  }, [read]);

  // The live contract: poll while mounted so stacked digests update in place,
  // plus the same realtime nudges the legacy page listened for.
  useEffect(() => {
    const id = setInterval(() => void read(), POLL_MS);
    const onLive = () => void read();
    window.addEventListener('notification_sent', onLive);
    window.addEventListener('ws:dashboard-invalidate', onLive);
    return () => {
      clearInterval(id);
      window.removeEventListener('notification_sent', onLive);
      window.removeEventListener('ws:dashboard-invalidate', onLive);
    };
  }, [read]);

  /* ── writes: optimistic, but a refusal rolls back AND says so ─────────── */

  const patchRow = useCallback(
    async (id: string, next: string | null, request: () => Promise<unknown>, what: string) => {
      setFailureNote(null);
      const previous = rowsRef.current;
      if (previous) {
        const rows =
          next === null
            ? previous.filter((r) => r.id !== id)
            : previous.map((r) => (r.id === id ? ({ ...r, status: next } as Notification) : r));
        rowsRef.current = rows;
        setBook((b) => ({ ...b, register: { state: 'ready', rows } }));
      }
      try {
        await request();
        await read();
      } catch (err) {
        const f = failureOf(err);
        if (previous) {
          rowsRef.current = previous;
          setBook((b) => ({ ...b, register: { state: 'ready', rows: previous } }));
        }
        setFailureNote(
          f.forbidden
            ? `Your account is not allowed to ${what} (${f.status ?? 'refused'}). Nothing changed.`
            : `“${what}” did not reach the server (${f.message}). Nothing changed.`,
        );
      }
    },
    [read],
  );

  const markRead = useCallback(
    (id: string) =>
      void patchRow(id, 'read', () => apiClient.patch(`/notifications/${id}/read`), 'rule this off'),
    [patchRow],
  );
  const markUnread = useCallback(
    (id: string) =>
      void patchRow(id, 'unread', () => apiClient.patch(`/notifications/${id}/unread`), 'reopen this'),
    [patchRow],
  );
  const archive = useCallback(
    (id: string) =>
      void patchRow(id, 'archived', () => apiClient.patch(`/notifications/${id}/archive`), 'archive this'),
    [patchRow],
  );
  const remove = useCallback(
    (id: string) => void patchRow(id, null, () => apiClient.delete(`/notifications/${id}`), 'delete this'),
    [patchRow],
  );

  /**
   * Rule off every open line IN THIS RESTAURANT.
   *
   * `restaurantId` is load-bearing, not decoration. The gateway applies the
   * tenant filter only `if (params.restaurantId)`
   * (`notifications.service.ts:943-945`), so omitting it updates every unread
   * row for this `userId` in every restaurant they belong to — a cross-tenant
   * WRITE behind a button whose label names one book.
   */
  const markAllRead = useCallback(() => {
    if (!userId || !activeRestaurantId) return;
    setFailureNote(null);
    apiClient
      .patch('/notifications/read/all', undefined, {
        params: { userId, restaurantId: activeRestaurantId },
      })
      .then(() => read())
      .catch((err) => {
        setFailureNote(
          `Ruling this restaurant’s open lines off failed (${failureOf(err).message}). Nothing changed.`,
        );
      });
  }, [userId, activeRestaurantId, read]);

  const putAside = useCallback((id: string) => {
    setSetAside((s) => {
      const next = new Set(s).add(id);
      writeSetAside(tenant.current, next);
      return next;
    });
  }, []);

  const restoreAside = useCallback(() => {
    setSetAside(() => {
      writeSetAside(tenant.current, new Set());
      return new Set();
    });
  }, []);

  const actOnAction = useCallback(
    async (id: string, path: 'execute' | 'cancel', what: string) => {
      setFailureNote(null);
      try {
        await apiClient.post(`/one-tap-actions/${id}/${path}`, {});
        await read();
      } catch (err) {
        setFailureNote(
          `${what} was refused (${failureOf(err).message}) — the action is unchanged.`,
        );
        throw err;
      }
    },
    [read],
  );

  const executeAction = useCallback(
    (id: string) => actOnAction(id, 'execute', 'Marking it done'),
    [actOnAction],
  );
  const cancelAction = useCallback(
    (id: string) => actOnAction(id, 'cancel', 'Ruling it out'),
    [actOnAction],
  );

  const createAction = useCallback(
    async (input: CreateOneTapInput) => {
      setFailureNote(null);
      try {
        await apiClient.post('/one-tap-actions', {
          title: input.title,
          description: input.description || undefined,
          actionUrl: input.actionUrl || undefined,
          actionType: 'custom',
          priority: input.priority,
        });
        await read();
      } catch (err) {
        setFailureNote(
          `The action was not saved (${failureOf(err).message}) — nothing was created.`,
        );
        throw err;
      }
    },
    [read],
  );

  const readFurtherBack = useCallback(() => {
    pagesRef.current += 1;
    void read();
  }, [read]);

  const stack: BookStack = useMemo(() => {
    if (book.register.state !== 'ready') return { items: [], foldedById: {}, foldedCount: 0 };
    return collapseStackedNotifications(book.register.rows);
  }, [book.register]);

  return {
    book,
    stack,
    actions,
    lastReadAt,
    refreshing,
    setAside,
    failureNote,
    refresh: () => void read(),
    readFurtherBack,
    markRead,
    markUnread,
    archive,
    remove,
    markAllRead,
    putAside,
    restoreAside,
    executeAction,
    cancelAction,
    createAction,
  };
}

/* ── payload shapes: the gateway envelope, and the bare array older builds
      of `services/api/notifications.ts` unwrapped to. Read either. ───────── */

function rowsOf(payload: unknown): Notification[] {
  if (Array.isArray(payload)) return payload as Notification[];
  const p = payload as { data?: unknown; notifications?: unknown; items?: unknown } | null;
  for (const candidate of [p?.data, p?.notifications, p?.items]) {
    if (Array.isArray(candidate)) return candidate as Notification[];
  }
  return [];
}

function actionsOf(payload: unknown): OneTapAction[] {
  if (Array.isArray(payload)) return payload as OneTapAction[];
  const p = payload as { actions?: unknown } | null;
  return Array.isArray(p?.actions) ? (p.actions as OneTapAction[]) : [];
}
