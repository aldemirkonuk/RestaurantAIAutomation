import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDistributorFacets, useDistributorSearch } from '../../hooks/queries/useDistributorQueries'
import type {
  DistributorSearchParams,
  DistributorType,
  ListingTier,
} from '../../services/api/distributors'

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
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const [facets, setFacets] = useState<string[]>([])
  const [sort, setSort] = useState<'distance' | 'name'>('distance')
  const [bbox, setBbox] = useState<Bbox | null>(null)
  const [states, setStates] = useState<string[]>([])

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
      tier: verifiedOnly ? (['curated'] as const satisfies readonly ListingTier[]).slice() : undefined,
      facet: facets.length ? facets : undefined,
      sort,
      limit: 100,
      ...(bbox ?? {}),
    }),
    [query, territoryOnly, radiusM, types, verifiedOnly, facets, sort, bbox],
  )

  const search = useDistributorSearch(params)
  const facetQuery = useDistributorFacets({ territoryOnly, type: types.length ? types : undefined })

  const allDistributors = useMemo(() => search.data?.data ?? [], [search.data])
  const origin = search.data?.origin ?? null

  /**
   * State filtering is client-side, unlike every other filter here.
   *
   * The search endpoint has no state parameter — its geography is expressed as
   * a radius or a bbox — and adding one would mean a DTO, a query branch and a
   * migration for an index. The result set is already capped at 100 rows and
   * fully in memory, so filtering here is exact, instant, and adds no round
   * trip. If the cap ever rises this must move server-side, because filtering
   * a truncated page would silently hide matches beyond row 100.
   */
  const stateOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of allDistributors) {
      if (!d.state) continue
      counts.set(d.state, (counts.get(d.state) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([value, vendors]) => ({ value, vendors }))
      .sort((a, b) => b.vendors - a.vendors || a.value.localeCompare(b.value))
  }, [allDistributors])

  const distributors = useMemo(
    () => (states.length ? allDistributors.filter((d) => d.state && states.includes(d.state)) : allDistributors),
    [allDistributors, states],
  )

  const toggleState = useCallback((value: string) => {
    setStates((prev) => (prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value]))
  }, [])

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
    setStates([])
    setRadiusIndex(RADIUS_MAX_INDEX)
    setBbox(null)
    setTerritoryOnly(true)
    setVerifiedOnly(false)
  }, [])

  const filterCount =
    types.length +
    facets.length +
    states.length +
    (query ? 1 : 0) +
    (radiusM ? 1 : 0) +
    (bbox ? 1 : 0) +
    (verifiedOnly ? 1 : 0)

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
    verifiedOnly,
    setVerifiedOnly,
    facets,
    toggleFacet,
    states,
    toggleState,
    stateOptions,
    sort,
    setSort,
    bbox,
    setBbox,
    clearFilters,
    filterCount,

    // data
    distributors,
    origin,
    // With a state filter on, the API's total counts rows the user is no
    // longer being shown. Reporting the filtered length keeps the header
    // honest about what is on screen.
    total: states.length ? distributors.length : (search.data?.total ?? 0),
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
