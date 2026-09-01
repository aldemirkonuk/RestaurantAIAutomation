/**
 * The Sorting Office data — Direction D, chosen by the founder 2026-08-31
 * ("go with direction D"). Every drawer count is a real count from its own
 * register, and a drawer never claims a number its query hasn't answered:
 *
 *   Waiting on you    — vendor paper needing review + AI drafts awaiting
 *                       approval + door-counted deliveries with no paperwork,
 *                       oldest debt first (never by arrival).
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
import { sortKey } from './so-format';

export interface TimelineEvent {
  id: string;
  source: string;
  occurredAt: string;
  correlationId: string | null;
  summary: string;
}

export interface WaitingRow {
  key: string;
  /** Oldest-debt ordering key (ISO date). */
  since: string;
  title: string;
  detail: string;
  href: string;
}

const TIMELINE_LIMIT = 100;
const PAPER_LIMIT = 100;

/**
 * An error counts only once the query has settled — a poll or retry in
 * flight is not a verdict, and a flapping banner is the opposite of this
 * page's calm (Opus review, defect 7).
 */
function settledError(q: { isError: boolean; isFetching: boolean }): boolean {
  return q.isError && !q.isFetching;
}

export function useSortingOfficeData() {
  const { activeRestaurantId } = useAuth();
  const rid = activeRestaurantId ?? '';

  const reportsQ = useQuery<{ reports: GeneratedReport[]; total: number }>({
    queryKey: ['sorting-office', 'reports', rid],
    queryFn: listReportsWithTotal,
    enabled: !!rid,
    staleTime: 30_000,
  });
  const paperQ = useQuery<ProcurementDocument[]>({
    queryKey: ['sorting-office', 'paper', rid],
    queryFn: () => documentsApi.list({ limit: PAPER_LIMIT }),
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
    queryFn: () => documentsApi.list({ status: 'needs_review', limit: PAPER_LIMIT }),
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
  const timelineQ = useQuery<{ events: TimelineEvent[] }>({
    queryKey: ['sorting-office', 'timeline', rid],
    queryFn: async () => {
      const { data } = await apiClient.get(`/logs/timeline/${rid}`, {
        params: { limit: TIMELINE_LIMIT },
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
          d.ties_out === false && d.tie_out_delta != null
            ? `off by $${Math.abs(d.tie_out_delta).toFixed(2)}`
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
        title: `${u.orderNumber ?? u.orderId.slice(0, 8)} counted at the door, no paperwork`,
        detail: `${u.countedQtyBottles} btl · ${Math.round(u.ageHours)}h ago`,
        href: '/receipts',
      });
    }
    // sortKey agrees with fmtDate on date-only values and sends unparseable
    // dates LAST — an unknown date never presents itself as the oldest debt.
    return rows.sort((a, b) => sortKey(a.since) - sortKey(b.since));
  }, [reviewQ.data, activeQ.data, unverifiedQ.data, paperNeedsReview]);

  const todayRoutine = useMemo(() => {
    if (timelineQ.data === undefined) return null;
    const today = new Date().toDateString();
    const todays = timelineQ.data.events.filter(
      (e) => new Date(e.occurredAt).toDateString() === today,
    );
    const bySource = new Map<string, number>();
    for (const e of todays) bySource.set(e.source, (bySource.get(e.source) ?? 0) + 1);
    return { count: todays.length, bySource, sample: todays.slice(0, 12) };
  }, [timelineQ.data]);

  const reports: GeneratedReport[] = useMemo(
    () =>
      [...(reportsQ.data?.reports ?? [])].sort(
        (a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0),
      ),
    [reportsQ.data],
  );

  // Every register the page renders answers into the banner — a failure in
  // any of the seven is said in words, never swallowed (Sonnet audit,
  // blocker 2), and named, so the banner never points at a drawer the
  // failing register doesn't have (Opus review, defect 8).
  const labelled: Array<[string, { isError: boolean; isFetching: boolean; error: unknown }]> = [
    ['House reports', reportsQ],
    ['Vendor paper', paperQ],
    ['the review queue', reviewQ],
    ['Conversations', threadsQ],
    ['draft replies', activeQ],
    ['the door count', unverifiedQ],
    ['the system log', timelineQ],
  ];
  const firstError = labelled.find(([, q]) => settledError(q));

  return {
    waiting,
    reports,
    reportsKnown: reportsQ.data !== undefined,
    /** The gateway's exact count — can exceed reports.length. */
    reportsTotal: reportsQ.data === undefined ? null : reportsQ.data.total,
    paperCount: paperQ.data === undefined ? null : paper.length,
    paperCapped: paper.length >= PAPER_LIMIT,
    paperNeedsReviewCount: reviewQ.data === undefined ? null : paperNeedsReview.length,
    paperNeedsReviewCapped: paperNeedsReview.length >= PAPER_LIMIT,
    threadsTotal: threadsQ.data === undefined ? null : threadsQ.data.total,
    draftsPending: activeQ.data === undefined ? null : activeQ.data.length,
    timelineCount: timelineQ.data === undefined ? null : timelineQ.data.events.length,
    timelineCapped: (timelineQ.data?.events.length ?? 0) >= TIMELINE_LIMIT,
    todayRoutine,
    // "Nothing below is claimed" may only be said when nothing below claims
    // anything — any answered register keeps the partial branch (Opus
    // review, blocker 2).
    hasData: labelled.some(([, q]) => (q as { data?: unknown }).data !== undefined),
    isError: settledError(reportsQ) && settledError(paperQ),
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
