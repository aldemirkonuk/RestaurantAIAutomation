/**
 * CommunicationsNext data — the MERGE verdict's two halves reconciled at the
 * data layer: everything the old page showed at a glance is derived from the
 * same live sources (no new endpoints, no invented figures), and each glance
 * figure stays null until its query has actually answered.
 *
 * Sources — the THREE this page owns (ADR 0083, amended 2026-09-25):
 * useProcurementConversationHistory (the outbound negotiation book),
 * useConversationThreads (inbound/outbound thread summaries), and the drafts
 * awaiting action.
 *
 * Two sources left this page on that date, by the founder's answer
 * ("amend ADR 0083", option a):
 *   - the report schedules. `public.scheduled_reports` is created by no
 *     migration in `supabase/migrations/`, so `GET /reports/schedules` failed
 *     for every house and the banner below alarmed on every visit. The card
 *     returns when a real table exists (v3.0-TECH-DEBT, "Scheduled reports
 *     is a dead feature"); `check_queried_tables_exist.py` KNOWN_MISSING keeps
 *     the missing table visible to CI without this page having to say it.
 *   - the Gmail watch status. It is one deployment-wide Pub/Sub credential,
 *     not a fact about this house; it now reads on the admin desk
 *     (`pages/admin/next/AdminDesk.tsx`, ADR 0143).
 * Neither query is issued from here any more: a read this page cannot show
 * is a read it should not make.
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
 * latency forever and four of the then five sources had no failure surface.
 */

import { useMemo } from 'react';
import {
  useConversationThreads,
  useProcurementConversationHistory,
  type ProcurementHistoryItem,
} from '../../../hooks/queries/useConversationQueries';
import { useActiveConversations } from '../../../hooks/queries/useDraftEmailQueries';
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
}

/** Which of the three owned sources returned a failure. Never merged with "unknown". */
export interface CommsFailures {
  history: boolean;
  threads: boolean;
  drafts: boolean;
}

/** Reader-facing names, in strip order, for the sentence the banner prints. */
const SOURCE_LABELS: Array<[keyof CommsFailures, string]> = [
  ['history', 'the conversation book'],
  ['threads', 'the thread index'],
  ['drafts', 'the drafts awaiting action'],
];

function errText(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error';
}

export function useCommsNextData() {
  // Every query this page reads lives in a shared hook whose key carries the
  // house (`scripts/check_windowed_figures.py` W7 reads those keys). The two
  // page-local keys that also carried it left with their sources, 2026-09-25.
  const historyQ = useProcurementConversationHistory();
  const threadsQ = useConversationThreads();
  // Drafts awaiting action come from the same live source the orders DraftRail
  // uses — the history endpoint filters drafts out at the SQL level, so
  // deriving "drafts waiting" from it was a structurally guaranteed false
  // zero (communications-audit.md, BLOCKER 2).
  const activeQ = useActiveConversations();

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
    };
  }, [historyQ.data, threadsQ.data, activeQ.data]);

  const failed: CommsFailures = {
    history: historyQ.isError,
    threads: threadsQ.isError,
    drafts: activeQ.isError,
  };

  const failedSources = SOURCE_LABELS.filter(([k]) => failed[k]).map(([, label]) => label);

  return {
    rows,
    glance,
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
    },
  };
}
