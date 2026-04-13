/**
 * AIInsightsSection - Organism Component
 * Collapsible AI insights with cards
 */

import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, ChevronUp, ChevronDown } from 'lucide-react'
import { InsightCard, Insight } from '../atoms'

interface AIInsightsSectionProps {
  insights: Insight[]
  isOpen: boolean
  onToggle: () => void
  onInsightAction?: (insightId: string) => void
  className?: string
}

export function AIInsightsSection({
  insights,
  isOpen,
  onToggle,
  onInsightAction,
  className = '',
}: AIInsightsSectionProps) {
  return (
    <div className={`bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 rounded-2xl border border-blue-100 overflow-hidden ${className}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-5 hover:bg-white/30 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="p-3 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl shadow-lg shadow-blue-600/30">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div className="text-left">
            <h3 className="text-lg font-bold text-gray-900">AI-Powered Insights</h3>
            <p className="text-sm text-gray-600">Actionable recommendations based on your data</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 bg-blue-100 text-blue-700 text-sm font-semibold rounded-full">
            {insights.length} insights
          </span>
          {isOpen ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-blue-100 overflow-hidden"
          >
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {insights.map((insight, idx) => (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                  index={idx}
                  onActionClick={() => onInsightAction?.(insight.id)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
