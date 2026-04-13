import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Calendar,
  Clock,
  Mail,
  MessageSquare,
  Bell,
  FileText,
  Download,
  Zap,
  Save,
  Play,
  Settings,
  Globe,
  ChevronDown,
  Check,
  Star,
  Package,
  DollarSign,
  TrendingUp,
  Truck,
} from 'lucide-react'
import { Card, Button } from '../ui'
import { ReportTypeModal } from './ReportTypeModal'
import { REPORT_TYPES, getDefaultTemplateForReport } from '../../data/reportDefaults'
import { useRealtimeDispatch, CalendarEventPayload } from '../../contexts/RealtimeContext'

interface ReportSchedulerProps {
  onSchedule?: (config: ReportConfig) => void
  onGenerateNow?: (reportType: string, format: string) => void
}

interface ReportConfig {
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM' | 'NONE'
  deliveryTime: string
  timezone: string
  format: 'pdf' | 'excel' | 'csv' | 'sheets' | 'drive'
  channels: {
    email: boolean
    sms: boolean
    push: boolean
  }
  weeklyDays: number[]  // Array of days (0-6, 0 = Monday)
  monthlyDay?: number  // 1-31 or -1 for last day
  quietHoursStart?: string
  quietHoursEnd?: string
  reportType: string
  templateId?: string
}

const TIMEZONES = [
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)', abbr: 'PT' },
  { value: 'America/Denver', label: 'Mountain Time (MT)', abbr: 'MT' },
  { value: 'America/Chicago', label: 'Central Time (CT)', abbr: 'CT' },
  { value: 'America/New_York', label: 'Eastern Time (ET)', abbr: 'ET' },
  { value: 'America/Phoenix', label: 'Arizona (MST)', abbr: 'MST' },
  { value: 'America/Anchorage', label: 'Alaska (AKT)', abbr: 'AKT' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HST)', abbr: 'HST' },
  { value: 'Europe/London', label: 'London (GMT)', abbr: 'GMT' },
  { value: 'Europe/Paris', label: 'Paris (CET)', abbr: 'CET' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)', abbr: 'JST' },
  { value: 'Australia/Sydney', label: 'Sydney (AEDT)', abbr: 'AEDT' },
]

const DAYS_OF_WEEK = [
  { value: 0, label: 'Monday', short: 'Mon' },
  { value: 1, label: 'Tuesday', short: 'Tue' },
  { value: 2, label: 'Wednesday', short: 'Wed' },
  { value: 3, label: 'Thursday', short: 'Thu' },
  { value: 4, label: 'Friday', short: 'Fri' },
  { value: 5, label: 'Saturday', short: 'Sat' },
  { value: 6, label: 'Sunday', short: 'Sun' },
]

const MONTHLY_OPTIONS = [
  { value: 1, label: '1st' },
  { value: 15, label: '15th' },
  { value: -1, label: 'Last day' },
  { value: 'custom', label: 'Custom day...' },
]

const EXPORT_FORMATS = [
  { value: 'pdf', label: 'PDF', icon: FileText },
  { value: 'excel', label: 'Excel', icon: FileText },
  { value: 'csv', label: 'CSV', icon: FileText },
  { value: 'sheets', label: 'Google Sheets', icon: FileText },
  { value: 'drive', label: 'Google Drive', icon: FileText },
]

const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const hours = Math.floor(i / 4)
  const minutes = (i % 4) * 15
  const time = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
  const label = new Date(`2000-01-01T${time}`).toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  })
  return { value: time, label }
})

const iconMap: Record<string, React.ElementType> = {
  FileText,
  Package,
  DollarSign,
  TrendingUp,
  Truck,
}

export function ReportScheduler({ onSchedule, onGenerateNow }: ReportSchedulerProps) {
  // Auto-detect timezone
  const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const matchedTimezone = TIMEZONES.find(tz => tz.value === detectedTimezone)?.value || 'America/New_York'
  
  // Get realtime dispatch for calendar sync
  const { dispatchCalendarEvent } = useRealtimeDispatch()

  const [config, setConfig] = useState<ReportConfig>({
    frequency: 'WEEKLY',
    deliveryTime: '09:00',
    timezone: matchedTimezone,
    format: 'pdf',
    channels: {
      email: true,
      sms: false,
      push: true,
    },
    weeklyDays: [0, 4], // Monday and Friday by default
    monthlyDay: 1,
    reportType: 'comprehensive',
  })

  const [isGenerating, setIsGenerating] = useState(false)
  const [showReportTypeModal, setShowReportTypeModal] = useState(false)
  const [customMonthlyDay, setCustomMonthlyDay] = useState<number>(1)
  const [showCustomDay, setShowCustomDay] = useState(false)

  // Check for default template when report type changes
  useEffect(() => {
    const defaultTemplate = getDefaultTemplateForReport(config.reportType)
    if (defaultTemplate?.templateId) {
      setConfig(prev => ({ ...prev, templateId: defaultTemplate.templateId }))
    }
  }, [config.reportType])

  const handleSave = () => {
    // Call the parent callback
    onSchedule?.(config)
    
    // Dispatch calendar event for cross-page sync
    if (config.frequency !== 'NONE') {
      const reportTypeInfo = REPORT_TYPES.find(rt => rt.id === config.reportType)
      const eventId = `report-schedule-${Date.now()}`
      const now = new Date()
      
      // Calculate next occurrence date based on frequency
      let nextDate = new Date()
      if (config.frequency === 'WEEKLY' && config.weeklyDays.length > 0) {
        // Find next occurrence of one of the selected days
        const today = now.getDay()
        const adjustedToday = today === 0 ? 6 : today - 1 // Convert to Monday = 0
        const nextDay = config.weeklyDays.find(d => d > adjustedToday) ?? config.weeklyDays[0]
        const daysUntil = nextDay > adjustedToday ? nextDay - adjustedToday : 7 - adjustedToday + nextDay
        nextDate.setDate(now.getDate() + daysUntil)
      } else if (config.frequency === 'MONTHLY') {
        const targetDay = config.monthlyDay === -1 
          ? new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() 
          : config.monthlyDay || 1
        nextDate = new Date(now.getFullYear(), now.getMonth(), targetDay)
        if (nextDate <= now) {
          nextDate = new Date(now.getFullYear(), now.getMonth() + 1, targetDay)
        }
      }
      
      dispatchCalendarEvent({
        type: 'created',
        eventId,
        title: `${reportTypeInfo?.name || 'Scheduled'} Report`,
        eventType: 'recurring',
        date: nextDate.toISOString().split('T')[0],
        startTime: config.deliveryTime,
        allDay: false,
        description: `Automated ${config.frequency.toLowerCase()} ${reportTypeInfo?.name || config.reportType} report. Format: ${config.format.toUpperCase()}. Channels: ${[
          config.channels.email && 'Email',
          config.channels.sms && 'SMS',
          config.channels.push && 'Push'
        ].filter(Boolean).join(', ')}`,
        recurring: {
          enabled: true,
          frequency: config.frequency === 'DAILY' ? 'daily' : config.frequency === 'MONTHLY' ? 'monthly' : 'weekly',
          interval: 1,
          daysOfWeek: config.frequency === 'WEEKLY' ? config.weeklyDays : undefined,
          endType: 'never'
        },
        color: '#6366F1', // Indigo for reports
        source: 'communications',
        timestamp: now.toISOString()
      })
    }
  }

  const handleGenerateNow = async () => {
    setIsGenerating(true)
    try {
      await onGenerateNow?.(config.reportType, config.format)
    } finally {
      setIsGenerating(false)
    }
  }

  const toggleWeeklyDay = (day: number) => {
    setConfig(prev => {
      const days = prev.weeklyDays.includes(day)
        ? prev.weeklyDays.filter(d => d !== day)
        : [...prev.weeklyDays, day].sort()
      return { ...prev, weeklyDays: days }
    })
  }

  const handleReportTypeSelect = (reportType: string, templateId?: string) => {
    setConfig(prev => ({
      ...prev,
      reportType,
      templateId
    }))
  }

  const selectedReportType = REPORT_TYPES.find(t => t.value === config.reportType)
  const ReportIcon = selectedReportType ? iconMap[selectedReportType.icon] || FileText : FileText

  const currentTimezoneInfo = TIMEZONES.find(tz => tz.value === config.timezone)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Report Scheduling</h3>
          <p className="text-sm text-slate-500 mt-1">
            Configure automatic report generation and delivery
          </p>
        </div>
        <Button onClick={handleGenerateNow} disabled={isGenerating}>
          <Play className="w-4 h-4 mr-2" />
          {isGenerating ? 'Generating...' : 'Generate Now'}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Configuration */}
        <Card className="p-6 space-y-6">
          <div>
            <h4 className="text-sm font-medium text-slate-900 mb-4 flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Schedule Configuration
            </h4>

            {/* Frequency */}
            <div className="space-y-2 mb-6">
              <label className="text-sm font-medium text-slate-700">Frequency</label>
              <select
                value={config.frequency}
                onChange={(e) => setConfig({ ...config, frequency: e.target.value as any })}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-wine-500 bg-white"
              >
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
                <option value="CUSTOM">Custom</option>
                <option value="NONE">None (Manual only)</option>
              </select>
            </div>

            {/* Weekly Day Selector - Multi-select */}
            {(config.frequency === 'WEEKLY' || config.frequency === 'CUSTOM') && (
              <div className="space-y-3 mb-6">
                <label className="text-sm font-medium text-slate-700">
                  {config.frequency === 'WEEKLY' ? 'Days of Week' : 'Select Days'}
                </label>
                <div className="flex flex-wrap gap-2">
                  {DAYS_OF_WEEK.map((day) => {
                    const isSelected = config.weeklyDays.includes(day.value)
                    return (
                      <button
                        key={day.value}
                        onClick={() => toggleWeeklyDay(day.value)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                          isSelected
                            ? 'bg-wine-600 text-white shadow-lg shadow-wine-600/30'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {day.short}
                      </button>
                    )
                  })}
                </div>
                {config.weeklyDays.length === 0 && (
                  <p className="text-xs text-amber-600">Select at least one day</p>
                )}
              </div>
            )}

            {/* Monthly Day Selector - Enhanced */}
            {config.frequency === 'MONTHLY' && (
              <div className="space-y-3 mb-6">
                <label className="text-sm font-medium text-slate-700">Day of Month</label>
                <div className="flex flex-wrap gap-2">
                  {MONTHLY_OPTIONS.map((option) => {
                    const isSelected = option.value === 'custom' 
                      ? showCustomDay 
                      : config.monthlyDay === option.value
                    return (
                      <button
                        key={String(option.value)}
                        onClick={() => {
                          if (option.value === 'custom') {
                            setShowCustomDay(true)
                          } else {
                            setShowCustomDay(false)
                            setConfig({ ...config, monthlyDay: option.value as number })
                          }
                        }}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                          isSelected
                            ? 'bg-wine-600 text-white shadow-lg shadow-wine-600/30'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {option.label}
                      </button>
                    )
                  })}
                </div>
                {showCustomDay && (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={customMonthlyDay}
                      onChange={(e) => {
                        const day = Math.min(31, Math.max(1, parseInt(e.target.value) || 1))
                        setCustomMonthlyDay(day)
                        setConfig({ ...config, monthlyDay: day })
                      }}
                      className="w-20 px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-wine-500"
                    />
                    <span className="text-sm text-slate-500">of each month</span>
                  </div>
                )}
              </div>
            )}

            {/* Delivery Time - Enhanced with 15-min intervals */}
            <div className="space-y-2 mb-6">
              <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Delivery Time
              </label>
              <div className="flex items-center gap-3">
                <select
                  value={config.deliveryTime}
                  onChange={(e) => setConfig({ ...config, deliveryTime: e.target.value })}
                  className="flex-1 px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-wine-500 bg-white"
                >
                  {TIME_OPTIONS.map((time) => (
                    <option key={time.value} value={time.value}>
                      {time.label}
                    </option>
                  ))}
                </select>
                <div className="px-3 py-2 bg-slate-100 rounded-lg text-sm font-medium text-slate-600">
                  {currentTimezoneInfo?.abbr || 'TZ'}
                </div>
              </div>
            </div>

            {/* Timezone - Auto-detected */}
            <div className="space-y-2 mb-6">
              <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                <Globe className="w-4 h-4" />
                Timezone
                {config.timezone === matchedTimezone && (
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded-full">
                    Auto-detected
                  </span>
                )}
              </label>
              <select
                value={config.timezone}
                onChange={(e) => setConfig({ ...config, timezone: e.target.value })}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-wine-500 bg-white"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Format */}
            <div className="space-y-2 mb-6">
              <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                <Download className="w-4 h-4" />
                Export Format
              </label>
              <div className="grid grid-cols-2 gap-2">
                {EXPORT_FORMATS.map((format) => (
                  <button
                    key={format.value}
                    onClick={() => setConfig({ ...config, format: format.value as any })}
                    className={`px-3 py-2.5 border rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                      config.format === format.value
                        ? 'bg-wine-50 border-wine-500 text-wine-700'
                        : 'bg-white border-slate-200 text-slate-700 hover:border-wine-300'
                    }`}
                  >
                    {config.format === format.value && <Check className="w-4 h-4" />}
                    {format.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Delivery Channels */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                <Bell className="w-4 h-4" />
                Delivery Channels
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors">
                  <input
                    type="checkbox"
                    checked={config.channels.email}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        channels: { ...config.channels, email: e.target.checked },
                      })
                    }
                    className="w-5 h-5 text-wine-600 border-slate-300 rounded focus:ring-wine-500"
                  />
                  <Mail className="w-5 h-5 text-blue-500" />
                  <span className="text-sm font-medium text-slate-700">Email</span>
                </label>

                <label className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors">
                  <input
                    type="checkbox"
                    checked={config.channels.push}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        channels: { ...config.channels, push: e.target.checked },
                      })
                    }
                    className="w-5 h-5 text-wine-600 border-slate-300 rounded focus:ring-wine-500"
                  />
                  <Bell className="w-5 h-5 text-purple-500" />
                  <span className="text-sm font-medium text-slate-700">Push Notification</span>
                </label>

                <label className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors">
                  <input
                    type="checkbox"
                    checked={config.channels.sms}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        channels: { ...config.channels, sms: e.target.checked },
                      })
                    }
                    className="w-5 h-5 text-wine-600 border-slate-300 rounded focus:ring-wine-500"
                  />
                  <MessageSquare className="w-5 h-5 text-emerald-500" />
                  <span className="text-sm font-medium text-slate-700">SMS</span>
                </label>
              </div>
            </div>
          </div>

          <Button onClick={handleSave} className="w-full">
            <Save className="w-4 h-4 mr-2" />
            Save Preferences
          </Button>
        </Card>

        {/* Right Column: Preview & Report Types */}
        <div className="space-y-6">
          {/* Report Type Selection - Enhanced with Modal */}
          <Card className="p-6">
            <h4 className="text-sm font-medium text-slate-900 mb-4 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Report Type
            </h4>
            
            {/* Selected Report Type Display */}
            <button
              onClick={() => setShowReportTypeModal(true)}
              className="w-full text-left p-4 border-2 border-slate-200 rounded-xl hover:border-wine-300 hover:bg-wine-50/50 transition-all group"
            >
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-xl ${selectedReportType?.bgColor || 'bg-slate-100'}`}>
                  <ReportIcon className={`w-6 h-6 ${selectedReportType?.color || 'text-slate-600'}`} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">
                      {selectedReportType?.label || 'Select Report Type'}
                    </span>
                    {config.templateId && (
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-full flex items-center gap-1">
                        <Star className="w-3 h-3 fill-amber-500" />
                        Template
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500 mt-1">
                    {selectedReportType?.description || 'Click to select a report type'}
                  </p>
                </div>
                <ChevronDown className="w-5 h-5 text-slate-400 group-hover:text-wine-600 transition-colors" />
              </div>
            </button>

            {/* Quick Report Type Buttons */}
            <div className="mt-4 grid grid-cols-2 gap-2">
              {REPORT_TYPES.slice(0, 4).map((type) => {
                const Icon = iconMap[type.icon] || FileText
                const isSelected = config.reportType === type.value
                return (
                  <button
                    key={type.value}
                    onClick={() => setConfig({ ...config, reportType: type.value })}
                    className={`p-3 rounded-xl border transition-all text-left ${
                      isSelected
                        ? 'border-wine-500 bg-wine-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={`w-4 h-4 ${isSelected ? 'text-wine-600' : 'text-slate-500'}`} />
                      <span className={`text-sm font-medium ${isSelected ? 'text-wine-700' : 'text-slate-700'}`}>
                        {type.label}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </Card>

          {/* Schedule Preview */}
          <Card className="p-6">
            <h4 className="text-sm font-medium text-slate-900 mb-4 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Schedule Preview
            </h4>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-slate-600">Frequency</span>
                <span className="font-medium text-slate-900">
                  {config.frequency === 'WEEKLY' && config.weeklyDays.length > 0
                    ? `${config.weeklyDays.map(d => DAYS_OF_WEEK[d].short).join(', ')}`
                    : config.frequency}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-slate-600">Delivery Time</span>
                <span className="font-medium text-slate-900">
                  {TIME_OPTIONS.find(t => t.value === config.deliveryTime)?.label || config.deliveryTime}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-slate-600">Timezone</span>
                <span className="font-medium text-slate-900 text-xs">
                  {currentTimezoneInfo?.label}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-slate-600">Format</span>
                <span className="font-medium text-slate-900 uppercase">{config.format}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-slate-600">Report Type</span>
                <span className="font-medium text-slate-900">{selectedReportType?.label}</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-slate-600">Channels</span>
                <span className="font-medium text-slate-900 text-xs">
                  {Object.entries(config.channels)
                    .filter(([_, enabled]) => enabled)
                    .map(([channel]) => channel.toUpperCase())
                    .join(', ') || 'None'}
                </span>
              </div>
            </div>

            {config.frequency !== 'NONE' && (
              <div className="mt-4 p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                <p className="text-xs text-emerald-700 flex items-start gap-2">
                  <Zap className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>Next report:</strong>{' '}
                    {config.frequency === 'DAILY' && 'Tomorrow'}
                    {config.frequency === 'WEEKLY' && config.weeklyDays.length > 0 &&
                      `Next ${DAYS_OF_WEEK[config.weeklyDays[0]].label}`}
                    {config.frequency === 'MONTHLY' && 
                      `${config.monthlyDay === -1 ? 'Last day' : `${config.monthlyDay}${getOrdinalSuffix(config.monthlyDay || 1)}`} of next month`}
                    {config.frequency === 'CUSTOM' && config.weeklyDays.length > 0 &&
                      `Next ${DAYS_OF_WEEK[config.weeklyDays[0]].label}`}{' '}
                    at {TIME_OPTIONS.find(t => t.value === config.deliveryTime)?.label}
                  </span>
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Report Type Modal */}
      <ReportTypeModal
        isOpen={showReportTypeModal}
        onClose={() => setShowReportTypeModal(false)}
        onSelectReportType={handleReportTypeSelect}
        savedTemplates={[]} // TODO: Pass actual saved templates
      />
    </div>
  )
}

function getOrdinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th'
  switch (day % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}
