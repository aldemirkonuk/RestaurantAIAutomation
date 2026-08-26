/**
 * LaborSpendOverlay — dual-line chart comparing vendor SPEND vs. labour cost.
 *
 * The money series comes from `procurement_orders` (what the restaurant pays
 * its vendors), not from POS sales. Labour is a crude estimate at ~28% of that
 * spend, so treat this as a cost-side comparison only. A true labour-vs-revenue
 * chart needs `pos_checks` and is not wired yet.
 */

import { LineChart } from '@tremor/react'
import { formatMoney } from '../../../lib/utils'

interface PurchaseDay {
  date: string
  /** Vendor spend for the day (procurement_orders), not sales revenue. */
  spend: number
}

interface Props {
  purchaseDayData: PurchaseDay[]
  className?: string
}

const LABOR_RATIO = 0.28

export function LaborSpendOverlay({ purchaseDayData, className = '' }: Props) {
  const data = purchaseDayData.map((d) => ({
    date: d.date,
    'Vendor Spend': d.spend,
    Labor: Math.round(d.spend * LABOR_RATIO),
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
          Vendor Spend
        </span>
        <span className="flex items-center gap-1 text-[11px] text-gray-500">
          <span className="inline-block w-5 h-0.5 bg-amber-400 rounded" style={{ borderTop: '2px dashed #fbbf24' }} />
          Labor (est.)
        </span>
      </div>
      <LineChart
        data={data}
        index="date"
        categories={['Vendor Spend', 'Labor']}
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
