/**
 * "Did it arrive?" — the asks for this house's orders past their expected date
 * and not received (ADR 0207, round 3). `GET /procurement/arrival-asks`, and
 * the one answer this surface records itself, `POST
 * /procurement/orders/:id/arrival-answers` with "not_yet".
 *
 * The gateway decides who is asked (owners and managers; a receiving area's
 * people once the areas model lands) and refuses anyone else; `forYou: false`
 * is that rule, not a failure. A failed read is returned as an error in the
 * gateway's words — never as "nothing is overdue".
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/services/api/client';
import { useActiveRestaurantId } from './useReceivingNextData';

export type ArrivalChoice =
  | { key: 'receive'; label: string; route: string }
  | { key: 'not_yet'; label: string; method: 'POST'; endpoint: string }
  | {
      key: 'cancel';
      label: string;
      sealEndpoint: string;
      method: 'DELETE';
      endpoint: string;
      /** ADR 0207 round 4 — the category the gateway requires; always never_arrived here. */
      reasonCode?: 'never_arrived';
    };

export interface ArrivalAsk {
  kind: 'did_it_arrive';
  orderId: string;
  orderNumber: string | null;
  providerId: string | null;
  providerName: string | null;
  expectedDate: string;
  daysPast: number;
  standing: 'unconfirmed' | 'confirmed_late';
  answeredAt: string | null;
  choices: ArrivalChoice[];
}

export interface ArrivalAsksReadout {
  forYou: boolean;
  sentence: string | null;
  asks: ArrivalAsk[];
}

export function useArrivalAsks(enabled: boolean) {
  const rid = useActiveRestaurantId();
  return useQuery({
    queryKey: ['receiving-next-arrival-asks', rid],
    enabled: enabled && Boolean(rid),
    queryFn: async () => {
      const { data } = await apiClient.get<ArrivalAsksReadout>('/procurement/arrival-asks');
      return data;
    },
  });
}

export function useAnswerNotYet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => {
      const { data } = await apiClient.post<ArrivalAsk>(
        `/procurement/orders/${encodeURIComponent(orderId)}/arrival-answers`,
        { answer: 'not_yet' },
      );
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['receiving-next-arrival-asks'] });
      // The vendor's on-time line reads the answer; its cached card must not lag it.
      void qc.invalidateQueries({ queryKey: ['vendor-scorecard'] });
    },
  });
}
