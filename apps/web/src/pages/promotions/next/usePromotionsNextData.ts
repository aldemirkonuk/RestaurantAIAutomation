/**
 * `/promotions` (PromotionsNext) — the page's own read.
 *
 * `GET /promotions` (`apps/api-gateway/src/promotions/promotions.controller.ts`)
 * is a NEW route, separate from the legacy page's `GET /providers/promotions/
 * active` — see `promotions.service.ts`'s own header for why: that route
 * carries no restaurant clause at all (a pre-existing fault this page does not
 * touch), and this page needs the grade, the dismissal column and one
 * `read_at` the old route never had. Every call goes through `apiClient`
 * (bearer token stamped synchronously), matching every other rebuilt page.
 *
 * Honesty contract (ADR 0020 / 0051), enforced by react-query's own states
 * rather than re-derived: `isLoading` → skeleton, never a zero; `isError` →
 * `failureOf(error)` names 401/403/other as three different sentences
 * (`promotions-format.ts`); a success with zero offers is a real empty table,
 * carrying `ledger.window_days` so the page can say what it is empty OF.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../services/api/client';
import type { PromotionsReadDto } from './promotions-format';

const KEY = ['promotions-next', 'read'] as const;

export function usePromotionsRead(includeDismissed: boolean) {
  return useQuery({
    queryKey: [...KEY, includeDismissed],
    queryFn: () =>
      apiClient
        .get('/promotions', { params: includeDismissed ? { includeDismissed: 'true' } : undefined })
        .then((r) => r.data as PromotionsReadDto),
    staleTime: 30_000,
    retry: false,
  });
}

/** Put an offer away for the whole house (ADR 0144 §4). Undo-after (ADR 0112 F10): the card leaves once this resolves, not before. */
export function useDismissOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post(`/promotions/${id}/dismiss`).then((r) => r.data as { dismissed: true; dismissed_at: string }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Bring a put-away offer back to the table (the undo act). */
export function useRestoreOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/promotions/${id}/restore`).then((r) => r.data as { restored: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
