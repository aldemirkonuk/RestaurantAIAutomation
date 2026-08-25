/**
 * AICommandPalette — ⌘K palette over the analytics engine's real insight feed.
 *
 * WHY THIS IS NOT AN "ASK ANYTHING" BOX
 * -------------------------------------
 * This component used to answer free-text questions from `generateMockAnswer`,
 * a hand-written switch that returned confident, specific numbers — "Tuesday's
 * revenue was ~18% below weekly average", "Prosecco (+72%)" — that had never
 * touched the restaurant's data. Nothing on screen said so; only a source
 * comment did. An owner could have repriced a menu off those figures.
 *
 * There is no free-text question endpoint on the gateway to route such
 * questions to:
 *   • POST /analytics/consult/:id takes a *persona* (finance | economics |
 *     statistics | physics), not a question, and is toggle-gated OFF by default.
 *   • GET /analytics/insights/:id is the real surface: deterministic
 *     plain-language sentences whose every number the engine computed from the
 *     restaurant's own rows.
 *
 * So the palette searches that feed, through the shared `useEngineInsights`
 * hook (apiClient — every analytics route is behind JwtAuthGuard, and a raw
 * `fetch` with no bearer token 401s into a silently empty panel). It never
 * writes a sentence of its own; it filters and orders sentences the engine
 * produced (see insightSearch.ts), and says plainly that free-text answers are
 * not available yet. A short honest list beats a fluent invented one.
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Lightbulb, X, Search, ArrowRight, AlertCircle } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { useEngineInsights, CATEGORY_LABEL } from '../../../hooks/useEngineInsights'
import { rankInsights } from './insightSearch'

/** Where an insight's category lives in the app. Every route exists in App.tsx. */
const CATEGORY_ROUTE: Record<string, string> = {
  sales: '/reports',
  purchasing: '/orders',
  inventory: '/inventory',
  efficiency: '/reports',
  tables: '/reports',
  staff: '/team',
  basket: '/promotions',
  risk: '/orders',
  forecast: '/inventory',
  goals: '/reports',
}

const CATEGORY_COLORS: Record<string, string> = {
  sales: 'bg-emerald-100 text-emerald-700',
  purchasing: 'bg-blue-100 text-blue-700',
  inventory: 'bg-amber-100 text-amber-700',
  efficiency: 'bg-indigo-100 text-indigo-700',
  tables: 'bg-purple-100 text-purple-700',
  staff: 'bg-pink-100 text-pink-700',
  basket: 'bg-cyan-100 text-cyan-700',
  risk: 'bg-rose-100 text-rose-700',
  forecast: 'bg-violet-100 text-violet-700',
  goals: 'bg-slate-100 text-slate-700',
}

interface Props {
  isOpen: boolean
  onClose: () => void
}

export function AICommandPalette({ isOpen, onClose }: Props) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ type: 'spring', duration: 0.3, bounce: 0.15 }}
            className="fixed left-1/2 top-[12%] z-50 -translate-x-1/2 w-full max-w-xl mx-auto px-4"
            role="dialog"
            aria-label="Search insights"
          >
            {/* Mounted only while open, so the insight fetch happens on open
                rather than on every Reports page load. */}
            <PaletteBody onClose={onClose} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { insights, loading, error, refresh } = useEngineInsights({ limit: 40 })

  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 80)
    return () => clearTimeout(t)
  }, [])

  const results = useMemo(() => rankInsights(insights, query), [insights, query])

  /** Topic chips are the categories actually present in this restaurant's data. */
  const topics = useMemo(() => {
    const seen: string[] = []
    for (const i of insights) if (!seen.includes(i.category)) seen.push(i.category)
    return seen.slice(0, 6)
  }, [insights])

  const openCategory = (category: string) => {
    const route = CATEGORY_ROUTE[category]
    if (!route) return
    onClose()
    navigate(route)
  }

  return (
    <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
        <Lightbulb className="w-4 h-4 text-wine-600 flex-shrink-0" />
        <span className="text-sm font-semibold text-gray-700">Search insights</span>
        <button
          onClick={onClose}
          className="ml-auto p-1 rounded-lg hover:bg-gray-100 transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      {/* The honest framing, stated before any result is read. */}
      <p className="px-4 py-2 text-[11px] leading-relaxed text-gray-500 bg-gray-50 border-b border-gray-100">
        This does not answer questions in free text yet. It searches the insights
        the analytics engine computed from your own records — every number below
        comes from your data.
      </p>

      {/* Input */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100">
        <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
          placeholder="Filter by wine, vendor, metric or category…"
          aria-label="Filter insights"
          className="flex-1 text-sm outline-none placeholder:text-gray-400 text-gray-800"
        />
      </div>

      {/* Body */}
      <div className="max-h-80 overflow-y-auto">
        {!user?.restaurantId ? (
          <Notice icon>No restaurant is selected, so there is nothing to search yet.</Notice>
        ) : loading ? (
          <Notice>Loading insights…</Notice>
        ) : error ? (
          <Notice icon>
            Could not reach the analytics engine, so no insights can be shown.{' '}
            <button
              onClick={() => void refresh(false)}
              className="underline text-wine-600 hover:text-wine-700"
            >
              Try again
            </button>
          </Notice>
        ) : insights.length === 0 ? (
          <Notice icon>
            The engine has not produced any insights for this restaurant yet. They
            appear once there is enough sales, purchasing or inventory history to
            measure.
          </Notice>
        ) : results.length === 0 ? (
          <Notice>
            No insight mentions “{query.trim()}”. Clear the box to see all{' '}
            {insights.length}.
          </Notice>
        ) : (
          <ul className="p-2 space-y-1.5">
            {results.slice(0, 25).map(({ insight }) => (
              <li key={insight.ruleKey}>
                <button
                  onClick={() => openCategory(insight.category)}
                  className="w-full text-left px-3 py-2.5 rounded-xl bg-gray-50 hover:bg-wine-50 transition-colors group"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        CATEGORY_COLORS[insight.category] ?? 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {CATEGORY_LABEL[insight.category] ?? insight.category}
                    </span>
                    {insight.entityLabel && (
                      <span className="text-[11px] text-gray-500 truncate">
                        {insight.entityLabel}
                      </span>
                    )}
                    {CATEGORY_ROUTE[insight.category] && (
                      <ArrowRight className="w-3 h-3 ml-auto text-gray-300 group-hover:text-wine-500 flex-shrink-0" />
                    )}
                  </div>
                  {/* Verbatim engine sentence — never reworded here. */}
                  <p className="text-sm text-gray-800 leading-relaxed">{insight.sentence}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Topic chips — the categories this restaurant actually has data for */}
      {!loading && !error && insights.length > 0 && !query && topics.length > 0 && (
        <div className="px-3 py-2.5 border-t border-gray-100 flex flex-wrap gap-1.5">
          {topics.map((t) => (
            <button
              key={t}
              onClick={() => setQuery(t)}
              className="text-[11px] text-gray-600 bg-gray-50 hover:bg-wine-50 hover:text-wine-700 px-2.5 py-1 rounded-lg transition-colors"
            >
              {CATEGORY_LABEL[t] ?? t}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Notice({ children, icon }: { children: React.ReactNode; icon?: boolean }) {
  return (
    <div className="flex items-start gap-2 px-4 py-6 text-sm text-gray-500">
      {icon && <AlertCircle className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />}
      <p className="leading-relaxed">{children}</p>
    </div>
  )
}

// ── Floating pill trigger ───────────────────────────────────────────────

interface PillProps {
  onClick: () => void
}

export function AICommandPill({ onClick }: PillProps) {
  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.6, type: 'spring', bounce: 0.3 }}
      className="fixed bottom-6 right-6 z-30 flex items-center gap-2 px-4 py-2.5 bg-wine-600 text-white rounded-full shadow-lg hover:bg-wine-700 hover:shadow-xl transition-all"
      title="Search insights (⌘K)"
    >
      <Lightbulb className="w-4 h-4" />
      <span className="text-sm font-medium">Insights</span>
      <kbd className="hidden sm:flex items-center gap-0.5 text-[10px] font-medium bg-wine-500/50 rounded px-1 py-0.5">
        ⌘K
      </kbd>
    </motion.button>
  )
}
