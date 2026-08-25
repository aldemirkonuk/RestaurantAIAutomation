import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DistanceLabel, DistributorCard, TerritoryBadge, TierBadge, formatDistance } from './bits'
import type { Distributor } from '../../../services/api/distributors'

function makeDistributor(over: Partial<Distributor> = {}): Distributor {
  return {
    id: 'v1',
    name: 'Skurnik Wines & Spirits',
    type: 'importer',
    city: 'New York',
    state: 'NY',
    country: 'US',
    website: null,
    wine_specialties: 'Burgundy, Champagne',
    latitude: 40.74,
    longitude: -73.98,
    distance_m: 1300,
    distance_is_hq: false,
    nearest_location_kind: 'warehouse',
    may_serve: true,
    serves_via: 'NY',
    listing_tier: 'curated',
    data_confidence: 1,
    verified_at: null,
    ...over,
  }
}

describe('formatDistance', () => {
  it('uses metres below a kilometre', () => {
    expect(formatDistance(420)).toBe('420 m')
  })

  it('keeps one decimal for short distances', () => {
    expect(formatDistance(1300)).toBe('1.3 km')
  })

  it('rounds and groups long distances', () => {
    expect(formatDistance(3_932_000)).toBe('3,932 km')
  })

  it('renders an em dash when distance is unknown', () => {
    expect(formatDistance(null)).toBe('—')
  })
})

describe('DistanceLabel', () => {
  it('flags a distance measured from head office', () => {
    // A national distributor's HQ can be thousands of km from the warehouse
    // that actually ships, so this caveat must be visible.
    render(<DistanceLabel d={makeDistributor({ distance_is_hq: true, nearest_location_kind: null })} />)
    expect(screen.getByText('HQ')).toBeInTheDocument()
  })

  it('names the local site when one is on file', () => {
    render(<DistanceLabel d={makeDistributor({ distance_is_hq: false, nearest_location_kind: 'warehouse' })} />)
    expect(screen.getByText('warehouse')).toBeInTheDocument()
    expect(screen.queryByText('HQ')).not.toBeInTheDocument()
  })

  it('says so plainly when the vendor has no mapped address', () => {
    render(<DistanceLabel d={makeDistributor({ distance_m: null })} />)
    expect(screen.getByText('no mapped address')).toBeInTheDocument()
  })
})

describe('TerritoryBadge', () => {
  it('distinguishes a nationwide licence from a state one', () => {
    const { rerender } = render(<TerritoryBadge servesVia="nationwide" mayServe />)
    expect(screen.getByText('Nationwide')).toBeInTheDocument()

    rerender(<TerritoryBadge servesVia="NY" mayServe />)
    expect(screen.getByText('NY')).toBeInTheDocument()
  })

  it('states clearly when a vendor cannot serve you', () => {
    render(<TerritoryBadge servesVia={null} mayServe={false} />)
    expect(screen.getByText('Cannot serve you')).toBeInTheDocument()
  })
})

describe('TierBadge', () => {
  it('marks hand-checked rows as verified', () => {
    render(<TierBadge tier="curated" />)
    expect(screen.getByText('Verified')).toBeInTheDocument()
  })

  it('labels registry rows as licensed but unverified', () => {
    // Registry rows hold a real permit but their details are unchecked, so they
    // must read differently from curated ones rather than blending in.
    render(<TierBadge tier="registry" />)
    expect(screen.getByText('Licensed')).toBeInTheDocument()
    expect(screen.queryByText('Verified')).not.toBeInTheDocument()
  })

  it('labels custom rows as My Provider', () => {
    render(<TierBadge tier="custom" />)
    expect(screen.getByText('My Provider')).toBeInTheDocument()
  })

  it('renders nothing for an unrecognised tier', () => {
    const { container } = render(<TierBadge tier="user_submitted" />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('DistributorCard', () => {
  it('opens the distributor when clicked', async () => {
    const onOpen = vi.fn()
    render(
      <DistributorCard d={makeDistributor()} active={false} onHover={vi.fn()} onOpen={onOpen} />,
    )
    await userEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalledWith('v1')
  })

  it('reports hover in and out so the matching marker can highlight', async () => {
    const onHover = vi.fn()
    render(
      <DistributorCard d={makeDistributor()} active={false} onHover={onHover} onOpen={vi.fn()} />,
    )
    const card = screen.getByRole('button')
    await userEvent.hover(card)
    expect(onHover).toHaveBeenCalledWith('v1')
    await userEvent.unhover(card)
    expect(onHover).toHaveBeenLastCalledWith(null)
  })

  it('carries the id the map uses to scroll it into view', () => {
    render(<DistributorCard d={makeDistributor()} active onHover={vi.fn()} onOpen={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveAttribute('data-distributor-id', 'v1')
  })

  it('renders full_address fallback when city and state are null', () => {
    render(
      <DistributorCard
        d={makeDistributor({
          city: null,
          state: null,
          full_address: '123 Vineyard Lane, Napa, CA 94558',
          listing_tier: 'custom',
        })}
        active={false}
        onHover={vi.fn()}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getByText('123 Vineyard Lane, Napa, CA 94558')).toBeInTheDocument()
  })
})
