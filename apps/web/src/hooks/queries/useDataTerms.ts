/**
 * The house's data-and-privacy terms (ADR 0207 rounds 4 and 5) — read once
 * per house and shared by every caller: the sign-in gate every owner meets
 * (`DataTermsSignInGate`), and Settings' own "Turn on" flow
 * (`MailReadingSection`), so accepting from either place invalidates the
 * other's view of the world without a second network round trip.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import {
  getDataTerms,
  type DataTermsReadout,
} from '../../services/api/dataTerms';

export function dataTermsQueryKey(restaurantId: string | null | undefined) {
  return ['data-terms', restaurantId ?? ''] as const;
}

/**
 * `staleTime` is generous (5 min): this is read at the top of every
 * authenticated page load, and its answer changes only on an owner's own
 * accept/switch act — which invalidates this key itself (see
 * `useInvalidateDataTerms`).
 */
export function useDataTerms(enabled: boolean) {
  const { activeRestaurantId } = useAuth();
  return useQuery<DataTermsReadout>({
    queryKey: dataTermsQueryKey(activeRestaurantId),
    queryFn: getDataTerms,
    enabled: enabled && Boolean(activeRestaurantId),
    staleTime: 5 * 60 * 1000,
    // A failed read must never read as "not accepted" (the gateway's own
    // rule, `HouseDataTermsService.read`'s `readable: false`) — and here it
    // must ALSO never spin forever demanding the gate try again. One retry
    // covers a dropped request; a second failure is reported honestly rather
    // than retried into a stuck loading state that blocks nothing but looks
    // like it might.
    retry: 1,
  });
}

export function useInvalidateDataTerms() {
  const qc = useQueryClient();
  const { activeRestaurantId } = useAuth();
  return () => qc.invalidateQueries({ queryKey: dataTermsQueryKey(activeRestaurantId) });
}
