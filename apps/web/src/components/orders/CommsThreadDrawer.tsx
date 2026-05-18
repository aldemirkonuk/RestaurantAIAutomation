import { motion, AnimatePresence } from 'framer-motion'
import { X, Mail, Send, Clock, AlertTriangle, CheckCircle, Loader2, RefreshCw, MailOpen } from 'lucide-react'
import { useOrderConversations, type OrderConversationDto } from '../../hooks/queries/useDraftEmailQueries'

// Status → display config
const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; borderColor: string; icon: React.ComponentType<any> }> = {
  PENDING_APPROVAL: {
    label: 'Draft Ready',
    color: 'text-indigo-700',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-200',
    icon: Mail,
  },
  DISCARDED: {
    label: 'Draft Discarded',
    color: 'text-red-700',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    icon: AlertTriangle,
  },
  SENT: {
    label: 'Sent',
    color: 'text-blue-700',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    icon: Send,
  },
  AUTO_SENT: {
    label: 'Auto-Sent',
    color: 'text-blue-700',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    icon: Send,
  },
  APPROVED: {
    label: 'Approved & Sent',
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    icon: CheckCircle,
  },
  COMPLETED: {
    label: 'Completed',
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    icon: CheckCircle,
  },
  CLOSED: {
    label: 'Closed',
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    icon: MailOpen,
  },
}

const getStatusConfig = (status: string) =>
  STATUS_CONFIG[status] ?? {
    label: status,
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    icon: Clock,
  }

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface CommsThreadDrawerProps {
  orderId: string | null
  orderWineName?: string
  orderStatus?: string
  isOpen: boolean
  onClose: () => void
  onOpenDraftPanel: () => void
}

export function CommsThreadDrawer({
  orderId,
  orderWineName,
  orderStatus,
  isOpen,
  onClose,
  onOpenDraftPanel,
}: CommsThreadDrawerProps) {
  const { data: conversations = [], isLoading } = useOrderConversations(isOpen ? orderId : null)

  const isCancelled = orderStatus === 'cancelled'

  return (
    <>
      {/* Backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="comms-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/20 z-40"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      {/* Drawer */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="comms-drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed top-0 right-0 h-full w-[480px] bg-white shadow-2xl z-50 flex flex-col border-l border-gray-200"
          >
            {/* Header */}
            <div className="px-6 py-5 border-b border-gray-200 flex items-start justify-between flex-shrink-0">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Mail className="w-4 h-4 text-gray-400" />
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Email Thread</span>
                </div>
                <h2 className="text-base font-bold text-gray-900 leading-snug">
                  {orderWineName ?? 'Order'}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {conversations.length > 0
                    ? `${conversations.length} conversation${conversations.length > 1 ? 's' : ''}`
                    : 'No email activity yet'}
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-6 h-6 text-gray-300 animate-spin" />
                </div>
              ) : conversations.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="px-6 py-5 space-y-4">
                  {conversations.map((conv, idx) => (
                    <ConversationCard
                      key={conv.id}
                      conv={conv}
                      isLatest={idx === conversations.length - 1}
                      isCancelled={isCancelled}
                      onOpenDraftPanel={onOpenDraftPanel}
                      onClose={onClose}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {isCancelled && conversations.length > 0 && (
              <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 flex-shrink-0">
                <p className="text-xs text-gray-400 text-center">
                  Order cancelled — email history preserved for reference
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
      <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-4">
        <Mail className="w-6 h-6 text-gray-300" />
      </div>
      <p className="text-sm font-medium text-gray-500">No email activity yet</p>
      <p className="text-xs text-gray-400 mt-1">
        An AI draft will appear here once the order triggers one.
      </p>
    </div>
  )
}

interface ConversationCardProps {
  conv: OrderConversationDto
  isLatest: boolean
  isCancelled: boolean
  onOpenDraftPanel: () => void
  onClose: () => void
}

function ConversationCard({ conv, isLatest, isCancelled, onOpenDraftPanel, onClose }: ConversationCardProps) {
  const cfg = getStatusConfig(conv.status)
  const StatusIcon = cfg.icon
  const isDiscarded = conv.status === 'DISCARDED'
  const isPending = conv.status === 'PENDING_APPROVAL'
  const isSent = ['SENT', 'AUTO_SENT', 'APPROVED', 'COMPLETED', 'CLOSED'].includes(conv.status)

  return (
    <div className={`rounded-xl border ${cfg.borderColor} overflow-hidden`}>
      {/* Card Header */}
      <div className={`px-4 py-3 flex items-center justify-between ${cfg.bgColor}`}>
        <div className="flex items-center gap-2">
          <StatusIcon className={`w-4 h-4 ${cfg.color}`} />
          <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
          {conv.roundCount > 1 && (
            <span className="text-xs text-gray-400">· Round {conv.roundCount}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {conv.providerName && (
            <span className="text-xs text-gray-500">{conv.providerName}</span>
          )}
          <span className="text-xs text-gray-400">{formatRelativeTime(conv.createdAt)}</span>
        </div>
      </div>

      {/* Discarded notice */}
      {isDiscarded && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-100">
          <p className="text-xs text-red-600 font-medium">
            🗑 This draft was discarded and never sent to {conv.providerName ?? 'the provider'}.
          </p>
        </div>
      )}

      {/* Draft body */}
      {conv.draftContent && (
        <div className={`px-4 py-3 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap ${isDiscarded ? 'opacity-75' : ''}`}>
          {conv.draftContent.length > 400
            ? conv.draftContent.slice(0, 400) + '…'
            : conv.draftContent}
        </div>
      )}

      {/* Rolling summary for completed threads */}
      {!conv.draftContent && conv.rollingSummary && (
        <div className="px-4 py-3 text-sm text-gray-600 leading-relaxed italic">
          {conv.rollingSummary}
        </div>
      )}

      {/* Sent timestamp */}
      {isSent && conv.sentAt && (
        <div className="px-4 pb-2">
          <p className="text-xs text-gray-400">
            Sent {new Date(conv.sentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            {conv.providerEmail ? ` to ${conv.providerEmail}` : ''}
          </p>
        </div>
      )}

      {/* AI stamp */}
      {(isPending || isSent) && (
        <div className="px-4 pb-2">
          <span className="text-xs text-indigo-400">✦ AI-assisted draft</span>
        </div>
      )}

      {/* Actions — only for latest, non-cancelled */}
      {isLatest && !isCancelled && (
        <div className={`px-4 py-3 border-t ${cfg.borderColor} flex gap-2`}>
          {isPending && (
            <button
              onClick={() => { onClose(); setTimeout(onOpenDraftPanel, 150) }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              <Mail className="w-3.5 h-3.5" />
              Review & Approve
            </button>
          )}
          {isDiscarded && (
            <button
              onClick={() => { onClose(); setTimeout(onOpenDraftPanel, 150) }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-lg border border-indigo-200 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Request New Draft
            </button>
          )}
          {isSent && (
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              Awaiting provider reply
            </span>
          )}
        </div>
      )}
    </div>
  )
}
