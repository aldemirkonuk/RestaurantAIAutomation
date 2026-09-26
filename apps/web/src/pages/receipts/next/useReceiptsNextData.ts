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
} as const;

export interface ReceiptsNextData {
  queue: ProcurementDocument[];
  /** False until the queue actually arrived — an empty array then means UNKNOWN. */
  queueKnown: boolean;
  /** True when the queue filled its window, so `queue.length` is a floor. */
  queueCapped: boolean;
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
  const unverifiedQ = useQuery<{ items: UnverifiedDelivery[] }>({
    queryKey: ['receipts-next', 'unverified-deliveries', rid],
    queryFn: () => receivingApi.listUnverified(),
    enabled,
    staleTime: 30_000,
  });

  const msg = (e: unknown) => (e instanceof Error ? e.message : 'unknown error');

  /**
   * All three failures are surfaced. Before, `isError` was `queueQ.isError`
   * alone, so a dead uncounted-deliveries endpoint rendered exactly like a
   * caught-up door — absence reported as health.
   */
  const failures = useMemo(() => {
    const out: string[] = [];
    if (queueQ.isError) out.push(`the review queue (${msg(queueQ.error)})`);
    if (verifiedQ.isError) out.push(`the verified book (${msg(verifiedQ.error)})`);
    if (unverifiedQ.isError)
      out.push(`the deliveries counted at the door (${msg(unverifiedQ.error)})`);
    return out;
  }, [queueQ.isError, queueQ.error, verifiedQ.isError, verifiedQ.error, unverifiedQ.isError, unverifiedQ.error]);

  const queue = queueQ.data ?? [];
  const verified = verifiedQ.data ?? [];

  return {
    queue,
    queueKnown: queueQ.data !== undefined,
    queueCapped: queue.length >= RECEIPTS_SERVER_WINDOWS.QUEUE_ITEMS,
    verified,
    verifiedKnown: verifiedQ.data !== undefined,
    verifiedCount: verifiedQ.data === undefined ? null : verifiedQ.data.length,
    verifiedCapped: verified.length >= RECEIPTS_SERVER_WINDOWS.VERIFIED_ITEMS,
    deliveriesWithoutPaper: unverifiedQ.data === undefined ? null : unverifiedQ.data.items ?? [],
    deliveriesKnown: unverifiedQ.data !== undefined,
    isError: failures.length > 0,
    failures,
    errorMessage: failures.join('; ') || 'unknown error',
    noRestaurant: !enabled,
    refetch: () => {
      void queueQ.refetch();
      void verifiedQ.refetch();
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
  open: ['requested', 'written_off', 'rejected'],
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

  const msg = (e: unknown) => (e instanceof Error ? e.message : 'unknown error');
  const refused = [claimsQ.error, statsQ.error].some((e) => httpStatus(e) === 403);

  const failures = useMemo(() => {
    const out: string[] = [];
    if (claimsQ.isError && httpStatus(claimsQ.error) !== 403)
      out.push(`the claims (${msg(claimsQ.error)})`);
    if (statsQ.isError && httpStatus(statsQ.error) !== 403)
      out.push(`the recovery figures (${msg(statsQ.error)})`);
    if (memosQ.isError) out.push(`the credit memos on file (${msg(memosQ.error)})`);
    return out;
  }, [claimsQ.isError, claimsQ.error, statsQ.isError, statsQ.error, memosQ.isError, memosQ.error]);

  const claims = claimsQ.data === undefined ? null : claimsQ.data;
  const memos = memosQ.data === undefined ? null : memosQ.data;
  const stats = statsQ.data === undefined ? null : statsQ.data;

  return {
    claims,
    claimsCapped: (claims?.length ?? 0) >= RECEIPTS_SERVER_WINDOWS.CREDITS_LIST,
    stats,
    statsFloor: stats?.capped !== false,
    memos,
    memosCapped: (memos?.length ?? 0) >= RECEIPTS_SERVER_WINDOWS.CREDIT_MEMOS,
    failures,
    refused,
    noRestaurant: rid === null,
    refetch: () => {
      void claimsQ.refetch();
      void statsQ.refetch();
      void memosQ.refetch();
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

