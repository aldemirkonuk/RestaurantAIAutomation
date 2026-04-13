/**
 * KPIChartBlock - Molecule Component
 * Single-metric KPI card for use inside DashboardCanvas blocks.
 * Renders a large metric value, trend indicator, and optional sparkline.
 */

import { TrendingUp, TrendingDown, LucideIcon } from 'lucide-react'
import { formatMoney, formatNumber } from '../../../lib/utils'

export interface KPIBlockData {
  value: string | number
  label: string
  change: number
  changeType: 'increase' | 'decrease'
  icon?: LucideIcon
  format?: 'currency' | 'number' | 'percentage'
  sparkline?: number[]
  /** Used for the KPI drill-down spotlight */
  kpiKey?: string
}

interface KPIChartBlockProps {
  data: KPIBlockData
  className?: string
  onClick?: () => void
  isSpotlighted?: boolean
}

function formatValue(val: string | number, format?: string): string {
  if (typeof val === 'string') return val
  switch (format) {
    case 'currency':
      return formatMoney(val, 'compact')
    case 'percentage':
      return `${val}%`
    default:
      return formatNumber(val, 'compact')
  }
}

function MiniSparkline({ data }: { data: number[] }) {
  if (!data.length) return null
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const w = 120
  const h = 32
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w
      const y = h - ((v - min) / range) * h
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg width={w} height={h} className="opacity-40">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function KPIChartBlock({ data, className = '', onClick, isSpotlighted }: KPIChartBlockProps) {
  const Icon = data.icon
  const isPositive = data.changeType === 'increase'

  return (
    <div
      className={`flex flex-col justify-between h-full p-5 transition-all duration-300 ${
        onClick ? 'cursor-pointer hover:bg-gray-50' : ''
      } ${isSpotlighted ? 'ring-2 ring-wine-500 shadow-lg shadow-wine-500/20 scale-[1.02]' : ''} ${className}`}
      onClick={onClick}
      title={typeof data.value === 'number' && data.format === 'currency' ? formatMoney(data.value, 'table') : undefined}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-500 truncate">{data.label}</p>
          <p className="text-3xl font-bold text-gray-900 mt-1 truncate">
            {formatValue(data.value, data.format)}
          </p>
        </div>
        {Icon && (
          <div className="p-2.5 bg-wine-100 rounded-xl flex-shrink-0 ml-3">
            <Icon className="w-5 h-5 text-wine-600" />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-1.5">
          {isPositive ? (
            <TrendingUp className="w-4 h-4 text-emerald-500" />
          ) : (
            <TrendingDown className="w-4 h-4 text-rose-500" />
          )}
          <span
            className={`text-sm font-semibold ${
              isPositive ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            {data.change > 0 ? '+' : ''}
            {data.change}%
          </span>
          <span className="text-xs text-gray-400 ml-1">vs prev period</span>
        </div>

        {data.sparkline && data.sparkline.length > 1 && (
          <div className={isPositive ? 'text-emerald-400' : 'text-rose-400'}>
            <MiniSparkline data={data.sparkline} />
          </div>
        )}
      </div>
    </div>
  )
}
