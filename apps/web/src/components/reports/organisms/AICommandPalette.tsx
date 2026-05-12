/**
 * AICommandPalette — floating ⌘K pill + expanding command modal for conversational analytics.
 * Triggered by clicking the pill or pressing ⌘K (Ctrl+K on Windows).
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, X, Send, ChevronRight } from 'lucide-react'

const SUGGESTIONS = [
  'Why did Tuesday revenue dip?',
  'Which wine had the most reorders this week?',
  "What's my busiest hour on Fridays?",
  'Compare this month vs last month',
  'Show top 3 margin wines',
  'When should I reorder Barolo?',
]

interface AIMessage {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  isOpen: boolean
  onClose: () => void
  restaurantId?: string
  timeRange?: string
}

export function AICommandPalette({ isOpen, onClose, timeRange = '30d' }: Props) {
  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState<AIMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 80)
    } else {
      setQuery('')
    }
  }, [isOpen])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const submit = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return
    const userMsg: AIMessage = { role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setQuery('')
    setIsLoading(true)

    // Simulate AI response (replace with real API call)
    await new Promise((r) => setTimeout(r, 900 + Math.random() * 600))
    const answer = generateMockAnswer(text, timeRange)
    setMessages((prev) => [...prev, { role: 'assistant', content: answer }])
    setIsLoading(false)
  }, [isLoading, timeRange])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(query) }
    if (e.key === 'Escape') onClose()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ type: 'spring', duration: 0.3, bounce: 0.15 }}
            className="fixed left-1/2 top-[12%] z-50 -translate-x-1/2 w-full max-w-xl mx-auto px-4"
          >
            <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
              {/* Header */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
                <Sparkles className="w-4 h-4 text-wine-600 flex-shrink-0" />
                <span className="text-sm font-semibold text-gray-700">Ask Analytics</span>
                <span className="text-xs text-gray-400 ml-1">({timeRange})</span>
                <button
                  onClick={onClose}
                  className="ml-auto p-1 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>

              {/* Messages */}
              {messages.length > 0 && (
                <div className="max-h-64 overflow-y-auto p-4 space-y-3">
                  {messages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
                          m.role === 'user'
                            ? 'bg-wine-600 text-white'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {m.role === 'assistant' && (
                          <div className="flex items-center gap-1 mb-1">
                            <Sparkles className="w-3 h-3 text-wine-600" />
                            <span className="text-[10px] font-semibold text-wine-600">WineOps AI</span>
                          </div>
                        )}
                        {m.content}
                      </div>
                    </div>
                  ))}
                  {isLoading && (
                    <div className="flex justify-start">
                      <div className="bg-gray-100 rounded-xl px-3 py-2.5 flex items-center gap-1.5">
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            className="w-1.5 h-1.5 rounded-full bg-wine-400 animate-bounce"
                            style={{ animationDelay: `${i * 0.15}s` }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>
              )}

              {/* Input */}
              <div className="flex items-center gap-2 px-3 py-2.5 border-t border-gray-100">
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Ask anything about your wine operations…"
                  className="flex-1 text-sm outline-none placeholder:text-gray-400 text-gray-800"
                />
                <button
                  onClick={() => submit(query)}
                  disabled={!query.trim() || isLoading}
                  className="p-1.5 rounded-lg bg-wine-600 text-white disabled:opacity-40 hover:bg-wine-700 transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Suggestions */}
              {messages.length === 0 && (
                <div className="px-3 pb-3 grid grid-cols-2 gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => submit(s)}
                      className="text-left text-[11px] text-gray-600 bg-gray-50 hover:bg-wine-50 hover:text-wine-700 px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1 group"
                    >
                      <ChevronRight className="w-3 h-3 text-gray-300 group-hover:text-wine-500 flex-shrink-0" />
                      <span className="truncate">{s}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
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
      className="fixed bottom-6 right-6 z-30 flex items-center gap-2 px-4 py-2.5 bg-wine-600 text-white rounded-full shadow-lg hover:bg-wine-700 hover:shadow-xl transition-all group"
      title="Ask Analytics (⌘K)"
    >
      <Sparkles className="w-4 h-4 group-hover:animate-pulse" />
      <span className="text-sm font-medium">Ask AI</span>
      <kbd className="hidden sm:flex items-center gap-0.5 text-[10px] font-medium bg-wine-500/50 rounded px-1 py-0.5">
        ⌘K
      </kbd>
    </motion.button>
  )
}

// ── Mock answer generator (placeholder until real endpoint) ────────────

function generateMockAnswer(query: string, timeRange: string): string {
  const q = query.toLowerCase()
  if (q.includes('tuesday') || q.includes('dip') || q.includes('drop')) {
    return `Based on the ${timeRange} window, Tuesday's revenue was ~18% below weekly average. The main driver appears to be fewer covers during the 7–9 PM window — consider a Tuesday tasting event or happy-hour promo to fill that gap.`
  }
  if (q.includes('reorder') || q.includes('when') || q.includes('stock')) {
    return `At the current run rate, your fastest-moving reds (Barolo, Sangiovese) will hit the reorder threshold in ~6 days. I'd recommend placing a purchase order by Thursday to avoid a gap over the weekend.`
  }
  if (q.includes('margin') || q.includes('profit')) {
    return `Your highest-margin wines this period are Prosecco (+72%), house Pinot Noir (+64%), and the Champagne by-glass (+61%). Highlighting them on the menu or training staff to suggest them first could lift overall margin by 3–4 points.`
  }
  if (q.includes('busy') || q.includes('hour') || q.includes('peak')) {
    return `Peak traffic is consistently between 7:00–9:00 PM Friday and Saturday. Wednesday lunch (12:00–1:30 PM) has grown 22% over the last 4 weeks — you may want to staff up there.`
  }
  if (q.includes('compare') || q.includes('vs') || q.includes('month')) {
    return `This period vs. the previous: Revenue +11%, Orders +8%, Avg order value +3%. Bottles sold are slightly down (-2%) but higher-priced selections are driving the revenue lift.`
  }
  return `Analyzing your ${timeRange} data… I see steady performance with a few opportunities. Your top growth area is by-the-glass upsells — they're converting at 34% which is above industry average. Want me to break down any specific metric?`
}
