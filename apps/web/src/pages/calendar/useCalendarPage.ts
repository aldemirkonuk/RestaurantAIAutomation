import { useState, useMemo, useCallback } from 'react'
import { useCalendarEvents, useEventTypes, useProviders } from '../../hooks/queries'
import { useAuth } from '../../contexts/AuthContext'
import { expandAllRecurringEvents } from '../../lib/calendar/recurrence'
import type { RecurringEvent } from '../../lib/calendar/recurrence'

export type EventType = 'delivery' | 'order' | 'meeting' | 'inventory' | 'tasting' | 'reminder' | 'recurring' | 'custom'
export type ViewMode = 'month' | 'week' | 'day' | 'agenda'

export interface CalendarEvent {
  id: string
  title: string
  type: EventType
  date: Date
  startTime?: string
  endTime?: string
  allDay?: boolean
  description?: string
  location?: string
  attendees?: string[]
  color: string
  provider?: string
  providerId?: string
  wineCount?: number
  totalValue?: number
  status?: 'pending' | 'confirmed' | 'approved' | 'dismissed' | 'completed' | 'cancelled'
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function useCalendarPage() {
  const { user, activeRestaurantId } = useAuth()
  const restaurantId = activeRestaurantId || user?.restaurantId || null

  // View state
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('month')

  // Filter state
  const [filterType, setFilterType] = useState<EventType | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Data from hooks
  const { data: providers = [] } = useProviders(restaurantId || '')
  const { data: eventTypes = [] } = useEventTypes(restaurantId || '')

  // Calculate date range for current view
  const startDate = useMemo(() => {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
    return date.toISOString().split('T')[0]
  }, [currentDate])

  const endDate = useMemo(() => {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)
    return date.toISOString().split('T')[0]
  }, [currentDate])

  // Fetch events from API
  const {
    data: apiEvents = [],
    isLoading,
    error,
    refetch,
  } = useCalendarEvents(restaurantId || '', {
    startDate,
    endDate,
    eventType: filterType === 'all' ? undefined : filterType,
  })

  // Map provider names
  const providerNameById = useMemo(() => {
    return new Map(providers.map(provider => [provider.id, provider.name]))
  }, [providers])

  // Convert API events to local format and expand recurring events
  const events = useMemo(() => {
    // First map API events to local format
    const mapped: RecurringEvent[] = apiEvents.map(event => ({
      ...event,
      date: parseLocalDate(event.date),
      provider: event.provider || (event.providerId ? providerNameById.get(event.providerId) : undefined),
    }))
    // Expand recurring events into individual occurrences within the visible date range
    const expanded = expandAllRecurringEvents(
      mapped,
      startDate,
      endDate,
    )
    // Ensure dates are Date objects
    return expanded.map(event => ({
      ...event,
      date: typeof event.date === 'string' ? parseLocalDate(event.date) : event.date,
    }))
  }, [apiEvents, providerNameById, startDate, endDate])

  // Computed values
  const filteredEvents = useMemo(() => {
    let filtered = events

    // Type filter
    if (filterType !== 'all') {
      filtered = filtered.filter(e => e.type === filterType)
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(e =>
        e.title.toLowerCase().includes(query) ||
        e.description?.toLowerCase().includes(query) ||
        e.provider?.toLowerCase().includes(query)
      )
    }

    return filtered
  }, [events, filterType, searchQuery])

  // Events grouped by date
  const eventsByDate = useMemo(() => {
    const grouped: Record<string, CalendarEvent[]> = {}
    filteredEvents.forEach(event => {
      const dateKey = event.date.toISOString().split('T')[0]
      if (!grouped[dateKey]) {
        grouped[dateKey] = []
      }
      grouped[dateKey].push(event)
    })
    return grouped
  }, [filteredEvents])

  // Upcoming events (next 5)
  const upcomingEvents = useMemo(() => {
    const now = new Date()
    return filteredEvents
      .filter(e => new Date(e.date) >= now)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, 5)
  }, [filteredEvents])

  // Events for selected view mode
  const eventsForView = useMemo(() => {
    if (viewMode === 'month') {
      return filteredEvents
    } else if (viewMode === 'week') {
      // Get start of week (Sunday)
      const weekStart = new Date(currentDate)
      weekStart.setDate(currentDate.getDate() - currentDate.getDay())
      weekStart.setHours(0, 0, 0, 0)
      
      // Get end of week (Saturday)
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekStart.getDate() + 6)
      weekEnd.setHours(23, 59, 59, 999)

      return filteredEvents.filter(event => {
        const eventDate = new Date(event.date)
        return eventDate >= weekStart && eventDate <= weekEnd
      })
    } else if (viewMode === 'day') {
      const dayStart = new Date(currentDate)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(currentDate)
      dayEnd.setHours(23, 59, 59, 999)

      return filteredEvents.filter(event => {
        const eventDate = new Date(event.date)
        return eventDate >= dayStart && eventDate <= dayEnd
      })
    } else {
      // Agenda view - show all upcoming events
      const now = new Date()
      return filteredEvents
        .filter(e => new Date(e.date) >= now)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    }
  }, [filteredEvents, viewMode, currentDate])

  // Calendar grid helpers
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDayOfMonth = new Date(year, month, 1).getDay()

  // Actions
  const navigateDate = useCallback((direction: 'prev' | 'next') => {
    setCurrentDate(prev => {
      const newDate = new Date(prev)
      if (viewMode === 'month') {
        newDate.setMonth(prev.getMonth() + (direction === 'next' ? 1 : -1))
      } else if (viewMode === 'week') {
        newDate.setDate(prev.getDate() + (direction === 'next' ? 7 : -7))
      } else if (viewMode === 'day') {
        newDate.setDate(prev.getDate() + (direction === 'next' ? 1 : -1))
      }
      return newDate
    })
  }, [viewMode])

  const goToToday = useCallback(() => {
    setCurrentDate(new Date())
  }, [])

  const clearFilters = useCallback(() => {
    setFilterType('all')
    setSearchQuery('')
  }, [])

  return {
    // View state
    currentDate,
    setCurrentDate,
    selectedDate,
    setSelectedDate,
    viewMode,
    setViewMode,

    // Filter state
    filterType,
    setFilterType,
    searchQuery,
    setSearchQuery,
    clearFilters,

    // Data
    events,
    filteredEvents,
    eventsByDate,
    upcomingEvents,
    eventsForView,
    isLoading,
    error,
    refetch,
    eventTypes,
    providers,

    // Computed calendar values
    year,
    month,
    daysInMonth,
    firstDayOfMonth,

    // Actions
    navigateDate,
    goToToday,
  }
}
