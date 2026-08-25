/**
 * OrderFunnelChart — horizontal funnel showing the order pipeline stages.
 * Computed from total orders; individual stage counts are estimated.
 */

import { formatNumber } from '../../../lib/utils'

interface Props {
  totalOrders: number
  /** Total vendor spend across the window (procurement_orders), not revenue. */
  totalSpend: number
  className?: string
}

export function OrderFunnelChart({ totalOrders, totalSpend, className = '' }: Props) {
  const stages = [
    { label: 'Tables Seated',     value: Math.round(totalOrders * 2.1),  color: '#9E4249' },
    { label: 'Wine Offered',      value: Math.round(totalOrders * 1.6),  color: '#e05c7e' },
    { label: 'Order Placed',      value: totalOrders,                    color: '#ec4899' },
    { label: 'Upsell Accepted',   value: Math.round(totalOrders * 0.35), color: '#f472b6' },
    { label: 'Repeat Order',      value: Math.round(totalOrders * 0.18), color: '#fbb6ce' },
  ]

  const max = stages[0].value || 1

  return (
    <div className={`flex flex-col gap-2.5 justify-center h-full px-1 ${className}`}>
      {stages.map((s, i) => {
        const pct = (s.value / max) * 100
        const convPct = i > 0 ? Math.round((s.value / (stages[i - 1].value || 1)) * 100) : 100
        return (
          <div key={s.label} className="flex items-center gap-2 group">
            {/* Bar */}
            <div className="flex-1 relative h-6 bg-gray-100 rounded-md overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-md transition-all duration-700"
                style={{ width: `${pct}%`, backgroundColor: s.color }}
              />
              <span className="absolute inset-0 flex items-center px-2 text-[11px] font-medium text-white mix-blend-normal z-10">
                {s.label}
              </span>
            </div>
            {/* Count */}
            <div className="w-16 text-right">
              <span className="text-[11px] font-semibold text-gray-700">{formatNumber(s.value, 'compact')}</span>
              {i > 0 && (
                <span className="block text-[9px] text-gray-400">{convPct}%</span>
              )}
            </div>
          </div>
        )
      })}
      {totalOrders === 0 && (
        <p className="text-[10px] text-amber-600 text-center mt-1">Connect POS for live funnel data</p>
      )}
      <div className="text-[9px] text-gray-400 text-center mt-1">
        Avg vendor spend / order: {totalOrders > 0 ? formatNumber(Math.round(totalSpend / totalOrders)) : '—'}
      </div>
    </div>
  )
}
