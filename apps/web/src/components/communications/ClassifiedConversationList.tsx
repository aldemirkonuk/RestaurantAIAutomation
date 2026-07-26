import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Mail,
  MessageSquare,
  Phone,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  ArrowDownLeft,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Sparkles,
  Clock,
  User,
} from 'lucide-react'
import {
  useConversations,
  useConversationThread,
  useConversationStats,
  useRegenerateSummary,
  type ConversationMessage,
  type ConversationFilters,
} from '../../hooks/queries/useConversationQueries'
import { useProviders } from '../../hooks/queries/useProviderQueries'
import { useAuth } from '../../contexts/AuthContext'
import { ConversationFilterBar } from './ConversationFilterBar'
import { ExportMenu } from '../ui/ExportMenu'
import {
  exportTable,
  type TableExportColumn,
  type TableExportFormat,
} from '../../lib/tableExport'
import {
  EMPTY_CONVERSATION_FILTERS,
  normalizeDirection,
  normalizeSentiment,
  sentimentBadgeClass,
  sentimentLabel,
  orderBucketLabel,
  orderBucketBadgeClass,
  toApiDateRange,
  type ConversationFilterState,
} from '../../lib/conversationFilters'
import {
  conversationOrderNumber,
  conversationWineName,
  groupConversationsByDistributorAndOrder,
  groupConversationsByOrder,
  providerInitials,
  type DistributorGroup,
  type OrderGroup,
} from '../../lib/conversationGrouping'

export type ClassifiedConversationListProps = {
  /** When set, collapse distributor level and suppress per-row vendor. */
  scopedProviderId?: string
  initialFilters?: Partial<ConversationFilterState>
  showStats?: boolean
  showExport?: boolean
}

const CHANNEL_CONFIG: Record<
  string,
  { icon: typeof Mail; color: string; label: string }
> = {
  email: { icon: Mail, color: 'bg-blue-100 text-blue-600', label: 'Email' },
  sms: {
    icon: MessageSquare,
    color: 'bg-emerald-100 text-emerald-600',
    label: 'SMS',
  },
  voice: { icon: Phone, color: 'bg-purple-100 text-purple-600', label: 'Voice' },
  whatsapp: {
    icon: MessageSquare,
    color: 'bg-green-100 text-green-600',
    label: 'WhatsApp',
  },
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString()
}

function ProviderChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full pl-[3px] pr-2.5 py-[3px]">
      <span className="w-5 h-5 rounded-full bg-wine-800 flex items-center justify-center text-[9px] font-black text-white flex-shrink-0">
        {providerInitials(name)}
      </span>
      <span className="text-[11.5px] font-medium text-gray-700 truncate max-w-[200px]">
        {name}
      </span>
    </span>
  )
}

function MessageRow({
  conv,
  hideVendor,
  isExpanded,
  onToggle,
  onViewThread,
}: {
  conv: ConversationMessage
  hideVendor: boolean
  isExpanded: boolean
  onToggle: () => void
  onViewThread: (threadId: string) => void
}) {
  const channelConf = CHANNEL_CONFIG[conv.channel] || CHANNEL_CONFIG.email
  const ChannelIcon = channelConf.icon
  const bucket = normalizeSentiment(conv.detected_sentiment)
  const title =
    conversationWineName(conv) ||
    conv.detected_intent ||
    'Conversation'

  return (
    <motion.div layout className="hover:bg-gray-50/50 transition-colors">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-6 py-3.5 text-left"
      >
        <div className="flex items-start gap-4">
          <div
            className={`p-2.5 ${channelConf.color} rounded-xl flex-shrink-0`}
          >
            <ChannelIcon className="w-5 h-5" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4 mb-1">
              <div>
                <h4 className="font-semibold text-gray-900">{title}</h4>
                <div className="flex items-center gap-2 text-sm text-gray-500 mt-0.5">
                  {!hideVendor && (
                    <>
                      <User className="w-3.5 h-3.5" />
                      <span>{conv.providers?.name || 'Unknown vendor'}</span>
                      <span className="text-gray-300">|</span>
                    </>
                  )}
                  {normalizeDirection(conv.direction) === 'outbound' ? (
                    <span className="flex items-center gap-1 text-blue-600">
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      Outbound
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-emerald-600">
                      <ArrowDownLeft className="w-3.5 h-3.5" />
                      Inbound
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span
                  className={`px-2 py-1 text-xs font-medium rounded-full ${sentimentBadgeClass(bucket)}`}
                >
                  {sentimentLabel(bucket)}
                </span>
                <span className="text-sm text-gray-500">
                  {formatDate(conv.created_at)}
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                />
              </div>
            </div>

            <p className="text-sm text-gray-600 line-clamp-1">
              {conv.message_text}
            </p>

            {conv.conversation_summary && (
              <div className="flex items-center gap-1.5 mt-2">
                <Sparkles className="w-3 h-3 text-purple-500" />
                <span className="text-xs text-purple-600 line-clamp-1">
                  {conv.conversation_summary}
                </span>
              </div>
            )}
          </div>
        </div>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-6 pb-4 ml-[52px]">
              <div className="p-4 bg-gray-50 rounded-xl space-y-4">
                <div>
                  <h5 className="text-xs font-semibold text-gray-500 uppercase mb-1">
                    Full Message
                  </h5>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">
                    {conv.message_text}
                  </p>
                </div>

                {conv.conversation_summary && (
                  <div>
                    <h5 className="text-xs font-semibold text-gray-500 uppercase mb-1">
                      AI Summary
                    </h5>
                    <p className="text-sm text-gray-700">
                      {conv.conversation_summary}
                    </p>
                  </div>
                )}

                {conv.thread_id && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onViewThread(conv.thread_id!)
                    }}
                    className="text-sm text-wine-600 hover:text-wine-700 font-medium flex items-center gap-1"
                  >
                    View full thread <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}

                <div className="flex items-center gap-4 text-xs text-gray-500 pt-2 border-t border-gray-200">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {formatDate(
                      conv.sent_at || conv.received_at || conv.created_at,
                    )}
                  </span>
                  <span className="flex items-center gap-1">
                    <ChannelIcon className="w-3.5 h-3.5" />
                    {channelConf.label}
                  </span>
                  {conv.confidence_score != null && (
                    <span>
                      Confidence: {(conv.confidence_score * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function OrderGroupBlock({
  group,
  hideVendor,
  expandedId,
  onToggleMessage,
  onViewThread,
  defaultOpen = true,
}: {
  group: OrderGroup
  hideVendor: boolean
  expandedId: string | null
  onToggleMessage: (id: string) => void
  onViewThread: (threadId: string) => void
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const label = orderBucketLabel(group.orderNumber, group.key)

  return (
    <div className="border-t border-gray-100 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-6 py-2.5 bg-gray-50/80 hover:bg-gray-50 text-left"
      >
        <ChevronRight
          className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <span
          className={`px-2 py-0.5 text-xs font-medium rounded ${orderBucketBadgeClass(group.key)}`}
        >
          {label}
        </span>
        {group.wineName && !group.isUnassigned && (
          <span className="text-sm text-gray-700 truncate">{group.wineName}</span>
        )}
        <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
          {group.messages.length}{' '}
          {group.messages.length === 1 ? 'message' : 'messages'}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden divide-y divide-gray-50"
          >
            {group.messages.map((conv) => (
              <MessageRow
                key={conv.id}
                conv={conv}
                hideVendor={hideVendor}
                isExpanded={expandedId === conv.id}
                onToggle={() =>
                  onToggleMessage(expandedId === conv.id ? '' : conv.id)
                }
                onViewThread={onViewThread}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function DistributorAccordion({
  group,
  expandedId,
  onToggleMessage,
  onViewThread,
  defaultOpen = false,
}: {
  group: DistributorGroup
  expandedId: string | null
  onToggleMessage: (id: string) => void
  onViewThread: (threadId: string) => void
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border-b border-gray-200 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-6 py-3.5 bg-white hover:bg-gray-50/80 text-left"
      >
        <ChevronRight
          className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <ProviderChip name={group.providerName} />
        <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
          {group.messageCount}{' '}
          {group.messageCount === 1 ? 'conversation' : 'conversations'}
          {' · '}
          {group.orders.length}{' '}
          {group.orders.length === 1 ? 'order' : 'orders'}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden bg-white"
          >
            {group.orders.map((order) => (
              <OrderGroupBlock
                key={order.key}
                group={order}
                hideVendor
                expandedId={expandedId}
                onToggleMessage={onToggleMessage}
                onViewThread={onViewThread}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Shared classified communication history:
 * Distributor → Order → messages, collapsing distributor when scoped.
 */
export function ClassifiedConversationList({
  scopedProviderId,
  initialFilters,
  showStats = true,
  showExport = true,
}: ClassifiedConversationListProps) {
  const { activeRestaurantId } = useAuth()
  const [filters, setFilters] = useState<ConversationFilterState>(() => ({
    ...EMPTY_CONVERSATION_FILTERS,
    ...initialFilters,
    ...(scopedProviderId ? { providerId: scopedProviderId } : {}),
  }))
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)

  const effectiveProviderId = scopedProviderId || filters.providerId
  const isProviderScoped = Boolean(effectiveProviderId)

  const apiFilters: ConversationFilters = {
    channel: filters.channel || undefined,
    direction: filters.direction || undefined,
    sentiment: filters.sentiment || undefined,
    status: filters.status || undefined,
    search: filters.search || undefined,
    quarter: filters.quarter || undefined,
    year: filters.year || undefined,
    month: filters.month || undefined,
    ...toApiDateRange(filters),
    providerId: effectiveProviderId || undefined,
    orderNumber: filters.orderNumber || undefined,
    page: filters.page,
    limit: 20,
    sortBy: 'created_at',
    sortOrder: 'desc',
  }

  const { data: conversationsData, isLoading, error } =
    useConversations(apiFilters)
  const { data: statsData } = useConversationStats(
    activeRestaurantId || undefined,
  )
  const { data: threadData, isLoading: threadLoading } =
    useConversationThread(selectedThreadId)
  const regenerateSummary = useRegenerateSummary()
  const { data: providers = [] } = useProviders(activeRestaurantId || '', undefined)

  const conversations = useMemo(
    () => conversationsData?.conversations ?? [],
    [conversationsData?.conversations],
  )
  const total = conversationsData?.total || 0
  const totalPages = conversationsData?.totalPages || 0

  const providerOptions = useMemo(
    () =>
      providers.map((p) => ({
        value: p.id,
        label: p.name || 'Unnamed',
      })),
    [providers],
  )

  const distributorGroups = useMemo(
    () => groupConversationsByDistributorAndOrder(conversations),
    [conversations],
  )
  const orderGroups = useMemo(
    () => groupConversationsByOrder(conversations),
    [conversations],
  )

  /**
   * Collapse the distributor accordion when the results only concern one
   * distributor — either because a filter pinned it or because that is all the
   * page contains. The name then lives in a single header chip instead of
   * repeating on every row.
   */
  const collapseDistributorLevel =
    isProviderScoped || distributorGroups.length === 1

  const headerProviderName = useMemo(() => {
    if (effectiveProviderId) {
      const fromList = providers.find((p) => p.id === effectiveProviderId)?.name
      if (fromList) return fromList
      return (
        conversations.find((c) => c.provider_id === effectiveProviderId)
          ?.providers?.name || 'Distributor'
      )
    }
    if (distributorGroups.length === 1) return distributorGroups[0].providerName
    return null
  }, [effectiveProviderId, providers, conversations, distributorGroups])

  const setFilterChannel = (channel: string) =>
    setFilters((f) => ({ ...f, channel, page: 1 }))

  const handleExport = async (format: TableExportFormat) => {
    const columns: TableExportColumn<(typeof conversations)[number]>[] = [
      {
        header: 'Order',
        value: (r) => conversationOrderNumber(r) ?? 'Unassigned',
      },
      {
        header: 'Wine',
        value: (r) => conversationWineName(r) ?? '',
      },
      {
        header: 'Provider',
        value: (r) => r.providers?.name ?? '',
      },
      { header: 'Channel', value: (r) => r.channel },
      { header: 'Direction', value: (r) => r.direction },
      {
        header: 'Sentiment',
        value: (r) => sentimentLabel(normalizeSentiment(r.detected_sentiment)),
      },
      {
        header: 'Message',
        value: (r) => r.message_text ?? '',
      },
      {
        header: 'Created',
        value: (r) => r.created_at ?? '',
      },
    ]
    await exportTable({
      rows: conversations,
      columns,
      format,
      filename: 'communication-history',
      title: 'Communication History',
    })
  }

  // Thread detail panel
  if (selectedThreadId && threadData) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setSelectedThreadId(null)}
          className="text-sm text-wine-600 hover:underline flex items-center gap-1"
        >
          <ChevronRight className="w-4 h-4 rotate-180" /> Back to conversations
        </button>

        {threadData.summary && (
          <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-600" />
                <span className="text-sm font-semibold text-purple-700">
                  AI Conversation Summary
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (threadData.messages?.[0]?.id) {
                    regenerateSummary.mutate(threadData.messages[0].id)
                  }
                }}
                className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1"
              >
                <RefreshCw
                  className={`w-3 h-3 ${regenerateSummary.isPending ? 'animate-spin' : ''}`}
                />
                Regenerate
              </button>
            </div>
            <p className="text-sm text-gray-700">{threadData.summary}</p>
            {threadData.summary_updated_at && (
              <p className="text-xs text-gray-500 mt-2">
                Updated: {formatDate(threadData.summary_updated_at)}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>{threadData.message_count} messages</span>
          {threadData.provider?.name && (
            <ProviderChip name={threadData.provider.name} />
          )}
          {threadData.order?.order_number && (
            <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-mono">
              {threadData.order.order_number}
            </span>
          )}
          {(threadData.order?.wine_name ||
            threadData.order?.inventory?.wine_name) && (
            <span className="px-2 py-0.5 bg-wine-50 text-wine-700 rounded text-xs">
              {threadData.order.wine_name ||
                threadData.order.inventory?.wine_name}
            </span>
          )}
        </div>

        <div className="space-y-3">
          {threadData.messages.map((msg: ConversationMessage, idx: number) => (
            <div
              key={msg.id || idx}
              className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[75%] rounded-xl p-4 ${
                  msg.direction === 'outbound'
                    ? 'bg-wine-50 border border-wine-200'
                    : 'bg-gray-50 border border-gray-200'
                }`}
              >
                <div className="flex items-center gap-2 mb-2 text-xs text-gray-500">
                  {msg.direction === 'outbound' ? (
                    <ArrowUpRight className="w-3 h-3 text-wine-500" />
                  ) : (
                    <ArrowDownLeft className="w-3 h-3 text-blue-500" />
                  )}
                  <span>
                    {msg.direction === 'outbound' ? 'Sent' : 'Received'}
                  </span>
                  <span>
                    {formatDate(
                      msg.sent_at || msg.received_at || msg.created_at,
                    )}
                  </span>
                  {msg.ai_generated && (
                    <span className="px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded text-[10px]">
                      AI
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-800 whitespace-pre-wrap">
                  {msg.message_text}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (selectedThreadId && threadLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-wine-500" />
        <span className="ml-2 text-gray-600">Loading thread...</span>
      </div>
    )
  }

  const stats = {
    email: statsData?.byChannel?.email || 0,
    sms: statsData?.byChannel?.sms || 0,
    voice: statsData?.byChannel?.voice || 0,
    whatsapp: statsData?.byChannel?.whatsapp || 0,
    total: statsData?.total || total,
    inbound: statsData?.byDirection?.inbound || 0,
    outbound: statsData?.byDirection?.outbound || 0,
  }

  return (
    <div className="space-y-6">
      {showStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          {Object.entries(CHANNEL_CONFIG).map(([channel, config]) => {
            const ChannelIcon = config.icon
            const count =
              (stats[channel as keyof typeof stats] as number) || 0
            return (
              <button
                key={channel}
                type="button"
                onClick={() =>
                  setFilterChannel(filters.channel === channel ? '' : channel)
                }
                className={`p-3 rounded-xl border-2 transition-all ${
                  filters.channel === channel
                    ? 'border-wine-500 bg-wine-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div
                  className={`w-8 h-8 ${config.color} rounded-lg flex items-center justify-center mx-auto mb-2`}
                >
                  <ChannelIcon className="w-4 h-4" />
                </div>
                <p className="text-lg font-bold text-gray-900">{count}</p>
                <p className="text-xs text-gray-500">{config.label}</p>
              </button>
            )
          })}
          <div className="col-span-2 md:col-span-4 lg:col-span-4 grid grid-cols-3 gap-3">
            <div className="p-3 bg-gradient-to-br from-wine-50 to-rose-50 rounded-xl border border-wine-100">
              <p className="text-2xl font-bold text-wine-600">{stats.total}</p>
              <p className="text-xs text-gray-600">Total</p>
            </div>
            <div className="p-3 bg-blue-50 rounded-xl border border-blue-100">
              <p className="text-2xl font-bold text-blue-600">
                {stats.outbound}
              </p>
              <p className="text-xs text-gray-600">Outbound</p>
            </div>
            <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
              <p className="text-2xl font-bold text-emerald-600">
                {stats.inbound}
              </p>
              <p className="text-xs text-gray-600">Inbound</p>
            </div>
          </div>
        </div>
      )}

      <ConversationFilterBar
        filters={filters}
        onChange={(next) => {
          if (scopedProviderId) {
            setFilters({ ...next, providerId: scopedProviderId })
          } else {
            setFilters(next)
          }
        }}
        sentimentCounts={statsData?.bySentiment}
        providerOptions={providerOptions}
        providerCounts={
          isProviderScoped ? undefined : statsData?.byProvider
        }
        hideProviderFilter={Boolean(scopedProviderId)}
      />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900">
                Communication History
              </h3>
              <p className="text-sm text-gray-500">
                {total} conversations {isLoading && '(loading...)'}
              </p>
              {collapseDistributorLevel && headerProviderName && (
                <div className="mt-2">
                  <ProviderChip name={headerProviderName} />
                </div>
              )}
            </div>
            {showExport && conversations.length > 0 && (
              <ExportMenu
                onExport={handleExport}
                count={conversations.length}
                size="sm"
                variant="soft"
              />
            )}
          </div>
        </div>

        <div>
          {isLoading ? (
            <div className="p-12 text-center">
              <RefreshCw className="w-8 h-8 text-wine-400 mx-auto mb-3 animate-spin" />
              <p className="text-gray-600">Loading conversations...</p>
            </div>
          ) : error ? (
            <div className="p-12 text-center">
              <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
              <p className="text-gray-600">Failed to load conversations</p>
              <p className="text-sm text-gray-400">
                Check that the API Gateway is running
              </p>
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-12 text-center">
              <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600 font-medium">No conversations found</p>
              <p className="text-sm text-gray-400">Try adjusting your filters</p>
            </div>
          ) : collapseDistributorLevel ? (
            <div>
              {orderGroups.map((order) => (
                <OrderGroupBlock
                  key={order.key}
                  group={order}
                  hideVendor
                  expandedId={expandedId}
                  onToggleMessage={(id) => setExpandedId(id || null)}
                  onViewThread={setSelectedThreadId}
                />
              ))}
            </div>
          ) : (
            <div>
              {distributorGroups.map((dist) => (
                <DistributorAccordion
                  key={dist.providerId}
                  group={dist}
                  expandedId={expandedId}
                  onToggleMessage={(id) => setExpandedId(id || null)}
                  onViewThread={setSelectedThreadId}
                  defaultOpen
                />
              ))}
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
            <button
              type="button"
              disabled={filters.page <= 1}
              onClick={() =>
                setFilters((f) => ({ ...f, page: Math.max(1, f.page - 1) }))
              }
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-gray-600">
              Page {filters.page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={filters.page >= totalPages}
              onClick={() =>
                setFilters((f) => ({ ...f, page: f.page + 1 }))
              }
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
