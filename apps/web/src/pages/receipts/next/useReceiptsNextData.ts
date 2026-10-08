/**
 * ReceiptsNext data — the founder's four receipts requirements, sourced:
 *
 * 1. "Compress everything from all of the orders into this surface" — the
 *    review queue (documents awaiting review) AND the deliveries that have
 *    no paperwork yet (receiving's unverified list) share the surface, so
 *    nothing about an order's paper trail lives anywhere else.
 * 2. Backend integration without overcrowding — three queries, one selected
 *    document fetched on demand.
 * 3. "Make sure it is the right invoice" — the selected document view loads
 *    its linked order for side-by-side context AND the stored scan itself,
 *    and the line matcher's suggestions are surfaced for one-tap confirmation.
 *    NOTE: the matcher DOES write unambiguous vendor-SKU pairings server-side
 *    (documents.controller.ts:209-224, line-matcher.ts:282-296) and returns
 *    them under `applied`. Only `suggested` is withheld from the database.
 *    An earlier version of this docblock said "never auto-written", which was
 *    false; the page now shows what was written and offers to unlink it.
 * 4. "Editable, and confirmable right away" — inline line edits PATCH the
 *    new gateway route and the recomputed tie-out lands in the same response.
 */

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { documentsApi, type ProcurementDocument } from '../../../services/api/documents';
import { receivingApi, type UnverifiedDelivery } from '../../../services/api/receiving';
import {
  creditsApi,
  type CreditState,
  type CreditStats,
  type ProcurementCredit,
} from '../../../services/api/credits';
import { failureReason } from './rc2-format';

// Failures in the house's words, never the client library's (walk-through W26).
// Module scope, so the hooks' memo dependencies need not list it.
const msg = failureReason;

/**
 * The caps the GATEWAY imposes on what this page can see. Each entry cites the
 * query that imposes it, so `scripts/check_windowed_figures.py` can prove the
 * declared number is still the real one — a page whose floor prose names a cap
 * the server stopped using is stating a falsehood that reads like a
 * measurement. (ADR 0051 clause 2; the receiving lane keeps the same register.)
 */
export const RECEIPTS_SERVER_WINDOWS = {
  /** documents.controller.ts:117 — `Math.min(200, …)` hard-caps every list. */
  QUEUE_ITEMS: 100,
  /** documents.controller.ts:117 — the same cap on the verified lane. */
  VERIFIED_ITEMS: 100,
  /**
   * credits.controller.ts:113 — the credit ledger's list, oldest first. The
   * route takes no limit from the client, so a full list is the only sign the
   * newest claims were left out.
   */
  CREDITS_LIST: 200,
  /**
   * credits.controller.ts:137 — every recovery figure is computed behind this.
   * The route says itself whether it hit the cap (`capped`); an older gateway
   * that does not say is read as a floor.
   */
  RECOVERY_STATS: 5000,
  /** documents.controller.ts:117 — the credit memos a settlement can name. */
  CREDIT_MEMOS: 100,
  /**
   * documents.controller.ts list, `docType=unknown` — the papers nothing has
   * classed, which a person may mark as the credit memo (F-159).
   */
  UNCLASSED_PAPERS: 50,
  /**
   * house-letters.service.ts:892 — `lettersForCredits`' read of every claim's
   * house letters, across the WHOLE batch of claims on this page, not per
   * claim. Past this many rows a claim's own letter can fall out of the
   * window; the gateway then reports `lettersCapped` and a claim ABSENT from
   * its response is unknown rather than "no letter" (audit round 1, R4).
   */
  CREDIT_LETTERS: 500,
} as const;

export interface ReceiptsNextData {
  queue: ProcurementDocument[];
  /** False until the queue actually arrived — an empty array then means UNKNOWN. */
  queueKnown: boolean;
  /** True when the queue filled its window, so `queue.length` is a floor. */
  queueCapped: boolean;
  /**
   * Vendor paper that READ CLEANLY and nobody has confirmed yet (walk-through
   * RECEIPTS-W44, 2026-10-01). Intake files a paper that adds up with no
   * warning as `received`, and this page listed only `needs_review` and
   * `verified` — so a clean paper never reached a person's swipe here and was
   * visible only on Documents & Reports. The house's OWN papers (a door count
   * is a receiving advice, `direction = issued_by_us`) are left out: nobody
   * confirms their own count as if a vendor had sent it.
   */
  clean: ProcurementDocument[];
  cleanKnown: boolean;
  cleanCapped: boolean;
  verified: ProcurementDocument[];
  verifiedKnown: boolean;
  verifiedCount: number | null;
  verifiedCapped: boolean;
  /** null until the uncounted list answers — `[]` would read as "all clear". */
  deliveriesWithoutPaper: UnverifiedDelivery[] | null;
  deliveriesKnown: boolean;
  isError: boolean;
  /** One sentence per query that failed, so a dead endpoint is never silent. */
  failures: string[];
  errorMessage: string;
  /**
   * The failures split by whether that read had answered before (walk-through
   * RECEIPTS-W49). A read that answered before still shows its last answer; a
   * read that never answered shows nothing, so calling what is below "the last
   * answer" would claim one that never came.
   */
  failuresStale: string[];
  failuresUnread: string[];
  /** "them" rather than "it" for the unread ones: more than one, or a plural read. */
  failuresUnreadPlural: boolean;
  /**
   * A list `?doc=` searches (the queue, the clean papers, the verified book)
   * failed without ever answering, so a linked document cannot be found or
   * ruled out: "Opening…" would never finish (RECEIPTS-W50c).
   */
  documentsUnread: boolean;
  /** No restaurant resolved: the tenant-scoped endpoints were never asked. */
  noRestaurant: boolean;
  refetch: () => void;
}

/**
 * Every query key below carries the active restaurant id: the gateway scopes
 * these endpoints by tenant through the `X-Restaurant-Id` header the client
 * stamps from localStorage (services/api/client.ts:67-69), so an unkeyed cache
 * would serve the PREVIOUS restaurant's documents for a beat (or until
 * refetch) after a restaurant switch — the cross-tenant leak class fixed on
 * /receiving in PR #212 and missed here.
 *
 * The empty case is NOT folded into one shared `''` bucket. Two people who
 * resolve no restaurant are not the same tenant; they are two unknowns, and
 * giving them one cache key is the same leak with a different door. When no id
 * resolves, the queries do not run at all and the page says so.
 */
export function useActiveRestaurantId(): string | null {
  const { activeRestaurantId, user } = useAuth();
  return activeRestaurantId || user?.restaurantId || null;
}

export function useReceiptsNextData(): ReceiptsNextData {
  const rid = useActiveRestaurantId();
  const enabled = rid !== null;

  const queueQ = useQuery<ProcurementDocument[]>({
    queryKey: ['receipts-next', 'queue', rid],
    queryFn: () =>
      documentsApi.list({ status: 'needs_review', limit: RECEIPTS_SERVER_WINDOWS.QUEUE_ITEMS }),
    enabled,
    staleTime: 30_000,
  });
  const verifiedQ = useQuery<ProcurementDocument[]>({
    queryKey: ['receipts-next', 'verified', rid],
    queryFn: () =>
      documentsApi.list({ status: 'verified', limit: RECEIPTS_SERVER_WINDOWS.VERIFIED_ITEMS }),
    enabled,
    staleTime: 60_000,
  });
  const cleanQ = useQuery<ProcurementDocument[]>({
    queryKey: ['receipts-next', 'clean', rid],
    queryFn: () =>
      documentsApi.list({ status: 'received', limit: RECEIPTS_SERVER_WINDOWS.QUEUE_ITEMS }),
    enabled,
    staleTime: 30_000,
  });
  const unverifiedQ = useQuery<{ items: UnverifiedDelivery[] }>({
    queryKey: ['receipts-next', 'unverified-deliveries', rid],
    queryFn: () => receivingApi.listUnverified(),
    enabled,
    staleTime: 30_000,
  });


  /**
   * All three failures are surfaced. Before, `isError` was `queueQ.isError`
   * alone, so a dead uncounted-deliveries endpoint rendered exactly like a
   * caught-up door — absence reported as health.
   */
  const failed = useMemo(() => {
    const out: { sentence: string; read: boolean; plural: boolean }[] = [];
    if (queueQ.isError)
      out.push({ sentence: `the review queue (${msg(queueQ.error)})`, read: queueQ.data !== undefined, plural: false });
    if (verifiedQ.isError)
      out.push({ sentence: `the verified book (${msg(verifiedQ.error)})`, read: verifiedQ.data !== undefined, plural: false });
    if (cleanQ.isError)
      out.push({ sentence: `the papers that read cleanly (${msg(cleanQ.error)})`, read: cleanQ.data !== undefined, plural: true });
    if (unverifiedQ.isError)
      out.push({
        sentence: `the deliveries counted at the door (${msg(unverifiedQ.error)})`,
        read: unverifiedQ.data !== undefined,
        plural: true,
      });
    return out;
  }, [
    queueQ.isError,
    queueQ.error,
    queueQ.data,
    verifiedQ.isError,
    verifiedQ.error,
    verifiedQ.data,
    cleanQ.isError,
    cleanQ.error,
    cleanQ.data,
    unverifiedQ.isError,
    unverifiedQ.error,
    unverifiedQ.data,
  ]);
  const failures = failed.map((f) => f.sentence);
  const unread = failed.filter((f) => !f.read);

  const queue = queueQ.data ?? [];
  const verified = verifiedQ.data ?? [];
  // `direction` comes back from the list's `select("*")` but is not on the
  // shared client type, so it is read here rather than widened there (W44).
  const cleanRows = cleanQ.data ?? [];
  const clean = cleanRows.filter(
    (d) => (d as { direction?: string | null }).direction !== 'issued_by_us',
  );

  return {
    queue,
    queueKnown: queueQ.data !== undefined,
    queueCapped: queue.length >= RECEIPTS_SERVER_WINDOWS.QUEUE_ITEMS,
    clean,
    cleanKnown: cleanQ.data !== undefined,
    // Capped on what the SERVER sent, before our own rows were taken out.
    cleanCapped: cleanRows.length >= RECEIPTS_SERVER_WINDOWS.QUEUE_ITEMS,
    verified,
    verifiedKnown: verifiedQ.data !== undefined,
    verifiedCount: verifiedQ.data === undefined ? null : verifiedQ.data.length,
    verifiedCapped: verified.length >= RECEIPTS_SERVER_WINDOWS.VERIFIED_ITEMS,
    deliveriesWithoutPaper: unverifiedQ.data === undefined ? null : unverifiedQ.data.items ?? [],
    deliveriesKnown: unverifiedQ.data !== undefined,
    isError: failures.length > 0,
    failures,
    errorMessage: failures.join('; ') || 'unknown error',
    failuresStale: failed.filter((f) => f.read).map((f) => f.sentence),
    failuresUnread: unread.map((f) => f.sentence),
    failuresUnreadPlural: unread.length > 1 || unread.some((f) => f.plural),
    documentsUnread: [queueQ, cleanQ, verifiedQ].some((q) => q.isError && q.data === undefined),
    noRestaurant: !enabled,
    refetch: () => {
      void queueQ.refetch();
      void verifiedQ.refetch();
      void cleanQ.refetch();
      void unverifiedQ.refetch();
    },
  };
}

/* ───────────────────────────────────────── the credit ledger (ADR 0149 row 22) ── */

/**
 * The legal moves, mirrored from the gateway's `TRANSITIONS`
 * (`apps/api-gateway/src/procurement/documents/credit-ledger.ts`). The server
 * refuses anything else with 422, so this table only decides which buttons are
 * offered; `ReceiptsCredits.test.tsx` reads the gateway file and fails if the
 * two ever disagree. The legacy tab had `rejected: []`, which hid "ask again"
 * from a refused claim the server would have let a manager press.
 */
export const CREDIT_MOVES: Record<CreditState, readonly CreditState[]> = {
  // open -> credited: an unasked memo settles the claim (ADR 0267 item 9, F-159).
  open: ['requested', 'credited', 'written_off', 'rejected'],
  requested: ['promised', 'credited', 'rejected', 'written_off'],
  promised: ['credited', 'rejected', 'written_off'],
  credited: [],
  rejected: ['requested', 'written_off'],
  written_off: [],
};

/** States a claim is still being chased in. `stats.outstanding` excludes `promised`. */
export const CHASED_STATES: readonly CreditState[] = ['open', 'requested', 'promised'];

export interface ReceiptsCreditsData {
  /** null until the list answers — `[]` would read as "no claims". */
  claims: ProcurementCredit[] | null;
  /** True when the list filled the server's window, so the newest are missing. */
  claimsCapped: boolean;
  stats: CreditStats | null;
  /** True unless the server said it did NOT hit its cap. */
  statsFloor: boolean;
  /** The house's credit memos; null until that list answers. */
  memos: ProcurementDocument[] | null;
  memosCapped: boolean;
  /** Papers nothing has classed (`unknown`), any of which may be the memo; null until read. */
  unclassed: ProcurementDocument[] | null;
  unclassedCapped: boolean;
  /** One sentence per source that failed, so a dead endpoint is never silent. */
  failures: string[];
  /** The gateway refused the ledger to this person (ADR 0167). */
  refused: boolean;
  noRestaurant: boolean;
  refetch: () => void;
}

function httpStatus(e: unknown): number | null {
  const s = (e as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof s === 'number' ? s : null;
}

/**
 * The ledger's three reads. `enabled` is false for anyone the tab is not
 * offered to, so a staff session never spends a request the gateway refuses.
 */
export function useReceiptsCreditsData(enabled: boolean): ReceiptsCreditsData {
  const rid = useActiveRestaurantId();
  const on = enabled && rid !== null;

  const claimsQ = useQuery<ProcurementCredit[]>({
    queryKey: ['receipts-next', 'credits', rid],
    queryFn: () => creditsApi.list(),
    enabled: on,
    staleTime: 30_000,
  });
  const statsQ = useQuery<CreditStats>({
    queryKey: ['receipts-next', 'credit-stats', rid],
    queryFn: () => creditsApi.stats(),
    enabled: on,
    staleTime: 30_000,
  });
  const memosQ = useQuery<ProcurementDocument[]>({
    queryKey: ['receipts-next', 'credit-memos', rid],
    queryFn: () =>
      documentsApi.list({ docType: 'credit_memo', limit: RECEIPTS_SERVER_WINDOWS.CREDIT_MEMOS }),
    enabled: on,
    staleTime: 60_000,
  });

  const unclassedQ = useQuery<ProcurementDocument[]>({
    queryKey: ['receipts-next', 'unclassed-papers', rid],
    queryFn: () =>
      documentsApi.list({ docType: 'unknown', limit: RECEIPTS_SERVER_WINDOWS.UNCLASSED_PAPERS }),
    enabled: on,
    staleTime: 60_000,
  });

  const refused = [claimsQ.error, statsQ.error].some((e) => httpStatus(e) === 403);

  const failures = useMemo(() => {
    const out: string[] = [];
    if (claimsQ.isError && httpStatus(claimsQ.error) !== 403)
      out.push(`the claims (${msg(claimsQ.error)})`);
    if (statsQ.isError && httpStatus(statsQ.error) !== 403)
      out.push(`the recovery figures (${msg(statsQ.error)})`);
    if (memosQ.isError) out.push(`the credit memos on file (${msg(memosQ.error)})`);
    if (unclassedQ.isError) out.push(`the unread papers (${msg(unclassedQ.error)})`);
    return out;
  }, [
    claimsQ.isError,
    claimsQ.error,
    statsQ.isError,
    statsQ.error,
    memosQ.isError,
    memosQ.error,
    unclassedQ.isError,
    unclassedQ.error,
  ]);

  const claims = claimsQ.data === undefined ? null : claimsQ.data;
  const memos = memosQ.data === undefined ? null : memosQ.data;
  const unclassed = unclassedQ.data === undefined ? null : unclassedQ.data;
  const stats = statsQ.data === undefined ? null : statsQ.data;

  return {
    claims,
    claimsCapped: (claims?.length ?? 0) >= RECEIPTS_SERVER_WINDOWS.CREDITS_LIST,
    stats,
    statsFloor: stats?.capped !== false,
    memos,
    memosCapped: (memos?.length ?? 0) >= RECEIPTS_SERVER_WINDOWS.CREDIT_MEMOS,
    unclassed,
    unclassedCapped: (unclassed?.length ?? 0) >= RECEIPTS_SERVER_WINDOWS.UNCLASSED_PAPERS,
    failures,
    refused,
    noRestaurant: rid === null,
    refetch: () => {
      void claimsQ.refetch();
      void statsQ.refetch();
      void memosQ.refetch();
      void unclassedQ.refetch();
    },
  };
}

export interface CreditMove {
  id: string;
  to: CreditState;
  creditedAmount?: number;
  creditDocumentId?: string;
}

/**
 * One move through the ledger. Every surface that reads a claim is refreshed —
 * this page's three reads and /receiving's drafts, recovery figures and credited
 * list — so a settlement recorded here is not contradicted there.
 */
/**
 * Mark a paper as the credit memo (F-159). Refreshes both paper lists, so the
 * marked paper leaves "unread" and appears among the memos a settlement can name.
 */
export function useMarkMemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => creditsApi.markMemo(documentId),
    onSettled: async () => {
      await Promise.all(
        [
          ['receipts-next', 'credit-memos'],
          ['receipts-next', 'unclassed-papers'],
        ].map((key) => qc.invalidateQueries({ queryKey: key })),
      );
    },
  });
}

export function useCreditMove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (m: CreditMove) =>
      creditsApi.transition(m.id, {
        to: m.to,
        creditedAmount: m.creditedAmount,
        creditDocumentId: m.creditDocumentId,
      }),
    onSettled: () => {
      for (const key of [
        ['receipts-next', 'credits'],
        ['receipts-next', 'credit-stats'],
        ['receiving-next-credit-drafts'],
        ['receiving-next-recovery'],
        ['receiving-next-credited-list'],
      ])
        void qc.invalidateQueries({ queryKey: key });
    },
  });
}

