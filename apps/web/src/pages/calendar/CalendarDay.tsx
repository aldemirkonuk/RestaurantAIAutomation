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

export interface CalendarDayProps {
  currentDate: Date
  events: CalendarEvent[]
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
}

// ==================== Constants ====================

const HOUR_START = 7
const HOUR_END = 23
const TOTAL_HOURS = HOUR_END - HOUR_START
const HOUR_HEIGHT = 64
const TIME_COLUMN_WIDTH = 64
const TIME_COLUMN_WIDTH_MOBILE = 44

// ==================== Helpers ====================

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

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function layoutEvents(events: CalendarEvent[]): PositionedEvent[] {
  const timed = events
    .filter((e) => e.startTime && !e.allDay)
    .sort((a, b) => parseTimeToMinutes(a.startTime!) - parseTimeToMinutes(b.startTime!))

  if (timed.length === 0) return []

  const groups: CalendarEvent[][] = []
  let current: CalendarEvent[] = []
  let groupEnd = 0

  for (const ev of timed) {
    const start = parseTimeToMinutes(ev.startTime!)
    const end = ev.endTime ? parseTimeToMinutes(ev.endTime) : start + 60

    if (current.length === 0 || start < groupEnd) {
      current.push(ev)
      groupEnd = Math.max(groupEnd, end)
    } else {
      groups.push(current)
      current = [ev]
      groupEnd = end
    }
  }
  if (current.length > 0) groups.push(current)

  const positioned: PositionedEvent[] = []

  for (const group of groups) {
    const columns: CalendarEvent[][] = []

    for (const ev of group) {
      const evStart = parseTimeToMinutes(ev.startTime!)
      let placed = false

      for (const col of columns) {
        const last = col[col.length - 1]
        const lastEnd = last.endTime
          ? parseTimeToMinutes(last.endTime)
          : parseTimeToMinutes(last.startTime!) + 60

        if (evStart >= lastEnd) {
          col.push(ev)
          placed = true
          break
        }
      }

      if (!placed) columns.push([ev])
    }

    const totalCols = columns.length
    columns.forEach((col, colIdx) => {
      col.forEach((ev) => {
        const startMin = parseTimeToMinutes(ev.startTime!)
        const endMin = ev.endTime ? parseTimeToMinutes(ev.endTime) : startMin + 60
        const offsetMin = startMin - HOUR_START * 60
        const top = (offsetMin / 60) * HOUR_HEIGHT
        const durationMin = Math.max(endMin - startMin, 30)
        const height = (durationMin / 60) * HOUR_HEIGHT

        positioned.push({
          event: ev,
          top,
          height: Math.max(height, 28),
          left: colIdx / totalCols,
          width: 1 / totalCols,
        })
      })
    })
  }

  return positioned
}

// ==================== Sub-components ====================

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
        <div className="w-3 h-3 rounded-full bg-red-500 -ml-1.5" />
        <div className="flex-1 h-[2px] bg-red-500" />
      </div>
    </div>
  )
}

function AllDaySection({
  events,
  eventTypeColors,
  onEventClick,
}: {
  events: CalendarEvent[]
  eventTypeColors: Record<string, string>
  onEventClick: (event: CalendarEvent) => void
}) {
  const allDay = events.filter((e) => e.allDay)
  if (allDay.length === 0) return null
  
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
  const timeColumnWidth = isMobile ? TIME_COLUMN_WIDTH_MOBILE : TIME_COLUMN_WIDTH

  return (
    <div className="border-b border-gray-200 bg-gray-50/50 p-2">
      <div className="flex items-center gap-2">
        <span 
          className="text-[10px] text-gray-400 uppercase font-semibold text-right flex-shrink-0"
          style={{ width: timeColumnWidth }}
        >
          All day
        </span>
        <div className="flex flex-wrap gap-1.5 flex-1">
          {allDay.map((ev) => {
            const color = eventTypeColors[ev.type] || '#6B7280'
            return (
              <button
                key={ev.id}
                onClick={() => onEventClick(ev)}
                className="text-xs font-medium px-2.5 py-1 rounded-md truncate max-w-xs"
                style={{ backgroundColor: color + '22', color }}
                title={ev.title}
              >
                {ev.title}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ==================== Main Component ====================

export function CalendarDay({
  currentDate,
  events,
  onTimeSlotClick,
  onEventClick,
  eventTypeColors,
}: CalendarDayProps) {
  const { startDrag } = useDragDrop()
  const scrollRef = useRef<HTMLDivElement>(null)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const isToday = isSameDay(currentDate, today)
  
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])
  
  const timeColumnWidth = isMobile ? TIME_COLUMN_WIDTH_MOBILE : TIME_COLUMN_WIDTH

  const dayEvents = useMemo(
    () => events.filter((ev) => isSameDay(ev.date, currentDate)),
    [events, currentDate]
  )

  const positioned = useMemo(() => layoutEvents(dayEvents), [dayEvents])

  const handleSlotClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const y = e.clientY - rect.top
      const hour = Math.floor(y / HOUR_HEIGHT) + HOUR_START
      onTimeSlotClick(currentDate, Math.min(Math.max(hour, HOUR_START), HOUR_END - 1))
    },
    [currentDate, onTimeSlotClick]
  )

  const dateStr = formatDateForAttr(currentDate)

  useEffect(() => {
    if (scrollRef.current) {
      const now = new Date()
      const minutes = now.getHours() * 60 + now.getMinutes()
      const offset = ((minutes - HOUR_START * 60) / 60) * HOUR_HEIGHT
      scrollRef.current.scrollTop = Math.max(0, offset - 200)
    }
  }, [])

  const dateLabel = currentDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <div className="flex flex-col h-full select-none">
      {/* Day header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-white sticky top-0 z-30">
        <h2 className={`text-lg font-semibold ${isToday ? 'text-blue-600' : 'text-gray-800'}`}>
          {dateLabel}
          {isToday && (
            <span className="ml-2 text-xs font-medium bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">
              Today
            </span>
          )}
        </h2>
      </div>

      {/* All-day events */}
      <AllDaySection
        events={dayEvents}
        eventTypeColors={eventTypeColors}
        onEventClick={onEventClick}
      />

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="flex" style={{ height: TOTAL_HOURS * HOUR_HEIGHT }}>
          {/* Time labels */}
          <div className="flex-shrink-0 relative" style={{ width: timeColumnWidth }}>
            {Array.from({ length: TOTAL_HOURS }, (_, i) => (
              <div
                key={i}
                className="absolute right-3 text-[11px] text-gray-400 font-medium -translate-y-1/2"
                style={{ top: i * HOUR_HEIGHT }}
              >
                {formatHour(HOUR_START + i)}
              </div>
            ))}
          </div>

          {/* Time grid */}
          <div
            className={`flex-1 relative ${isToday ? 'bg-blue-50/20' : ''}`}
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

            {/* Hour lines */}
            {Array.from({ length: TOTAL_HOURS }, (_, i) => (
              <div
                key={i}
                className="absolute left-0 right-0 border-b border-gray-200 pointer-events-none"
                style={{ top: i * HOUR_HEIGHT }}
              />
            ))}

            {/* Half-hour lines */}
            {Array.from({ length: TOTAL_HOURS }, (_, i) => (
              <div
                key={`half-${i}`}
                className="absolute left-0 right-0 border-b border-gray-100/60 pointer-events-none"
                style={{ top: i * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
              />
            ))}

            {/* Event blocks */}
            {positioned.map((pos) => {
              const color = eventTypeColors[pos.event.type] || '#6B7280'
              const eventStartDate = new Date(currentDate)
              if (pos.event.startTime) {
                const [hours, minutes] = pos.event.startTime.split(':').map(Number)
                eventStartDate.setHours(hours, minutes || 0, 0, 0)
              }
              const eventEndDate = new Date(currentDate)
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
                  className="absolute rounded-lg px-3 py-1.5 text-left overflow-hidden cursor-move z-10"
                  style={{
                    top: pos.top,
                    height: pos.height,
                    left: `calc(${pos.left * 100}% + 4px)`,
                    width: `calc(${pos.width * 100}% - 8px)`,
                    backgroundColor: color + '18',
                    borderLeft: `4px solid ${color}`,
                    color,
                  }}
                  whileHover={{ scale: 1.005, zIndex: 20 }}
                >
                  <div className="text-sm font-semibold truncate">{pos.event.title}</div>
                  {pos.event.startTime && (
                    <div className="text-xs opacity-70 mt-0.5">
                      {formatTime(pos.event.startTime)}
                      {pos.event.endTime && ` – ${formatTime(pos.event.endTime)}`}
                    </div>
                  )}
                  {pos.height > 80 && pos.event.description && (
                    <div className="text-xs opacity-60 mt-1 line-clamp-2">
                      {pos.event.description}
                    </div>
                  )}
                  {pos.height > 60 && pos.event.location && (
                    <div className="text-xs opacity-60 mt-0.5 truncate">
                      📍 {pos.event.location}
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
        </div>
      </div>
    </div>
  )
}

export default CalendarDay
