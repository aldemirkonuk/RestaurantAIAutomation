import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../lib/query-keys'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores'

export interface GeneratedReport {
  id: string
  restaurant_id: string
  report_type: string
  format: string
  file_url: string | null
  metadata: {
    title?: string
    description?: string
    period?: string
    sentTo?: string[]
    fileSize?: string
    tags?: string[]
    status?: 'sent' | 'draft' | 'archived'
  } | null
  created_at: string
}

async function fetchReports(restaurantId: string): Promise<GeneratedReport[]> {
  const { data, error } = await supabase
    .from('generated_reports')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

async function deleteReport(reportId: string): Promise<void> {
  const { error } = await supabase
    .from('generated_reports')
    .delete()
    .eq('id', reportId)
  if (error) throw error
}

export function useGeneratedReports() {
  const restaurantId = useAuthStore(s => s.activeRestaurantId) ?? ''

  return useQuery<GeneratedReport[]>({
    queryKey: queryKeys.reports.list(restaurantId),
    queryFn: () => fetchReports(restaurantId),
    enabled: !!restaurantId,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    placeholderData: [],
    retry: 1,
  })
}

export function useDeleteReport() {
  const restaurantId = useAuthStore(s => s.activeRestaurantId) ?? ''
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteReport,
    onMutate: async (reportId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.reports.list(restaurantId) })
      const previous = queryClient.getQueryData<GeneratedReport[]>(
        queryKeys.reports.list(restaurantId),
      )
      queryClient.setQueryData<GeneratedReport[]>(
        queryKeys.reports.list(restaurantId),
        (old) => (old ?? []).filter((r) => r.id !== reportId),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.reports.list(restaurantId),
          context.previous,
        )
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.list(restaurantId) })
    },
  })
}
