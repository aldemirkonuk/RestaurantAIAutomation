import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Search, X, SlidersHorizontal, Loader2, Compass, EyeOff, BadgeCheck } from 'lucide-react'
import { useDistributorsPage, RADIUS_STOPS, RADIUS_MAX_INDEX } from '../useDistributorsPage'
import { DistributorMap } from './DistributorMap'
import { DistributorDrawer } from './DistributorDrawer'
import { DistributorCard, FacetChip, TYPE_LABEL } from './bits'
import { RangeSlider } from '../../../components/ui/RangeSlider'
import { ThemedSelect } from '../../../components/ui/ThemedSelect'
import type { DistributorType } from '../../../services/api/distributors'
import { cn } from '../../../lib/utils'
import type { Provider } from '../../../services/api/providers'
import { customProvidersAsDistributors } from './customProvider'
import { useUserPreferences } from '../../../hooks/useUserPreferences'
import type { BoundsLiteral, MapScope } from './mapCamera'

const TYPES: DistributorType[] = [
  'distributor',
  'importer',
  'wholesaler',
  'winery_direct',
  'broker',
]

export function DistributorMapPage({ customProviders = [] }: { customProviders?: Provider[] }) {
  const s = useDistributorsPage()
  // Adapt once per render rather than twice inline; ungeocoded providers are
  // dropped by the adapter because they cannot be placed on a map.
  const customDistributors = useMemo(
    () => customProvidersAsDistributors(customProviders),
    [customProviders],
  )
  const searchRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const { preferences } = useUserPreferences()
  const scope = (preferences?.mapDefaultScope ?? 'continent') as MapScope

  // The state filter applies to the restaurant's own providers as well. A
  // filter that silently exempts some rows is not a filter.
  const visibleCustom = useMemo(
    () =>
      s.states.length
        ? customDistributors.filter((d) => d.state && s.states.includes(d.state))
        : customDistributors,
    [customDistributors, s.states],
  )

  const mapDistributors = useMemo(
    () => [...visibleCustom, ...s.distributors],
    [visibleCustom, s.distributors],
  )

  // Chips come from both sources, so a state where the user's only vendor is
  // their own still gets offered.
  const stateOptions = useMemo(() => {
    const counts = new Map(s.stateOptions.map((o) => [o.value, o.vendors]))
    for (const d of customDistributors) {
      if (d.state) counts.set(d.state, (counts.get(d.state) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([value, vendors]) => ({ value, vendors }))
      .sort((a, b) => b.vendors - a.vendors || a.value.localeCompare(b.value))
  }, [s.stateOptions, customDistributors])

  /**
   * The box the state chips fly the map to.
   *
   * Derived from the vendors actually in the chosen states rather than from a
   * geocoded state outline: it needs no extra API call, and framing the
   * vendors is what the user is filtering for. Null when no state is picked,
   * which leaves the camera where the user put it.
   */
  const focusBounds = useMemo<BoundsLiteral | null>(() => {
    if (!s.states.length) return null
    const pts = mapDistributors.filter((d) => d.latitude != null && d.longitude != null)
    if (!pts.length) return null
    const lats = pts.map((d) => Number(d.latitude))
    const lngs = pts.map((d) => Number(d.longitude))
    return {
      north: Math.max(...lats),
      south: Math.min(...lats),
      east: Math.max(...lngs),
      west: Math.min(...lngs),
    }
  }, [s.states, mapDistributors])

  // "/" focuses search, Escape clears selection — mirrors the inventory page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing =
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (e.key === '/' && !typing) {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'Escape' && !typing) s.setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s])

  // Selecting a marker scrolls its card into view — the other half of the
  // marker/card link that makes the two panes feel like one surface.
  useEffect(() => {
    if (!s.selectedId) return
    const node = listRef.current?.querySelector(`[data-distributor-id="${s.selectedId}"]`)
    node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [s.selectedId])

  const handleSearchArea = useCallback(
    (b: { minLng: number; minLat: number; maxLng: number; maxLat: number }) => s.setBbox(b),
    [s],
  )

  const regionFacets = s.facetGroups.region ?? []
  const varietalFacets = s.facetGroups.varietal ?? []

  return (
    <div className="mx-auto max-w-[1500px] p-6">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Find distributors</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Wine distributors that can legally supply your restaurant, nearest first.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {s.isFetching && <Loader2 className="h-4 w-4 animate-spin text-gray-300" />}
          <ThemedSelect
            value={s.sort}
            aria-label="Sort distributors"
            onChange={(v) => s.setSort(v as 'distance' | 'name')}
            options={[
              { value: 'distance', label: 'Nearest first' },
              { value: 'name', label: 'Name A–Z' },
            ]}
          />
        </div>
      </div>

      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2" data-tour="distributor-toolbar">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            ref={searchRef}
            value={s.rawQuery}
            onChange={(e) => s.setRawQuery(e.target.value)}
            placeholder="Search distributors or portfolio…   /"
            className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-8 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-wine-300 focus:ring-2 focus:ring-wine-100"
          />
          {s.rawQuery && (
            <button
              type="button"
              onClick={() => s.setRawQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:bg-gray-100"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => s.setTerritoryOnly(!s.territoryOnly)}
          aria-pressed={s.territoryOnly}
          title="Only show distributors licensed to sell to your restaurant"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition',
            s.territoryOnly
              ? 'border-wine-600 bg-wine-600 text-white'
              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
          )}
        >
          <Compass className="h-3.5 w-3.5" />
          Can supply me
        </button>

        <button
          type="button"
          onClick={() => s.setVerifiedOnly(!s.verifiedOnly)}
          aria-pressed={s.verifiedOnly}
          title="Only show distributors whose details have been checked by hand"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition',
            s.verifiedOnly
              ? 'border-blue-600 bg-blue-600 text-white'
              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
          )}
        >
          <BadgeCheck className="h-3.5 w-3.5" />
          Verified only
        </button>

        <div className="w-44">
          <RangeSlider
            label="Within"
            min={0}
            max={RADIUS_MAX_INDEX}
            value={s.radiusIndex}
            onChange={s.setRadiusIndex}
            maxLabel="Any distance"
            format={(i) => `${RADIUS_STOPS[i]} km`}
          />
        </div>

        {s.filterCount > 0 && (
          <button
            type="button"
            onClick={s.clearFilters}
            className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-500 transition hover:bg-gray-50"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Clear {s.filterCount}
          </button>
        )}
      </div>

      {/* Facet rail */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          Type
        </span>
        {TYPES.map((t) => (
          <FacetChip
            key={t}
            label={TYPE_LABEL[t]}
            active={s.types.includes(t)}
            onClick={() => s.toggleType(t)}
          />
        ))}

        {/* State. Sourced from the results themselves rather than a facet
            endpoint, so it only ever offers states that have vendors in the
            current search — a chip that returns nothing is worse than no chip. */}
        {stateOptions.length > 1 && (
          <>
            <span className="ml-3 mr-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              State
            </span>
            {stateOptions.slice(0, 10).map((opt) => (
              <FacetChip
                key={opt.value}
                label={opt.value}
                count={opt.vendors}
                active={s.states.includes(opt.value)}
                onClick={() => s.toggleState(opt.value)}
              />
            ))}
          </>
        )}

        {regionFacets.length > 0 && (
          <>
            <span className="ml-3 mr-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Region
            </span>
            {regionFacets.slice(0, 8).map((f) => (
              <FacetChip
                key={f.slug}
                label={f.value}
                count={f.vendors}
                active={s.facets.includes(`region:${f.slug}`)}
                onClick={() => s.toggleFacet('region', f.slug)}
              />
            ))}
          </>
        )}

        {varietalFacets.length > 0 && (
          <>
            <span className="ml-3 mr-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Varietal
            </span>
            {varietalFacets.slice(0, 8).map((f) => (
              <FacetChip
                key={f.slug}
                label={f.value}
                count={f.vendors}
                active={s.facets.includes(`varietal:${f.slug}`)}
                onClick={() => s.toggleFacet('varietal', f.slug)}
              />
            ))}
          </>
        )}
      </div>

      {/* Results + map */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(360px,420px)_1fr]">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs font-semibold text-gray-500">
              {s.isLoading ? 'Searching…' : `${s.total} distributor${s.total === 1 ? '' : 's'}`}
            </p>
            {s.hiddenByTerritory > 0 && (
              <button
                type="button"
                onClick={() => s.setTerritoryOnly(false)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-400 transition hover:text-gray-600"
                title="These cannot legally sell to your restaurant"
              >
                <EyeOff className="h-3 w-3" />
                {s.hiddenByTerritory} can&apos;t supply you
              </button>
            )}
          </div>

          <div
            ref={listRef}
            className="flex max-h-[calc(100vh-320px)] min-h-[320px] flex-col gap-2 overflow-y-auto pr-1"
          >
            {s.isLoading &&
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl border border-gray-100 bg-gray-50" />
              ))}

            {!s.isLoading && s.distributors.length === 0 && customProviders.length === 0 && (
              <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center">
                <p className="text-sm font-medium text-gray-600">No distributors match these filters</p>
                <p className="mt-1 text-xs text-gray-400">
                  Try widening the distance or turning off &ldquo;Can supply me&rdquo;.
                </p>
              </div>
            )}

            {/* The restaurant's own providers, adapted once in customProvider.ts
                so the compiler enforces field completeness in a single place. */}
            {visibleCustom.map((d) => (
              <DistributorCard
                key={d.id}
                d={d}
                active={d.id === s.hoveredId || d.id === s.selectedId}
                onHover={s.setHoveredId}
                onOpen={s.setSelectedId}
              />
            ))}

            {s.distributors.map((d) => (
              <DistributorCard
                key={d.id}
                d={d}
                active={d.id === s.hoveredId || d.id === s.selectedId}
                onHover={s.setHoveredId}
                onOpen={s.setSelectedId}
              />
            ))}
          </div>
        </div>

        <DistributorMap
          className="h-[calc(100vh-300px)] min-h-[420px] lg:sticky lg:top-4"
          distributors={mapDistributors}
          scope={scope}
          focusBounds={focusBounds}
          origin={s.origin}
          originLabel={s.origin?.label}
          hoveredId={s.hoveredId}
          selectedId={s.selectedId}
          onHover={s.setHoveredId}
          onSelect={s.setSelectedId}
          onSearchArea={handleSearchArea}
        />
      </div>

      <DistributorDrawer distributorId={s.selectedId} onClose={() => s.setSelectedId(null)} customProviders={customProviders} />
    </div>
  )
}

export default DistributorMapPage
