/**
 * TrendIndicator - Atomic Component
 * Shows trend arrow with percentage change
 */

import { TrendingUp, TrendingDown } from 'lucide-react'

interface TrendIndicatorProps {
  change: number
  changeType?: 'increase' | 'decrease'
  className?: string
}

export function TrendIndicator({ change, changeType, className = '' }: TrendIndicatorProps) {
  const isIncrease = changeType === 'increase' || (changeType === undefined && change >= 0)
  const isDecrease = changeType === 'decrease' || (changeType === undefined && change < 0)

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {isIncrease ? (
        <TrendingUp className="w-4 h-4 text-emerald-500" />
      ) : (
        <TrendingDown className="w-4 h-4 text-rose-500" />
      )}
      <span
        className={`text-sm font-medium ${
          isIncrease ? 'text-emerald-600' : 'text-rose-600'
        }`}
      >
        {change > 0 ? '+' : ''}{change}%
      </span>
    </div>
  )
}
