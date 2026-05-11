import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getOnboardingProgress, updateOnboardingProgress } from '../../services/api/menus'

export function useOnboardingProgress() {
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['onboarding-progress'],
    queryFn: getOnboardingProgress,
    staleTime: 30_000,
    retry: 1,
  })

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
