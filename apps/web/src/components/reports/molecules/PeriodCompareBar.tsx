/**
 * PeriodCompareBar — day-by-day swatch bars comparing current vs previous period.
 * Appears below any chart that receives showComparison=true.
 */

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { formatMoney, formatNumber } from '../../../lib/utils'

interface DayData {
  date: string
  value: number
}

interface Props {
  currentData: DayData[]
  metric?: 'spend' | 'orders' | 'bottles'
  className?: string
}

function mockPrevious(data: DayData[]): DayData[] {
  return data.map((d) => ({
    date: d.date,
    value: Math.round(d.value * (0.75 + Math.random() * 0.45)),
  }))
}

export function PeriodCompareBar({ currentData, metric = 'spend', className = '' }: Props) {
  const prevData = useMemo(() => mockPrevious(currentData), [currentData])

  const maxVal = useMemo(
    () => Math.max(...currentData.map((d) => d.value), ...prevData.map((d) => d.value), 1),
    [currentData, prevData],
  )

  const fmt = (v: number) =>
    metric === 'spend' ? formatMoney(v, 'compact') : formatNumber(v, 'compact')

  const totalCurrent = currentData.reduce((s, d) => s + d.value, 0)
  const totalPrev    = prevData.reduce((s, d) => s + d.value, 0)
  const changePct    = totalPrev > 0 ? Math.round(((totalCurrent - totalPrev) / totalPrev) * 100) : 0

  return (
    <div className={`space-y-1.5 ${className}`}>
      {/* Label row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-[10px] text-gray-500">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-2 rounded-sm bg-wine-500" />
            This period
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-2 rounded-sm bg-gray-200" />
            Previous
          </span>
        </div>
        <span className={`text-[11px] font-semibold ${changePct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          {changePct >= 0 ? '↑' : '↓'} {Math.abs(changePct)}% vs prev
        </span>
      </div>

      {/* Swatch grid */}
      <div className="flex gap-0.5 items-end">
        {currentData.map((d, i) => {
          const curH = (d.value / maxVal) * 36
          const preH = (prevData[i].value / maxVal) * 36
          const isUp = d.value >= prevData[i].value
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative" title={`${d.date}: ${fmt(d.value)} (prev: ${fmt(prevData[i].value)})`}>
              {/* Tooltip */}
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                <div className="bg-gray-800 text-white text-[9px] rounded px-1.5 py-0.5 whitespace-nowrap">
                  {d.date}: {fmt(d.value)}
                  <br />
                  Prev: {fmt(prevData[i].value)}
                </div>
                <div className="w-1.5 h-1.5 bg-gray-800 rotate-45 -mt-1" />
              </div>

              {/* Current bar */}
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: curH }}
                transition={{ delay: i * 0.02, duration: 0.3 }}
                className={`w-full rounded-t-[2px] ${isUp ? 'bg-wine-500' : 'bg-wine-300'}`}
                style={{ minHeight: 2 }}
              />
              {/* Previous bar (ghost) */}
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: preH }}
                transition={{ delay: i * 0.02 + 0.1, duration: 0.3 }}
                className="w-full rounded-t-[2px] bg-gray-200"
                style={{ minHeight: 2 }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
