import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDistributorFacets, useDistributorSearch } from '../../hooks/queries/useDistributorQueries'
import type { DistributorSearchParams, DistributorType } from '../../services/api/distributors'

/** Radius slider stops, in km. The top stop means "no distance limit". */
export const RADIUS_STOPS = [10, 25, 50, 100, 250, 500, 1000, 0] as const
export const RADIUS_MAX_INDEX = RADIUS_STOPS.length - 1

export interface Bbox {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

/**
 * Headless state for the distributor discovery page.
 *
 * Filters live in local state rather than the URL, matching the convention in
 * useInventoryPage.ts — the app reserves search params for deep links.
 */
export function useDistributorsPage() {
  const [rawQuery, setRawQuery] = useState('')
  const [query, setQuery] = useState('')
  const [territoryOnly, setTerritoryOnly] = useState(true)
  const [radiusIndex, setRadiusIndex] = useState(RADIUS_MAX_INDEX)
  const [types, setTypes] = useState<DistributorType[]>([])
  const [facets, setFacets] = useState<string[]>([])
  const [sort, setSort] = useState<'distance' | 'name'>('distance')
  const [bbox, setBbox] = useState<Bbox | null>(null)

  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Debounce typing so each keystroke does not hit the API.
  useEffect(() => {
    const t = setTimeout(() => setQuery(rawQuery.trim()), 250)
    return () => clearTimeout(t)
  }, [rawQuery])

  const radiusM = RADIUS_STOPS[radiusIndex] === 0 ? undefined : RADIUS_STOPS[radiusIndex] * 1000

  const params = useMemo<DistributorSearchParams>(
    () => ({
      q: query || undefined,
      territoryOnly,
      radiusM,
      type: types.length ? types : undefined,
      facet: facets.length ? facets : undefined,
      sort,
      limit: 100,
      ...(bbox ?? {}),
    }),
    [query, territoryOnly, radiusM, types, facets, sort, bbox],
  )

  const search = useDistributorSearch(params)
  const facetQuery = useDistributorFacets({ territoryOnly, type: types.length ? types : undefined })

  const distributors = search.data?.data ?? []
  const origin = search.data?.origin ?? null

  const toggleType = useCallback((t: DistributorType) => {
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
  }, [])

  const toggleFacet = useCallback((kind: string, slug: string) => {
    const token = `${kind}:${slug}`
    setFacets((prev) => (prev.includes(token) ? prev.filter((x) => x !== token) : [...prev, token]))
  }, [])

  const clearFilters = useCallback(() => {
    setRawQuery('')
    setQuery('')
    setTypes([])
    setFacets([])
    setRadiusIndex(RADIUS_MAX_INDEX)
    setBbox(null)
    setTerritoryOnly(true)
  }, [])

  const filterCount =
    types.length + facets.length + (query ? 1 : 0) + (radiusM ? 1 : 0) + (bbox ? 1 : 0)

  // How many results the territory gate is currently hiding — surfaced so the
  // gate is visible rather than a silent filter.
  const [ungatedTotal, setUngatedTotal] = useState<number | null>(null)
  const ungated = useDistributorSearch(
    { ...params, territoryOnly: false, limit: 1 },
    territoryOnly,
  )
  useEffect(() => {
    if (territoryOnly && ungated.data) setUngatedTotal(ungated.data.total)
    if (!territoryOnly) setUngatedTotal(null)
  }, [territoryOnly, ungated.data])

  const hiddenByTerritory =
    territoryOnly && ungatedTotal != null ? Math.max(ungatedTotal - (search.data?.total ?? 0), 0) : 0

  return {
    // query state
    rawQuery,
    setRawQuery,
    territoryOnly,
    setTerritoryOnly,
    radiusIndex,
    setRadiusIndex,
    radiusM,
    types,
    toggleType,
    facets,
    toggleFacet,
    sort,
    setSort,
    bbox,
    setBbox,
    clearFilters,
    filterCount,

    // data
    distributors,
    origin,
    total: search.data?.total ?? 0,
    isLoading: search.isLoading,
    isFetching: search.isFetching,
    error: search.error,
    facetGroups: facetQuery.data ?? {},
    hiddenByTerritory,

    // interaction
    hoveredId,
    setHoveredId,
    selectedId,
    setSelectedId,
  }
}

export type DistributorsPageState = ReturnType<typeof useDistributorsPage>
