import { apiClient } from './client'
import type { NotificationFilters } from '../../lib/query-keys'

export type NotificationType = 
  | 'inventory_low_stock'
  | 'order_pending'
  | 'order_delivered'
  | 'price_change'
  | 'delivery_scheduled'
  | 'calendar_reminder'
  | 'system'
  | 'ai_suggestion'

export interface Notification {
  id: string
  userId: string
  restaurantId: string
  type: NotificationType
  title: string
  message: string
  status: 'read' | 'unread'
  priority: 'low' | 'medium' | 'high' | 'critical'
  actionUrl?: string
  actionLabel?: string
  metadata?: Record<string, any>
  timestamp: string
  readAt?: string
  createdAt: string
}

export interface NotificationPreferences {
  userId: string
  email: boolean
  push: boolean
  sms: boolean
  categories: {
    inventory: boolean
    orders: boolean
    calendar: boolean
    system: boolean
    ai: boolean
  }
  quietHours?: {
    enabled: boolean
    startTime: string // HH:mm format
    endTime: string
  }
  updatedAt?: string
}

export interface CreateNotificationInput {
  userId: string
  restaurantId: string
  type: NotificationType
  title: string
  message: string
  priority?: 'low' | 'medium' | 'high' | 'critical'
  actionUrl?: string
  actionLabel?: string
  metadata?: Record<string, any>
}

/**
 * Fetch notifications for a user
 */
export async function fetchNotifications(
  userId: string,
  filters?: NotificationFilters
): Promise<Notification[]> {
  const params = new URLSearchParams()
  params.append('userId', userId)
  
  if (filters?.type) {
    params.append('type', filters.type)
  }
  if (filters?.status) {
    params.append('status', filters.status)
  }
  if (filters?.dateFrom) {
    params.append('dateFrom', filters.dateFrom)
  }
  if (filters?.dateTo) {
    params.append('dateTo', filters.dateTo)
  }
  
  const response = await apiClient.get<Notification[]>(`/notifications?${params.toString()}`)
  return response.data
}

/**
 * Fetch unread notifications for a user
 */
export async function fetchUnreadNotifications(userId: string): Promise<Notification[]> {
  const response = await apiClient.get<Notification[]>(
    `/notifications/unread?userId=${userId}`
  )
  return response.data
}

/**
 * Get unread notification count
 */
export async function fetchUnreadCount(userId: string): Promise<number> {
  const response = await apiClient.get<{ count: number }>(
    `/notifications/unread/count?userId=${userId}`
  )
  return response.data.count
}

/**
 * Mark a notification as read
 */
export async function markNotificationAsRead(id: string): Promise<Notification> {
  const response = await apiClient.patch<Notification>(`/notifications/${id}/read`)
  return response.data
}

/**
 * Mark multiple notifications as read
 */
export async function markNotificationsAsRead(ids: string[]): Promise<void> {
  await apiClient.patch('/notifications/read/bulk', { ids })
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllNotificationsAsRead(userId: string): Promise<void> {
  await apiClient.patch(`/notifications/read/all?userId=${userId}`)
}

/**
 * Archive a notification
 */
export async function archiveNotification(id: string): Promise<Notification> {
  const response = await apiClient.patch<Notification>(`/notifications/${id}/archive`)
  return response.data
}

/**
 * Delete a notification
 */
export async function deleteNotification(id: string): Promise<void> {
  await apiClient.delete(`/notifications/${id}`)
}

/**
 * Delete multiple notifications
 */
export async function deleteNotifications(ids: string[]): Promise<void> {
  await apiClient.delete('/notifications/bulk', { data: { ids } })
}

/**
 * Delete all read notifications for a user
 */
export async function deleteAllReadNotifications(userId: string): Promise<void> {
  await apiClient.delete(`/notifications/read/all?userId=${userId}`)
}

/**
 * Fetch notification preferences for a user
 */
export async function fetchNotificationPreferences(
  userId: string
): Promise<NotificationPreferences> {
  const response = await apiClient.get<NotificationPreferences>(
    `/notifications/preferences?userId=${userId}`
  )
  return response.data
}

/**
 * Update notification preferences
 */
export async function updateNotificationPreferences(
  userId: string,
  preferences: Partial<Omit<NotificationPreferences, 'userId'>>
): Promise<NotificationPreferences> {
  const response = await apiClient.patch<NotificationPreferences>(
    `/notifications/preferences?userId=${userId}`,
    preferences
  )
  return response.data
}

/**
 * Create a notification (typically used by system/backend)
 */
export async function createNotification(
  data: CreateNotificationInput
): Promise<Notification> {
  const response = await apiClient.post<Notification>('/notifications', data)
  return response.data
}

/**
 * Send a test notification
 */
export async function sendTestNotification(
  userId: string,
  channel: 'email' | 'push' | 'sms'
): Promise<void> {
  await apiClient.post('/notifications/test', { userId, channel })
}

/**
 * Get notification history (for analytics/debugging)
 */
export async function fetchNotificationHistory(
  userId: string,
  days: number = 30
): Promise<Notification[]> {
  const response = await apiClient.get<Notification[]>(
    `/notifications/history?userId=${userId}&days=${days}`
  )
  return response.data
}

/**
 * Subscribe to push notifications
 */
export async function subscribeToPushNotifications(
  userId: string,
  subscription: PushSubscription
): Promise<void> {
  await apiClient.post('/notifications/push/subscribe', {
    userId,
    subscription: subscription.toJSON(),
  })
}

/**
 * Unsubscribe from push notifications
 */
export async function unsubscribeFromPushNotifications(userId: string): Promise<void> {
  await apiClient.post('/notifications/push/unsubscribe', { userId })
}
