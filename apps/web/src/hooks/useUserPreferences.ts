/**
 * useUserPreferences Hook
 *
 * Fetches and updates user preferences stored as JSONB via the
 * backend user preferences API (GET/PATCH /users/:userId/preferences).
 * Falls back gracefully if the API is unavailable.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../lib/query-keys'
import { apiClient } from '../services/api/client'
import { useAuthStore } from '../stores'

export interface UserPreferences {
  providerFavorites?: string[]
  providerNotes?: Record<string, { note: string; updatedAt: string }>
  providerRatings?: Record<string, number>
  wineFavorites?: string[]
  removedWines?: string[]
  templateFavorites?: string[]
  templateDefaults?: Record<string, { templateId: string; templateName: string }>
  reportsLayout?: unknown
  dashboardBlocks?: unknown
  /** Interactive guidance tip/tour/FAB state (see apps/web/src/guidance/types.ts) */
  guidance?: unknown
  /** Settings → Services & permissions toggles */
  servicePermissions?: Partial<
    Record<'email' | 'web' | 'privacy_analytics' | 'privacy_sharing', boolean>
  >
  /** Settings → Team → Goals */
  teamGoals?: {
    weeklyCountTarget?: number
    parComplianceTargetPct?: number
    trainingCompletionTargetPct?: number
  }
  /**
   * @deprecated Superseded by integration_oauth_connections server-side. Kept so
   * previously stored preference blobs still parse; nothing reads it.
   */
  integrationsAuth?: Partial<
    Record<'excel' | 'google_drive', { connected: boolean; account?: string }>
  >
  /** Home dashboard Quick Actions (order, hidden builtins, custom shortcuts) */
  quickActions?: {
    order: string[]
    hiddenBuiltin: string[]
    custom: Array<{
      id: string
      kind: 'custom'
      title: string
      href: string
      icon: string
      color?: string
      description?: string
    }>
  }
  /**
   * Settings → Map — how wide the Find-distributors map frames the restaurant
   * on load. Stored here rather than in localStorage so the choice follows the
   * user to another browser and to the mobile app, which is what a preference
   * surfaced in Settings implies.
   */
  mapDefaultScope?: 'continent' | 'country' | 'state' | 'city'
  /** Settings → POS — active provider selection */
  posConfig?: {
    activeProvider?: string
    updatedAt?: string
  }
  [key: string]: unknown
}

async function fetchPreferences(userId: string): Promise<UserPreferences> {
  const { data } = await apiClient.get<{ preferences: UserPreferences }>(
    `/users/${userId}/preferences`,
  )
  return data?.preferences ?? {}
}

async function patchPreferences(
  userId: string,
  partial: Partial<UserPreferences>,
): Promise<UserPreferences> {
  const { data } = await apiClient.patch<{ preferences: UserPreferences }>(
    `/users/${userId}/preferences`,
    { preferences: partial },
  )
  return data?.preferences ?? {}
}

export function useUserPreferences() {
  const userId = useAuthStore(s => s.user?.userId) ?? null
  const queryClient = useQueryClient()

  const query = useQuery<UserPreferences>({
    queryKey: queryKeys.user.preferences(userId ?? ''),
    queryFn: () => fetchPreferences(userId!),
    enabled: !!userId,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    placeholderData: {} as UserPreferences,
    retry: 1,
  })

  const mutation = useMutation<
    UserPreferences,
    Error,
    Partial<UserPreferences>,
    { previous: UserPreferences | undefined }
  >({
    mutationFn: (partial) => patchPreferences(userId!, partial),
    onMutate: async (partial) => {
      if (!userId) return { previous: undefined }

      await queryClient.cancelQueries({
        queryKey: queryKeys.user.preferences(userId),
      })

      const previous = queryClient.getQueryData<UserPreferences>(
        queryKeys.user.preferences(userId),
      )

      queryClient.setQueryData<UserPreferences>(
        queryKeys.user.preferences(userId),
        (old) => ({ ...old, ...partial }),
      )

      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous && userId) {
        queryClient.setQueryData(
          queryKeys.user.preferences(userId),
          context.previous,
        )
      }
    },
    onSettled: () => {
      if (userId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.user.preferences(userId),
        })
      }
    },
  })

  const preferences: UserPreferences = query.data ?? ({} as UserPreferences)

  const updatePreferences = (partial: Partial<UserPreferences>) => {
    if (!userId) return
    mutation.mutate(partial)
  }

  return {
    preferences,
    isLoading: query.isLoading,
    error: query.error,
    updatePreferences,
    isUpdating: mutation.isPending,
  }
}
