import { useMemo, useCallback } from 'react'
import { motion } from 'framer-motion'
import type { CalendarEvent } from './useCalendarPage'

// ==================== Types ====================

export interface CalendarMonthProps {
  currentDate: Date
  events: CalendarEvent[]
  selectedDate: Date | null
  onDayClick: (date: Date) => void
  onEventClick: (event: CalendarEvent) => void
  onCreateEvent: (date: Date) => void
  eventTypeColors: Record<string, string>
}

interface DayCell {
  date: Date
  isCurrentMonth: boolean
  isToday: boolean
  isSelected: boolean
  events: CalendarEvent[]
}

// ==================== Helpers ====================

const MAX_VISIBLE_EVENTS = 3
const MAX_VISIBLE_EVENTS_MOBILE = 2

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function startOfDay(d: Date): Date {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function formatTime(time: string): string {
  const [hours = '0', minutes = '00'] = time.split(':')
  const hour = parseInt(hours, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour % 12 || 12
  return `${hour12}:${minutes.padStart(2, '0')} ${ampm}`
}

function getCurrentTimePercent(): number {
  const now = new Date()
  return ((now.getHours() * 60 + now.getMinutes()) / 1440) * 100
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ==================== Sub-components ====================

function EventPill({
  event,
  color,
  onClick,
}: {
  event: CalendarEvent
  color: string
  onClick: (e: React.MouseEvent) => void
}) {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
  return (
    <motion.button
      onClick={onClick}
      className={`group flex items-center gap-1 w-full px-1.5 py-0.5 rounded leading-tight font-medium truncate cursor-pointer text-left transition-opacity hover:opacity-80 ${
        isMobile ? 'text-[10px]' : 'text-[11px]'
      }`}
      style={{
        backgroundColor: color + '22',
        color: color,
        borderLeft: `2px solid ${color}`,
      }}
      whileHover={{ scale: 1.01 }}
      title={event.title}
    >
      {event.startTime && !event.allDay && (
        <span className={`flex-shrink-0 opacity-70 ${isMobile ? 'text-[9px]' : 'text-[10px]'}`}>
          {formatTime(event.startTime).replace(/ [AP]M$/, '')}
        </span>
      )}
      <span className="truncate">{event.title}</span>
    </motion.button>
  )
}

function OverflowIndicator({
  count,
  onClick,
}: {
  count: number
  onClick: (e: React.MouseEvent) => void
}) {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-1.5 py-0.5 font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors ${
        isMobile ? 'text-[10px]' : 'text-[11px]'
      }`}
    >
      +{count} more
    </button>
  )
}

function DayCellComponent({
  cell,
  eventTypeColors,
  onDayClick,
  onEventClick,
  onCreateEvent,
}: {
  cell: DayCell
  eventTypeColors: Record<string, string>
  onDayClick: (date: Date) => void
  onEventClick: (event: CalendarEvent) => void
  onCreateEvent: (date: Date) => void
}) {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
  const maxVisible = isMobile ? MAX_VISIBLE_EVENTS_MOBILE : MAX_VISIBLE_EVENTS
  const visibleEvents = cell.events.slice(0, maxVisible)
  const overflowCount = cell.events.length - maxVisible

  const handleDayClick = useCallback(() => {
    onDayClick(cell.date)
  }, [cell.date, onDayClick])

  const handleDoubleClick = useCallback(() => {
    onCreateEvent(cell.date)
  }, [cell.date, onCreateEvent])

  const handleEventClick = useCallback(
    (event: CalendarEvent, e: React.MouseEvent) => {
      e.stopPropagation()
      onEventClick(event)
    },
    [onEventClick]
  )

  const handleOverflowClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onDayClick(cell.date)
    },
    [cell.date, onDayClick]
  )

  const minHeight = isMobile ? 'min-h-[60px]' : 'min-h-[100px]'
  
  return (
    <div
      onClick={handleDayClick}
      onDoubleClick={handleDoubleClick}
      className={`
        ${minHeight} border-b border-r border-gray-200 p-1 cursor-pointer transition-colors relative
        ${cell.isToday ? 'bg-blue-50/60' : ''}
        ${cell.isSelected ? 'bg-blue-50 ring-1 ring-inset ring-blue-300' : ''}
        ${!cell.isCurrentMonth ? 'bg-gray-50/50' : ''}
        hover:bg-gray-50
      `}
    >
      {/* Date number */}
      <div className="flex items-center justify-between mb-0.5 px-0.5">
        <span
          className={`
            inline-flex items-center justify-center w-6 h-6 text-xs md:text-xs font-medium rounded-full
            ${cell.isToday ? 'bg-blue-600 text-white' : ''}
            ${cell.isSelected && !cell.isToday ? 'bg-blue-100 text-blue-700' : ''}
            ${!cell.isCurrentMonth ? 'text-gray-400' : 'text-gray-700'}
          `}
        >
          {cell.date.getDate()}
        </span>
      </div>

      {/* Event pills */}
      <div className="flex flex-col gap-0.5">
        {visibleEvents.map((event) => (
          <EventPill
            key={event.id}
            event={event}
            color={eventTypeColors[event.type] || '#6B7280'}
            onClick={(e) => handleEventClick(event, e)}
          />
        ))}
        {overflowCount > 0 && (
          <OverflowIndicator count={overflowCount} onClick={handleOverflowClick} />
        )}
      </div>

      {/* Current time indicator for today */}
      {cell.isToday && (
        <div
          className="absolute left-0 right-0 pointer-events-none z-10"
          style={{ top: `${Math.max(20, getCurrentTimePercent())}%` }}
        >
          <div className="flex items-center">
            <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
            <div className="flex-1 h-[2px] bg-red-500" />
          </div>
        </div>
      )}
    </div>
  )
}

// ==================== Main Component ====================

export function CalendarMonth({
  currentDate,
  events,
  selectedDate,
  onDayClick,
  onEventClick,
  onCreateEvent,
  eventTypeColors,
}: CalendarMonthProps) {
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const today = startOfDay(new Date())

  // Build grid of 6 weeks (42 cells)
  const grid = useMemo<DayCell[]>(() => {
    const firstDay = new Date(year, month, 1)
    const startOffset = firstDay.getDay() // 0 = Sunday
    const gridStart = new Date(year, month, 1 - startOffset)

    const cells: DayCell[] = []
    for (let i = 0; i < 42; i++) {
      const date = new Date(gridStart)
      date.setDate(gridStart.getDate() + i)
      const dayStart = startOfDay(date)

      const dayEvents = events.filter((ev) => isSameDay(ev.date, dayStart))
      dayEvents.sort((a, b) => {
        if (a.allDay && !b.allDay) return -1
        if (!a.allDay && b.allDay) return 1
        if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime)
        return 0
      })

      cells.push({
        date: dayStart,
        isCurrentMonth: date.getMonth() === month,
        isToday: isSameDay(dayStart, today),
        isSelected: selectedDate ? isSameDay(dayStart, selectedDate) : false,
        events: dayEvents,
      })
    }

    return cells
  }, [year, month, events, selectedDate, today])

  // Trim trailing week if entirely outside current month
  const visibleCells = useMemo(() => {
    const lastWeek = grid.slice(35)
    if (lastWeek.every((c) => !c.isCurrentMonth)) {
      return grid.slice(0, 35)
    }
    return grid
  }, [grid])

  const weekCount = visibleCells.length / 7

  return (
    <div className="flex flex-col h-full select-none">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b border-gray-200">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="py-2 px-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider border-r border-gray-200 last:border-r-0"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div
        className="grid grid-cols-7 flex-1"
        style={{ gridTemplateRows: `repeat(${weekCount}, minmax(0, 1fr))` }}
      >
        {visibleCells.map((cell, idx) => (
          <DayCellComponent
            key={`${cell.date.getTime()}-${idx}`}
            cell={cell}
            eventTypeColors={eventTypeColors}
            onDayClick={onDayClick}
            onEventClick={onEventClick}
            onCreateEvent={onCreateEvent}
          />
        ))}
      </div>
    </div>
  )
}

export default CalendarMonth
