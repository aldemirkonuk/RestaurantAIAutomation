import { apiClient } from './client'
import type { CalendarFilters } from '../../lib/query-keys'

export type EventType = 'delivery' | 'order' | 'meeting' | 'inventory' | 'tasting' | 'reminder' | 'recurring' | 'custom'
export type ReminderTime = '15min' | '1hour' | '1day' | '1week' | 'custom'

export interface RecurringConfig {
  enabled: boolean
  frequency: 'daily' | 'weekly' | 'monthly' | 'custom'
  interval: number // Every X days/weeks/months
  daysOfWeek?: number[] // 0-6 (Sunday-Saturday) for weekly
  dayOfMonth?: number // 1-31 for monthly
  endType: 'never' | 'on' | 'after'
  endDate?: string
  endCount?: number // Number of occurrences
}

interface ApiCalendarEvent {
  id: string
  restaurantId: string
  title: string
  description?: string
  eventType: EventType
  eventDate: string
  eventDateEnd?: string
  allDay: boolean
  eventTime?: string
  providerId?: string
  orderId?: string
  source: string
  status: 'pending' | 'approved' | 'dismissed' | 'completed' | 'cancelled'
  eventTimeEnd?: string
  reminderEnabled: boolean
  reminderDaysBefore: number
  reminderSent?: boolean
  color?: string
  isRecurring: boolean
  parentEventId?: string
  occurrenceDate?: string
  recurrenceRule?: {
    id: string
    frequency: string
    interval: number
    daysOfWeek?: number[]
    dayOfMonth?: number
    weekOfMonth?: number
    monthOfYear?: number
    endType: string
    endAfterCount?: number
    endOnDate?: string
  }
  createdAt: string
  updatedAt: string
}

interface CalendarEventsListResponse {
  events: ApiCalendarEvent[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

const mapApiEvent = (event: ApiCalendarEvent): CalendarEvent => ({
  id: event.id,
  title: event.title,
  type: event.eventType,
  date: event.eventDate,
  startTime: event.eventTime,
  allDay: event.allDay,
  description: event.description,
  color: event.color || '#3B82F6',
  status: event.status,
  providerId: event.providerId,
  restaurantId: event.restaurantId,
  createdAt: event.createdAt,
  updatedAt: event.updatedAt,
  // Pass through recurrence fields for frontend expansion
  isRecurring: event.isRecurring,
  parentEventId: event.parentEventId,
  recurrenceRule: event.recurrenceRule,
})

const mapRecurrenceToApi = (recurring?: RecurringConfig) => {
  if (!recurring) return undefined

  const endType =
    recurring.endType === 'after'
      ? 'after_count'
      : recurring.endType === 'on'
      ? 'on_date'
      : 'never'

  return {
    frequency: recurring.frequency,
    interval: recurring.interval,
    daysOfWeek: recurring.daysOfWeek,
    dayOfMonth: recurring.dayOfMonth,
    endType,
    endAfterCount: recurring.endCount,
    endOnDate: recurring.endDate,
  }
}

const buildCreatePayload = (data: CreateEventInput | (CreateEventInput & { eventType?: EventType; eventDate?: string })) => ({
  title: data.title,
  description: data.description,
  eventType: data.type ?? (data as any).eventType,
  eventDate: data.date ?? (data as any).eventDate,
  allDay: data.allDay,
  eventTime: data.allDay ? undefined : data.startTime,
  eventDateEnd: data.allDay ? undefined : (data as any).endDate,
  eventTimeEnd: data.allDay ? undefined : data.endTime,
  providerId: data.providerId,
  orderId: data.orderId,
  status: data.status,
  reminderEnabled: data.reminderEnabled,
  reminderDaysBefore: data.reminderDaysBefore,
  color: data.color,
  recurrence: data.recurring?.enabled ? mapRecurrenceToApi(data.recurring) : undefined,
})

export interface CalendarEvent {
  id: string
  title: string
  type: EventType
  date: string
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
  status?: 'pending' | 'approved' | 'dismissed' | 'completed' | 'cancelled'
  recurring?: RecurringConfig
  reminders?: ReminderTime[]
  customReminderMinutes?: number
  restaurantId: string
  createdBy?: string
  createdAt?: string
  updatedAt?: string
  // Recurrence fields for frontend expansion
  isRecurring?: boolean
  parentEventId?: string
  recurrenceRule?: {
    id: string
    frequency: string
    interval: number
    daysOfWeek?: number[]
    dayOfMonth?: number
    weekOfMonth?: number
    monthOfYear?: number
    endType: string
    endAfterCount?: number
    endOnDate?: string
  }
  // Virtual occurrence markers (set by frontend expansion)
  isVirtualOccurrence?: boolean
  occurrenceDate?: string
}

export interface EventType {
  id: string
  name: string
  color: string
  icon: string
  isCustom: boolean
  restaurantId?: string
}

export interface CreateEventInput {
  title: string
  type: EventType
  date: string
  startTime?: string
  endTime?: string
  allDay?: boolean
  description?: string
  location?: string
  attendees?: string[]
  color?: string
  provider?: string
  providerId?: string
  orderId?: string
  wineCount?: number
  totalValue?: number
  status?: 'pending' | 'approved' | 'dismissed' | 'completed' | 'cancelled'
  reminderEnabled?: boolean
  reminderDaysBefore?: number
  recurring?: RecurringConfig
  reminders?: ReminderTime[]
  customReminderMinutes?: number
  restaurantId: string
}

export interface UpdateEventInput extends Partial<CreateEventInput> {
  id: string
}

/**
 * Fetch calendar events for a restaurant within a date range
 */
export async function fetchCalendarEvents(
  _restaurantId: string,
  filters: CalendarFilters
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams()
  params.append('startDate', filters.startDate)
  params.append('endDate', filters.endDate)
  
  if (filters.eventType) {
    params.append('eventType', filters.eventType)
  }
  
  const response = await apiClient.get<CalendarEventsListResponse>(`/calendar/events?${params.toString()}`)
  return response.data.events.map(mapApiEvent)
}

/**
 * Fetch a single calendar event by ID
 */
export async function fetchCalendarEventById(id: string): Promise<CalendarEvent> {
  const response = await apiClient.get<ApiCalendarEvent>(`/calendar/events/${id}`)
  return mapApiEvent(response.data)
}

/**
 * Create a new calendar event
 */
export async function createCalendarEvent(data: CreateEventInput): Promise<CalendarEvent> {
  const response = await apiClient.post<ApiCalendarEvent>('/calendar/events', buildCreatePayload(data))
  return mapApiEvent(response.data)
}

/**
 * Update an existing calendar event
 */
export async function updateCalendarEvent(data: UpdateEventInput): Promise<CalendarEvent> {
  const { id, ...updateData } = data
  const payload: Record<string, unknown> = {}
  if (updateData.title !== undefined) payload.title = updateData.title
  if (updateData.description !== undefined) payload.description = updateData.description
  if (updateData.type !== undefined) payload.eventType = updateData.type
  if (updateData.date !== undefined) payload.eventDate = updateData.date
  if (updateData.allDay !== undefined) payload.allDay = updateData.allDay
  if (updateData.startTime !== undefined) payload.eventTime = updateData.startTime
  if (updateData.endTime !== undefined) {
    payload.eventDateEnd = updateData.allDay ? undefined : (updateData as any).endDate
    payload.eventTimeEnd = updateData.allDay ? undefined : updateData.endTime
  }
  if (updateData.providerId !== undefined) payload.providerId = updateData.providerId
  if (updateData.orderId !== undefined) payload.orderId = updateData.orderId
  if (updateData.status !== undefined) payload.status = updateData.status
  if (updateData.reminderEnabled !== undefined) payload.reminderEnabled = updateData.reminderEnabled
  if (updateData.reminderDaysBefore !== undefined) payload.reminderDaysBefore = updateData.reminderDaysBefore
  if (updateData.color !== undefined) payload.color = updateData.color
  if (updateData.recurring?.enabled) payload.recurrence = mapRecurrenceToApi(updateData.recurring)

  const response = await apiClient.patch<ApiCalendarEvent>(`/calendar/events/${id}`, payload)
  return mapApiEvent(response.data)
}

/**
 * Delete a calendar event
 */
export async function deleteCalendarEvent(id: string): Promise<void> {
  await apiClient.delete(`/calendar/events/${id}`)
}

/**
 * Fetch upcoming events for a restaurant
 */
export async function fetchUpcomingEvents(
  _restaurantId: string,
  days: number = 7
): Promise<CalendarEvent[]> {
  const response = await apiClient.get<CalendarEventsListResponse>(
    `/calendar/upcoming?days=${days}`
  )
  return response.data.events.map(mapApiEvent)
}

/**
 * Fetch event types for a restaurant (including custom types)
 */
export async function fetchEventTypes(restaurantId: string): Promise<EventType[]> {
  const response = await apiClient.get<EventType[]>(
    `/calendar/event-types/${restaurantId}`
  )
  return response.data
}

/**
 * Create a custom event type
 */
export async function createEventType(
  restaurantId: string,
  data: { name: string; color: string; icon: string }
): Promise<EventType> {
  const response = await apiClient.post<EventType>('/calendar/event-types', {
    ...data,
    restaurantId,
  })
  return response.data
}

/**
 * Update a custom event type
 */
export async function updateEventType(
  id: string,
  data: { name?: string; color?: string; icon?: string }
): Promise<EventType> {
  const response = await apiClient.patch<EventType>(`/calendar/event-types/${id}`, data)
  return response.data
}

/**
 * Delete a custom event type
 */
export async function deleteEventType(id: string): Promise<void> {
  await apiClient.delete(`/calendar/event-types/${id}`)
}

/**
 * Update event status
 */
export async function updateEventStatus(
  id: string,
  status: 'pending' | 'approved' | 'dismissed' | 'completed' | 'cancelled'
): Promise<CalendarEvent> {
  const response = await apiClient.patch<CalendarEvent>(`/calendar/events/${id}/status`, {
    status,
  })
  return response.data
}

/**
 * Get events by provider
 */
export async function fetchEventsByProvider(
  restaurantId: string,
  providerId: string
): Promise<CalendarEvent[]> {
  const response = await apiClient.get<CalendarEvent[]>(
    `/calendar/events/provider/${providerId}?restaurantId=${restaurantId}`
  )
  return response.data
}

/**
 * Bulk create recurring events
 */
export async function createRecurringEvents(
  data: CreateEventInput
): Promise<{ created: number; events: CalendarEvent[] }> {
  const response = await apiClient.post<{ created: number; events: ApiCalendarEvent[] }>(
    '/calendar/events/recurring',
    buildCreatePayload(data)
  )
  return {
    created: response.data.created,
    events: response.data.events.map(mapApiEvent),
  }
}

/**
 * Update a single occurrence of a recurring event
 */
export async function updateRecurringEventOccurrence(
  id: string,
  occurrenceDate: string,
  data: Partial<CreateEventInput>
): Promise<CalendarEvent> {
  const response = await apiClient.patch<ApiCalendarEvent>(
    `/calendar/events/${id}/occurrence`,
    {
      occurrenceDate,
      ...buildCreatePayload(data as CreateEventInput),
    }
  )
  return mapApiEvent(response.data)
}

/**
 * Delete all future occurrences of a recurring event
 */
export async function deleteRecurringEventFuture(
  id: string,
  fromDate: string
): Promise<void> {
  await apiClient.delete(`/calendar/events/${id}/recurring?fromDate=${fromDate}`)
}

/**
 * Get event conflicts for a time slot
 */
export async function checkEventConflicts(
  restaurantId: string,
  date: string,
  startTime: string,
  endTime: string
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams()
  params.append('restaurantId', restaurantId)
  params.append('date', date)
  params.append('startTime', startTime)
  params.append('endTime', endTime)
  
  const response = await apiClient.get<CalendarEvent[]>(
    `/calendar/events/conflicts?${params.toString()}`
  )
  return response.data
}
