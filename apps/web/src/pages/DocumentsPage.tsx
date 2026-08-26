import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
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
  Trash2,
  CheckSquare,
  Square,
  X,
  File,
  Clock,
  User,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Mail,
  Eye,
  Printer,
  Send,
  LayoutGrid,
  Home,
  Info,
} from 'lucide-react'
import { Header } from '../components/layout/Header'
import { useCalendarEventsSubscription, useReportSubscription, ReportEventPayload } from '../contexts/RealtimeContext'
import { useGeneratedReports, useDeleteReport, type GeneratedReport } from '../hooks/queries/useReportQueries'
import { ClassifiedConversationList } from '../components/communications/ClassifiedConversationList'

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

/**
 * `generated_reports.report_type` is a domain enum (inventory_summary, …) while this
 * page's `ReportType` mixes cadence and domain. The old mapper cast one to the other
 * and defaulted to 'monthly' only when the value was empty, so a real row produced
 * `type: 'inventory_summary'` — a key `reportTypeConfig` does not have, and
 * `typeConfig.icon` below then throws. Mapping explicitly keeps the lookup total.
 */
const REPORT_TYPE_FROM_DB: Record<string, ReportType> = {
  inventory_summary: 'inventory',
  sales_analysis: 'sales',
  financial_summary: 'financial',
  procurement_history: 'monthly',
  compliance_report: 'monthly',
  daily: 'daily',
  weekly: 'weekly',
  monthly: 'monthly',
  financial: 'financial',
  inventory: 'inventory',
  sales: 'sales',
}

/** `status` on the table is pending/completed; this page speaks sent/draft/archived. */
const REPORT_STATUS_FROM_DB: Record<string, ReportStatus> = {
  completed: 'sent',
  sent: 'sent',
  pending: 'draft',
  draft: 'draft',
  failed: 'draft',
  archived: 'archived',
}

function formatPeriod(r: GeneratedReport): string {
  if (r.periodStart && r.periodEnd) {
    const start = new Date(r.periodStart)
    const end = new Date(r.periodEnd)
    return start.toLocaleDateString() === end.toLocaleDateString()
      ? start.toLocaleDateString()
      : `${start.toLocaleDateString()} – ${end.toLocaleDateString()}`
  }
  const created = r.createdAt ? new Date(r.createdAt) : new Date()
  return created.toLocaleString('default', { month: 'long', year: 'numeric' })
}

/**
 * OD-45: maps the gateway's ReportResponseDto onto this page's view model.
 *
 * The previous version read `metadata.title`, `metadata.sentTo`, `metadata.fileSize`,
 * `metadata.tags` and `file_url` — none of which are columns on `generated_reports`,
 * so they were permanently undefined. Only fields with a real column behind them are
 * populated now; `sentTo`, `fileSize` and `tags` have no source and stay empty rather
 * than pretending to have one.
 */
function mapGeneratedReportToUi(r: GeneratedReport): Report {
  const createdAt = r.createdAt ?? new Date().toISOString()
  return {
    id: r.id,
    title: r.title || `Report — ${new Date(createdAt).toLocaleDateString()}`,
    type: REPORT_TYPE_FROM_DB[r.reportType?.toLowerCase() ?? ''] ?? 'monthly',
    status: REPORT_STATUS_FROM_DB[r.status?.toLowerCase() ?? ''] ?? 'sent',
    sentAt: createdAt,
    sentTo: [],
    period: formatPeriod(r),
    fileUrl: r.pdfUrl ?? r.excelUrl ?? r.csvUrl ?? undefined,
    description: r.summary ?? undefined,
  }
}

/**
 * OD-81 / ADR 0020 — a control that can only ever fail must not look live.
 *
 * Every row on this page comes from `generated_reports`, and the only writer of
 * that table is `POST /reports/generate`
 * (`apps/api-gateway/src/reports/reports.service.ts:42-71`), which inserts
 * `status: "pending"` and leaves `pdf_url` / `excel_url` / `csv_url` NULL.
 * Nothing in the repo — gateway, agent-orchestrator, self-evolution, a Supabase
 * edge function or any scheduled job — ever renders a file or advances that
 * status, so `fileUrl` is structurally always undefined and View / Download /
 * Print could only ever pop `alert("No file available")`.
 *
 * Those alerts are gone. The buttons are disabled and say why. The condition is
 * still computed per row rather than hard-coded to `false`, so the day a real
 * generator lands and starts filling `pdf_url`, the controls come back on their
 * own with no change here.
 */
export const NO_REPORT_FILE_REASON =
  'Report file generation is not built yet — this entry has no file to open.'

export function reportFileUnavailableReason(
  report: Pick<Report, 'fileUrl'>,
): string | null {
  return report.fileUrl ? null : NO_REPORT_FILE_REASON
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
  // §M additions: preview (NEW-449), right-click menu (NEW-460), keyboard (NEW-469).
  const [previewReport, setPreviewReport] = useState<Report | null>(null)
  const [docMenu, setDocMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const docSearchRef = useRef<HTMLInputElement>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'folders'>('folders')
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['2026', '2026-January']))
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'reports' | 'history'>('reports')
  const [_scheduledReports, setScheduledReports] = useState<string[]>([])
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
    // Guarded rather than alerting: the button that reaches this is disabled
    // when there is no file, so this is a backstop, not a user-facing path.
    if (!report.fileUrl) return
    window.open(report.fileUrl, '_blank')
  }

  const handleDelete = (reportId: string) => {
    if (confirm('Are you sure you want to delete this report?')) {
      deleteReportMutation.mutate(reportId)
    }
  }

  /** NEW-449: open a real preview instead of a placeholder. */
  const handleView = (report: Report) => {
    if (!report.fileUrl) return
    setPreviewReport(report)
  }

  /** NEW-450: compose an email with the document linked. */
  const handleEmail = (report: Report) => {
    const subject = encodeURIComponent(report.title)
    const body = encodeURIComponent(
      [
        `${report.title}`,
        report.description ? `\n${report.description}` : '',
        report.period ? `\nPeriod: ${report.period}` : '',
        report.fileUrl ? `\n\nDocument: ${report.fileUrl}` : '\n\n(No file attached yet.)',
      ].join(''),
    )
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }

  /**
   * NEW-451: print. A cross-origin file can't be driven from this page, so the
   * document is opened in its own tab where the browser's print works — rather
   * than silently failing on a blocked iframe.
   */
  const handlePrint = (report: Report) => {
    if (!report.fileUrl) return
    const w = window.open(report.fileUrl, '_blank')
    if (w) {
      w.addEventListener('load', () => { try { w.print() } catch { /* cross-origin: user prints manually */ } })
    }
  }

  const handleCopyLink = (report: Report) => {
    navigator.clipboard?.writeText(report.fileUrl || `${window.location.origin}/documents-reports?doc=${report.id}`)
  }

  // ── Keyboard (NEW-469) ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey) return
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if (previewReport) {
        if (e.key === 'Escape') setPreviewReport(null)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        if (typing) return
        e.preventDefault()
        setSelectedReports(new Set(sortedReports.map(r => r.id)))
        return
      }
      if (e.metaKey || e.ctrlKey || typing) return
      if (e.key === '/') { e.preventDefault(); docSearchRef.current?.focus() }
      else if (e.key === 'Escape' && selectedReports.size) setSelectedReports(new Set())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sortedReports, previewReport, selectedReports.size])

  useEffect(() => {
    if (!docMenu) return
    const close = () => setDocMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [docMenu])

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
          <ClassifiedConversationList />
        )}

        {/* Reports Tab */}
        {activeTab === 'reports' && (
          <>
        {/*
          OD-81 / ADR 0020. Stated once, up front, rather than letting the user
          find out by clicking. Shown only while entries genuinely have no file,
          so it disappears by itself once a generator starts filling `pdf_url`.
        */}
        {apiReports.some((r) => !r.fileUrl) && (
          <div className="mb-6 flex items-start gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
            <Info className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-gray-600 leading-relaxed">
              Report file generation is not built yet — nothing in the platform
              produces a PDF, spreadsheet or download. The entries below are the
              requests on record; View, Download and Print stay disabled until
              there is a real file behind them.
            </p>
          </div>
        )}

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
                ref={docSearchRef}
                type="text"
                placeholder="Search reports by title, period, or description...    ( / )"
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
                  onDoubleClick={() => handleView(report)}
                  onContextMenu={(e) => { e.preventDefault(); setDocMenu({ id: report.id, x: e.clientX, y: e.clientY }) }}
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

                    {/* Actions (NEW-449/450/451) */}
                    <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleView(report) }}
                        disabled={!report.fileUrl}
                        title={reportFileUnavailableReason(report) ?? 'View'}
                        className={
                          report.fileUrl
                            ? 'flex-1 px-3 py-2 bg-wine-600 text-white rounded-lg hover:bg-wine-700 transition-colors flex items-center justify-center gap-2 text-sm font-medium'
                            : 'flex-1 px-3 py-2 bg-gray-100 text-gray-400 rounded-lg cursor-not-allowed flex items-center justify-center gap-2 text-sm font-medium'
                        }
                      >
                        <Eye className="w-4 h-4" />
                        View
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDownload(report) }}
                        disabled={!report.fileUrl}
                        title={reportFileUnavailableReason(report) ?? 'Download'}
                        className={
                          report.fileUrl
                            ? 'p-2 text-gray-400 hover:text-wine-600 hover:bg-wine-50 rounded-lg transition-colors'
                            : 'p-2 text-gray-300 cursor-not-allowed rounded-lg'
                        }
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleEmail(report) }}
                        title="Email"
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      >
                        <Mail className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handlePrint(report) }}
                        disabled={!report.fileUrl}
                        title={reportFileUnavailableReason(report) ?? 'Print'}
                        className={
                          report.fileUrl
                            ? 'p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors'
                            : 'p-2 text-gray-300 cursor-not-allowed rounded-lg'
                        }
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(report.id) }}
                        title="Delete"
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

        {/* Document preview (NEW-449) */}
        {previewReport && (
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center px-4"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setPreviewReport(null) }}
          >
            <div className="absolute inset-0 bg-gray-900/50" aria-hidden />
            <div className="relative w-full max-w-4xl h-[80vh] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden" role="dialog" aria-modal="true">
              <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-gray-100">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">{previewReport.title}</p>
                  <p className="text-xs text-gray-400">{previewReport.period} · {formatDate(previewReport.sentAt)}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => handleDownload(previewReport)} className="p-2 text-gray-400 hover:text-wine-600 hover:bg-wine-50 rounded-lg" title="Download">
                    <Download className="w-4 h-4" />
                  </button>
                  <button onClick={() => handlePrint(previewReport)} className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg" title="Print">
                    <Printer className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleEmail(previewReport)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="Email">
                    <Mail className="w-4 h-4" />
                  </button>
                  <button onClick={() => setPreviewReport(null)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg" aria-label="Close">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <iframe
                src={previewReport.fileUrl ?? ''}
                title={previewReport.title}
                className="flex-1 w-full bg-gray-50"
              />
              <div className="px-5 py-2 border-t border-gray-100 text-[11px] text-gray-400">
                If the document doesn't render here, the host blocks embedding — use Download or Print.
              </div>
            </div>
          </div>
        )}

        {/* Right-click document menu (NEW-460) */}
        {docMenu && (() => {
          const report = sortedReports.find(r => r.id === docMenu.id)
          if (!report) return null
          const Item = ({ label, danger, disabled, title, onClick }: { label: string; danger?: boolean; disabled?: boolean; title?: string; onClick: () => void }) => (
            <button
              onClick={onClick}
              disabled={disabled}
              title={title}
              className={`w-full text-left px-3 py-1.5 text-sm rounded-lg ${
                disabled
                  ? 'text-gray-300 cursor-not-allowed'
                  : `hover:bg-gray-50 ${danger ? 'text-rose-600' : 'text-gray-700'}`
              }`}
            >
              {label}
            </button>
          )
          // ADR 0020: the file-backed entries of this menu go grey with a reason
          // instead of firing an action that cannot succeed. Email and Copy link
          // stay live — both degrade honestly without a file.
          const noFile = reportFileUnavailableReason(report)
          return (
            <div
              className="fixed z-[80] w-48 bg-white border border-gray-200 rounded-xl shadow-xl p-1"
              style={{ top: Math.min(docMenu.y, window.innerHeight - 250), left: Math.min(docMenu.x, window.innerWidth - 210) }}
              onClick={(e) => e.stopPropagation()}
            >
              <Item label="View" disabled={!!noFile} title={noFile ?? undefined} onClick={() => { handleView(report); setDocMenu(null) }} />
              <Item label="Download" disabled={!!noFile} title={noFile ?? undefined} onClick={() => { handleDownload(report); setDocMenu(null) }} />
              <Item label="Email" onClick={() => { handleEmail(report); setDocMenu(null) }} />
              <Item label="Print" disabled={!!noFile} title={noFile ?? undefined} onClick={() => { handlePrint(report); setDocMenu(null) }} />
              <Item label="Copy link" onClick={() => { handleCopyLink(report); setDocMenu(null) }} />
              <Item label="Delete" danger onClick={() => { setDocMenu(null); handleDelete(report.id) }} />
            </div>
          )
        })()}

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
