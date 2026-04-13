import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Calendar,
  Clock,
  FileText,
  Repeat,
  Palette,
  User,
  Bell,
  ChevronDown,
  ChevronUp,
  Trash2,
} from 'lucide-react'
import type { CalendarEvent } from './useCalendarPage'
import type { EventType } from '../../services/api/calendar'
import type { Provider } from '../../services/api/types'
import type { RecurrenceRule } from '../../lib/calendar/recurrence'

// ==================== Types ====================

export interface CreateCalendarEventData {
  title: string
  description?: string
  eventDate: string
  eventDateEnd?: string
  eventTime?: string
  eventTimeEnd?: string
  allDay: boolean
  eventType: string
  color?: string
  recurrence?: RecurrenceRule
  providerId?: string
  reminder?: number // minutes before
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

// ==================== Constants ====================

const TIME_OPTIONS = (() => {
  const times: string[] = []
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      const h12 = hour % 12 || 12
      const ampm = hour >= 12 ? 'PM' : 'AM'
      const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
      const displayStr = `${h12}:${minute.toString().padStart(2, '0')} ${ampm}`
      times.push(timeStr)
    }
  }
  return times
})()

const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'custom', label: 'Custom' },
] as const

const REMINDER_OPTIONS = [
  { value: 0, label: 'None' },
  { value: 5, label: '5 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
] as const

const COLOR_PALETTE = [
  '#3B82F6', // Blue
  '#10B981', // Green
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#6366F1', // Indigo
  '#6B7280', // Gray
]

// ==================== Helper Functions ====================

function formatDateForInput(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatTimeForInput(time: string): string {
  // Convert HH:MM to HH:MM format (already correct)
  return time
}

function formatTimeForDisplay(time: string): string {
  const [hours = '0', minutes = '00'] = time.split(':')
  const hour = parseInt(hours, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 || 12
  return `${h12}:${minutes.padStart(2, '0')} ${ampm}`
}

function getDefaultEndTime(startTime: string): string {
  const [hours = '0', minutes = '0'] = startTime.split(':')
  const hour = parseInt(hours, 10)
  const minute = parseInt(minutes, 10)
  const endMinute = minute + 60 // Default 1 hour duration
  const endHour = hour + Math.floor(endMinute / 60)
  const finalMinute = endMinute % 60
  return `${endHour.toString().padStart(2, '0')}:${finalMinute.toString().padStart(2, '0')}`
}

// ==================== Component ====================

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

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [eventDateEnd, setEventDateEnd] = useState('')
  const [eventTime, setEventTime] = useState('09:00')
  const [eventTimeEnd, setEventTimeEnd] = useState('10:00')
  const [allDay, setAllDay] = useState(false)
  const [selectedEventType, setSelectedEventType] = useState<string>('')
  const [selectedColor, setSelectedColor] = useState<string>('')
  const [recurrence, setRecurrence] = useState<string>('none')
  const [selectedProviderId, setSelectedProviderId] = useState<string>('')
  const [reminder, setReminder] = useState<number>(0)
  const [showMoreOptions, setShowMoreOptions] = useState(false)
  const [providerSearch, setProviderSearch] = useState('')

  // Initialize form from props
  useEffect(() => {
    if (isOpen) {
      if (existingEvent) {
        // Editing existing event
        // Find the EventType object that matches the event's type string
        const matchingEventType = eventTypes.find(
          et => et.name.toLowerCase() === existingEvent.type.toLowerCase()
        ) || eventTypes[0]

        setTitle(existingEvent.title)
        setDescription(existingEvent.description || '')
        setEventDate(formatDateForInput(existingEvent.date))
        setEventDateEnd('')
        setEventTime(existingEvent.startTime || '09:00')
        setEventTimeEnd(existingEvent.endTime || getDefaultEndTime(existingEvent.startTime || '09:00'))
        setAllDay(existingEvent.allDay || false)
        setSelectedEventType(matchingEventType?.id || '')
        setSelectedColor(existingEvent.color || matchingEventType?.color || COLOR_PALETTE[0])
        setSelectedProviderId(existingEvent.providerId || '')
        setRecurrence('none')
        setReminder(0)
      } else {
        // Creating new event
        const startDate = initialDate || new Date()
        const endDate = initialEndDate || new Date(startDate.getTime() + 60 * 60 * 1000) // Default 1 hour

        setTitle('')
        setDescription('')
        setEventDate(formatDateForInput(startDate))
        setEventDateEnd(formatDateForInput(endDate))
        setEventTime(startDate.toTimeString().slice(0, 5))
        setEventTimeEnd(endDate.toTimeString().slice(0, 5))
        setAllDay(false)
        setSelectedEventType(eventTypes[0]?.id || '')
        setSelectedColor(eventTypes[0]?.color || COLOR_PALETTE[0])
        setSelectedProviderId('')
        setRecurrence('none')
        setReminder(0)
        setShowMoreOptions(false)
        setProviderSearch('')

        // Focus title input after a short delay
        setTimeout(() => {
          titleInputRef.current?.focus()
        }, 100)
      }
    }
  }, [isOpen, existingEvent, initialDate, initialEndDate, eventTypes])

  // Update end time when start time changes
  useEffect(() => {
    if (!allDay && eventTime && !existingEvent) {
      const newEndTime = getDefaultEndTime(eventTime)
      setEventTimeEnd(newEndTime)
    }
  }, [eventTime, allDay, existingEvent])

  // Update color when event type changes
  useEffect(() => {
    if (selectedEventType) {
      const eventType = eventTypes.find(et => et.id === selectedEventType)
      if (eventType) {
        setSelectedColor(eventType.color)
      }
    }
  }, [selectedEventType, eventTypes])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!title.trim()) {
      return
    }

    // Find the selected event type and use its name as the eventType string
    const selectedType = eventTypes.find(et => et.id === selectedEventType)
    const eventTypeString = selectedType?.name.toLowerCase() || selectedEventType

    const eventData: CreateCalendarEventData = {
      title: title.trim(),
      description: description.trim() || undefined,
      eventDate,
      eventDateEnd: eventDateEnd && eventDateEnd !== eventDate ? eventDateEnd : undefined,
      eventTime: allDay ? undefined : eventTime,
      eventTimeEnd: allDay ? undefined : eventTimeEnd,
      allDay,
      eventType: eventTypeString,
      color: selectedColor,
      providerId: selectedProviderId || undefined,
      reminder: reminder > 0 ? reminder : undefined,
    }

    // Add recurrence if selected
    if (recurrence !== 'none') {
      eventData.recurrence = {
        frequency: recurrence as 'daily' | 'weekly' | 'monthly' | 'yearly',
        interval: 1,
        endType: 'never',
      }
    }

    onSave(eventData)
    onClose()
  }

  const handleDelete = () => {
    if (existingEvent && onDelete) {
      if (window.confirm('Are you sure you want to delete this event?')) {
        onDelete(existingEvent.id)
        onClose()
      }
    }
  }

  const filteredProviders = providers.filter(p =>
    p.name.toLowerCase().includes(providerSearch.toLowerCase())
  )

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-purple-50 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-xl">
                <Calendar className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  {existingEvent ? 'Edit Event' : 'Create Event'}
                </h3>
                <p className="text-sm text-gray-500">
                  {existingEvent ? 'Update event details' : 'Add a new calendar event'}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/50 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
            <div className="p-6 space-y-5">
              {/* Title */}
              <div>
                <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  ref={titleInputRef}
                  id="title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Event title"
                  required
                />
              </div>

              {/* Date and Time */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Start Date */}
                <div>
                  <label htmlFor="eventDate" className="block text-sm font-medium text-gray-700 mb-1.5">
                    <Calendar className="w-4 h-4 inline mr-1" />
                    Date
                  </label>
                  <input
                    id="eventDate"
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>

                {/* End Date (optional) */}
                <div>
                  <label htmlFor="eventDateEnd" className="block text-sm font-medium text-gray-700 mb-1.5">
                    End Date (optional)
                  </label>
                  <input
                    id="eventDateEnd"
                    type="date"
                    value={eventDateEnd}
                    onChange={(e) => setEventDateEnd(e.target.value)}
                    min={eventDate}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* All Day Toggle */}
              <div className="flex items-center gap-2">
                <input
                  id="allDay"
                  type="checkbox"
                  checked={allDay}
                  onChange={(e) => setAllDay(e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="allDay" className="text-sm font-medium text-gray-700">
                  All day
                </label>
              </div>

              {/* Time (hidden if all day) */}
              {!allDay && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="eventTime" className="block text-sm font-medium text-gray-700 mb-1.5">
                      <Clock className="w-4 h-4 inline mr-1" />
                      Start Time
                    </label>
                    <select
                      id="eventTime"
                      value={eventTime}
                      onChange={(e) => setEventTime(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      {TIME_OPTIONS.map((time) => (
                        <option key={time} value={time}>
                          {formatTimeForDisplay(time)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="eventTimeEnd" className="block text-sm font-medium text-gray-700 mb-1.5">
                      End Time
                    </label>
                    <select
                      id="eventTimeEnd"
                      value={eventTimeEnd}
                      onChange={(e) => setEventTimeEnd(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      {TIME_OPTIONS.map((time) => (
                        <option key={time} value={time}>
                          {formatTimeForDisplay(time)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Event Type */}
              <div>
                <label htmlFor="eventType" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Event Type
                </label>
                <select
                  id="eventType"
                  value={selectedEventType}
                  onChange={(e) => setSelectedEventType(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  {eventTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1.5">
                  <FileText className="w-4 h-4 inline mr-1" />
                  Description
                </label>
                <textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Add event details..."
                />
              </div>

              {/* More Options Toggle */}
              <button
                type="button"
                onClick={() => setShowMoreOptions(!showMoreOptions)}
                className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
              >
                {showMoreOptions ? (
                  <>
                    <ChevronUp className="w-4 h-4" />
                    Less options
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" />
                    More options
                  </>
                )}
              </button>

              {/* More Options Section */}
              {showMoreOptions && (
                <div className="space-y-4 pt-2 border-t border-gray-200">
                  {/* Color */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      <Palette className="w-4 h-4 inline mr-1" />
                      Color
                    </label>
                    <div className="flex gap-2 flex-wrap">
                      {COLOR_PALETTE.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setSelectedColor(color)}
                          className={`w-10 h-10 rounded-lg border-2 transition-all ${
                            selectedColor === color
                              ? 'border-gray-900 scale-110'
                              : 'border-gray-300 hover:border-gray-400'
                          }`}
                          style={{ backgroundColor: color }}
                          title={color}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Provider */}
                  {providers.length > 0 && (
                    <div>
                      <label htmlFor="provider" className="block text-sm font-medium text-gray-700 mb-1.5">
                        <User className="w-4 h-4 inline mr-1" />
                        Provider
                      </label>
                      <input
                        type="text"
                        value={providerSearch}
                        onChange={(e) => setProviderSearch(e.target.value)}
                        placeholder="Search providers..."
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-2"
                      />
                      <select
                        id="provider"
                        value={selectedProviderId}
                        onChange={(e) => setSelectedProviderId(e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">None</option>
                        {filteredProviders.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Recurrence */}
                  <div>
                    <label htmlFor="recurrence" className="block text-sm font-medium text-gray-700 mb-1.5">
                      <Repeat className="w-4 h-4 inline mr-1" />
                      Repeats
                    </label>
                    <select
                      id="recurrence"
                      value={recurrence}
                      onChange={(e) => setRecurrence(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      {RECURRENCE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Reminder */}
                  <div>
                    <label htmlFor="reminder" className="block text-sm font-medium text-gray-700 mb-1.5">
                      <Bell className="w-4 h-4 inline mr-1" />
                      Reminder
                    </label>
                    <select
                      id="reminder"
                      value={reminder}
                      onChange={(e) => setReminder(parseInt(e.target.value, 10))}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      {REMINDER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between shrink-0">
              <div>
                {existingEvent && onDelete && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {existingEvent ? 'Save Changes' : 'Create Event'}
                </button>
              </div>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
