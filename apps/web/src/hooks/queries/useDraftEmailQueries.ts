import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../services/api/client'
import { queryKeys } from '../../lib/query-keys'

export const draftKeys = {
  all: ['drafts'] as const,
  pending: (restaurantId: string) => [...draftKeys.all, 'pending', restaurantId] as const,
  byOrder: (orderId: string) => [...draftKeys.all, 'order', orderId] as const,
}

export function useGetPendingDraft(orderId: string | null) {
  return useQuery({
    queryKey: draftKeys.byOrder(orderId ?? ''),
    queryFn: () =>
      apiClient.get(`/procurement/orders/${orderId}/draft`).then((r) => r.data),
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
