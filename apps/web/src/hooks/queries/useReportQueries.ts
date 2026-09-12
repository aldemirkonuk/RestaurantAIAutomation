import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../lib/query-keys'
import {
  listReports,
  deleteReport,
  type GeneratedReport,
} from '../../services/api/reports'
import { useAuthStore } from '../../stores'

/**
 * Generated-reports queries (OD-45).
 *
 * These hooks used to query `generated_reports` straight from the browser with the
 * anon-key Supabase client, bypassing the gateway that owns the table. That was two
 * bugs in one:
 *
 *   1. A layer inversion — the gateway already implemented list/get/generate against
 *      this table, and the page went around it.
 *   2. A live silent failure — the table has RLS enabled and zero policies
 *      (verified against production: `relrowsecurity = true`, `pg_policy` count 0).
 *      RLS-on-with-no-policy denies every row to a non-bypassing role and returns an
 *      empty set with NO error, so the Documents page rendered "no reports" instead
 *      of surfacing a permission problem. `retry: 1` and `placeholderData: []` made
 *      it look even more like a legitimately empty state.
 *
 * Routing through the gateway fixes both: the service-role client there is not
 * subject to RLS, the restaurant is taken from the JWT rather than trusted from the
 * client, and a real failure now arrives as an HTTP error the query can surface.
 */

export type { GeneratedReport }

export function useGeneratedReports() {
  const restaurantId = useAuthStore((s) => s.activeRestaurantId) ?? ''

  return useQuery<GeneratedReport[]>({
    // The gateway derives the restaurant from the access token; the id stays in the
    // query key only so switching restaurants keeps separate cache entries.
    queryKey: queryKeys.reports.list(restaurantId),
    queryFn: listReports,
    enabled: !!restaurantId,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
  })
}

export function useDeleteReport() {
  const restaurantId = useAuthStore((s) => s.activeRestaurantId) ?? ''
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
