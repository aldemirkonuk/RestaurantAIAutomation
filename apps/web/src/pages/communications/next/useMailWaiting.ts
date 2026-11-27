/**
 * How many people are waiting on the house, for the sidebar (r107 mail-gap g5).
 * Its own small file so the shell does not carry the Mail hooks and words. It
 * reads the SAME cache entry as the Mail tab's summary (the key is the one in
 * useMailData's `mailKeys.summary`, proved equal in the test), from the same
 * GET /mail/summary, so it adds no request while that read is fresh. Read with a
 * 60 s stale time and again on window focus, never on an interval: the summary
 * polls itself while Mail is open. A failed or unread summary draws no badge,
 * as the other sidebar badges do not.
 */
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import { apiClient } from '../../../services/api/client';

/** Who a waiting vendor waits on in the sidebar: every role's words, never "you" (r36 mail gap 14). */
export const SIDEBAR_WAITING_ON = 'the house';

export function useMailWaiting(): number {
  const { user, activeRestaurantId } = useAuth();
  const house = activeRestaurantId ?? user?.restaurantId ?? '';
  const q = useQuery<{ waitingPeople?: number | null }>({
    queryKey: ['mail-summary', house],
    queryFn: async () => (await apiClient.get<{ waitingPeople?: number | null }>('/mail/summary')).data,
    enabled: Boolean(house),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: false,
  });
  const n = q.data?.waitingPeople;
  return typeof n === 'number' && n > 0 ? n : 0;
}
