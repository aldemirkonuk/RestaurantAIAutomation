import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Mail, Send, Clock, CheckCircle,
  Loader2, RefreshCw, MailOpen, ChevronDown, Copy, Check,
  Sparkles, Ban, ArrowUpRight,
} from 'lucide-react'
import { useOrderConversations, type OrderConversationDto } from '../../hooks/queries/useDraftEmailQueries'

const STATUS_CONFIG: Record<string, {
  label: string
  color: string
  bgColor: string
  borderColor: string
  dotColor: string
  icon: React.ComponentType<any>
}> = {
  PENDING_APPROVAL: {
    label: 'Draft Ready',
    color: 'text-indigo-700',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-300',
    dotColor: 'bg-indigo-500',
    icon: Sparkles,
  },
  DISCARDED: {
    label: 'Discarded',
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    dotColor: 'bg-red-400',
    icon: Ban,
  },
  SENT: {
    label: 'Sent',
    color: 'text-sky-700',
    bgColor: 'bg-sky-50',
    borderColor: 'border-sky-200',
    dotColor: 'bg-sky-500',
    icon: Send,
  },
  AUTO_SENT: {
    label: 'Auto-Sent',
    color: 'text-sky-700',
    bgColor: 'bg-sky-50',
    borderColor: 'border-sky-200',
    dotColor: 'bg-sky-500',
    icon: Send,
  },
  APPROVED: {
    label: 'Sent',
    color: 'text-sky-700',
    bgColor: 'bg-sky-50',
    borderColor: 'border-sky-200',
    dotColor: 'bg-sky-500',
    icon: Send,
  },
  COMPLETED: {
    label: 'Completed',
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    dotColor: 'bg-emerald-500',
    icon: CheckCircle,
  },
  CLOSED: {
    label: 'Closed',
    color: 'text-gray-500',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    dotColor: 'bg-gray-400',
    icon: MailOpen,
  },
}

const getStatusConfig = (status: string) =>
  STATUS_CONFIG[status] ?? {
    label: status,
    color: 'text-gray-500',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    dotColor: 'bg-gray-400',
    icon: Clock,
  }

function formatTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatSentAt(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function getInitials(name?: string): string {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
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
  const pendingConv = conversations.find(c => c.status === 'PENDING_APPROVAL')
  const providerName = conversations[0]?.providerName
  const providerEmail = conversations[0]?.providerEmail

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="comms-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/30 backdrop-blur-[1px] z-40"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="comms-drawer"
            initial={{ x: '100%', opacity: 0.5 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            className="fixed top-0 right-0 h-full w-[500px] bg-white shadow-2xl z-50 flex flex-col"
          >
            {/* Header */}
            <div className="relative flex-shrink-0">
              <div className="absolute inset-0 bg-gradient-to-br from-slate-900 to-slate-800" />
              <div className="relative px-6 pt-5 pb-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-white/10 rounded-lg">
                      <Mail className="w-3.5 h-3.5 text-white/80" />
                    </div>
                    <span className="text-[10px] font-semibold text-white/50 uppercase tracking-widest">
                      Email Thread
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <h2 className="text-lg font-bold text-white leading-tight mb-1 pr-8">
                  {orderWineName ?? 'Order'}
                </h2>

                {/* Provider row */}
                {providerName && (
                  <div className="flex items-center gap-2 mt-2">
                    <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-[9px] font-bold text-white">
                        {getInitials(providerName)}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs text-white/70 font-medium">{providerName}</span>
                      {providerEmail && (
                        <span className="text-[10px] text-white/40 ml-1.5">{providerEmail}</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Stats row */}
                <div className="flex items-center gap-3 mt-3">
                  {conversations.length > 0 ? (
                    <span className="text-[10px] text-white/40 font-medium">
                      {conversations.length} round{conversations.length !== 1 ? 's' : ''}
                    </span>
                  ) : null}
                  {isCancelled && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 text-[10px] font-semibold">
                      <Ban className="w-2.5 h-2.5" />
                      Order Cancelled
                    </span>
                  )}
                  {pendingConv && !isCancelled && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/25 text-indigo-300 text-[10px] font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                      Awaiting your review
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Thread body */}
            <div className="flex-1 overflow-y-auto bg-gray-50">
              {isLoading ? (
                <div className="flex items-center justify-center py-24">
                  <Loader2 className="w-5 h-5 text-gray-300 animate-spin" />
                </div>
              ) : conversations.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="px-6 py-6">
                  {/* Timeline */}
                  <div className="relative">
                    {/* Vertical connector line */}
                    {conversations.length > 1 && (
                      <div className="absolute left-[11px] top-5 bottom-5 w-px bg-gray-200" />
                    )}
                    <div className="space-y-5">
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
                  </div>
                </div>
              )}
            </div>

            {/* Sticky CTA for pending draft */}
            <AnimatePresence>
              {pendingConv && !isCancelled && (
                <motion.div
                  initial={{ y: 80, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 80, opacity: 0 }}
                  transition={{ type: 'spring', damping: 28, stiffness: 280 }}
                  className="flex-shrink-0 px-6 py-4 bg-white border-t border-gray-100 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]"
                >
                  <button
                    type="button"
                    onClick={() => { onClose(); setTimeout(onOpenDraftPanel, 150) }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-indigo-200"
                  >
                    <Sparkles className="w-4 h-4" />
                    Review & Approve Draft
                    <ArrowUpRight className="w-4 h-4 ml-auto opacity-60" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Cancelled footer */}
            {isCancelled && conversations.length > 0 && (
              <div className="flex-shrink-0 px-6 py-3 bg-gray-50 border-t border-gray-100">
                <p className="text-[11px] text-gray-400 text-center">
                  Order cancelled — history preserved for audit
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
    <div className="flex flex-col items-center justify-center py-24 px-8 text-center">
      <div className="w-14 h-14 bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center mb-4">
        <Mail className="w-6 h-6 text-gray-300" />
      </div>
      <p className="text-sm font-semibold text-gray-500">No email activity yet</p>
      <p className="text-xs text-gray-400 mt-1 max-w-[200px] leading-relaxed">
        AI drafts will appear here once this order is processed.
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
  const [expanded, setExpanded] = useState(isLatest)
  const [copied, setCopied] = useState(false)

  const cfg = getStatusConfig(conv.status)
  const StatusIcon = cfg.icon
  const isDiscarded = conv.status === 'DISCARDED'
  const isPending = conv.status === 'PENDING_APPROVAL'
  const isSent = ['SENT', 'AUTO_SENT', 'APPROVED'].includes(conv.status)

  const bodyText = conv.draftContent || conv.rollingSummary || ''
  const PREVIEW_LENGTH = 180
  const isLong = bodyText.length > PREVIEW_LENGTH
  const displayText = !expanded && isLong ? bodyText.slice(0, PREVIEW_LENGTH) + '…' : bodyText

  const handleCopy = () => {
    if (!bodyText) return
    navigator.clipboard.writeText(bodyText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative flex gap-3">
      {/* Timeline dot */}
      <div className="flex-shrink-0 mt-3.5 z-10">
        <div className={`w-[23px] h-[23px] rounded-full ${cfg.bgColor} border-2 ${cfg.borderColor} flex items-center justify-center`}>
          {isPending ? (
            <span className={`w-2 h-2 rounded-full ${cfg.dotColor} animate-pulse`} />
          ) : (
            <StatusIcon className={`w-3 h-3 ${cfg.color}`} />
          )}
        </div>
      </div>

      {/* Card */}
      <div className="flex-1 min-w-0">
        {/* Round + timestamp header */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
              Round {conv.roundCount}
            </span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${cfg.bgColor} ${cfg.color}`}>
              <StatusIcon className="w-2.5 h-2.5" />
              {cfg.label}
            </span>
          </div>
          <span className="text-[10px] text-gray-400">{formatTime(conv.createdAt)}</span>
        </div>

        {/* Main card */}
        <div className={`bg-white rounded-xl border ${isLatest ? cfg.borderColor : 'border-gray-100'} overflow-hidden shadow-sm`}>
          {/* Body */}
          {bodyText ? (
            <div className="px-4 py-3">
              <p className={`text-xs leading-relaxed whitespace-pre-wrap ${isDiscarded ? 'text-gray-400 line-through decoration-red-200' : 'text-gray-600'}`}>
                {displayText}
              </p>
              {isLong && (
                <button
                  type="button"
                  onClick={() => setExpanded(!expanded)}
                  className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-indigo-500 hover:text-indigo-700 transition-colors"
                >
                  <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                    <ChevronDown className="w-3 h-3" />
                  </motion.span>
                  {expanded ? 'Show less' : `Show ${bodyText.length - PREVIEW_LENGTH} more chars`}
                </button>
              )}
            </div>
          ) : null}

          {/* Footer meta */}
          <div className={`px-4 py-2 flex items-center justify-between border-t ${isLatest ? cfg.borderColor : 'border-gray-50'} bg-gray-50/50`}>
            <div className="flex items-center gap-3">
              {isSent && conv.sentAt && (
                <div className="flex items-center gap-1">
                  <CheckCircle className="w-3 h-3 text-sky-500" />
                  <span className="text-[10px] text-gray-400">
                    {formatSentAt(conv.sentAt)}
                    {conv.providerEmail && <span className="text-gray-300"> → {conv.providerEmail}</span>}
                  </span>
                </div>
              )}
              {isPending && (
                <span className="text-[10px] text-indigo-400 font-medium flex items-center gap-1">
                  <Sparkles className="w-2.5 h-2.5" />
                  AI-generated
                </span>
              )}
              {isDiscarded && (
                <span className="text-[10px] text-red-400">Never sent</span>
              )}
              {isSent && (
                <span className="text-[10px] text-gray-300 flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  Awaiting reply
                </span>
              )}
            </div>

            {/* Copy button */}
            {bodyText && (
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
                title="Copy email body"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>

          {/* Inline action for non-pending latest — discarded only */}
          {isLatest && !isCancelled && isDiscarded && (
            <div className="px-4 py-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => { onClose(); setTimeout(onOpenDraftPanel, 150) }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Request New Draft
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
