/**
 * DailyBreakdownTable - Molecule Component
 * Daily PURCHASE-order breakdown with wine type visualization. The money column
 * is vendor spend from `procurement_orders`, not sales revenue.
 */

import { BarChart3 } from 'lucide-react'
import { CollapsibleSection, WineTypeBar, WineTypeData } from '../atoms'

interface DailyData extends WineTypeData {
  date: string
  fullDate: string
  /** Vendor spend for the day (procurement_orders), not sales revenue. */
  spend: number
  orders: number
  bottles: number
  avgOrderValue: number
}

interface DailyBreakdownTableProps {
  data: DailyData[]
  isOpen: boolean
  onToggle: () => void
  className?: string
}

export function DailyBreakdownTable({
  data,
  isOpen,
  onToggle,
  className = '',
}: DailyBreakdownTableProps) {
  return (
    <CollapsibleSection
      title="Daily Breakdown"
      subtitle="Detailed daily purchasing data"
      icon={BarChart3}
      isOpen={isOpen}
      onToggle={onToggle}
      className={className}
    >
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left py-3 px-4 text-sm font-semibold text-gray-900">Date</th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-gray-900">Vendor Spend</th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-gray-900 min-w-[120px]">
                <div className="flex items-center justify-end gap-2">
                  <span>Orders Volume</span>
                  <div className="flex gap-0.5">
                    <div className="w-2 h-2 rounded bg-rose-600" title="Red" />
                    <div className="w-2 h-2 rounded bg-amber-400" title="White" />
                    <div className="w-2 h-2 rounded bg-yellow-300" title="Sparkling" />
                    <div className="w-2 h-2 rounded bg-pink-400" title="Rosé" />
                    <div className="w-2 h-2 rounded bg-purple-500" title="Dessert" />
                  </div>
                </div>
              </th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-gray-900">Bottles</th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-gray-900">Avg Order</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.slice(-14).reverse().map((day) => (
              <tr key={day.fullDate} className="hover:bg-gray-50">
                <td className="py-3 px-4 text-sm text-gray-900 font-medium">{day.date}</td>
                <td className="py-3 px-4 text-sm font-semibold text-gray-900 text-right">
                  ${day.spend.toLocaleString()}
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-32">
                      <WineTypeBar data={day} showLabels height="md" />
                    </div>
                    <span className="text-xs text-gray-500 w-8 text-right">{day.orders}</span>
                  </div>
                </td>
                <td className="py-3 px-4 text-sm text-gray-600 text-right font-medium">{day.bottles}</td>
                <td className="py-3 px-4 text-sm text-gray-600 text-right">
                  ${day.avgOrderValue}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  )
}

export type { DailyData }
