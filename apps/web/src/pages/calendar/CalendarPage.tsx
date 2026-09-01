import { useState, useMemo, useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Loader2,
  AlertCircle,
  RefreshCw,
  PanelLeftClose,
  PanelLeft,
  Plus,
} from 'lucide-react'
import { useCalendarPage } from './useCalendarPage'
import type { CalendarEvent, ViewMode } from './useCalendarPage'
import { CalendarMonth } from './CalendarMonth'
import { CalendarWeek } from './CalendarWeek'
import { CalendarDay } from './CalendarDay'
import { CalendarAgenda } from './CalendarAgenda'
import { CalendarSidebar } from './CalendarSidebar'
import { DragDropProvider } from './DragDropProvider'
import { EventModal } from './EventModal'
import type { CreateCalendarEventData, ReminderEntry } from './EventModal'
import { MeetingMemoPrompt } from './MeetingMemoPrompt'
import type { MeetingMemo } from './MeetingMemoPrompt'
import {
  useCreateCalendarEvent,
  useUpdateCalendarEvent,
  useDeleteCalendarEvent,
} from '../../hooks/queries'
import { useAuth } from '../../contexts/AuthContext'
import { useCalendarEventsSubscription } from '../../contexts/RealtimeContext'
import type { EventType as ApiEventType, RecurringConfig } from '../../services/api/calendar'
import {
  scheduleReminder,
  cancelRemindersForEvent,
  reminderTypeForMinutes,
  getScheduledReminders,
} from '../../lib/reminder-scheduler'
import { parseCalendarDateString } from '../../lib/calendar-dates'

const EVENT_TYPE_COLORS: Record<string, string> = {
  delivery: '#10B981',
  order: '#F59E0B',
  meeting: '#3B82F6',
  inventory: '#8B5CF6',
  tasting: '#EC4899',
  reminder: '#EF4444',
  recurring: '#6366F1',
  custom: '#6B7280',
}

const CALENDAR_SIDEBAR_KEY = 'wineops-calendar-sidebar'

/**
 * Persist the reminders the user set in the event modal so `startReminderScheduler`
 * (booted in `main.tsx`) actually fires them.
 *
 * This is the only reminder mechanism that fires anything: the calendar API only
 * stores a `reminderEnabled` flag plus `reminderDaysBefore`, and nothing server-side
 * reads either column — there is no reminder cron and the iCal feed emits no VALARM.
 * Re-scheduling is destructive by design: pending reminders for the event are dropped
 * first so an edited event never fires against a stale time.
 */
function syncEventReminders(
  eventId: string,
  event: { title: string; eventType: string; eventDate: string; eventTime?: string },
  reminders: ReminderEntry[] | undefined
): void {
  cancelRemindersForEvent(eventId)
  if (!reminders?.length) return

  const date = parseCalendarDateString(event.eventDate)
  reminders.forEach((reminder) => {
    if (!(reminder.minutesBefore > 0)) return
    scheduleReminder({
      eventId,
      title: event.title,
      eventType: event.eventType,
      date,
      startTime: event.eventTime,
      ...reminderTypeForMinutes(reminder.minutesBefore),
    })
  })
}

function readSidebarOpen(): boolean {
  if (typeof window === 'undefined') return true
  const stored = localStorage.getItem(CALENDAR_SIDEBAR_KEY)
  if (stored === '0') return false
  if (stored === '1') return true
  // Default: open on desktop, closed on phone (drawer pattern)
  return window.matchMedia('(min-width: 768px)').matches
}

const VIEW_TABS: { key: ViewMode; label: string }[] = [
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
  { key: 'day', label: 'Day' },
  { key: 'agenda', label: 'Agenda' },
]

function formatToolbarDate(date: Date, viewMode: ViewMode): string {
  if (viewMode === 'day') {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }
  if (viewMode === 'week') {
    const weekStart = new Date(date)
    weekStart.setDate(date.getDate() - date.getDay())
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 6)

    if (weekStart.getMonth() === weekEnd.getMonth()) {
      return `${weekStart.toLocaleDateString('en-US', { month: 'long' })} ${weekStart.getDate()} – ${weekEnd.getDate()}, ${weekStart.getFullYear()}`
    }
    return `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  }
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export default function CalendarPage() {
  const { user, activeRestaurantId } = useAuth()
  const restaurantId = activeRestaurantId || user?.restaurantId || ''

  const {
    currentDate,
    setCurrentDate,
    selectedDate,
    setSelectedDate,
    viewMode,
    setViewMode,
    filterType: _filterType,
    setFilterType: _setFilterType,
    searchQuery,
    setSearchQuery,
    filteredEvents: _filteredEvents,
    eventsForView,
    isLoading,
    error,
    refetch,
    eventTypes,
    providers,
    navigateDate,
    goToToday,
  } = useCalendarPage()

  /**
   * Live refresh — restored from `/calendar-classic` (ADR 0019 §B retired the page
   * and took this with it, which was a genuine reduction, not a simplification).
   *
   * `dispatchCalendarEvent` (RealtimeContext) fires a `calendar_event_change`
   * window event whenever anything else in the app moves a calendar row — the
   * calendar agent booking a delivery, an order confirming an ETA. Without this the
   * page only reflected its own mutations, so a calendar left open on a pass showed
   * a schedule that had already changed. Refetch rather than patch local state: the
   * payload is a change notice, and the server owns recurrence expansion.
   */
  useCalendarEventsSubscription(
    useCallback(() => {
      void refetch()
    }, [refetch])
  )

  // Mutations
  const createEvent = useCreateCalendarEvent()
  const updateEvent = useUpdateCalendarEvent()
  const deleteEvent = useDeleteCalendarEvent()

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [modalInitialDate, setModalInitialDate] = useState<Date | undefined>()
  const [modalInitialEndDate, setModalInitialEndDate] = useState<Date | undefined>()

  // Meeting memo prompt state
  const [memoPromptOpen, setMemoPromptOpen] = useState(false)
  const [pendingMemoData, setPendingMemoData] = useState<{ title: string; date: string; labels: CreateCalendarEventData['labels'] }>({ title: '', date: '', labels: [] })

  // Sidebar enabled types for filtering legend
  const [enabledTypes, setEnabledTypes] = useState<Set<string>>(
    () => new Set(Object.keys(EVENT_TYPE_COLORS))
  )

  // Sidebar: desktop collapses like Cursor’s primary sidebar; mobile is a drawer.
  // Preference persists across visits (⌘B / Ctrl+B).
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen)

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev
      localStorage.setItem(CALENDAR_SIDEBAR_KEY, next ? '1' : '0')
      return next
    })
  }, [])

  const handleToggleType = useCallback((type: string) => {
    setEnabledTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }, [])

  // Filter events by enabled types in addition to hook-level filtering
  const visibleEvents = useMemo(() => {
    if (enabledTypes.size === Object.keys(EVENT_TYPE_COLORS).length) {
      return eventsForView
    }
    return eventsForView.filter((e) => enabledTypes.has(e.type as string))
  }, [eventsForView, enabledTypes])

  // ---- Event handlers ----

  const openCreateModal = useCallback((date?: Date, endDate?: Date) => {
    setEditingEvent(null)
    setModalInitialDate(date || new Date())
    setModalInitialEndDate(endDate)
    setModalOpen(true)
  }, [])

  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    if (searchParams.get('openModal') === 'true') {
      const dateStr = searchParams.get('date')
      // `new Date(dateStr)` was taken on trust, so a caller sending anything
      // that is not a date — the literal `today` was the one in production —
      // opened the create-event modal on Invalid Date. Parse in LOCAL time
      // (parseCalendarDateString; `new Date('2026-09-01')` is UTC midnight and
      // lands on the previous day west of Greenwich) and fall back to today
      // when the value is not a date at all.
      const parsed = dateStr ? parseCalendarDateString(dateStr) : null
      const date = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date()
      openCreateModal(date)
      setSearchParams(prev => {
        prev.delete('openModal')
        prev.delete('date')
        return prev
      }, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openEditModal = useCallback((event: CalendarEvent) => {
    setEditingEvent(event)
    setModalInitialDate(undefined)
    setModalInitialEndDate(undefined)
    setModalOpen(true)
  }, [])

  const handleModalSave = useCallback(
    (data: CreateCalendarEventData) => {
      // Validate eventType is a valid EventType
      const validEventTypes: ApiEventType[] = ['delivery', 'order', 'meeting', 'inventory', 'tasting', 'reminder', 'recurring', 'custom']
      const eventType = validEventTypes.includes(data.eventType as ApiEventType) 
        ? (data.eventType as ApiEventType)
        : 'custom'

      // Reminders live in localStorage (see syncEventReminders) — the API has no
      // reminder endpoint, so dropping them here is what made the page lie.
      const reminderContext = {
        title: data.title,
        eventType,
        eventDate: data.eventDate,
        eventTime: data.allDay ? undefined : data.eventTime,
      }

      if (editingEvent) {
        updateEvent.mutate(
          {
            id: editingEvent.id,
            title: data.title,
            date: data.eventDate,
            startTime: data.eventTime,
            endTime: data.eventTimeEnd,
            allDay: data.allDay,
            description: data.description,
            color: data.color,
            providerId: data.providerId,
            type: eventType,
            status: data.status,
          },
          {
            onSuccess: () =>
              syncEventReminders(editingEvent.id, reminderContext, data.reminders),
          }
        )
      } else {
        createEvent.mutate(
          {
            restaurantId,
            title: data.title,
            date: data.eventDate,
            startTime: data.eventTime,
            endTime: data.eventTimeEnd,
            allDay: data.allDay,
            description: data.description,
            color: data.color,
            providerId: data.providerId,
            type: eventType,
            status: data.status,
            recurring: data.recurrence as RecurringConfig | undefined,
          },
          {
            onSuccess: (created) =>
              syncEventReminders(created.id, reminderContext, data.reminders),
          }
        )
      }

      // Trigger meeting memo prompt for labeled events
      const hasMeetingLabel = data.labels?.some(
        l => l.type === 'provider_meeting' || l.type === 'call' || l.type === 'tasting'
      )
      if (hasMeetingLabel && data.labels) {
        setPendingMemoData({ title: data.title, date: data.eventDate, labels: data.labels })
        setTimeout(() => setMemoPromptOpen(true), 400)
      }
    },
    [editingEvent, restaurantId, createEvent, updateEvent]
  )

  const handleMemoSave = useCallback((_memo: MeetingMemo) => {
    // Future: persist to documents API
    setMemoPromptOpen(false)
  }, [])

  const handleModalDelete = useCallback(
    (eventId: string) => {
      // Drop pending reminders too — otherwise they fire for a deleted event.
      cancelRemindersForEvent(eventId)
      deleteEvent.mutate(eventId)
    },
    [deleteEvent]
  )

  // Reminders for the event being edited, read back from the scheduler store so
  // the modal shows what is actually scheduled rather than the create-mode default.
  const editingEventReminders = useMemo<ReminderEntry[] | undefined>(() => {
    if (!editingEvent) return undefined
    const scheduled = getScheduledReminders().filter(
      (reminder) => reminder.eventId === editingEvent.id && reminder.status === 'pending'
    )
    if (scheduled.length === 0) return []
    return scheduled.map((reminder) => ({
      id: reminder.id,
      minutesBefore:
        reminder.reminderType === 'custom'
          ? reminder.customMinutes ?? 15
          : { '15min': 15, '1hour': 60, '1day': 1440, '1week': 10080 }[reminder.reminderType],
      channels: ['in_app'],
    }))
  }, [editingEvent])

  // View component callbacks
  const handleDayClick = useCallback(
    (date: Date) => {
      setSelectedDate(date)
      if (viewMode === 'month') {
        setCurrentDate(date)
      }
    },
    [setSelectedDate, setCurrentDate, viewMode]
  )

  const handleTimeSlotClick = useCallback(
    (date: Date, hour: number) => {
      const startDate = new Date(date)
      startDate.setHours(hour, 0, 0, 0)
      const endDate = new Date(startDate)
      endDate.setHours(hour + 1, 0, 0, 0)
      openCreateModal(startDate, endDate)
    },
    [openCreateModal]
  )

  // DragDrop callbacks
  const handleDragCreate = useCallback(
    (start: Date, end: Date) => {
      openCreateModal(start, end)
    },
    [openCreateModal]
  )

  const handleDragMove = useCallback(
    (eventId: string, newStart: Date, newEnd: Date) => {
      const dateStr = `${newStart.getFullYear()}-${String(newStart.getMonth() + 1).padStart(2, '0')}-${String(newStart.getDate()).padStart(2, '0')}`
      const startTime = `${String(newStart.getHours()).padStart(2, '0')}:${String(newStart.getMinutes()).padStart(2, '0')}`
      const endTime = `${String(newEnd.getHours()).padStart(2, '0')}:${String(newEnd.getMinutes()).padStart(2, '0')}`
      updateEvent.mutate({
        id: eventId,
        date: dateStr,
        startTime,
        endTime,
      })
    },
    [updateEvent]
  )

  const handleDragResize = useCallback(
    (eventId: string, newEnd: Date) => {
      const endTime = `${String(newEnd.getHours()).padStart(2, '0')}:${String(newEnd.getMinutes()).padStart(2, '0')}`
      updateEvent.mutate({
        id: eventId,
        endTime,
      })
    },
    [updateEvent]
  )

  // ---- Keyboard shortcuts (NEW-399) ----
  // t today · m/w/d/a views · n new event · ←/→ prev/next · ⌘B toggle sidebar.
  // Yields to the global ⌘K palette and `g`-then-key nav (skips when
  // defaultPrevented / typing / a modal is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (modalOpen || memoPromptOpen) return
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      )
        return

      // Cursor-style primary sidebar toggle
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleSidebar()
        return
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return

      switch (e.key) {
        case 't':
          goToToday()
          break
        case 'm':
          setViewMode('month')
          break
        case 'w':
          setViewMode('week')
          break
        case 'd':
          setViewMode('day')
          break
        case 'a':
          setViewMode('agenda')
          break
        case 'n':
          e.preventDefault()
          openCreateModal()
          break
        case 'ArrowLeft':
          navigateDate('prev')
          break
        case 'ArrowRight':
          navigateDate('next')
          break
        default:
          return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    modalOpen,
    memoPromptOpen,
    goToToday,
    setViewMode,
    openCreateModal,
    navigateDate,
    toggleSidebar,
  ])

  // ---- Render ----

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20 text-center">
        <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
        <h2 className="text-lg font-semibold text-gray-800">Failed to load calendar</h2>
        <p className="text-sm text-gray-500 mt-1 mb-4">
          {(error as Error).message || 'An unexpected error occurred.'}
        </p>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-white shrink-0">
        {/* Left: navigation */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleSidebar}
            className="p-1.5 rounded-md hover:bg-gray-100 transition-colors text-gray-600"
            aria-label={sidebarOpen ? 'Hide calendar sidebar' : 'Show calendar sidebar'}
            aria-pressed={sidebarOpen}
            title={sidebarOpen ? 'Hide sidebar (⌘B / Ctrl+B)' : 'Show sidebar (⌘B / Ctrl+B)'}
          >
            {sidebarOpen ? (
              <PanelLeftClose className="w-5 h-5" />
            ) : (
              <PanelLeft className="w-5 h-5" />
            )}
          </button>
          <button
            onClick={goToToday}
            className="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            Today
          </button>
          <button
            onClick={() => navigateDate('prev')}
            className="p-1.5 rounded-md hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <button
            onClick={() => navigateDate('next')}
            className="p-1.5 rounded-md hover:bg-gray-100 transition-colors"
          >
            <ChevronRight className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900 ml-2 select-none">
            {formatToolbarDate(currentDate, viewMode)}
          </h1>
        </div>

        {/* Right: new event + search + view tabs */}
        <div className="flex items-center gap-3">
          {/* New Event CTA */}
          <button
            onClick={() => openCreateModal()}
            data-tour="calendar-new-event"
            className="hidden sm:flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold text-white rounded-lg transition-colors"
            style={{ backgroundColor: '#1A5E6B' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#7c1d3c')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#1A5E6B')}
          >
            <Plus className="w-4 h-4" />
            New Event
          </button>

          {/* Search */}
          <div className="relative hidden sm:block">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search events..."
              className="pl-8 pr-3 py-1.5 w-48 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* View switcher */}
          <div className="flex rounded-lg border border-gray-300 overflow-hidden" data-tour="calendar-view-switcher">
            {VIEW_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setViewMode(tab.key)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === tab.key
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                } ${tab.key !== 'month' ? 'border-l border-gray-300' : ''}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Main area ── */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={toggleSidebar}
          />
        )}

        {/* Sidebar — collapses on all breakpoints (⌘B), drawer overlay on phone */}
        <div
          className={`
            absolute z-50 h-full transition-transform duration-300 ease-in-out
            ${sidebarOpen
              ? 'translate-x-0 md:relative md:z-auto'
              : '-translate-x-full pointer-events-none'}
          `}
          aria-hidden={!sidebarOpen}
          data-tour={sidebarOpen ? 'calendar-sidebar' : undefined}
        >
          <CalendarSidebar
            currentDate={currentDate}
            selectedDate={selectedDate}
            onDateSelect={(date) => {
              setSelectedDate(date)
              setCurrentDate(date)
              // Close drawer after pick on phone — don't persist (desktop pref stays)
              if (window.matchMedia('(max-width: 767px)').matches) {
                setSidebarOpen(false)
              }
            }}
            onCreateEvent={() => {
              openCreateModal()
              if (window.matchMedia('(max-width: 767px)').matches) {
                setSidebarOpen(false)
              }
            }}
            eventTypeColors={EVENT_TYPE_COLORS}
            enabledTypes={enabledTypes}
            onToggleType={handleToggleType}
          />
        </div>

        {/* Calendar views */}
        <div className="flex-1 overflow-hidden relative">
          {isLoading && (
            <div className="absolute inset-0 bg-white/60 z-40 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
          )}

          <DragDropProvider
            onCreateEvent={handleDragCreate}
            onMoveEvent={handleDragMove}
            onResizeEvent={handleDragResize}
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={viewMode}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="h-full"
                data-tour="calendar-grid"
              >
                {viewMode === 'month' && (
                  <CalendarMonth
                    currentDate={currentDate}
                    events={visibleEvents}
                    selectedDate={selectedDate}
                    onDayClick={handleDayClick}
                    onEventClick={openEditModal}
                    onCreateEvent={(date) => openCreateModal(date)}
                    eventTypeColors={EVENT_TYPE_COLORS}
                  />
                )}

                {viewMode === 'week' && (
                  <CalendarWeek
                    currentDate={currentDate}
                    events={visibleEvents}
                    selectedDate={selectedDate}
                    onTimeSlotClick={handleTimeSlotClick}
                    onEventClick={openEditModal}
                    eventTypeColors={EVENT_TYPE_COLORS}
                  />
                )}

                {viewMode === 'day' && (
                  <CalendarDay
                    currentDate={currentDate}
                    events={visibleEvents}
                    onTimeSlotClick={handleTimeSlotClick}
                    onEventClick={openEditModal}
                    eventTypeColors={EVENT_TYPE_COLORS}
                  />
                )}

                {viewMode === 'agenda' && (
                  <CalendarAgenda
                    events={visibleEvents}
                    onEventClick={openEditModal}
                    eventTypeColors={EVENT_TYPE_COLORS}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </DragDropProvider>
        </div>
      </div>

      {/* ── Mobile FAB ── */}
      <button
        onClick={() => openCreateModal()}
        className="sm:hidden fixed bottom-6 right-6 z-30 w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white"
        style={{ backgroundColor: '#1A5E6B' }}
        aria-label="New event"
      >
        <Plus className="w-6 h-6" />
      </button>

      {/* ── Event Modal ── */}
      <EventModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false)
          setEditingEvent(null)
        }}
        onSave={handleModalSave}
        onDelete={handleModalDelete}
        initialDate={modalInitialDate}
        initialEndDate={modalInitialEndDate}
        existingEvent={editingEvent || undefined}
        existingReminders={editingEventReminders}
        eventTypes={eventTypes}
        providers={providers as any}
      />

      <MeetingMemoPrompt
        isOpen={memoPromptOpen}
        onClose={() => setMemoPromptOpen(false)}
        onSave={handleMemoSave}
        eventTitle={pendingMemoData.title}
        eventDate={pendingMemoData.date}
        labels={pendingMemoData.labels}
      />
    </div>
  )
}
