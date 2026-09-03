import { useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { Header } from '../components/layout/Header'
import {
  Mail,
  MessageSquare,
  Calendar,
  Clock,
  LayoutTemplate,
  Plus,
  ChevronDown,
} from 'lucide-react'
import { GmailTemplateBuilder, SavedTemplate } from '../components/documents/GmailTemplateBuilder'
import { SMSTemplateBuilder } from '../components/documents/SMSTemplateBuilder'
import { SavedTemplates } from '../components/documents/SavedTemplates'
import { SavedSMSTemplates, SavedSMSTemplate } from '../components/documents/SavedSMSTemplates'
import { ReportScheduler } from '../components/communications/ReportScheduler'
import {
  scheduleReport,
  listReportSchedules,
  deleteReportSchedule,
  type ReportType,
  type ScheduledReport,
} from '../services/api/reports'
import {
  useProcurementConversationHistory,
  type ProcurementHistoryItem,
} from '../hooks/queries/useConversationQueries'
import { ClassifiedConversationList } from '../components/communications/ClassifiedConversationList'

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
  // Reaches this history list because the send happened; the status write
  // afterwards did not. Named, not left to render as a raw enum token.
  SEND_UNCONFIRMED: 'Sent · unconfirmed',
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

export function ProcurementSendHistory({
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
                    {item.direction === 'INBOUND'
                      ? 'Vendor reply'
                      : item.emailType
                        ? (EMAIL_TYPE_LABELS[item.emailType] ?? item.emailType)
                        : '—'}
                  </span>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0 ml-4">
                  <span className="text-xs text-gray-400">
                    {new Date(item.sentAt).toLocaleDateString()}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    item.direction === 'INBOUND'
                      ? 'bg-blue-100 text-blue-700'
                      : item.status === 'SEND_UNCONFIRMED'
                        ? 'bg-red-100 text-red-700'
                        : item.status === 'APPROVED' || item.status === 'AUTO_SENT'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-gray-100 text-gray-600'
                  }`}>
                    {item.direction === 'INBOUND'
                      ? 'Received'
                      : item.status
                        ? (OUTCOME_LABELS[item.status] ?? item.status)
                        : 'No status recorded'}
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

/**
 * The Scheduled Reports UI uses friendlier labels than the API's ReportType
 * enum; map rather than loosen the API type. Anything unmapped falls back to
 * the inventory summary, which is the only report guaranteed to have data.
 */
const REPORT_TYPE_MAP: Record<string, ReportType> = {
  comprehensive: 'financial_summary',
  inventory: 'inventory_summary',
  financial: 'financial_summary',
  sales: 'sales_analysis',
  procurement: 'procurement_history',
  compliance: 'compliance_report',
}
/*
 * `REPORT_FORMAT_MAP` was removed with `handleGenerateReportNow` (see below). Its
 * comment claimed "the backend renders pdf/excel/csv" — the backend renders
 * nothing; it stores a format string on a row no renderer ever reads.
 */

export function Communications() {
  // `useNavigate` went with the deleted "Open" toast action — it existed only to
  // send the user to a Documents entry that had no file.
  const [selectedTab, setSelectedTab] = useState<'templates' | 'history' | 'scheduled-reports' | 'procurement-history'>('templates')
  // NEW-359: the scheduler was wired to console.log even though the
  // /reports/schedule endpoint already existed. Schedules are saved and listed;
  // they are never executed (nothing reads `next_run_at`).
  const [schedules, setSchedules] = useState<ScheduledReport[]>([])
  const [schedulesError, setSchedulesError] = useState<string | null>(null)

  /**
   * OD-81 / ADR 0020 — "an error must never render as emptiness".
   *
   * The old body swallowed the failure with the comment "listing is additive —
   * a failure shouldn't blank the tab". It blanked the tab anyway: `schedules`
   * stayed `[]`, which the UI draws identically to "you have no schedules".
   *
   * That is not hypothetical here. Verified against the production database
   * (Restaurant_Wine_Ops / exzueerziesmczwlhomd) on 2026-08-26:
   * `public.scheduled_reports` DOES NOT EXIST. It was only ever defined in
   * `supabase/migrations_archive/20260208024921_baseline_schema.sql:408` and
   * `services/database/migrations_archive/008_providers_and_reports.sql:23` —
   * both archived, neither applied. So `GET /reports/schedules` fails 100% of
   * the time in production and this catch was the only thing the user ever saw.
   *
   * The failure is now surfaced instead of hidden, and it is kept distinct from
   * the genuine empty case so the two cannot be confused.
   */
  const refreshSchedules = useCallback(async () => {
    try {
      setSchedules(await listReportSchedules())
      setSchedulesError(null)
    } catch (err: any) {
      setSchedules([])
      setSchedulesError(
        err?.response?.data?.message ||
          'Saved schedules could not be loaded, so this list is not a record of what exists.',
      )
    }
  }, [])

  useEffect(() => {
    if (selectedTab === 'scheduled-reports') void refreshSchedules()
  }, [selectedTab, refreshSchedules])

  const handleScheduleReport = useCallback(async (config: any) => {
    try {
      await scheduleReport({
        reportType: REPORT_TYPE_MAP[config.reportType] ?? 'inventory_summary',
        title: `${config.reportType} report`,
        frequency: String(config.frequency ?? 'WEEKLY').toLowerCase(),
        // weeklyDays is Monday-indexed (0=Mon); the API expects a single day.
        dayOfWeek: config.weeklyDays?.length ? ((config.weeklyDays[0] + 1) % 7) : undefined,
        dayOfMonth: config.monthlyDay ?? undefined,
        timeOfDay: config.deliveryTime,
        parameters: {
          format: config.format,
          channels: config.channels,
          timezone: config.timezone,
          templateId: config.templateId,
          quietHoursStart: config.quietHoursStart,
          quietHoursEnd: config.quietHoursEnd,
        },
      })
      // ADR 0020: the row really is saved, so "saved" is true — but nothing in
      // the repo reads `scheduled_reports.next_run_at`, so no report will be
      // produced or delivered on it. The description says so rather than letting
      // "saved" imply a delivery that will never arrive.
      toast.success('Report schedule saved', {
        description:
          'Recorded only — report generation and delivery are not built yet, so nothing will be sent on this schedule.',
      })
      await refreshSchedules()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Could not save the schedule')
    }
  }, [refreshSchedules])

  /*
   * OD-81 / ADR 0020 — `handleGenerateReportNow` was DELETED, not relabelled.
   *
   * It called `POST /reports/generate`, which inserts a `generated_reports` row
   * with `status: "pending"` and NULL `pdf_url` / `excel_url` / `csv_url`
   * (`apps/api-gateway/src/reports/reports.service.ts:42-71` — the only writer of
   * that table in the repo). Nothing anywhere renders a file or advances that
   * status. The handler then raised `toast.success('Report generated', {
   * description: 'Filed in Documents & Reports.' })` with an Open action that
   * took the user to a Documents page where the new row had no file at all.
   *
   * Two untrue statements — that a report was generated, and that it was filed —
   * plus a button that manufactured unopenable rows. `Generate Now` is now
   * disabled in ReportScheduler with the reason on it, so there is nothing left
   * to call this.
   */

  const handleDeleteSchedule = useCallback(async (id: string) => {
    try {
      await deleteReportSchedule(id)
      toast.success('Schedule removed')
      await refreshSchedules()
    } catch {
      toast.error('Could not remove the schedule')
    }
  }, [refreshSchedules])
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
      <div className="flex gap-1 px-6 pt-4 pb-0 bg-white border-b border-gray-100" data-tour="communications-tabs">
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
            <div className="flex items-center gap-1 p-1 bg-white border border-gray-200 rounded-xl shadow-sm" data-tour="communications-channels">
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
            <div className="relative" data-tour="communications-new-template">
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
            <div data-tour="communications-template-library">
            <SavedTemplates
              key={emailRefreshKey}
              onEditTemplate={handleEditEmailTemplate}
              onDuplicateTemplate={() => setEmailRefreshKey(k => k + 1)}
              onDeleteTemplate={() => setEmailRefreshKey(k => k + 1)}
              onUseTemplate={handleEditEmailTemplate}
              onNewTemplate={handleNewEmailTemplate}
            />
            </div>
          )}

          {/* SMS cards */}
          {showSMS && (
            <div data-tour={showEmail ? undefined : 'communications-template-library'}>
            <SavedSMSTemplates
              key={smsRefreshKey}
              onEditTemplate={handleEditSMSTemplate}
              onDuplicateTemplate={() => setSmsRefreshKey(k => k + 1)}
              onDeleteTemplate={() => setSmsRefreshKey(k => k + 1)}
              onNewTemplate={handleNewSMSTemplate}
            />
            </div>
          )}
        </div>
      )}

      {/* ── History tab ── */}
      {selectedTab === 'history' && (
        <div className="p-6">
          <ClassifiedConversationList />
        </div>
      )}

      {/* ── Scheduled Reports tab ── */}
      {selectedTab === 'scheduled-reports' && (
        <div className="p-6">
          {/* No `onGenerateNow`: there is nothing to generate. See the ADR 0020
              note above `handleScheduleReport`. */}
          <ReportScheduler
            onSchedule={handleScheduleReport}
            schedules={schedules}
            schedulesError={schedulesError}
            onDeleteSchedule={handleDeleteSchedule}
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
