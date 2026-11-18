import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SPOT_COUNT_SENT_EVENT } from '../../lib/spotCountOutbox'
import { getOnboardingProgress, updateOnboardingProgress } from '../../services/api/menus'

export function useOnboardingProgress() {
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['onboarding-progress'],
    queryFn: getOnboardingProgress,
    staleTime: 30_000,
    retry: 1,
  })

  // A count held on the device and sent later is the house's count from then
  // on; the setup would otherwise go on saying nothing was counted until the
  // window is next focused.
  useEffect(() => {
    const onSent = () => void qc.invalidateQueries({ queryKey: ['onboarding-progress'] })
    window.addEventListener(SPOT_COUNT_SENT_EVENT, onSent)
    return () => window.removeEventListener(SPOT_COUNT_SENT_EVENT, onSent)
  }, [qc])

  const mutation = useMutation({
    mutationFn: updateOnboardingProgress,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding-progress'] }),
  })

  return {
    progress: query.data ?? null,
    isLoading: query.isLoading,
    update: mutation.mutate,
    isUpdating: mutation.isPending,
  }
}
