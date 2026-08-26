/**
 * Reminder Scheduler Service
 * Handles scheduled calendar reminders using localStorage and periodic checks
 */

import { createNotification } from '../services/api/notifications'
import { useAuthStore, useNotificationStore } from '../stores'

const SCHEDULED_REMINDERS_KEY = 'wineops_scheduled_reminders'

export type ReminderType = '15min' | '1hour' | '1day' | '1week' | 'custom'

export interface ScheduledReminder {
  id: string
  eventId: string
  title: string
  eventType: string
  date: string // yyyy-mm-dd
  startTime?: string
  reminderType: ReminderType
  customMinutes?: number
  scheduledAt: number // Unix timestamp in ms
  createdAt: number
  status: 'pending' | 'sent' | 'failed'
  error?: string
}

function formatDateInput(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getReminderMinutes(reminderType: ReminderType, customMinutes?: number): number {
  switch (reminderType) {
    case '15min':
      return 15
    case '1hour':
      return 60
    case '1day':
      return 1440
    case '1week':
      return 10080
    case 'custom':
      return customMinutes || 15
    default:
      return 15
  }
}

function getEventDateTime(date: string, startTime?: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  const eventDate = new Date(year, month - 1, day)

  if (!startTime) {
    eventDate.setHours(9, 0, 0, 0)
    return eventDate
  }

  const [hours, minutes] = startTime.split(':').map(Number)
  eventDate.setHours(hours, minutes, 0, 0)
  return eventDate
}

/**
 * Get all scheduled reminders
 */
export function getScheduledReminders(): ScheduledReminder[] {
  try {
    const stored = localStorage.getItem(SCHEDULED_REMINDERS_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

/**
 * Save scheduled reminders
 */
function saveScheduledReminders(reminders: ScheduledReminder[]): void {
  localStorage.setItem(SCHEDULED_REMINDERS_KEY, JSON.stringify(reminders))
}

/** Exact minute counts that map onto a named reminder type. */
const NAMED_REMINDER_MINUTES: Array<[number, ReminderType]> = [
  [15, '15min'],
  [60, '1hour'],
  [1440, '1day'],
  [10080, '1week'],
]

/**
 * Translate an arbitrary "minutes before" value (what the calendar's reminder UI
 * collects) into the `reminderType` / `customMinutes` pair `scheduleReminder`
 * takes. Named presets keep their label; anything else becomes a custom offset.
 */
export function reminderTypeForMinutes(minutesBefore: number): {
  reminderType: ReminderType
  customMinutes?: number
} {
  const named = NAMED_REMINDER_MINUTES.find(([minutes]) => minutes === minutesBefore)
  if (named) return { reminderType: named[1] }
  return { reminderType: 'custom', customMinutes: minutesBefore }
}

/**
 * Drop every not-yet-sent reminder for an event. Called before re-scheduling an
 * edited event and when an event is deleted, so a reminder never fires for a
 * time (or an event) that no longer exists.
 *
 * Returns the number of reminders removed.
 */
export function cancelRemindersForEvent(eventId: string): number {
  const reminders = getScheduledReminders()
  const kept = reminders.filter(
    (reminder) => !(reminder.eventId === eventId && reminder.status === 'pending')
  )
  const removed = reminders.length - kept.length
  if (removed > 0) {
    saveScheduledReminders(kept)
  }
  return removed
}

/**
 * Schedule a reminder for a calendar event
 */
export function scheduleReminder(input: {
  eventId: string
  title: string
  eventType: string
  date: Date
  startTime?: string
  reminderType: ReminderType
  customMinutes?: number
}): ScheduledReminder {
  const eventDate = formatDateInput(input.date)
  const reminderMinutes = getReminderMinutes(input.reminderType, input.customMinutes)
  const eventDateTime = getEventDateTime(eventDate, input.startTime)
  const scheduledAt = eventDateTime.getTime() - reminderMinutes * 60 * 1000

  const reminder: ScheduledReminder = {
    id: `reminder_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    eventId: input.eventId,
    title: input.title,
    eventType: input.eventType,
    date: eventDate,
    startTime: input.startTime,
    reminderType: input.reminderType,
    customMinutes: input.customMinutes,
    scheduledAt,
    createdAt: Date.now(),
    status: 'pending',
  }

  const reminders = getScheduledReminders()
  reminders.push(reminder)
  saveScheduledReminders(reminders)

  return reminder
}

/**
 * Send reminder notification via API + browser notification
 */
async function sendReminderNotification(reminder: ScheduledReminder): Promise<boolean> {
  const { user, activeRestaurantId } = useAuthStore.getState()
  const notificationStore = useNotificationStore.getState()

  const message = reminder.startTime
    ? `${reminder.title} starts at ${reminder.startTime}`
    : `${reminder.title} is coming up today`

  // Browser notification (if permitted)
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => undefined)
  }
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(`Reminder: ${reminder.title}`, {
      body: message,
      icon: '/wine-icon.png',
    })
  }

  if (!user?.userId || !activeRestaurantId) {
    // Fallback to local unread count
    notificationStore.incrementUnreadCount()
    return false
  }

  try {
    await createNotification({
      userId: user.userId,
      restaurantId: activeRestaurantId,
      type: 'calendar_reminder',
      title: reminder.title,
      message,
      priority: 'medium',
      actionUrl: '/calendar',
      actionLabel: 'View Calendar',
      metadata: {
        eventId: reminder.eventId,
        eventType: reminder.eventType,
        reminderType: reminder.reminderType,
      },
    })

    return true
  } catch (error) {
    // API failed, use local unread count as fallback
    notificationStore.incrementUnreadCount()
    console.error('Failed to create reminder notification:', error)
    return false
  }
}

/**
 * Check and send due reminders
 */
export async function checkAndSendDueReminders(): Promise<void> {
  const reminders = getScheduledReminders()
  const now = Date.now()
  let updated = false

  for (const reminder of reminders) {
    if (reminder.status === 'pending' && reminder.scheduledAt <= now) {
      const success = await sendReminderNotification(reminder)
      reminder.status = success ? 'sent' : 'failed'
      if (!success) {
        reminder.error = 'Failed to send reminder notification'
      }
      updated = true
    }
  }

  if (updated) {
    saveScheduledReminders(reminders)
  }
}

/**
 * Start the reminder scheduler (call this on app init)
 */
let schedulerInterval: ReturnType<typeof setInterval> | null = null

export function startReminderScheduler(): void {
  if (schedulerInterval) return

  schedulerInterval = setInterval(() => {
    checkAndSendDueReminders()
  }, 60 * 1000) // Check every minute

  // Initial check
  checkAndSendDueReminders()
}

export function stopReminderScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
  }
}
