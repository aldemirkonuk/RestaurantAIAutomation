/**
 * "Who is writing" — this page's own reads and writes for sender reputation and
 * strangers (prospects). ADR 0160 §113, Open item 3: moved here from
 * `/promotions`.
 *
 * WHY NOT THE SHARED `usePromotionsQueries` HOOKS. Same endpoints, same DTOs
 * (the types are imported, not restated), different cache keys. The shared
 * hooks key their caches `['sender-reputation']` and `['prospects', …]` —
 * bare, with no house in them — and the house switcher does not clear the
 * query cache, so a manager who switched houses inside the staleness window
 * would read the OTHER house's trust ledger and be offered "Hold to trust" on
 * it. This is a security register; every key here carries the house
 * (`check_windowed_figures.py` W6 is the standing rule for this directory).
 *
 * Routes (gateway, `common/orchestrator/`, NOT promotions-scoped — nothing on
 * the gateway moves with this page):
 *   GET  /senders/reputation      owner/manager   (`sender-trust.controller.ts`)
 *   POST /senders/trust           owner/manager
 *   GET  /prospects[?scope=all]   any member      (`prospects.controller.ts`; `.limit(100)`)
 *   POST /prospects/:id/promote   owner/manager
 *   POST /prospects/:id/dismiss   any member
 *   POST /prospects/:id/restore   any member
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import { apiClient } from '../../../services/api/client';
import type { ProspectDto, SenderReputationDto } from '../../../hooks/queries/usePromotionsQueries';

/** The prospects list is capped server-side (`prospects.service.ts` `.limit(100)`): a full window is a floor, not a total. */
export const SENDERS_SERVER_WINDOWS = { PROSPECTS: 100 } as const;

function useRid(): string {
  const { user, activeRestaurantId } = useAuth();
  return activeRestaurantId ?? user?.restaurantId ?? '';
}

export function useSenderRegister() {
  const restaurantId = useRid();
  return useQuery({
    queryKey: ['comms-senders', restaurantId],
    queryFn: () => apiClient.get('/senders/reputation').then((r) => r.data as SenderReputationDto[]),
    staleTime: 30_000,
    retry: false,
  });
}

/** Trust or untrust a domain. Resolves with the gateway's answer, which is NOT proof the row changed — callers read the register back. */
export function useSetSenderTrust() {
  const restaurantId = useRid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { domain: string; trusted: boolean; providerId?: string }) =>
      apiClient.post('/senders/trust', body).then((r) => r.data as { domain: string; trusted: boolean }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['comms-senders', restaurantId] }),
  });
}

export function useStrangers(allHouses: boolean) {
  const restaurantId = useRid();
  return useQuery({
    queryKey: ['comms-strangers', restaurantId, allHouses ? 'all' : 'this'],
    queryFn: () =>
      apiClient
        .get('/prospects', { params: allHouses ? { scope: 'all' } : undefined })
        .then((r) => r.data as ProspectDto[]),
    staleTime: 30_000,
    retry: false,
  });
}

function useStrangerMutation<T>(path: (id: string) => string, alsoProviders = false) {
  const restaurantId = useRid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post(path(id)).then((r) => r.data as T),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['comms-strangers', restaurantId] });
      // A promoted stranger is a new vendor: the vendor lists elsewhere are stale too.
      if (alsoProviders) qc.invalidateQueries({ queryKey: ['providers'] });
    },
  });
}

export function usePromoteStranger() {
  return useStrangerMutation<{ promoted: boolean; providerId?: string; reused?: boolean }>(
    (id) => `/prospects/${id}/promote`,
    true,
  );
}
export function usePutAwayStranger() {
  return useStrangerMutation<{ dismissed: boolean }>((id) => `/prospects/${id}/dismiss`);
}
export function useRestoreStranger() {
  return useStrangerMutation<{ restored: boolean }>((id) => `/prospects/${id}/restore`);
}
