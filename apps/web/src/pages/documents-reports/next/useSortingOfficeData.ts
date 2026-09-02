/**
 * The Sorting Office data — Direction D, chosen by the founder 2026-08-31
 * ("go with direction D"). Every drawer count is a real count from its own
 * register, and a drawer never claims a number its query hasn't answered:
 *
 *   Waiting on you    — vendor paper needing review + AI drafts awaiting
 *                       approval + deliveries counted by the case and never
 *                       counted by bottle, oldest debt first (never by
 *                       arrival). That third one is NOT "no paperwork": the
 *                       endpoint behind it (receiving.service.ts:43-44 —
 *                       "a delivery with a case count and no bottle count is
 *                       unverified") knows nothing about invoices. The debt
 *                       is somebody breaking the cases and counting bottles.
 *   House reports     — generated_reports through the gateway (OD-45 path);
 *                       the count is the gateway's exact total, never an
 *                       array length.
 *   Vendor paper      — procurement documents (window of the latest 100 —
 *                       counts render as floors when the window fills), plus
 *                       a status-filtered needs_review query of its own.
 *   Conversations     — classified thread total + drafts from the live
 *                       active-conversations source (the DraftRail's own).
 *   System log        — the /logs timeline (latest 100, windowed); today's
 *                       routine entries become the self-filing noise roll.
 *
 * Every query is keyed by the active restaurant (Opus review, blocker 1):
 * a restaurant switch happens while this page stays mounted, and an unkeyed
 * cache would keep serving the previous tenant's rows indefinitely.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../services/api/client';
import { useAuth } from '../../../contexts/AuthContext';
import { documentsApi, type ProcurementDocument } from '../../../services/api/documents';
import { receivingApi, type UnverifiedDelivery } from '../../../services/api/receiving';
import { listReportsWithTotal, type GeneratedReport } from '../../../services/api/reports';
import { useConversationThreads } from '../../../hooks/queries/useConversationQueries';
import {
  useActiveConversations,
  type ActiveConversationDto,
} from '../../../hooks/queries/useDraftEmailQueries';
import { fmtMoney, sortKey } from './so-format';

/**
 * The server-side windows this page reads through, each citing the query that
 * imposes it. `scripts/check_windowed_figures.py` re-reads every cited file on
 * every CI run: change a cap server-side without changing it here and the
 * page's floor prose becomes a confident falsehood that reads exactly like a
 * measurement. Keep the numeric literals — a cap behind an identifier is a cap
 * that guard cannot see.
 */
export const SO_SERVER_WINDOWS = {
  /** documents.controller.ts:117 — `Math.min(200, …)` hard-caps every list. */
  PAPER: 100,
  /** logs-timeline.service.ts:99 — `Math.min(200, …)` clamps the feed. */
  TIMELINE: 100,
  /** reports.service.ts:95 — `Math.min(200, …)` bounds the report page. */
  REPORTS: 100,
} as const;

export interface TimelineEvent {
  id: string;
  source: string;
  /**
   * NULL when the row's timestamp column is null — `procurement_documents`
   * and `system_audit_log` both permit it. An undated event is never counted
   * as today's, because "unknown when" is not "today".
   */
  occurredAt: string | null;
  correlationId: string | null;
  summary: string;
}

export interface TimelineResponse {
  events: TimelineEvent[];
  /**
   * Sources that errored server-side. The gateway catches each source and
   * still returns 200, so without this list a failed register contributed
   * zero events and rendered as a SMALLER NUMBER with no banner (ADR 0086).
   * Optional because a gateway older than that change omits it — and its
   * absence is treated as "not known", never as "none failed".
   */
  failedSources?: string[];
  sourcesQueried?: string[];
}

export interface WaitingRow {
  key: string;
  /** Oldest-debt ordering key (ISO date). */
  since: string;
  title: string;
  detail: string;
  href: string;
}

/** Today's self-filed routine entries, counted out of the timeline window. */
export interface TodayRoutine {
  count: number;
  /**
   * True when `count` can only be a FLOOR. See the comment at its computation:
   * a full window is NOT on its own enough — the test is subtler than the
   * four drawers'.
   */
  countCapped: boolean;
  bySource: Map<string, number>;
  sample: TimelineEvent[];
}

/**
 * What the page renders. The `| null` on these fields is the whole honesty
 * contract: each one has to be able to say "the query did not answer", which
 * an empty list and a zero cannot say. Widening any of them back is what makes
 * a dead register look like a quiet one.
 */
export interface SortingOfficeData {
  waiting: WaitingRow[] | null;
  reports: GeneratedReport[];
  reportsKnown: boolean;
  reportsTotal: number | null;
  paperCount: number | null;
  paperCapped: boolean;
  paperNeedsReviewCount: number | null;
  paperNeedsReviewCapped: boolean;
  threadsTotal: number | null;
  draftsPending: number | null;
  timelineCount: number | null;
  timelineCapped: boolean;
  todayRoutine: TodayRoutine | null;
  hasData: boolean;
  anyError: boolean;
  errorMessage: string;
  refetch: () => void;
}

/**
 * An error counts only once the query has settled — a poll or retry in
 * flight is not a verdict, and a flapping banner is the opposite of this
 * page's calm (Opus review, defect 7).
 *
 * Exported because the reading pane's cross-file check is subject to the same
 * rule and used to read `isError` directly, so the page had two different
 * definitions of "failed" on one screen.
 */
export function settledError(q: { isError: boolean; isFetching: boolean }): boolean {
  return q.isError && !q.isFetching;
}

/** Local calendar day of an ISO instant, or null when it has no time. */
function dayOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toDateString() : null;
}

export function useSortingOfficeData(): SortingOfficeData {
  const { activeRestaurantId } = useAuth();
  const rid = activeRestaurantId ?? '';

  const reportsQ = useQuery<{ reports: GeneratedReport[]; total: number }>({
    queryKey: ['sorting-office', 'reports', rid],
    queryFn: () => listReportsWithTotal({ limit: SO_SERVER_WINDOWS.REPORTS }),
    enabled: !!rid,
    staleTime: 30_000,
  });
  const paperQ = useQuery<ProcurementDocument[]>({
    queryKey: ['sorting-office', 'paper', rid],
    queryFn: () => documentsApi.list({ limit: SO_SERVER_WINDOWS.PAPER }),
    enabled: !!rid,
    staleTime: 30_000,
  });
  // The review set gets its own status-filtered query (the receipts page's
  // pattern, useReceiptsNextData.ts): deriving it from the unfiltered recency
  // window above would hide any needs_review document older than the newest
  // 100 of ANY status — exactly the oldest debt the waiting drawer exists to
  // surface (Sonnet audit, blocker 1).
  const reviewQ = useQuery<ProcurementDocument[]>({
    queryKey: ['sorting-office', 'paper-review', rid],
    queryFn: () =>
      documentsApi.list({ status: 'needs_review', limit: SO_SERVER_WINDOWS.PAPER }),
    enabled: !!rid,
    staleTime: 30_000,
  });
  const threadsQ = useConversationThreads();
  const activeQ = useActiveConversations();
  const unverifiedQ = useQuery<{ items: UnverifiedDelivery[] }>({
    queryKey: ['sorting-office', 'unverified', rid],
    queryFn: () => receivingApi.listUnverified(),
    enabled: !!rid,
    staleTime: 30_000,
  });
  const timelineQ = useQuery<TimelineResponse>({
    queryKey: ['sorting-office', 'timeline', rid],
    queryFn: async () => {
      const { data } = await apiClient.get(`/logs/timeline/${rid}`, {
        params: { limit: SO_SERVER_WINDOWS.TIMELINE },
      });
      return data;
    },
    enabled: !!rid,
    staleTime: 60_000,
  });

  const paper = paperQ.data ?? [];
  const paperNeedsReview = useMemo(() => reviewQ.data ?? [], [reviewQ.data]);

  const waiting: WaitingRow[] | null = useMemo(() => {
    // The drawer opens only once every register behind it has answered —
    // a half-known queue would misstate the debt order.
    if (
      reviewQ.data === undefined ||
      activeQ.data === undefined ||
      unverifiedQ.data === undefined
    )
      return null;
    const rows: WaitingRow[] = [];
    for (const d of paperNeedsReview) {
      rows.push({
        key: `paper-${d.id}`,
        since: d.doc_date ?? d.created_at,
        title:
          d.ties_out === false
            ? `${d.doc_number || 'A document'} does not tie out`
            : `${d.doc_number || 'A document'} awaits review`,
        detail:
          // The document's OWN currency, not this page's assumption of one.
          // `procurement_documents.currency` has been there since the
          // baseline; the amount was printed with a hardcoded `$`, so a
          // euro-denominated invoice read as dollars off.
          d.ties_out === false && d.tie_out_delta != null
            ? `off by ${fmtMoney(Math.abs(d.tie_out_delta), d.currency)}`
            : 'transcription unconfirmed',
        href: '/receipts',
      });
    }
    for (const c of activeQ.data as ActiveConversationDto[]) {
      rows.push({
        key: `draft-${c.id}`,
        since: c.createdAt,
        title: `Draft reply${c.providerName ? ` to ${c.providerName}` : ''} awaits approval`,
        detail: c.wineName ?? c.orderNumber ?? 'vendor exchange',
        href: '/communications',
      });
    }
    for (const u of unverifiedQ.data.items) {
      rows.push({
        key: `door-${u.orderId}`,
        since: u.countedAt,
        // What the endpoint actually means. It said "no paperwork", which sent
        // a manager hunting for an invoice; the debt is a bottle count, and
        // the stock number stays approximate until somebody makes it.
        title: `${u.orderNumber ?? u.orderId.slice(0, 8)} counted by the case, not yet by bottle`,
        detail: `${u.countedQtyBottles} btl booked at the door · ${Math.round(u.ageHours)}h unverified`,
        href: '/receipts',
      });
    }
    // sortKey agrees with fmtDate on date-only values and sends unparseable
    // dates LAST — an unknown date never presents itself as the oldest debt.
    return rows.sort((a, b) => sortKey(a.since) - sortKey(b.since));
  }, [reviewQ.data, activeQ.data, unverifiedQ.data, paperNeedsReview]);

  const timelineWindowFull =
    (timelineQ.data?.events.length ?? 0) >= SO_SERVER_WINDOWS.TIMELINE;
  // A source that failed contributed zero events, so every count derived from
  // this window is at best a floor of the true one.
  const timelineSourcesFailed = (timelineQ.data?.failedSources?.length ?? 0) > 0;

  const todayRoutine: TodayRoutine | null = useMemo(() => {
    if (timelineQ.data === undefined) return null;
    const events = timelineQ.data.events;
    const today = new Date().toDateString();
    const todays = events.filter((e) => dayOf(e.occurredAt) === today);
    const bySource = new Map<string, number>();
    for (const e of todays) bySource.set(e.source, (bySource.get(e.source) ?? 0) + 1);

    // WHY THIS TEST IS NOT `windowFull` ALONE, which is what the four drawers
    // use. Those drawers count the window itself, so a full window means rows
    // were cut and their count is a floor. This strip counts a SUBSET of the
    // window — today's slice of a newest-first feed — and the feed is cut from
    // the OLD end. So if the oldest event still in the window predates today,
    // the cut happened entirely before midnight and every one of today's
    // entries survived it: the count is exact even though the window is full.
    // Only when the oldest surviving event is ITSELF from today can today's
    // entries have been truncated, and only then is `≥` the honest mark.
    //
    // Undated rows sort last server-side, so they are the first cut; if none
    // of the window parses at all we cannot place the boundary and fall back
    // to the floor, which understates rather than overstates.
    const times = events
      .map((e) => Date.parse(e.occurredAt ?? ''))
      .filter((t) => Number.isFinite(t));
    const oldestIsToday =
      times.length === 0 || new Date(Math.min(...times)).toDateString() === today;

    return {
      count: todays.length,
      countCapped: (timelineWindowFull && oldestIsToday) || timelineSourcesFailed,
      bySource,
      sample: todays.slice(0, 12),
    };
  }, [timelineQ.data, timelineWindowFull, timelineSourcesFailed]);

  const reports: GeneratedReport[] = useMemo(
    () =>
      [...(reportsQ.data?.reports ?? [])].sort(
        (a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0),
      ),
    [reportsQ.data],
  );

  // A timeline that answered but lost sources is a FAILED register, not a
  // healthy one with a smaller number. It is labelled by the sources that
  // failed, so the banner names the thing that broke rather than the endpoint.
  const timelineSourcesQ = useMemo(
    () => ({
      isError: timelineSourcesFailed,
      isFetching: timelineQ.isFetching,
      error: timelineSourcesFailed
        ? new Error(
            `${(timelineQ.data?.failedSources ?? []).join(', ')} could not be read; the log counts are a floor`,
          )
        : null,
    }),
    [timelineSourcesFailed, timelineQ.isFetching, timelineQ.data],
  );

  // Every register the page renders answers into the banner — a failure in
  // any of them is said in words, never swallowed (Sonnet audit, blocker 2),
  // and named, so the banner never points at a drawer the failing register
  // doesn't have (Opus review, defect 8).
  const labelled: Array<[string, { isError: boolean; isFetching: boolean; error: unknown }]> = [
    ['House reports', reportsQ],
    ['Vendor paper', paperQ],
    ['the review queue', reviewQ],
    ['Conversations', threadsQ],
    ['draft replies', activeQ],
    ['the door count', unverifiedQ],
    ['the system log', timelineQ],
    ['the system log', timelineSourcesQ],
  ];
  const firstError = labelled.find(([, q]) => settledError(q));

  return {
    waiting,
    reports,
    reportsKnown: reportsQ.data !== undefined,
    /** The gateway's exact count — can exceed reports.length. */
    reportsTotal: reportsQ.data === undefined ? null : reportsQ.data.total,
    paperCount: paperQ.data === undefined ? null : paper.length,
    paperCapped: paper.length >= SO_SERVER_WINDOWS.PAPER,
    paperNeedsReviewCount: reviewQ.data === undefined ? null : paperNeedsReview.length,
    paperNeedsReviewCapped: paperNeedsReview.length >= SO_SERVER_WINDOWS.PAPER,
    threadsTotal: threadsQ.data === undefined ? null : threadsQ.data.total,
    draftsPending: activeQ.data === undefined ? null : activeQ.data.length,
    timelineCount: timelineQ.data === undefined ? null : timelineQ.data.events.length,
    timelineCapped: timelineWindowFull || timelineSourcesFailed,
    todayRoutine,
    // "Nothing below is claimed" may only be said when nothing below claims
    // anything — any answered register keeps the partial branch (Opus
    // review, blocker 2).
    hasData: labelled.some(([, q]) => (q as { data?: unknown }).data !== undefined),
    anyError: labelled.some(([, q]) => settledError(q)),
    errorMessage: firstError
      ? `${firstError[0]} — ${
          firstError[1].error instanceof Error ? firstError[1].error.message : 'unknown error'
        }`
      : 'unknown error',
    refetch: () => {
      void reportsQ.refetch();
      void paperQ.refetch();
      void reviewQ.refetch();
      void threadsQ.refetch();
      void activeQ.refetch();
      void unverifiedQ.refetch();
      void timelineQ.refetch();
    },
  };
}
