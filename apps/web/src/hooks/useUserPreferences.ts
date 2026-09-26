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
import type { AskMode } from '../components/askai/ask-mode'

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
  /**
   * The Mudavym ground this person reads the house on — ADR 0169, and the
   * founder's 2026-09-21 answer, "Always paper, follows account". Absent
   * means they have never chosen, which is paper.
   *
   * Stored here, in the account's JSONB blob, rather than in a device-wide
   * `localStorage` key, precisely so it follows the person to another
   * browser and to another device — the same rationale `mapDefaultScope`
   * above states. `lib/mudavym/GroundChoiceSync.tsx` is the only reader and
   * writer; do not set it from anywhere else, or the device mirror it keeps
   * can go out of step with the account.
   */
  ground?: 'paper' | 'charcoal'
  /**
   * The Ask panel's LAST USED mode — founder, 2026-09-26 round 7 (ADR 0145,
   * "the Ask panel opens in the person's last used mode; a person's first
   * open is 'Ask the books'"). Absent means either they have never chosen a
   * mode, or every open so far has run in `'ask'` (the default), which is
   * never written back — see `AskPanel.tsx`'s hydrate/persist effects.
   *
   * Stored here, in the account's JSONB blob, for the same reason `ground`
   * and `mapDefaultScope` above are: it should follow the person to another
   * browser and device, which is what "last used" implies, not just this
   * device (`localStorage` was the fallback CLAUDE.md's task allowed only in
   * the absence of a server-side store; this one already exists).
   */
  askLastMode?: AskMode
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

  /**
   * Same write, but the caller learns whether it landed. `updatePreferences`
   * above is fire-and-forget, which is fine for a favourite or a layout — a
   * caller that must not report an unsaved change as saved (ADR 0169's ground
   * choice) needs the rejection. Added for that; `mutateAsync` is stable
   * across renders, so it is safe in an effect's dependency list.
   */
  const updatePreferencesAsync = mutation.mutateAsync

  return {
    preferences,
    isLoading: query.isLoading,
    /**
     * True while `preferences` is still the `{}` placeholder rather than an
     * answer from the account — including while the query is disabled for a
     * signed-out visitor. `isLoading` alone cannot be used for this:
     * `placeholderData` above puts the query into `success` immediately, so
     * `isLoading` is false before the gateway has said anything.
     */
    isPlaceholderData: query.isPlaceholderData,
    error: query.error,
    updatePreferences,
    updatePreferencesAsync,
    isUpdating: mutation.isPending,
  }
}
