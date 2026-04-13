/**
 * Recurring Event Expansion Utility
 *
 * Expands a recurrence rule into individual virtual occurrences within a date range.
 * Follows the Google Calendar pattern:
 *   - The original event is the template
 *   - Virtual occurrences are generated for display
 *   - Each virtual occurrence has isVirtualOccurrence = true
 *
 * Supported frequencies: daily, weekly, monthly
 */

export interface RecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'custom' | string
  interval: number
  daysOfWeek?: number[]   // 0-6 (Sun-Sat), for weekly frequency
  dayOfMonth?: number     // 1-31, for monthly frequency
  endType: 'never' | 'on_date' | 'after_count' | 'on' | 'after' | string
  endOnDate?: string      // ISO date string
  endAfterCount?: number  // Total number of occurrences
  endDate?: string        // Alias for endOnDate
  endCount?: number       // Alias for endAfterCount
}

export interface RecurringEvent {
  id: string
  title: string
  date: string | Date       // Start date (ISO string or Date)
  startTime?: string
  endTime?: string
  allDay?: boolean
  color?: string
  type?: string
  description?: string
  status?: string
  providerId?: string
  provider?: string
  restaurantId?: string
  createdAt?: string
  updatedAt?: string
  // Recurrence-specific
  isRecurring?: boolean
  recurrenceRule?: RecurrenceRule
  recurring?: {
    enabled: boolean
    frequency: string
    interval: number
    daysOfWeek?: number[]
    dayOfMonth?: number
    endType: string
    endDate?: string
    endCount?: number
  }
  [key: string]: unknown    // Allow pass-through of other fields
}

export interface ExpandedOccurrence extends RecurringEvent {
  /** Marks this as a virtual occurrence, not a real DB record */
  isVirtualOccurrence: true
  /** Points back to the original recurring event */
  parentEventId: string
  /** The specific date of this occurrence (ISO string) */
  occurrenceDate: string
  /** Unique ID for this occurrence: `{parentId}__occ_{YYYY-MM-DD}` */
  id: string
}

/**
 * Normalize a date to midnight UTC to avoid timezone drift.
 */
function toDateOnly(d: Date | string): Date {
  const date = typeof d === 'string' ? new Date(d) : new Date(d)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function toISODateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Expand a recurring event into individual occurrences within [rangeStart, rangeEnd].
 *
 * @param event     The original recurring event (with recurrenceRule or recurring config)
 * @param rangeStart  Start of the visible date range (inclusive)
 * @param rangeEnd    End of the visible date range (inclusive)
 * @param maxOccurrences Safety cap (default 200)
 * @returns Array of expanded occurrences (may be empty if rule doesn't produce any in range)
 */
export function expandRecurringEvent(
  event: RecurringEvent,
  rangeStart: Date | string,
  rangeEnd: Date | string,
  maxOccurrences = 200,
): ExpandedOccurrence[] {
  // Determine recurrence rule from either field
  const rule: RecurrenceRule | undefined =
    event.recurrenceRule ??
    (event.recurring?.enabled
      ? {
          frequency: event.recurring.frequency,
          interval: event.recurring.interval,
          daysOfWeek: event.recurring.daysOfWeek,
          dayOfMonth: event.recurring.dayOfMonth,
          endType: event.recurring.endType,
          endDate: event.recurring.endDate,
          endAfterCount: event.recurring.endCount,
        }
      : undefined)

  if (!rule) return []

  const rStart = toDateOnly(rangeStart)
  const rEnd = toDateOnly(rangeEnd)
  const eventStart = toDateOnly(event.date)

  const frequency = rule.frequency
  const interval = Math.max(1, rule.interval || 1)
  const daysOfWeek = rule.daysOfWeek ?? []
  const dayOfMonth = rule.dayOfMonth

  // Determine end condition
  const endType = rule.endType
  const endDate = rule.endOnDate ?? rule.endDate
  const endAfterCount = rule.endAfterCount ?? rule.endCount
  const ruleEndDate = endDate ? toDateOnly(endDate) : null

  const occurrences: ExpandedOccurrence[] = []
  let totalGenerated = 0

  // Generate candidate dates starting from the event's start date
  const cursor = new Date(eventStart)

  // Safety: don't generate more than maxOccurrences total
  let iterations = 0
  const MAX_ITERATIONS = 1000

  while (iterations < MAX_ITERATIONS) {
    iterations++

    // Check if we've passed the range end
    if (cursor > rEnd) break

    // Check rule end conditions
    if (ruleEndDate && cursor > ruleEndDate) break
    if (endType === 'after_count' || endType === 'after') {
      if (endAfterCount && totalGenerated >= endAfterCount) break
    }

    // Check if this date qualifies
    let qualifies = false

    if (frequency === 'daily') {
      qualifies = true
    } else if (frequency === 'weekly') {
      if (daysOfWeek.length > 0) {
        qualifies = daysOfWeek.includes(cursor.getDay())
      } else {
        // Same day of week as start date
        qualifies = cursor.getDay() === eventStart.getDay()
      }
    } else if (frequency === 'monthly') {
      if (dayOfMonth) {
        qualifies = cursor.getDate() === dayOfMonth
      } else {
        qualifies = cursor.getDate() === eventStart.getDate()
      }
    } else {
      // Custom or unknown - treat as daily
      qualifies = true
    }

    if (qualifies) {
      totalGenerated++

      // Only add if within the visible range
      if (cursor >= rStart && cursor <= rEnd) {
        const occDate = toISODateString(cursor)
        occurrences.push({
          ...event,
          id: `${event.id}__occ_${occDate}`,
          date: occDate,
          isVirtualOccurrence: true,
          parentEventId: event.id,
          occurrenceDate: occDate,
        })
      }

      if (occurrences.length >= maxOccurrences) break
    }

    // Advance cursor
    if (frequency === 'daily') {
      cursor.setDate(cursor.getDate() + interval)
    } else if (frequency === 'weekly') {
      if (daysOfWeek.length > 0) {
        // Move to next day, but skip to next week's first qualifying day after we've checked all days in this week
        cursor.setDate(cursor.getDate() + 1)
        // If we've wrapped past the last qualifying day, skip to the next interval week
        if (cursor.getDay() === 0 && interval > 1) {
          // We've hit Sunday - check if we need to skip weeks
          const lastQualifyingDay = Math.max(...daysOfWeek)
          const prevDay = new Date(cursor)
          prevDay.setDate(prevDay.getDate() - 1)
          if (prevDay.getDay() >= lastQualifyingDay) {
            cursor.setDate(cursor.getDate() + (interval - 1) * 7)
          }
        }
      } else {
        cursor.setDate(cursor.getDate() + interval * 7)
      }
    } else if (frequency === 'monthly') {
      cursor.setMonth(cursor.getMonth() + interval)
    } else {
      cursor.setDate(cursor.getDate() + interval)
    }
  }

  return occurrences
}

/**
 * Expand all recurring events in a list into individual occurrences.
 * Non-recurring events are passed through unchanged.
 */
export function expandAllRecurringEvents<T extends RecurringEvent>(
  events: T[],
  rangeStart: Date | string,
  rangeEnd: Date | string,
): (T | ExpandedOccurrence)[] {
  const result: (T | ExpandedOccurrence)[] = []

  for (const event of events) {
    const isRecurring =
      event.isRecurring ||
      event.recurring?.enabled ||
      !!event.recurrenceRule

    if (isRecurring) {
      const expanded = expandRecurringEvent(event, rangeStart, rangeEnd)
      if (expanded.length > 0) {
        result.push(...(expanded as ExpandedOccurrence[]))
      } else {
        // If no occurrences in range, still include the original if its date is in range
        const eventDate = toDateOnly(event.date)
        if (eventDate >= toDateOnly(rangeStart) && eventDate <= toDateOnly(rangeEnd)) {
          result.push(event)
        }
      }
    } else {
      result.push(event)
    }
  }

  return result
}
