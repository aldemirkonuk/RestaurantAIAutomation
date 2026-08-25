import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { queryKeys } from '../../lib/query-keys'
import {
  getDistributor,
  getDistributorFacets,
  searchDistributors,
  type DistributorSearchParams,
  type DistributorType,
} from '../../services/api/distributors'
import { useAuth } from '../../contexts/AuthContext'
import { getActiveRestaurantId } from '../../services/api/client'

/**
 * Territory-gated distributor search.
 *
 * `keepPreviousData` matters more here than on a normal list: the map and the
 * result list are the same dataset, so dropping to undefined between fetches
 * would blank every marker on each pan or filter change.
 */
export function useDistributorSearch(params: DistributorSearchParams, enabled = true) {
  const { isAuthenticated } = useAuth()
  const restaurantId = getActiveRestaurantId() ?? ''

  return useQuery({
    queryKey: queryKeys.distributors.search(restaurantId, params as Record<string, unknown>),
    queryFn: () => searchDistributors(params),
    enabled: enabled && isAuthenticated && !!restaurantId,
    staleTime: 2 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  })
}

/** Facet chip counts, computed server-side against the same gate as the search. */
export function useDistributorFacets(params: {
  territoryOnly?: boolean
  type?: DistributorType[]
}) {
  const { isAuthenticated } = useAuth()
  const restaurantId = getActiveRestaurantId() ?? ''

  return useQuery({
    queryKey: queryKeys.distributors.facets(restaurantId, params as Record<string, unknown>),
    queryFn: () => getDistributorFacets(params),
    enabled: isAuthenticated && !!restaurantId,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  })
}

/** Detail for the slide-over drawer; only fetched once a distributor is opened. */
export function useDistributorDetail(id: string | null) {
  const { isAuthenticated } = useAuth()

  return useQuery({
    queryKey: queryKeys.distributors.detail(id ?? ''),
    queryFn: () => getDistributor(id as string),
    enabled: isAuthenticated && !!id,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
}
