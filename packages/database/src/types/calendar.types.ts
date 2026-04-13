/**
 * Calendar System Type Definitions
 * 
 * Shared types for the calendar system with recurrence support
 */

// ============================================================================
// ENUMS
// ============================================================================

export const RecurrenceFrequencies = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
  CUSTOM: 'custom',
} as const

export type RecurrenceFrequency = typeof RecurrenceFrequencies[keyof typeof RecurrenceFrequencies]

export const RecurrenceEndTypes = {
  NEVER: 'never',
  AFTER_COUNT: 'after_count',
  ON_DATE: 'on_date',
} as const

export type RecurrenceEndType = typeof RecurrenceEndTypes[keyof typeof RecurrenceEndTypes]

export const CalendarEventStatuses = {
  PENDING: 'pending',
  APPROVED: 'approved',
  DISMISSED: 'dismissed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const

export type CalendarEventStatus = typeof CalendarEventStatuses[keyof typeof CalendarEventStatuses]

export const CalendarEventTypes = {
  DELIVERY: 'delivery',
  ORDER: 'order',
  MEETING: 'meeting',
  INVENTORY: 'inventory',
  TASTING: 'tasting',
  REMINDER: 'reminder',
  RECURRING: 'recurring',
  CUSTOM: 'custom',
  PROVIDER_BIRTHDAY: 'provider_birthday',
  HOLIDAY: 'holiday',
  DELIVERY_ETA: 'delivery_eta',
  PROVIDER_UNAVAILABLE: 'provider_unavailable',
  INVENTORY_COUNT: 'inventory_count',
  HIGH_VOLUME_EXPECTED: 'high_volume_expected',
} as const

export type CalendarEventType = typeof CalendarEventTypes[keyof typeof CalendarEventTypes]

export const CalendarEventSources = {
  MANUAL: 'manual',
  AI_DETECTED: 'ai_detected',
  SYSTEM_GENERATED: 'system_generated',
  ORDER: 'order',
  COMMUNICATIONS: 'communications',
} as const

export type CalendarEventSource = typeof CalendarEventSources[keyof typeof CalendarEventSources]

// ============================================================================
// DATABASE ROW TYPES
// ============================================================================

export interface CalendarEventRow {
  id: string
  restaurant_id: string
  provider_id: string | null
  order_id: string | null
  title: string
  description: string | null
  event_type: CalendarEventType
  event_date: string
  event_date_end: string | null
  all_day: boolean
  event_time: string | null
  source: CalendarEventSource
  ai_confidence: number | null
  detected_from_conversation_id: string | null
  status: CalendarEventStatus
  reminder_enabled: boolean
  reminder_days_before: number
  reminder_sent: boolean
  reminder_sent_at: string | null
  is_recurring: boolean
  recurrence_rule_id: string | null
  parent_event_id: string | null
  occurrence_date: string | null
  is_exception: boolean
  exception_type: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface RecurrenceRuleRow {
  id: string
  restaurant_id: string
  calendar_event_id: string
  frequency: RecurrenceFrequency
  interval_value: number
  days_of_week: number[] | null
  day_of_month: number | null
  week_of_month: number | null
  month_of_year: number | null
  end_type: RecurrenceEndType
  end_after_count: number | null
  end_on_date: string | null
  last_generated_date: string | null
  next_generation_date: string | null
  generation_horizon_days: number
  created_at: string
  updated_at: string
}

export interface RecurrenceExceptionRow {
  id: string
  recurrence_rule_id: string
  original_date: string
  exception_type: 'deleted' | 'modified'
  replacement_event_id: string | null
  created_at: string
}

// ============================================================================
// API TYPES
// ============================================================================

export interface RecurrenceRule {
  frequency: RecurrenceFrequency
  interval?: number
  daysOfWeek?: number[]
  dayOfMonth?: number
  weekOfMonth?: number
  monthOfYear?: number
  endType: RecurrenceEndType
  endAfterCount?: number
  endOnDate?: string
}

export interface CreateCalendarEventRequest {
  title: string
  description?: string
  eventType: CalendarEventType
  eventDate: string
  eventDateEnd?: string
  allDay?: boolean
  eventTime?: string
  providerId?: string
  orderId?: string
  source?: CalendarEventSource
  status?: CalendarEventStatus
  reminderEnabled?: boolean
  reminderDaysBefore?: number
  color?: string
  recurrence?: RecurrenceRule
}

export interface UpdateCalendarEventRequest {
  title?: string
  description?: string
  eventType?: CalendarEventType
  eventDate?: string
  eventDateEnd?: string
  allDay?: boolean
  eventTime?: string
  status?: CalendarEventStatus
  reminderEnabled?: boolean
  reminderDaysBefore?: number
  color?: string
  updateScope?: 'this' | 'this_and_future' | 'all'
}

export interface CalendarEventResponse {
  id: string
  restaurantId: string
  title: string
  description?: string
  eventType: CalendarEventType
  eventDate: string
  eventDateEnd?: string
  allDay: boolean
  eventTime?: string
  providerId?: string
  orderId?: string
  source: CalendarEventSource
  status: CalendarEventStatus
  reminderEnabled: boolean
  reminderDaysBefore: number
  reminderSent?: boolean
  color?: string
  isRecurring: boolean
  parentEventId?: string
  occurrenceDate?: string
  recurrenceRule?: RecurrenceRuleResponse
  createdAt: string
  updatedAt: string
}

export interface RecurrenceRuleResponse {
  id: string
  frequency: RecurrenceFrequency
  interval: number
  daysOfWeek?: number[]
  dayOfMonth?: number
  weekOfMonth?: number
  monthOfYear?: number
  endType: RecurrenceEndType
  endAfterCount?: number
  endOnDate?: string
  lastGeneratedDate?: string
  nextGenerationDate?: string
}

export interface CalendarEventsListResponse {
  events: CalendarEventResponse[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get the next occurrence date based on recurrence rule
 */
export function getNextOccurrence(
  currentDate: Date,
  rule: RecurrenceRule
): Date {
  const next = new Date(currentDate)
  const interval = rule.interval || 1

  switch (rule.frequency) {
    case 'daily':
      next.setDate(next.getDate() + interval)
      break
    case 'weekly':
      if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
        // Find next matching day of week
        do {
          next.setDate(next.getDate() + 1)
        } while (!rule.daysOfWeek.includes(next.getDay()))
      } else {
        next.setDate(next.getDate() + interval * 7)
      }
      break
    case 'monthly':
      next.setMonth(next.getMonth() + interval)
      if (rule.dayOfMonth) {
        next.setDate(rule.dayOfMonth)
      }
      break
    case 'yearly':
      next.setFullYear(next.getFullYear() + interval)
      break
  }

  return next
}

/**
 * Check if a date is within the recurrence rule's bounds
 */
export function isWithinRecurrenceBounds(
  date: Date,
  rule: RecurrenceRule
): boolean {
  if (rule.endType === 'never') {
    return true
  }

  if (rule.endType === 'on_date' && rule.endOnDate) {
    return date <= new Date(rule.endOnDate)
  }

  // For 'after_count', this needs to be checked against occurrence count
  return true
}
