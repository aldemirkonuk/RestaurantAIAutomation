import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Mail, Send, Clock, CheckCircle,
  Loader2, RefreshCw, MailOpen, ChevronDown, Copy, Check,
  Sparkles, Ban, ArrowRight, MessageSquare,
} from 'lucide-react'
import { useOrderConversations, type OrderConversationDto } from '../../hooks/queries/useDraftEmailQueries'

const STATUS_CONFIG: Record<string, {
  label: string
  textColor: string
  bgColor: string
  borderColor: string
  dotColor: string
  ringColor: string
  icon: React.ComponentType<any>
}> = {
  PENDING_APPROVAL: {
    label: 'Draft Ready',
    textColor: 'text-wine-700',
    bgColor: 'bg-wine-50',
    borderColor: 'border-wine-200',
    dotColor: 'bg-wine-500',
    ringColor: 'ring-wine-200',
    icon: Sparkles,
  },
  DISCARDED: {
    label: 'Discarded',
    textColor: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    dotColor: 'bg-red-400',
    ringColor: 'ring-red-200',
    icon: Ban,
  },
  SENT: {
    label: 'Sent',
    textColor: 'text-emerald-700',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    dotColor: 'bg-emerald-500',
    ringColor: 'ring-emerald-200',
    icon: Send,
  },
  AUTO_SENT: {
    label: 'Auto-Sent',
    textColor: 'text-emerald-700',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    dotColor: 'bg-emerald-500',
    ringColor: 'ring-emerald-200',
    icon: Send,
  },
  APPROVED: {
    label: 'Sent',
    textColor: 'text-emerald-700',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    dotColor: 'bg-emerald-500',
    ringColor: 'ring-emerald-200',
    icon: Send,
  },
  COMPLETED: {
    label: 'Completed',
    textColor: 'text-emerald-700',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    dotColor: 'bg-emerald-500',
    ringColor: 'ring-emerald-200',
    icon: CheckCircle,
  },
  CLOSED: {
    label: 'Closed',
    textColor: 'text-gray-500',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    dotColor: 'bg-gray-400',
    ringColor: 'ring-gray-200',
    icon: MailOpen,
  },
}

const getStatusConfig = (status: string) =>
  STATUS_CONFIG[status] ?? {
    label: status,
    textColor: 'text-gray-500',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    dotColor: 'bg-gray-400',
    ringColor: 'ring-gray-200',
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
      {/* Backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="comms-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/25 backdrop-blur-[2px] z-40"
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
            className="fixed top-0 right-0 h-full w-[480px] z-50 flex flex-col shadow-2xl"
          >
            {/* Header — wine brand gradient */}
            <div className="flex-shrink-0 bg-gradient-to-br from-wine-900 via-wine-800 to-wine-700 px-6 pt-5 pb-5">
              {/* Top row */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-white/10 rounded-lg">
                    <MessageSquare className="w-3.5 h-3.5 text-white/70" />
                  </div>
                  <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
                    Provider Comms
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

              {/* Wine name */}
              <h2 className="text-xl font-bold text-white leading-tight mb-3">
                {orderWineName ?? 'Order'}
              </h2>

              {/* Provider + meta row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  {providerName ? (
                    <>
                      <div className="w-7 h-7 rounded-full bg-white/15 border border-white/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-white">
                          {getInitials(providerName)}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white/80 leading-none">{providerName}</p>
                        {providerEmail && (
                          <p className="text-[10px] text-white/40 mt-0.5 truncate">{providerEmail}</p>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-white/30" />
                      <span className="text-xs text-white/40">No provider assigned</span>
                    </div>
                  )}
                </div>

                {/* Status pills */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {isCancelled && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-400/20 text-red-300 text-[10px] font-semibold border border-red-400/20">
                      <Ban className="w-2.5 h-2.5" />
                      Cancelled
                    </span>
                  )}
                  {pendingConv && !isCancelled && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-200 text-[10px] font-semibold border border-amber-400/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse" />
                      Review needed
                    </span>
                  )}
                  {conversations.length > 0 && (
                    <span className="text-[10px] text-white/30 font-medium">
                      {conversations.length} round{conversations.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Thread body */}
            <div className="flex-1 overflow-y-auto bg-gray-50/80">
              {isLoading ? (
                <div className="flex items-center justify-center py-24">
                  <Loader2 className="w-5 h-5 text-wine-300 animate-spin" />
                </div>
              ) : conversations.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="px-5 py-5">
                  <div className="relative">
                    {conversations.length > 1 && (
                      <div className="absolute left-[10px] top-6 bottom-6 w-px bg-gray-200" />
                    )}
                    <div className="space-y-4">
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
                  initial={{ y: 60, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 60, opacity: 0 }}
                  transition={{ type: 'spring', damping: 28, stiffness: 280 }}
                  className="flex-shrink-0 px-5 py-4 bg-white border-t border-gray-100 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]"
                >
                  <button
                    type="button"
                    onClick={() => { onClose(); setTimeout(onOpenDraftPanel, 150) }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-wine-700 hover:bg-wine-800 active:bg-wine-900 text-white text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-wine-200"
                  >
                    <Sparkles className="w-4 h-4" />
                    Review & Approve Draft
                    <ArrowRight className="w-4 h-4 ml-auto opacity-60" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Cancelled footer */}
            {isCancelled && conversations.length > 0 && (
              <div className="flex-shrink-0 px-5 py-3 bg-white border-t border-gray-100">
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
      <div className="w-14 h-14 rounded-2xl bg-wine-50 border border-wine-100 flex items-center justify-center mb-4">
        <Mail className="w-6 h-6 text-wine-300" />
      </div>
      <p className="text-sm font-semibold text-gray-600">No email activity yet</p>
      <p className="text-xs text-gray-400 mt-1.5 max-w-[200px] leading-relaxed">
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
  const PREVIEW_LENGTH = 200
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
      <div className="flex-shrink-0 mt-[14px] z-10">
        <div className={`w-[21px] h-[21px] rounded-full bg-white border-2 ${cfg.borderColor} flex items-center justify-center shadow-sm`}>
          {isPending ? (
            <span className={`w-2 h-2 rounded-full ${cfg.dotColor} animate-pulse`} />
          ) : (
            <StatusIcon className={`w-3 h-3 ${cfg.textColor}`} />
          )}
        </div>
      </div>

      {/* Card */}
      <div className="flex-1 min-w-0">
        {/* Round + time */}
        <div className="flex items-center justify-between mb-1.5 px-0.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
              Round {conv.roundCount}
            </span>
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${cfg.bgColor} ${cfg.textColor} border ${cfg.borderColor}`}>
              <StatusIcon className="w-2.5 h-2.5" />
              {cfg.label}
            </span>
          </div>
          <span className="text-[10px] text-gray-400">{formatTime(conv.createdAt)}</span>
        </div>

        {/* Card body */}
        <div className={`bg-white rounded-xl border ${isLatest ? cfg.borderColor : 'border-gray-100'} overflow-hidden shadow-sm`}>

          {/* Email body */}
          {bodyText ? (
            <div className="px-4 py-3">
              <p className={`text-[11px] leading-relaxed whitespace-pre-wrap font-mono ${
                isDiscarded ? 'text-gray-400 line-through decoration-red-200 decoration-1' : 'text-gray-600'
              }`}>
                {displayText}
              </p>
              {isLong && (
                <button
                  type="button"
                  onClick={() => setExpanded(!expanded)}
                  className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-wine-600 hover:text-wine-800 transition-colors"
                >
                  <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                    <ChevronDown className="w-3 h-3" />
                  </motion.div>
                  {expanded ? 'Show less' : `Show full email`}
                </button>
              )}
            </div>
          ) : (
            <div className="px-4 py-3">
              <p className="text-[11px] text-gray-400 italic">No content available</p>
            </div>
          )}

          {/* Footer meta bar */}
          <div className={`px-4 py-2 flex items-center justify-between border-t ${isLatest ? cfg.borderColor : 'border-gray-50'} bg-gray-50/60`}>
            <div className="flex items-center gap-3 min-w-0">
              {isSent && conv.sentAt && (
                <div className="flex items-center gap-1 min-w-0">
                  <CheckCircle className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                  <span className="text-[10px] text-gray-400 truncate">
                    {formatSentAt(conv.sentAt)}
                    {conv.providerEmail && (
                      <span className="text-gray-300"> → {conv.providerEmail}</span>
                    )}
                  </span>
                </div>
              )}
              {isPending && (
                <span className="inline-flex items-center gap-1 text-[10px] text-wine-500 font-medium">
                  <Sparkles className="w-2.5 h-2.5" />
                  AI-generated
                </span>
              )}
              {isDiscarded && (
                <span className="text-[10px] text-red-400 font-medium">Never sent</span>
              )}
              {isSent && (
                <span className="text-[10px] text-gray-400 flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  Awaiting reply
                </span>
              )}
            </div>

            {bodyText && (
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-700 transition-colors flex-shrink-0 ml-2"
                title="Copy to clipboard"
              >
                {copied
                  ? <><Check className="w-3 h-3 text-emerald-500" /><span className="text-emerald-500">Copied</span></>
                  : <><Copy className="w-3 h-3" />Copy</>
                }
              </button>
            )}
          </div>

          {/* Inline action for discarded */}
          {isLatest && !isCancelled && isDiscarded && (
            <div className="px-4 py-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => { onClose(); setTimeout(onOpenDraftPanel, 150) }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-wine-50 hover:bg-wine-100 text-wine-700 text-xs font-semibold rounded-lg border border-wine-200 transition-colors"
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
