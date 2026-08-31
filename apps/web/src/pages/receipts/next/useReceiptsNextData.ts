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
 *    its linked order for side-by-side context, and the line matcher's
 *    suggestions are surfaced for one-tap confirmation (never auto-written).
 * 4. "Editable, and confirmable right away" — inline line edits PATCH the
 *    new gateway route and the recomputed tie-out lands in the same response.
 */

import { useQuery } from '@tanstack/react-query';
import { documentsApi, type ProcurementDocument } from '../../../services/api/documents';
import { receivingApi, type UnverifiedDelivery } from '../../../services/api/receiving';

export function useReceiptsNextData() {
  const queueQ = useQuery<ProcurementDocument[]>({
    queryKey: ['receipts-next', 'queue'],
    queryFn: () => documentsApi.list({ status: 'needs_review', limit: 100 }),
    staleTime: 30_000,
  });
  const verifiedQ = useQuery<ProcurementDocument[]>({
    queryKey: ['receipts-next', 'verified'],
    queryFn: () => documentsApi.list({ status: 'verified', limit: 100 }),
    staleTime: 60_000,
  });
  const unverifiedQ = useQuery<{ items: UnverifiedDelivery[] }>({
    queryKey: ['receipts-next', 'unverified-deliveries'],
    queryFn: () => receivingApi.listUnverified(),
    staleTime: 30_000,
  });

  return {
    queue: queueQ.data ?? [],
    queueKnown: queueQ.data !== undefined,
    verifiedCount: verifiedQ.data === undefined ? null : verifiedQ.data.length,
    verifiedCapped: (verifiedQ.data?.length ?? 0) >= 100,
    deliveriesWithoutPaper: unverifiedQ.data?.items ?? [],
    deliveriesKnown: unverifiedQ.data !== undefined,
    isError: queueQ.isError,
    errorMessage: queueQ.error instanceof Error ? queueQ.error.message : 'unknown error',
    refetch: () => {
      void queueQ.refetch();
      void verifiedQ.refetch();
      void unverifiedQ.refetch();
    },
  };
}
