/**
 * HeadlineInsightsBar — plain-language metric conclusions above the Reports TopBar.
 * Projection of /analytics/insights (no LLM). Complements EngineInsightsPanel below.
 */

import { Lightbulb } from 'lucide-react'
import {
  CATEGORY_LABEL,
  toneOf,
  toneWord,
  useEngineInsights,
  type EngineInsight,
  type InsightTone,
} from '../../../hooks/useEngineInsights'
import { cn } from '../../../lib/utils'

interface HeadlineInsightsBarProps {
  onSeeDetails?: () => void
  className?: string
}

const TONE_PILL: Record<InsightTone, string> = {
  up: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  down: 'bg-amber-50 text-amber-700 border-amber-100',
  warn: 'bg-rose-50 text-rose-700 border-rose-100',
  flat: 'bg-gray-100 text-gray-600 border-gray-200',
}

function formatEffect(effectPct: number | null): string | null {
  if (effectPct == null || !Number.isFinite(effectPct)) return null
  const pct = Math.round(Math.abs(effectPct) * 100)
  const sign = effectPct >= 0 ? '+' : '−'
  return `${sign}${pct}%`
}

function InsightTile({
  insight,
  hero,
  onSeeDetails,
}: {
  insight: EngineInsight
  hero?: boolean
  onSeeDetails?: () => void
}) {
  const tone = toneOf(insight)
  const effect = formatEffect(insight.effectPct)
  const label = CATEGORY_LABEL[insight.category] ?? insight.category
  const Comp = onSeeDetails ? 'button' : 'div'

  return (
    <Comp
      type={onSeeDetails ? 'button' : undefined}
      onClick={onSeeDetails}
      className={cn(
        'text-left rounded-lg border border-gray-100 bg-gray-50/60 transition-colors w-full',
        hero ? 'p-3' : 'p-2.5',
        onSeeDetails && 'hover:border-wine-200 hover:bg-white cursor-pointer',
      )}
    >
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span
          className={cn(
            'px-2 py-0.5 rounded-full text-[11px] font-semibold border',
            TONE_PILL[tone],
          )}
        >
          {label} · {toneWord(tone)}
        </span>
        {effect && (
          <span className="text-[11px] font-semibold text-gray-500 tabular-nums">{effect}</span>
        )}
      </div>
      <p
        className={cn(
          'font-medium text-gray-900 leading-snug line-clamp-2',
          hero ? 'text-sm' : 'text-xs',
        )}
      >
        {insight.sentence}
      </p>
    </Comp>
  )
}

export function HeadlineInsightsBar({ onSeeDetails, className = '' }: HeadlineInsightsBarProps) {
  const { insights, loading, error } = useEngineInsights({ limit: 12 })

  if (error) return null

  const top = insights.slice(0, 3)
  const hero = top[0]
  const secondary = top.slice(1)

  return (
    <section
      aria-label="Headline insights"
      className={cn('bg-white rounded-xl border border-gray-200 p-4', className)}
    >
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="p-1.5 bg-wine-50 rounded-lg shrink-0">
            <Lightbulb className="w-4 h-4 text-wine-700" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-gray-900">What matters right now</h2>
            <p className="text-xs text-gray-500 truncate">
              A plain-language read of your latest numbers
            </p>
          </div>
        </div>
        {onSeeDetails && (
          <button
            type="button"
            onClick={onSeeDetails}
            className="text-xs font-medium text-wine-700 hover:underline whitespace-nowrap shrink-0"
          >
            See all insights →
          </button>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <div className="h-12 bg-gray-100 rounded-lg animate-pulse" />
          <div className="h-12 bg-gray-100 rounded-lg animate-pulse hidden lg:block" />
          <div className="h-12 bg-gray-100 rounded-lg animate-pulse hidden lg:block" />
        </div>
      ) : !hero ? (
        <p className="text-sm text-gray-500">
          No standout patterns yet — conclusions appear as sales, pours, and orders add up.
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <InsightTile insight={hero} hero onSeeDetails={onSeeDetails} />
          {secondary.map((insight) => (
            <InsightTile
              key={insight.ruleKey}
              insight={insight}
              onSeeDetails={onSeeDetails}
            />
          ))}
          {secondary.length === 0 && (
            <>
              <div className="hidden lg:block rounded-lg border border-dashed border-gray-200 bg-gray-50/40" />
              <div className="hidden lg:block rounded-lg border border-dashed border-gray-200 bg-gray-50/40" />
            </>
          )}
          {secondary.length === 1 && (
            <div className="hidden lg:block rounded-lg border border-dashed border-gray-200 bg-gray-50/40" />
          )}
        </div>
      )}
    </section>
  )
}
