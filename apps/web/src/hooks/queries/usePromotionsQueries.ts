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

export interface ProspectDto {
  id: string
  domain: string
  sender_email: string | null
  sender_name: string | null
  subject: string | null
  snippet: string | null
  has_attachments: boolean
  message_count: number
  status: string
  first_seen_at: string | null
  last_seen_at: string | null
}

/** D1 — cold-email prospects (unknown-sender vendor outreach) captured for review. */
export function useProspects() {
  return useQuery({
    queryKey: ['prospects'],
    queryFn: () => apiClient.get('/prospects').then((r) => r.data as ProspectDto[]),
    staleTime: 30_000,
  })
}

/** Promote a prospect to a real provider (D1). */
export function usePromoteProspect() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/prospects/${id}/promote`).then((r) => r.data as { promoted: boolean; providerId?: string }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['prospects'] })
      qc.invalidateQueries({ queryKey: ['providers'] })
    },
  })
}

/** Dismiss a prospect (D1). */
export function useDismissProspect() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/prospects/${id}/dismiss`).then((r) => r.data as { dismissed: boolean }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['prospects'] }),
  })
}
