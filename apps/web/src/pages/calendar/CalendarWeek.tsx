import { useMemo, useCallback, useRef, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { CalendarEvent } from './useCalendarPage'
import { useDragDrop } from './DragDropProvider'

// Helper to format date as yyyy-MM-dd
function formatDateForAttr(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// ==================== Types ====================

export interface CalendarWeekProps {
  currentDate: Date
  events: CalendarEvent[]
  selectedDate: Date | null
  onTimeSlotClick: (date: Date, hour: number) => void
  onEventClick: (event: CalendarEvent) => void
  eventTypeColors: Record<string, string>
}

interface PositionedEvent {
  event: CalendarEvent
  top: number
  height: number
  left: number
  width: number
  column: number
  totalColumns: number
}

// ==================== Constants ====================

const HOUR_START = 7
const HOUR_END = 23
const TOTAL_HOURS = HOUR_END - HOUR_START
const HOUR_HEIGHT = 60 // px per hour
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TIME_COLUMN_WIDTH = 56 // px
const TIME_COLUMN_WIDTH_MOBILE = 40 // px

// ==================== Helpers ====================

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function startOfDay(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

function getWeekDays(dateInWeek: Date): Date[] {
  const d = startOfDay(dateInWeek)
  const dayOfWeek = d.getDay()
  const sunday = new Date(d)
  sunday.setDate(d.getDate() - dayOfWeek)
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(sunday)
    day.setDate(sunday.getDate() + i)
    return day
  })
}

function parseTimeToMinutes(time: string): number {
  const [h = '0', m = '0'] = time.split(':')
  return parseInt(h, 10) * 60 + parseInt(m, 10)
}

function formatHour(hour: number): string {
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 || 12
  return `${h12} ${ampm}`
}

function formatTime(time: string): string {
  const [hours = '0', minutes = '00'] = time.split(':')
  const hour = parseInt(hours, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 || 12
  return `${h12}:${minutes.padStart(2, '0')} ${ampm}`
}

function getTimePosition(time: string): number {
  const minutes = parseTimeToMinutes(time)
  const offsetMinutes = minutes - HOUR_START * 60
  return (offsetMinutes / 60) * HOUR_HEIGHT
}

function getEventDuration(start: string, end?: string): number {
  const startMin = parseTimeToMinutes(start)
  const endMin = end ? parseTimeToMinutes(end) : startMin + 60
  return Math.max(endMin - startMin, 30) // min 30 minutes height
}

/** Lay out overlapping events into columns */
function layoutEvents(events: CalendarEvent[], _colors: Record<string, string>): PositionedEvent[] {
  const timed = events
    .filter((e) => e.startTime && !e.allDay)
    .sort((a, b) => parseTimeToMinutes(a.startTime!) - parseTimeToMinutes(b.startTime!))

  if (timed.length === 0) return []

  const groups: CalendarEvent[][] = []
  let currentGroup: CalendarEvent[] = []
  let groupEnd = 0

  for (const ev of timed) {
    const evStart = parseTimeToMinutes(ev.startTime!)
    const evEnd = ev.endTime ? parseTimeToMinutes(ev.endTime) : evStart + 60

    if (currentGroup.length === 0 || evStart < groupEnd) {
      currentGroup.push(ev)
      groupEnd = Math.max(groupEnd, evEnd)
    } else {
      groups.push(currentGroup)
      currentGroup = [ev]
      groupEnd = evEnd
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup)

  const positioned: PositionedEvent[] = []

  for (const group of groups) {
    const columns: CalendarEvent[][] = []

    for (const ev of group) {
      const evStart = parseTimeToMinutes(ev.startTime!)
      let placed = false

      for (let col = 0; col < columns.length; col++) {
        const lastInCol = columns[col][columns[col].length - 1]
        const lastEnd = lastInCol.endTime
          ? parseTimeToMinutes(lastInCol.endTime)
          : parseTimeToMinutes(lastInCol.startTime!) + 60

        if (evStart >= lastEnd) {
          columns[col].push(ev)
          placed = true
          break
        }
      }

      if (!placed) {
        columns.push([ev])
      }
    }

    const totalCols = columns.length
    columns.forEach((col, colIdx) => {
      col.forEach((ev) => {
        const top = getTimePosition(ev.startTime!)
        const durationMin = getEventDuration(ev.startTime!, ev.endTime)
        const height = (durationMin / 60) * HOUR_HEIGHT

        positioned.push({
          event: ev,
          top,
          height: Math.max(height, 24),
          left: colIdx / totalCols,
          width: 1 / totalCols,
          column: colIdx,
          totalColumns: totalCols,
        })
      })
    })
  }

  return positioned
}

// ==================== Sub-components ====================

function AllDayBar({
  days,
  events,
  eventTypeColors,
  onEventClick,
}: {
  days: Date[]
  events: CalendarEvent[]
  eventTypeColors: Record<string, string>
  onEventClick: (event: CalendarEvent) => void
}) {
  const allDayByDay = useMemo(() => {
    return days.map((day) =>
      events.filter((ev) => ev.allDay && isSameDay(ev.date, day))
    )
  }, [days, events])

  const hasAnyAllDay = allDayByDay.some((d) => d.length > 0)
  if (!hasAnyAllDay) return null
  
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
  const timeColumnWidth = isMobile ? TIME_COLUMN_WIDTH_MOBILE : TIME_COLUMN_WIDTH

  return (
    <div className="flex border-b border-gray-200 bg-gray-50/50">
      <div
        className="flex-shrink-0 flex items-center justify-end pr-2 text-[10px] text-gray-400 uppercase"
        style={{ width: timeColumnWidth }}
      >
        All day
      </div>
      <div className={`flex-1 ${isMobile ? '' : 'grid grid-cols-7'} min-h-[32px]`}>
        {allDayByDay.map((dayEvents, i) => (
          <div key={i} className="border-r border-gray-200 px-0.5 py-0.5 flex flex-col gap-0.5">
            {dayEvents.map((ev) => {
              const color = eventTypeColors[ev.type] || '#6B7280'
              return (
                <button
                  key={ev.id}
                  onClick={() => onEventClick(ev)}
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded truncate text-left"
                  style={{ backgroundColor: color + '22', color }}
                  title={ev.title}
                >
                  {ev.title}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function TimeGridColumn({
  day,
  events,
  eventTypeColors,
  isToday,
  isSelected,
  onTimeSlotClick,
  onEventClick,
}: {
  day: Date
  events: CalendarEvent[]
  eventTypeColors: Record<string, string>
  isToday: boolean
  isSelected: boolean
  onTimeSlotClick: (date: Date, hour: number) => void
  onEventClick: (event: CalendarEvent) => void
}) {
  const { startDrag } = useDragDrop()
  const positioned = useMemo(
    () => layoutEvents(events, eventTypeColors),
    [events, eventTypeColors]
  )

  const handleSlotClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const y = e.clientY - rect.top
      const hour = Math.floor(y / HOUR_HEIGHT) + HOUR_START
      onTimeSlotClick(day, Math.min(Math.max(hour, HOUR_START), HOUR_END - 1))
    },
    [day, onTimeSlotClick]
  )

  const dateStr = formatDateForAttr(day)

  return (
    <div
      className={`relative border-r border-gray-200 ${isToday ? 'bg-blue-50/30' : ''} ${isSelected ? 'bg-blue-50/50' : ''}`}
      style={{ height: TOTAL_HOURS * HOUR_HEIGHT }}
      onClick={handleSlotClick}
    >
      {/* Time slot grid cells with data attributes */}
      {Array.from({ length: TOTAL_HOURS }, (_, i) => {
        const hour = HOUR_START + i
        return (
          <div
            key={i}
            data-time-slot
            data-date={dateStr}
            data-hour={hour}
            className="absolute left-0 right-0"
            style={{ top: i * HOUR_HEIGHT, height: HOUR_HEIGHT }}
          />
        )
      })}

      {/* Hour grid lines */}
      {Array.from({ length: TOTAL_HOURS }, (_, i) => (
        <div
          key={i}
          className="absolute left-0 right-0 border-b border-gray-100 pointer-events-none"
          style={{ top: i * HOUR_HEIGHT }}
        />
      ))}

      {/* Half-hour lines */}
      {Array.from({ length: TOTAL_HOURS }, (_, i) => (
        <div
          key={`half-${i}`}
          className="absolute left-0 right-0 border-b border-gray-100/50 pointer-events-none"
          style={{ top: i * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
        />
      ))}

      {/* Event blocks */}
      {positioned.map((pos) => {
        const color = eventTypeColors[pos.event.type] || '#6B7280'
        const eventStartDate = new Date(day)
        if (pos.event.startTime) {
          const [hours, minutes] = pos.event.startTime.split(':').map(Number)
          eventStartDate.setHours(hours, minutes || 0, 0, 0)
        }
        const eventEndDate = new Date(day)
        if (pos.event.endTime) {
          const [hours, minutes] = pos.event.endTime.split(':').map(Number)
          eventEndDate.setHours(hours, minutes || 0, 0, 0)
        } else if (pos.event.startTime) {
          const [hours, minutes] = pos.event.startTime.split(':').map(Number)
          eventEndDate.setHours(hours + 1, minutes || 0, 0, 0)
        }

        return (
          <motion.button
            key={pos.event.id}
            onPointerDown={(e) => {
              e.stopPropagation()
              if (pos.event.startTime && pos.event.endTime) {
                startDrag('move', eventStartDate, pos.event.id, eventStartDate, eventEndDate)
              }
            }}
            onClick={(e) => {
              e.stopPropagation()
              onEventClick(pos.event)
            }}
            className="absolute rounded px-1.5 py-0.5 text-left overflow-hidden cursor-move z-10"
            style={{
              top: pos.top,
              height: pos.height,
              left: `${pos.left * 100 + 1}%`,
              width: `${pos.width * 100 - 2}%`,
              backgroundColor: color + '22',
              borderLeft: `3px solid ${color}`,
              color,
            }}
            whileHover={{ scale: 1.01, zIndex: 20 }}
          >
            <div className="text-[11px] font-semibold truncate leading-tight">
              {pos.event.title}
            </div>
            {pos.height > 36 && pos.event.startTime && (
              <div className="text-[10px] opacity-70 truncate">
                {formatTime(pos.event.startTime)}
                {pos.event.endTime && ` – ${formatTime(pos.event.endTime)}`}
              </div>
            )}
            {/* Resize handle */}
            {pos.event.startTime && pos.event.endTime && (
              <div
                className="absolute bottom-0 left-0 right-0 h-2 cursor-s-resize"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  startDrag('resize', eventEndDate, pos.event.id, eventStartDate, eventEndDate)
                }}
              />
            )}
          </motion.button>
        )
      })}

      {/* Current time indicator */}
      {isToday && <CurrentTimeIndicator />}
    </div>
  )
}

function CurrentTimeIndicator() {
  const [top, setTop] = useState(0)

  useEffect(() => {
    const update = () => {
      const now = new Date()
      const minutes = now.getHours() * 60 + now.getMinutes()
      const offset = minutes - HOUR_START * 60
      setTop((offset / 60) * HOUR_HEIGHT)
    }
    update()
    const interval = setInterval(update, 60_000)
    return () => clearInterval(interval)
  }, [])

  if (top < 0 || top > TOTAL_HOURS * HOUR_HEIGHT) return null

  return (
    <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top }}>
      <div className="flex items-center">
        <div className="w-2.5 h-2.5 rounded-full bg-red-500 -ml-[5px]" />
        <div className="flex-1 h-[2px] bg-red-500" />
      </div>
    </div>
  )
}

// ==================== Main Component ====================

export function CalendarWeek({
  currentDate,
  events,
  selectedDate,
  onTimeSlotClick,
  onEventClick,
  eventTypeColors,
}: CalendarWeekProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const today = startOfDay(new Date())

  const days = useMemo(() => getWeekDays(currentDate), [currentDate])
  
  // On mobile, show only the current day (or selected day if available)
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])
  
  const displayDays = isMobile 
    ? [selectedDate ? selectedDate : days.find(d => isSameDay(d, today)) || days[0]]
    : days

  // Group events by day
  const eventsByDay = useMemo(() => {
    return displayDays.map((day) => events.filter((ev) => isSameDay(ev.date, day)))
  }, [displayDays, events])

  // Scroll to current time on mount
  useEffect(() => {
    if (scrollRef.current) {
      const now = new Date()
      const minutes = now.getHours() * 60 + now.getMinutes()
      const offset = ((minutes - HOUR_START * 60) / 60) * HOUR_HEIGHT
      scrollRef.current.scrollTop = Math.max(0, offset - 200)
    }
  }, [])

  return (
    <div className="flex flex-col h-full select-none">
      {/* Day headers */}
      <div className="flex border-b border-gray-200 bg-white sticky top-0 z-30">
        <div 
          className="flex-shrink-0" 
          style={{ width: isMobile ? TIME_COLUMN_WIDTH_MOBILE : TIME_COLUMN_WIDTH }} 
        />
        <div className={`flex-1 ${isMobile ? '' : 'grid grid-cols-7'} overflow-x-auto`}>
          {displayDays.map((day, i) => {
            const isToday_ = isSameDay(day, today)
            const isSel = selectedDate ? isSameDay(day, selectedDate) : false
            return (
              <div
                key={i}
                className="py-2 px-1 text-center border-r border-gray-200"
              >
                <div className="text-[10px] font-semibold text-gray-500 uppercase">
                  {WEEKDAYS_SHORT[day.getDay()]}
                </div>
                <div
                  className={`
                    text-xl font-medium mt-0.5 w-10 h-10 mx-auto flex items-center justify-center rounded-full
                    ${isToday_ ? 'bg-blue-600 text-white' : ''}
                    ${isSel && !isToday_ ? 'bg-blue-100 text-blue-700' : ''}
                    ${!isToday_ && !isSel ? 'text-gray-800' : ''}
                  `}
                >
                  {day.getDate()}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* All-day events */}
      <AllDayBar
        days={displayDays}
        events={events}
        eventTypeColors={eventTypeColors}
        onEventClick={onEventClick}
      />

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-auto">
        <div className="flex" style={{ height: TOTAL_HOURS * HOUR_HEIGHT }}>
          {/* Time labels */}
          <div 
            className="flex-shrink-0 relative" 
            style={{ width: isMobile ? TIME_COLUMN_WIDTH_MOBILE : TIME_COLUMN_WIDTH }}
          >
            {Array.from({ length: TOTAL_HOURS }, (_, i) => (
              <div
                key={i}
                className="absolute right-2 text-[10px] text-gray-400 font-medium -translate-y-1/2"
                style={{ top: i * HOUR_HEIGHT }}
              >
                {formatHour(HOUR_START + i)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          <div className={`flex-1 ${isMobile ? '' : 'grid grid-cols-7'} relative`}>
            {displayDays.map((day, i) => (
              <TimeGridColumn
                key={i}
                day={day}
                events={eventsByDay[i]}
                eventTypeColors={eventTypeColors}
                isToday={isSameDay(day, today)}
                isSelected={selectedDate ? isSameDay(day, selectedDate) : false}
                onTimeSlotClick={onTimeSlotClick}
                onEventClick={onEventClick}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default CalendarWeek
