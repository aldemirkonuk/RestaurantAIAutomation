import { useState, useMemo, useCallback } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import type { EventType } from './useCalendarPage'

// ==================== Types ====================

export interface CalendarSidebarProps {
  currentDate: Date
  selectedDate: Date | null
  onDateSelect: (date: Date) => void
  onCreateEvent: () => void
  eventTypeColors: Record<string, string>
  enabledTypes: Set<string>
  onToggleType: (type: string) => void
}

// ==================== Constants ====================

const WEEKDAYS_MINI = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

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

// ==================== Helpers ====================

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}

// ==================== Mini Calendar ====================

function MiniCalendar({
  currentDate,
  selectedDate,
  onDateSelect,
}: {
  currentDate: Date
  selectedDate: Date | null
  onDateSelect: (date: Date) => void
}) {
  const [viewMonth, setViewMonth] = useState(() => new Date(currentDate.getFullYear(), currentDate.getMonth(), 1))
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const grid = useMemo(() => {
    const year = viewMonth.getFullYear()
    const month = viewMonth.getMonth()
    const firstDay = new Date(year, month, 1)
    const startOffset = firstDay.getDay()
    const gridStart = new Date(year, month, 1 - startOffset)

    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart)
      d.setDate(gridStart.getDate() + i)
      d.setHours(0, 0, 0, 0)
      return d
    })
  }, [viewMonth])

  const prevMonth = useCallback(() => {
    setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
  }, [])

  const nextMonth = useCallback(() => {
    setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
  }, [])

  const monthLabel = viewMonth.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  return (
    <div>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={prevMonth}
          className="p-1 rounded hover:bg-gray-100 transition-colors"
        >
          <ChevronLeft className="w-4 h-4 text-gray-600" />
        </button>
        <span className="text-sm font-semibold text-gray-800">{monthLabel}</span>
        <button
          onClick={nextMonth}
          className="p-1 rounded hover:bg-gray-100 transition-colors"
        >
          <ChevronRight className="w-4 h-4 text-gray-600" />
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS_MINI.map((day, i) => (
          <div key={i} className="text-center text-[10px] font-semibold text-gray-400 py-0.5">
            {day}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7">
        {grid.map((date, i) => {
          const inMonth = isSameMonth(date, viewMonth)
          const isToday_ = isSameDay(date, today)
          const isSel = selectedDate ? isSameDay(date, selectedDate) : false

          return (
            <button
              key={i}
              onClick={() => onDateSelect(date)}
              className={`
                w-7 h-7 flex items-center justify-center text-[11px] rounded-full transition-colors
                ${isToday_ ? 'bg-blue-600 text-white font-bold' : ''}
                ${isSel && !isToday_ ? 'bg-blue-100 text-blue-700 font-semibold' : ''}
                ${!inMonth ? 'text-gray-300' : ''}
                ${inMonth && !isToday_ && !isSel ? 'text-gray-700 hover:bg-gray-100' : ''}
              `}
            >
              {date.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ==================== Event Type Legend ====================

function EventTypeLegend({
  eventTypeColors,
  enabledTypes,
  onToggleType,
}: {
  eventTypeColors: Record<string, string>
  enabledTypes: Set<string>
  onToggleType: (type: string) => void
}) {
  const types = Object.entries(eventTypeColors)

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
        Event Types
      </h3>
      <div className="flex flex-col gap-1">
        {types.map(([type, color]) => {
          const enabled = enabledTypes.has(type)
          return (
            <label
              key={type}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 cursor-pointer transition-colors"
            >
              <input
                type="checkbox"
                checked={enabled}
                onChange={() => onToggleType(type)}
                className="sr-only"
              />
              <div
                className={`w-3 h-3 rounded-sm flex-shrink-0 border transition-colors ${
                  enabled ? 'border-transparent' : 'border-gray-300 bg-white'
                }`}
                style={enabled ? { backgroundColor: color } : {}}
              >
                {enabled && (
                  <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                    <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <span className={`text-xs font-medium ${enabled ? 'text-gray-800' : 'text-gray-400'}`}>
                {EVENT_TYPE_LABELS[type as EventType] || type}
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

// ==================== Main Component ====================

export function CalendarSidebar({
  currentDate,
  selectedDate,
  onDateSelect,
  onCreateEvent,
  eventTypeColors,
  enabledTypes,
  onToggleType,
}: CalendarSidebarProps) {
  return (
    <div className="w-60 md:w-60 flex flex-col gap-5 p-4 border-r border-gray-200 bg-white h-full overflow-y-auto">
      {/* Create button */}
      <button
        onClick={onCreateEvent}
        className="flex items-center gap-2 w-full px-4 py-2.5 bg-white border border-gray-300 rounded-2xl shadow-sm hover:shadow-md transition-shadow text-sm font-medium text-gray-700"
      >
        <Plus className="w-5 h-5 text-blue-600" />
        Create
      </button>

      {/* Mini calendar */}
      <MiniCalendar
        currentDate={currentDate}
        selectedDate={selectedDate}
        onDateSelect={onDateSelect}
      />

      {/* Divider */}
      <hr className="border-gray-200" />

      {/* Event type legend */}
      <EventTypeLegend
        eventTypeColors={eventTypeColors}
        enabledTypes={enabledTypes}
        onToggleType={onToggleType}
      />
    </div>
  )
}

export default CalendarSidebar
