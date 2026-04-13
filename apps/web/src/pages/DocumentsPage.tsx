import { useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText,
  Download,
  Filter,
  Search,
  Calendar,
  DollarSign,
  BarChart3,
  TrendingUp,
  Edit3,
  Trash2,
  Eye,
  CheckSquare,
  Square,
  X,
  FileSpreadsheet,
  File,
  Clock,
  User,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Mail,
  MessageSquare,
  Send,
  LayoutGrid,
  List,
  Home,
  Phone,
  ArrowUpRight,
  ArrowDownLeft,
  AlertCircle,
  CheckCircle,
  Tag,
  ExternalLink,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { Header } from '../components/layout/Header'
import { useCalendarEventsSubscription, useReportSubscription, CalendarEventPayload, ReportEventPayload } from '../contexts/RealtimeContext'
import {
  useConversations,
  useConversationThread,
  useConversationStats,
  useRegenerateSummary,
  type ConversationMessage,
  type ConversationFilters,
} from '../hooks/queries/useConversationQueries'
import { useGeneratedReports, useDeleteReport, type GeneratedReport } from '../hooks/queries/useReportQueries'

// Communication History Section Component — uses real API via useConversations
function CommunicationHistorySection() {
  const [filterChannel, setFilterChannel] = useState<string>('')
  const [filterDirection, setFilterDirection] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [quarter, setQuarter] = useState('')
  const [year, setYear] = useState('')

  const filters: ConversationFilters = {
    channel: filterChannel || undefined,
    direction: filterDirection || undefined,
    search: searchQuery || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    quarter: quarter || undefined,
    year: year || undefined,
    page,
    limit: 20,
    sortBy: 'created_at',
    sortOrder: 'desc',
  }

  const { data: conversationsData, isLoading, error } = useConversations(filters)
  const { data: statsData } = useConversationStats()
  const { data: threadData, isLoading: threadLoading } = useConversationThread(selectedThreadId)
  const regenerateSummary = useRegenerateSummary()

  const conversations = conversationsData?.conversations || []
  const total = conversationsData?.total || 0
  const totalPages = conversationsData?.totalPages || 0

  const sourceConfig: Record<string, { icon: any; color: string; label: string }> = {
    email: { icon: Mail, color: 'bg-blue-100 text-blue-600', label: 'Email' },
    sms: { icon: MessageSquare, color: 'bg-emerald-100 text-emerald-600', label: 'SMS' },
    voice: { icon: Phone, color: 'bg-purple-100 text-purple-600', label: 'Voice' },
    whatsapp: { icon: MessageSquare, color: 'bg-green-100 text-green-600', label: 'WhatsApp' },
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleString()
  }

  // Thread detail panel
  if (selectedThreadId && threadData) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setSelectedThreadId(null)}
          className="text-sm text-wine-600 hover:underline flex items-center gap-1"
        >
          <ChevronRight className="w-4 h-4 rotate-180" /> Back to conversations
        </button>

        {/* Summary card */}
        {threadData.summary && (
          <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-600" />
                <span className="text-sm font-semibold text-purple-700">AI Conversation Summary</span>
              </div>
              <button
                onClick={() => {
                  if (threadData.messages?.[0]?.id) {
                    regenerateSummary.mutate(threadData.messages[0].id)
                  }
                }}
                className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${regenerateSummary.isPending ? 'animate-spin' : ''}`} />
                Regenerate
              </button>
            </div>
            <p className="text-sm text-gray-700">{threadData.summary}</p>
            {threadData.summary_updated_at && (
              <p className="text-xs text-gray-500 mt-2">Updated: {formatDate(threadData.summary_updated_at)}</p>
            )}
          </div>
        )}

        {/* Thread metadata */}
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>{threadData.message_count} messages</span>
          {threadData.provider?.name && (
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" /> {threadData.provider.name}
            </span>
          )}
          {threadData.order?.wine_name && (
            <span className="px-2 py-0.5 bg-wine-50 text-wine-700 rounded text-xs">
              {threadData.order.wine_name}
            </span>
          )}
        </div>

        {/* Messages timeline */}
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
                  <span>{msg.direction === 'outbound' ? 'Sent' : 'Received'}</span>
                  <span>{formatDate(msg.sent_at || msg.received_at || msg.created_at)}</span>
                  {msg.ai_generated && (
                    <span className="px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded text-[10px]">AI</span>
                  )}
                </div>
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{msg.message_text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Loading state (for thread view)
  if (selectedThreadId && threadLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-wine-500" />
        <span className="ml-2 text-gray-600">Loading thread...</span>
      </div>
    )
  }

  // Stats from API
  const stats = {
    email: statsData?.byChannel?.email || 0,
    sms: statsData?.byChannel?.sms || 0,
    voice: statsData?.byChannel?.voice || 0,
    whatsapp: statsData?.byChannel?.whatsapp || 0,
    total: statsData?.total || total,
    inbound: statsData?.byDirection?.inbound || 0,
    outbound: statsData?.byDirection?.outbound || 0,
  }

  // NOTE: the old code had inline filtering below this point.
  // We replaced it with the API-backed pattern above.
  // The rest renders the conversations list using `conversations` from the API.

  return (
    <div className="space-y-6">
      {/* Communication Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {Object.entries(sourceConfig).map(([channel, config]) => {
          const ChannelIcon = config.icon
          const count = stats[channel as keyof typeof stats] as number || 0
          return (
            <button
              key={channel}
              onClick={() => setFilterChannel(filterChannel === channel ? '' : channel)}
              className={`p-3 rounded-xl border-2 transition-all ${
                filterChannel === channel
                  ? 'border-wine-500 bg-wine-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className={`w-8 h-8 ${config.color} rounded-lg flex items-center justify-center mx-auto mb-2`}>
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
            <p className="text-2xl font-bold text-blue-600">{stats.outbound}</p>
            <p className="text-xs text-gray-600">Outbound</p>
          </div>
          <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
            <p className="text-2xl font-bold text-emerald-600">{stats.inbound}</p>
            <p className="text-xs text-gray-600">Inbound</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-wine-500 focus:border-transparent"
          />
        </div>

        <select
          value={filterDirection}
          onChange={(e) => setFilterDirection(e.target.value)}
          className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-wine-500 bg-white"
        >
          <option value="">All Directions</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
        </select>

        <select
          value={quarter}
          onChange={(e) => { setQuarter(e.target.value); if (!year) setYear(String(new Date().getFullYear())) }}
          className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-wine-500 bg-white"
        >
          <option value="">All Time</option>
          <option value="Q1">Q1</option>
          <option value="Q2">Q2</option>
          <option value="Q3">Q3</option>
          <option value="Q4">Q4</option>
        </select>

        {(filterChannel || filterDirection || searchQuery || quarter) && (
          <button
            onClick={() => {
              setFilterChannel('')
              setFilterDirection('')
              setSearchQuery('')
              setQuarter('')
              setYear('')
              setDateFrom('')
              setDateTo('')
              setPage(1)
            }}
            className="px-3 py-2 text-sm text-wine-600 hover:bg-wine-50 rounded-lg transition-colors flex items-center gap-1"
          >
            <X className="w-4 h-4" />
            Clear filters
          </button>
        )}
      </div>

      {/* Communications List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-gray-900">Communication History</h3>
              <p className="text-sm text-gray-500">
                {total} conversations {isLoading && '(loading...)'}
              </p>
            </div>
          </div>
        </div>

        <div className="divide-y divide-gray-100">
          {isLoading ? (
            <div className="p-12 text-center">
              <RefreshCw className="w-8 h-8 text-wine-400 mx-auto mb-3 animate-spin" />
              <p className="text-gray-600">Loading conversations...</p>
            </div>
          ) : error ? (
            <div className="p-12 text-center">
              <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
              <p className="text-gray-600">Failed to load conversations</p>
              <p className="text-sm text-gray-400">Check that the API Gateway is running</p>
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-12 text-center">
              <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600 font-medium">No conversations found</p>
              <p className="text-sm text-gray-400">Try adjusting your filters</p>
            </div>
          ) : (
            conversations.map((conv) => {
              const channelConf = sourceConfig[conv.channel] || sourceConfig.email
              const ChannelIcon = channelConf.icon
              const isExpanded = expandedId === conv.id

              return (
                <motion.div
                  key={conv.id}
                  layout
                  className="hover:bg-gray-50/50 transition-colors"
                >
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : conv.id)}
                    className="w-full px-6 py-4 text-left"
                  >
                    <div className="flex items-start gap-4">
                      <div className={`p-2.5 ${channelConf.color} rounded-xl flex-shrink-0`}>
                        <ChannelIcon className="w-5 h-5" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-4 mb-1">
                          <div>
                            <h4 className="font-semibold text-gray-900">
                              {conv.procurement_orders?.wine_name || conv.detected_intent || 'Conversation'}
                            </h4>
                            <div className="flex items-center gap-2 text-sm text-gray-500 mt-0.5">
                              <User className="w-3.5 h-3.5" />
                              <span>{conv.providers?.name || 'Unknown vendor'}</span>
                              <span className="text-gray-300">|</span>
                              {conv.direction === 'outbound' ? (
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
                            {conv.detected_sentiment && (
                              <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                                conv.detected_sentiment === 'positive' ? 'bg-emerald-100 text-emerald-700' :
                                conv.detected_sentiment === 'negative' ? 'bg-red-100 text-red-700' :
                                'bg-gray-100 text-gray-700'
                              }`}>
                                {conv.detected_sentiment}
                              </span>
                            )}
                            <span className="text-sm text-gray-500">{formatDate(conv.created_at)}</span>
                            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </div>
                        </div>

                        <p className="text-sm text-gray-600 line-clamp-1">{conv.message_text}</p>

                        {conv.conversation_summary && (
                          <div className="flex items-center gap-1.5 mt-2">
                            <Sparkles className="w-3 h-3 text-purple-500" />
                            <span className="text-xs text-purple-600 line-clamp-1">{conv.conversation_summary}</span>
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
                              <h5 className="text-xs font-semibold text-gray-500 uppercase mb-1">Full Message</h5>
                              <p className="text-sm text-gray-700 whitespace-pre-wrap">{conv.message_text}</p>
                            </div>

                            {conv.conversation_summary && (
                              <div>
                                <h5 className="text-xs font-semibold text-gray-500 uppercase mb-1">AI Summary</h5>
                                <p className="text-sm text-gray-700">{conv.conversation_summary}</p>
                              </div>
                            )}

                            {conv.thread_id && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedThreadId(conv.thread_id)
                                }}
                                className="text-sm text-wine-600 hover:text-wine-700 font-medium flex items-center gap-1"
                              >
                                View full thread <ExternalLink className="w-3.5 h-3.5" />
                              </button>
                            )}

                            <div className="flex items-center gap-4 text-xs text-gray-500 pt-2 border-t border-gray-200">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" />
                                {formatDate(conv.sent_at || conv.received_at || conv.created_at)}
                              </span>
                              <span className="flex items-center gap-1">
                                <ChannelIcon className="w-3.5 h-3.5" />
                                {channelConf.label}
                              </span>
                              {conv.confidence_score !== null && conv.confidence_score !== undefined && (
                                <span>Confidence: {(conv.confidence_score * 100).toFixed(0)}%</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-gray-600">Page {page} of {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
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

type ReportType = 'daily' | 'weekly' | 'monthly' | 'financial' | 'inventory' | 'sales'
type ReportStatus = 'sent' | 'draft' | 'archived'

interface Report {
  id: string
  title: string
  type: ReportType
  status: ReportStatus
  sentAt: string
  sentTo: string[]
  period: string
  fileUrl?: string
  fileSize?: string
  description?: string
  tags?: string[]
}

function mapGeneratedReportToUi(r: GeneratedReport): Report {
  const meta = r.metadata ?? {}
  return {
    id: r.id,
    title: meta.title || `${r.report_type || 'Report'} — ${new Date(r.created_at).toLocaleDateString()}`,
    type: (r.report_type?.toLowerCase() as ReportType) || 'monthly',
    status: (meta.status as ReportStatus) || 'sent',
    sentAt: r.created_at,
    sentTo: meta.sentTo || [],
    period: meta.period || new Date(r.created_at).toLocaleString('default', { month: 'long', year: 'numeric' }),
    fileUrl: r.file_url ?? undefined,
    fileSize: meta.fileSize,
    description: meta.description,
    tags: meta.tags,
  }
}

const reportTypeConfig = {
  daily: { label: 'Daily', icon: Clock, color: 'bg-blue-100 text-blue-700' },
  weekly: { label: 'Weekly', icon: Calendar, color: 'bg-purple-100 text-purple-700' },
  monthly: { label: 'Monthly', icon: BarChart3, color: 'bg-emerald-100 text-emerald-700' },
  financial: { label: 'Financial', icon: DollarSign, color: 'bg-amber-100 text-amber-700' },
  inventory: { label: 'Inventory', icon: FileText, color: 'bg-rose-100 text-rose-700' },
  sales: { label: 'Sales', icon: TrendingUp, color: 'bg-indigo-100 text-indigo-700' },
}

// Helper to organize reports by year/month
interface FolderStructure {
  [year: string]: {
    [month: string]: Report[]
  }
}

export function DocumentsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTypes, setSelectedTypes] = useState<Set<ReportType>>(new Set())
  const [selectedStatus, setSelectedStatus] = useState<ReportStatus | 'all'>('all')
  const [selectedReports, setSelectedReports] = useState<Set<string>>(new Set())
  const [showFilters, setShowFilters] = useState(false)
  const [sortBy, setSortBy] = useState<'date' | 'type' | 'title'>('date')
  const [viewMode, setViewMode] = useState<'grid' | 'folders'>('folders')
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['2026', '2026-January']))
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'reports' | 'history'>('reports')
  const [scheduledReports, setScheduledReports] = useState<string[]>([])
  const [realtimeNotifications, setRealtimeNotifications] = useState<string[]>([])

  const { data: generatedReports = [] } = useGeneratedReports()
  const deleteReportMutation = useDeleteReport()
  const apiReports: Report[] = useMemo(() => generatedReports.map(mapGeneratedReportToUi), [generatedReports])

  // Listen for calendar events (report schedules)
  const handleCalendarEvent = useCallback((payload: any) => {
    console.log('Documents received calendar event:', payload)
    if (payload.new?.eventType === 'recurring' || payload.new?.source === 'communications') {
      setScheduledReports(prev => [...prev, `Scheduled: ${payload.new.title} on ${payload.new.date}`])
      setRealtimeNotifications(prev => [...prev, `📅 New scheduled report: ${payload.new.title}`])
      // Auto-clear notification after 5 seconds
      setTimeout(() => {
        setRealtimeNotifications(prev => prev.slice(1))
      }, 5000)
    }
  }, [])

  useCalendarEventsSubscription(handleCalendarEvent)

  // Listen for report events
  const handleReportEvent = useCallback((payload: ReportEventPayload) => {
    console.log('Documents received report event:', payload)
    if (payload.type === 'generated') {
      setRealtimeNotifications(prev => [...prev, `📄 Report generated: ${payload.reportType}`])
      setTimeout(() => {
        setRealtimeNotifications(prev => prev.slice(1))
      }, 5000)
    } else if (payload.type === 'scheduled') {
      setRealtimeNotifications(prev => [...prev, `🗓️ Report scheduled for: ${payload.scheduledFor}`])
      setTimeout(() => {
        setRealtimeNotifications(prev => prev.slice(1))
      }, 5000)
    }
  }, [])

  useReportSubscription(handleReportEvent)

  // Organize reports into folder structure
  const folderStructure = useMemo(() => {
    const structure: FolderStructure = {}
    apiReports.forEach(report => {
      const date = new Date(report.sentAt)
      const year = date.getFullYear().toString()
      const month = date.toLocaleString('default', { month: 'long' })
      
      if (!structure[year]) {
        structure[year] = {}
      }
      if (!structure[year][month]) {
        structure[year][month] = []
      }
      structure[year][month].push(report)
    })
    return structure
  }, [apiReports])

  // Get reports for selected folder
  const folderReports = useMemo(() => {
    if (!selectedFolder) return apiReports
    const [year, month] = selectedFolder.split('-')
    if (month && folderStructure[year]?.[month]) {
      return folderStructure[year][month]
    }
    if (folderStructure[year]) {
      return Object.values(folderStructure[year]).flat()
    }
    return apiReports
  }, [selectedFolder, folderStructure, apiReports])

  const toggleFolder = (folderId: string) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev)
      if (newSet.has(folderId)) {
        newSet.delete(folderId)
      } else {
        newSet.add(folderId)
      }
      return newSet
    })
  }

  const commStats = useMemo(() => {
    return { emailCount: 0, smsCount: 0, total: apiReports.length }
  }, [apiReports])

  // Filter reports
  const filteredReports = useMemo(() => {
    const baseReports = viewMode === 'folders' ? folderReports : apiReports
    return baseReports.filter((report) => {
      // Search filter
      const matchesSearch =
        report.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        report.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        report.period.toLowerCase().includes(searchQuery.toLowerCase())

      // Type filter
      const matchesType = selectedTypes.size === 0 || selectedTypes.has(report.type)

      // Status filter
      const matchesStatus = selectedStatus === 'all' || report.status === selectedStatus

      return matchesSearch && matchesType && matchesStatus
    })
  }, [searchQuery, selectedTypes, selectedStatus, viewMode, folderReports])

  // Sort reports
  const sortedReports = useMemo(() => {
    const sorted = [...filteredReports]
    sorted.sort((a, b) => {
      if (sortBy === 'date') {
        return new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()
      } else if (sortBy === 'type') {
        return a.type.localeCompare(b.type)
      } else {
        return a.title.localeCompare(b.title)
      }
    })
    return sorted
  }, [filteredReports, sortBy])

  const toggleTypeFilter = (type: ReportType) => {
    setSelectedTypes((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(type)) {
        newSet.delete(type)
      } else {
        newSet.add(type)
      }
      return newSet
    })
  }

  const toggleReportSelection = (reportId: string) => {
    setSelectedReports((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(reportId)) {
        newSet.delete(reportId)
      } else {
        newSet.add(reportId)
      }
      return newSet
    })
  }

  const selectAllVisible = () => {
    if (selectedReports.size === sortedReports.length) {
      setSelectedReports(new Set())
    } else {
      setSelectedReports(new Set(sortedReports.map((r) => r.id)))
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffTime = Math.abs(now.getTime() - date.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const handleDownload = (report: Report) => {
    if (report.fileUrl) {
      window.open(report.fileUrl, '_blank')
    } else {
      alert(`No file available for ${report.title}`)
    }
  }

  const handleDelete = (reportId: string) => {
    if (confirm('Are you sure you want to delete this report?')) {
      deleteReportMutation.mutate(reportId)
    }
  }

  const handleBatchDelete = () => {
    if (selectedReports.size === 0) return
    if (confirm(`Delete ${selectedReports.size} selected report(s)?`)) {
      Array.from(selectedReports).forEach((id) => deleteReportMutation.mutate(id))
      setSelectedReports(new Set())
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Documents & Reports" subtitle="All reports and communication history" />

      {/* Realtime Notifications */}
      <AnimatePresence>
        {realtimeNotifications.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-20 right-4 z-50 space-y-2"
          >
            {realtimeNotifications.map((notification, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="bg-white border border-blue-200 shadow-lg rounded-xl px-4 py-3 flex items-center gap-3"
              >
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Calendar className="w-4 h-4 text-blue-600" />
                </div>
                <p className="text-sm text-gray-700">{notification}</p>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="p-6">
        {/* Tabs */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex bg-white rounded-xl border border-gray-200 p-1">
            <button
              onClick={() => setActiveTab('reports')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                activeTab === 'reports'
                  ? 'bg-wine-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <FileText className="w-4 h-4" />
              Reports
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                activeTab === 'history'
                  ? 'bg-wine-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Send className="w-4 h-4" />
              Communication History
              <span className="px-1.5 py-0.5 bg-wine-100 text-wine-700 text-xs rounded-full">
                {commStats.total}
              </span>
            </button>
          </div>

          {activeTab === 'reports' && (
            <div className="flex bg-white rounded-xl border border-gray-200 p-1">
              <button
                onClick={() => { setViewMode('grid'); setSelectedFolder(null); }}
                className={`px-3 py-2 rounded-lg transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-500 hover:bg-gray-50'
                }`}
                title="Grid View"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('folders')}
                className={`px-3 py-2 rounded-lg transition-colors ${
                  viewMode === 'folders'
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-500 hover:bg-gray-50'
                }`}
                title="Folder View"
              >
                <Folder className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Communication History Tab */}
        {activeTab === 'history' && (
          <CommunicationHistorySection />
        )}

        {/* Reports Tab */}
        {activeTab === 'reports' && (
          <>
        {/* Toolbar */}
        <div className="mb-6 space-y-4">
          {/* Breadcrumb for Folder View */}
          {viewMode === 'folders' && selectedFolder && (
            <div className="flex items-center gap-2 text-sm">
              <button
                onClick={() => setSelectedFolder(null)}
                className="text-gray-500 hover:text-gray-700 flex items-center gap-1"
              >
                <Home className="w-4 h-4" />
                Documents
              </button>
              <ChevronRight className="w-4 h-4 text-gray-400" />
              {selectedFolder.split('-').map((part, idx, arr) => (
                <span key={idx} className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedFolder(arr.slice(0, idx + 1).join('-'))}
                    className={idx === arr.length - 1 ? 'font-semibold text-gray-900' : 'text-gray-500 hover:text-gray-700'}
                  >
                    {part}
                  </button>
                  {idx < arr.length - 1 && <ChevronRight className="w-4 h-4 text-gray-400" />}
                </span>
              ))}
            </div>
          )}

          {/* Search and Filters */}
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search reports by title, period, or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent outline-none transition-all"
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`px-4 py-3 rounded-xl border transition-all flex items-center gap-2 ${
                  showFilters || selectedTypes.size > 0 || selectedStatus !== 'all'
                    ? 'bg-wine-50 border-wine-200 text-wine-600'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                <Filter className="w-4 h-4" />
                <span className="font-medium">Filters</span>
                {(selectedTypes.size > 0 || selectedStatus !== 'all') && (
                  <span className="px-2 py-0.5 bg-wine-600 text-white text-xs rounded-full">
                    {selectedTypes.size + (selectedStatus !== 'all' ? 1 : 0)}
                  </span>
                )}
              </button>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent outline-none"
              >
                <option value="date">Sort by Date</option>
                <option value="type">Sort by Type</option>
                <option value="title">Sort by Title</option>
              </select>
            </div>
          </div>

          {/* Filter Panel */}
          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-white rounded-xl border border-gray-200 p-4 space-y-4"
              >
                {/* Report Type Filters */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-3">
                    Report Type
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(reportTypeConfig).map(([type, config]) => {
                      const TypeIcon = config.icon
                      const isSelected = selectedTypes.has(type as ReportType)
                      return (
                        <button
                          key={type}
                          onClick={() => toggleTypeFilter(type as ReportType)}
                          className={`px-4 py-2 rounded-lg border-2 transition-all flex items-center gap-2 ${
                            isSelected
                              ? `${config.color} border-current`
                              : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'
                          }`}
                        >
                          <TypeIcon className="w-4 h-4" />
                          <span className="font-medium">{config.label}</span>
                          {isSelected && <CheckSquare className="w-4 h-4" />}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Status Filter */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-3">Status</label>
                  <div className="flex gap-2">
                    {(['all', 'sent', 'draft', 'archived'] as const).map((status) => (
                      <button
                        key={status}
                        onClick={() => setSelectedStatus(status)}
                        className={`px-4 py-2 rounded-lg border-2 transition-all font-medium ${
                          selectedStatus === status
                            ? 'bg-wine-600 text-white border-wine-600'
                            : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Clear Filters */}
                {(selectedTypes.size > 0 || selectedStatus !== 'all') && (
                  <button
                    onClick={() => {
                      setSelectedTypes(new Set())
                      setSelectedStatus('all')
                    }}
                    className="text-sm text-wine-600 hover:text-wine-700 font-medium flex items-center gap-1"
                  >
                    <X className="w-4 h-4" />
                    Clear all filters
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Batch Actions */}
          {selectedReports.size > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={selectAllVisible}
                  className="p-2 hover:bg-emerald-100 rounded-lg transition-colors"
                >
                  {selectedReports.size === sortedReports.length ? (
                    <CheckSquare className="w-5 h-5 text-emerald-600" />
                  ) : (
                    <Square className="w-5 h-5 text-emerald-600" />
                  )}
                </button>
                <span className="font-semibold text-emerald-900">
                  {selectedReports.size} report(s) selected
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleBatchDelete}
                  className="px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Selected
                </button>
              </div>
            </motion.div>
          )}
        </div>

        {/* Folder View Sidebar + Reports Grid */}
        <div className={viewMode === 'folders' ? 'flex gap-6' : ''}>
          {/* Folder Tree Sidebar */}
          {viewMode === 'folders' && (
            <div className="w-64 flex-shrink-0">
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                  <h3 className="font-semibold text-gray-900 text-sm">Folders</h3>
                </div>
                <div className="p-2">
                  {/* All Documents */}
                  <button
                    onClick={() => setSelectedFolder(null)}
                    className={`w-full px-3 py-2 rounded-lg text-left flex items-center gap-2 transition-colors ${
                      selectedFolder === null
                        ? 'bg-wine-50 text-wine-700'
                        : 'hover:bg-gray-100 text-gray-700'
                    }`}
                  >
                    <FolderOpen className="w-4 h-4" />
                    <span className="text-sm font-medium">All Documents</span>
                    <span className="ml-auto text-xs text-gray-500">{sortedReports.length}</span>
                  </button>

                  {/* Year Folders */}
                  {Object.keys(folderStructure).sort((a, b) => parseInt(b) - parseInt(a)).map(year => (
                    <div key={year} className="mt-1">
                      <button
                        onClick={() => toggleFolder(year)}
                        className={`w-full px-3 py-2 rounded-lg text-left flex items-center gap-2 transition-colors ${
                          selectedFolder === year
                            ? 'bg-wine-50 text-wine-700'
                            : 'hover:bg-gray-100 text-gray-700'
                        }`}
                      >
                        {expandedFolders.has(year) ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                        <Folder className="w-4 h-4 text-amber-500" />
                        <span className="text-sm font-medium">{year}</span>
                        <span className="ml-auto text-xs text-gray-500">
                          {Object.values(folderStructure[year]).flat().length}
                        </span>
                      </button>

                      {/* Month Folders */}
                      <AnimatePresence>
                        {expandedFolders.has(year) && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="ml-6 overflow-hidden"
                          >
                            {Object.keys(folderStructure[year]).map(month => (
                              <button
                                key={`${year}-${month}`}
                                onClick={() => setSelectedFolder(`${year}-${month}`)}
                                className={`w-full px-3 py-2 rounded-lg text-left flex items-center gap-2 transition-colors ${
                                  selectedFolder === `${year}-${month}`
                                    ? 'bg-wine-50 text-wine-700'
                                    : 'hover:bg-gray-100 text-gray-600'
                                }`}
                              >
                                <Folder className="w-4 h-4 text-blue-500" />
                                <span className="text-sm">{month}</span>
                                <span className="ml-auto text-xs text-gray-500">
                                  {folderStructure[year][month].length}
                                </span>
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Reports Grid */}
          <div className="flex-1">
        {sortedReports.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No reports found</h3>
            <p className="text-gray-600">
              {searchQuery || selectedTypes.size > 0 || selectedStatus !== 'all'
                ? 'Try adjusting your filters'
                : 'Reports will appear here as they are generated'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedReports.map((report) => {
              const typeConfig = reportTypeConfig[report.type]
              const TypeIcon = typeConfig.icon
              const isSelected = selectedReports.has(report.id)

              return (
                <motion.div
                  key={report.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`bg-white rounded-xl border-2 transition-all cursor-pointer hover:shadow-lg ${
                    isSelected ? 'border-wine-500 bg-wine-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => toggleReportSelection(report.id)}
                >
                  <div className="p-5 space-y-4">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`p-2 ${typeConfig.color} rounded-lg`}>
                            <TypeIcon className="w-4 h-4" />
                          </div>
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${typeConfig.color}`}>
                            {typeConfig.label}
                          </span>
                        </div>
                        <h3 className="font-bold text-gray-900 text-lg mb-1 line-clamp-2">
                          {report.title}
                        </h3>
                        <p className="text-sm text-gray-500">{report.period}</p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleReportSelection(report.id)
                        }}
                        className="flex-shrink-0"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-5 h-5 text-wine-600" />
                        ) : (
                          <Square className="w-5 h-5 text-gray-300" />
                        )}
                      </button>
                    </div>

                    {/* Description */}
                    {report.description && (
                      <p className="text-sm text-gray-600 line-clamp-2">{report.description}</p>
                    )}

                    {/* Metadata */}
                    <div className="flex items-center justify-between text-xs text-gray-500 pt-3 border-t border-gray-100">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(report.sentAt)}
                      </div>
                      {report.fileSize && (
                        <div className="flex items-center gap-1">
                          <File className="w-3 h-3" />
                          {report.fileSize}
                        </div>
                      )}
                    </div>

                    {/* Recipients */}
                    <div className="flex items-center gap-2 text-xs text-gray-600">
                      <User className="w-3 h-3" />
                      <span className="truncate">
                        Sent to {report.sentTo.length} recipient(s)
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDownload(report)
                        }}
                        className="flex-1 px-3 py-2 bg-wine-600 text-white rounded-lg hover:bg-wine-700 transition-colors flex items-center justify-center gap-2 text-sm font-medium"
                      >
                        <Download className="w-4 h-4" />
                        Download
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(report.id)
                        }}
                        className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
          </div>
        </div>

        {/* Stats */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-600 mb-1">Total Reports</p>
            <p className="text-2xl font-bold text-gray-900">{sortedReports.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-600 mb-1">This Month</p>
            <p className="text-2xl font-bold text-gray-900">
              {sortedReports.filter((r) => {
                const reportDate = new Date(r.sentAt)
                const now = new Date()
                return reportDate.getMonth() === now.getMonth() && reportDate.getFullYear() === now.getFullYear()
              }).length}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-600 mb-1">Financial Reports</p>
            <p className="text-2xl font-bold text-gray-900">
              {sortedReports.filter((r) => r.type === 'financial' || r.type === 'monthly').length}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-600 mb-1">Weekly Reports</p>
            <p className="text-2xl font-bold text-gray-900">
              {sortedReports.filter((r) => r.type === 'weekly').length}
            </p>
          </div>
        </div>
          </>
        )}
      </div>
    </div>
  )
}

export default DocumentsPage
