import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../services/api/client'
import { queryKeys } from '../../lib/query-keys'
import { useAuth } from '../../contexts/AuthContext'

export const draftKeys = {
  all: ['drafts'] as const,
  pending: (restaurantId: string) => [...draftKeys.all, 'pending', restaurantId] as const,
  byOrder: (orderId: string) => [...draftKeys.all, 'order', orderId] as const,
}

export const activeConversationKeys = {
  all: ['conversations', 'active'] as const,
  list: (restaurantId: string) => [...activeConversationKeys.all, restaurantId] as const,
}

export interface ActiveConversationDto {
  id: string
  orderId: string
  providerId: string
  emailType: string
  roundCount: number
  createdAt: string
  constraintFlags: any
  draftContent: string | null
  orderNumber: string | null
  quantity: number | null
  quotedPrice: number | null
  wineName: string | null
  providerName: string | null
  providerEmail: string | null
}

export function useActiveConversations() {
  const { user, activeRestaurantId, isAuthenticated } = useAuth()
  // Prefer the runtime-updated activeRestaurantId over the JWT-origin user.restaurantId.
  // user.restaurantId becomes stale after a restaurant switch; activeRestaurantId always
  // reflects the current selection and is what the X-Restaurant-Id header sends.
  const restaurantId = activeRestaurantId ?? user?.restaurantId ?? ''
  return useQuery({
    queryKey: activeConversationKeys.list(restaurantId),
    queryFn: () =>
      apiClient
        .get('/procurement/conversations/active')
        .then((r) => r.data as ActiveConversationDto[]),
    enabled: !!restaurantId && isAuthenticated,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

export function useGetPendingDraft(orderId: string | null) {
  return useQuery({
    queryKey: draftKeys.byOrder(orderId ?? ''),
    queryFn: () =>
      apiClient
        .get(`/procurement/orders/${orderId}/draft`)
        .then((r) => r.data?.draft ?? r.data ?? null),
    enabled: !!orderId,
  })
}

export function useApproveDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      orderId,
      modifiedContent,
      managerNotes,
      ccEmails,
    }: {
      orderId: string
      modifiedContent?: string
      managerNotes?: string
      ccEmails?: string[]
    }) =>
      apiClient
        .post(`/procurement/orders/${orderId}/approve-draft`, { modifiedContent, managerNotes, ccEmails })
        .then((r) => r.data),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: draftKeys.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
      queryClient.invalidateQueries({ queryKey: activeConversationKeys.all })
      queryClient.invalidateQueries({ queryKey: orderConversationKeys.all })
    },
  })
}

/**
 * Trigger the autonomous responder on an order's latest inbound vendor reply.
 * The backend understands the reply and stages a one-tap-approve AI draft, then
 * resolves once the draft exists — so invalidating here surfaces it immediately.
 */
export function useGenerateAiReply() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (orderId: string) =>
      apiClient
        .post(`/procurement/orders/${orderId}/generate-ai-reply`)
        .then(
          (r) =>
            r.data as {
              triggered: boolean
              draftId?: string
              needsApproval?: boolean
              reason?: string
            },
        ),
    onSettled: (_data, _error, orderId) => {
      queryClient.invalidateQueries({ queryKey: draftKeys.all })
      queryClient.invalidateQueries({ queryKey: orderConversationKeys.byOrder(orderId) })
      queryClient.invalidateQueries({ queryKey: activeConversationKeys.all })
    },
  })
}

export function useDiscardDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (orderId: string) =>
      apiClient
        .post(`/procurement/orders/${orderId}/discard-draft`)
        .then((r) => r.data),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: draftKeys.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
      queryClient.invalidateQueries({ queryKey: activeConversationKeys.all })
    },
  })
}

export interface OrderConversationDto {
  id: string
  orderId: string
  status: string
  direction: 'OUTBOUND' | 'INBOUND'
  emailType: string
  roundCount: number
  createdAt: string
  sentAt: string | null
  scheduledSendAt?: string | null
  draftContent: string | null
  rollingSummary: string | null
  constraintFlags?: any
  detectedIntent?: string | null
  detectedSentiment?: string | null
  aiGenerated?: boolean | null
  specialConditions?: string[]
  orderNumber: string | null
  quantity: number | null
  quotedPrice: number | null
  orderStatus?: string | null
  aiPaused?: boolean
  wineName: string | null
  providerName: string | null
  providerEmail: string | null
  /** Latest inbound sender authentication (DKIM/DMARC); null when unknown / pre-Phase-0. */
  senderVerified?: boolean | null
}

export const orderConversationKeys = {
  all: ['conversations', 'order'] as const,
  byOrder: (orderId: string) => [...orderConversationKeys.all, orderId] as const,
}

export function useOrderConversations(orderId: string | null) {
  return useQuery({
    queryKey: orderConversationKeys.byOrder(orderId ?? ''),
    queryFn: () =>
      apiClient
        .get(`/procurement/orders/${orderId}/conversations`)
        .then((r) => r.data as OrderConversationDto[]),
    enabled: !!orderId,
    staleTime: 10_000,
    // Keep the live undo countdown / auto-send status fresh while the drawer is open.
    refetchInterval: 15_000,
  })
}

export interface OrderAttachmentDto {
  id: string
  conversationId: string
  filename: string
  mimeType: string | null
  sizeBytes: number | null
  createdAt: string
  /** short-lived signed URL to the persisted bytes (D2); null if it couldn't be signed. */
  url: string | null
}

/** Persisted vendor email attachments for an order (D2), with signed URLs. */
export function useOrderAttachments(orderId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['order-attachments', orderId ?? ''],
    queryFn: () =>
      apiClient
        .get(`/procurement/orders/${orderId}/attachments`)
        .then((r) => r.data as OrderAttachmentDto[]),
    enabled: !!orderId && enabled,
    staleTime: 30_000,
  })
}

/** Manager writes & sends their own threaded reply (bypasses the AI draft). */
export function useManualReply() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, content, ccEmails }: { orderId: string; content: string; ccEmails?: string[] }) =>
      apiClient
        .post(`/procurement/orders/${orderId}/manual-reply`, { content, ccEmails })
        .then((r) => r.data),
    onSettled: (_d, _e, variables) => {
      queryClient.invalidateQueries({ queryKey: orderConversationKeys.byOrder(variables.orderId) })
      queryClient.invalidateQueries({ queryKey: draftKeys.all })
      queryClient.invalidateQueries({ queryKey: activeConversationKeys.all })
    },
  })
}

/** Pause/resume AI autonomy for one order (grab the wheel). */
export function useToggleAiPaused() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, paused }: { orderId: string; paused: boolean }) =>
      apiClient
        .post(`/procurement/orders/${orderId}/ai-pause`, { paused })
        .then((r) => r.data as { paused: boolean }),
    onSettled: (_d, _e, variables) => {
      queryClient.invalidateQueries({ queryKey: orderConversationKeys.byOrder(variables.orderId) })
    },
  })
}

/** Undo a scheduled auto-send (revert it to a one-tap-approval draft). */
export function useCancelScheduledSend() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (orderId: string) =>
      apiClient
        .post(`/procurement/orders/${orderId}/cancel-scheduled-send`)
        .then((r) => r.data as { cancelled: boolean }),
    onSettled: (_d, _e, orderId) => {
      queryClient.invalidateQueries({ queryKey: orderConversationKeys.byOrder(orderId) })
      queryClient.invalidateQueries({ queryKey: draftKeys.all })
    },
  })
}

/** Ask the AI to rewrite the current draft (optionally with a tone/steering hint). */
export function useRegenerateDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, instruction }: { orderId: string; instruction?: string }) =>
      apiClient
        .post(`/procurement/orders/${orderId}/generate-ai-reply`, { regenerate: true, instruction })
        .then((r) => r.data as { triggered: boolean; reason?: string }),
    onSettled: (_d, _e, variables) => {
      queryClient.invalidateQueries({ queryKey: orderConversationKeys.byOrder(variables.orderId) })
      queryClient.invalidateQueries({ queryKey: draftKeys.byOrder(variables.orderId) })
    },
  })
}

/** Pull recent Gmail replies on demand (recovers any the live watch missed). */
export function useForceFetchReplies() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiClient
        .post('/communications/webhooks/gmail/force-fetch')
        .then((r) => r.data as { processed?: number; fetched?: number }),
    onSettled: (_d, _e, _v) => {
      queryClient.invalidateQueries({ queryKey: orderConversationKeys.all })
      queryClient.invalidateQueries({ queryKey: ['deal-proposal'] })
      queryClient.invalidateQueries({ queryKey: draftKeys.all })
    },
  })
}

export interface DiscountTierDto {
  threshold_qty: number | null
  unit: string | null
  discount_pct: number | null
  discount_amount: number | null
}

export interface CommercialTermsDto {
  currency: string | null
  currency_ambiguous: boolean
  unit_price: number | null
  case_price: number | null
  bottles_per_case: number | null
  min_order_qty: number | null
  min_order_unit: string | null
  discount_tiers: DiscountTierDto[]
  tax_status: 'included' | 'excluded' | 'unknown'
  tax_rate_pct: number | null
  price_valid_until: string | null
  payment_terms: string | null
  delivery_lead_time: string | null
  stock_status: 'in_stock' | 'limited' | 'allocation' | 'out_of_stock' | null
  stock_qty_available: number | null
  source_quotes?: Record<string, string> | null
}

export interface DealProposalDto {
  orderId: string
  conversationId: string
  providerName: string
  wineName: string
  quantity: number
  proposedPrice: number
  finalPrice: number
  deliveryEstimate: string
  conditions: string
  specialConditions: string[]
  commercialTerms?: CommercialTermsDto | null
  sourceQuote: string
  conversationSummary: string
  dealKind: 'offer' | 'verification'
  urgency: 'normal' | 'urgent'
  confidence: number
  timestamp: string
  trust: { score: number; eligible: boolean; completedOrders: number }
}

export const dealProposalKeys = {
  byOrder: (orderId: string) => ['deal-proposal', orderId] as const,
}

/** Latest AI-detected deal proposal for an order (null when none pending). */
export function useDealProposal(orderId: string | null, enabled = true) {
  return useQuery({
    queryKey: dealProposalKeys.byOrder(orderId ?? ''),
    queryFn: () =>
      apiClient
        .get(`/procurement/orders/${orderId}/deal-proposal`)
        .then((r) => (r.data ?? null) as DealProposalDto | null),
    enabled: !!orderId && enabled,
    staleTime: 10_000,
    refetchInterval: 20_000,
  })
}

export function useConfirmDeal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, finalPrice, quantity, sendConfirmation }: {
      orderId: string; finalPrice?: number; quantity?: number; sendConfirmation?: boolean
    }) =>
      apiClient
        .post(`/procurement/orders/${orderId}/confirm-deal`, { finalPrice, quantity, sendConfirmation })
        .then((r) => r.data as { confirmed: boolean; sentConfirmation: boolean }),
    onSettled: (_d, _e, variables) => {
      // Confirming a deal discards any pending AI draft server-side, so the draft
      // and the sidebar's active-conversation list must refetch too — otherwise the
      // just-resolved draft lingers on screen after the confirmation is sent.
      queryClient.invalidateQueries({ queryKey: dealProposalKeys.byOrder(variables.orderId) })
      queryClient.invalidateQueries({ queryKey: orderConversationKeys.byOrder(variables.orderId) })
      queryClient.invalidateQueries({ queryKey: draftKeys.byOrder(variables.orderId) })
      queryClient.invalidateQueries({ queryKey: draftKeys.all })
      queryClient.invalidateQueries({ queryKey: activeConversationKeys.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
    },
  })
}

export function useDismissDeal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (orderId: string) =>
      apiClient
        .post(`/procurement/orders/${orderId}/dismiss-deal`)
        .then((r) => r.data as { dismissed: boolean }),
    onSettled: (_d, _e, orderId) => {
      queryClient.invalidateQueries({ queryKey: dealProposalKeys.byOrder(orderId) })
      queryClient.invalidateQueries({ queryKey: orderConversationKeys.byOrder(orderId) })
      queryClient.invalidateQueries({ queryKey: draftKeys.byOrder(orderId) })
      queryClient.invalidateQueries({ queryKey: activeConversationKeys.all })
    },
  })
}

export function useEditDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, content }: { orderId: string; content: string }) =>
      apiClient
        .patch(`/procurement/orders/${orderId}/draft`, { modifiedContent: content })
        .then((r) => r.data),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: draftKeys.byOrder(variables.orderId) })
    },
  })
}
