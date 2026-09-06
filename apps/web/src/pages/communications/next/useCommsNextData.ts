/**
 * CommunicationsNext data — the MERGE verdict's two halves reconciled at the
 * data layer: everything the old page showed at a glance is derived from the
 * same live sources (no new endpoints, no invented figures), and each glance
 * figure stays null until its query has actually answered.
 *
 * Sources: useProcurementConversationHistory (the outbound negotiation book),
 * useConversationThreads (inbound/outbound thread summaries), the drafts
 * awaiting action, the report schedules the legacy page managed, and the
 * gateway's own Gmail watch status.
 *
 * THREE STATES, NEVER TWO (ADR 0051 clause 3). Every source here can be
 * unanswered, failed, or answered, and this hook keeps all three apart:
 *
 *   unanswered  the figure is null and no failure is named
 *   failed      the figure is null AND `failed.<source>` is true
 *   answered    the figure is a number, zero included
 *
 * The rebuild originally collapsed the first two — `schedulesKnown = data !==
 * undefined` and `isError = historyQ.isError` — so a permanent 500 rendered as
 * latency forever and four of five sources had no failure surface at all.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import {
  useConversationThreads,
  useProcurementConversationHistory,
  type ProcurementHistoryItem,
} from '../../../hooks/queries/useConversationQueries';
import { useActiveConversations } from '../../../hooks/queries/useDraftEmailQueries';
import { apiClient } from '../../../services/api/client';
import { listReportSchedules, type ScheduledReport } from '../../../services/api/reports';
import { sendState } from './cm-format';

/**
 * Server-imposed windows this page renders behind. Each entry cites the query
 * that imposes it, and `scripts/check_windowed_figures.py` (W1) re-reads that
 * citation on every CI run: move the server's cap and the guard fails rather
 * than letting the page's floor prose become a confident falsehood.
 */
export const COMMS_SERVER_WINDOWS = {
  /**
   * procurement.service.ts:4208 — `getConversationHistory` ends
   * `.or(…).or(…).order("created_at", { ascending: false }).limit(100)`. The
   * 30-day sent figure is filtered from that page, so once the page is full the
   * figure is a floor and the strip prints `≥`.
   *
   * WHAT THIS CITATION DOES AND DOES NOT BUY. `check_windowed_figures.py`
   * requires the `<file>.ts:<line>` form and re-reads the cited FILE for a
   * matching `.limit(N)` — it does not re-read the cited LINE. This citation
   * said `:3820` and quoted `.in("status", HISTORY_STATUSES)`; within six hours
   * ADR 0084 replaced that status allow-list with the two `.or()` deny-list
   * filters above and moved the query, and the guard stayed green over a
   * citation that no longer described anything. The line is corrected here, and
   * the prose is kept to what the query still actually does.
   */
  HISTORY_ROWS: 100,
} as const;

export interface CommsGlance {
  /** null = the query behind the figure has not answered (or has failed). */
  threads: number | null;
  draftsPending: number | null;
  sentLast30: number | null;
  /** True when the history window hit its server cap — the figure is a floor. */
  sentLast30Truncated: boolean;
  schedules: number | null;
}

/** Which of the five sources returned a failure. Never merged with "unknown". */
export interface CommsFailures {
  history: boolean;
  threads: boolean;
  drafts: boolean;
  schedules: boolean;
  gmail: boolean;
}

/** Reader-facing names, in strip order, for the sentence the banner prints. */
const SOURCE_LABELS: Array<[keyof CommsFailures, string]> = [
  ['history', 'the conversation book'],
  ['threads', 'the thread index'],
  ['drafts', 'the drafts awaiting action'],
  ['schedules', 'the report schedules'],
  ['gmail', 'the Gmail watch status'],
];

function errText(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error';
}

export function useCommsNextData() {
  const { user, activeRestaurantId } = useAuth();
  // The gateway scopes every endpoint below from the JWT alone; the key literal
  // is the only thing keeping one tenant's cache out of another's.
  const restaurantId = activeRestaurantId ?? user?.restaurantId ?? '';

  const historyQ = useProcurementConversationHistory();
  const threadsQ = useConversationThreads();
  // Drafts awaiting action come from the same live source the orders DraftRail
  // uses — the history endpoint filters drafts out at the SQL level, so
  // deriving "drafts waiting" from it was a structurally guaranteed false
  // zero (communications-audit.md, BLOCKER 2).
  const activeQ = useActiveConversations();
  const schedulesQ = useQuery<ScheduledReport[]>({
    queryKey: ['report-schedules', restaurantId],
    queryFn: listReportSchedules,
    staleTime: 60_000,
  });
  // The rail's integration line must report REAL state, not assert a
  // connection nothing checked (opus-fidelity C-1). The gateway's Gmail
  // watch status is the honest source for the inbound mail channel.
  const gmailQ = useQuery<{ configured: boolean }>({
    queryKey: ['comms-gmail-watch-status', restaurantId],
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
      // The history endpoint serves at most COMMS_SERVER_WINDOWS.HISTORY_ROWS;
      // when the window is full the 30-day figure is a floor, and the strip
      // says so with GE.
      sentLast30Truncated: (historyQ.data?.length ?? 0) >= COMMS_SERVER_WINDOWS.HISTORY_ROWS,
      schedules: schedulesQ.data === undefined ? null : schedulesQ.data.length,
    };
  }, [historyQ.data, threadsQ.data, activeQ.data, schedulesQ.data]);

  const failed: CommsFailures = {
    history: historyQ.isError,
    threads: threadsQ.isError,
    drafts: activeQ.isError,
    schedules: schedulesQ.isError,
    gmail: gmailQ.isError,
  };

  const failedSources = SOURCE_LABELS.filter(([k]) => failed[k]).map(([, label]) => label);

  return {
    rows,
    glance,
    /** null = unanswered or failed; boolean = the gateway's own word. */
    gmailWatchConfigured: gmailQ.data === undefined ? null : gmailQ.data.configured,
    /**
     * The drafts themselves, not just how many there are.
     *
     * The strip has counted them since the rebuild; nothing could OPEN one,
     * which is what packet 2 owed. Same query, so the count and the list can
     * never disagree — a figure and a list from two reads is how a page ends up
     * saying "3 waiting" over an empty column.
     */
    drafts: activeQ.data ?? [],
    /** True only when the drafts register actually answered. */
    draftsKnown: activeQ.data !== undefined,
    schedules: schedulesQ.data ?? [],
    /** True only when the schedule register actually answered. */
    schedulesKnown: schedulesQ.data !== undefined,
    /**
     * The schedule register's failure, kept SEPARATE from `schedulesKnown` —
     * the distinction the legacy page held (Communications.tsx:269, 293-299)
     * and the rebuild deleted.
     *
     * This is not hypothetical latency. `public.scheduled_reports` is created
     * by no migration in `supabase/migrations/`; a later migration
     * (20260826170000_integration_oauth_tables.sql:26) names it as one of five
     * tables "living outside supabase/migrations/ that production never saw".
     * So `GET /reports/schedules` fails 100% of the time, and a page that can
     * only say "hasn't answered yet" says it forever.
     */
    schedulesError: schedulesQ.isError ? errText(schedulesQ.error) : null,
    hasData: historyQ.data !== undefined,
    isError: historyQ.isError,
    errorMessage: errText(historyQ.error),
    /** Per-source failure. The banner and the strip both read this. */
    failed,
    /**
     * Reader-facing names of the failed sources, for the banner's sentence.
     * Its emptiness IS the banner's condition — one source of truth, so a
     * banner can never appear naming nothing, nor a failure go unnamed.
     */
    failedSources,
    refetch: () => {
      void historyQ.refetch();
      void threadsQ.refetch();
      void activeQ.refetch();
      void schedulesQ.refetch();
      // The Gmail line is a fifth source and was previously unreachable from
      // "Try again", which made the button's promise partly false.
      void gmailQ.refetch();
    },
  };
}
