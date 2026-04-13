/**
 * InsightCard - Atomic Component
 * AI insight display with icon, title, description, action
 */

import { LucideIcon } from 'lucide-react'
import { motion } from 'framer-motion'

interface Insight {
  id: string
  type: 'opportunity' | 'insight' | 'alert'
  icon: LucideIcon
  title: string
  description: string
  action: string
  color: 'emerald' | 'blue' | 'amber' | 'purple'
}

interface InsightCardProps {
  insight: Insight
  index?: number
  onActionClick?: () => void
  className?: string
}

const COLOR_MAP = {
  emerald: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' },
  blue: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
  amber: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' },
  purple: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200' },
}

export function InsightCard({ insight, index = 0, onActionClick, className = '' }: InsightCardProps) {
  const InsightIcon = insight.icon
  const colors = COLOR_MAP[insight.color]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      className={`bg-white rounded-xl p-4 border-2 ${colors.border} hover:shadow-md transition-all cursor-pointer ${className}`}
      onClick={onActionClick}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 ${colors.bg} rounded-lg`}>
          <InsightIcon className={`w-5 h-5 ${colors.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-gray-900 text-sm">{insight.title}</h4>
          <p className="text-xs text-gray-600 mt-1 line-clamp-2">{insight.description}</p>
          <button className={`mt-3 text-xs font-semibold ${colors.text} hover:underline`}>
            {insight.action} →
          </button>
        </div>
      </div>
    </motion.div>
  )
}

export type { Insight }
