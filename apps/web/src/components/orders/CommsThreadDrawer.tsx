import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Send, Clock, CheckCircle, Loader2, RefreshCw,
  MailOpen, ChevronDown, Copy, Check, Sparkles, Ban,
  ArrowRight, MessageSquare, Activity,
} from 'lucide-react'
import { useOrderConversations, type OrderConversationDto } from '../../hooks/queries/useDraftEmailQueries'

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, {
  label: string
  textColor: string
  bgColor: string
  borderColor: string
  dotBg: string
  dotBorder: string
  icon: React.ComponentType<any>
}> = {
  PENDING_APPROVAL: {
    label: 'Draft Ready',
    textColor: 'text-wine-700',
    bgColor: 'bg-wine-50',
    borderColor: 'border-wine-200',
    dotBg: 'bg-wine-500',
    dotBorder: 'border-wine-300',
    icon: Sparkles,
  },
  DISCARDED: {
    label: 'Discarded',
    textColor: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    dotBg: 'bg-red-400',
    dotBorder: 'border-red-300',
    icon: Ban,
  },
  SENT: {
    label: 'Sent',
    textColor: 'text-emerald-700',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    dotBg: 'bg-emerald-500',
    dotBorder: 'border-emerald-300',
    icon: Send,
  },
  AUTO_SENT: {
    label: 'Auto-Sent',
    textColor: 'text-emerald-700',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    dotBg: 'bg-emerald-500',
    dotBorder: 'border-emerald-300',
    icon: Send,
  },
  APPROVED: {
    label: 'Sent',
    textColor: 'text-emerald-700',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    dotBg: 'bg-emerald-500',
    dotBorder: 'border-emerald-300',
    icon: Send,
  },
  COMPLETED: {
    label: 'Completed',
    textColor: 'text-emerald-700',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    dotBg: 'bg-emerald-500',
    dotBorder: 'border-emerald-300',
    icon: CheckCircle,
  },
  CLOSED: {
    label: 'Closed',
    textColor: 'text-gray-500',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    dotBg: 'bg-gray-400',
    dotBorder: 'border-gray-300',
    icon: MailOpen,
  },
}

const getStatusConfig = (status: string) =>
  STATUS_CONFIG[status] ?? {
    label: status,
    textColor: 'text-gray-500',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    dotBg: 'bg-gray-400',
    dotBorder: 'border-gray-300',
    icon: Clock,
  }

function fmtTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function initials(name?: string | null): string {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface CommsThreadDrawerProps {
  orderId: string | null
  orderWineName?: string
  orderStatus?: string
  isOpen: boolean
  onClose: () => void
  onOpenDraftPanel: () => void
}

// ─── Drawer ───────────────────────────────────────────────────────────────────
export function CommsThreadDrawer({
  orderId,
  orderWineName,
  orderStatus,
  isOpen,
  onClose,
  onOpenDraftPanel,
}: CommsThreadDrawerProps) {
  const [activeTab, setActiveTab] = useState<'thread' | 'activity'>('thread')
  const { data: conversations = [], isLoading } = useOrderConversations(isOpen ? orderId : null)

  const isCancelled = orderStatus === 'cancelled'
  const isDelivered = orderStatus === 'delivered'
  const pendingConv = conversations.find(c => c.status === 'PENDING_APPROVAL')
  const providerName = conversations[0]?.providerName
  const providerEmail = conversations[0]?.providerEmail
  const sentConvs = conversations.filter(c => ['SENT', 'AUTO_SENT', 'APPROVED', 'COMPLETED', 'CLOSED'].includes(c.status))

  return (
    <>
      {/* Backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-40"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      {/* Drawer */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed top-0 right-0 h-full w-[480px] z-50 flex flex-col bg-white shadow-2xl border-l border-gray-200"
          >
            {/* ── Header ── */}
            <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 pt-3.5 pb-3">
              {/* Top row */}
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-[22px] h-[22px] bg-wine-700 rounded-md flex items-center justify-center flex-shrink-0">
                    <MessageSquare className="w-3 h-3 text-white" />
                  </div>
                  <span className="text-[10px] font-bold text-wine-700 uppercase tracking-widest">
                    Provider Comms
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Wine name */}
              <p className="text-[13px] font-bold text-gray-900 tracking-tight mb-2 leading-tight">
                {orderWineName ?? 'Order'}
              </p>

              {/* Provider chip + status tags */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  {providerName ? (
                    <span className="inline-flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full pl-[3px] pr-2.5 py-[3px]">
                      <span className="w-5 h-5 rounded-full bg-wine-800 flex items-center justify-center text-[9px] font-black text-white flex-shrink-0">
                        {initials(providerName)}
                      </span>
                      <span className="text-[11.5px] font-medium text-gray-700 truncate max-w-[140px]">{providerName}</span>
                      {providerEmail && (
                        <span className="text-[10px] text-gray-400 truncate max-w-[120px] hidden sm:block">{providerEmail}</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-[11px] text-gray-400">No provider assigned</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {isCancelled && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-600 text-[10px] font-semibold">
                      <Ban className="w-2.5 h-2.5" /> Cancelled
                    </span>
                  )}
                  {isDelivered && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-semibold">
                      <CheckCircle className="w-2.5 h-2.5" /> Delivered
                    </span>
                  )}
                  {pendingConv && !isCancelled && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-wine-50 border border-wine-200 text-wine-700 text-[10px] font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-wine-500 animate-pulse" />
                      Review needed
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* ── Tab bar ── */}
            <div className="flex-shrink-0 flex border-b border-gray-200 bg-white">
              <TabBtn active={activeTab === 'thread'} onClick={() => setActiveTab('thread')} badge={conversations.length}>
                <MessageSquare className="w-3 h-3" /> Thread
              </TabBtn>
              <TabBtn active={activeTab === 'activity'} onClick={() => setActiveTab('activity')}>
                <Activity className="w-3 h-3" /> Activity
              </TabBtn>
            </div>

            {/* ── Meta strip ── */}
            {conversations.length > 0 && (
              <div className="flex-shrink-0 flex items-center justify-between px-4 py-1.5 bg-gray-50 border-b border-gray-200">
                <span className="text-[11px] text-gray-500 font-medium">
                  {conversations.length} round{conversations.length !== 1 ? 's' : ''} · {sentConvs.length} sent
                </span>
                {orderId && (
                  <span className="text-[10px] font-mono font-semibold text-gray-500 bg-gray-200 rounded px-1.5 py-0.5">
                    #{orderId.slice(0, 8)}
                  </span>
                )}
              </div>
            )}

            {/* ── Body ── */}
            <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#e5e7eb transparent' }}>
              {isLoading ? (
                <div className="flex items-center justify-center py-24">
                  <Loader2 className="w-5 h-5 text-wine-300 animate-spin" />
                </div>
              ) : conversations.length === 0 ? (
                <EmptyState />
              ) : activeTab === 'thread' ? (
                <ThreadTab
                  conversations={conversations}
                  isCancelled={isCancelled}
                  onOpenDraftPanel={onOpenDraftPanel}
                  onClose={onClose}
                />
              ) : (
                <ActivityTab conversations={conversations} />
              )}
            </div>

            {/* ── Sticky CTA ── */}
            <AnimatePresence>
              {pendingConv && !isCancelled && (
                <motion.div
                  initial={{ y: 56, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 56, opacity: 0 }}
                  transition={{ type: 'spring', damping: 28, stiffness: 280 }}
                  className="flex-shrink-0 px-4 py-3.5 bg-white border-t border-gray-100 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]"
                >
                  <button
                    type="button"
                    onClick={() => { onClose(); setTimeout(onOpenDraftPanel, 150) }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 bg-wine-700 hover:bg-wine-800 active:bg-wine-900 text-white text-sm font-semibold rounded-xl transition-colors shadow-md shadow-wine-200"
                  >
                    <Sparkles className="w-4 h-4 flex-shrink-0" />
                    Review & Approve Draft
                    <ArrowRight className="w-4 h-4 ml-auto opacity-60 flex-shrink-0" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Cancelled footer ── */}
            {isCancelled && conversations.length > 0 && (
              <div className="flex-shrink-0 px-4 py-2.5 bg-gray-50 border-t border-gray-100">
                <p className="text-[11px] text-gray-400 text-center">
                  Order cancelled — full history preserved for audit
                </p>
              </div>
            )}

            {/* ── Delivered summary note ── */}
            {isDelivered && conversations.some(c => c.rollingSummary) && (
              <div className="flex-shrink-0 px-4 py-2.5 bg-emerald-50 border-t border-emerald-100">
                <p className="text-[11px] text-emerald-700 text-center font-medium">
                  Delivered — summary saved to Communications history
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

// ─── Tab button ───────────────────────────────────────────────────────────────
function TabBtn({ active, onClick, badge, children }: {
  active: boolean
  onClick: () => void
  badge?: number
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
        active
          ? 'text-wine-700 border-wine-700 font-semibold'
          : 'text-gray-500 border-transparent hover:text-gray-700'
      }`}
      style={{ marginBottom: '-1px' }}
    >
      {children}
      {badge != null && badge > 0 && (
        <span className={`inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold ${
          active ? 'bg-wine-100 text-wine-700' : 'bg-gray-100 text-gray-500'
        }`}>
          {badge}
        </span>
      )}
    </button>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-8 text-center">
      <div className="w-12 h-12 rounded-xl bg-wine-50 border border-wine-100 flex items-center justify-center mb-3">
        <MessageSquare className="w-5 h-5 text-wine-300" />
      </div>
      <p className="text-sm font-semibold text-gray-600">No email activity yet</p>
      <p className="text-xs text-gray-400 mt-1 max-w-[200px] leading-relaxed">
        AI drafts will appear here once this order is processed.
      </p>
    </div>
  )
}

// ─── Thread tab (activity-feed rows) ─────────────────────────────────────────
function ThreadTab({ conversations, isCancelled, onOpenDraftPanel, onClose }: {
  conversations: OrderConversationDto[]
  isCancelled: boolean
  onOpenDraftPanel: () => void
  onClose: () => void
}) {
  return (
    <div className="py-3">
      {conversations.map((conv, idx) => (
        <ThreadEvent
          key={conv.id}
          conv={conv}
          isLast={idx === conversations.length - 1}
          isLatest={idx === conversations.length - 1}
          isCancelled={isCancelled}
          onOpenDraftPanel={onOpenDraftPanel}
          onClose={onClose}
          defaultOpen={idx === conversations.length - 1}
        />
      ))}
    </div>
  )
}

// ─── Single timeline event ────────────────────────────────────────────────────
function ThreadEvent({ conv, isLast, isLatest, isCancelled, onOpenDraftPanel, onClose, defaultOpen }: {
  conv: OrderConversationDto
  isLast: boolean
  isLatest: boolean
  isCancelled: boolean
  onOpenDraftPanel: () => void
  onClose: () => void
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [copied, setCopied] = useState(false)

  const cfg = getStatusConfig(conv.status)
  const StatusIcon = cfg.icon
  const isPending = conv.status === 'PENDING_APPROVAL'
  const isDiscarded = conv.status === 'DISCARDED'
  const isSent = ['SENT', 'AUTO_SENT', 'APPROVED'].includes(conv.status)
  const bodyText = conv.draftContent || conv.rollingSummary || ''

  const handleCopy = () => {
    if (!bodyText) return
    navigator.clipboard.writeText(bodyText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative flex px-4 group">
      {/* Spine */}
      <div className="flex-shrink-0 flex flex-col items-center w-8 mr-3">
        {/* Dot */}
        <div className={`w-5 h-5 rounded-full border-2 ${cfg.dotBorder} bg-white flex items-center justify-center z-10 mt-3 flex-shrink-0 shadow-sm`}>
          {isPending ? (
            <span className={`w-2 h-2 rounded-full ${cfg.dotBg} animate-pulse`} />
          ) : (
            <StatusIcon className={`w-2.5 h-2.5 ${cfg.textColor}`} />
          )}
        </div>
        {/* Connector line */}
        {!isLast && <div className="w-px flex-1 bg-gray-200 mt-1" />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-4">
        {/* Collapsed row — always visible, click to toggle */}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between py-3 text-left group/btn"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${cfg.bgColor} ${cfg.textColor} ${cfg.borderColor}`}>
              <StatusIcon className="w-2.5 h-2.5" />
              {cfg.label}
            </span>
            <span className="text-[11px] text-gray-400 font-medium">Round {conv.roundCount}</span>
            {isPending && (
              <span className="text-[10px] text-wine-500 font-semibold">· Needs review</span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
            <span className="text-[10px] text-gray-400">{fmtTime(conv.createdAt)}</span>
            <motion.div
              animate={{ rotate: open ? 180 : 0 }}
              transition={{ duration: 0.18 }}
              className="text-gray-400"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </motion.div>
          </div>
        </button>

        {/* Expanded body */}
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className={`rounded-xl border ${isLatest ? cfg.borderColor : 'border-gray-100'} overflow-hidden mb-1`}>
                {/* Body */}
                {bodyText ? (
                  <div className={`px-3 py-2.5 ${isLatest ? cfg.bgColor : 'bg-gray-50'}`}>
                    <p className={`text-[11px] font-mono leading-relaxed whitespace-pre-wrap ${
                      isDiscarded ? 'text-gray-400 line-through decoration-red-300 decoration-1' : 'text-gray-700'
                    }`}>
                      {bodyText}
                    </p>
                  </div>
                ) : (
                  <div className="px-3 py-2.5 bg-gray-50">
                    <p className="text-[11px] text-gray-400 italic">No content recorded</p>
                  </div>
                )}

                {/* Footer row */}
                <div className="flex items-center justify-between px-3 py-2 bg-white border-t border-gray-100">
                  <div className="flex items-center gap-2.5">
                    {isSent && conv.sentAt && (
                      <span className="flex items-center gap-1 text-[10px] text-gray-500">
                        <CheckCircle className="w-3 h-3 text-emerald-500" />
                        {fmtDate(conv.sentAt)}
                        {conv.providerEmail && <span className="text-gray-400">→ {conv.providerEmail}</span>}
                      </span>
                    )}
                    {isSent && (
                      <span className="flex items-center gap-1 text-[10px] text-gray-400">
                        <Clock className="w-2.5 h-2.5" /> Awaiting reply
                      </span>
                    )}
                    {isPending && (
                      <span className="flex items-center gap-1 text-[10px] text-wine-500 font-medium">
                        <Sparkles className="w-2.5 h-2.5" /> AI-generated
                      </span>
                    )}
                    {isDiscarded && (
                      <span className="text-[10px] text-red-500 font-medium">Never sent</span>
                    )}
                  </div>
                  {bodyText && (
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-700 transition-colors"
                    >
                      {copied
                        ? <><Check className="w-3 h-3 text-emerald-500" /><span className="text-emerald-500">Copied</span></>
                        : <><Copy className="w-3 h-3" />Copy</>
                      }
                    </button>
                  )}
                </div>

                {/* Discarded inline action */}
                {isLatest && !isCancelled && isDiscarded && (
                  <div className="px-3 py-2.5 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => { onClose(); setTimeout(onOpenDraftPanel, 150) }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-wine-50 hover:bg-wine-100 text-wine-700 text-xs font-semibold rounded-lg border border-wine-200 transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" /> Request New Draft
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ─── Activity tab (flat audit log) ───────────────────────────────────────────
function ActivityTab({ conversations }: { conversations: OrderConversationDto[] }) {
  const events: { time: string; label: string; detail?: string; color: string }[] = []

  conversations.forEach(conv => {
    if (conv.status === 'PENDING_APPROVAL') {
      events.push({ time: conv.createdAt, label: `Round ${conv.roundCount} — AI draft generated`, color: 'text-wine-600' })
    } else if (conv.status === 'DISCARDED') {
      events.push({ time: conv.createdAt, label: `Round ${conv.roundCount} — Draft discarded`, color: 'text-red-500' })
    } else if (['SENT', 'AUTO_SENT', 'APPROVED'].includes(conv.status)) {
      const auto = conv.status === 'AUTO_SENT' ? ' (auto)' : ''
      events.push({
        time: conv.sentAt ?? conv.createdAt,
        label: `Round ${conv.roundCount} — Email sent${auto}`,
        detail: conv.providerEmail ? `→ ${conv.providerEmail}` : undefined,
        color: 'text-emerald-600',
      })
    } else if (['COMPLETED', 'CLOSED'].includes(conv.status)) {
      events.push({
        time: conv.sentAt ?? conv.createdAt,
        label: `Round ${conv.roundCount} — Conversation closed`,
        detail: conv.rollingSummary ? conv.rollingSummary.slice(0, 80) + '…' : undefined,
        color: 'text-gray-500',
      })
    }
  })

  events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-[11px] text-gray-400">No activity recorded</p>
      </div>
    )
  }

  return (
    <div className="py-4 px-4 space-y-0">
      {events.map((ev, i) => (
        <div key={i} className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
          <span className="text-[10px] text-gray-400 font-medium w-14 flex-shrink-0 pt-0.5 tabular-nums">
            {fmtTime(ev.time)}
          </span>
          <div className="flex-1 min-w-0">
            <p className={`text-[11.5px] font-medium ${ev.color}`}>{ev.label}</p>
            {ev.detail && (
              <p className="text-[10px] text-gray-400 mt-0.5 truncate">{ev.detail}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
