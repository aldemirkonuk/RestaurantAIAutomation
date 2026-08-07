import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, AlertCircle, Crosshair } from 'lucide-react'
import { ensureMaps, describeMapsError, isMapsConfigured } from '../../../lib/googleMaps'
import type { Distributor } from '../../../services/api/distributors'
import { cn } from '../../../lib/utils'

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
  className?: string
}

const WINE = '#9E4249'
const WINE_DARK = '#7C3339'
const SLATE = '#8A817C'

/** Pin markup. Kept as raw SVG so marker content is a plain DOM node. */
function pinElement(opts: { active: boolean; dimmed: boolean; label?: string; isCustom?: boolean }): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = `transform: translateY(${opts.active ? '-3px' : '0'}); transition: transform .12s ease; cursor: pointer;`
  
  const baseColor = opts.isCustom ? '#D97706' : WINE
  const activeColor = opts.isCustom ? '#B45309' : WINE_DARK
  const dimmedColor = opts.isCustom ? '#FCD34D' : SLATE
  
  const fill = opts.dimmed ? dimmedColor : opts.active ? activeColor : baseColor
  const scale = opts.active ? 1.18 : 1
  
  const centerIcon = opts.isCustom
    ? `<path d="M13 7.5L14.5 11.5L18.5 12L15.5 15L16.5 19L13 17L9.5 19L10.5 15L7.5 12L11.5 11.5L13 7.5Z" fill="#fff" fill-opacity="${opts.dimmed ? 0.75 : 0.95}"/>`
    : `<circle cx="13" cy="12.6" r="5.1" fill="#fff" fill-opacity="${opts.dimmed ? 0.75 : 0.95}"/>`

  el.innerHTML = `
    <svg width="${26 * scale}" height="${34 * scale}" viewBox="0 0 26 34" fill="none" xmlns="http://www.w3.org/2000/svg"
         style="filter: drop-shadow(0 ${opts.active ? 3 : 1}px ${opts.active ? 6 : 3}px rgba(0,0,0,.3));">
      <path d="M13 0C5.82 0 0 5.82 0 13c0 9.2 11.6 20.2 12.1 20.6a1.3 1.3 0 0 0 1.8 0C14.4 33.2 26 22.2 26 13 26 5.82 20.18 0 13 0Z" fill="${fill}"/>
      ${centerIcon}
    </svg>`
  return el
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
  className,
}: DistributorMapProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement>>(new Map())
  const originMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null)
  const didFitRef = useRef(false)

  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [dirty, setDirty] = useState(false)

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
          center: origin ?? { lat: 39.5, lng: -98.35 },
          zoom: origin ? 9 : 4,
          mapId: 'DEMO_MAP_ID',
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
          clickableIcons: false,
        })
        mapRef.current = map
        map.addListener('dragend', () => setDirty(true))
        map.addListener('zoom_changed', () => setDirty(true))
        setReady(true)
      })
      .catch((e) => !cancelled && setError(describeMapsError(e)))

    return () => {
      cancelled = true
    }
    // Intentionally mount-only: re-creating the map on origin change would
    // discard user pan/zoom. Origin re-centring is handled separately below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── origin marker ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !mapRef.current || !origin) return
    let cancelled = false
    ensureMaps().then(({ marker }) => {
      if (cancelled || !mapRef.current) return
      originMarkerRef.current?.map && (originMarkerRef.current.map = null)
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

      // Drop markers whose vendor left the result set.
      for (const [id, mk] of existing) {
        if (!wanted.has(id)) {
          mk.map = null
          existing.delete(id)
        }
      }

      for (const d of pinnable) {
        const position = { lat: Number(d.latitude), lng: Number(d.longitude) }
        let mk = existing.get(d.id)
        if (!mk) {
          mk = new marker.AdvancedMarkerElement({
            map,
            position,
            content: pinElement({ active: false, dimmed: !d.may_serve, isCustom: d.listing_tier === 'custom' }),
            title: d.name,
          })
          mk.addListener('click', () => onSelectRef.current(d.id))
          const el = mk.content as HTMLElement
          el.addEventListener('mouseenter', () => onHoverRef.current(d.id))
          el.addEventListener('mouseleave', () => onHoverRef.current(null))
          existing.set(d.id, mk)
        } else {
          mk.position = position
        }
      }

      // Frame the results once, then leave the viewport under user control.
      if (!didFitRef.current && pinnable.length > 0) {
        didFitRef.current = true
        const bounds = new google.maps.LatLngBounds()
        pinnable.forEach((d) => bounds.extend({ lat: Number(d.latitude), lng: Number(d.longitude) }))
        if (origin) bounds.extend(origin)
        map.fitBounds(bounds, 64)
      }
    })

    return () => {
      cancelled = true
    }
  }, [ready, pinnable, origin])

  // ── hover / selection styling ─────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return
    for (const d of pinnable) {
      const mk = markersRef.current.get(d.id)
      if (!mk) continue
      const active = d.id === hoveredId || d.id === selectedId
      mk.content = pinElement({ active, dimmed: !d.may_serve, isCustom: d.listing_tier === 'custom' })
      mk.zIndex = active ? 100 : 2
      const el = mk.content as HTMLElement
      el.addEventListener('mouseenter', () => onHoverRef.current(d.id))
      el.addEventListener('mouseleave', () => onHoverRef.current(null))
      el.addEventListener('click', () => onSelectRef.current(d.id))
    }
  }, [ready, hoveredId, selectedId, pinnable])

  // Pan to a selection made from the list, without changing zoom.
  useEffect(() => {
    if (!ready || !mapRef.current || !selectedId) return
    const d = pinnable.find((x) => x.id === selectedId)
    if (d?.latitude != null && d?.longitude != null) {
      mapRef.current.panTo({ lat: Number(d.latitude), lng: Number(d.longitude) })
    }
  }, [ready, selectedId, pinnable])

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
