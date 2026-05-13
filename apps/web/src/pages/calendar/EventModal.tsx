import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Calendar,
  FileText,
  Repeat,
  Palette,
  User,
  Bell,
  Trash2,
  Tag,
  Sparkles,
  Plus,
  Edit2,
  Check,
} from 'lucide-react'
import type { CalendarEvent } from './useCalendarPage'
import type { EventTypeRecord as EventType } from '../../services/api/calendar'
import type { Provider } from '../../services/api/types'
import type { RecurrenceRule } from '../../lib/calendar/recurrence'
import { addCustomEventType, getCustomEventTypes, isEventTypeNameAvailable } from '../../data/customEventTypes'

// ─────────────────────────────── Types ───────────────────────────────────────

export interface EventLabel {
  id: string
  type: 'provider_meeting' | 'call' | 'tasting' | 'delivery' | 'email_thread' | 'custom'
  displayName: string
  entityName?: string
  color: string
}

export interface ReminderEntry {
  id: string
  minutesBefore: number
  channels: Array<'in_app' | 'email'>
}

export interface MonthlyConfig {
  mode: 'day_of_month' | 'nth_weekday'
  dayOfMonth: number
  nthPosition: 1 | 2 | 3 | 4 | -1
  weekday: number
}

export interface CreateCalendarEventData {
  title: string
  description?: string
  eventDate: string
  eventDateEnd?: string
  eventTime?: string
  eventTimeEnd?: string
  allDay: boolean
  multiDay?: boolean
  eventType: string
  color?: string
  status?: 'pending' | 'approved' | 'completed' | 'cancelled'
  recurrence?: RecurrenceRule
  monthlyConfig?: MonthlyConfig
  providerId?: string
  labels?: EventLabel[]
  reminders?: ReminderEntry[]
  reminder?: number
}

interface EventModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (event: CreateCalendarEventData) => void
  onDelete?: (eventId: string) => void
  initialDate?: Date
  initialEndDate?: Date
  existingEvent?: CalendarEvent
  eventTypes: EventType[]
  providers?: Provider[]
}

// ─────────────────────────────── Constants ────────────────────────────────────

const COLOR_PALETTE = [
  '#901d42', // wine-800
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // amber
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#6366F1', // indigo
  '#6B7280', // gray
  '#EF4444', // red
]

const DOW_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const REMINDER_PRESETS = [
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '1 hr', value: 60 },
  { label: '2 hr', value: 120 },
  { label: '1 day', value: 1440 },
  { label: '2 days', value: 2880 },
  { label: '1 week', value: 10080 },
]

const FREQ_OPTIONS = [
  { label: 'None', value: 'none' },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'Yearly', value: 'yearly' },
]

const NTH_LABELS: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', [-1]: 'Last' }
const WEEKDAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const STATUS_CONFIG = {
  pending:   { label: 'Pending',   dotColor: '#F59E0B', bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200' },
  approved:  { label: 'Approved',  dotColor: '#3B82F6', bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200' },
  completed: { label: 'Completed', dotColor: '#10B981', bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200' },
  cancelled: { label: 'Cancelled', dotColor: '#EF4444', bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200' },
} as const

const LABEL_COLORS: Record<EventLabel['type'], { bg: string; strip: string }> = {
  provider_meeting: { bg: '#fdf4f5', strip: '#901d42' },
  call:             { bg: '#f0fdf4', strip: '#10B981' },
  tasting:          { bg: '#f5f3ff', strip: '#8B5CF6' },
  delivery:         { bg: '#fefce8', strip: '#F59E0B' },
  email_thread:     { bg: '#eff6ff', strip: '#3B82F6' },
  custom:           { bg: '#f3f4f6', strip: '#6B7280' },
}

const LABEL_DISPLAY: Record<EventLabel['type'], string> = {
  provider_meeting: 'Provider Meeting',
  call:             'Call Log',
  tasting:          'Tasting Session',
  delivery:         'Delivery',
  email_thread:     'Email Thread',
  custom:           'Label',
}

// ─────────────────────────────── Helpers ─────────────────────────────────────

function formatDateForInput(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatTimeForDisplay(time: string): string {
  const [hrs = '0', mins = '00'] = time.split(':')
  const h = parseInt(hrs, 10)
  return `${h % 12 || 12}:${mins.padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

function getDefaultEndTime(startTime: string): string {
  const [h = '9', m = '0'] = startTime.split(':')
  const end = parseInt(h, 10) * 60 + parseInt(m, 10) + 60
  return `${String(Math.floor(end / 60) % 24).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`
}

function buildRruleText(freq: string, daysOfWeek: number[], monthCfg: MonthlyConfig, endType: string, endOnDate: string, endAfterCount: number): string {
  if (freq === 'none') return ''
  let parts: string[] = []
  if (freq === 'daily') parts.push('FREQ=DAILY')
  else if (freq === 'weekly') {
    parts.push('FREQ=WEEKLY')
    if (daysOfWeek.length > 0) {
      const codes = ['SU','MO','TU','WE','TH','FR','SA']
      parts.push(`BYDAY=${daysOfWeek.map(d => codes[d]).join(',')}`)
    }
  } else if (freq === 'monthly') {
    parts.push('FREQ=MONTHLY')
    if (monthCfg.mode === 'day_of_month') {
      parts.push(`BYMONTHDAY=${monthCfg.dayOfMonth}`)
    } else {
      const codes = ['SU','MO','TU','WE','TH','FR','SA']
      const pos = monthCfg.nthPosition === -1 ? '-1' : String(monthCfg.nthPosition)
      parts.push(`BYDAY=${pos}${codes[monthCfg.weekday]}`)
    }
  } else if (freq === 'yearly') {
    parts.push('FREQ=YEARLY')
  }
  if (endType === 'on_date' && endOnDate) parts.push(`UNTIL=${endOnDate.replace(/-/g, '')}`)
  else if (endType === 'after_count' && endAfterCount > 0) parts.push(`COUNT=${endAfterCount}`)
  return parts.join(';')
}

function detectLabels(title: string, providers: Provider[]): { type: EventLabel['type']; entityName?: string } | null {
  if (!title.trim()) return null
  const lower = title.toLowerCase()

  const matchedProvider = providers.find(p =>
    lower.includes(p.name.toLowerCase()) || lower.includes((p.companyName || '').toLowerCase())
  )
  if (matchedProvider) return { type: 'provider_meeting', entityName: matchedProvider.name }

  if (/\b(call|phone|ring)\b/.test(lower)) return { type: 'call' }
  if (/\b(tasting|degustation|wine\s+tasting)\b/.test(lower)) return { type: 'tasting' }
  if (/\b(delivery|deliver|shipment|receiving)\b/.test(lower)) return { type: 'delivery' }
  if (/\b(meeting|meet|mtg|discussion)\b/.test(lower)) return { type: 'provider_meeting' }

  return null
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

const TIME_OPTIONS = (() => {
  const times: string[] = []
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      times.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
  }
  return times
})()

// ─────────────────────────────── Component ───────────────────────────────────

export function EventModal({
  isOpen,
  onClose,
  onSave,
  onDelete,
  initialDate,
  initialEndDate,
  existingEvent,
  eventTypes,
  providers = [],
}: EventModalProps) {
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [isViewMode, setIsViewMode] = useState(false)

  // Core fields
  const [title, setTitle]               = useState('')
  const [description, setDescription]   = useState('')
  const [eventDate, setEventDate]       = useState('')
  const [eventDateEnd, setEventDateEnd] = useState('')
  const [eventTime, setEventTime]       = useState('09:00')
  const [eventTimeEnd, setEventTimeEnd] = useState('10:00')
  const [allDay, setAllDay]             = useState(false)
  const [multiDay, setMultiDay]         = useState(false)
  const [selectedEventType, setSelectedEventType] = useState('')
  const [selectedColor, setSelectedColor]         = useState(COLOR_PALETTE[0])
  const [status, setStatus]             = useState<'pending' | 'approved' | 'completed' | 'cancelled'>('pending')
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [providerSearch, setProviderSearch]         = useState('')

  // Recurrence
  const [freq, setFreq]               = useState('none')
  const [daysOfWeek, setDaysOfWeek]   = useState<number[]>([])
  const [endType, setEndType]         = useState<'never' | 'on_date' | 'after_count'>('never')
  const [endOnDate, setEndOnDate]     = useState('')
  const [endAfterCount, setEndAfterCount] = useState(10)
  const [monthCfg, setMonthCfg]       = useState<MonthlyConfig>({
    mode: 'day_of_month', dayOfMonth: 1, nthPosition: 1, weekday: 1,
  })

  // Labels
  const [labels, setLabels]           = useState<EventLabel[]>([])
  const [detectedLabel, setDetectedLabel] = useState<{ type: EventLabel['type']; entityName?: string } | null>(null)
  const [labelDismissed, setLabelDismissed] = useState(false)

  // Reminders
  const [reminders, setReminders]     = useState<ReminderEntry[]>([
    { id: uid(), minutesBefore: 60, channels: ['in_app', 'email'] },
  ])

  // Custom event type inline form
  const [showNewTypeForm, setShowNewTypeForm] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeColor, setNewTypeColor] = useState(COLOR_PALETTE[1])
  const [newTypeError, setNewTypeError] = useState('')
  const [localCustomTypes, setLocalCustomTypes] = useState<Array<{ id: string; name: string; color: string }>>(() =>
    getCustomEventTypes().map(t => ({ id: `custom-${t.name}`, name: t.name, color: t.color }))
  )

  // Detect label from title
  useEffect(() => {
    if (!title.trim()) { setDetectedLabel(null); setLabelDismissed(false); return }
    const d = detectLabels(title, providers)
    if (d && !labelDismissed && !labels.some(l => l.type === d.type)) {
      setDetectedLabel(d)
    } else {
      setDetectedLabel(null)
    }
  }, [title, providers, labelDismissed, labels])

  // Sync end time when start time changes (create mode)
  useEffect(() => {
    if (!allDay && eventTime && !existingEvent) {
      setEventTimeEnd(getDefaultEndTime(eventTime))
    }
  }, [eventTime, allDay, existingEvent])

  // Sync color when event type changes
  useEffect(() => {
    if (selectedEventType) {
      const et = eventTypes.find(t => t.id === selectedEventType)
      if (et?.color) setSelectedColor(et.color)
    }
  }, [selectedEventType, eventTypes])

  // Initialize form
  useEffect(() => {
    if (!isOpen) return
    setLabelDismissed(false)
    setLabels([])
    setDetectedLabel(null)

    if (existingEvent) {
      setIsViewMode(true)
      const et = eventTypes.find(t => t.name.toLowerCase() === existingEvent.type.toLowerCase()) || eventTypes[0]
      setTitle(existingEvent.title)
      setDescription(existingEvent.description || '')
      setEventDate(formatDateForInput(existingEvent.date))
      setEventDateEnd('')
      setEventTime(existingEvent.startTime || '09:00')
      setEventTimeEnd(existingEvent.endTime || getDefaultEndTime(existingEvent.startTime || '09:00'))
      setAllDay(existingEvent.allDay || false)
      setMultiDay(false)
      setSelectedEventType(et?.id || '')
      setSelectedColor(existingEvent.color || et?.color || COLOR_PALETTE[0])
      setStatus((existingEvent.status as 'pending' | 'approved' | 'completed' | 'cancelled') || 'pending')
      setSelectedProviderId(existingEvent.providerId || '')
      setProviderSearch('')
      setFreq('none')
      setDaysOfWeek([])
      setEndType('never')
      setEndOnDate('')
      setEndAfterCount(10)
    } else {
      setIsViewMode(false)
      const start = initialDate || new Date()
      const end   = initialEndDate || new Date(start.getTime() + 3600000)
      setTitle('')
      setDescription('')
      setEventDate(formatDateForInput(start))
      setEventDateEnd(formatDateForInput(end))
      setEventTime(start.toTimeString().slice(0, 5))
      setEventTimeEnd(end.toTimeString().slice(0, 5))
      setAllDay(false)
      setMultiDay(false)
      setSelectedEventType(eventTypes[0]?.id || '')
      setSelectedColor(eventTypes[0]?.color || COLOR_PALETTE[0])
      setStatus('pending')
      setSelectedProviderId('')
      setProviderSearch('')
      setFreq('none')
      setDaysOfWeek([])
      setEndType('never')
      setEndOnDate('')
      setEndAfterCount(10)
      setReminders([{ id: uid(), minutesBefore: 60, channels: ['in_app', 'email'] }])
      setTimeout(() => titleInputRef.current?.focus(), 100)
    }
  }, [isOpen, existingEvent, initialDate, initialEndDate, eventTypes])

  // ── Actions ──────────────────────────────────────────────────────────────

  function acceptLabel() {
    if (!detectedLabel) return
    const newLabel: EventLabel = {
      id: uid(),
      type: detectedLabel.type,
      displayName: LABEL_DISPLAY[detectedLabel.type],
      entityName: detectedLabel.entityName,
      color: LABEL_COLORS[detectedLabel.type].strip,
    }
    setLabels(prev => [...prev, newLabel])
    setDetectedLabel(null)
    setLabelDismissed(true)
  }

  function removeLabel(id: string) {
    setLabels(prev => prev.filter(l => l.id !== id))
  }

  function toggleDow(d: number) {
    setDaysOfWeek(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])
  }

  function addReminder() {
    if (reminders.length >= 3) return
    setReminders(prev => [...prev, { id: uid(), minutesBefore: 1440, channels: ['in_app'] }])
  }

  function removeReminder(id: string) {
    setReminders(prev => prev.filter(r => r.id !== id))
  }

  function setReminderPreset(id: string, value: number) {
    setReminders(prev => prev.map(r => r.id === id ? { ...r, minutesBefore: value } : r))
  }

  function saveCustomType() {
    const name = newTypeName.trim()
    if (!name) { setNewTypeError('Name is required'); return }
    if (name.length < 2) { setNewTypeError('At least 2 characters'); return }
    if (name.length > 30) { setNewTypeError('Max 30 characters'); return }
    if (!isEventTypeNameAvailable(name)) { setNewTypeError('Name already taken'); return }
    try {
      addCustomEventType({ name, color: newTypeColor, icon: 'Star', createdBy: 'user' })
      const newEntry = { id: `custom-${name}`, name, color: newTypeColor }
      setLocalCustomTypes(prev => [...prev, newEntry])
      setSelectedEventType(newEntry.id)
      setSelectedColor(newTypeColor)
      setNewTypeName('')
      setNewTypeColor(COLOR_PALETTE[1])
      setNewTypeError('')
      setShowNewTypeForm(false)
    } catch {
      setNewTypeError('Could not save — try a different name')
    }
  }

  function toggleReminderChannel(id: string, ch: 'in_app' | 'email') {
    setReminders(prev => prev.map(r => {
      if (r.id !== id) return r
      const channels = r.channels.includes(ch)
        ? r.channels.filter(c => c !== ch)
        : [...r.channels, ch]
      return { ...r, channels: channels.length === 0 ? [ch] : channels }
    }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return

    const selectedType = eventTypes.find(et => et.id === selectedEventType)
      ?? localCustomTypes.find(ct => ct.id === selectedEventType)
    const eventTypeString = selectedType?.name.toLowerCase() || selectedEventType

    const data: CreateCalendarEventData = {
      title: title.trim(),
      description: description.trim() || undefined,
      eventDate,
      eventDateEnd: multiDay && eventDateEnd && eventDateEnd !== eventDate ? eventDateEnd : undefined,
      eventTime: allDay ? undefined : eventTime,
      eventTimeEnd: allDay ? undefined : eventTimeEnd,
      allDay,
      multiDay,
      eventType: eventTypeString,
      color: selectedColor,
      status,
      providerId: selectedProviderId || undefined,
      labels: labels.length > 0 ? labels : undefined,
      reminders: reminders.filter(r => r.minutesBefore > 0),
      reminder: reminders[0]?.minutesBefore || undefined,
    }

    if (freq !== 'none') {
      data.recurrence = {
        frequency: freq as RecurrenceRule['frequency'],
        interval: 1,
        daysOfWeek: freq === 'weekly' ? daysOfWeek : undefined,
        dayOfMonth: freq === 'monthly' && monthCfg.mode === 'day_of_month' ? monthCfg.dayOfMonth : undefined,
        endType,
        endOnDate: endType === 'on_date' ? endOnDate : undefined,
        endAfterCount: endType === 'after_count' ? endAfterCount : undefined,
      }
      if (freq === 'monthly') data.monthlyConfig = monthCfg
    }

    onSave(data)
    onClose()
  }

  function handleDelete() {
    if (existingEvent && onDelete) {
      if (window.confirm('Delete this event?')) {
        onDelete(existingEvent.id)
        onClose()
      }
    }
  }

  const filteredProviders = providers.filter(p =>
    p.name.toLowerCase().includes(providerSearch.toLowerCase())
  )

  const selectedProvider = providers.find(p => p.id === selectedProviderId)
  const rruleText = buildRruleText(freq, daysOfWeek, monthCfg, endType, endOnDate, endAfterCount)

  if (!isOpen) return null

  // ── View Mode ─────────────────────────────────────────────────────────────

  const renderViewMode = () => {
    const st = status && STATUS_CONFIG[status]
    const et = eventTypes.find(t => t.id === selectedEventType)
    return (
      <>
        {/* View Header */}
        <div className="px-5 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-start gap-3">
            <div
              className="w-3 h-3 rounded-full mt-1.5 shrink-0"
              style={{ backgroundColor: selectedColor }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                {existingEvent?.type || 'Event'}
              </p>
              <h3 className="text-xl font-bold text-gray-900 leading-tight">{title}</h3>
              {/* Status + type badges */}
              <div className="flex gap-2 flex-wrap mt-3">
                {st && (
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold border ${st.bg} ${st.text} ${st.border}`}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: st.dotColor }} />
                    {st.label}
                  </span>
                )}
                {et && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold bg-wine-50 text-wine-800 border border-wine-100">
                    {et.name}
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsViewMode(false)}
                className="w-8 h-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              {existingEvent && onDelete && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="w-8 h-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Applied labels */}
          {labels.length > 0 && (
            <div className="flex gap-2 flex-wrap mt-3">
              {labels.map(l => {
                const lc = LABEL_COLORS[l.type]
                return (
                  <div key={l.id} className="flex items-center rounded-lg border border-gray-200 overflow-hidden bg-white">
                    <div className="w-1 self-stretch shrink-0" style={{ backgroundColor: lc.strip }} />
                    <div className="flex items-center gap-1.5 pl-2 pr-1 h-7">
                      <Tag className="w-3 h-3 text-gray-400" />
                      <span className="text-[12px] font-semibold text-gray-600">
                        {l.entityName ? `${l.displayName} · ${l.entityName}` : l.displayName}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* View body */}
        <div className="overflow-y-auto">
          {/* Date & Time */}
          <div className="px-5 py-4 border-b border-gray-100">
            <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <Calendar className="w-3 h-3" /> Date & Time
            </p>
            <div className="flex items-start gap-2.5 text-sm text-gray-700">
              <Calendar className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
              <span className="font-medium">
                {eventDate}
                {!allDay && eventTime && ` · ${formatTimeForDisplay(eventTime)} → ${formatTimeForDisplay(eventTimeEnd)}`}
                {allDay && ' · All day'}
              </span>
            </div>
          </div>

          {/* Provider */}
          {selectedProvider && (
            <div className="px-5 py-4 border-b border-gray-100">
              <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <User className="w-3 h-3" /> Provider
              </p>
              <ProviderCard provider={selectedProvider} />
            </div>
          )}

          {/* Notes */}
          {description && (
            <div className="px-5 py-4 border-b border-gray-100">
              <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <FileText className="w-3 h-3" /> Notes
              </p>
              <p className="text-sm text-gray-600 leading-relaxed">{description}</p>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-gray-600 bg-gray-100 border border-gray-200 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Close
          </button>
        </div>
      </>
    )
  }

  // ── Edit / Create Form ────────────────────────────────────────────────────

  const renderForm = () => (
    <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3 shrink-0">
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: selectedColor }}
        />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
            {existingEvent ? 'Edit Event' : 'New Event'}
          </p>
          <input
            ref={titleInputRef}
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Event title"
            required
            className="w-full text-base font-bold text-gray-900 bg-transparent border-none outline-none placeholder-gray-300 mt-0.5"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">

        {/* ── Type · Status · Color ─────────────────────────────────────── */}
        <div className="px-5 py-4 border-b border-gray-100">
          <SectionLabel icon={<Palette className="w-3 h-3" />} text="Appearance" />

          {/* Type pills — built-in + user-created */}
          <div className="flex gap-1.5 flex-wrap mt-2">
            {/* Built-in types from API */}
            {eventTypes.map(et => (
              <button
                key={et.id}
                type="button"
                onClick={() => { setSelectedEventType(et.id); setShowNewTypeForm(false) }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium border transition-all ${
                  selectedEventType === et.id
                    ? 'border-wine-700 bg-wine-50 text-wine-800'
                    : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: et.color }} />
                {et.name}
              </button>
            ))}

            {/* User-created custom types */}
            {localCustomTypes.map(ct => (
              <button
                key={ct.id}
                type="button"
                onClick={() => { setSelectedEventType(ct.id); setSelectedColor(ct.color); setShowNewTypeForm(false) }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium border transition-all ${
                  selectedEventType === ct.id
                    ? 'border-wine-700 bg-wine-50 text-wine-800'
                    : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: ct.color }} />
                {ct.name}
              </button>
            ))}

            {/* Add new type button */}
            <button
              type="button"
              onClick={() => { setShowNewTypeForm(v => !v); setNewTypeName(''); setNewTypeError('') }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-medium border transition-all ${
                showNewTypeForm
                  ? 'border-wine-300 bg-wine-50 text-wine-700'
                  : 'border-dashed border-gray-300 bg-white text-gray-400 hover:border-gray-400 hover:text-gray-600'
              }`}
            >
              <Plus className="w-3 h-3" />
              New type
            </button>
          </div>

          {/* Inline custom type form */}
          {showNewTypeForm && (
            <div className="mt-3 p-3 rounded-xl border border-wine-100 bg-wine-50/40">
              <p className="text-[10px] font-bold text-wine-700 uppercase tracking-widest mb-2.5">Create custom type</p>

              {/* Name input */}
              <input
                type="text"
                value={newTypeName}
                onChange={e => { setNewTypeName(e.target.value); setNewTypeError('') }}
                placeholder="e.g. Team Briefing, PR Event…"
                maxLength={30}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-[13px] font-medium text-gray-800 focus:outline-none focus:border-wine-500 focus:ring-1 focus:ring-wine-500/20 bg-white"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveCustomType() } if (e.key === 'Escape') setShowNewTypeForm(false) }}
              />
              {newTypeError && <p className="text-[11px] text-red-500 mt-1">{newTypeError}</p>}

              {/* Color row */}
              <div className="flex gap-1.5 flex-wrap mt-2.5">
                {COLOR_PALETTE.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewTypeColor(c)}
                    className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 shrink-0 ${
                      newTypeColor === c ? 'border-gray-800' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c, boxShadow: newTypeColor === c ? 'inset 0 0 0 1.5px #fff' : undefined }}
                  />
                ))}
              </div>

              {/* Preview + actions */}
              <div className="flex items-center gap-2 mt-3">
                <div className="flex items-center gap-1.5 flex-1 px-2.5 py-1.5 rounded-lg bg-white border border-gray-200">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: newTypeColor }} />
                  <span className="text-[12px] font-semibold text-gray-700 truncate">
                    {newTypeName || 'Preview'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowNewTypeForm(false)}
                  className="px-3 py-1.5 text-[12px] font-semibold text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveCustomType}
                  disabled={!newTypeName.trim()}
                  className="px-3 py-1.5 text-[12px] font-semibold text-white rounded-lg transition-colors disabled:opacity-40 flex items-center gap-1"
                  style={{ backgroundColor: '#901d42' }}
                >
                  <Check className="w-3 h-3" /> Save
                </button>
              </div>
            </div>
          )}

          {/* Status chips */}
          <div className="flex gap-1.5 flex-wrap mt-3">
            {(Object.entries(STATUS_CONFIG) as [keyof typeof STATUS_CONFIG, (typeof STATUS_CONFIG)[keyof typeof STATUS_CONFIG]][]).map(([key, cfg]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatus(key)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-semibold border transition-all ${
                  status === key
                    ? `${cfg.bg} ${cfg.text} ${cfg.border}`
                    : 'bg-gray-50 text-gray-400 border-gray-200 hover:border-gray-300'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: status === key ? cfg.dotColor : '#d1d5db' }} />
                {cfg.label}
              </button>
            ))}
          </div>

          {/* Color swatches */}
          <div className="flex gap-1.5 flex-wrap mt-3">
            {COLOR_PALETTE.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setSelectedColor(c)}
                className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                  selectedColor === c ? 'border-gray-800' : 'border-transparent'
                }`}
                style={{ backgroundColor: c, boxShadow: selectedColor === c ? 'inset 0 0 0 1.5px #fff' : undefined }}
              />
            ))}
          </div>
        </div>

        {/* ── Label detection card ────────────────────────────────────────── */}
        {detectedLabel && !labelDismissed && (
          <div className="px-5 py-0">
            <div className="flex items-stretch gap-2.5 rounded-xl border border-wine-100 bg-wine-50 p-3 mt-0">
              <div className="w-0.5 rounded-full self-stretch shrink-0" style={{ backgroundColor: LABEL_COLORS[detectedLabel.type].strip }} />
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: LABEL_COLORS[detectedLabel.type].bg }}>
                <Sparkles className="w-4 h-4 text-wine-700" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1">
                  Auto-detected
                </p>
                <p className="text-[13px] font-semibold text-gray-900 mt-0.5">
                  {LABEL_DISPLAY[detectedLabel.type]}
                  {detectedLabel.entityName && ` · ${detectedLabel.entityName}`}
                </p>
                <div className="flex gap-1.5 mt-2">
                  <button type="button" onClick={acceptLabel} className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-wine-800 text-white hover:bg-wine-900 transition-colors">
                    Add label
                  </button>
                  <button type="button" onClick={() => { setDetectedLabel(null); setLabelDismissed(true) }} className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors">
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Applied labels */}
        {labels.length > 0 && (
          <div className="px-5 py-2.5 border-b border-gray-100">
            <div className="flex gap-2 flex-wrap">
              {labels.map(l => {
                const lc = LABEL_COLORS[l.type]
                return (
                  <div key={l.id} className="flex items-center rounded-lg border border-gray-200 overflow-hidden bg-white">
                    <div className="w-1 self-stretch shrink-0" style={{ backgroundColor: lc.strip }} />
                    <div className="flex items-center gap-1.5 px-2 h-7">
                      <span className="text-[12px] font-semibold text-gray-600">
                        {l.entityName ? `${l.displayName} · ${l.entityName}` : l.displayName}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLabel(l.id)}
                      className="w-7 h-7 flex items-center justify-center text-gray-400 border-l border-gray-100 hover:bg-red-50 hover:text-red-500 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )
              })}
              <button
                type="button"
                onClick={() => {
                  const newLabel: EventLabel = { id: uid(), type: 'custom', displayName: 'Label', color: '#6B7280' }
                  setLabels(prev => [...prev, newLabel])
                }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-dashed border-gray-200 text-[12px] font-medium text-gray-400 hover:border-gray-300 hover:text-gray-500 transition-colors"
              >
                <Plus className="w-3 h-3" /> Add label
              </button>
            </div>
          </div>
        )}

        {/* ── Date & Time ────────────────────────────────────────────────── */}
        <div className="px-5 py-4 border-b border-gray-100">
          <SectionLabel icon={<Calendar className="w-3 h-3" />} text="Date & Time" />

          {/* Toggles */}
          <div className="flex gap-4 mt-2 mb-3">
            <ToggleSwitch label="All day" checked={allDay} onChange={setAllDay} />
            <ToggleSwitch label="Multi-day" checked={multiDay} onChange={v => { setMultiDay(v); if (!v) setEventDateEnd('') }} />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Start date">
              <input
                type="date"
                value={eventDate}
                onChange={e => setEventDate(e.target.value)}
                required
                className="finp w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-800 focus:outline-none focus:border-wine-600 focus:ring-1 focus:ring-wine-600/20"
              />
            </Field>
            {multiDay ? (
              <Field label="End date">
                <input
                  type="date"
                  value={eventDateEnd}
                  onChange={e => setEventDateEnd(e.target.value)}
                  min={eventDate}
                  className="finp w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-800 focus:outline-none focus:border-wine-600 focus:ring-1 focus:ring-wine-600/20"
                />
              </Field>
            ) : <div />}
          </div>

          {!allDay && (
            <div className="grid grid-cols-2 gap-2.5 mt-2.5">
              <Field label="Start time">
                <select
                  value={eventTime}
                  onChange={e => setEventTime(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-800 focus:outline-none focus:border-wine-600 focus:ring-1 focus:ring-wine-600/20 bg-white"
                >
                  {TIME_OPTIONS.map(t => <option key={t} value={t}>{formatTimeForDisplay(t)}</option>)}
                </select>
              </Field>
              <Field label="End time">
                <select
                  value={eventTimeEnd}
                  onChange={e => setEventTimeEnd(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-800 focus:outline-none focus:border-wine-600 focus:ring-1 focus:ring-wine-600/20 bg-white"
                >
                  {TIME_OPTIONS.map(t => <option key={t} value={t}>{formatTimeForDisplay(t)}</option>)}
                </select>
              </Field>
            </div>
          )}
        </div>

        {/* ── Recurrence ────────────────────────────────────────────────── */}
        <div className="px-5 py-4 border-b border-gray-100">
          <SectionLabel icon={<Repeat className="w-3 h-3" />} text="Recurrence" />

          {/* Frequency chips */}
          <div className="flex gap-1.5 flex-wrap mt-2">
            {FREQ_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { setFreq(opt.value); setDaysOfWeek([]) }}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all ${
                  freq === opt.value
                    ? 'bg-wine-800 text-white border-wine-800'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Weekly: day-of-week pills */}
          {freq === 'weekly' && (
            <div className="flex gap-1.5 mt-3">
              {DOW_LABELS.map((day, i) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDow(i)}
                  className={`w-8 h-8 rounded-full text-[11px] font-bold border transition-all ${
                    daysOfWeek.includes(i)
                      ? 'bg-wine-800 text-white border-wine-800'
                      : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300 hover:text-gray-600'
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>
          )}

          {/* Monthly sub-options */}
          {freq === 'monthly' && (
            <div className="mt-3 space-y-2.5">
              {/* Day of month */}
              <label className="flex items-center gap-2.5 cursor-pointer">
                <div
                  className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                    monthCfg.mode === 'day_of_month' ? 'border-wine-700 bg-wine-800' : 'border-gray-300 bg-white'
                  }`}
                  onClick={() => setMonthCfg(c => ({ ...c, mode: 'day_of_month' }))}
                >
                  {monthCfg.mode === 'day_of_month' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
                <div className="flex items-center gap-1.5 text-[12px] font-medium text-gray-700">
                  Day
                  <input
                    type="number"
                    min={1} max={31}
                    value={monthCfg.dayOfMonth}
                    onChange={e => setMonthCfg(c => ({ ...c, dayOfMonth: Math.min(31, Math.max(1, parseInt(e.target.value) || 1)) }))}
                    onClick={() => setMonthCfg(c => ({ ...c, mode: 'day_of_month' }))}
                    className="w-12 px-1.5 py-0.5 border border-gray-200 rounded-md text-center text-[12px] font-bold focus:outline-none focus:border-wine-600"
                  />
                  of each month
                </div>
              </label>

              {/* Nth weekday */}
              <label className="flex items-center gap-2.5 cursor-pointer">
                <div
                  className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                    monthCfg.mode === 'nth_weekday' ? 'border-wine-700 bg-wine-800' : 'border-gray-300 bg-white'
                  }`}
                  onClick={() => setMonthCfg(c => ({ ...c, mode: 'nth_weekday' }))}
                >
                  {monthCfg.mode === 'nth_weekday' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
                <div className="flex items-center gap-1.5 text-[12px] font-medium text-gray-700 flex-wrap">
                  The
                  <select
                    value={monthCfg.nthPosition}
                    onChange={e => setMonthCfg(c => ({ ...c, nthPosition: parseInt(e.target.value) as MonthlyConfig['nthPosition'], mode: 'nth_weekday' }))}
                    className="px-2 py-0.5 border border-gray-200 rounded-md text-[12px] font-bold text-gray-700 bg-white focus:outline-none focus:border-wine-600"
                  >
                    {([1, 2, 3, 4, -1] as const).map(n => (
                      <option key={n} value={n}>{NTH_LABELS[n]}</option>
                    ))}
                  </select>
                  <select
                    value={monthCfg.weekday}
                    onChange={e => setMonthCfg(c => ({ ...c, weekday: parseInt(e.target.value), mode: 'nth_weekday' }))}
                    className="px-2 py-0.5 border border-gray-200 rounded-md text-[12px] font-bold text-gray-700 bg-white focus:outline-none focus:border-wine-600"
                  >
                    {WEEKDAY_FULL.map((wd, i) => <option key={i} value={i}>{wd}</option>)}
                  </select>
                  of each month
                </div>
              </label>
            </div>
          )}

          {/* End condition */}
          {freq !== 'none' && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">End condition</p>
              <div className="flex flex-col gap-2">
                {[
                  { val: 'never', label: 'Never' },
                  { val: 'on_date', label: 'On date' },
                  { val: 'after_count', label: 'After N occurrences' },
                ].map(opt => (
                  <label key={opt.val} className="flex items-center gap-2.5 cursor-pointer">
                    <div
                      className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                        endType === opt.val ? 'border-wine-700 bg-wine-800' : 'border-gray-300 bg-white'
                      }`}
                      onClick={() => setEndType(opt.val as typeof endType)}
                    >
                      {endType === opt.val && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <span className="text-[12px] font-medium text-gray-700">{opt.label}</span>
                    {opt.val === 'on_date' && endType === 'on_date' && (
                      <input
                        type="date"
                        value={endOnDate}
                        onChange={e => setEndOnDate(e.target.value)}
                        className="ml-1 px-2 py-0.5 border border-gray-200 rounded-md text-[12px] focus:outline-none focus:border-wine-600"
                      />
                    )}
                    {opt.val === 'after_count' && endType === 'after_count' && (
                      <div className="ml-1 flex items-center gap-1.5">
                        <input
                          type="number"
                          min={1}
                          value={endAfterCount}
                          onChange={e => setEndAfterCount(Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-14 px-2 py-0.5 border border-gray-200 rounded-md text-[12px] font-bold text-center focus:outline-none focus:border-wine-600"
                        />
                        <span className="text-[12px] text-gray-500">times</span>
                      </div>
                    )}
                  </label>
                ))}
              </div>

              {/* RRULE preview */}
              {rruleText && (
                <div className="mt-3 flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-gray-50 border border-gray-100">
                  <div className="w-1.5 h-1.5 rounded-full bg-wine-700 shrink-0" />
                  <code className="text-[10px] font-mono font-bold text-gray-500 break-all">{rruleText}</code>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Provider ──────────────────────────────────────────────────── */}
        <div className="px-5 py-4 border-b border-gray-100">
          <SectionLabel icon={<User className="w-3 h-3" />} text="Provider" />
          {selectedProvider ? (
            <div className="mt-2">
              <ProviderCard provider={selectedProvider} onClear={() => setSelectedProviderId('')} />
            </div>
          ) : (
            <div className="mt-2 relative">
              <input
                type="text"
                value={providerSearch}
                onChange={e => setProviderSearch(e.target.value)}
                placeholder="Search providers…"
                className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 focus:outline-none focus:border-wine-600 focus:ring-1 focus:ring-wine-600/20"
              />
              <User className="w-3.5 h-3.5 text-gray-300 absolute left-2.5 top-1/2 -translate-y-1/2" />
              {providerSearch && filteredProviders.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden">
                  {filteredProviders.slice(0, 5).map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { setSelectedProviderId(p.id); setProviderSearch('') }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 text-left transition-colors"
                    >
                      <div className="w-7 h-7 rounded-full bg-wine-100 flex items-center justify-center text-wine-800 text-[11px] font-bold shrink-0">
                        {p.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold text-gray-800">{p.name}</p>
                        <p className="text-[11px] text-gray-400">{p.email}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Reminders ────────────────────────────────────────────────── */}
        <div className="px-5 py-4 border-b border-gray-100">
          <SectionLabel icon={<Bell className="w-3 h-3" />} text="Reminders" />

          <div className="mt-2 space-y-2">
            {reminders.map(r => (
              <div key={r.id} className="flex items-center rounded-xl border border-gray-200 bg-white overflow-hidden">
                {/* Presets */}
                <div className="flex overflow-x-auto no-scrollbar border-r border-gray-100 flex-1">
                  {REMINDER_PRESETS.map(preset => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setReminderPreset(r.id, preset.value)}
                      className={`px-2.5 py-2 text-[11px] font-medium shrink-0 border-r border-gray-100 last:border-r-0 transition-colors whitespace-nowrap ${
                        r.minutesBefore === preset.value
                          ? 'bg-wine-50 text-wine-800 font-bold'
                          : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                {/* Channels */}
                <div className="flex gap-1 px-2 shrink-0 border-r border-gray-100">
                  {(['in_app', 'email'] as const).map(ch => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => toggleReminderChannel(r.id, ch)}
                      className={`px-2 py-1 rounded-md text-[10px] font-bold transition-colors ${
                        r.channels.includes(ch)
                          ? ch === 'in_app' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-700'
                          : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      {ch === 'in_app' ? 'In-app' : 'Email'}
                    </button>
                  ))}
                </div>
                {/* Remove */}
                {reminders.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeReminder(r.id)}
                    className="w-8 flex items-center justify-center py-2 text-gray-300 hover:text-red-400 transition-colors shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {reminders.length < 3 && (
            <button
              type="button"
              onClick={addReminder}
              className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-gray-400 hover:text-gray-600 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add another reminder
            </button>
          )}
        </div>

        {/* ── Notes ─────────────────────────────────────────────────────── */}
        <div className="px-5 py-4">
          <SectionLabel icon={<FileText className="w-3 h-3" />} text="Notes" />
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            placeholder="Add notes or description…"
            className="mt-2 w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-700 leading-relaxed focus:outline-none focus:border-wine-600 focus:ring-1 focus:ring-wine-600/20 resize-none"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between shrink-0">
        <div>
          {existingEvent && onDelete && (
            <button
              type="button"
              onClick={handleDelete}
              className="flex items-center gap-1.5 px-3 py-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors text-[13px] font-semibold"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-300 hidden sm:block">
            <kbd className="px-1.5 py-0.5 rounded bg-gray-100 border border-gray-200 text-gray-500 text-[10px] font-medium">Esc</kbd> cancel
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-[13px] font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 text-[13px] font-semibold text-white rounded-lg transition-colors"
            style={{ backgroundColor: '#901d42' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#7c1d3c')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#901d42')}
          >
            {existingEvent ? 'Save Changes' : 'Create Event'}
          </button>
        </div>
      </div>
    </form>
  )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 16 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          onClick={e => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-[600px] max-h-[90vh] overflow-hidden flex flex-col"
          style={{ boxShadow: '0 0 0 1px rgba(0,0,0,.06), 0 24px 64px rgba(0,0,0,.22)' }}
        >
          {isViewMode ? renderViewMode() : renderForm()}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ─────────────────────────────── Sub-components ───────────────────────────────

function SectionLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest flex items-center gap-1.5">
      {icon}{text}
    </p>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10.5px] font-semibold text-gray-400 uppercase tracking-widest">{label}</span>
      {children}
    </div>
  )
}

function ToggleSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex items-center gap-2">
      <div className={`w-8 h-4.5 rounded-full relative transition-colors ${checked ? 'bg-wine-800' : 'bg-gray-200'}`}
           style={{ height: '18px' }}>
        <div className={`absolute w-3.5 h-3.5 rounded-full bg-white shadow-sm top-0.5 transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </div>
      <span className="text-[12px] font-medium text-gray-600">{label}</span>
    </button>
  )
}

function ProviderCard({ provider, onClear }: { provider: Provider; onClear?: () => void }) {
  return (
    <div className="flex items-stretch rounded-xl border border-gray-200 overflow-hidden bg-white">
      <div className="w-1 shrink-0" style={{ backgroundColor: '#901d42' }} />
      <div className="w-11 flex items-center justify-center bg-wine-50 shrink-0">
        <div className="w-8 h-8 rounded-full bg-wine-100 flex items-center justify-center text-wine-800 text-[11px] font-bold">
          {provider.name.slice(0, 2).toUpperCase()}
        </div>
      </div>
      <div className="flex-1 min-w-0 px-3 py-2.5">
        <p className="text-[13px] font-bold text-gray-900">{provider.name}</p>
        <p className="text-[11px] text-gray-500 mt-0.5">{provider.email}</p>
        {provider.companyName && (
          <span className="mt-1.5 inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-wine-50 text-wine-700">
            {provider.companyName}
          </span>
        )}
      </div>
      {onClear && (
        <div className="flex items-center px-2 border-l border-gray-100">
          <button
            type="button"
            onClick={onClear}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
