import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../lib/query-keys'
import type { CalendarFilters } from '../../lib/query-keys'
import {
  fetchCalendarEvents,
  fetchCalendarEventById,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  fetchUpcomingEvents,
  fetchEventTypes,
  createEventType,
  updateEventType,
  deleteEventType,
  updateEventStatus,
  fetchEventsByProvider,
  createRecurringEvents,
  updateRecurringEventOccurrence,
  deleteRecurringEventFuture,
  checkEventConflicts,
  type CalendarEvent,
  type CreateEventInput,
  type UpdateEventInput,
  type EventType,
} from '../../services/api/calendar'
import { useNotificationStore } from '../../stores'
import { offlineStorage } from '../../lib/offline-storage'
import { syncManager } from '../../lib/sync-manager'

/**
 * Hook to fetch calendar events for a date range
 * With offline support: caches data and falls back to cached data when offline
 */
export function useCalendarEvents(restaurantId: string, filters: CalendarFilters) {
  const cacheKey = `calendar_events_${restaurantId}_${filters.startDate}_${filters.endDate}`
  
  return useQuery({
    queryKey: queryKeys.calendar.events(restaurantId, filters),
    queryFn: async () => {
      try {
        const events = await fetchCalendarEvents(restaurantId, filters)
        
        // Cache the successful response
        await offlineStorage.cacheEntity(cacheKey, events, 5 * 60 * 1000) // 5 min TTL
        await offlineStorage.markSynced('calendar')
        
        return events
      } catch (error) {
        // Try to get cached data
        const cached = await offlineStorage.getCachedEntity<CalendarEvent[]>(cacheKey)
        if (cached) {
          console.warn('[Calendar] Using cached data due to API error')
          return cached
        }
        
        // In development, return empty array instead of throwing
        if (import.meta.env.DEV) {
          console.warn('API not available, returning empty calendar events')
          return []
        }
        throw error
      }
    },
    enabled: !!restaurantId && !!filters.startDate && !!filters.endDate,
    staleTime: 30000, // Consider data fresh for 30 seconds
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
  })
}

/**
 * Hook to fetch a single calendar event
 */
export function useCalendarEvent(id: string) {
  return useQuery({
    queryKey: queryKeys.calendar.event(id),
    queryFn: () => fetchCalendarEventById(id),
    enabled: !!id,
  })
}

/**
 * Hook to fetch upcoming events
 */
export function useUpcomingEvents(restaurantId: string, days: number = 7) {
  return useQuery({
    queryKey: queryKeys.calendar.upcoming(restaurantId),
    queryFn: () => fetchUpcomingEvents(restaurantId, days),
    enabled: !!restaurantId,
  })
}

/**
 * Hook to fetch event types (including custom types)
 */
export function useEventTypes(restaurantId: string) {
  return useQuery({
    queryKey: queryKeys.calendar.eventTypes(restaurantId),
    queryFn: () => fetchEventTypes(restaurantId),
    enabled: !!restaurantId,
  })
}

/**
 * Hook to fetch events by provider
 */
export function useEventsByProvider(restaurantId: string, providerId: string) {
  return useQuery({
    queryKey: [...queryKeys.calendar.all, 'provider', restaurantId, providerId],
    queryFn: () => fetchEventsByProvider(restaurantId, providerId),
    enabled: !!restaurantId && !!providerId,
  })
}

/**
 * Hook to check event conflicts
 */
export function useEventConflicts(
  restaurantId: string,
  date: string,
  startTime: string,
  endTime: string
) {
  return useQuery({
    queryKey: [...queryKeys.calendar.all, 'conflicts', restaurantId, date, startTime, endTime],
    queryFn: () => checkEventConflicts(restaurantId, date, startTime, endTime),
    enabled: !!restaurantId && !!date && !!startTime && !!endTime,
  })
}

/**
 * Hook to create a calendar event
 * With offline support: queues mutation when offline and syncs later
 */
export function useCreateCalendarEvent() {
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: async (data: CreateEventInput) => {
      const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      
      try {
        const result = await createCalendarEvent(data)
        return result
      } catch (error) {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/626cdea4-d9db-4e9f-b37f-f410baa5330f', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: 'debug-session',
            runId: 'pre-fix',
            hypothesisId: 'H2',
            location: 'useCalendarQueries.ts:useCreateCalendarEvent',
            message: 'calendar_create_failed_queueing',
            data: {
              message: (error as any)?.message || 'Unknown error',
              status: (error as any)?.response?.status || null,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {})
        // #endregion
        // Queue for offline sync
        await syncManager.queueMutation({
          type: 'calendar.create',
          data,
          tempId,
        })
        
        // Return optimistic result with pending flag
        return {
          id: tempId,
          ...data,
          date: data.date,
          color: data.color || '#3B82F6',
          status: data.status || 'pending',
          restaurantId: data.restaurantId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          _pending: true,
        } as CalendarEvent & { _pending: boolean }
      }
    },
    onMutate: async (newEvent) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.calendar.all })
      
      // Snapshot previous value for rollback
      const previousEvents = queryClient.getQueryData(queryKeys.calendar.all)
      
      return { previousEvents }
    },
    onSuccess: (newEvent, variables, context) => {
      // Invalidate calendar queries to refetch
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all })
      
      const isPending = (newEvent as any)._pending
      
      if (isPending) {
        toast.info('Event saved offline', {
          description: `${variables.title} will sync when you're back online.`,
        })
      } else {
        toast.success('Event created', {
          description: `${newEvent.title} has been added to your calendar.`,
        })
      }
    },
    onError: (error: any, newEvent, context) => {
      // Rollback on error
      if (context?.previousEvents) {
        queryClient.setQueryData(queryKeys.calendar.all, context.previousEvents)
      }
      
      toast.error('Failed to create event', {
        description: error.response?.data?.message || error.message,
      })
    },
  })
}

/**
 * Hook to update a calendar event
 * With offline support: queues mutation when offline
 */
export function useUpdateCalendarEvent() {
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: async (data: UpdateEventInput) => {
      try {
        return await updateCalendarEvent(data)
      } catch (error) {
        // Queue for offline sync
        await syncManager.queueMutation({
          type: 'calendar.update',
          data,
        })
        
        // Return optimistic result
        return { ...data, _pending: true } as UpdateEventInput & { _pending: boolean }
      }
    },
    onMutate: async (updatedEvent) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.calendar.all })
      await queryClient.cancelQueries({ queryKey: queryKeys.calendar.event(updatedEvent.id) })
      
      const previousEvents = queryClient.getQueryData(queryKeys.calendar.all)
      const previousEvent = queryClient.getQueryData(queryKeys.calendar.event(updatedEvent.id))
      
      return { previousEvents, previousEvent }
    },
    onSuccess: (updatedEvent, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.event(variables.id) })
      
      const isPending = (updatedEvent as any)._pending
      
      if (isPending) {
        toast.info('Changes saved offline', {
          description: 'Will sync when you\'re back online.',
        })
      } else {
        toast.success('Event updated')
      }
    },
    onError: (error: any, _, context) => {
      if (context?.previousEvents) {
        queryClient.setQueryData(queryKeys.calendar.all, context.previousEvents)
      }
      if (context?.previousEvent) {
        queryClient.setQueryData(queryKeys.calendar.event((context.previousEvent as any).id), context.previousEvent)
      }
      
      toast.error('Failed to update event', {
        description: error.response?.data?.message || error.message,
      })
    },
  })
}

/**
 * Hook to delete a calendar event
 * With offline support: queues deletion when offline
 */
export function useDeleteCalendarEvent() {
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: async (id: string) => {
      try {
        return await deleteCalendarEvent(id)
      } catch (error) {
        // Queue for offline sync
        await syncManager.queueMutation({
          type: 'calendar.delete',
          data: { id },
        })
        
        return { deleted: true, _pending: true }
      }
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.calendar.all })
      
      const previousEvents = queryClient.getQueryData(queryKeys.calendar.all)
      
      return { previousEvents, deletedId: id }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all })
      
      const isPending = (result as any)?._pending
      
      if (isPending) {
        toast.info('Deletion saved offline', {
          description: 'Will sync when you\'re back online.',
        })
      } else {
        toast.success('Event deleted')
      }
    },
    onError: (error: any, _, context) => {
      if (context?.previousEvents) {
        queryClient.setQueryData(queryKeys.calendar.all, context.previousEvents)
      }
      
      toast.error('Failed to delete event', {
        description: error.response?.data?.message || error.message,
      })
    },
  })
}

/**
 * Hook to update event status
 */
export function useUpdateEventStatus() {
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'pending' | 'confirmed' | 'completed' | 'cancelled' }) =>
      updateEventStatus(id, status),
    onSuccess: (updatedEvent) => {
      // Update event cache
      queryClient.setQueryData(
        queryKeys.calendar.event(updatedEvent.id),
        updatedEvent
      )
      
      // Invalidate calendar queries
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all })
      
      toast.success('Status updated')
    },
    onError: (error: any) => {
      toast.error('Failed to update status', {
        description: error.response?.data?.message || error.message,
      })
    },
  })
}

/**
 * Hook to create a custom event type
 */
export function useCreateEventType() {
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: ({ restaurantId, data }: { restaurantId: string; data: { name: string; color: string; icon: string } }) =>
      createEventType(restaurantId, data),
    onSuccess: (_, variables) => {
      // Invalidate event types
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.eventTypes(variables.restaurantId) })
      
      toast.success('Event type created')
    },
    onError: (error: any) => {
      toast.error('Failed to create event type', {
        description: error.response?.data?.message || error.message,
      })
    },
  })
}

/**
 * Hook to update a custom event type
 */
export function useUpdateEventType() {
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; color?: string; icon?: string } }) =>
      updateEventType(id, data),
    onSuccess: () => {
      // Invalidate event types
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all })
      
      toast.success('Event type updated')
    },
    onError: (error: any) => {
      toast.error('Failed to update event type', {
        description: error.response?.data?.message || error.message,
      })
    },
  })
}

/**
 * Hook to delete a custom event type
 */
export function useDeleteEventType() {
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: (id: string) => deleteEventType(id),
    onSuccess: () => {
      // Invalidate event types
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all })
      
      toast.success('Event type deleted')
    },
    onError: (error: any) => {
      toast.error('Failed to delete event type', {
        description: error.response?.data?.message || error.message,
      })
    },
  })
}

/**
 * Hook to create recurring events
 */
export function useCreateRecurringEvents() {
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: (data: CreateEventInput) => createRecurringEvents(data),
    onSuccess: (result) => {
      // Invalidate calendar queries
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all })
      
      toast.success('Recurring events created', {
        description: `${result.created} events have been added to your calendar.`,
      })
    },
    onError: (error: any) => {
      toast.error('Failed to create recurring events', {
        description: error.response?.data?.message || error.message,
      })
    },
  })
}

/**
 * Hook to update a single occurrence of a recurring event
 */
export function useUpdateRecurringEventOccurrence() {
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: ({ id, occurrenceDate, data }: { id: string; occurrenceDate: string; data: Partial<CreateEventInput> }) =>
      updateRecurringEventOccurrence(id, occurrenceDate, data),
    onSuccess: () => {
      // Invalidate calendar queries
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all })
      
      toast.success('Event occurrence updated')
    },
    onError: (error: any) => {
      toast.error('Failed to update occurrence', {
        description: error.response?.data?.message || error.message,
      })
    },
  })
}

/**
 * Hook to delete future occurrences of a recurring event
 */
export function useDeleteRecurringEventFuture() {
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: ({ id, fromDate }: { id: string; fromDate: string }) =>
      deleteRecurringEventFuture(id, fromDate),
    onSuccess: () => {
      // Invalidate calendar queries
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all })
      
      toast.success('Future events deleted')
    },
    onError: (error: any) => {
      toast.error('Failed to delete future events', {
        description: error.response?.data?.message || error.message,
      })
    },
  })
}
