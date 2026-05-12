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
  type ConversationFilters,
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

type ChannelFilter = 'all' | 'email' | 'sms'

export function Communications() {
  const [selectedTab, setSelectedTab] = useState<'templates' | 'history' | 'scheduled-reports'>('templates')
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all')
  const [showNewMenu, setShowNewMenu] = useState(false)
  const [showGmailBuilder, setShowGmailBuilder] = useState(false)
  const [showSMSBuilder, setShowSMSBuilder] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<SavedTemplate | null>(null)
  const [editingSMSTemplate, setEditingSMSTemplate] = useState<SavedSMSTemplate | null>(null)
  const [emailRefreshKey, setEmailRefreshKey] = useState(0)
  const [smsRefreshKey, setSmsRefreshKey] = useState(0)

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
          { key: 'templates',         label: 'Templates',         Icon: LayoutTemplate },
          { key: 'history',           label: 'Send History',      Icon: Clock },
          { key: 'scheduled-reports', label: 'Scheduled Reports', Icon: Calendar },
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
