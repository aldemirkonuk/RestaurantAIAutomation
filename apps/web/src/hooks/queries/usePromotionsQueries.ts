import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../services/api/client'

export interface PromotionDto {
  id: string
  provider_id: string
  name: string
  promo_type: string
  description: string | null
  conditions: Record<string, any> | null
  discount_value: Record<string, any> | null
  applicable_wines: string[] | null
  end_date: string | null
  confidence: number | null
  providers?: { id: string; name: string } | null
}

/** Active promotions across all providers (fed by the D3 lane). */
export function useActivePromotions() {
  return useQuery({
    queryKey: ['promotions', 'active'],
    queryFn: () => apiClient.get('/providers/promotions/active').then((r) => r.data as PromotionDto[]),
    staleTime: 30_000,
  })
}

export interface SenderReputationDto {
  id: string
  domain: string
  provider_id: string | null
  trusted: boolean
  suspended: boolean
  suspended_reason: string | null
  injection_signals: number
  spam_signals: number
  completed_orders: number
  score: number
  updated_at: string
}

/** D5 — the sender-reputation / trust store for this restaurant. */
export function useSenderReputation() {
  return useQuery({
    queryKey: ['sender-reputation'],
    queryFn: () => apiClient.get('/senders/reputation').then((r) => r.data as SenderReputationDto[]),
    staleTime: 30_000,
  })
}

/** Trust / untrust a sender domain (D5). */
export function useSetSenderTrust() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { domain: string; trusted: boolean; providerId?: string }) =>
      apiClient.post('/senders/trust', body).then((r) => r.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['sender-reputation'] }),
  })
}
