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
import { listReportSchedules, type ScheduledReport } from '../../../services/api/reports';
import { sendState } from './cm-format';

export interface CommsGlance {
  /** null = the query behind the figure has not answered. */
  threads: number | null;
  draftsPending: number | null;
  sentLast30: number | null;
  schedules: number | null;
}

export function useCommsNextData() {
  const historyQ = useProcurementConversationHistory();
  const threadsQ = useConversationThreads();
  const schedulesQ = useQuery<ScheduledReport[]>({
    queryKey: ['report-schedules'],
    queryFn: listReportSchedules,
    staleTime: 60_000,
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
      threads: threadsQ.data === undefined ? null : threadsQ.data.threads.length,
      draftsPending:
        historyQ.data === undefined
          ? null
          : historyQ.data.filter((i) => sendState(i.status) === 'draft').length,
      sentLast30:
        historyQ.data === undefined
          ? null
          : historyQ.data.filter(
              (i) =>
                sendState(i.status) !== 'draft' &&
                new Date(i.sentAt ?? i.createdAt).getTime() >= cutoff,
            ).length,
      schedules: schedulesQ.data === undefined ? null : schedulesQ.data.length,
    };
  }, [historyQ.data, threadsQ.data, schedulesQ.data]);

  return {
    rows,
    glance,
    schedules: schedulesQ.data ?? [],
    schedulesKnown: schedulesQ.data !== undefined,
    hasData: historyQ.data !== undefined,
    isError: historyQ.isError,
    errorMessage: historyQ.error instanceof Error ? historyQ.error.message : 'unknown error',
    refetch: () => {
      void historyQ.refetch();
      void threadsQ.refetch();
      void schedulesQ.refetch();
    },
  };
}
