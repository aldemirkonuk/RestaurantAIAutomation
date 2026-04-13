/**
 * Event Notifications Utility
 * 
 * Handles checking calendar events and creating notifications based on reminder settings
 */

export type ReminderTime = '15min' | '1hour' | '1day' | '1week' | 'custom'

export interface CalendarEvent {
  id: string
  title: string
  type: string
  date: Date
  startTime?: string
  endTime?: string
  allDay?: boolean
  description?: string
  location?: string
  attendees?: string[]
  reminders?: ReminderTime[]
  customReminderMinutes?: number
  [key: string]: any
}

export interface EventNotification {
  id: string
  eventId: string
  eventTitle: string
  eventType: string
  eventDate: Date
  reminderType: ReminderTime
  message: string
  createdAt: Date
  status: 'unread' | 'read'
  priority: 'high' | 'normal' | 'low'
}

/**
 * Convert reminder time to minutes
 */
export function reminderTimeToMinutes(reminder: ReminderTime, customMinutes?: number): number {
  switch (reminder) {
    case '15min':
      return 15
    case '1hour':
      return 60
    case '1day':
      return 24 * 60
    case '1week':
      return 7 * 24 * 60
    case 'custom':
      return customMinutes || 60 // Default to 1 hour if custom not specified
    default:
      return 60
  }
}

/**
 * Calculate event datetime from date and time strings
 */
export function getEventDateTime(event: CalendarEvent): Date {
  const eventDate = new Date(event.date)
  
  if (event.allDay || !event.startTime) {
    // For all-day events, use 9:00 AM
    eventDate.setHours(9, 0, 0, 0)
    return eventDate
  }

  // Parse time string (HH:MM format)
  const [hours, minutes] = event.startTime.split(':').map(Number)
  eventDate.setHours(hours, minutes, 0, 0)
  
  return eventDate
}

/**
 * Check if reminder should trigger for an event
 */
export function shouldTriggerReminder(
  event: CalendarEvent,
  reminder: ReminderTime,
  now: Date = new Date()
): boolean {
  const eventDateTime = getEventDateTime(event)
  const reminderMinutes = reminderTimeToMinutes(reminder, event.customReminderMinutes)
  const reminderTime = new Date(eventDateTime.getTime() - reminderMinutes * 60 * 1000)

  // Trigger if:
  // 1. Current time is past the reminder time
  // 2. Current time is before the event
  // 3. Within a 2-minute window (to avoid missing notifications)
  const timeSinceReminder = now.getTime() - reminderTime.getTime()
  const isAfterReminderTime = timeSinceReminder >= 0
  const isWithinWindow = timeSinceReminder <= 2 * 60 * 1000 // 2-minute window
  const isBeforeEvent = now.getTime() < eventDateTime.getTime()

  return isAfterReminderTime && isWithinWindow && isBeforeEvent
}

/**
 * Create notification message for event reminder
 */
export function createReminderMessage(event: CalendarEvent, reminder: ReminderTime): string {
  const eventDateTime = getEventDateTime(event)
  const reminderMinutes = reminderTimeToMinutes(reminder, event.customReminderMinutes)

  let timeText = ''
  if (reminderMinutes < 60) {
    timeText = `${reminderMinutes} minutes`
  } else if (reminderMinutes < 24 * 60) {
    timeText = `${Math.floor(reminderMinutes / 60)} hour${Math.floor(reminderMinutes / 60) > 1 ? 's' : ''}`
  } else {
    timeText = `${Math.floor(reminderMinutes / (24 * 60))} day${Math.floor(reminderMinutes / (24 * 60)) > 1 ? 's' : ''}`
  }

  const eventTimeStr = event.allDay
    ? 'All Day'
    : eventDateTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  return `${event.title} is coming up in ${timeText} (${eventTimeStr})`
}

/**
 * Get priority for notification based on reminder time
 */
export function getNotificationPriority(reminder: ReminderTime): 'high' | 'normal' | 'low' {
  switch (reminder) {
    case '15min':
      return 'high'
    case '1hour':
      return 'high'
    case '1day':
      return 'normal'
    case '1week':
      return 'low'
    default:
      return 'normal'
  }
}

/**
 * Create notification from event and reminder
 */
export function createEventNotification(
  event: CalendarEvent,
  reminder: ReminderTime
): EventNotification {
  return {
    id: `notif-${event.id}-${reminder}-${Date.now()}`,
    eventId: event.id,
    eventTitle: event.title,
    eventType: event.type,
    eventDate: getEventDateTime(event),
    reminderType: reminder,
    message: createReminderMessage(event, reminder),
    createdAt: new Date(),
    status: 'unread',
    priority: getNotificationPriority(reminder),
  }
}

/**
 * Get all notifications that should be triggered for given events
 * 
 * @param events - Array of calendar events to check
 * @param existingNotifications - Array of existing notification IDs to avoid duplicates
 * @param now - Current time (defaults to now, useful for testing)
 * @returns Array of notifications to create
 */
export function getUpcomingEventNotifications(
  events: CalendarEvent[],
  existingNotifications: string[] = [],
  now: Date = new Date()
): EventNotification[] {
  const notifications: EventNotification[] = []

  for (const event of events) {
    // Skip events without reminders
    if (!event.reminders || event.reminders.length === 0) {
      continue
    }

    // Skip past events
    const eventDateTime = getEventDateTime(event)
    if (eventDateTime.getTime() < now.getTime()) {
      continue
    }

    // Check each reminder for the event
    for (const reminder of event.reminders) {
      // Create unique ID for this notification
      const notifId = `notif-${event.id}-${reminder}`
      
      // Skip if notification already exists
      if (existingNotifications.includes(notifId)) {
        continue
      }

      // Check if reminder should trigger
      if (shouldTriggerReminder(event, reminder, now)) {
        const notification = createEventNotification(event, reminder)
        // Override ID to be consistent
        notification.id = notifId
        notifications.push(notification)
      }
    }
  }

  return notifications
}

/**
 * Format time until event for display
 */
export function formatTimeUntilEvent(eventDate: Date, now: Date = new Date()): string {
  const diff = eventDate.getTime() - now.getTime()
  
  if (diff < 0) {
    return 'Past event'
  }

  const minutes = Math.floor(diff / (60 * 1000))
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    return `in ${days} day${days > 1 ? 's' : ''}`
  }
  if (hours > 0) {
    return `in ${hours} hour${hours > 1 ? 's' : ''}`
  }
  return `in ${minutes} minute${minutes > 1 ? 's' : ''}`
}

/**
 * Check if event is happening soon (within next hour)
 */
export function isEventSoon(event: CalendarEvent, now: Date = new Date()): boolean {
  const eventDateTime = getEventDateTime(event)
  const diff = eventDateTime.getTime() - now.getTime()
  return diff > 0 && diff <= 60 * 60 * 1000 // Within next hour
}

/**
 * Check if event is today
 */
export function isEventToday(event: CalendarEvent, now: Date = new Date()): boolean {
  const eventDate = new Date(event.date)
  return (
    eventDate.getDate() === now.getDate() &&
    eventDate.getMonth() === now.getMonth() &&
    eventDate.getFullYear() === now.getFullYear()
  )
}

