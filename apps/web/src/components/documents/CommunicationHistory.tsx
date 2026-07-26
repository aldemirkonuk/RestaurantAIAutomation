import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Phone, Mail, ChevronDown, ChevronRight, Calendar, Search, Download, Wine, Building2, Clock, Check, X, MessageSquare } from 'lucide-react'
import { Card, Button } from '../ui'
import { ExportMenu } from '../ui/ExportMenu'
import { exportTable, type TableExportColumn, type TableExportFormat } from '../../lib/tableExport'
import { toast } from 'sonner'

type CommunicationType = 'phone' | 'email'
type TimeFilter = 'week' | 'month' | 'year' | 'all'
type GroupBy = 'wine' | 'provider' | 'date'

interface Communication {
  id: string
  type: CommunicationType
  wineName: string
  wineId: string
  providerName: string
  providerId: string
  timestamp: Date
  duration?: number // In seconds, for phone calls
  summary: string
  outcome: 'success' | 'pending' | 'failed'
  attachments?: string[]
  notes?: string
}

// Mock data for communication history
const generateMockCommunications = (): Communication[] => {
  const wines = [
    { id: 'WINE_001', name: 'Château Lafite Rothschild 2018' },
    { id: 'WINE_002', name: 'Opus One 2019' },
    { id: 'WINE_003', name: 'Dom Pérignon 2012' },
    { id: 'WINE_004', name: 'Screaming Eagle Cabernet 2015' },
    { id: 'WINE_005', name: 'Penfolds Grange 2017' },
  ]

  const providers = [
    { id: 'PROV_001', name: 'Southern Glazer\'s Wine & Spirits' },
    { id: 'PROV_003', name: 'Breakthru Beverage Group' },
    { id: 'PROV_006', name: 'Martignetti Companies' },
    { id: 'PROV_009', name: 'Winebow' },
    { id: 'PROV_011', name: 'Kobrand Corporation' },
  ]

  const comms: Communication[] = []

  // Generate communications over the past 12 months
  for (let i = 0; i < 50; i++) {
    const wine = wines[Math.floor(Math.random() * wines.length)]
    const provider = providers[Math.floor(Math.random() * providers.length)]
    const daysAgo = Math.floor(Math.random() * 365)
    const type: CommunicationType = Math.random() > 0.5 ? 'phone' : 'email'
    const outcome: Communication['outcome'] = Math.random() > 0.9 ? 'failed' : Math.random() > 0.8 ? 'pending' : 'success'

    comms.push({
      id: `COMM_${Date.now()}_${i}`,
      type,
      wineName: wine.name,
      wineId: wine.id,
      providerName: provider.name,
      providerId: provider.id,
      timestamp: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      duration: type === 'phone' ? Math.floor(Math.random() * 300) + 60 : undefined,
      summary: `Discussed ${wine.name} availability and pricing. Provider confirmed stock and offered competitive rate of $${Math.floor(Math.random() * 200) + 100} per bottle. Delivery available within 2-3 business days.`,
      outcome,
      notes: outcome === 'failed' ? 'Provider unavailable, will retry tomorrow.' : undefined,
    })
  }

  return comms.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
}

export function CommunicationHistory() {
  const [communications] = useState<Communication[]>(generateMockCommunications())
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('month')
  const [typeFilter, setTypeFilter] = useState<CommunicationType | 'all'>('all')
  const [groupBy, setGroupBy] = useState<GroupBy>('date')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [selectedComm, setSelectedComm] = useState<Communication | null>(null)

  // Filter communications
  const filteredCommunications = useMemo(() => {
    let filtered = communications

    // Time filter
    const now = new Date()
    const cutoff = new Date()
    if (timeFilter === 'week') {
      cutoff.setDate(now.getDate() - 7)
    } else if (timeFilter === 'month') {
      cutoff.setMonth(now.getMonth() - 1)
    } else if (timeFilter === 'year') {
      cutoff.setFullYear(now.getFullYear() - 1)
    } else {
      cutoff.setFullYear(2000) // Show all
    }
    filtered = filtered.filter(c => c.timestamp >= cutoff)

    // Type filter
    if (typeFilter !== 'all') {
      filtered = filtered.filter(c => c.type === typeFilter)
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(c =>
        c.wineName.toLowerCase().includes(query) ||
        c.providerName.toLowerCase().includes(query) ||
        c.summary.toLowerCase().includes(query)
      )
    }

    return filtered
  }, [communications, timeFilter, typeFilter, searchQuery])

  // Group communications
  const groupedCommunications = useMemo(() => {
    const groups: { [key: string]: Communication[] } = {}

    filteredCommunications.forEach(comm => {
      let key: string

      if (groupBy === 'wine') {
        key = comm.wineName
      } else if (groupBy === 'provider') {
        key = comm.providerName
      } else {
        // Group by date (week)
        const weekStart = new Date(comm.timestamp)
        weekStart.setDate(weekStart.getDate() - weekStart.getDay())
        key = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      }

      if (!groups[key]) {
        groups[key] = []
      }
      groups[key].push(comm)
    })

    return groups
  }, [filteredCommunications, groupBy])

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups(prev => {
      const newSet = new Set(prev)
      if (newSet.has(groupKey)) {
        newSet.delete(groupKey)
      } else {
        newSet.add(groupKey)
      }
      return newSet
    })
  }

  const getOutcomeIcon = (outcome: Communication['outcome']) => {
    switch (outcome) {
      case 'success':
        return <Check className="w-4 h-4 text-emerald-600" />
      case 'pending':
        return <Clock className="w-4 h-4 text-amber-600" />
      case 'failed':
        return <X className="w-4 h-4 text-rose-600" />
    }
  }

  const getOutcomeColor = (outcome: Communication['outcome']) => {
    switch (outcome) {
      case 'success':
        return 'text-emerald-600'
      case 'pending':
        return 'text-amber-600'
      case 'failed':
        return 'text-rose-600'
    }
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const handleExport = async (format: TableExportFormat) => {
    const columns: TableExportColumn<Communication>[] = [
      { header: 'Date', value: (c) => c.timestamp.toLocaleString() },
      { header: 'Type', value: (c) => c.type.toUpperCase() },
      { header: 'Wine', value: (c) => c.wineName },
      { header: 'Provider', value: (c) => c.providerName },
      { header: 'Outcome', value: (c) => c.outcome.toUpperCase() },
      { header: 'Duration', value: (c) => (c.duration ? formatDuration(c.duration) : 'N/A') },
      { header: 'Summary', value: (c) => c.summary },
    ]
    try {
      await exportTable({
        format,
        rows: filteredCommunications,
        columns,
        filename: `communication-history-${new Date().toISOString().split('T')[0]}`,
        title: 'Communication History',
      })
      toast.success(
        format === 'clipboard'
          ? `Copied ${filteredCommunications.length} rows`
          : format === 'print'
            ? 'Opening print view'
            : `Exported ${filteredCommunications.length} rows`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Communication History</h2>
          <p className="text-sm text-gray-600 mt-1">
            Archive of all AI-provider conversations via phone and email
          </p>
        </div>
        <ExportMenu
          variant="outline"
          label="Export"
          count={filteredCommunications.length}
          onExport={handleExport}
          title="Export filtered communication history"
        />
      </div>

      {/* Filters */}
      <Card variant="glass" padding="md">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Search */}
          <div className="md:col-span-2 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search wines, providers, or summaries..."
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
            />
          </div>

          {/* Time Filter */}
          <select
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value as TimeFilter)}
            className="px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
          >
            <option value="week">Past Week</option>
            <option value="month">Past Month</option>
            <option value="year">Past Year</option>
            <option value="all">All Time</option>
          </select>

          {/* Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as CommunicationType | 'all')}
            className="px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
          >
            <option value="all">All Types</option>
            <option value="phone">Phone Calls</option>
            <option value="email">Emails</option>
          </select>
        </div>

        {/* Group By */}
        <div className="mt-4 flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Group By:</span>
          {[
            { value: 'date' as const, label: 'Date', icon: Calendar },
            { value: 'wine' as const, label: 'Wine', icon: Wine },
            { value: 'provider' as const, label: 'Provider', icon: Building2 },
          ].map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setGroupBy(value)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                groupBy === value
                  ? 'bg-wine-100 text-wine-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card variant="glass" padding="md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Communications</p>
              <p className="text-2xl font-bold text-gray-900">{filteredCommunications.length}</p>
            </div>
            <MessageSquare className="w-8 h-8 text-blue-600" />
          </div>
        </Card>
        <Card variant="glass" padding="md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Phone Calls</p>
              <p className="text-2xl font-bold text-wine-600">
                {filteredCommunications.filter(c => c.type === 'phone').length}
              </p>
            </div>
            <Phone className="w-8 h-8 text-wine-600" />
          </div>
        </Card>
        <Card variant="glass" padding="md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Emails</p>
              <p className="text-2xl font-bold text-purple-600">
                {filteredCommunications.filter(c => c.type === 'email').length}
              </p>
            </div>
            <Mail className="w-8 h-8 text-purple-600" />
          </div>
        </Card>
        <Card variant="glass" padding="md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Success Rate</p>
              <p className="text-2xl font-bold text-emerald-600">
                {Math.round((filteredCommunications.filter(c => c.outcome === 'success').length / filteredCommunications.length) * 100)}%
              </p>
            </div>
            <Check className="w-8 h-8 text-emerald-600" />
          </div>
        </Card>
      </div>

      {/* Grouped Communications */}
      <div className="space-y-3">
        {Object.entries(groupedCommunications).map(([groupKey, comms]) => (
          <Card key={groupKey} variant="glass" padding="none">
            <button
              onClick={() => toggleGroup(groupKey)}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                {expandedGroups.has(groupKey) ? (
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                )}
                <div className="text-left">
                  <p className="font-semibold text-gray-900">{groupKey}</p>
                  <p className="text-sm text-gray-500">{comms.length} communication(s)</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-500">
                  {comms.filter(c => c.type === 'phone').length} calls · {comms.filter(c => c.type === 'email').length} emails
                </span>
              </div>
            </button>

            <AnimatePresence>
              {expandedGroups.has(groupKey) && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="border-t border-gray-100 overflow-hidden"
                >
                  <div className="p-4 space-y-2">
                    {comms.map((comm) => (
                      <div
                        key={comm.id}
                        onClick={() => setSelectedComm(comm)}
                        className="flex items-start gap-3 p-3 bg-white border border-gray-100 rounded-lg hover:border-wine-200 hover:shadow-sm cursor-pointer transition-all"
                      >
                        <div className={`p-2 rounded-lg ${comm.type === 'phone' ? 'bg-wine-100' : 'bg-purple-100'}`}>
                          {comm.type === 'phone' ? (
                            <Phone className="w-4 h-4 text-wine-600" />
                          ) : (
                            <Mail className="w-4 h-4 text-purple-600" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{comm.wineName}</p>
                              <p className="text-xs text-gray-500">{comm.providerName}</p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {getOutcomeIcon(comm.outcome)}
                              <span className="text-xs text-gray-500">
                                {comm.timestamp.toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                          <p className="text-xs text-gray-600 mt-1 line-clamp-2">{comm.summary}</p>
                          {comm.duration && (
                            <span className="text-xs text-gray-500 mt-1 inline-block">
                              Duration: {formatDuration(comm.duration)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        ))}
      </div>

      {filteredCommunications.length === 0 && (
        <Card variant="glass" padding="lg" className="text-center">
          <MessageSquare className="w-12 h-12 mx-auto mb-4 text-gray-300" />
          <p className="text-lg font-medium text-gray-900">No communications found</p>
          <p className="text-sm text-gray-500 mt-2">
            Try adjusting your filters or search query
          </p>
        </Card>
      )}

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedComm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedComm(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
            >
              {/* Header */}
              <div className={`flex items-center justify-between px-6 py-4 border-b ${
                selectedComm.type === 'phone' ? 'bg-wine-50' : 'bg-purple-50'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-xl ${
                    selectedComm.type === 'phone' ? 'bg-wine-600' : 'bg-purple-600'
                  }`}>
                    {selectedComm.type === 'phone' ? (
                      <Phone className="w-5 h-5 text-white" />
                    ) : (
                      <Mail className="w-5 h-5 text-white" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Communication Details</h3>
                    <p className="text-sm text-gray-500">
                      {selectedComm.type === 'phone' ? 'Phone Call' : 'Email'} · {selectedComm.timestamp.toLocaleString()}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedComm(null)}
                  className="p-2 hover:bg-white/50 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-gray-500">Wine</label>
                    <p className="text-base font-semibold text-gray-900 mt-1">{selectedComm.wineName}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-500">Provider</label>
                    <p className="text-base font-semibold text-gray-900 mt-1">{selectedComm.providerName}</p>
                  </div>
                  {selectedComm.duration && (
                    <div>
                      <label className="text-sm font-medium text-gray-500">Duration</label>
                      <p className="text-base font-semibold text-gray-900 mt-1">{formatDuration(selectedComm.duration)}</p>
                    </div>
                  )}
                  <div>
                    <label className="text-sm font-medium text-gray-500">Outcome</label>
                    <div className="flex items-center gap-2 mt-1">
                      {getOutcomeIcon(selectedComm.outcome)}
                      <p className={`text-base font-semibold capitalize ${getOutcomeColor(selectedComm.outcome)}`}>
                        {selectedComm.outcome}
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-500">Summary</label>
                  <p className="text-base text-gray-900 mt-2 leading-relaxed">{selectedComm.summary}</p>
                </div>

                {selectedComm.notes && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Notes</label>
                    <p className="text-base text-gray-700 mt-2 bg-amber-50 p-3 rounded-lg">{selectedComm.notes}</p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                <Button variant="outline" onClick={() => setSelectedComm(null)}>
                  Close
                </Button>
                <Button className="bg-wine-600 hover:bg-wine-700">
                  <Download className="w-4 h-4 mr-2" />
                  Download PDF
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

