/**
 * ChannelDonutChart — POS sales split across service channels.
 *
 * Two separate honesty problems were live here, and only one of them is fixed.
 *
 * FIXED: the total used to be vendor SPEND from `procurement_orders`. Slicing
 * money paid to suppliers into "Dine-in / Bar / Takeout / Delivery" is category
 * nonsense — those are ways guests buy, not ways the restaurant buys. The total
 * is now POS sales revenue, and without a POS the chart renders nothing at all
 * rather than dressing purchasing data as a sales mix.
 *
 * NOT FIXED, and cannot be: the SPLIT is still a hard-coded weighting.
 * `pos_checks` has no channel, service-type or order-source column (see
 * supabase/migrations/20260805000000_baseline_from_production.sql:4192), so
 * there is nothing to derive a real mix from even with a POS fully connected.
 * Per OD-85 the choice was "leave it labelled (est.) or remove it" — it is
 * labelled, on every slice, unconditionally. The old code showed the caveat
 * ONLY when the total was zero, i.e. it went quiet exactly when there were
 * numbers on screen to be wrong about.
 *
 * Making this real needs a channel column on `pos_checks` and an adapter that
 * populates it.
 */

import { useMemo } from 'react'
import { formatMoney } from '../../../lib/utils'

const CHANNEL_COLORS: Record<string, string> = {
  'Dine-in':  '#9E4249',
  'Bar':      '#f472b6',
  'Takeout':  '#fbbf24',
  'Delivery': '#a78bfa',
}

/** Industry rule-of-thumb weighting. Not measured — see the file comment. */
const CHANNEL_WEIGHTS = [0.54, 0.28, 0.11, 0.07]
const CHANNEL_NAMES  = ['Dine-in', 'Bar', 'Takeout', 'Delivery']

interface Props {
  /** Sales revenue for the window from `pos_checks`. Null when no POS. */
  posRevenue: number | null
  /** False when this restaurant has never had a POS check land. */
  posConnected: boolean
  className?: string
}

export function ChannelDonutChart({ posRevenue, posConnected, className = '' }: Props) {
  const total = posConnected && posRevenue != null ? posRevenue : null

  const channels = useMemo(
    () =>
      CHANNEL_NAMES.map((name, i) => ({
        name,
        value: total == null ? 0 : Math.round(total * CHANNEL_WEIGHTS[i]),
        pct: Math.round(CHANNEL_WEIGHTS[i] * 100),
        color: CHANNEL_COLORS[name],
      })),
    [total],
  )

  if (total == null) {
    return (
      <div className={`flex flex-col items-center justify-center h-full text-center px-4 ${className}`}>
        <p className="text-sm font-medium text-gray-500">No POS connected</p>
        <p className="text-xs text-gray-400 mt-1 leading-snug">
          Channel mix is a split of sales. Connect a POS to see it.
        </p>
      </div>
    )
  }

  const sliceTotal = channels.reduce((s, c) => s + c.value, 0) || 1

  // Build SVG donut
  const cx = 60; const cy = 60; const r = 44; const stroke = 20
  let offset = 0
  const circumference = 2 * Math.PI * r
  const slices = channels.map((c) => {
    const dash = (c.value / sliceTotal) * circumference
    const gap  = circumference - dash
    const slice = { ...c, dash, gap, offset }
    offset += dash
    return slice
  })

  return (
    <div className={`flex items-center gap-4 h-full overflow-hidden ${className}`}>
      {/* SVG donut */}
      <svg width={120} height={120} className="flex-shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f3f4f6" strokeWidth={stroke} />
        {slices.map((s) => (
          <circle
            key={s.name}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={stroke}
            strokeDasharray={`${s.dash} ${s.gap}`}
            strokeDashoffset={-s.offset + circumference / 4}
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />
        ))}
        {/* The centre figure is the one measured number on this chart. */}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="#1f2937">
          {formatMoney(total, 'compact')}
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="8" fill="#9ca3af">
          Sales
        </text>
      </svg>

      {/* Legend */}
      <div className="flex flex-col gap-2 flex-1 min-w-0">
        {channels.map((c) => (
          <div key={c.name} className="flex items-center gap-1.5 min-w-0">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
            <span className="text-xs text-gray-600 truncate flex-1">{c.name} (est.)</span>
            <span className="text-xs font-semibold text-gray-800 ml-1">{c.pct}%</span>
          </div>
        ))}
        {/* Always shown. The percentages above are never measured. */}
        <p className="text-[10px] text-amber-600 mt-1 leading-tight">
          Split is estimated, not measured — the POS records no channel
        </p>
      </div>
    </div>
  )
}
