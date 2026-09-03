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
 * SCOPE, since it narrowed on 2026-09-03: this hook reads the NOTIFICATIONS
 * register and nothing else. One-tap actions used to be read here too; the
 * founder moved them to the dashboard rail
 * (`pages/dashboard/next/OneTapPanel.tsx`, which owns its own read), so the
 * day-book no longer fetches a register it does not draw.
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
import { DayCell, FoldFreshness, dayCells, daySpan, foldFreshness } from './nt-book';
import {
  SnoozeRecord,
  SnoozeVerdict,
  WakeReason,
  resolveSnoozes,
} from './nt-snooze';

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

/* ──────────────────────────────────────────────── snooze (per browser) ─── */

/**
 * Where a sleeping line is remembered.
 *
 * `public.notifications` has no snooze column
 * (`supabase/migrations/20260805000000_baseline_from_production.sql`), so this
 * is a browser's own note and every surface that reads it says so. The key
 * carries the restaurant because a line put down in one house must not be
 * asleep in another.
 */
const SNOOZE_PREFIX = 'mudavym.notifications.snooze.';

function readSnoozes(restaurantId: string | null): SnoozeRecord[] {
  if (!restaurantId) return [];
  try {
    const raw = window.localStorage.getItem(SNOOZE_PREFIX + restaurantId);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is SnoozeRecord =>
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

function writeSnoozes(restaurantId: string | null, records: SnoozeRecord[]): void {
  if (!restaurantId) return;
  try {
    window.localStorage.setItem(SNOOZE_PREFIX + restaurantId, JSON.stringify(records));
  } catch {
    /* storage blocked — the line does not stay down, and the page says so */
  }
}

/* ───────────────────────────────────────────────────────────── the hook ── */

export interface BookStack {
  /** Rows after digest stacking — repeated alerts collapse to one line. */
  items: Notification[];
  foldedById: Record<string, number>;
  foldedCount: number;
}

/**
 * The four narrowings the REGISTER performs, not the browser.
 *
 * `type`, `status`, `dateFrom` and `dateTo` are all fields of
 * `GetNotificationsQueryDto` (`notifications/dto/notifications.dto.ts:63-80`)
 * and are applied server-side as `eq`, `eq`, `gte(created_at)` and
 * `lte(created_at)` (`notifications.service.ts:811-821`). Because they are the
 * register's own, the `total` that comes back is the FILTERED total — which is
 * why the page can print "6 lines on 3 September" and mean it, where a
 * browser-side filter could only ever have said "6 of the ones I happen to
 * hold".
 */
export interface BookFilters {
  /** A `notifications.type` value, exactly as stored. */
  type: string | null;
  status: 'unread' | 'read' | 'archived' | null;
  /** `YYYY-MM-DD` in the reader's timezone; expanded to a local-day window. */
  day: string | null;
}

export const NO_FILTERS: BookFilters = { type: null, status: null, day: null };

export interface NotificationsNextData {
  book: BookVM;
  stack: BookStack;
  /** Wall-clock of the last completed read of the book; null before the first. */
  lastReadAt: Date | null;
  /** True while a poll or a manual refresh is in flight. */
  refreshing: boolean;
  /** Ids the reader put to sleep in THIS browser, still asleep. */
  asleep: Set<string>;
  /** Every sleeping record, so the page can say when each is due back. */
  snoozes: SnoozeRecord[];
  /** Lines that woke since the last read, and what woke them. */
  woke: Array<{ id: string; reason: WakeReason }>;
  /** Per folded line: the newest stamp in its fold, and whether it is stale. */
  folds: Record<string, FoldFreshness>;
  /** The last 14 days, counted from the rows on screen. */
  days: DayCell[];
  filters: BookFilters;
  setFilters: (next: BookFilters) => void;
  /** The last thing that did not happen, in words. Cleared on the next try. */
  failureNote: string | null;
  refresh: () => void;
  readFurtherBack: () => void;
  markRead: (id: string) => void;
  markUnread: (id: string) => void;
  archive: (id: string) => void;
  remove: (id: string) => void;
  markAllRead: () => void;
  /** Put a line down for `ms`. It wakes on its own — see `nt-snooze.ts`. */
  snooze: (id: string, ms: number) => void;
  wake: (id: string) => void;
  wakeAll: () => void;
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
  const [lastReadAt, setLastReadAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [failureNote, setFailureNote] = useState<string | null>(null);
  const [snoozes, setSnoozes] = useState<SnoozeRecord[]>(() => readSnoozes(activeRestaurantId));
  const [verdict, setVerdict] = useState<SnoozeVerdict>({
    asleep: new Set(),
    woke: [],
    keep: [],
  });
  const [filters, setFiltersState] = useState<BookFilters>(NO_FILTERS);

  const pagesRef = useRef(1);
  const alive = useRef(true);
  const tenant = useRef<string | null>(activeRestaurantId);
  /** Mirror of the rendered rows, so an optimistic write can be rolled back. */
  const rowsRef = useRef<Notification[] | null>(null);
  /** Mirror of the fold counts, so `snooze()` can record what it saw. */
  const foldedRef = useRef<Record<string, number>>({});

  // A restaurant switch must never leave the previous tenant's rows on screen.
  useEffect(() => {
    tenant.current = activeRestaurantId;
    pagesRef.current = 1;
    rowsRef.current = null;
    setBook({ register: { state: 'loading' }, total: null, hasMore: null, pages: 1 });
    setLastReadAt(null);
    setFailureNote(null);
    setSnoozes(readSnoozes(activeRestaurantId));
    setVerdict({ asleep: new Set(), woke: [], keep: [] });
    setFiltersState(NO_FILTERS);
  }, [activeRestaurantId]);

  const publish = useCallback((vm: BookVM) => {
    rowsRef.current = vm.register.state === 'ready' ? vm.register.rows : null;
    setBook(vm);
  }, []);

  /**
   * The register's own narrowings, as query params. A null is omitted rather
   * than sent as an empty string: `status=''` would fail the DTO's
   * `@IsEnum(NotificationStatus)` and turn a cleared filter into a 400.
   */
  const window_ = filters.day ? daySpan(filters.day) : null;
  const filterParams = useMemo(() => {
    const p: Record<string, string> = {};
    if (filters.type) p.type = filters.type;
    if (filters.status) p.status = filters.status;
    if (window_) {
      p.dateFrom = window_.dateFrom;
      p.dateTo = window_.dateTo;
    }
    return p;
    // `window_` is derived from `filters.day`, which is the real dependency.
  }, [filters.type, filters.status, filters.day]); // eslint-disable-line react-hooks/exhaustive-deps

  const read = useCallback(async () => {
    if (!userId || !activeRestaurantId) return; // identity still resolving — stay loading
    const forTenant = activeRestaurantId;
    const wanted = pagesRef.current;
    setRefreshing(true);

    const [bookRes] = await Promise.allSettled([
      apiClient.get('/notifications', {
        params: {
          userId,
          restaurantId: forTenant,
          limit: BOOK_PAGE,
          page: 1,
          ...filterParams,
        },
      }),
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
          params: {
            userId,
            restaurantId: forTenant,
            limit: BOOK_PAGE,
            page: p,
            ...filterParams,
          },
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

    setLastReadAt(new Date());
    setRefreshing(false);
  }, [userId, activeRestaurantId, publish, filterParams]);

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

  /**
   * Put a line down, remembering the two things that will wake it: the
   * deadline, and the state of the row at the moment it was put down. If the
   * register writes about it again — a newer stamp, or one more folded repeat
   * — `resolveSnoozes` brings it straight back (Linear's rule; see
   * `nt-snooze.ts` for the citation and for why this cannot be server-side
   * yet).
   */
  const snooze = useCallback(
    (id: string, ms: number) => {
      const row = (rowsRef.current ?? []).find((r) => r.id === id);
      const stamped = row ? new Date(row.timestamp ?? row.createdAt).getTime() : 0;
      const rec: SnoozeRecord = {
        id,
        until: Date.now() + ms,
        seenAt: Number.isFinite(stamped) ? stamped : 0,
        seenFolded: foldedRef.current[id] ?? 0,
      };
      setSnoozes((prev) => {
        const next = [...prev.filter((r) => r.id !== id), rec];
        writeSnoozes(tenant.current, next);
        return next;
      });
    },
    [],
  );

  const wake = useCallback((id: string) => {
    setSnoozes((prev) => {
      const next = prev.filter((r) => r.id !== id);
      writeSnoozes(tenant.current, next);
      return next;
    });
  }, []);

  const wakeAll = useCallback(() => {
    setSnoozes(() => {
      writeSnoozes(tenant.current, []);
      return [];
    });
  }, []);

  const setFilters = useCallback((next: BookFilters) => {
    // A narrower book is a new book: paging starts again at page one, or
    // "read further back" would ask for page 3 of a two-page answer.
    pagesRef.current = 1;
    setFiltersState(next);
  }, []);

  const readFurtherBack = useCallback(() => {
    pagesRef.current += 1;
    void read();
  }, [read]);

  const stack: BookStack = useMemo(() => {
    if (book.register.state !== 'ready') return { items: [], foldedById: {}, foldedCount: 0 };
    return collapseStackedNotifications(book.register.rows);
  }, [book.register]);

  foldedRef.current = stack.foldedById;

  const folds = useMemo(
    () =>
      book.register.state === 'ready'
        ? foldFreshness(book.register.rows, stack.items, stack.foldedById)
        : {},
    [book.register, stack],
  );

  const days = useMemo(
    () => (book.register.state === 'ready' ? dayCells(book.register.rows) : []),
    [book.register],
  );

  /**
   * Wake the lines that have earned it, every time the book is re-read.
   *
   * This runs on the READ, not on a timer, so a line whose deadline passed
   * while the tab was asleep is awake by the time it is drawn — and a line the
   * register wrote about again comes back in the same pass that learned of it.
   */
  useEffect(() => {
    if (book.register.state !== 'ready') return;
    const candidates = stack.items.map((n) => {
      const t = new Date(n.timestamp ?? n.createdAt).getTime();
      return {
        id: n.id,
        stampedAt: Number.isFinite(t) ? t : 0,
        folded: stack.foldedById[n.id] ?? 0,
        unread: String(n.status) === 'unread',
      };
    });
    const next = resolveSnoozes(snoozes, candidates);
    setVerdict(next);
    if (next.keep.length !== snoozes.length) {
      writeSnoozes(tenant.current, next.keep);
      setSnoozes(next.keep);
    }
  }, [book.register.state, stack, snoozes]);

  return {
    book,
    stack,
    lastReadAt,
    refreshing,
    asleep: verdict.asleep,
    snoozes,
    woke: verdict.woke,
    folds,
    days,
    filters,
    setFilters,
    failureNote,
    refresh: () => void read(),
    readFurtherBack,
    markRead,
    markUnread,
    archive,
    remove,
    markAllRead,
    snooze,
    wake,
    wakeAll,
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
