import { describe, it, expect } from 'vitest'
import {
  arcDip,
  boundsCenter,
  continentFor,
  easeInOutCubic,
  zoomForBounds,
  type BoundsLiteral,
} from './mapCamera'
import { stateFromAddress } from './customProvider'

describe('continentFor', () => {
  it('places a Michigan restaurant in North America', () => {
    expect(continentFor({ lat: 42.73, lng: -84.48 }).name).toBe('North America')
  })

  it('places Bordeaux in Europe', () => {
    expect(continentFor({ lat: 44.84, lng: -0.58 }).name).toBe('Europe')
  })

  it('falls back to a world frame in the open ocean rather than throwing', () => {
    expect(continentFor({ lat: -40, lng: -140 }).name).toBe('the world')
  })
})

describe('easeInOutCubic', () => {
  it('pins both ends so a flight starts and lands exactly on target', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
  })

  it('is symmetric about the midpoint', () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6)
    expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1, 6)
  })
})

describe('arcDip', () => {
  const at = (lat: number, lng: number, zoom = 10) => ({ center: { lat, lng }, zoom })

  it('does not dip between two vendors in the same metro', () => {
    // Two pins a few km apart already share the screen; pulling the camera out
    // would be more disruptive than the move itself.
    expect(arcDip(at(42.73, -84.48), at(42.79, -84.55))).toBe(0)
  })

  it('dips for a cross-country jump', () => {
    expect(arcDip(at(42.73, -84.48), at(34.05, -118.24))).toBeGreaterThan(1)
  })

  it('caps the dip so a long flight never zooms out to the whole globe', () => {
    expect(arcDip(at(60, -150), at(-35, 150))).toBeLessThanOrEqual(2.5)
  })
})

describe('zoomForBounds', () => {
  const michigan: BoundsLiteral = { north: 48.3, south: 41.7, east: -82.1, west: -90.4 }
  const eastLansing: BoundsLiteral = { north: 42.78, south: 42.69, east: -84.44, west: -84.55 }

  it('returns a lower zoom for a larger region', () => {
    expect(zoomForBounds(michigan, 800, 600)).toBeLessThan(zoomForBounds(eastLansing, 800, 600))
  })

  it('zooms out when the same region must fit a smaller viewport', () => {
    expect(zoomForBounds(michigan, 400, 300)).toBeLessThan(zoomForBounds(michigan, 1200, 900))
  })

  it('returns a state-level zoom for a state-sized box', () => {
    const z = zoomForBounds(michigan, 900, 700)
    expect(z).toBeGreaterThan(4)
    expect(z).toBeLessThan(9)
  })

  it('does not divide by zero on a degenerate single-point box', () => {
    const point: BoundsLiteral = { north: 42, south: 42, east: -84, west: -84 }
    expect(Number.isFinite(zoomForBounds(point, 800, 600))).toBe(true)
  })
})

describe('boundsCenter', () => {
  it('centres a normal box', () => {
    const c = boundsCenter({ north: 48, south: 42, east: -82, west: -90 })
    expect(c.lat).toBeCloseTo(45, 6)
    expect(c.lng).toBeCloseTo(-86, 6)
  })

  it('centres a box crossing the antimeridian without landing in Africa', () => {
    // west 170, east -170 spans 20° across the date line. Naive averaging
    // gives 0 — the Gulf of Guinea, half a world away.
    const c = boundsCenter({ north: 10, south: -10, east: -170, west: 170 })
    expect(Math.abs(c.lng)).toBeGreaterThan(170)
  })
})

describe('stateFromAddress', () => {
  it('reads a state code followed by a ZIP, the shape Places produces', () => {
    expect(stateFromAddress('123 Grand River Ave, East Lansing, MI 48823, USA')).toBe('MI')
  })

  it('reads a spelled-out state name', () => {
    expect(stateFromAddress('500 Main Street, Austin, Texas, United States')).toBe('TX')
  })

  it('returns null rather than guessing when no state is present', () => {
    expect(stateFromAddress('12 Rue de Rivoli, Paris, France')).toBeNull()
    expect(stateFromAddress('')).toBeNull()
    expect(stateFromAddress(null)).toBeNull()
  })
})
