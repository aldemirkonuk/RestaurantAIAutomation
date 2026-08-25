import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { DistributorMap } from './DistributorMap'
import { DistributorCard } from './bits'
import type { Distributor } from '../../../services/api/distributors'

/**
 * Fixture is real data: the geocoded vendor_catalogue rows as returned by
 * search_distributors for a Manhattan restaurant. Distances are the values the
 * RPC actually produced, so the story exercises genuine geography rather than
 * invented points.
 */
const MANHATTAN = { lat: 40.7544, lng: -73.984 }

const raw: Array<[string, Distributor['type'], string, string, number, number, number, string]> = [
  ['Kobrand Corporation', 'importer', 'New York', 'NY', 40.75449116, -73.98902938, 425, 'nationwide'],
  ['Skurnik Wines & Spirits', 'importer', 'New York', 'NY', 40.74231367, -73.98375789, 1342, 'NY'],
  ['Dreyfus, Ashby & Co.', 'importer', 'New York', 'NY', 40.78609754, -73.95066918, 4507, 'NY'],
  ['Palm Bay International', 'importer', 'Carlstadt', 'NJ', 40.82595162, -74.0665068, 10565, 'nationwide'],
  ['Empire Merchants', 'wholesaler', 'Brooklyn', 'NY', 40.60319519, -73.99604329, 16822, 'NY'],
  ['Polaner Selections', 'importer', 'Montclair', 'NJ', 40.81422394, -74.21970107, 20975, 'NY'],
  ['Banfi Vintners', 'importer', 'Glen Head', 'NY', 40.8307461, -73.5957626, 33846, 'nationwide'],
  ['Winebow', 'importer', 'Dayton', 'NJ', 40.38333595, -74.50259778, 60220, 'NY'],
]

const distributors: Distributor[] = raw.map(([name, type, city, state, lat, lng, dist, via], i) => ({
  id: `v${i + 1}`,
  name,
  type,
  city,
  state,
  country: 'US',
  website: null,
  wine_specialties: null,
  latitude: lat,
  longitude: lng,
  distance_m: dist,
  // Only Empire has a warehouse on file in this fixture, to show both labels.
  distance_is_hq: name !== 'Empire Merchants',
  nearest_location_kind: name === 'Empire Merchants' ? 'warehouse' : null,
  may_serve: true,
  serves_via: via,
  listing_tier: 'curated',
  data_confidence: 1,
  verified_at: null,
}))

const meta: Meta<typeof DistributorMap> = {
  title: 'Distributors/DistributorMap',
  component: DistributorMap,
  parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj<typeof DistributorMap>

/**
 * Hover/selection state lives in a named component rather than inline in the
 * story's `render`. Hooks may only be called from a capitalized component or a
 * `use*` hook — a lowercase `render` function is neither, so calling useState
 * there trips react-hooks/rules-of-hooks and fails lint.
 */
function WithResultsHarness() {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  return (
    <div className="grid h-screen grid-cols-[380px_1fr] gap-4 bg-white p-4">
      <div className="flex flex-col gap-2 overflow-y-auto">
        {distributors.map((d) => (
          <DistributorCard
            key={d.id}
            d={d}
            active={d.id === hoveredId || d.id === selectedId}
            onHover={setHoveredId}
            onOpen={setSelectedId}
          />
        ))}
      </div>
      <DistributorMap
        className="h-full"
        distributors={distributors}
        origin={MANHATTAN}
        originLabel="Manhattan Trattoria"
        hoveredId={hoveredId}
        selectedId={selectedId}
        onHover={setHoveredId}
        onSelect={setSelectedId}
        onSearchArea={() => {}}
      />
    </div>
  )
}

/** The map alongside the result list, with live hover/selection linkage. */
export const WithResults: Story = {
  render: () => <WithResultsHarness />,
}

/** Out-of-territory vendors render dimmed rather than being silently dropped. */
export const MixedTerritory: Story = {
  render: () => (
    <div className="h-screen bg-white p-4">
      <DistributorMap
        className="h-full"
        distributors={distributors.map((d, i) => (i % 3 === 0 ? { ...d, may_serve: false } : d))}
        origin={MANHATTAN}
        hoveredId={null}
        selectedId={null}
        onHover={() => {}}
        onSelect={() => {}}
        onSearchArea={() => {}}
      />
    </div>
  ),
}
