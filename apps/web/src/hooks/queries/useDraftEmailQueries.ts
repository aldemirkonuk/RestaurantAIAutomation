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
    }: {
      orderId: string
      modifiedContent?: string
      managerNotes?: string
    }) =>
      apiClient
        .post(`/procurement/orders/${orderId}/approve-draft`, { modifiedContent, managerNotes })
        .then((r) => r.data),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: draftKeys.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
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
