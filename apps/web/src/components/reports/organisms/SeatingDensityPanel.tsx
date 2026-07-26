/**
 * SeatingDensityPanel — the Reports "Seating Density" widget.
 *
 * Unlocks the seating-density UX batch (UX_PATHS_CATALOG.md NEW-761…NEW-860),
 * which was fully written but had no surface to attach to. Backed by
 * GET /analytics/table-performance/:restaurantId, which already computes every
 * density measure per table (covers/seat, checks/seat, $/seat, $/cover,
 * utilization, turns/seat, tips/seat) — this panel does no math of its own
 * beyond aggregating to zone/venue level, so the numbers stay the engine's.
 *
 * Paths covered: NEW-761 density-per-seat KPI + methodology · NEW-762 hover a
 * table for its density vs the zone median · NEW-763 Act → Reports/insights
 * deep link · NEW-765/366 revenue-per-cover · NEW-367 seat utilization ·
 * NEW-371/372 over/under-utilized flags · NEW-386 sales-per-seat trend context.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  LayoutGrid,
  RefreshCw,
  Info,
  ArrowRight,
  AlertTriangle,
} from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

interface TableRow {
  tableId: string
  label: string
  zone: string | null
  seats: number
  checks: number
  covers: number
  revenue: number
  checkinDensity: number | null
  checksPerSeat: number | null
  revenuePerSeat: number | null
  revenuePerCover: number | null
  seatUtilization: number | null
  turnoverPerSeat: number | null
  tipPerSeat: number | null
  distanceToBarM: number | null
  distanceToKitchenM: number | null
  distanceToPoolM: number | null
  isOutdoor?: boolean
}

/** The measures this widget surfaces, mapped to the catalog's feature ids. */
const MEASURES = [
  { key: 'checkinDensity' as const, label: 'Check-ins / seat', feature: 361, fmt: (v: number) => v.toFixed(2) },
  { key: 'checksPerSeat' as const, label: 'Checks / seat', feature: 362, fmt: (v: number) => v.toFixed(2) },
  { key: 'revenuePerSeat' as const, label: 'Sales / seat', feature: 363, fmt: (v: number) => `$${Math.round(v).toLocaleString()}` },
  { key: 'revenuePerCover' as const, label: 'Sales / cover', feature: 365, fmt: (v: number) => `$${Math.round(v).toLocaleString()}` },
  { key: 'seatUtilization' as const, label: 'Seat utilization', feature: 367, fmt: (v: number) => `${Math.round(v * 100)}%` },
  { key: 'turnoverPerSeat' as const, label: 'Turns / seat', feature: 368, fmt: (v: number) => v.toFixed(2) },
]

type MeasureKey = (typeof MEASURES)[number]['key']

interface Correlation {
  measure: string
  attribute: string
  r: number
  rControllingSeats: number | null
  n: number
}
interface Drivers {
  r2: number
  weights: { attribute: string; weight: number }[]
}

/**
 * Geometry attributes the table list can be tinted by. These are the real
 * columns on restaurant_tables, which is why bar-adjacency / kitchen-distance /
 * poolside / outdoor are answerable and things like "window seat" or "noise
 * proxy" (NEW-806/808) are not — no such field exists.
 */
const GEOMETRY = [
  { key: 'distanceToBarM' as const, label: 'Bar adjacency', feature: 398, invert: true },
  { key: 'distanceToKitchenM' as const, label: 'Kitchen distance', feature: 399, invert: false },
  { key: 'distanceToPoolM' as const, label: 'Poolside', feature: 401, invert: true },
  { key: 'seats' as const, label: 'Table size', feature: 402, invert: false },
]
type GeometryKey = (typeof GEOMETRY)[number]['key']

function median(values: number[]): number | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (v.length === 0) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

export function SeatingDensityPanel({ className = '' }: { className?: string }) {
  const { user } = useAuth()
  const restaurantId = user?.restaurantId
  const [rows, setRows] = useState<TableRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [measure, setMeasure] = useState<MeasureKey>('checkinDensity')
  const [showMethodology, setShowMethodology] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  // Geometry correlations + regression drivers, computed server-side.
  const [correlations, setCorrelations] = useState<Correlation[]>([])
  const [drivers, setDrivers] = useState<Drivers | null>(null)
  // Zone compare (NEW-765/775), zone drill-down (NEW-796), menus (NEW-767/797).
  const [comparedZones, setComparedZones] = useState<Set<string>>(new Set())
  const [zoneDetail, setZoneDetail] = useState<string | null>(null)
  const [zoneMenu, setZoneMenu] = useState<{ zone: string; x: number; y: number } | null>(null)
  const [measureMenu, setMeasureMenu] = useState<{ key: MeasureKey; x: number; y: number } | null>(null)
  const [mutedZones, setMutedZones] = useState<Set<string>>(new Set())
  /** Geometry attribute the table list is tinted by (NEW-798/799/801/808). */
  const [colorBy, setColorBy] = useState<GeometryKey | 'none'>('none')

  const load = useCallback(async (refresh = false) => {
    if (!restaurantId) return
    if (refresh) setRefreshing(true)
    try {
      const res = await fetch(`${API_URL}/api/v1/analytics/table-performance/${restaurantId}`)
      if (res.ok) {
        const body = await res.json()
        setRows(Array.isArray(body?.tables) ? body.tables : Array.isArray(body) ? body : [])
        setCorrelations(Array.isArray(body?.correlations) ? body.correlations : [])
        setDrivers(body?.drivers ?? null)
      }
    } catch {
      /* additive panel — fail quiet */
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [restaurantId])

  useEffect(() => { load() }, [load])

  const active = MEASURES.find(m => m.key === measure)!
  // Only tables with real traffic; a 0-check table would drag every median to 0.
  const withData = useMemo(() => rows.filter(r => r.checks > 0 && r[measure] != null), [rows, measure])

  const venueMedian = useMemo(
    () => median(withData.map(r => Number(r[measure]))),
    [withData, measure],
  )

  /** Zone rollup + each zone's median for the hover comparison (NEW-762). */
  const zones = useMemo(() => {
    const byZone = new Map<string, TableRow[]>()
    for (const r of withData) {
      const z = r.zone || 'Unzoned'
      byZone.set(z, [...(byZone.get(z) ?? []), r])
    }
    return Array.from(byZone.entries())
      .map(([zone, list]) => ({
        zone,
        tables: list.length,
        seats: list.reduce((s, r) => s + (r.seats || 0), 0),
        median: median(list.map(r => Number(r[measure]))),
      }))
      .sort((a, b) => (b.median ?? 0) - (a.median ?? 0))
  }, [withData, measure])

  const zoneMedianFor = useCallback(
    (zone: string | null) => zones.find(z => z.zone === (zone || 'Unzoned'))?.median ?? null,
    [zones],
  )

  /** NEW-371/372: tables far off the venue median in either direction. */
  const outliers = useMemo(() => {
    if (venueMedian == null || venueMedian === 0) return { over: [], under: [] as TableRow[] }
    const over = withData.filter(r => Number(r[measure]) >= venueMedian * 1.5)
    const under = withData.filter(r => Number(r[measure]) <= venueMedian * 0.5)
    return { over, under }
  }, [withData, measure, venueMedian])

  /**
   * NEW-798/799/801: the engine's own correlation between this measure and each
   * geometry attribute — "bar-adjacent premium", "kitchen-distance interaction"
   * and "poolside" are just this correlation read against different columns.
   */
  const geometryStory = useMemo(() => {
    const label = active.label.toLowerCase()
    return GEOMETRY.map(g => {
      const hit = correlations.find(
        c => c.attribute.toLowerCase().includes(g.label.split(' ')[0].toLowerCase()) ||
             (g.key === 'seats' && c.attribute === 'seats'),
      )
      return { ...g, correlation: hit ?? null, measureLabel: label }
    }).filter(g => g.correlation)
  }, [correlations, active])

  /** NEW-402: 2-top vs 4-top efficiency — median measure by table size band. */
  const sizeBands = useMemo(() => {
    const bands: Record<string, number[]> = { '2-top or smaller': [], '3–4 top': [], '5+ top': [] }
    for (const r of withData) {
      const v = Number(r[measure])
      if (!Number.isFinite(v)) continue
      if (r.seats <= 2) bands['2-top or smaller'].push(v)
      else if (r.seats <= 4) bands['3–4 top'].push(v)
      else bands['5+ top'].push(v)
    }
    return Object.entries(bands)
      .map(([band, vals]) => ({ band, n: vals.length, median: median(vals) }))
      .filter(b => b.n > 0)
  }, [withData, measure])

  /** Tables in the zones picked for side-by-side compare (NEW-765/775/805). */
  const compareRows = useMemo(
    () => zones.filter(z => comparedZones.has(z.zone)),
    [zones, comparedZones],
  )

  const toggleCompare = useCallback((zone: string) => {
    setComparedZones(prev => {
      const next = new Set(prev)
      if (next.has(zone)) next.delete(zone)
      else next.add(zone)
      return next
    })
  }, [])

  const exportMeasureCsv = useCallback(() => {
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = ['Table', 'Zone', 'Seats', 'Checks', 'Covers', 'Revenue', active.label].join(',')
    const lines = withData.map(r =>
      [q(r.label), q(r.zone || 'Unzoned'), r.seats, r.checks, r.covers, r.revenue, Number(r[measure]).toFixed(4)].join(','),
    )
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `seating-density-${measure}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }, [withData, measure, active])

  // ── Keyboard (NEW-764/774: `d` then digit focuses the Nth measure;
  //    NEW-804: `z` jumps to the densest zone) ───────────────────────────────
  const dPending = useRef(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (dPending.current) {
        dPending.current = false
        const n = parseInt(e.key, 10)
        if (n >= 1 && n <= MEASURES.length) {
          e.preventDefault()
          setMeasure(MEASURES[n - 1].key)
          return
        }
      }
      if (e.key === 'd') { dPending.current = true; window.setTimeout(() => { dPending.current = false }, 1200) }
      else if (e.key === 'z' && zones.length > 0) { e.preventDefault(); setZoneDetail(zones[0].zone) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zones])

  // Close popovers on any outside click.
  useEffect(() => {
    if (!zoneMenu && !measureMenu) return
    const close = () => { setZoneMenu(null); setMeasureMenu(null) }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [zoneMenu, measureMenu])

  /** Tint strength for the color-by geometry overlay (NEW-798/799/801/808). */
  const tintFor = useCallback((r: TableRow): string => {
    if (colorBy === 'none') return ''
    const vals = withData.map(x => Number(x[colorBy])).filter(Number.isFinite)
    if (vals.length < 2) return ''
    const min = Math.min(...vals), max = Math.max(...vals)
    const v = Number(r[colorBy])
    if (!Number.isFinite(v) || max === min) return ''
    const cfg = GEOMETRY.find(g => g.key === colorBy)!
    let t = (v - min) / (max - min)
    if (cfg.invert) t = 1 - t // nearer the bar/pool = stronger
    return t > 0.66 ? 'bg-cyan-50' : t > 0.33 ? 'bg-cyan-50/40' : ''
  }, [colorBy, withData])

  if (!restaurantId) return null

  return (
    <div className={`bg-white rounded-2xl border border-gray-200 overflow-hidden ${className}`}>
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-100 rounded-lg">
              <LayoutGrid className="w-5 h-5 text-cyan-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Seating density</h3>
              <p className="text-xs text-gray-500">Sales and check-ins normalized by seats</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowMethodology(s => !s)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 rounded-lg"
              title="How these are computed"
            >
              <Info className="w-3.5 h-3.5" /> Methodology
            </button>
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 rounded-lg disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        </div>

        {/* Measure switcher (NEW-761…368) */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {MEASURES.map(m => (
            <button
              key={m.key}
              onClick={() => setMeasure(m.key)}
              onContextMenu={e => { e.preventDefault(); setMeasureMenu({ key: m.key, x: e.clientX, y: e.clientY }) }}
              title={`Analytics feature #${m.feature} · press d then ${MEASURES.indexOf(m) + 1}`}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                measure === m.key
                  ? 'bg-cyan-50 text-cyan-700 border-cyan-200'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Color-by geometry overlay (NEW-798/799/801) */}
        {geometryStory.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            <span className="text-[11px] text-gray-400 mr-0.5">Tint by</span>
            <button
              onClick={() => setColorBy('none')}
              className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${colorBy === 'none' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200'}`}
            >
              None
            </button>
            {geometryStory.map(g => (
              <button
                key={g.key}
                onClick={() => setColorBy(colorBy === g.key ? 'none' : g.key)}
                title={`Feature #${g.feature} · engine correlation r=${g.correlation!.r.toFixed(2)} (n=${g.correlation!.n})`}
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${colorBy === g.key ? 'bg-cyan-600 text-white border-cyan-600' : 'bg-white text-gray-500 border-gray-200 hover:border-cyan-300'}`}
              >
                {g.label} <span className="font-mono opacity-70">r{g.correlation!.r >= 0 ? '+' : ''}{g.correlation!.r.toFixed(2)}</span>
              </button>
            ))}
          </div>
        )}

        {showMethodology && (
          <div className="mt-3 p-3 bg-gray-50 rounded-xl text-xs text-gray-600 leading-relaxed">
            <p className="font-semibold text-gray-800 mb-1">{active.label} · feature #{active.feature}</p>
            <p>
              Computed per table by the analytics engine from POS checks over the trailing window:
              covers, checks, and revenue divided by that table's seat count. Tables with no checks in
              the window are excluded so they don't drag the medians toward zero. Zone and venue figures
              are medians (not means), so one blowout table doesn't distort the comparison.
            </p>
          </div>
        )}
      </div>

      <div className="p-5">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: `${85 - i * 15}%` }} />
            ))}
          </div>
        ) : withData.length === 0 ? (
          <div className="text-sm text-gray-500">
            No seated-check data yet. Seating density needs a POS check feed with table
            attribution and seat counts —{' '}
            <a href="/settings" className="text-cyan-700 font-medium hover:underline">connect your POS</a>
            {' '}or set seats per table in{' '}
            <a href="/settings" className="text-cyan-700 font-medium hover:underline">table setup</a>.
          </div>
        ) : (
          <>
            {/* Venue-level KPI */}
            <div className="flex items-baseline gap-3 mb-4">
              <span className="text-3xl font-extrabold tracking-tight text-gray-900">
                {venueMedian != null ? active.fmt(venueMedian) : '—'}
              </span>
              <span className="text-xs text-gray-500">
                venue median · {withData.length} table{withData.length === 1 ? '' : 's'} with traffic
              </span>
            </div>

            {/* Zone rollup */}
            <div className="space-y-1.5 mb-4">
              {zones.map(z => {
                const pct = venueMedian && z.median != null && venueMedian > 0
                  ? Math.min(100, (z.median / (venueMedian * 2)) * 100)
                  : 0
                return (
                  <div
                    key={z.zone}
                    onDoubleClick={() => setZoneDetail(zoneDetail === z.zone ? null : z.zone)}
                    onContextMenu={e => { e.preventDefault(); setZoneMenu({ zone: z.zone, x: e.clientX, y: e.clientY }) }}
                    className={`flex items-center gap-3 rounded-lg px-1 py-0.5 ${mutedZones.has(z.zone) ? 'opacity-40' : ''} ${zoneDetail === z.zone ? 'bg-cyan-50/60' : ''}`}
                  >
                    {/* NEW-765/775: pick zones to compare side-by-side */}
                    <input
                      type="checkbox"
                      checked={comparedZones.has(z.zone)}
                      onChange={() => toggleCompare(z.zone)}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-cyan-600 focus:ring-cyan-500 cursor-pointer shrink-0"
                      aria-label={`Compare ${z.zone}`}
                    />
                    <span className="w-24 shrink-0 text-xs font-medium text-gray-700 truncate">{z.zone}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-2 bg-cyan-500 rounded-full" style={{ width: `${Math.max(3, pct)}%` }} />
                    </div>
                    <span className="w-20 shrink-0 text-right text-xs font-mono text-gray-600">
                      {z.median != null ? active.fmt(z.median) : '—'}
                    </span>
                    <span className="w-16 shrink-0 text-right text-[11px] text-gray-400">{z.seats} seats</span>
                  </div>
                )
              })}
            </div>

            {/* Zone compare strip (NEW-765/775/805) */}
            {compareRows.length > 1 && (
              <div className="mb-4 p-3 bg-gray-50 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Comparing {compareRows.length} zones · {active.label}
                  </span>
                  <button onClick={() => setComparedZones(new Set())} className="text-[11px] text-gray-400 hover:text-gray-700">
                    Clear
                  </button>
                </div>
                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(compareRows.length, 4)}, minmax(0, 1fr))` }}>
                  {compareRows.map(z => {
                    const best = Math.max(...compareRows.map(c => c.median ?? 0))
                    const isBest = (z.median ?? 0) === best && best > 0
                    return (
                      <div key={z.zone} className={`p-2 rounded-lg bg-white border ${isBest ? 'border-cyan-300' : 'border-gray-200'}`}>
                        <p className="text-[11px] text-gray-500 truncate">{z.zone}</p>
                        <p className="text-base font-bold text-gray-900">{z.median != null ? active.fmt(z.median) : '—'}</p>
                        <p className="text-[10px] text-gray-400">{z.tables} tables · {z.seats} seats</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Zone drill-down drawer (NEW-796): what drives this zone */}
            {zoneDetail && (() => {
              const z = zones.find(x => x.zone === zoneDetail)
              const tables = withData.filter(r => (r.zone || 'Unzoned') === zoneDetail)
              if (!z) return null
              return (
                <div className="mb-4 p-3 bg-cyan-50/50 border border-cyan-100 rounded-xl">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-gray-900">{z.zone} · drivers</span>
                    <button onClick={() => setZoneDetail(null)} className="text-[11px] text-gray-400 hover:text-gray-700">Close</button>
                  </div>
                  <p className="text-xs text-gray-600 mb-1.5">
                    {z.tables} tables, {z.seats} seats. Median {active.label.toLowerCase()}{' '}
                    <b>{z.median != null ? active.fmt(z.median) : '—'}</b>
                    {venueMedian != null && z.median != null && venueMedian > 0 && (
                      <> · {z.median >= venueMedian ? '+' : ''}{Math.round(((z.median - venueMedian) / venueMedian) * 100)}% vs venue</>
                    )}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    Best: {[...tables].sort((a, b) => Number(b[measure]) - Number(a[measure]))[0]?.label ?? '—'} ·
                    {' '}Weakest: {[...tables].sort((a, b) => Number(a[measure]) - Number(b[measure]))[0]?.label ?? '—'}
                  </p>
                  {drivers && drivers.weights?.length > 0 && (
                    <p className="text-[11px] text-gray-500 mt-1">
                      Venue-wide geometry model (R²{' '}{drivers.r2.toFixed(2)}):{' '}
                      {drivers.weights
                        .slice()
                        .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
                        .slice(0, 3)
                        .map(w => `${w.attribute} ${w.weight >= 0 ? '+' : ''}${w.weight.toFixed(2)}`)
                        .join(' · ')}
                    </p>
                  )}
                </div>
              )
            })()}

            {/* Table-size efficiency (NEW-402) */}
            {sizeBands.length > 1 && (
              <div className="mb-4 flex items-center gap-3 flex-wrap text-[11px]">
                <span className="font-semibold uppercase tracking-wide text-gray-400">By table size</span>
                {sizeBands.map(b => (
                  <span key={b.band} className="px-2 py-0.5 rounded-full bg-gray-50 border border-gray-200 text-gray-600">
                    {b.band}: <b className="font-mono">{b.median != null ? active.fmt(b.median) : '—'}</b>
                    <span className="text-gray-400"> (n={b.n})</span>
                  </span>
                ))}
              </div>
            )}

            {/* Per-table rows with hover comparison (NEW-762) */}
            <div className="border-t border-gray-100 pt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
                Tables
              </div>
              <div className="max-h-56 overflow-y-auto space-y-0.5">
                {[...withData]
                  .sort((a, b) => Number(b[measure]) - Number(a[measure]))
                  .map(r => {
                    const val = Number(r[measure])
                    const zMed = zoneMedianFor(r.zone)
                    const delta = zMed && zMed > 0 ? (val - zMed) / zMed : null
                    return (
                      <div
                        key={r.tableId}
                        onMouseEnter={() => setHovered(r.tableId)}
                        onMouseLeave={() => setHovered(null)}
                        className={`flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-gray-50 ${tintFor(r)}`}
                      >
                        <span className="w-20 shrink-0 text-xs font-medium text-gray-800 truncate">{r.label}</span>
                        <span className="w-24 shrink-0 text-[11px] text-gray-400 truncate">{r.zone || 'Unzoned'}</span>
                        <span className="flex-1 text-xs font-mono text-gray-700">{active.fmt(val)}</span>
                        {hovered === r.tableId && delta != null && (
                          <span className={`text-[11px] font-medium ${delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {delta >= 0 ? '+' : ''}{Math.round(delta * 100)}% vs zone median
                          </span>
                        )}
                        <span className="w-14 shrink-0 text-right text-[11px] text-gray-400">{r.seats} seats</span>
                      </div>
                    )
                  })}
              </div>
            </div>

            {/* Over / under-utilization flags (NEW-371 / NEW-372) */}
            {(outliers.over.length > 0 || outliers.under.length > 0) && (
              <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
                {outliers.under.length > 0 && (
                  <p className="flex items-start gap-1.5 text-xs text-amber-700">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>
                      <b>{outliers.under.length}</b> table{outliers.under.length === 1 ? '' : 's'} at or below half the
                      venue median ({outliers.under.slice(0, 3).map(r => r.label).join(', ')}
                      {outliers.under.length > 3 ? '…' : ''}) — under-utilized seats.
                    </span>
                  </p>
                )}
                {outliers.over.length > 0 && (
                  <p className="flex items-start gap-1.5 text-xs text-gray-600">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-600" />
                    <span>
                      <b>{outliers.over.length}</b> table{outliers.over.length === 1 ? '' : 's'} at 1.5× the venue median
                      ({outliers.over.slice(0, 3).map(r => r.label).join(', ')}
                      {outliers.over.length > 3 ? '…' : ''}) — your density benchmark.
                    </span>
                  </p>
                )}
              </div>
            )}

            {/* Act (NEW-763): jump to the engine's table/zone insight types */}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
              <a
                href="/recommendations/catalog?dim=table"
                className="text-xs font-medium text-gray-500 hover:text-gray-800"
              >
                Browse table insight types
              </a>
              <a
                href="/recommendations"
                className="flex items-center gap-1 text-xs font-medium text-cyan-700 hover:underline"
              >
                Act on seating insights <ArrowRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </>
        )}
      </div>

      {/* Measure right-click menu (NEW-767) */}
      {measureMenu && (() => {
        const m = MEASURES.find(x => x.key === measureMenu.key)!
        const Item = ({ label, onClick }: { label: string; onClick: () => void }) => (
          <button onClick={onClick} className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 rounded-lg">
            {label}
          </button>
        )
        return (
          <div
            className="fixed z-[60] w-52 bg-white border border-gray-200 rounded-xl shadow-xl p-1"
            style={{ top: Math.min(measureMenu.y, window.innerHeight - 180), left: Math.min(measureMenu.x, window.innerWidth - 220) }}
            onClick={e => e.stopPropagation()}
          >
            <Item label="Show this measure" onClick={() => { setMeasure(m.key); setMeasureMenu(null) }} />
            <Item label="Export as CSV" onClick={() => { setMeasure(m.key); exportMeasureCsv(); setMeasureMenu(null) }} />
            <Item label="Open methodology" onClick={() => { setMeasure(m.key); setShowMethodology(true); setMeasureMenu(null) }} />
            <Item label="Browse table insight types" onClick={() => { window.location.href = '/recommendations/catalog?dim=table'; setMeasureMenu(null) }} />
          </div>
        )
      })()}

      {/* Zone right-click menu (NEW-797) */}
      {zoneMenu && (() => {
        const muted = mutedZones.has(zoneMenu.zone)
        const Item = ({ label, onClick }: { label: string; onClick: () => void }) => (
          <button onClick={onClick} className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 rounded-lg">
            {label}
          </button>
        )
        return (
          <div
            className="fixed z-[60] w-52 bg-white border border-gray-200 rounded-xl shadow-xl p-1"
            style={{ top: Math.min(zoneMenu.y, window.innerHeight - 180), left: Math.min(zoneMenu.x, window.innerWidth - 220) }}
            onClick={e => e.stopPropagation()}
          >
            <Item label="Open zone detail" onClick={() => { setZoneDetail(zoneMenu.zone); setZoneMenu(null) }} />
            <Item
              label={comparedZones.has(zoneMenu.zone) ? 'Remove from compare' : 'Add to compare'}
              onClick={() => { toggleCompare(zoneMenu.zone); setZoneMenu(null) }}
            />
            <Item
              label={muted ? 'Unmute zone' : 'Mute zone'}
              onClick={() => {
                setMutedZones(prev => {
                  const next = new Set(prev)
                  if (next.has(zoneMenu.zone)) next.delete(zoneMenu.zone)
                  else next.add(zoneMenu.zone)
                  return next
                })
                setZoneMenu(null)
              }}
            />
            <Item label="Open in Inventory" onClick={() => { window.location.href = '/inventory'; setZoneMenu(null) }} />
          </div>
        )
      })()}
    </div>
  )
}
