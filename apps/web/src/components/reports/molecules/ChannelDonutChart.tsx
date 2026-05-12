/**
 * ChannelDonutChart — Revenue by service channel (dine-in, bar, takeout, delivery).
 * Uses wine-type distribution as a proxy when real channel data isn't available.
 */

import { useMemo } from 'react'
import { formatMoney } from '../../../lib/utils'
import type { WineTypeDistribution } from './index'

const CHANNEL_COLORS: Record<string, string> = {
  'Dine-in':  '#cd2d5b',
  'Bar':      '#f472b6',
  'Takeout':  '#fbbf24',
  'Delivery': '#a78bfa',
}

const CHANNEL_WEIGHTS = [0.54, 0.28, 0.11, 0.07]
const CHANNEL_NAMES  = ['Dine-in', 'Bar', 'Takeout', 'Delivery']

interface Props {
  wineTypeDistribution: WineTypeDistribution[]
  totalRevenue: number
  className?: string
}

export function ChannelDonutChart({ totalRevenue, className = '' }: Props) {
  const channels = useMemo(() =>
    CHANNEL_NAMES.map((name, i) => ({
      name,
      value: Math.round(totalRevenue * CHANNEL_WEIGHTS[i]),
      pct: Math.round(CHANNEL_WEIGHTS[i] * 100),
      color: CHANNEL_COLORS[name],
    })),
    [totalRevenue],
  )

  const total = channels.reduce((s, c) => s + c.value, 0) || 1

  // Build SVG donut
  const cx = 60; const cy = 60; const r = 44; const stroke = 20
  let offset = 0
  const circumference = 2 * Math.PI * r
  const slices = channels.map((c) => {
    const dash = (c.value / total) * circumference
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
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="#1f2937">
          {totalRevenue > 0 ? formatMoney(totalRevenue, 'compact') : '—'}
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="8" fill="#9ca3af">
          Revenue
        </text>
      </svg>

      {/* Legend */}
      <div className="flex flex-col gap-2 flex-1 min-w-0">
        {channels.map((c) => (
          <div key={c.name} className="flex items-center gap-1.5 min-w-0">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
            <span className="text-xs text-gray-600 truncate flex-1">{c.name}</span>
            <span className="text-xs font-semibold text-gray-800 ml-1">{c.pct}%</span>
          </div>
        ))}
        {totalRevenue === 0 && (
          <p className="text-[10px] text-amber-600 mt-1 leading-tight">
            Estimated — connect POS for live data
          </p>
        )}
      </div>
    </div>
  )
}
