import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, AlertCircle, Crosshair, Undo2 } from 'lucide-react'
import { ensureMaps, ensureGeocoder, describeMapsError, isMapsConfigured } from '../../../lib/googleMaps'
import type { Distributor } from '../../../services/api/distributors'
import { cn } from '../../../lib/utils'
import {
  flyTo,
  resolveScopeFrame,
  zoomForBounds,
  boundsCenter,
  SELECT_ZOOM,
  type BoundsLiteral,
  type FlyHandle,
  type MapScope,
  type ScopeFrame,
} from './mapCamera'

export interface DistributorMapProps {
  distributors: Distributor[]
  origin: { lat: number; lng: number } | null
  originLabel?: string
  hoveredId: string | null
  selectedId: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
  /** Fired when the user asks to re-search the visible area. */
  onSearchArea: (bounds: { minLng: number; minLat: number; maxLng: number; maxLat: number }) => void
  /** How wide to frame the restaurant on load. From Settings → Map. */
  scope?: MapScope
  /**
   * A region to fly to, framed to fit. Set by the state filter so picking
   * "Michigan" moves the camera there as well as filtering the list — the two
   * panes stay one surface. Null leaves the camera alone.
   */
  focusBounds?: BoundsLiteral | null
  className?: string
}

const WINE = '#1A5E6B'
const WINE_DARK = '#7C3339'
const SLATE = '#8A817C'
const CUSTOM = '#D97706'
const CUSTOM_DARK = '#B45309'
const CUSTOM_DIM = '#FCD34D'

/**
 * The pulse keyframes live in one injected stylesheet rather than in a <style>
 * tag inside every pin. Each marker carrying its own copy meant N identical
 * rules in the document and, worse, the rule being torn down and re-parsed
 * every time a pin re-rendered — which restarts the animation from frame zero
 * and is why the pulse looked like a stutter rather than a wave.
 */
const PULSE_STYLE_ID = 'distributor-pin-keyframes'
function ensurePulseKeyframes() {
  if (typeof document === 'undefined' || document.getElementById(PULSE_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = PULSE_STYLE_ID
  style.textContent = `
    @keyframes distributor-pulse {
      0%   { transform: translate(-50%, -50%) scale(1);   opacity: .55; }
      70%  { transform: translate(-50%, -50%) scale(2.4); opacity: 0; }
      100% { transform: translate(-50%, -50%) scale(2.4); opacity: 0; }
    }`
  document.head.appendChild(style)
}

interface PinState {
  active: boolean
  dimmed: boolean
  isCustom: boolean
  selected: boolean
}

interface Pin {
  root: HTMLElement
  ring: HTMLElement
  body: SVGPathElement
  icon: SVGElement
}

/**
 * A pin is built once and then mutated.
 *
 * The previous version rebuilt the whole element on every hover and selection
 * change and reassigned `marker.content`. A CSS transition can only animate a
 * property change on an element that stays in the document — replacing the
 * node means the browser sees a brand-new element already at its final
 * transform, so `transition: transform` never fired. Every "spring" was
 * actually an instant swap. Mutating the same node is what makes the easing
 * real, and it also stops us leaking a duplicate set of event listeners on
 * each state change.
 */
function createPin(): Pin {
  ensurePulseKeyframes()
  const root = document.createElement('div')
  root.style.cssText =
    'position:relative;width:26px;height:34px;cursor:pointer;' +
    'transition:transform .28s cubic-bezier(.34,1.56,.64,1),filter .2s ease;' +
    'will-change:transform;'

  const ring = document.createElement('div')
  ring.style.cssText =
    'position:absolute;left:50%;top:52%;width:16px;height:16px;border-radius:9999px;' +
    'pointer-events:none;display:none;transform:translate(-50%,-50%);'
  root.appendChild(ring)

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 26 34')
  svg.setAttribute('width', '26')
  svg.setAttribute('height', '34')
  svg.style.cssText = 'position:relative;display:block;'

  const body = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  body.setAttribute(
    'd',
    'M13 0C5.82 0 0 5.82 0 13c0 9.2 11.6 20.2 12.1 20.6a1.3 1.3 0 0 0 1.8 0C14.4 33.2 26 22.2 26 13 26 5.82 20.18 0 13 0Z',
  )
  svg.appendChild(body)

  // Catalogue vendors get a dot, the restaurant's own providers get a star, so
  // "mine" is legible at pin size without reading a colour.
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGElement
  svg.appendChild(icon)

  root.appendChild(svg)
  return { root, ring, body, icon }
}

const DOT_PATH = 'M13 7.5a5.1 5.1 0 1 0 0 10.2 5.1 5.1 0 0 0 0-10.2Z'
const STAR_PATH = 'M13 7.5L14.5 11.5L18.5 12L15.5 15L16.5 19L13 17L9.5 19L10.5 15L7.5 12L11.5 11.5L13 7.5Z'

function updatePin(pin: Pin, s: PinState) {
  const base = s.isCustom ? CUSTOM : WINE
  const activeColor = s.isCustom ? CUSTOM_DARK : WINE_DARK
  const dimmedColor = s.isCustom ? CUSTOM_DIM : SLATE
  const fill = s.dimmed ? dimmedColor : s.active ? activeColor : base

  pin.body.setAttribute('fill', fill)
  pin.icon.setAttribute('d', s.isCustom ? STAR_PATH : DOT_PATH)
  pin.icon.setAttribute('fill', '#fff')
  pin.icon.setAttribute('fill-opacity', s.dimmed ? '0.75' : '0.95')

  const scale = s.selected ? 1.3 : s.active ? 1.16 : 1
  const lift = s.active || s.selected ? -6 : 0
  pin.root.style.transform = `translateY(${lift}px) scale(${scale})`
  pin.root.style.filter = `drop-shadow(0 ${s.active ? 4 : 1}px ${s.active ? 8 : 3}px rgba(0,0,0,${
    s.active ? '.35' : '.25'
  }))`

  if (s.selected) {
    pin.ring.style.background = fill
    pin.ring.style.display = 'block'
    pin.ring.style.animation = 'distributor-pulse 1.6s ease-out infinite'
  } else {
    pin.ring.style.display = 'none'
    pin.ring.style.animation = ''
  }
}

function originElement(): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = `
    <div style="width:18px;height:18px;border-radius:9999px;background:#2563EB;border:3px solid #fff;
                box-shadow:0 0 0 3px rgba(37,99,235,.25), 0 1px 4px rgba(0,0,0,.3);"></div>`
  return el
}

export function DistributorMap({
  distributors,
  origin,
  originLabel = 'Your restaurant',
  hoveredId,
  selectedId,
  onHover,
  onSelect,
  onSearchArea,
  scope = 'continent',
  focusBounds = null,
  className,
}: DistributorMapProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement>>(new Map())
  const pinsRef = useRef<Map<string, Pin>>(new Map())
  const originMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null)
  /** The flight currently in progress, so a new one can interrupt it. */
  const flightRef = useRef<FlyHandle | null>(null)
  /** False until the map has been framed once, so the first frame does not animate. */
  const framedRef = useRef(false)

  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [frame, setFrame] = useState<ScopeFrame | null>(null)
  /** True once the camera has left the scope frame, which is what the
   *  "back to …" affordance exists to undo. */
  const [offScope, setOffScope] = useState(false)

  // Only vendors with coordinates can be pinned. Un-geocoded ones still appear
  // in the list — absent from the map is honest, a pin at (0,0) is not.
  const pinnable = useMemo(
    () => distributors.filter((d) => d.latitude != null && d.longitude != null),
    [distributors],
  )

  // Callbacks change every render; markers are long-lived. Refs keep the
  // listeners stable so we do not rebuild every marker on each parent render.
  const onSelectRef = useRef(onSelect)
  const onHoverRef = useRef(onHover)
  useEffect(() => {
    onSelectRef.current = onSelect
    onHoverRef.current = onHover
  }, [onSelect, onHover])

  /** Interrupt any flight in progress. Called before starting a new one and
   *  whenever the user takes the wheel. */
  const stopFlight = useCallback(() => {
    flightRef.current?.cancel()
    flightRef.current = null
  }, [])

  // ── init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isMapsConfigured()) {
      setError(describeMapsError(new Error('not set')))
      return
    }
    let cancelled = false

    ensureMaps()
      .then(({ maps }) => {
        if (cancelled || !hostRef.current) return
        const map = new maps.Map(hostRef.current, {
          // A neutral world view for the split second before the scope frame
          // resolves. Framing happens in the effect below, animated or not.
          center: { lat: 20, lng: 0 },
          zoom: 2,
          mapId: 'DEMO_MAP_ID',
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
          clickableIcons: false,
        })
        mapRef.current = map

        // Grabbing the map cancels whatever the camera was doing. Fighting a
        // user's drag with an animation is the single most disorienting thing
        // a map can do.
        map.addListener('dragstart', () => {
          stopFlight()
          setOffScope(true)
        })
        map.addListener('dragend', () => setDirty(true))
        map.addListener('zoom_changed', () => setDirty(true))
        setReady(true)
      })
      .catch((e) => !cancelled && setError(describeMapsError(e)))

    return () => {
      cancelled = true
      flightRef.current?.cancel()
    }
    // Mount-only: re-creating the map would discard the user's pan/zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Centre + zoom that frames the current scope in the current container. */
  const scopeCamera = useCallback((f: ScopeFrame) => {
    const el = hostRef.current
    const width = el?.clientWidth ?? 800
    const height = el?.clientHeight ?? 600
    return { center: boundsCenter(f.bounds), zoom: zoomForBounds(f.bounds, width, height) }
  }, [])

  // ── frame the restaurant at the configured scope ──────────────────────────
  useEffect(() => {
    if (!ready || !mapRef.current || !origin) return
    let cancelled = false

    ensureGeocoder()
      .then((geocoder) => resolveScopeFrame(scope, origin, geocoder))
      .then((resolved) => {
        if (cancelled || !mapRef.current) return
        setFrame(resolved)
        const camera = scopeCamera(resolved)
        stopFlight()
        if (framedRef.current) {
          // A scope change the user made deliberately — show the journey.
          flightRef.current = flyTo(mapRef.current, camera, { duration: 1000 })
        } else {
          // First paint. Animating from an arbitrary default centre would be
          // motion the user did not ask for and did not see the start of.
          framedRef.current = true
          mapRef.current.setCenter(camera.center)
          mapRef.current.setZoom(camera.zoom)
        }
        setOffScope(false)
        setDirty(false)
      })
      .catch(() => {
        // Framing is a nicety; a failure must not blank a working map.
      })

    return () => {
      cancelled = true
    }
  }, [ready, origin, scope, scopeCamera, stopFlight])

  // ── origin marker ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !mapRef.current || !origin) return
    let cancelled = false
    ensureMaps().then(({ marker }) => {
      if (cancelled || !mapRef.current) return
      if (originMarkerRef.current) originMarkerRef.current.map = null
      originMarkerRef.current = new marker.AdvancedMarkerElement({
        map: mapRef.current,
        position: origin,
        content: originElement(),
        title: originLabel,
        zIndex: 1,
      })
    })
    return () => {
      cancelled = true
    }
  }, [ready, origin, originLabel])

  // ── vendor markers ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !mapRef.current) return
    let cancelled = false

    ensureMaps().then(({ marker }) => {
      if (cancelled || !mapRef.current) return
      const map = mapRef.current
      const existing = markersRef.current
      const wanted = new Set(pinnable.map((d) => d.id))

      for (const [id, mk] of existing) {
        if (!wanted.has(id)) {
          mk.map = null
          existing.delete(id)
          pinsRef.current.delete(id)
        }
      }

      for (const d of pinnable) {
        const position = { lat: Number(d.latitude), lng: Number(d.longitude) }
        const mk = existing.get(d.id)
        if (!mk) {
          const pin = createPin()
          updatePin(pin, {
            active: false,
            dimmed: !d.may_serve,
            isCustom: d.listing_tier === 'custom',
            selected: false,
          })
          const created = new marker.AdvancedMarkerElement({
            map,
            position,
            content: pin.root,
            title: d.name,
          })
          // Listeners are attached once, to a node that now outlives every
          // state change, so there is nothing to re-bind and nothing to leak.
          pin.root.addEventListener('mouseenter', () => onHoverRef.current(d.id))
          pin.root.addEventListener('mouseleave', () => onHoverRef.current(null))
          created.addListener('click', () => onSelectRef.current(d.id))
          existing.set(d.id, created)
          pinsRef.current.set(d.id, pin)
        } else {
          mk.position = position
        }
      }
    })

    return () => {
      cancelled = true
    }
  }, [ready, pinnable])

  // ── hover / selection styling ─────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return
    for (const d of pinnable) {
      const pin = pinsRef.current.get(d.id)
      if (!pin) continue
      const selected = d.id === selectedId
      const active = selected || d.id === hoveredId
      updatePin(pin, {
        active,
        selected,
        dimmed: !d.may_serve,
        isCustom: d.listing_tier === 'custom',
      })
      const mk = markersRef.current.get(d.id)
      if (mk) mk.zIndex = selected ? 200 : active ? 100 : 2
    }
  }, [ready, hoveredId, selectedId, pinnable])

  // ── fly to the selected vendor ────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !mapRef.current || !selectedId) return
    const d = pinnable.find((x) => x.id === selectedId)
    if (d?.latitude == null || d?.longitude == null) return

    stopFlight()
    flightRef.current = flyTo(mapRef.current, {
      center: { lat: Number(d.latitude), lng: Number(d.longitude) },
      // Metro framing: the city and its surroundings, not the street. Never
      // zooms back OUT past this, so picking a second nearby vendor nudges
      // rather than re-stages the view.
      zoom: Math.max(mapRef.current.getZoom() ?? 0, SELECT_ZOOM),
    })
    setOffScope(true)
    setDirty(false)
  }, [ready, selectedId, pinnable, stopFlight])

  // ── fly to a filtered region (state chips) ────────────────────────────────
  // Keyed on the bounds' values, not the object: the parent recomputes this
  // literal every render, and depending on identity would re-fly the camera on
  // every unrelated state change.
  const focusKey = focusBounds
    ? `${focusBounds.north},${focusBounds.south},${focusBounds.east},${focusBounds.west}`
    : null
  useEffect(() => {
    if (!ready || !mapRef.current || !focusBounds) return
    const el = hostRef.current
    stopFlight()
    flightRef.current = flyTo(mapRef.current, {
      center: boundsCenter(focusBounds),
      zoom: zoomForBounds(focusBounds, el?.clientWidth ?? 800, el?.clientHeight ?? 600, 64, 12),
    })
    setOffScope(true)
    setDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focusKey, stopFlight])

  const backToScope = useCallback(() => {
    if (!mapRef.current || !frame) return
    stopFlight()
    flightRef.current = flyTo(mapRef.current, scopeCamera(frame), { duration: 1000 })
    setOffScope(false)
    setDirty(false)
  }, [frame, scopeCamera, stopFlight])

  const searchThisArea = useCallback(() => {
    const b = mapRef.current?.getBounds()
    if (!b) return
    const sw = b.getSouthWest()
    const ne = b.getNorthEast()
    onSearchArea({ minLng: sw.lng(), minLat: sw.lat(), maxLng: ne.lng(), maxLat: ne.lat() })
    setDirty(false)
  }, [onSearchArea])

  // ── no-map fallback ───────────────────────────────────────────────────────
  if (error) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center',
          className,
        )}
        data-testid="distributor-map-fallback"
      >
        <AlertCircle className="h-5 w-5 text-gray-400" />
        <p className="text-sm font-medium text-gray-600">{error}</p>
        <p className="max-w-xs text-xs text-gray-400">
          The distributor list beside this panel is fully usable without the map.
        </p>
      </div>
    )
  }

  return (
    <div className={cn('relative overflow-hidden rounded-2xl border border-gray-100 shadow-sm', className)}>
      <div ref={hostRef} className="h-full w-full" data-testid="distributor-map" />

      {/* Return path. Present only once the camera has actually left the
          frame, so it never nags at rest. Closing the drawer deliberately
          does NOT move the camera — see the comment on offScope. */}
      {ready && offScope && frame && (
        <button
          type="button"
          onClick={backToScope}
          data-testid="back-to-scope"
          className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/95 px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-md backdrop-blur transition hover:bg-white"
        >
          <Undo2 className="h-3.5 w-3.5" />
          Back to {frame.label}
        </button>
      )}

      {dirty && (
        <button
          type="button"
          onClick={searchThisArea}
          className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-700 shadow-md transition hover:bg-gray-50"
        >
          <Crosshair className="h-3.5 w-3.5" />
          Search this area
        </button>
      )}

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
          <MapPin className="h-5 w-5 animate-pulse text-gray-300" />
        </div>
      )}

      {ready && pinnable.length < distributors.length && (
        <div className="absolute bottom-3 left-3 rounded-lg bg-white/95 px-2.5 py-1.5 text-[11px] font-medium text-gray-500 shadow-sm">
          {distributors.length - pinnable.length} without a mapped address
        </div>
      )}
    </div>
  )
}
