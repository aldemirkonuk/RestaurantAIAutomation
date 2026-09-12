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
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { documentsApi, type ProcurementDocument } from '../../../services/api/documents';
import { receivingApi, type UnverifiedDelivery } from '../../../services/api/receiving';

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
