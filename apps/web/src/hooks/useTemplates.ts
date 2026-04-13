/**
 * useTemplates Hook
 *
 * Wraps the restaurant templates API (CRUD /restaurants/:restaurantId/templates)
 * with React Query for caching and optimistic updates.
 * Falls back gracefully if the API is unavailable.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../lib/query-keys'
import { apiClient } from '../services/api/client'
import { useAuthStore } from '../stores'
import type { SavedTemplate } from '../components/documents/GmailTemplateBuilder'

async function fetchTemplates(restaurantId: string): Promise<SavedTemplate[]> {
  const { data } = await apiClient.get<SavedTemplate[]>(
    `/restaurants/${restaurantId}/templates`,
  )
  return (data ?? []).map(normalizeTemplate)
}

async function createTemplate(
  restaurantId: string,
  template: Omit<SavedTemplate, 'id'>,
): Promise<SavedTemplate> {
  const { data } = await apiClient.post<SavedTemplate>(
    `/restaurants/${restaurantId}/templates`,
    template,
  )
  return normalizeTemplate(data)
}

async function updateTemplate(
  restaurantId: string,
  templateId: string,
  updates: Partial<SavedTemplate>,
): Promise<SavedTemplate> {
  const { data } = await apiClient.patch<SavedTemplate>(
    `/restaurants/${restaurantId}/templates/${templateId}`,
    updates,
  )
  return normalizeTemplate(data)
}

async function deleteTemplate(
  restaurantId: string,
  templateId: string,
): Promise<void> {
  await apiClient.delete(`/restaurants/${restaurantId}/templates/${templateId}`)
}

function normalizeTemplate(t: any): SavedTemplate {
  return {
    ...t,
    category: ((t.category as string) || 'custom').toLowerCase().trim(),
    created_at: new Date(t.created_at ?? t.createdAt ?? Date.now()),
    last_modified: new Date(t.last_modified ?? t.updatedAt ?? Date.now()),
    used_count: t.used_count ?? 0,
  }
}

export function useTemplates(restaurantId?: string | null) {
  const storeRestaurantId = useAuthStore(s => s.activeRestaurantId)
  const effectiveId = restaurantId ?? storeRestaurantId ?? ''
  const queryClient = useQueryClient()

  const query = useQuery<SavedTemplate[]>({
    queryKey: queryKeys.documents.templates(effectiveId),
    queryFn: async () => {
      try {
        return await fetchTemplates(effectiveId)
      } catch {
        return []
      }
    },
    enabled: !!effectiveId,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    placeholderData: [],
    retry: 1,
  })

  const createMutation = useMutation({
    mutationFn: (template: Omit<SavedTemplate, 'id'>) =>
      createTemplate(effectiveId, template),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.documents.templates(effectiveId),
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<SavedTemplate>
    }) => updateTemplate(effectiveId, id, updates),
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.documents.templates(effectiveId),
      })
      const previous = queryClient.getQueryData<SavedTemplate[]>(
        queryKeys.documents.templates(effectiveId),
      )
      queryClient.setQueryData<SavedTemplate[]>(
        queryKeys.documents.templates(effectiveId),
        (old) =>
          (old ?? []).map((t) => (t.id === id ? { ...t, ...updates } : t)),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.documents.templates(effectiveId),
          context.previous,
        )
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.documents.templates(effectiveId),
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (templateId: string) =>
      deleteTemplate(effectiveId, templateId),
    onMutate: async (templateId) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.documents.templates(effectiveId),
      })
      const previous = queryClient.getQueryData<SavedTemplate[]>(
        queryKeys.documents.templates(effectiveId),
      )
      queryClient.setQueryData<SavedTemplate[]>(
        queryKeys.documents.templates(effectiveId),
        (old) => (old ?? []).filter((t) => t.id !== templateId),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.documents.templates(effectiveId),
          context.previous,
        )
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.documents.templates(effectiveId),
      })
    },
  })

  return {
    templates: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    createTemplate: createMutation.mutateAsync,
    updateTemplate: (id: string, updates: Partial<SavedTemplate>) =>
      updateMutation.mutateAsync({ id, updates }),
    deleteTemplate: deleteMutation.mutateAsync,
    refetch: query.refetch,
  }
}
