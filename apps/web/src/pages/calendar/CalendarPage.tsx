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
  Menu,
  X,
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
import type { CreateCalendarEventData } from './EventModal'
import { MeetingMemoPrompt } from './MeetingMemoPrompt'
import type { MeetingMemo } from './MeetingMemoPrompt'
import {
  useCreateCalendarEvent,
  useUpdateCalendarEvent,
  useDeleteCalendarEvent,
} from '../../hooks/queries'
import { useAuth } from '../../contexts/AuthContext'
import type { EventType as ApiEventType, RecurringConfig } from '../../services/api/calendar'

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

  // Mobile sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
    return eventsForView.filter((e) => enabledTypes.has(e.type))
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
      const date = dateStr ? new Date(dateStr) : new Date()
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

      if (editingEvent) {
        updateEvent.mutate({
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
        })
      } else {
        createEvent.mutate({
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
        })
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
      deleteEvent.mutate(eventId)
    },
    [deleteEvent]
  )

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
          {/* Mobile sidebar toggle */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden p-1.5 rounded-md hover:bg-gray-100 transition-colors"
            aria-label="Toggle sidebar"
          >
            {sidebarOpen ? (
              <X className="w-5 h-5 text-gray-600" />
            ) : (
              <Menu className="w-5 h-5 text-gray-600" />
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

        {/* Right: search + view tabs */}
        <div className="flex items-center gap-3">
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
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
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
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <div
          className={`
            absolute md:relative z-50 md:z-auto h-full transition-transform duration-300 ease-in-out
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
          `}
        >
          <CalendarSidebar
            currentDate={currentDate}
            selectedDate={selectedDate}
            onDateSelect={(date) => {
              setSelectedDate(date)
              setCurrentDate(date)
              setSidebarOpen(false) // Close sidebar on mobile after selection
            }}
            onCreateEvent={() => {
              openCreateModal()
              setSidebarOpen(false) // Close sidebar on mobile after create
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
        eventTypes={eventTypes}
        providers={providers}
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
