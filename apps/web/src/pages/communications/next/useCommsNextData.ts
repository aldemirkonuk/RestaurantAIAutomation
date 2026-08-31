/**
 * CommunicationsNext data — the MERGE verdict's two halves reconciled at the
 * data layer: everything the old page showed at a glance is derived from the
 * same live sources (no new endpoints, no invented figures), and each glance
 * figure stays null until its query has actually answered.
 *
 * Sources: useProcurementConversationHistory (the outbound negotiation book),
 * useConversationThreads (inbound/outbound thread summaries), and the report
 * schedules the legacy page managed.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  useConversationThreads,
  useProcurementConversationHistory,
  type ProcurementHistoryItem,
} from '../../../hooks/queries/useConversationQueries';
import { useActiveConversations } from '../../../hooks/queries/useDraftEmailQueries';
import { apiClient } from '../../../services/api/client';
import { listReportSchedules, type ScheduledReport } from '../../../services/api/reports';
import { sendState } from './cm-format';

export interface CommsGlance {
  /** null = the query behind the figure has not answered. */
  threads: number | null;
  draftsPending: number | null;
  sentLast30: number | null;
  /** True when the history window hit its server cap — the figure is a floor. */
  sentLast30Truncated: boolean;
  schedules: number | null;
}

export function useCommsNextData() {
  const historyQ = useProcurementConversationHistory();
  const threadsQ = useConversationThreads();
  // Drafts awaiting action come from the same live source the orders DraftRail
  // uses — the history endpoint filters drafts out at the SQL level, so
  // deriving "drafts waiting" from it was a structurally guaranteed false
  // zero (communications-audit.md, BLOCKER 2).
  const activeQ = useActiveConversations();
  const schedulesQ = useQuery<ScheduledReport[]>({
    queryKey: ['report-schedules'],
    queryFn: listReportSchedules,
    staleTime: 60_000,
  });
  // The rail's integration line must report REAL state, not assert a
  // connection nothing checked (opus-fidelity C-1). The gateway's Gmail
  // watch status is the honest source for the inbound mail channel.
  const gmailQ = useQuery<{ configured: boolean }>({
    queryKey: ['comms-gmail-watch-status'],
    queryFn: async () => {
      const { data } = await apiClient.get('/communications/webhooks/gmail/status');
      return data;
    },
    staleTime: 5 * 60_000,
  });

  const rows: ProcurementHistoryItem[] = useMemo(() => {
    const items = historyQ.data ?? [];
    return [...items].sort(
      (a, b) => new Date(b.sentAt ?? b.createdAt).getTime() - new Date(a.sentAt ?? a.createdAt).getTime(),
    );
  }, [historyQ.data]);

  const glance: CommsGlance = useMemo(() => {
    const cutoff = Date.now() - 30 * 86_400_000;
    return {
      // The thread list is paginated — .threads.length is a page, .total is
      // the book (audit BLOCKER 3).
      threads: threadsQ.data === undefined ? null : threadsQ.data.total,
      draftsPending: activeQ.data === undefined ? null : activeQ.data.length,
      sentLast30:
        historyQ.data === undefined
          ? null
          : historyQ.data.filter(
              (i) =>
                sendState(i.status) === 'sent' &&
                new Date(i.sentAt ?? i.createdAt).getTime() >= cutoff,
            ).length,
      // The history endpoint serves at most its server cap; when the window
      // is full the 30-day figure is a floor, and the strip says so.
      sentLast30Truncated: (historyQ.data?.length ?? 0) >= 100,
      schedules: schedulesQ.data === undefined ? null : schedulesQ.data.length,
    };
  }, [historyQ.data, threadsQ.data, activeQ.data, schedulesQ.data]);

  return {
    rows,
    glance,
    /** null = unanswered; boolean = the gateway's own word. */
    gmailWatchConfigured: gmailQ.data === undefined ? null : gmailQ.data.configured,
    schedules: schedulesQ.data ?? [],
    schedulesKnown: schedulesQ.data !== undefined,
    hasData: historyQ.data !== undefined,
    isError: historyQ.isError,
    errorMessage: historyQ.error instanceof Error ? historyQ.error.message : 'unknown error',
    refetch: () => {
      void historyQ.refetch();
      void threadsQ.refetch();
      void activeQ.refetch();
      void schedulesQ.refetch();
    },
  };
}
