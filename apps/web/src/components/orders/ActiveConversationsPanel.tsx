import { motion, AnimatePresence } from 'framer-motion'
import { X, Clock, AlertTriangle, Mail, CheckCircle, XCircle, Eye } from 'lucide-react'
import type { ActiveConversationDto } from '../../hooks/queries/useDraftEmailQueries'

function formatDraftAge(createdAt: string): { label: string; isStale: boolean } {
  const diffMs = Date.now() - new Date(createdAt).getTime()
  const diffHrs = diffMs / (1000 * 60 * 60)
  const isStale = diffHrs >= 24
  if (diffMs < 60_000) return { label: 'just now', isStale }
  if (diffMs < 3_600_000) return { label: `${Math.floor(diffMs / 60_000)} min ago`, isStale }
  return { label: `${Math.floor(diffHrs)} hrs ago`, isStale }
}

const EMAIL_TYPE_LABELS: Record<string, string> = {
  PRICE_INQUIRY: 'Price Inquiry',
  DEMAND_OFFER: 'Demand Offer',
  PROMO_INQUIRY: 'Promo Inquiry',
  WINE_INQUIRY: 'Wine Inquiry',
  COUNTER_OFFER: 'Counter Offer',
  CLARIFICATION: 'Clarification',
  ACCEPTANCE_CONFIRM_REQUEST: 'Acceptance',
  ESCALATION: 'Escalation',
  ORDER_CONFIRMATION: 'Order Confirmation',
  MANUAL_REPLY: 'Manual Reply',
}

interface ActiveConversationsPanelProps {
  isOpen: boolean
  onClose: () => void
  conversations: ActiveConversationDto[]
  isLoading: boolean
  onViewDraft: (conversation: ActiveConversationDto) => void
  onApprove: (orderId: string) => void
  onDiscard: (orderId: string) => void
  isApproving?: boolean
  isDiscarding?: boolean
}

export function ActiveConversationsPanel({
  isOpen,
  onClose,
  conversations,
  isLoading,
  onViewDraft,
  onApprove,
  onDiscard,
  isApproving,
  isDiscarding,
}: ActiveConversationsPanelProps) {
  const oldestDate =
    conversations.length > 0
      ? new Date(conversations[conversations.length - 1].createdAt).toLocaleDateString()
      : null

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.3 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black z-40"
          />
          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed right-0 top-0 h-full w-[480px] bg-indigo-900 text-white z-50 flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-indigo-700">
              <div className="flex items-center gap-3">
                <Mail className="w-5 h-5 text-indigo-300" />
                <h2 className="text-lg font-semibold">Active Drafts</h2>
                {conversations.length > 0 && (
                  <span className="bg-indigo-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    {conversations.length}
                  </span>
                )}
              </div>
              <button
                onClick={onClose}
                className="text-indigo-300 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {isLoading && (
                <p className="text-indigo-300 text-sm text-center py-8">Loading drafts…</p>
              )}
              {!isLoading && conversations.length === 0 && (
                <div className="text-center py-12">
                  <CheckCircle className="w-10 h-10 text-indigo-400 mx-auto mb-3" />
                  <p className="text-indigo-300 text-sm">No pending drafts</p>
                  <p className="text-indigo-400 text-xs mt-1">All AI emails have been reviewed</p>
                </div>
              )}
              {conversations.map((conv) => {
                const age = formatDraftAge(conv.createdAt)
                return (
                  <div
                    key={conv.id}
                    className={`rounded-xl p-4 border ${
                      age.isStale
                        ? 'bg-amber-900/30 border-amber-600/40'
                        : 'bg-indigo-800/60 border-indigo-600/40'
                    }`}
                  >
                    {/* Card header */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">
                          {conv.wineName ?? 'Unknown Wine'}
                        </p>
                        <p className="text-xs text-indigo-300 truncate">
                          {conv.providerName ?? 'Unknown Provider'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                        <span className="text-xs bg-indigo-700 text-indigo-200 px-2 py-0.5 rounded-full">
                          {EMAIL_TYPE_LABELS[conv.emailType] ?? conv.emailType}
                        </span>
                      </div>
                    </div>

                    {/* Meta row */}
                    <div className="flex items-center gap-3 mb-3 text-xs">
                      {conv.quantity != null && (
                        <span className="text-indigo-300">{conv.quantity} bottles</span>
                      )}
                      <span
                        className={`flex items-center gap-1 ${
                          age.isStale ? 'text-amber-400 font-medium' : 'text-indigo-400'
                        }`}
                      >
                        {age.isStale && <AlertTriangle className="w-3 h-3" />}
                        <Clock className="w-3 h-3" />
                        {age.label}
                      </span>
                      {age.isStale && (
                        <span className="text-amber-400 text-xs font-medium">
                          Stale — review now
                        </span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onViewDraft(conv)}
                        className="flex items-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <Eye className="w-3 h-3" />
                        View Full Draft
                      </button>
                      <button
                        onClick={() => onApprove(conv.orderId)}
                        disabled={isApproving}
                        className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <CheckCircle className="w-3 h-3" />
                        Quick Approve
                      </button>
                      <button
                        onClick={() => onDiscard(conv.orderId)}
                        disabled={isDiscarding}
                        className="flex items-center gap-1.5 text-xs bg-red-700/60 hover:bg-red-600/80 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <XCircle className="w-3 h-3" />
                        Discard
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Footer */}
            {conversations.length > 0 && oldestDate && (
              <div className="px-6 py-3 border-t border-indigo-700 text-xs text-indigo-400">
                {conversations.length} active draft{conversations.length !== 1 ? 's' : ''} — oldest
                from {oldestDate}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
