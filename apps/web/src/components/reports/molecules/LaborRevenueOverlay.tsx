/**
 * LaborRevenueOverlay — dual-line chart comparing revenue vs. labour cost.
 * Labour is estimated at ~28% of revenue when real data isn't available.
 */

import { LineChart } from '@tremor/react'
import { formatMoney } from '../../../lib/utils'

interface SalesDay {
  date: string
  revenue: number
}

interface Props {
  salesData: SalesDay[]
  className?: string
}

const LABOR_RATIO = 0.28

export function LaborRevenueOverlay({ salesData, className = '' }: Props) {
  const data = salesData.map((d) => ({
    date: d.date,
    Revenue: d.revenue,
    Labor: Math.round(d.revenue * LABOR_RATIO),
  }))

  if (!data.length) {
    return (
      <div className={`flex items-center justify-center h-full text-sm text-gray-400 ${className}`}>
        No data yet
      </div>
    )
  }

  return (
    <div className={`h-full flex flex-col ${className}`}>
      <div className="flex items-center gap-4 mb-1 px-1">
        <span className="flex items-center gap-1 text-[11px] text-gray-500">
          <span className="inline-block w-5 h-0.5 bg-wine-600 rounded" />
          Revenue
        </span>
        <span className="flex items-center gap-1 text-[11px] text-gray-500">
          <span className="inline-block w-5 h-0.5 bg-amber-400 rounded" style={{ borderTop: '2px dashed #fbbf24' }} />
          Labor (est.)
        </span>
      </div>
      <LineChart
        data={data}
        index="date"
        categories={['Revenue', 'Labor']}
        colors={['rose', 'amber']}
        valueFormatter={(v) => formatMoney(v, 'compact')}
        showLegend={false}
        showGridLines
        showYAxis
        curveType="monotone"
        showAnimation
        className="flex-1 h-full"
      />
    </div>
  )
}
