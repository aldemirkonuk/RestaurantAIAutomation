/**
 * Shared primitives for the Inventory Command page (sketch 038 production port).
 * Pure presentational pieces: stock gauge, sparkline, heatmap, chips, KPI cell.
 */
import { classifyStock } from '../../../lib/inventoryStatus'
import { cn } from '../../../lib/utils'
import type { InventoryItem } from '../useInventoryPage'

export const fmtMoney = (n?: number | null) =>
  n == null || !Number.isFinite(n) ? '-' : `$${Math.round(n).toLocaleString()}`

export const fmtMoneyExact = (n?: number | null) =>
  n == null || !Number.isFinite(n) ? '-' : `$${n.toFixed(2)}`

/** Effective runway in days (live stock / velocity). null = unknown/no velocity. */
export function runwayDays(item: InventoryItem): number | null {
  if (item.daysOfCover != null && Number.isFinite(item.daysOfCover)) return item.daysOfCover
  const v = item.velocityPerDay ?? 0
  if (!(v > 0) || item.liveStock == null) return null
  return item.liveStock / v
}

export function marketDeltaPct(item: InventoryItem): number | null {
  const paid = item.wac ?? item.price
  if (!paid || !item.marketPrice) return null
  return ((item.marketPrice - paid) / paid) * 100
}

/** Days since the last verified count; null when never counted. */
export function daysSinceCounted(item: InventoryItem): number | null {
  if (!item.lastCounted) return null
  const ms = Date.now() - new Date(item.lastCounted).getTime()
  return Math.floor(ms / 86_400_000)
}

export const COUNT_DUE_DAYS = 21

export type RowFlag = 'low' | 'recon' | 'count' | 'dead' | 'price'

export function rowFlags(item: InventoryItem): RowFlag[] {
  const flags: RowFlag[] = []
  const status = classifyStock(item.liveStock, item.threshold)
  if (status.key === 'low' || status.key === 'critical') flags.push('low')
  if ((item.shadowStock ?? 0) > 0) flags.push('recon')
  const counted = daysSinceCounted(item)
  if (counted == null || counted > COUNT_DUE_DAYS) flags.push('count')
  if (item.deadStock) flags.push('dead')
  const delta = marketDeltaPct(item)
  if (delta != null && (delta >= 15 || delta <= -5)) flags.push('price')
  return flags
}

// ── Stock gauge (3a signature) ────────────────────────────────────────────────

export function StockGauge({ item, compact }: { item: InventoryItem; compact?: boolean }) {
  const live = item.liveStock ?? 0
  const shadow = item.shadowStock ?? 0
  const par = item.threshold > 0 ? item.threshold : 1
  const scale = Math.max(live + shadow, par * 1.5, 1)
  const status = classifyStock(item.liveStock, item.threshold)
  const numColor =
    status.key === 'critical' ? 'text-rose-600' : status.key === 'low' ? 'text-amber-600' : 'text-gray-900'

  return (
    <div>
      <div className="flex items-baseline gap-1.5 font-mono">
        <span className={cn('text-sm font-bold', numColor)}>{live + shadow}</span>
        <span className="text-[10px] text-gray-400">/ {item.threshold} par</span>
        {shadow > 0 && (
          <span className="ml-auto text-[9px] font-bold tracking-wide text-violet-600 bg-violet-50 rounded-full px-2 py-px">
            RECONCILE
          </span>
        )}
      </div>
      <div className="relative flex h-1.5 my-1 bg-gray-100 rounded-full">
        <div className="h-full bg-blue-600 rounded-l-full" style={{ width: `${(live / scale) * 100}%` }} />
        {shadow > 0 && <div className="h-full bg-violet-600" style={{ width: `${(shadow / scale) * 100}%` }} />}
        <div
          className="absolute -top-1 w-0.5 h-3.5 bg-gray-900/60 rounded"
          style={{ left: `${Math.min((par / scale) * 100, 100)}%` }}
        />
      </div>
      {!compact && (
        <div className="flex gap-2.5 font-mono text-[9px]">
          <span className="text-blue-600">{live} live</span>
          <span className={shadow > 0 ? 'text-violet-600' : 'text-gray-300'}>{shadow} shadow</span>
        </div>
      )}
    </div>
  )
}

// ── Sparkline (7 bars from daily activity tail) ──────────────────────────────

export function Sparkline({ series }: { series: number[] }) {
  const max = Math.max(...series, 1)
  return (
    <div className="flex items-end gap-0.5 h-5 mb-0.5">
      {series.map((v, i) => (
        <i
          key={i}
          className={cn('block w-[5px] rounded-t-sm', v >= max * 0.75 ? 'bg-wine-600' : 'bg-wine-200')}
          style={{ height: `${Math.max((v / max) * 100, 8)}%` }}
        />
      ))}
    </div>
  )
}

// ── Busy-hours heatmap ────────────────────────────────────────────────────────

const HEAT_SHADES = ['#FDF7F6', '#FAEDEC', '#F3D4D2', '#E5A9A8', '#D07072', '#9E4249']
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const SLOTS = ['4p', '5p', '6p', '7p', '8p', '9p', '10p', '11p']

export function HoursHeatmap({ heat }: { heat: number[][] }) {
  const max = Math.max(1, ...heat.flat())
  return (
    <div className="grid gap-[3px] items-center" style={{ gridTemplateColumns: '30px repeat(8, 1fr)' }}>
      <div />
      {SLOTS.map((s) => (
        <div key={s} className="font-mono text-[9px] text-gray-400 text-center">{s}</div>
      ))}
      {heat.map((row, d) => (
        [
          <div key={`l${d}`} className="font-mono text-[9px] text-gray-400 text-right pr-1">{DOW[d]}</div>,
          ...row.map((v, h) => (
            <div
              key={`${d}-${h}`}
              className="h-4 rounded"
              title={`${DOW[d]} ${SLOTS[h]}: ${v}`}
              style={{ background: HEAT_SHADES[Math.min(5, Math.ceil((v / max) * 5))] }}
            />
          )),
        ]
      ))}
    </div>
  )
}

// ── Status chip ───────────────────────────────────────────────────────────────

export function StatusChip({ item }: { item: InventoryItem }) {
  const s = classifyStock(item.liveStock, item.threshold)
  const shadow = item.shadowStock ?? 0
  const counted = daysSinceCounted(item)

  if (s.key === 'critical')
    return <span className="text-[11px] font-semibold rounded-full px-2.5 py-1 bg-rose-50 text-rose-600 whitespace-nowrap">Critical</span>
  if (s.key === 'low')
    return <span className="text-[11px] font-semibold rounded-full px-2.5 py-1 bg-amber-50 text-amber-600 whitespace-nowrap">Below par</span>
  if (shadow > 0)
    return <span className="text-[11px] font-semibold rounded-full px-2.5 py-1 bg-violet-50 text-violet-600 whitespace-nowrap">Reconcile {shadow}</span>
  if (item.deadStock)
    return <span className="text-[11px] font-semibold rounded-full px-2.5 py-1 border border-dashed border-gray-300 text-gray-500 whitespace-nowrap">No sale {item.daysSinceSale ?? '30+'}d</span>
  if (counted == null || counted > COUNT_DUE_DAYS)
    return <span className="text-[11px] font-semibold rounded-full px-2.5 py-1 bg-gray-100 text-gray-600 whitespace-nowrap">Count due{counted != null ? `, ${counted}d` : ''}</span>
  return <span className="text-[11px] font-semibold rounded-full px-2.5 py-1 bg-emerald-50 text-emerald-600 whitespace-nowrap">Healthy</span>
}

export function AbcBadge({ abc }: { abc?: 'A' | 'B' | 'C' }) {
  if (!abc) return null
  const styles = {
    A: 'bg-wine-100 text-wine-700',
    B: 'bg-gray-100 text-gray-500',
    C: 'bg-gray-50 text-gray-400 border border-gray-100',
  }
  return <span className={cn('font-mono text-[9px] font-bold rounded px-1.5 py-px', styles[abc])}>{abc}</span>
}

export function TypeChip({ type }: { type?: string }) {
  const t = (type || '').toLowerCase()
  const styles: Record<string, string> = {
    red: 'bg-rose-50 text-rose-800',
    white: 'bg-yellow-50 text-yellow-800',
    sparkling: 'bg-blue-50 text-blue-800',
    rose: 'bg-pink-50 text-pink-700',
    'rosé': 'bg-pink-50 text-pink-700',
    dessert: 'bg-orange-50 text-orange-700',
  }
  const label = t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Wine'
  return <span className={cn('text-[11px] font-semibold rounded-md px-2 py-0.5', styles[t] || 'bg-gray-100 text-gray-600')}>{label}</span>
}

// ── KPI cell ─────────────────────────────────────────────────────────────────

export function Kpi({ label, value, sub, tone, onClick, active }: { label: string; value: string | number; sub?: string; tone?: 'blue' | 'violet' | 'green' | 'amber' | 'red'; onClick?: () => void; active?: boolean }) {
  const tones = { blue: 'text-blue-600', violet: 'text-violet-600', green: 'text-emerald-600', amber: 'text-amber-600', red: 'text-rose-600' }
  const inner = (
    <>
      <div className="text-[11px] font-semibold text-gray-400 mb-1.5">{label}</div>
      <div className={cn('text-xl font-extrabold leading-none tracking-tight', tone ? tones[tone] : 'text-gray-900')}>{value}</div>
      {sub && <div className="text-[10.5px] text-gray-400 mt-1">{sub}</div>}
    </>
  )
  if (onClick) {
    return (
      <button
        onClick={onClick}
        aria-pressed={active}
        className={cn(
          'bg-white border rounded-xl px-3.5 py-3 text-left transition-colors hover:border-gray-300',
          active ? 'border-wine-500 ring-1 ring-wine-200' : 'border-gray-100',
        )}
      >
        {inner}
      </button>
    )
  }
  return <div className="bg-white border border-gray-100 rounded-xl px-3.5 py-3">{inner}</div>
}
