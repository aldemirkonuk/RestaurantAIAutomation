/**
 * useLogsNextData — the six registers, read live, with the window marked and
 * walked.
 *
 * What the legacy page could not say, and this hook can:
 *
 *   - HOW MUCH of the feed is on screen. `limit: 100` was the page's last
 *     unlabelled number (06-pages/logs.md §9). The cap is declared once, in
 *     `LOGS_SERVER_WINDOWS`, citing the gateway line that imposes it, and
 *     `scripts/check_windowed_figures.py` holds the citation, the floor marker
 *     and the nullable fields below mechanically (ADR 0086's `open` claim in
 *     CLAIMS.jsonl flips on this file);
 *   - WHETHER MORE EXISTS. The gateway now measures `hasMore` exactly (it
 *     reads one row past the window) and hands over `nextCursor`; this hook
 *     walks it with `useInfiniteQuery`. A gateway that predates the field has
 *     told the page nothing, and nothing is `null` here — never `false`;
 *   - WHEN IT CANNOT WALK FURTHER. The cursor is inclusive (`<=`), so the
 *     boundary row comes back on the next page and is de-duplicated on
 *     `source:id`. A page whose every row shares one timestamp, or holds no
 *     dated row at all, cannot advance; that is `stalled`, said in words by
 *     the page rather than looping or pretending it is the end.
 *
 * Every read is keyed by `activeRestaurantId` (W6: a bare key serves the
 * previous house's rows after a switch) and lands in one of three states:
 *
 *   loading    — the first page is genuinely in flight
 *   unreadable — refused (403/401) or broken; SAY WHICH
 *   ready      — a real answer, including a real empty feed
 */

import { useCallback, useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient, getErrorMessage } from '@/services/api/client';
import { countBySource, type TimelineEvent, type TimelinePage, type TimelineSource } from './lg-format';

/**
 * The one server-side window this page reads through. The citation is the
 * anchor `check_windowed_figures.py` W1 verifies: the number here must still
 * be admitted by the clamp in the file it names.
 */
export const LOGS_SERVER_WINDOWS = {
  /** logs-timeline.service.ts:106 — `Math.min(200, …)` clamps the feed; this page asks for 100 a page. */
  TIMELINE: 100,
} as const;

/* ───────────────────────────────────────────── the shape of a failure ──── */

export interface FailureVM {
  status: number | null;
  message: string;
  /** 403/401 — understood and refused. Retrying changes nothing. */
  forbidden: boolean;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
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

export type ReadState = 'loading' | 'unreadable' | 'ready';

/* ───────────────────────────────────────────────────── the view model ──── */

export interface LogsNextData {
  state: ReadState;
  /** Why the feed is unreadable; null otherwise. */
  failure: FailureVM | null;
  /** Rows loaded so far, de-duplicated on source:id, newest first with undated rows last; null until the first page answers. */
  events: TimelineEvent[] | null;
  /** Per-register counts of the rows loaded; null until the first page answers. */
  counts: Partial<Record<string, number>> | null;
  /** Registers the gateway says it read, union over pages; null when it did not say. */
  sourcesQueried: TimelineSource[] | null;
  /** Registers that failed on any page; null when the gateway did not say. */
  failedSources: TimelineSource[] | null;
  /** Whether a row exists beyond what is loaded; null when the gateway did not say. */
  hasMore: boolean | null;
  /** The clamp the gateway applied; null when it did not say. */
  window: number | null;
  /** Rows remain but the cursor cannot advance. */
  stalled: boolean;
  readingMore: boolean;
  pagesRead: number;
  readMore: () => void;
  refetch: () => void;
}

/** One row once, whichever page it arrived on — the inclusive cursor re-reads the boundary. */
function dedupe(rows: readonly TimelineEvent[]): TimelineEvent[] {
  const seen = new Set<string>();
  const out: TimelineEvent[] = [];
  for (const e of rows) {
    const key = `${e.source}:${e.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** The union of a per-page list, or null if NO page carried the field. */
function unionOf(
  pages: readonly TimelinePage[],
  pick: (p: TimelinePage) => TimelineSource[] | undefined,
): TimelineSource[] | null {
  let known = false;
  const set = new Set<TimelineSource>();
  for (const p of pages) {
    const v = pick(p);
    if (v === undefined) continue;
    known = true;
    for (const s of v) set.add(s);
  }
  return known ? [...set] : null;
}

export function useLogsNextData(correlationId: string | null): LogsNextData {
  const rid = useAuth().activeRestaurantId ?? '';

  const q = useInfiniteQuery({
    queryKey: ['logs-next', 'timeline', rid, correlationId ?? ''],
    queryFn: async ({ pageParam }) => {
      const { data } = await apiClient.get<TimelinePage>(`/logs/timeline/${rid}`, {
        params: {
          correlationId: correlationId || undefined,
          limit: LOGS_SERVER_WINDOWS.TIMELINE,
          before: pageParam ?? undefined,
        },
      });
      return data;
    },
    initialPageParam: null as string | null,
    // A next page exists only when the gateway SAID so (`hasMore === true`
    // — never inferred from a full page), handed over a cursor, and that
    // cursor moves. The same cursor twice is a stall, not a next page.
    getNextPageParam: (last, _all, lastParam) =>
      last.hasMore === true && typeof last.nextCursor === 'string' && last.nextCursor !== lastParam
        ? last.nextCursor
        : undefined,
    enabled: !!rid,
    retry: false,
    staleTime: 30_000,
  });

  const pages = q.data?.pages ?? null;
  const pageParams = q.data?.pageParams ?? null;

  const events = useMemo(() => (pages ? dedupe(pages.flatMap((p) => p.events)) : null), [pages]);
  const counts = useMemo(() => (events ? countBySource(events) : null), [events]);
  const sourcesQueried = useMemo(
    () => (pages ? unionOf(pages, (p) => p.sourcesQueried) : null),
    [pages],
  );
  const failedSources = useMemo(
    () => (pages ? unionOf(pages, (p) => p.failedSources) : null),
    [pages],
  );

  const last = pages && pages.length ? pages[pages.length - 1] : null;
  const lastParam =
    pageParams && pageParams.length ? (pageParams[pageParams.length - 1] as string | null) : null;
  // Absent is unknown: a gateway that never sent the field has not said "no".
  const hasMore = last && typeof last.hasMore === 'boolean' ? last.hasMore : null;
  const windowApplied = last && typeof last.window === 'number' ? last.window : null;
  const stalled =
    !!last &&
    last.hasMore === true &&
    (typeof last.nextCursor !== 'string' || last.nextCursor === lastParam);

  const readMore = useCallback(() => {
    if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
  }, [q]);
  const refetch = useCallback(() => {
    void q.refetch();
  }, [q]);

  if (!rid) {
    return {
      state: 'unreadable',
      failure: {
        status: null,
        message: 'No house is selected, so there is no timeline to read.',
        forbidden: false,
      },
      events: null,
      counts: null,
      sourcesQueried: null,
      failedSources: null,
      hasMore: null,
      window: null,
      stalled: false,
      readingMore: false,
      pagesRead: 0,
      readMore,
      refetch,
    };
  }

  const state: ReadState =
    q.status === 'error' ? 'unreadable' : q.status === 'success' ? 'ready' : 'loading';

  return {
    state,
    failure: q.status === 'error' ? failureOf(q.error) : null,
    events: state === 'ready' ? events : null,
    counts: state === 'ready' ? counts : null,
    sourcesQueried: state === 'ready' ? sourcesQueried : null,
    failedSources: state === 'ready' ? failedSources : null,
    hasMore: state === 'ready' ? hasMore : null,
    window: state === 'ready' ? windowApplied : null,
    stalled: state === 'ready' && stalled,
    readingMore: q.isFetchingNextPage,
    pagesRead: pages ? pages.length : 0,
    readMore,
    refetch,
  };
}
