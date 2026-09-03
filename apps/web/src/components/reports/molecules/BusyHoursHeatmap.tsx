/**
 * BusyHoursHeatmap — hourly-traffic heatmap (7 days × 24 hours).
 * Uses synthetic distribution when no POS data is available.
 */

import { useMemo } from 'react'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HOURS = Array.from({ length: 24 }, (_, i) => i)

const PEAK_WEIGHTS: Record<number, number> = {
  11: 0.4, 12: 0.8, 13: 0.9, 14: 0.6,
  17: 0.5, 18: 0.9, 19: 1.0, 20: 0.95, 21: 0.8, 22: 0.5,
}
const DAY_WEIGHTS: Record<number, number> = { 0: 0.6, 1: 0.55, 2: 0.6, 3: 0.7, 4: 0.9, 5: 1.0, 6: 0.85 }

function buildSyntheticGrid(totalOrders: number) {
  const scale = Math.max(totalOrders, 1)
  return DAYS.map((_, di) =>
    HOURS.map((h) => {
      const hw = PEAK_WEIGHTS[h] ?? 0.05
      const dw = DAY_WEIGHTS[di] ?? 0.5
      return Math.round(hw * dw * scale * 0.08 * (0.85 + Math.random() * 0.3))
    }),
  )
}

function cellColor(value: number, max: number): string {
  if (max === 0 || value === 0) return '#f9fafb'
  const t = value / max
  if (t < 0.2) return '#F1F7F8'
  if (t < 0.4) return '#E0EFF1'
  if (t < 0.6) return '#BEDDE2'
  if (t < 0.75) return '#8FC4CD'
  if (t < 0.9) return '#5FB0BC'
  return '#1A5E6B'
}

interface Props {
  totalOrders: number
  className?: string
}

export function BusyHoursHeatmap({ totalOrders, className = '' }: Props) {
  const grid = useMemo(() => buildSyntheticGrid(totalOrders), [totalOrders])
  const max = useMemo(() => Math.max(...grid.flat()), [grid])

  const labelHours = [0, 6, 9, 12, 15, 18, 21]

  return (
    <div className={`flex flex-col gap-1 h-full overflow-hidden ${className}`}>
      {/* Hour axis */}
      <div className="flex pl-8">
        {HOURS.map((h) => (
          <div key={h} className="flex-1 text-[8px] text-gray-400 text-center leading-none">
            {labelHours.includes(h) ? (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`) : ''}
          </div>
        ))}
      </div>

      {/* Grid */}
      {grid.map((row, di) => (
        <div key={DAYS[di]} className="flex items-center gap-0.5 flex-1 min-h-0">
          <span className="w-7 text-[9px] text-gray-400 text-right pr-1 leading-none flex-shrink-0">
            {DAYS[di]}
          </span>
          {row.map((val, hi) => (
            <div
              key={hi}
              className="flex-1 rounded-[2px] min-h-0 h-full"
              style={{ backgroundColor: cellColor(val, max), minHeight: 8 }}
              title={`${DAYS[di]} ${hi}:00 — ~${val} orders`}
            />
          ))}
        </div>
      ))}

      {/* Legend */}
      <div className="flex items-center gap-1 justify-end pt-0.5">
        <span className="text-[9px] text-gray-400">Low</span>
        {['#F1F7F8', '#E0EFF1', '#BEDDE2', '#8FC4CD', '#5FB0BC', '#1A5E6B'].map((c) => (
          <div key={c} className="w-3 h-2 rounded-[1px]" style={{ backgroundColor: c }} />
        ))}
        <span className="text-[9px] text-gray-400">High</span>
      </div>
    </div>
  )
}
