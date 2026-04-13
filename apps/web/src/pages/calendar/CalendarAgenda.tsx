import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Clock, MapPin } from 'lucide-react'
import type { CalendarEvent, EventType } from './useCalendarPage'

// ==================== Types ====================

export interface CalendarAgendaProps {
  events: CalendarEvent[]
  onEventClick: (event: CalendarEvent) => void
  eventTypeColors: Record<string, string>
}

// ==================== Helpers ====================

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatTime(time: string): string {
  const [hours = '0', minutes = '00'] = time.split(':')
  const hour = parseInt(hours, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 || 12
  return `${h12}:${minutes.padStart(2, '0')} ${ampm}`
}

function formatDateHeader(date: Date): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  if (isSameDay(date, today)) return 'Today'
  if (isSameDay(date, tomorrow)) return 'Tomorrow'

  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatDateSub(date: Date): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (isSameDay(date, today) || isSameDay(date, new Date(today.getTime() + 86400000))) {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })
  }
  return ''
}

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  delivery: 'Delivery',
  order: 'Order',
  meeting: 'Meeting',
  inventory: 'Inventory',
  tasting: 'Tasting',
  reminder: 'Reminder',
  recurring: 'Recurring',
  custom: 'Custom',
}

// ==================== Grouped Data ====================

interface DateGroup {
  dateKey: string
  date: Date
  events: CalendarEvent[]
}

function groupByDate(events: CalendarEvent[]): DateGroup[] {
  const sorted = [...events].sort(
    (a, b) => a.date.getTime() - b.date.getTime() || (a.startTime || '').localeCompare(b.startTime || '')
  )

  const groups: DateGroup[] = []
  let current: DateGroup | null = null

  for (const ev of sorted) {
    const dateKey = ev.date.toISOString().split('T')[0]
    if (!current || current.dateKey !== dateKey) {
      current = { dateKey, date: new Date(ev.date), events: [] }
      groups.push(current)
    }
    current.events.push(ev)
  }

  return groups
}

// ==================== Sub-components ====================

function EventRow({
  event,
  color,
  onClick,
}: {
  event: CalendarEvent
  color: string
  onClick: () => void
}) {
  return (
    <motion.button
      onClick={onClick}
      className="w-full flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors text-left"
      whileHover={{ x: 2 }}
    >
      {/* Color indicator */}
      <div className="flex-shrink-0 mt-1">
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900 truncate">{event.title}</span>
          <span
            className="flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: color + '18', color }}
          >
            {EVENT_TYPE_LABELS[event.type] || event.type}
          </span>
        </div>

        {/* Time */}
        {(event.startTime || event.allDay) && (
          <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-500">
            <Clock className="w-3 h-3" />
            {event.allDay ? (
              <span>All day</span>
            ) : (
              <span>
                {formatTime(event.startTime!)}
                {event.endTime && ` – ${formatTime(event.endTime)}`}
              </span>
            )}
          </div>
        )}

        {/* Description preview */}
        {event.description && (
          <p className="text-xs text-gray-500 mt-1 line-clamp-1">{event.description}</p>
        )}

        {/* Location */}
        {event.location && (
          <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-400">
            <MapPin className="w-3 h-3" />
            <span className="truncate">{event.location}</span>
          </div>
        )}
      </div>

      {/* Status badge */}
      {event.status && event.status !== 'confirmed' && (
        <span className={`
          flex-shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full
          ${event.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : ''}
          ${event.status === 'cancelled' ? 'bg-red-100 text-red-600' : ''}
          ${event.status === 'completed' ? 'bg-green-100 text-green-600' : ''}
          ${event.status === 'approved' ? 'bg-blue-100 text-blue-600' : ''}
          ${event.status === 'dismissed' ? 'bg-gray-100 text-gray-500' : ''}
        `}>
          {event.status}
        </span>
      )}
    </motion.button>
  )
}

// ==================== Main Component ====================

export function CalendarAgenda({
  events,
  onEventClick,
  eventTypeColors,
}: CalendarAgendaProps) {
  const groups = useMemo(() => groupByDate(events), [events])

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20 text-center">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
          <Clock className="w-8 h-8 text-gray-400" />
        </div>
        <h3 className="text-lg font-semibold text-gray-700">No upcoming events</h3>
        <p className="text-sm text-gray-500 mt-1 max-w-xs">
          Events you create or that are scheduled will appear here in chronological order.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-2 py-3">
      {groups.map((group) => (
        <div key={group.dateKey} className="mb-4">
          {/* Date header */}
          <div className="sticky top-0 bg-white/95 backdrop-blur-sm z-10 px-3 py-2 border-b border-gray-100">
            <h3 className="text-sm font-bold text-gray-800">{formatDateHeader(group.date)}</h3>
            {formatDateSub(group.date) && (
              <p className="text-[11px] text-gray-400">{formatDateSub(group.date)}</p>
            )}
          </div>

          {/* Events */}
          <div className="mt-1">
            {group.events.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                color={eventTypeColors[event.type] || '#6B7280'}
                onClick={() => onEventClick(event)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default CalendarAgenda
