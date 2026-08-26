/**
 * LaborSpendOverlay — vendor spend vs. sales revenue, with a labour estimate.
 *
 * What changed (OD-85): this used to plot ONE real series (vendor spend from
 * `procurement_orders`) and one invented one — labour at 28% of that spend.
 * The invention was not just unverified, it was applied to the wrong base:
 * labour cost is a share of SALES, and a restaurant that buys heavily in a
 * quiet week would have shown a labour spike it never had.
 *
 * Now: sales revenue comes from `pos_checks` (GET /analytics/pos-revenue), and
 * the 28% heuristic is applied to that — the base it is actually a rule of
 * thumb about. It is still an estimate and still says so on the legend.
 *
 * Without a POS there is no defensible base, so the labour line is ABSENT
 * rather than guessed. A real labour series needs scheduling/payroll data,
 * which this product does not hold.
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
  /** Real POS revenue keyed by the same short date label as purchaseDayData. */
  posRevenueByDate: Record<string, number>
  /** False when this restaurant has never had a POS check land. */
  posConnected: boolean
  className?: string
}

/** Industry rule of thumb, applied to revenue — never to purchasing spend. */
const LABOR_RATIO_OF_REVENUE = 0.28

export function LaborSpendOverlay({
  purchaseDayData,
  posRevenueByDate,
  posConnected,
  className = '',
}: Props) {
  const data = purchaseDayData.map((d) => {
    const revenue = posRevenueByDate[d.date] ?? 0
    return posConnected
      ? {
          date: d.date,
          'Vendor Spend': d.spend,
          'Sales Revenue': revenue,
          Labor: Math.round(revenue * LABOR_RATIO_OF_REVENUE),
        }
      : { date: d.date, 'Vendor Spend': d.spend }
  })

  if (!data.length) {
    return (
      <div className={`flex items-center justify-center h-full text-sm text-gray-400 ${className}`}>
        No data yet
      </div>
    )
  }

  const categories = posConnected
    ? ['Vendor Spend', 'Sales Revenue', 'Labor']
    : ['Vendor Spend']

  return (
    <div className={`h-full flex flex-col ${className}`}>
      <div className="flex items-center gap-4 mb-1 px-1 flex-wrap">
        <span className="flex items-center gap-1 text-[11px] text-gray-500">
          <span className="inline-block w-5 h-0.5 bg-wine-600 rounded" />
          Vendor Spend
        </span>
        {posConnected ? (
          <>
            <span className="flex items-center gap-1 text-[11px] text-gray-500">
              <span className="inline-block w-5 h-0.5 bg-emerald-500 rounded" />
              Sales Revenue
            </span>
            <span className="flex items-center gap-1 text-[11px] text-gray-500">
              <span
                className="inline-block w-5 h-0.5 bg-amber-400 rounded"
                style={{ borderTop: '2px dashed #fbbf24' }}
              />
              Labor (est. 28% of revenue)
            </span>
          </>
        ) : (
          <span className="text-[11px] text-amber-600">
            Sales revenue and the labour estimate need a POS — connect a POS to
            see them
          </span>
        )}
      </div>
      <LineChart
        data={data}
        index="date"
        categories={categories}
        colors={posConnected ? ['rose', 'emerald', 'amber'] : ['rose']}
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
