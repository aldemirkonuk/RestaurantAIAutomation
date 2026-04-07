import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface MetricCardProps {
  label: string
  value: number | string
  trend?: number       // positive = up, negative = down, 0 = flat
  unit?: string
  loading?: boolean
}

export function MetricCard({ label, value, trend, unit, loading }: MetricCardProps) {
  const TrendIcon =
    trend == null ? null
    : trend > 0 ? TrendingUp
    : trend < 0 ? TrendingDown
    : Minus

  const trendColor =
    trend == null ? ''
    : trend > 0 ? 'text-emerald-600'
    : trend < 0 ? 'text-red-500'
    : 'text-slate-400'

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs px-5 py-4 flex flex-col gap-1 min-w-[140px] flex-1">
      <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
      {loading ? (
        <div className="h-7 w-16 bg-slate-100 rounded animate-pulse mt-1" />
      ) : (
        <div className="flex items-end gap-2">
          <span className="text-2xl font-semibold text-slate-900 leading-none">
            {value}
            {unit ? <span className="text-sm text-slate-500 ml-0.5">{unit}</span> : null}
          </span>
          {TrendIcon && typeof trend === 'number' && (
            <span className={`flex items-center gap-0.5 text-xs mb-0.5 ${trendColor}`}>
              <TrendIcon className="w-3.5 h-3.5" />
              {Math.abs(trend)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
