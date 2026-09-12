/**
 * PurchasedWinesTable - Molecule Component
 * Purchase history with metrics cards
 */

import { ShoppingCart, Package, DollarSign, BarChart3 } from 'lucide-react'
import { CollapsibleSection, WineTypeBar, WineTypeData } from '../atoms'

interface PurchaseData extends WineTypeData {
  date: string
  fullDate: string
  totalCost: number
  totalBottles: number
  orderCount: number
}

interface PurchaseMetrics {
  totalSpent: number
  totalBottlesPurchased: number
  totalOrders: number
  avgCostPerBottle: number
}

interface PurchasedWinesTableProps {
  purchaseData: PurchaseData[]
  metrics: PurchaseMetrics
  /**
   * Sales revenue for the same window, from `pos_checks`. COGS ratio is
   * cost ÷ revenue, so it cannot be computed without this. Pass `null` when no
   * POS revenue feed is wired — the tile then says so instead of dividing
   * procurement spend by itself and always printing ~100%.
   */
  posRevenue: number | null
  isOpen: boolean
  onToggle: () => void
  className?: string
}

export function PurchasedWinesTable({
  purchaseData,
  metrics,
  posRevenue,
  isOpen,
  onToggle,
  className = '',
}: PurchasedWinesTableProps) {
  return (
    <CollapsibleSection
      title="Purchased Wines"
      subtitle={`Track procurement spending • $${metrics.totalSpent.toLocaleString()} total`}
      icon={ShoppingCart}
      badge={
        <span className="px-3 py-1 bg-wine-100 text-wine-700 text-sm font-semibold rounded-full">
          {metrics.totalOrders} orders
        </span>
      }
      isOpen={isOpen}
      onToggle={onToggle}
      className={className}
    >
      <div className="p-6">
        {/* Purchase Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="p-4 bg-gradient-to-br from-wine-50 to-rose-50 rounded-xl border border-wine-100">
            <div className="flex items-center gap-2 mb-2">
              <ShoppingCart className="w-5 h-5 text-wine-600" />
              <p className="text-sm font-medium text-gray-600">Total Orders</p>
            </div>
            <p className="text-3xl font-bold text-wine-600">{metrics.totalOrders}</p>
          </div>

          <div className="p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-100">
            <div className="flex items-center gap-2 mb-2">
              <Package className="w-5 h-5 text-blue-600" />
              <p className="text-sm font-medium text-gray-600">Bottles Purchased</p>
            </div>
            <p className="text-3xl font-bold text-blue-600">{metrics.totalBottlesPurchased}</p>
          </div>

          <div className="p-4 bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl border border-emerald-100">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-5 h-5 text-emerald-600" />
              <p className="text-sm font-medium text-gray-600">Avg Cost/Bottle</p>
            </div>
            <p className="text-3xl font-bold text-emerald-600">${metrics.avgCostPerBottle.toFixed(2)}</p>
          </div>

          <div className="p-4 bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border border-amber-100">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="w-5 h-5 text-amber-600" />
              <p className="text-sm font-medium text-gray-600">COGS Ratio</p>
            </div>
            {posRevenue && posRevenue > 0 ? (
              <p className="text-3xl font-bold text-amber-600">
                {((metrics.totalSpent / posRevenue) * 100).toFixed(1)}%
              </p>
            ) : (
              <>
                <p className="text-3xl font-bold text-gray-300">—</p>
                <p className="text-[11px] text-gray-500 mt-1 leading-tight">
                  Needs sales revenue from a connected POS
                </p>
              </>
            )}
          </div>
        </div>

        {/* Purchase History Table */}
        <div className="overflow-x-auto border border-gray-200 rounded-xl">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="py-3 px-4 text-left text-xs font-semibold text-gray-600 uppercase">Date</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-gray-600 uppercase">Wine Types</th>
                <th className="py-3 px-4 text-right text-xs font-semibold text-gray-600 uppercase">Bottles</th>
                <th className="py-3 px-4 text-right text-xs font-semibold text-gray-600 uppercase">Total Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {purchaseData.map((purchase, idx) => (
                <tr key={idx} className="hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-4 text-sm font-medium text-gray-900">{purchase.date}</td>
                  <td className="py-3 px-4">
                    <div className="w-48">
                      <WineTypeBar data={purchase} showLabels height="md" />
                    </div>
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-600 text-right font-medium">{purchase.totalBottles}</td>
                  <td className="py-3 px-4 text-sm font-bold text-gray-900 text-right">
                    ${purchase.totalCost.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </CollapsibleSection>
  )
}

export type { PurchaseData, PurchaseMetrics }
