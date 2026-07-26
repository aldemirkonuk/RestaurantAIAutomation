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

import { useCallback, useEffect, useMemo, useState } from 'react'
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

  const load = useCallback(async (refresh = false) => {
    if (!restaurantId) return
    if (refresh) setRefreshing(true)
    try {
      const res = await fetch(`${API_URL}/api/v1/analytics/table-performance/${restaurantId}`)
      if (res.ok) {
        const body = await res.json()
        setRows(Array.isArray(body?.tables) ? body.tables : Array.isArray(body) ? body : [])
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
              title={`Analytics feature #${m.feature}`}
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
                  <div key={z.zone} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-xs font-medium text-gray-700 truncate">{z.zone}</span>
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
                        className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-gray-50"
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
    </div>
  )
}
