/**
 * Camera framing and motion for the distributor map.
 *
 * Why this is not `map.panTo()` + `map.setZoom()`
 * ----------------------------------------------
 * Those are two independent animations. `panTo` eases the centre while
 * `setZoom` steps the zoom on its own schedule, so a click that changes both
 * reads as a lurch: the map slides, then jumps scale, and on a long jump the
 * tiles for the intermediate region never load and the canvas flashes empty.
 * That flash is the "page visual disappears for a second" problem — it is not
 * a React re-render, it is the tile pipeline being asked for a straight-line
 * pan across a continent at street zoom.
 *
 * A single interpolated camera fixes both halves. We drive centre and zoom
 * from one eased clock, and we dip the zoom outward mid-flight so the camera
 * rises, travels while the world is small (few tiles, all cheap), then
 * descends. That is the same trick Google Earth and Mapbox's `flyTo` use, and
 * it is why those transitions feel continuous rather than teleported.
 *
 * Everything here is framework-free so the motion can be unit-tested without
 * mounting a map: `easeInOutCubic`, `zoomForBounds` and `arcDip` are pure.
 */

export type MapScope = 'continent' | 'country' | 'state' | 'city'

export const MAP_SCOPES: readonly MapScope[] = ['continent', 'country', 'state', 'city']

export const SCOPE_LABEL: Record<MapScope, string> = {
  continent: 'Continent',
  country: 'Country',
  state: 'State',
  city: 'City',
}

export interface LatLng {
  lat: number
  lng: number
}

export interface Camera {
  center: LatLng
  zoom: number
}

export interface BoundsLiteral {
  north: number
  south: number
  east: number
  west: number
}

/** Zoom the camera lands on when a marker is selected: metro/city context. */
export const SELECT_ZOOM = 10.5

/**
 * Continent frames, as bounding boxes.
 *
 * Hardcoded because no geocoding service returns a continent — reverse
 * geocoding gives country, admin area and locality, and stops there. These are
 * deliberately generous: a continent view is meant to be recognisable at a
 * glance, not tight. Ordered so the first box containing a point wins, which
 * matters where boxes overlap (Central America sits inside both American
 * boxes; North America is listed first because that is the useful frame for a
 * Mexican restaurant).
 */
const CONTINENT_BOUNDS: Array<{ name: string; bounds: BoundsLiteral }> = [
  { name: 'North America', bounds: { north: 72, south: 7, west: -168, east: -52 } },
  { name: 'South America', bounds: { north: 13, south: -56, west: -82, east: -34 } },
  { name: 'Europe', bounds: { north: 71, south: 34, west: -25, east: 45 } },
  { name: 'Africa', bounds: { north: 37, south: -35, west: -18, east: 52 } },
  { name: 'Oceania', bounds: { north: 0, south: -48, west: 110, east: 180 } },
  { name: 'Asia', bounds: { north: 78, south: -11, west: 26, east: 180 } },
]

const WORLD_BOUNDS: BoundsLiteral = { north: 72, south: -56, west: -170, east: 180 }

function contains(b: BoundsLiteral, p: LatLng): boolean {
  return p.lat <= b.north && p.lat >= b.south && p.lng >= b.west && p.lng <= b.east
}

/** The continent containing a point, with a world fallback for the open ocean. */
export function continentFor(point: LatLng): { name: string; bounds: BoundsLiteral } {
  return (
    CONTINENT_BOUNDS.find((c) => contains(c.bounds, point)) ?? {
      name: 'the world',
      bounds: WORLD_BOUNDS,
    }
  )
}

/** Google's address-component type for each non-continent scope. */
const SCOPE_COMPONENT: Record<Exclude<MapScope, 'continent'>, string> = {
  country: 'country',
  state: 'administrative_area_level_1',
  city: 'locality',
}

export interface ScopeFrame {
  bounds: BoundsLiteral
  /** Human name of the region framed, e.g. "North America" or "Michigan". */
  label: string
}

/**
 * The bounding box to frame for a given scope around the restaurant.
 *
 * Continent comes from the table above. The rest come from reverse-geocoding
 * the restaurant's coordinates and reading the `viewport` Google already
 * computed for the matching administrative region — that viewport is the frame
 * Google Maps itself would use when you search for "Michigan", which is
 * exactly the framing a user expects.
 *
 * Falls back to the next-widest scope rather than failing: a restaurant whose
 * address has no `locality` (rural addresses often do not) still gets a
 * sensible state frame instead of an error.
 */
export async function resolveScopeFrame(
  scope: MapScope,
  origin: LatLng,
  geocoder: google.maps.Geocoder,
): Promise<ScopeFrame> {
  if (scope === 'continent') {
    const c = continentFor(origin)
    return { bounds: c.bounds, label: c.name }
  }

  let results: google.maps.GeocoderResult[] = []
  try {
    const res = await geocoder.geocode({ location: origin })
    results = res.results ?? []
  } catch {
    // Geocoding is a network call against a quota'd API. A failure should
    // widen the view, never blank the map.
    const c = continentFor(origin)
    return { bounds: c.bounds, label: c.name }
  }

  const wanted = SCOPE_COMPONENT[scope]
  const match = results.find((r) => r.types?.includes(wanted))
  const viewport = match?.geometry?.viewport ?? match?.geometry?.bounds

  if (!viewport) {
    // Widen one step. `city → state → country → continent` terminates because
    // continent never recurses.
    const next: MapScope =
      scope === 'city' ? 'state' : scope === 'state' ? 'country' : 'continent'
    return resolveScopeFrame(next, origin, geocoder)
  }

  const ne = viewport.getNorthEast()
  const sw = viewport.getSouthWest()
  return {
    bounds: { north: ne.lat(), south: sw.lat(), east: ne.lng(), west: sw.lng() },
    label:
      match?.address_components?.find((c) => c.types.includes(wanted))?.long_name ??
      match?.formatted_address ??
      SCOPE_LABEL[scope],
  }
}

// ── pure camera maths ───────────────────────────────────────────────────────

const TILE_SIZE = 256

function latRad(lat: number): number {
  const s = Math.sin((lat * Math.PI) / 180)
  return Math.log((1 + s) / (1 - s)) / 2
}

/**
 * The fractional zoom at which `bounds` exactly fills a viewport of the given
 * pixel size, minus padding.
 *
 * We compute this ourselves instead of calling `map.fitBounds` because
 * fitBounds jumps the camera. Having the number lets us *animate to* the same
 * framing fitBounds would have produced.
 *
 * Fractional, not rounded: vector maps (any map with a `mapId`) render
 * continuous zoom, and rounding down here is what makes a "fit" leave a
 * distracting margin on one axis.
 */
export function zoomForBounds(
  bounds: BoundsLiteral,
  width: number,
  height: number,
  padding = 48,
  maxZoom = 16,
): number {
  const w = Math.max(width - padding * 2, 1)
  const h = Math.max(height - padding * 2, 1)

  const latFraction = (latRad(bounds.north) - latRad(bounds.south)) / (2 * Math.PI)
  let lngDiff = bounds.east - bounds.west
  if (lngDiff < 0) lngDiff += 360
  const lngFraction = lngDiff / 360

  // A degenerate box (a single point) would divide by zero; such a box has no
  // meaningful "fit" zoom, so fall back to the cap.
  const latZoom = latFraction > 0 ? Math.log2(h / TILE_SIZE / latFraction) : maxZoom
  const lngZoom = lngFraction > 0 ? Math.log2(w / TILE_SIZE / lngFraction) : maxZoom

  return Math.max(Math.min(latZoom, lngZoom, maxZoom), 0)
}

export function boundsCenter(b: BoundsLiteral): LatLng {
  let east = b.east
  if (east < b.west) east += 360
  const lng = (b.west + east) / 2
  return {
    lat: (b.north + b.south) / 2,
    lng: lng > 180 ? lng - 360 : lng,
  }
}

/** Symmetric ease: slow start, quick middle, soft landing. */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/**
 * How far to pull the camera back mid-flight, in zoom levels.
 *
 * Scaled by how far the camera travels in screen terms, so a nudge between two
 * neighbouring vendors does not swing out to orbit — that would be far more
 * jarring than the snap it replaces. Capped so even a cross-continent jump
 * stays recognisable rather than zooming to the whole globe.
 */
export function arcDip(from: Camera, to: Camera): number {
  const dLat = Math.abs(to.center.lat - from.center.lat)
  const dLng = Math.abs(to.center.lng - from.center.lng)
  const degrees = Math.hypot(dLat, dLng)
  // Below ~1.5° apart (a metro area) the two views overlap on screen already;
  // dipping there is motion for its own sake.
  if (degrees < 1.5) return 0
  return Math.min(degrees / 12, 2.5)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Shortest-path longitude interpolation, so a Pacific crossing does not
 *  travel the long way round the globe. */
function lerpLng(a: number, b: number, t: number): number {
  let delta = b - a
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  const out = a + delta * t
  if (out > 180) return out - 360
  if (out < -180) return out + 360
  return out
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export interface FlyHandle {
  /** Stop the animation where it is. Safe to call after it has finished. */
  cancel: () => void
}

/**
 * Animate the map camera to `to` over one eased clock.
 *
 * Returns a handle rather than a promise because the common reason a flight
 * ends is that the user grabbed the map or clicked a different pin — the
 * caller needs to interrupt, not await.
 */
export function flyTo(
  map: google.maps.Map,
  to: Camera,
  opts: { duration?: number; onDone?: () => void } = {},
): FlyHandle {
  const startCenter = map.getCenter()
  const from: Camera = {
    center: startCenter
      ? { lat: startCenter.lat(), lng: startCenter.lng() }
      : to.center,
    zoom: map.getZoom() ?? to.zoom,
  }

  const apply = (c: Camera) => {
    // moveCamera sets centre and zoom in one frame-consistent operation on
    // vector maps. setCenter + setZoom is the raster/older-SDK equivalent and
    // is fine, just two calls.
    const m = map as google.maps.Map & { moveCamera?: (o: unknown) => void }
    if (typeof m.moveCamera === 'function') m.moveCamera({ center: c.center, zoom: c.zoom })
    else {
      map.setCenter(c.center)
      map.setZoom(c.zoom)
    }
  }

  // Someone who has asked their OS for less motion gets the destination, not a
  // shortened version of the journey.
  if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
    apply(to)
    opts.onDone?.()
    return { cancel: () => {} }
  }

  const duration = opts.duration ?? 900
  const dip = arcDip(from, to)
  const start = performance.now()
  let raf = 0
  let cancelled = false

  const step = (now: number) => {
    if (cancelled) return
    const t = Math.min((now - start) / duration, 1)
    const e = easeInOutCubic(t)

    apply({
      center: {
        lat: lerp(from.center.lat, to.center.lat, e),
        lng: lerpLng(from.center.lng, to.center.lng, e),
      },
      // sin(pi*t) is 0 at both ends and 1 at the midpoint, so the dip never
      // disturbs the start or the landing — only the middle of the flight.
      zoom: lerp(from.zoom, to.zoom, e) - dip * Math.sin(Math.PI * t),
    })

    if (t < 1) raf = requestAnimationFrame(step)
    else opts.onDone?.()
  }

  raf = requestAnimationFrame(step)

  return {
    cancel: () => {
      cancelled = true
      cancelAnimationFrame(raf)
    },
  }
}
