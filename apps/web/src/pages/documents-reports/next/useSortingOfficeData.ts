/**
 * The Sorting Office data — Direction D, chosen by the founder 2026-08-31
 * ("go with direction D"). Every drawer count is a real count from its own
 * register, and a drawer never claims a number its query hasn't answered:
 *
 *   Waiting on you    — vendor paper needing review + AI drafts awaiting
 *                       approval + door-counted deliveries with no paperwork,
 *                       oldest debt first (never by arrival).
 *   House reports     — generated_reports through the gateway (OD-45 path).
 *   Vendor paper      — procurement documents (window of the latest 100 —
 *                       counts render as floors when the window fills).
 *   Conversations     — classified thread total + drafts from the live
 *                       active-conversations source (the DraftRail's own).
 *   System log        — the /logs timeline (latest 100, windowed); today's
 *                       routine entries become the self-filing noise roll.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../services/api/client';
import { useAuth } from '../../../contexts/AuthContext';
import { documentsApi, type ProcurementDocument } from '../../../services/api/documents';
import { receivingApi, type UnverifiedDelivery } from '../../../services/api/receiving';
import { useGeneratedReports, type GeneratedReport } from '../../../hooks/queries/useReportQueries';
import { useConversationThreads } from '../../../hooks/queries/useConversationQueries';
import {
  useActiveConversations,
  type ActiveConversationDto,
} from '../../../hooks/queries/useDraftEmailQueries';

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

export function useSortingOfficeData() {
  const { activeRestaurantId } = useAuth();

  const reportsQ = useGeneratedReports();
  const paperQ = useQuery<ProcurementDocument[]>({
    queryKey: ['sorting-office', 'paper'],
    queryFn: () => documentsApi.list({ limit: PAPER_LIMIT }),
    staleTime: 30_000,
  });
  const threadsQ = useConversationThreads();
  const activeQ = useActiveConversations();
  const unverifiedQ = useQuery<{ items: UnverifiedDelivery[] }>({
    queryKey: ['sorting-office', 'unverified'],
    queryFn: () => receivingApi.listUnverified(),
    staleTime: 30_000,
  });
  const timelineQ = useQuery<{ events: TimelineEvent[] }>({
    queryKey: ['sorting-office', 'timeline', activeRestaurantId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/logs/timeline/${activeRestaurantId}`, {
        params: { limit: TIMELINE_LIMIT },
      });
      return data;
    },
    enabled: !!activeRestaurantId,
    staleTime: 60_000,
  });

  const paper = paperQ.data ?? [];
  const paperNeedsReview = useMemo(
    () => paper.filter((d) => d.status === 'needs_review'),
    [paper],
  );

  const waiting: WaitingRow[] | null = useMemo(() => {
    // The drawer opens only once every register behind it has answered —
    // a half-known queue would misstate the debt order.
    if (
      paperQ.data === undefined ||
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
    return rows.sort(
      (a, b) => (Date.parse(a.since) || 0) - (Date.parse(b.since) || 0),
    );
  }, [paperQ.data, activeQ.data, unverifiedQ.data, paperNeedsReview]);

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
      [...(reportsQ.data ?? [])].sort(
        (a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0),
      ),
    [reportsQ.data],
  );

  return {
    waiting,
    reports,
    reportsKnown: reportsQ.data !== undefined,
    paperCount: paperQ.data === undefined ? null : paper.length,
    paperCapped: paper.length >= PAPER_LIMIT,
    paperNeedsReviewCount: paperQ.data === undefined ? null : paperNeedsReview.length,
    recentPaper: paper.slice(0, 6),
    threadsTotal: threadsQ.data === undefined ? null : threadsQ.data.total,
    draftsPending: activeQ.data === undefined ? null : activeQ.data.length,
    timelineCount: timelineQ.data === undefined ? null : timelineQ.data.events.length,
    timelineCapped: (timelineQ.data?.events.length ?? 0) >= TIMELINE_LIMIT,
    todayRoutine,
    hasData: reportsQ.data !== undefined || paperQ.data !== undefined,
    isError: reportsQ.isError && paperQ.isError,
    anyError: reportsQ.isError || paperQ.isError || timelineQ.isError,
    errorMessage:
      (reportsQ.error instanceof Error && reportsQ.error.message) ||
      (paperQ.error instanceof Error && paperQ.error.message) ||
      'unknown error',
    refetch: () => {
      void reportsQ.refetch();
      void paperQ.refetch();
      void threadsQ.refetch();
      void activeQ.refetch();
      void unverifiedQ.refetch();
      void timelineQ.refetch();
    },
  };
}
