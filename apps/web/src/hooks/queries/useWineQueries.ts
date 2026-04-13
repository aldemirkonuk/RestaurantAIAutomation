import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../lib/query-keys'
import {
  searchWines,
  getWineById,
  getWineSuggestions,
  getWinesByIds,
  type Wine
} from '../../services/api/wines'

export function useWines(filters?: {
  search?: string
  type?: string
  region?: string
  country?: string
  minPrice?: number
  maxPrice?: number
  limit?: number
  offset?: number
}) {
  return useQuery({
    queryKey: queryKeys.wines.list(filters),
    queryFn: () => searchWines(filters),
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
  })
}

export function useWine(wineId?: string) {
  return useQuery({
    queryKey: queryKeys.wines.detail(wineId || ''),
    queryFn: () => getWineById(wineId || ''),
    enabled: !!wineId,
  })
}

export function useWineSuggestions(text: string, limit = 10) {
  return useQuery({
    queryKey: queryKeys.wines.search(text),
    queryFn: () => getWineSuggestions(text, limit),
    enabled: text.length >= 2,
  })
}

export function useWinesByIds(wineIds: string[]) {
  return useQuery({
    queryKey: [...queryKeys.wines.all, 'ids', wineIds],
    queryFn: () => getWinesByIds(wineIds),
    enabled: wineIds.length > 0,
  })
}

export function usePrefetchWine() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (wineId: string) => getWineById(wineId),
    onSuccess: (data, wineId) => {
      if (data) {
        queryClient.setQueryData(queryKeys.wines.detail(wineId), data as Wine)
      }
    },
  })
}
