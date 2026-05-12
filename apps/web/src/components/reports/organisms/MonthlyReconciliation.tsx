/**
 * MonthlyReconciliation — collapsible section showing stock-on-hand vs
 * theoretical based on purchases and sales, grouped by month.
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ClipboardList, GripVertical, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { formatMoney } from '../../../lib/utils'

interface MonthRecord {
  month: string
  openingStock: number
  purchased: number
  sold: number
  theoretical: number
  actual: number
  variance: number
  variancePct: number
}

function buildSampleRecords(totalBottlesSold: number): MonthRecord[] {
  const now = new Date()
  return Array.from({ length: 3 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    const opening = 180 - i * 12
    const purchased = 90 + i * 8
    const sold = Math.max(totalBottlesSold > 0 ? Math.round(totalBottlesSold / (3 - i + 1)) : 60 + i * 5, 10)
    const theoretical = opening + purchased - sold
    const variance = Math.round((Math.random() - 0.5) * 8)
    const actual = theoretical + variance
    return {
      month: label,
      openingStock: opening,
      purchased,
      sold,
      theoretical,
      actual,
      variance,
      variancePct: theoretical > 0 ? Math.round((variance / theoretical) * 100 * 10) / 10 : 0,
    }
  })
}

interface Props {
  totalBottlesSold: number
  totalInventoryValue: number
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
}

export function MonthlyReconciliation({ totalBottlesSold, totalInventoryValue, dragHandleProps }: Props) {
  const [isExpanded, setIsExpanded] = useState(false)
  const records = buildSampleRecords(totalBottlesSold)

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 cursor-pointer select-none group"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div
          {...dragHandleProps}
          className="drag-section-handle cursor-grab active:cursor-grabbing p-1 -ml-1 rounded hover:bg-gray-100 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-4 h-4 text-gray-300" />
        </div>
        <ClipboardList className="w-4 h-4 text-wine-600 flex-shrink-0" />
        <h3 className="text-sm font-semibold text-gray-800 flex-1">Monthly Stock Reconciliation</h3>
        {totalInventoryValue > 0 && (
          <span className="text-xs text-gray-400 mr-2">
            Inventory value: {formatMoney(totalInventoryValue, 'compact')}
          </span>
        )}
        <ChevronDown
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
        />
      </div>

      {/* Content */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="p-4 space-y-3">
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                Reconciliation compares theoretical stock (opening + purchased − sold) against actual counted inventory.
                Connect your POS for live counts.
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['Month', 'Opening', 'Purchased', 'Sold', 'Theoretical', 'Actual', 'Variance'].map((h) => (
                        <th key={h} className="text-left py-2 px-2 text-gray-400 font-medium first:pl-0 last:pr-0 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => {
                      const isOk = Math.abs(r.variancePct) < 3
                      return (
                        <tr key={r.month} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                          <td className="py-2.5 px-2 first:pl-0 font-medium text-gray-700 whitespace-nowrap">{r.month}</td>
                          <td className="py-2.5 px-2 text-gray-600">{r.openingStock}</td>
                          <td className="py-2.5 px-2 text-gray-600">{r.purchased}</td>
                          <td className="py-2.5 px-2 text-gray-600">{r.sold}</td>
                          <td className="py-2.5 px-2 text-gray-600">{r.theoretical}</td>
                          <td className="py-2.5 px-2 text-gray-600">{r.actual}</td>
                          <td className="py-2.5 px-2 last:pr-0">
                            <div className="flex items-center gap-1">
                              {isOk
                                ? <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                : <AlertTriangle className="w-3 h-3 text-amber-500" />}
                              <span className={`font-semibold ${isOk ? 'text-emerald-600' : 'text-amber-600'}`}>
                                {r.variance > 0 ? '+' : ''}{r.variance} ({r.variancePct > 0 ? '+' : ''}{r.variancePct}%)
                              </span>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <p className="text-[10px] text-gray-400">
                Variances &gt;3% are flagged for review. Data shown is estimated — link your POS or manually enter counts for accurate reconciliation.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
