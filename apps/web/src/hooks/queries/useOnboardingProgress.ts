import { useContext } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AuthContext } from '../../contexts/AuthContext'
import { getOnboardingProgress, updateOnboardingProgress, type OnboardingProgress } from '../../services/api/menus'

/**
 * Who the house's setup read is for (r41 onboarding gap 5). The read is
 * eight reads on the gateway, one of which fans out into seven more, and the
 * shell, its setup banner and its page tip all ask it on every boot. Staff
 * never see setup: the rail gives them Learn & Help without it
 * (`learnDoorFor`), the banner is for an owner or a manager
 * (`useSetupNudgeShowing`), and LearnPanel shows them no setup or next steps.
 * So a person who is staff in this house is never asked for it. A role not
 * known yet reads as before.
 */
export function readsSetup(role: unknown): boolean {
  return role !== 'staff'
}

/**
 * A setup with nothing left to change on its own (r41 onboarding gap 5):
 * finished or put away, on a house whose menu is current. The rail then
 * shows Learn & Help, and the banner, which waits on `activated`, stays
 * away. Such a read is not asked again on every return to the window. The
 * person's own change still refreshes it (the update below invalidates).
 */
export function setupSettled(progress: OnboardingProgress | null | undefined): boolean {
  return !!progress && (!!progress.completed_at || !!progress.checklist_dismissed) && progress.activated === true
}

export function useOnboardingProgress() {
  const qc = useQueryClient()
  const auth = useContext(AuthContext)
  const role = auth?.activeRole ?? auth?.user?.role ?? null

  const query = useQuery({
    queryKey: ['onboarding-progress'],
    queryFn: getOnboardingProgress,
    enabled: readsSetup(role),
    staleTime: (read) => (setupSettled(read.state.data) ? Infinity : 30_000),
    // The app's default is 'always'; this read is fresh for its staleTime.
    refetchOnMount: true,
    retry: 1,
  })

  const mutation = useMutation({
    mutationFn: updateOnboardingProgress,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding-progress'] }),
  })

  return {
    progress: query.data ?? null,
    isLoading: query.isLoading,
    /** The read failed (a 404 is not a failure: it answers null). */
    isError: query.isError,
    update: mutation.mutate,
    isUpdating: mutation.isPending,
  }
}
