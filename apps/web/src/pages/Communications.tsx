import { useState, useCallback } from 'react'
import { Header } from '../components/layout/Header'
import {
  Mail,
  MessageSquare,
  Calendar,
  Clock,
  LayoutTemplate,
  Search,
  FileText,
  Plus,
  ChevronDown,
} from 'lucide-react'
import { GmailTemplateBuilder, SavedTemplate } from '../components/documents/GmailTemplateBuilder'
import { SMSTemplateBuilder } from '../components/documents/SMSTemplateBuilder'
import { SavedTemplates } from '../components/documents/SavedTemplates'
import { SavedSMSTemplates, SavedSMSTemplate } from '../components/documents/SavedSMSTemplates'
import { ReportScheduler } from '../components/communications/ReportScheduler'
import {
  useConversations,
  useConversationStats,
  useProcurementConversationHistory,
  type ConversationFilters,
  type ProcurementHistoryItem,
} from '../hooks/queries/useConversationQueries'

function ApiCommunicationHistory() {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterChannel, setFilterChannel] = useState<string>('')
  const [page, setPage] = useState(1)

  const filters: ConversationFilters = {
    channel: filterChannel || undefined,
    search: searchQuery || undefined,
    page,
    limit: 20,
    sortBy: 'created_at',
    sortOrder: 'desc',
  }

  const { data: conversationsData, isLoading, error } = useConversations(filters)
  const { data: statsData } = useConversationStats()

  const conversations = conversationsData?.conversations || []
  const total = conversationsData?.total || 0
  const totalPages = conversationsData?.totalPages || 0

  const channelConfig: Record<string, { icon: any; color: string; label: string }> = {
    email: { icon: Mail, color: 'bg-blue-100 text-blue-600', label: 'Email' },
    sms: { icon: MessageSquare, color: 'bg-emerald-100 text-emerald-600', label: 'SMS' },
    voice: { icon: FileText, color: 'bg-purple-100 text-purple-600', label: 'Voice' },
    whatsapp: { icon: MessageSquare, color: 'bg-green-100 text-green-600', label: 'WhatsApp' },
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Object.entries(channelConfig).map(([channel, config]) => {
          const Icon = config.icon
          const count = (statsData?.byChannel as any)?.[channel] || 0
          return (
            <button
              key={channel}
              onClick={() => setFilterChannel(filterChannel === channel ? '' : channel)}
              className={`p-4 rounded-xl border-2 transition-all ${
                filterChannel === channel
                  ? 'border-wine-500 bg-wine-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className={`w-8 h-8 ${config.color} rounded-lg flex items-center justify-center mx-auto mb-2`}>
                <Icon className="w-4 h-4" />
              </div>
              <p className="text-lg font-bold text-gray-900">{count}</p>
              <p className="text-xs text-gray-500">{config.label}</p>
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setPage(1) }}
          placeholder="Search conversations..."
          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-wine-500 focus:border-transparent"
        />
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Communication History</h3>
          <p className="text-sm text-gray-500">{total} conversations {isLoading && '(loading...)'}</p>
        </div>

        <div className="divide-y divide-gray-100">
          {isLoading ? (
            <div className="p-12 text-center">
              <Clock className="w-8 h-8 text-wine-400 mx-auto mb-3 animate-spin" />
              <p className="text-gray-600">Loading...</p>
            </div>
          ) : error ? (
            <div className="p-12 text-center">
              <p className="text-gray-600">Failed to load conversations</p>
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-12 text-center">
              <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600 font-medium">No conversations found</p>
            </div>
          ) : (
            conversations.map((conv) => {
              const conf = channelConfig[conv.channel] || channelConfig.email
              const Icon = conf.icon
              return (
                <div key={conv.id} className="px-6 py-4 hover:bg-gray-50/50 transition-colors">
                  <div className="flex items-start gap-4">
                    <div className={`p-2 ${conf.color} rounded-xl flex-shrink-0`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-gray-900 truncate">
                        {conv.procurement_orders?.wine_name || conv.detected_intent || 'Conversation'}
                      </h4>
                      <p className="text-sm text-gray-500 truncate">
                        {conv.providers?.name || 'Unknown vendor'}
                      </p>
                      <p className="text-sm text-gray-600 line-clamp-1 mt-1">{conv.message_text}</p>
                    </div>
                    <span className="text-xs text-gray-500 flex-shrink-0">
                      {conv.created_at ? new Date(conv.created_at).toLocaleDateString() : '—'}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>

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

// ── Phase 34: Procurement Send History ────────────────────────────────────

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

const OUTCOME_LABELS: Record<string, string> = {
  AUTO_SENT: 'Auto-sent',
  APPROVED: 'Approved',
  SENT: 'Sent',
  COMPLETED: 'Completed',
  CLOSED: 'Closed',
}

interface ProcurementSendHistoryProps {
  items: ProcurementHistoryItem[]
  isLoading: boolean
  expandedRowId: string | null
  onExpandRow: (id: string) => void
  dateFrom: string
  onDateFromChange: (v: string) => void
  providerFilter: string
  onProviderFilterChange: (v: string) => void
  typeFilter: string
  onTypeFilterChange: (v: string) => void
  wineFilter: string
  onWineFilterChange: (v: string) => void
}

function ProcurementSendHistory({
  items, isLoading, expandedRowId, onExpandRow,
  dateFrom, onDateFromChange, providerFilter, onProviderFilterChange,
  typeFilter, onTypeFilterChange,
  wineFilter, onWineFilterChange,
}: ProcurementSendHistoryProps) {
  const defaultFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const effectiveDateFrom = dateFrom || defaultFrom

  const filtered = items.filter((item) => {
    const sentDate = item.sentAt.split('T')[0]
    if (sentDate < effectiveDateFrom) return false
    if (providerFilter && !(item.providerName ?? '').toLowerCase().includes(providerFilter.toLowerCase())) return false
    if (typeFilter && item.emailType !== typeFilter) return false
    if (wineFilter && !(item.wineName ?? '').toLowerCase().includes(wineFilter.toLowerCase())) return false
    return true
  })

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 p-4 bg-gray-50 rounded-xl border border-gray-200">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 font-medium">From:</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFromChange(e.target.value)}
            className="text-xs border border-gray-300 rounded-lg px-2 py-1 text-gray-700"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 font-medium">Provider:</label>
          <input
            type="text"
            placeholder="Filter by provider…"
            value={providerFilter}
            onChange={(e) => onProviderFilterChange(e.target.value)}
            className="text-xs border border-gray-300 rounded-lg px-2 py-1 text-gray-700 w-36"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 font-medium">Type:</label>
          <select
            value={typeFilter}
            onChange={(e) => onTypeFilterChange(e.target.value)}
            className="text-xs border border-gray-300 rounded-lg px-2 py-1 text-gray-700"
          >
            <option value="">All types</option>
            {Object.entries(EMAIL_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 font-medium">Wine:</label>
          <input
            type="text"
            placeholder="Filter by wine…"
            value={wineFilter}
            onChange={(e) => onWineFilterChange(e.target.value)}
            className="text-xs border border-gray-300 rounded-lg px-2 py-1 text-gray-700 w-36"
          />
        </div>
        <span className="ml-auto text-xs text-gray-400 self-center">
          {filtered.length} result{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      {isLoading && (
        <p className="text-sm text-gray-500 text-center py-8">Loading history…</p>
      )}
      {!isLoading && filtered.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">No procurement emails in this period.</p>
      )}
      <div className="divide-y divide-gray-100">
        {filtered.map((item) => {
          const isExpanded = expandedRowId === item.id
          const [body, disclaimer] = (item.draftContent ?? '').split('\n\n—\n')
          return (
            <div key={item.id} className="py-3">
              {/* Row summary */}
              <button
                onClick={() => onExpandRow(item.id)}
                className="w-full flex items-center justify-between text-left px-2 py-1 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {item.wineName ?? 'Unknown Wine'}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {item.providerName ?? 'Unknown Provider'}
                    </p>
                  </div>
                  <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full flex-shrink-0">
                    {EMAIL_TYPE_LABELS[item.emailType] ?? item.emailType}
                  </span>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0 ml-4">
                  <span className="text-xs text-gray-400">
                    {new Date(item.sentAt).toLocaleDateString()}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    item.status === 'APPROVED' || item.status === 'AUTO_SENT'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}>
                    {OUTCOME_LABELS[item.status] ?? item.status}
                  </span>
                  <span className="text-gray-400 text-xs">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </button>

              {/* Expanded thread replay */}
              {isExpanded && (
                <div className="mt-3 mx-2 p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
                  {/* Metadata */}
                  <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                    <span><strong>Order:</strong> {item.orderNumber ?? '—'}</span>
                    <span><strong>Qty:</strong> {item.quantity != null ? `${item.quantity} bottles` : '—'}</span>
                    <span><strong>Rounds:</strong> {item.roundCount}</span>
                    <span><strong>Sent:</strong> {new Date(item.sentAt).toLocaleString()}</span>
                  </div>
                  {/* Draft body */}
                  <div>
                    <p className="text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Draft Body</p>
                    <pre className="text-xs text-gray-700 bg-white border border-gray-200 rounded-lg p-3 whitespace-pre-wrap font-sans">
                      {body || item.draftContent || '(no content)'}
                    </pre>
                  </div>
                  {/* Disclaimer */}
                  {disclaimer && (
                    <p className="text-xs text-gray-400 italic">{disclaimer}</p>
                  )}
                  {/* Constraint warnings */}
                  {item.constraintFlags?.annotating?.length ? (
                    <div>
                      <p className="text-xs font-semibold text-amber-600 mb-1">Constraint Notes</p>
                      <ul className="list-disc list-inside text-xs text-amber-700 space-y-0.5">
                        {item.constraintFlags.annotating.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {/* Rolling summary */}
                  {item.rollingSummary && (
                    <div>
                      <p className="text-xs font-semibold text-gray-600 mb-1">Conversation Summary</p>
                      <p className="text-xs text-gray-600 bg-white border border-gray-200 rounded-lg p-3">
                        {item.rollingSummary}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

type ChannelFilter = 'all' | 'email' | 'sms'

export function Communications() {
  const [selectedTab, setSelectedTab] = useState<'templates' | 'history' | 'scheduled-reports' | 'procurement-history'>('templates')
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all')
  const [showNewMenu, setShowNewMenu] = useState(false)
  const [showGmailBuilder, setShowGmailBuilder] = useState(false)
  const [showSMSBuilder, setShowSMSBuilder] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<SavedTemplate | null>(null)
  const [editingSMSTemplate, setEditingSMSTemplate] = useState<SavedSMSTemplate | null>(null)
  const [emailRefreshKey, setEmailRefreshKey] = useState(0)
  const [smsRefreshKey, setSmsRefreshKey] = useState(0)

  // Procurement history tab state
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const [histDateFrom, setHistDateFrom] = useState('')
  const [histProviderFilter, setHistProviderFilter] = useState('')
  const [histTypeFilter, setHistTypeFilter] = useState('')
  const [histWineFilter, setHistWineFilter] = useState('')
  const { data: procurementHistory = [], isLoading: histLoading } = useProcurementConversationHistory()

  const handleNewEmailTemplate = useCallback(() => {
    setEditingTemplate(null)
    setShowGmailBuilder(true)
    setShowNewMenu(false)
  }, [])

  const handleEditEmailTemplate = useCallback((template: SavedTemplate) => {
    setEditingTemplate(template)
    setShowGmailBuilder(true)
  }, [])

  const handleNewSMSTemplate = useCallback(() => {
    setEditingSMSTemplate(null)
    setShowSMSBuilder(true)
    setShowNewMenu(false)
  }, [])

  const handleEditSMSTemplate = useCallback((template: SavedSMSTemplate) => {
    setEditingSMSTemplate(template)
    setShowSMSBuilder(true)
  }, [])

  const showEmail = channelFilter === 'all' || channelFilter === 'email'
  const showSMS   = channelFilter === 'all' || channelFilter === 'sms'

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header
        title="Communications"
        subtitle="Manage templates, send history, and scheduled reports"
      />

      {/* Top tab bar */}
      <div className="flex gap-1 px-6 pt-4 pb-0 bg-white border-b border-gray-100">
        {([
          { key: 'templates',          label: 'Templates',          Icon: LayoutTemplate },
          { key: 'history',            label: 'Send History',       Icon: Clock },
          { key: 'scheduled-reports',  label: 'Scheduled Reports',  Icon: Calendar },
          { key: 'procurement-history', label: 'Procurement Emails', Icon: Mail },
        ] as const).map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setSelectedTab(key)}
            className={[
              'flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all -mb-px',
              selectedTab === key
                ? 'border-wine-600 text-wine-600'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Templates tab ── */}
      {selectedTab === 'templates' && (
        <div className="flex-1 p-6 space-y-6">

          {/* Channel switcher + New button */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-1 p-1 bg-white border border-gray-200 rounded-xl shadow-sm">
              {([
                { key: 'all',   label: 'All Templates', Icon: LayoutTemplate },
                { key: 'email', label: 'Email',          Icon: Mail },
                { key: 'sms',   label: 'SMS',            Icon: MessageSquare },
              ] as const).map(({ key, label, Icon }) => (
                <button
                  key={key}
                  onClick={() => setChannelFilter(key)}
                  className={[
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
                    channelFilter === key
                      ? 'bg-wine-600 text-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50',
                  ].join(' ')}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>

            {/* New Template dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowNewMenu(v => !v)}
                className="flex items-center gap-2 px-4 py-2.5 bg-wine-600 hover:bg-wine-700 text-white rounded-xl text-sm font-semibold shadow-sm transition-all"
              >
                <Plus className="w-4 h-4" />
                New Template
                <ChevronDown className={`w-4 h-4 transition-transform ${showNewMenu ? 'rotate-180' : ''}`} />
              </button>
              {showNewMenu && (
                <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-xl shadow-xl border border-gray-100 py-1.5 z-50">
                  <button
                    onClick={handleNewEmailTemplate}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Mail className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="text-left">
                      <p className="font-semibold text-gray-800">Email Template</p>
                      <p className="text-xs text-gray-400">Drag-and-drop canvas</p>
                    </div>
                  </button>
                  <button
                    onClick={handleNewSMSTemplate}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <MessageSquare className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div className="text-left">
                      <p className="font-semibold text-gray-800">SMS Template</p>
                      <p className="text-xs text-gray-400">With iPhone preview</p>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Email cards */}
          {showEmail && (
            <SavedTemplates
              key={emailRefreshKey}
              onEditTemplate={handleEditEmailTemplate}
              onDuplicateTemplate={() => setEmailRefreshKey(k => k + 1)}
              onDeleteTemplate={() => setEmailRefreshKey(k => k + 1)}
              onUseTemplate={handleEditEmailTemplate}
              onNewTemplate={handleNewEmailTemplate}
            />
          )}

          {/* SMS cards */}
          {showSMS && (
            <SavedSMSTemplates
              key={smsRefreshKey}
              onEditTemplate={handleEditSMSTemplate}
              onDuplicateTemplate={() => setSmsRefreshKey(k => k + 1)}
              onDeleteTemplate={() => setSmsRefreshKey(k => k + 1)}
              onNewTemplate={handleNewSMSTemplate}
            />
          )}
        </div>
      )}

      {/* ── History tab ── */}
      {selectedTab === 'history' && (
        <div className="p-6">
          <ApiCommunicationHistory />
        </div>
      )}

      {/* ── Scheduled Reports tab ── */}
      {selectedTab === 'scheduled-reports' && (
        <div className="p-6">
          <ReportScheduler
            onSchedule={(config) => { console.log('Report schedule saved:', config) }}
            onGenerateNow={(reportType, format) => { console.log('Generating report now:', reportType, format) }}
          />
        </div>
      )}

      {/* ── Procurement Emails tab ── */}
      {selectedTab === 'procurement-history' && (
        <div className="p-6">
          <ProcurementSendHistory
            items={procurementHistory}
            isLoading={histLoading}
            expandedRowId={expandedRowId}
            onExpandRow={(id) => setExpandedRowId(expandedRowId === id ? null : id)}
            dateFrom={histDateFrom}
            onDateFromChange={setHistDateFrom}
            providerFilter={histProviderFilter}
            onProviderFilterChange={setHistProviderFilter}
            typeFilter={histTypeFilter}
            onTypeFilterChange={setHistTypeFilter}
            wineFilter={histWineFilter}
            onWineFilterChange={setHistWineFilter}
          />
        </div>
      )}

      {/* Gmail Template Builder Modal */}
      {showGmailBuilder && (
        <GmailTemplateBuilder
          onClose={() => { setShowGmailBuilder(false); setEditingTemplate(null) }}
          onSave={() => { setShowGmailBuilder(false); setEditingTemplate(null); setEmailRefreshKey(k => k + 1) }}
          editingTemplate={editingTemplate}
        />
      )}

      {/* SMS Template Builder Modal */}
      {showSMSBuilder && (
        <SMSTemplateBuilder
          onClose={() => { setShowSMSBuilder(false); setEditingSMSTemplate(null) }}
          onSave={() => { setShowSMSBuilder(false); setEditingSMSTemplate(null); setSmsRefreshKey(k => k + 1) }}
          editingTemplate={editingSMSTemplate as any}
        />
      )}
    </div>
  )
}
export default Communications
