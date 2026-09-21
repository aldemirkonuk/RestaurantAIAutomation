/**
 * The three reads behind the scorecard — ADR 0207.
 *
 *   useRollCall      GET /vendor-scorecard?window=        every vendor (the Roll
 *                                                          Call, and each card's
 *                                                          one fact)
 *   useVendorCard    GET /vendor-scorecard/:id?window=    the ledger card
 *   useDocket        GET /vendor-scorecard/:id/docket     the rows behind a figure
 *
 * TENANT KEY. Every key carries `activeRestaurantId`, so a house switch can
 * never leave the previous house's figures on screen for a frame. The gateway
 * takes the house from the token and accepts no id from us — the key is a cache
 * boundary, not an authorisation claim.
 *
 * A FAILED READ is returned as an error with the gateway's own words; nothing
 * here turns it into an empty card.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../../services/api/client';
import { useAuth } from '../../../../contexts/AuthContext';
import type { Docket, MeasureKey, RollCall, VendorScorecard, WindowDays } from './scorecard-types';

export function serverMessage(e: unknown, fallback: string): string {
  const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
  if (typeof msg === 'string' && msg.trim()) return msg;
  if (e instanceof Error && e.message) return `${fallback} (${e.message})`;
  return fallback;
}

export function useRollCall(window: WindowDays, enabled = true) {
  const { activeRestaurantId } = useAuth();
  return useQuery({
    queryKey: ['vendor-scorecard', 'roll-call', activeRestaurantId ?? '', window],
    enabled: enabled && Boolean(activeRestaurantId),
    queryFn: async () => {
      const { data } = await apiClient.get<RollCall>('/vendor-scorecard', {
        params: { window },
      });
      return data;
    },
  });
}

export function useVendorCard(providerId: string | null, window: WindowDays) {
  const { activeRestaurantId } = useAuth();
  return useQuery({
    queryKey: ['vendor-scorecard', 'card', activeRestaurantId ?? '', providerId, window],
    enabled: Boolean(providerId) && Boolean(activeRestaurantId),
    queryFn: async () => {
      const { data } = await apiClient.get<VendorScorecard>(
        `/vendor-scorecard/${encodeURIComponent(providerId as string)}`,
        { params: { window } },
      );
      return data;
    },
  });
}

export function useDocket(providerId: string | null, window: WindowDays, measure: MeasureKey | null) {
  const { activeRestaurantId } = useAuth();
  return useQuery({
    queryKey: ['vendor-scorecard', 'docket', activeRestaurantId ?? '', providerId, window],
    enabled: Boolean(providerId) && Boolean(activeRestaurantId),
    // One read per vendor and window; the measure filter is applied to its
    // rows here, so pressing a tally never asks the gateway again and the
    // tallies above the list always come from the same answer as the list.
    queryFn: async () => {
      const { data } = await apiClient.get<Docket>(
        `/vendor-scorecard/${encodeURIComponent(providerId as string)}/docket`,
        { params: { window } },
      );
      return data;
    },
    select: (d: Docket): Docket => ({
      ...d,
      measure,
      entries: measure ? d.entries.filter((e) => e.measure === measure) : d.entries,
    }),
  });
}
