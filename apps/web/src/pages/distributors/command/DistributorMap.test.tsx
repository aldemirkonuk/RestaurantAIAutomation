import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DistributorMap } from './DistributorMap'
import type { Distributor } from '../../../services/api/distributors'

const isMapsConfigured = vi.hoisted(() => vi.fn())
const ensureMaps = vi.hoisted(() => vi.fn())

vi.mock('../../../lib/googleMaps', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/googleMaps')>(
    '../../../lib/googleMaps',
  )
  return { ...actual, isMapsConfigured, ensureMaps }
})

function makeDistributor(over: Partial<Distributor> = {}): Distributor {
  return {
    id: 'v1',
    name: 'Skurnik',
    type: 'importer',
    city: 'New York',
    state: 'NY',
    country: 'US',
    website: null,
    wine_specialties: null,
    latitude: 40.74,
    longitude: -73.98,
    distance_m: 1300,
    distance_is_hq: false,
    nearest_location_kind: 'warehouse',
    may_serve: true,
    serves_via: 'NY',
    verified_at: null,
    ...over,
  }
}

const baseProps = {
  origin: { lat: 40.75, lng: -73.98 },
  hoveredId: null,
  selectedId: null,
  onHover: vi.fn(),
  onSelect: vi.fn(),
  onSearchArea: vi.fn(),
}

describe('DistributorMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('degrades to an explanatory panel when no API key is configured', () => {
    // The key is absent in plenty of dev setups. The list beside the map is
    // fully usable, so this must never throw or render a blank box.
    isMapsConfigured.mockReturnValue(false)

    render(<DistributorMap distributors={[makeDistributor()]} {...baseProps} />)

    expect(screen.getByTestId('distributor-map-fallback')).toBeInTheDocument()
    expect(screen.getByText(/VITE_GOOGLE_MAPS_API_KEY is not configured/i)).toBeInTheDocument()
    expect(screen.queryByTestId('distributor-map')).not.toBeInTheDocument()
  })

  it('explains a billing failure in terms the operator can act on', async () => {
    isMapsConfigured.mockReturnValue(true)
    ensureMaps.mockRejectedValue(new Error('BillingNotEnabledMapError'))

    render(<DistributorMap distributors={[]} {...baseProps} />)

    expect(await screen.findByText(/billing is not enabled/i)).toBeInTheDocument()
  })

  it('mounts a map host when the SDK is available', () => {
    isMapsConfigured.mockReturnValue(true)
    ensureMaps.mockReturnValue(new Promise(() => {})) // never resolves: stays loading

    render(<DistributorMap distributors={[makeDistributor()]} {...baseProps} />)

    expect(screen.getByTestId('distributor-map')).toBeInTheDocument()
    expect(screen.queryByTestId('distributor-map-fallback')).not.toBeInTheDocument()
  })
})
