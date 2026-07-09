import { useState, useEffect, useRef, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { useToast } from '../../contexts/ToastContext'
import {
  X, Send, Clock, CheckCircle, Loader2, RefreshCw,
  MailOpen, ChevronDown, Copy, Check, Sparkles, Ban,
  ArrowRight, MessageSquare, Activity, Mail, Pause, Play, Bot, PenLine, XCircle,
  AlertTriangle, MailSearch, ShieldCheck, ShieldAlert, FileText,
  Filter, Tag, Download, Image as ImageIcon, FileSpreadsheet, FileType2, File as FileIcon,
} from 'lucide-react'
import {
  useOrderConversations,
  useGenerateAiReply,
  useManualReply,
  useToggleAiPaused,
  useCancelScheduledSend,
  useRegenerateDraft,
  useDealProposal,
  useConfirmDeal,
  useDismissDeal,
  useForceFetchReplies,
  useOrderAttachments,
  orderConversationKeys,
  dealProposalKeys,
  type OrderConversationDto,
  type OrderAttachmentDto,
} from '../../hooks/queries/useDraftEmailQueries'
import { DealApprovalModal } from './DealApprovalModal'

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
  AUTO_SEND_SCHEDULED: {
    label: 'Auto-sending',
    textColor: 'text-amber-700',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    dotBg: 'bg-amber-500',
    dotBorder: 'border-amber-300',
    icon: Clock,
  },
  AUTO_SENDING: {
    label: 'Sending…',
    textColor: 'text-amber-700',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    dotBg: 'bg-amber-500',
    dotBorder: 'border-amber-300',
    icon: Loader2,
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
  PROVIDER_REPLY: {
    label: 'Provider Reply',
    textColor: 'text-blue-700',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    dotBg: 'bg-blue-500',
    dotBorder: 'border-blue-300',
    icon: Mail,
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
  const [replyError, setReplyError] = useState<string | null>(null)
  const [showManualComposer, setShowManualComposer] = useState(false)
  const [manualText, setManualText] = useState('')
  const { data: conversations = [], isLoading } = useOrderConversations(isOpen ? orderId : null)
  // D2 — persisted attachments for this order, grouped by the message they arrived on.
  const { data: orderAttachments = [] } = useOrderAttachments(isOpen ? orderId : null)
  const attachmentsByConv = useMemo(() => {
    const m = new Map<string, OrderAttachmentDto[]>()
    for (const a of orderAttachments) {
      const arr = m.get(a.conversationId) ?? []
      arr.push(a)
      m.set(a.conversationId, arr)
    }
    return m
  }, [orderAttachments])
  const generateAiReply = useGenerateAiReply()
  const manualReply = useManualReply()
  const toggleAiPaused = useToggleAiPaused()
  const cancelScheduledSend = useCancelScheduledSend()
  const regenerateDraft = useRegenerateDraft()

  const isCancelled = orderStatus === 'cancelled'
  const isDelivered = orderStatus === 'delivered'
  const pendingConv = conversations.find(c => c.status === 'PENDING_APPROVAL' && c.direction !== 'INBOUND')
  const scheduledConv = conversations.find(c => c.status === 'AUTO_SEND_SCHEDULED' && c.direction !== 'INBOUND')
  const aiPaused = conversations[0]?.aiPaused ?? false
  const providerName = conversations[0]?.providerName
  const providerEmail = conversations[0]?.providerEmail
  // Header trust signal: did the vendor's most recent inbound email pass DKIM/DMARC?
  // null when there is no inbound yet or the row predates Phase 0 transport capture.
  const senderVerified = [...conversations].reverse().find(c => c.direction === 'INBOUND')?.senderVerified ?? null
  const sentConvs = conversations.filter(c => ['SENT', 'AUTO_SENT', 'APPROVED', 'COMPLETED', 'CLOSED'].includes(c.status))

  // The latest message being a vendor reply (with no AI draft waiting yet) is the
  // cue that it's our move — surface a one-tap "Draft AI Reply" action.
  const latestConv = conversations[conversations.length - 1]
  const awaitingReply =
    !!latestConv && latestConv.direction === 'INBOUND' && !pendingConv && !scheduledConv && !isCancelled && !isDelivered

  // Live countdown for the 2-minute auto-send undo window.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!scheduledConv?.scheduledSendAt) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [scheduledConv?.scheduledSendAt])
  const secondsToAutoSend = scheduledConv?.scheduledSendAt
    ? Math.max(0, Math.round((new Date(scheduledConv.scheduledSendAt).getTime() - now) / 1000))
    : 0

  const busy = generateAiReply.isPending || regenerateDraft.isPending || manualReply.isPending

  const handleDraftAiReply = () => {
    if (!orderId) return
    setReplyError(null)
    generateAiReply.mutate(orderId, {
      onSuccess: (res) => {
        if (!res.triggered && res.reason) setReplyError(res.reason)
      },
      onError: () => setReplyError('Could not draft a reply. Please try again.'),
    })
  }

  const handleRegenerate = () => {
    if (!orderId) return
    setReplyError(null)
    regenerateDraft.mutate({ orderId }, {
      onSuccess: (res) => {
        if (!res.triggered && res.reason) setReplyError(res.reason)
      },
      onError: () => setReplyError('Could not regenerate the draft. Please try again.'),
    })
  }

  const handleTogglePause = () => {
    if (!orderId) return
    toggleAiPaused.mutate({ orderId, paused: !aiPaused })
  }

  const handleCancelScheduled = () => {
    if (!orderId) return
    cancelScheduledSend.mutate(orderId)
  }

  const handleSendManual = () => {
    if (!orderId || !manualText.trim()) return
    setReplyError(null)
    manualReply.mutate(
      { orderId, content: manualText.trim() },
      {
        onSuccess: () => { setManualText(''); setShowManualComposer(false) },
        onError: () => setReplyError('Could not send your reply. Please try again.'),
      },
    )
  }

  // ── AI deal proposal (offer / verification → approval modal) ──────────────
  const { data: dealProposal } = useDealProposal(isOpen ? orderId : null)
  const confirmDeal = useConfirmDeal()
  const dismissDeal = useDismissDeal()
  const [showDealModal, setShowDealModal] = useState(false)
  const [autoOpenedDealId, setAutoOpenedDealId] = useState<string | null>(null)

  // Urgent deals (limited stock / expiring promo) pop the modal automatically — once.
  useEffect(() => {
    if (dealProposal?.urgency === 'urgent' && dealProposal.conversationId !== autoOpenedDealId) {
      setShowDealModal(true)
      setAutoOpenedDealId(dealProposal.conversationId)
    }
  }, [dealProposal?.conversationId, dealProposal?.urgency, autoOpenedDealId])

  const handleConfirmDeal = (finalPrice: number, quantity: number) => {
    if (!orderId) return
    confirmDeal.mutate(
      { orderId, finalPrice, quantity, sendConfirmation: true },
      { onSuccess: () => setShowDealModal(false) },
    )
  }
  const handleDismissDeal = () => {
    if (!orderId) return
    dismissDeal.mutate(orderId, { onSuccess: () => setShowDealModal(false) })
  }
  const handleAskForMore = () => {
    if (!orderId) return
    setShowDealModal(false)
    dismissDeal.mutate(orderId)
    regenerateDraft.mutate({
      orderId,
      instruction: 'Politely ask the vendor to clarify or confirm the remaining details (final price, quantity, and delivery timing) before we commit.',
    })
  }

  // ── Live refresh + reply notifications + capture fallback ─────────────────
  const queryClient = useQueryClient()
  const toast = useToast()
  const forceFetch = useForceFetchReplies()

  // When the bridge emits a conversation update, refetch this order's thread + deal.
  useEffect(() => {
    if (!orderId) return
    const onChange = () => {
      queryClient.invalidateQueries({ queryKey: orderConversationKeys.byOrder(orderId) })
      queryClient.invalidateQueries({ queryKey: dealProposalKeys.byOrder(orderId) })
    }
    window.addEventListener('conversation_change', onChange)
    return () => window.removeEventListener('conversation_change', onChange)
  }, [orderId, queryClient])

  // Toast the moment a new vendor reply lands in this thread.
  const prevInboundCount = useRef<number | null>(null)
  useEffect(() => {
    const inboundCount = conversations.filter(c => c.direction === 'INBOUND').length
    if (prevInboundCount.current !== null && inboundCount > prevInboundCount.current) {
      toast.info(`New reply from ${providerName || 'the provider'} — the AI is reading it now.`)
    }
    prevInboundCount.current = inboundCount
  }, [conversations.length])

  const handleCheckReplies = () => {
    forceFetch.mutate(undefined, {
      onSuccess: (res) => {
        const n = res?.processed ?? res?.fetched ?? 0
        toast.info(n ? `Pulled ${n} new message${n === 1 ? '' : 's'}.` : 'No new replies yet.')
      },
      onError: () => toast.error('Could not check for replies. Try again.'),
    })
  }

  // ── Approve-gating: act only on the latest, summarized reply ──────────────
  const latestInbound = [...conversations].reverse().find(c => c.direction === 'INBOUND')
  const latestInboundAnalyzed = !!latestInbound?.detectedIntent
  // A pending draft is stale if a newer inbound reply hasn't been analyzed yet.
  const pendingStale = !!pendingConv && conversations.some(c =>
    c.direction === 'INBOUND' && !c.detectedIntent &&
    new Date(c.createdAt).getTime() > new Date(pendingConv.createdAt).getTime(),
  )
  // Latest message is a reply the AI hasn't summarized yet (no draft/deal staged).
  const awaitingAnalysis = !!latestInbound && !latestInboundAnalyzed && !pendingConv && !scheduledConv && !dealProposal && !isCancelled && !isDelivered

  // ── P6 triage card: surface the classification of the latest inbound + escape hatches ──
  // Show it when the AI filed the message instead of drafting (automated/promo/catalogue/…)
  // so the manager can override with "Reply anyway" or "Treat as offer".
  const triage = latestInbound?.classification ?? null
  const gateSkipped =
    !!triage && (triage.is_automated === true || (!!triage.email_class && triage.email_class !== 'negotiation_reply'))
  const showTriageCard =
    !!triage && gateSkipped && latestInboundAnalyzed && !pendingConv && !scheduledConv && !dealProposal && !isCancelled && !isDelivered

  const handleReplyAnyway = () => {
    if (!orderId) return
    setReplyError(null)
    generateAiReply.mutate(
      { orderId, force: true },
      {
        onSuccess: (res) => { if (!res.triggered && res.reason) setReplyError(res.reason) },
        onError: () => setReplyError('Could not draft a reply. Please try again.'),
      },
    )
  }
  const handleTreatAsOffer = () => {
    if (!orderId) return
    setReplyError(null)
    generateAiReply.mutate(
      {
        orderId,
        force: true,
        instruction:
          'Treat this vendor email as a concrete, decision-ready commercial offer: extract the commercial terms (price, quantity, MOQ, validity) and, if they are complete enough to act on, prepare it as a deal for my approval.',
      },
      {
        onSuccess: (res) => { if (!res.triggered && res.reason) setReplyError(res.reason) },
        onError: () => setReplyError('Could not process this as an offer. Please try again.'),
      },
    )
  }

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
                      {senderVerified === true && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-emerald-700" title="Sender passed DKIM/DMARC authentication">
                          <ShieldCheck className="w-3 h-3" /> Verified
                        </span>
                      )}
                      {senderVerified === false && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-amber-700" title="Sender failed DKIM/DMARC — replies need your approval">
                          <ShieldAlert className="w-3 h-3" /> Unverified
                        </span>
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

              {/* AI autonomy control — pause/resume the AI for this order */}
              {!isCancelled && !isDelivered && conversations.length > 0 && (
                <div className="mt-2 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-medium">
                    <Bot className={`w-3 h-3 ${aiPaused ? 'text-gray-400' : 'text-wine-600'}`} />
                    <span className={aiPaused ? 'text-gray-400' : 'text-wine-700'}>
                      {aiPaused ? 'AI paused for this order' : 'AI is handling this order'}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={handleTogglePause}
                    disabled={toggleAiPaused.isPending}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold border transition-colors disabled:opacity-60 ${
                      aiPaused
                        ? 'bg-wine-50 border-wine-200 text-wine-700 hover:bg-wine-100'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {aiPaused ? <><Play className="w-3 h-3" /> Resume AI</> : <><Pause className="w-3 h-3" /> Pause AI</>}
                  </button>
                </div>
              )}
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
                <div className="flex items-center gap-2">
                  {!isCancelled && !isDelivered && (
                    <button
                      type="button"
                      onClick={handleCheckReplies}
                      disabled={forceFetch.isPending}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-500 hover:text-wine-700 disabled:opacity-60 transition-colors"
                      title="Pull any new vendor replies from email"
                    >
                      {forceFetch.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <MailSearch className="w-3 h-3" />}
                      Check for replies
                    </button>
                  )}
                  {orderId && (
                    <span className="text-[10px] font-mono font-semibold text-gray-500 bg-gray-200 rounded px-1.5 py-0.5">
                      #{orderId.slice(0, 8)}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* ── Triage card (P6) — AI filed this instead of replying ── */}
            {showTriageCard && triage && (
              <TriageCard
                triage={triage}
                busy={busy}
                onReplyAnyway={handleReplyAnyway}
                onTreatAsOffer={handleTreatAsOffer}
              />
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
                  attachmentsByConv={attachmentsByConv}
                  isCancelled={isCancelled}
                  onOpenDraftPanel={onOpenDraftPanel}
                  onClose={onClose}
                />
              ) : (
                <ActivityTab conversations={conversations} />
              )}
            </div>

            {/* ── AI deal CTA (offer / verification ready to confirm) ── */}
            {dealProposal && !isCancelled && !isDelivered && (
              <div className="flex-shrink-0 px-4 py-3 bg-wine-50 border-t border-wine-200">
                <button
                  type="button"
                  onClick={() => setShowDealModal(true)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 bg-wine-700 hover:bg-wine-800 active:bg-wine-900 text-white text-sm font-semibold rounded-xl transition-colors shadow-md shadow-wine-200"
                >
                  <Sparkles className="w-4 h-4 flex-shrink-0" />
                  {dealProposal.dealKind === 'verification' ? 'Vendor confirmed — verify the order' : 'AI found an offer to confirm'}
                  <ArrowRight className="w-4 h-4 ml-auto opacity-60 flex-shrink-0" />
                </button>
                <p className="mt-1.5 text-[10px] text-center text-wine-700/80">
                  {dealProposal.providerName} · {dealProposal.quantity} bottles · ${dealProposal.finalPrice.toFixed(2)}/bottle
                  {dealProposal.urgency === 'urgent' ? ' · time-sensitive' : ''}
                </p>
              </div>
            )}

            {/* ── Sticky footer: composer / auto-send countdown / CTAs ── */}
            {!isCancelled && !isDelivered && (
              <div className="flex-shrink-0 bg-white border-t border-gray-100 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
                {showManualComposer ? (
                  /* ── Manual reply composer ── */
                  <div className="px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-700">
                        <PenLine className="w-3.5 h-3.5 text-wine-600" /> Your reply to {providerName || 'the provider'}
                      </span>
                      <button
                        type="button"
                        onClick={() => { setShowManualComposer(false); setManualText('') }}
                        className="text-gray-400 hover:text-gray-600"
                        aria-label="Close composer"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                    {/* To / Subject — email-composer identity (sketch 6b) */}
                    <div className="mb-2 border border-gray-200 rounded-lg overflow-hidden">
                      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-gray-100">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 w-12 flex-shrink-0">To</span>
                        {(providerName || providerEmail) ? (
                          <span className="inline-flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full pl-[3px] pr-2 py-[2px] min-w-0">
                            <span className="w-4 h-4 rounded-full bg-wine-800 flex items-center justify-center text-[8px] font-black text-white flex-shrink-0">{initials(providerName || 'P')}</span>
                            <span className="text-[10.5px] font-medium text-gray-700 truncate">{providerName || providerEmail}</span>
                          </span>
                        ) : (
                          <span className="text-[10.5px] text-gray-400">the provider</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 px-2.5 py-1.5">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 w-12 flex-shrink-0">Subject</span>
                        <span className="text-[10.5px] font-medium text-gray-700 truncate">Re: Order — {orderWineName ?? 'Wine'}</span>
                      </div>
                    </div>
                    <textarea
                      value={manualText}
                      onChange={(e) => setManualText(e.target.value)}
                      rows={5}
                      autoFocus
                      placeholder="Write your message to the provider… (sent in the same email thread)"
                      aria-label="Manual reply body"
                      className="w-full text-[12px] leading-relaxed text-gray-800 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-wine-200 focus:border-wine-300 resize-none"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSendManual}
                        disabled={!manualText.trim() || manualReply.isPending}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-wine-700 hover:bg-wine-800 active:bg-wine-900 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
                      >
                        {manualReply.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        {manualReply.isPending ? 'Sending…' : 'Send reply'}
                      </button>
                    </div>
                    {replyError && <p className="mt-1.5 text-[10px] text-center text-red-500 font-medium">{replyError}</p>}
                  </div>
                ) : scheduledConv ? (
                  /* ── Auto-send countdown (undo window) ── */
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 mb-2">
                      <Loader2 className="w-3.5 h-3.5 text-amber-600 animate-spin flex-shrink-0" />
                      <span className="text-[11px] font-medium text-amber-800">
                        AI is auto-sending this reply in {secondsToAutoSend}s
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleCancelScheduled}
                      disabled={cancelScheduledSend.isPending}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
                    >
                      {cancelScheduledSend.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                      Cancel &amp; review instead
                    </button>
                    <p className="mt-1.5 text-[10px] text-center text-gray-400">
                      Cancelling keeps it as a draft for you to edit and approve.
                    </p>
                  </div>
                ) : (pendingStale || awaitingAnalysis) ? (
                  /* ── Gate: reply received but not yet summarized ── */
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-wine-50 border border-wine-200">
                      <Loader2 className="w-4 h-4 text-wine-600 animate-spin flex-shrink-0" />
                      <span className="text-[12px] font-medium text-wine-800">AI is reading the latest reply…</span>
                    </div>
                    <p className="mt-1.5 text-[10px] text-center text-gray-400">
                      {pendingStale
                        ? 'A newer reply arrived — approval is paused until it’s summarized.'
                        : 'You can approve once the AI has summarized this reply.'}
                    </p>
                    <button
                      type="button"
                      onClick={handleCheckReplies}
                      disabled={forceFetch.isPending}
                      className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-semibold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-60 transition-colors"
                    >
                      {forceFetch.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MailSearch className="w-3.5 h-3.5" />} Check again
                    </button>
                  </div>
                ) : pendingConv ? (
                  /* ── AI draft awaiting approval ── */
                  <div className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => { onClose(); setTimeout(onOpenDraftPanel, 150) }}
                      className="w-full flex items-center gap-2 px-4 py-2.5 bg-wine-700 hover:bg-wine-800 active:bg-wine-900 text-white text-sm font-semibold rounded-xl transition-colors shadow-md shadow-wine-200"
                    >
                      <Sparkles className="w-4 h-4 flex-shrink-0" />
                      Review &amp; Approve Draft
                      <ArrowRight className="w-4 h-4 ml-auto opacity-60 flex-shrink-0" />
                    </button>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleRegenerate}
                        disabled={busy}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-semibold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-60 transition-colors"
                      >
                        {regenerateDraft.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        Regenerate
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowManualComposer(true)}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-semibold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        <PenLine className="w-3.5 h-3.5" /> Write your own
                      </button>
                    </div>
                    {replyError && <p className="mt-1.5 text-[10px] text-center text-red-500 font-medium">{replyError}</p>}
                  </div>
                ) : awaitingReply ? (
                  /* ── Vendor replied; offer to draft or write ── */
                  <div className="px-4 py-3">
                    <button
                      type="button"
                      onClick={handleDraftAiReply}
                      disabled={busy}
                      className="w-full flex items-center gap-2 px-4 py-2.5 bg-wine-700 hover:bg-wine-800 active:bg-wine-900 disabled:opacity-70 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors shadow-md shadow-wine-200"
                    >
                      {generateAiReply.isPending ? (
                        <><Loader2 className="w-4 h-4 flex-shrink-0 animate-spin" /> AI is reading the reply &amp; drafting…</>
                      ) : (
                        <><Sparkles className="w-4 h-4 flex-shrink-0" /> Draft AI Reply <ArrowRight className="w-4 h-4 ml-auto opacity-60 flex-shrink-0" /></>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowManualComposer(true)}
                      className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-semibold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <PenLine className="w-3.5 h-3.5" /> Write your own reply
                    </button>
                    <p className="mt-1.5 text-[10px] text-center leading-snug">
                      {replyError ? (
                        <span className="text-red-500 font-medium">{replyError}</span>
                      ) : (
                        <span className="text-gray-400">AI reads the vendor&rsquo;s reply and writes the next message for you.</span>
                      )}
                    </p>
                  </div>
                ) : (conversations.length > 0 && providerEmail) ? (
                  /* ── Idle (awaiting vendor): let the manager write proactively ── */
                  <div className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setShowManualComposer(true)}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[12px] font-semibold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <PenLine className="w-3.5 h-3.5" /> Write a reply
                    </button>
                  </div>
                ) : null}
              </div>
            )}

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

      {/* AI deal-approval modal (offer / verification) */}
      <DealApprovalModal
        isOpen={showDealModal}
        deal={dealProposal ?? null}
        onConfirm={handleConfirmDeal}
        onDismiss={handleDismissDeal}
        onAskForMore={handleAskForMore}
        onClose={() => setShowDealModal(false)}
        isSubmitting={confirmDeal.isPending || dismissDeal.isPending}
      />
    </>
  )
}

// ─── Triage card (P6 — classification + manager escape hatches) ─────────────────
const CLASS_LABELS: Record<string, string> = {
  promotion: 'Marketing / promotion',
  catalogue_offer: 'Catalogue / portfolio',
  automated_transactional: 'Automated notification',
  bounce_autoreply: 'Auto-reply / bounce',
  order_confirmation: 'Order confirmation',
  negotiation_reply: 'Negotiation reply',
  other: 'Other',
}

function TriageCard({ triage, busy, onReplyAnyway, onTreatAsOffer }: {
  triage: NonNullable<OrderConversationDto['classification']>
  busy: boolean
  onReplyAnyway: () => void
  onTreatAsOffer: () => void
}) {
  const injection = triage.injection_suspected === true
  const label = (triage.email_class && CLASS_LABELS[triage.email_class]) || 'Filed'
  const conf = typeof triage.confidence === 'number' ? Math.round(triage.confidence * 100) : null

  return (
    <div className={`flex-shrink-0 px-4 py-3 border-b ${injection ? 'bg-red-50 border-red-200' : 'bg-blue-50/60 border-blue-100'}`}>
      <div className="flex items-start gap-2">
        <span className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${injection ? 'bg-red-100' : 'bg-blue-100'}`}>
          {injection ? <ShieldAlert className="w-3.5 h-3.5 text-red-600" /> : <Filter className="w-3.5 h-3.5 text-blue-600" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[11px] font-bold ${injection ? 'text-red-700' : 'text-blue-800'}`}>
              {injection ? 'Quarantined — possible prompt injection' : `AI filed this: ${label}`}
            </span>
            {!injection && (
              <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-blue-700 bg-blue-100 rounded-full px-1.5 py-0.5">
                <Tag className="w-2.5 h-2.5" /> no reply drafted
              </span>
            )}
            {conf != null && (
              <span className="text-[9px] font-medium text-gray-500">{conf}% confident</span>
            )}
            {triage.is_automated && !injection && (
              <span className="inline-flex items-center gap-1 text-[9px] font-medium text-gray-500">
                <Bot className="w-2.5 h-2.5" /> automated
              </span>
            )}
          </div>
          <p className={`text-[10.5px] mt-0.5 leading-snug ${injection ? 'text-red-600' : 'text-gray-500'}`}>
            {injection
              ? 'This email appeared to contain instructions aimed at the AI. Review it before acting — the AI will not reply to it.'
              : 'The AI understood this message but didn’t reply because of how it was classified. Override if it’s actually worth a response.'}
          </p>

          {!injection && (
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={onReplyAnyway}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border bg-white border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-60 transition-colors"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PenLine className="w-3.5 h-3.5" />}
                Reply anyway
              </button>
              <button
                type="button"
                onClick={onTreatAsOffer}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border bg-white border-wine-200 text-wine-700 hover:bg-wine-50 disabled:opacity-60 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" /> Treat as offer
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
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

// ─── Day grouping for the feed (sticky headers — 5a/7a calm-column style) ───────
function isSameDay(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false
  const da = new Date(a), db = new Date(b)
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate()
}
function formatDayHeader(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (isSameDay(iso, today.toISOString())) return 'Today'
  if (isSameDay(iso, yesterday.toISOString())) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

// ─── Thread tab (calm single-column feed with sticky day headers) ────────────────
function ThreadTab({ conversations, attachmentsByConv, isCancelled, onOpenDraftPanel, onClose }: {
  conversations: OrderConversationDto[]
  attachmentsByConv: Map<string, OrderAttachmentDto[]>
  isCancelled: boolean
  onOpenDraftPanel: () => void
  onClose: () => void
}) {
  return (
    <div className="pb-3">
      {conversations.map((conv, idx) => {
        const showDay = idx === 0 || !isSameDay(conversations[idx - 1]?.createdAt, conv.createdAt)
        return (
          <div key={conv.id}>
            {showDay && (
              <div className="sticky top-0 z-[5] px-4 py-1.5 bg-gray-50/95 backdrop-blur-sm border-y border-gray-100">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  {formatDayHeader(conv.createdAt)}
                </span>
              </div>
            )}
            <ThreadEvent
              conv={conv}
              attachments={attachmentsByConv.get(conv.id) ?? []}
              isLast={idx === conversations.length - 1}
              isLatest={idx === conversations.length - 1}
              isCancelled={isCancelled}
              onOpenDraftPanel={onOpenDraftPanel}
              onClose={onClose}
            />
          </div>
        )
      })}
    </div>
  )
}

// ─── Attachment cards (D2 — persisted vendor attachments) ───────────────────────
function formatBytes(n: number | null): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function fileTypeLabel(filename: string, mimeType: string | null): string {
  const ext = filename.includes('.') ? filename.split('.').pop()!.toUpperCase() : ''
  if (ext && ext.length <= 4) return ext
  const sub = mimeType?.split('/')[1]
  return sub ? sub.toUpperCase() : 'FILE'
}

// File-type family, driven off extension + MIME — each gets a distinct icon/tint.
type FileKind = 'pdf' | 'word' | 'sheet' | 'generic'

function fileKind(filename: string, mimeType: string | null): FileKind {
  const ext = (filename.includes('.') ? filename.split('.').pop() : '')?.toLowerCase() ?? ''
  const mime = mimeType ?? ''
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf'
  if (['doc', 'docx'].includes(ext) || mime.includes('wordprocessingml') || mime === 'application/msword') return 'word'
  if (['xls', 'xlsx', 'csv'].includes(ext) || mime.includes('spreadsheetml') || mime === 'application/vnd.ms-excel' || mime === 'text/csv') return 'sheet'
  return 'generic'
}

const FILE_KIND_STYLE: Record<FileKind, { Icon: typeof FileText; color: string }> = {
  pdf: { Icon: FileText, color: 'text-wine-600' },
  word: { Icon: FileType2, color: 'text-blue-600' },
  sheet: { Icon: FileSpreadsheet, color: 'text-emerald-600' },
  generic: { Icon: FileIcon, color: 'text-gray-500' },
}

// Rich file-displayer (7a): image attachments preview as a media card with a
// gradient filename overlay; everything else is a file card with a download affordance.
function AttachmentCards({ items }: { items: OrderAttachmentDto[] }) {
  if (!items.length) return null
  return (
    <div className="px-3 pt-1.5 pb-3 bg-white space-y-2">
      {items.map((a) => {
        const isImage = (a.mimeType ?? '').startsWith('image/')
        const meta = [fileTypeLabel(a.filename, a.mimeType), formatBytes(a.sizeBytes)].filter(Boolean).join(' · ')
        const disabled = !a.url

        if (isImage) {
          return (
            <a
              key={a.id}
              href={a.url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              title={a.filename}
              className={`relative block rounded-xl overflow-hidden border border-gray-200 transition-shadow ${
                disabled ? 'pointer-events-none' : 'hover:shadow-md cursor-pointer'
              }`}
            >
              {a.url ? (
                <img src={a.url} alt={a.filename} className="w-full h-[140px] object-cover" />
              ) : (
                <div className="h-[140px] flex items-center justify-center bg-gray-50">
                  <ImageIcon className="w-6 h-6 text-gray-400" strokeWidth={1.6} />
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 px-3 py-2 flex items-center justify-between gap-2 bg-gradient-to-t from-gray-900/65 to-transparent">
                <span className="text-[10px] font-semibold text-white font-mono truncate">{a.filename}</span>
                <span className="text-[9px] text-white/85 flex-shrink-0">{meta}</span>
              </div>
            </a>
          )
        }

        const { Icon: KindIcon, color: kindColor } = FILE_KIND_STYLE[fileKind(a.filename, a.mimeType)]
        return (
          <a
            key={a.id}
            href={a.url ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            title={a.filename}
            className={`flex items-center gap-2.5 bg-gray-50 border border-gray-200 rounded-xl p-2.5 max-w-[310px] transition-colors ${
              disabled ? 'opacity-60 pointer-events-none' : 'hover:border-wine-300 hover:bg-wine-50/40 cursor-pointer'
            }`}
          >
            <span className="w-[38px] h-12 rounded-[7px] bg-white border border-gray-200 flex items-center justify-center flex-shrink-0">
              <KindIcon className={`w-4 h-4 ${kindColor}`} strokeWidth={1.8} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11.5px] font-semibold text-gray-700 truncate">{a.filename}</p>
              <p className="text-[10px] text-gray-400">{meta}</p>
            </div>
            <span className="w-7 h-7 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gray-500 flex-shrink-0">
              <Download className="w-3.5 h-3.5" strokeWidth={2} />
            </span>
          </a>
        )
      })}
    </div>
  )
}

// ─── Single timeline event ────────────────────────────────────────────────────
// ─── Message body with a SOTA clamp/reveal for long messages (7a) ────────────────
function MessageBody({ text, discarded }: { text: string; discarded: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > 360 || (text.match(/\n/g)?.length ?? 0) > 8
  const clamp = isLong && !expanded
  return (
    <div className="bg-white">
      <div className="relative">
        <div
          className={`px-3 py-2.5 text-[11.5px] leading-relaxed whitespace-pre-wrap ${
            discarded ? 'text-gray-400 line-through decoration-red-300 decoration-1' : 'text-gray-700'
          } ${clamp ? 'max-h-36 overflow-hidden' : ''}`}
        >
          {text}
        </div>
        {clamp && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-transparent" />}
      </div>
      {isLong && (
        <div className="flex justify-center pb-2">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="inline-flex items-center gap-1 text-[10px] font-semibold text-wine-700 hover:text-wine-800 bg-white rounded-full px-2.5 py-1 border border-wine-200 shadow-sm transition-colors"
          >
            {expanded ? 'Show less' : 'Show more'}
            <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      )}
    </div>
  )
}

function ThreadEvent({ conv, attachments, isLast, isLatest, isCancelled, onOpenDraftPanel, onClose }: {
  conv: OrderConversationDto
  attachments: OrderAttachmentDto[]
  isLast: boolean
  isLatest: boolean
  isCancelled: boolean
  onOpenDraftPanel: () => void
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  const isInbound = conv.direction === 'INBOUND'
  const cfg = getStatusConfig(isInbound ? 'PROVIDER_REPLY' : conv.status)
  const StatusIcon = cfg.icon
  const isPending = conv.status === 'PENDING_APPROVAL' && !isInbound
  const isDiscarded = conv.status === 'DISCARDED'
  const isSent = ['SENT', 'AUTO_SENT', 'APPROVED'].includes(conv.status) && !isInbound
  const bodyText = conv.draftContent || conv.rollingSummary || ''

  const handleCopy = () => {
    if (!bodyText) return
    navigator.clipboard.writeText(bodyText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={`relative group border-l-[3px] ${isInbound ? 'border-gray-200' : 'border-wine-400'}`}>
      {/* Content — flat single-column email row (7a "The One") */}
      <div className={`min-w-0 pl-3 pr-4 pb-4 ${!isLast ? 'border-b border-gray-100' : ''}`}>
        {/* Identity row — always visible (7a email header) */}
        <div className="flex items-center justify-between gap-2 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border flex-shrink-0 ${cfg.bgColor} ${cfg.textColor} ${cfg.borderColor}`}>
              <StatusIcon className="w-2.5 h-2.5" />
              {cfg.label}
            </span>
            {isInbound ? (
              <span className="text-[11px] text-blue-600 font-medium truncate">from {conv.providerName || 'Provider'}</span>
            ) : (
              <span className="text-[11px] text-gray-400 font-medium flex-shrink-0">Round {conv.roundCount}</span>
            )}
            {isInbound && conv.providerEmail && (
              <span className="text-[10px] text-gray-400 font-mono truncate hidden sm:inline">{conv.providerEmail}</span>
            )}
            {isPending && (
              <span className="text-[10px] text-wine-500 font-semibold flex-shrink-0">· Needs review</span>
            )}
          </div>
          <span className="text-[10px] text-gray-400 flex-shrink-0">{fmtTime(conv.createdAt)}</span>
        </div>

        {/* Message body + meta — always inline (7a "The One") */}
        <div className={`rounded-xl border overflow-hidden ${isLatest ? cfg.borderColor : 'border-gray-100'}`}>
          {bodyText ? (
            <MessageBody text={bodyText} discarded={isDiscarded} />
          ) : (
            <div className="px-3 py-2.5 bg-white">
              <p className="text-[11px] text-gray-400 italic">No content recorded</p>
            </div>
          )}

                {/* Special conditions the AI flagged (delivery delays, substitutions, etc.) */}
                {conv.specialConditions && conv.specialConditions.length > 0 && (
                  <div className="px-3 py-2 bg-amber-50 border-t border-amber-100">
                    <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-800 mb-1">
                      <AlertTriangle className="w-3 h-3" /> Heads up
                    </div>
                    <ul className="space-y-0.5">
                      {conv.specialConditions.map((c, i) => (
                        <li key={i} className="text-[10.5px] text-amber-800 flex gap-1"><span aria-hidden>•</span><span>{c}</span></li>
                      ))}
                    </ul>
                  </div>
                )}

                {attachments.length > 0 && <AttachmentCards items={attachments} />}

                {/* Footer row */}
                <div className="flex items-center justify-between px-3 py-2 bg-white border-t border-gray-100">
                  <div className="flex items-center gap-2.5">
                    {isInbound && (
                      <span className="flex items-center gap-1 text-[10px] text-blue-600 font-medium">
                        <Mail className="w-3 h-3" />
                        {conv.providerEmail ? `from ${conv.providerEmail}` : 'Provider reply received'}
                        {conv.createdAt && <span className="text-gray-400 ml-1">{fmtDate(conv.createdAt)}</span>}
                      </span>
                    )}
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
