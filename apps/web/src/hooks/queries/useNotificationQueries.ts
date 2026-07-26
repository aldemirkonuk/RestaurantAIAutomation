import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../lib/query-keys'
import type { NotificationFilters } from '../../lib/query-keys'
import {
  fetchNotifications,
  fetchUnreadNotifications,
  fetchUnreadCount,
  markNotificationAsRead,
  markNotificationAsUnread,
  markNotificationsAsRead,
  markAllNotificationsAsRead,
  archiveNotification,
  deleteNotification,
  deleteNotifications,
  deleteAllReadNotifications,
  fetchNotificationPreferences,
  updateNotificationPreferences,
  sendTestNotification,
  fetchNotificationHistory,
  subscribeToPushNotifications,
  unsubscribeFromPushNotifications,
  type Notification,
  type NotificationPreferences,
} from '../../services/api/notifications'
import { useNotificationStore } from '../../stores'
import { offlineStorage } from '../../lib/offline-storage'
import { syncManager } from '../../lib/sync-manager'

/**
 * Hook to fetch notifications for a user
 * With offline support: caches data and falls back to cached data when offline
 */
export function useNotifications(userId: string, filters?: NotificationFilters) {
  const cacheKey = `notifications_${userId}_${JSON.stringify(filters || {})}`
  
  return useQuery({
    queryKey: queryKeys.notifications.list(userId, filters),
    queryFn: async () => {
      try {
        const notifications = await fetchNotifications(userId, filters)
        
        // Fire-and-forget — do NOT await IDB writes; they must not block the render
        offlineStorage.cacheEntity(cacheKey, notifications, 2 * 60 * 1000).catch(() => {})
        offlineStorage.markSynced('notifications').catch(() => {})
        
        return notifications
      } catch (error) {
        // Try to get cached data
        const cached = await offlineStorage.getCachedEntity<Notification[]>(cacheKey)
        if (cached) {
          console.warn('[Notifications] Using cached data due to API error')
          return cached
        }
        
        // In development, return empty array instead of throwing
        if (import.meta.env.DEV) {
          console.warn('API not available, returning empty notifications')
          return []
        }
        throw error
      }
    },
    enabled: !!userId,
    staleTime: 60_000,      // 1 min — notifications are low-urgency; the bell icon doesn't need sub-second freshness
    gcTime: 15 * 60_000,    // 15 min — prevent Header from causing a full refetch on every page visit
    select: (data): Notification[] => (Array.isArray(data) ? data : []),
  })
}

/**
 * Hook to fetch unread notifications
 */
export function useUnreadNotifications(userId: string) {
  return useQuery({
    queryKey: queryKeys.notifications.unread(userId),
    queryFn: () => fetchUnreadNotifications(userId),
    enabled: !!userId,
    refetchInterval: 30000, // Refetch every 30 seconds
  })
}

/**
 * Hook to fetch unread notification count
 */
export function useUnreadCount(userId: string) {
  return useQuery({
    queryKey: queryKeys.notifications.count(userId),
    queryFn: () => fetchUnreadCount(userId),
    enabled: !!userId,
    refetchInterval: 30000, // Refetch every 30 seconds
  })
}

/**
 * Hook to fetch notification preferences
 */
export function useNotificationPreferences(userId: string) {
  return useQuery({
    queryKey: queryKeys.notifications.preferences(userId),
    queryFn: () => fetchNotificationPreferences(userId),
    enabled: !!userId,
  })
}

/**
 * Hook to fetch notification history
 */
export function useNotificationHistory(userId: string, days: number = 30) {
  return useQuery({
    queryKey: [...queryKeys.notifications.all, 'history', userId, days],
    queryFn: () => fetchNotificationHistory(userId, days),
    enabled: !!userId,
  })
}

/**
 * Hook to mark a notification as read
 * With offline support: queues mutation when offline
 */
export function useMarkNotificationAsRead() {
  const queryClient = useQueryClient()
  const notificationStore = useNotificationStore()
  
  return useMutation({
    mutationFn: async (id: string) => {
      try {
        return await markNotificationAsRead(id)
      } catch (error) {
        // Queue for offline sync
        await syncManager.queueMutation({
          type: 'notification.markRead',
          data: { id },
        })
        
        // Return optimistic result
        return { id, read: true, _pending: true } as unknown as Notification
      }
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notifications.all })
      return { notificationId: id }
    },
    onSuccess: (updatedNotification) => {
      // Update notification in cache
      if (updatedNotification.userId) {
        queryClient.setQueryData<Notification[]>(
          queryKeys.notifications.list(updatedNotification.userId),
          (old) => old?.map((n) => (n.id === updatedNotification.id ? { ...n, read: true } : n))
        )
        
        // Invalidate unread queries
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unread(updatedNotification.userId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications.count(updatedNotification.userId) })
      }
      
      // Update store
      notificationStore.decrementUnreadCount()
    },
  })
}

/**
 * Hook to mark a notification back to unread (NEW-474)
 */
export function useMarkNotificationAsUnread() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => markNotificationAsUnread(id),
    onSuccess: (updated) => {
      if (updated?.userId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list(updated.userId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unread(updated.userId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications.count(updated.userId) })
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all })
    },
  })
}

/**
 * Hook to mark multiple notifications as read
 */
export function useMarkNotificationsAsRead() {
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: (ids: string[]) => markNotificationsAsRead(ids),
    onSuccess: (_, ids) => {
      // Invalidate notification queries
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all })
      
      toast.success(`${ids.length} notifications marked as read`)
    },
    onError: (error: any) => {
      toast.error('Failed to mark notifications as read', error.response?.data?.message || error.message)
    },
  })
}

/**
 * Hook to mark all notifications as read
 */
export function useMarkAllNotificationsAsRead() {
  const queryClient = useQueryClient()
  const notificationStore = useNotificationStore()
  const toast = notificationStore
  
  return useMutation({
    mutationFn: (userId: string) => markAllNotificationsAsRead(userId),
    onSuccess: (_, _userId) => {
      // Invalidate notification queries
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all })
      
      // Clear unread count
      notificationStore.clearUnreadCount()
      
      toast.success('All notifications marked as read')
    },
    onError: (error: any) => {
      toast.error('Failed to mark all as read', error.response?.data?.message || error.message)
    },
  })
}

/**
 * Hook to archive a notification
 * With offline support: queues mutation when offline
 */
export function useArchiveNotification() {
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: async (id: string) => {
      try {
        return await archiveNotification(id)
      } catch (error) {
        // Queue for offline sync
        await syncManager.queueMutation({
          type: 'notification.archive',
          data: { id },
        })
        
        return { id, archived: true, _pending: true }
      }
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notifications.all })
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all })
      
      const isPending = (result as any)?._pending
      
      if (isPending) {
        toast.info('Archive saved offline', 'Will sync when you\'re back online.')
      } else {
        toast.success('Notification archived')
      }
    },
    onError: (error: any) => {
      toast.error('Failed to archive notification', error.response?.data?.message || error.message)
    },
  })
}

/**
 * Hook to delete a notification
 */
export function useDeleteNotification() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: (id: string) => deleteNotification(id),
    onSuccess: () => {
      // Invalidate notification queries
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all })
    },
  })
}

/**
 * Hook to delete multiple notifications
 */
export function useDeleteNotifications() {
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: (ids: string[]) => deleteNotifications(ids),
    onSuccess: (_, ids) => {
      // Invalidate notification queries
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all })
      
      toast.success(`${ids.length} notifications deleted`)
    },
    onError: (error: any) => {
      toast.error('Failed to delete notifications', error.response?.data?.message || error.message)
    },
  })
}

/**
 * Hook to delete all read notifications
 */
export function useDeleteAllReadNotifications() {
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: (userId: string) => deleteAllReadNotifications(userId),
    onSuccess: () => {
      // Invalidate notification queries
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all })
      
      toast.success('All read notifications deleted')
    },
    onError: (error: any) => {
      toast.error('Failed to delete notifications', error.response?.data?.message || error.message)
    },
  })
}

/**
 * Hook to update notification preferences
 */
export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: ({ userId, preferences }: { userId: string; preferences: Partial<Omit<NotificationPreferences, 'userId'>> }) =>
      updateNotificationPreferences(userId, preferences),
    onSuccess: (updatedPreferences) => {
      // Update preferences cache
      queryClient.setQueryData(
        queryKeys.notifications.preferences(updatedPreferences.userId),
        updatedPreferences
      )
      
      toast.success('Preferences updated')
    },
    onError: (error: any) => {
      toast.error('Failed to update preferences', error.response?.data?.message || error.message)
    },
  })
}

/**
 * Hook to send a test notification
 */
export function useSendTestNotification() {
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: ({ userId, channel }: { userId: string; channel: 'email' | 'push' | 'sms' }) =>
      sendTestNotification(userId, channel),
    onSuccess: (_, variables) => {
      toast.success(`Test ${variables.channel} notification sent`)
    },
    onError: (error: any) => {
      toast.error('Failed to send test notification', error.response?.data?.message || error.message)
    },
  })
}

/**
 * Hook to subscribe to push notifications
 */
export function useSubscribeToPushNotifications() {
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: ({ userId, subscription }: { userId: string; subscription: PushSubscription }) =>
      subscribeToPushNotifications(userId, subscription),
    onSuccess: () => {
      toast.success('Push notifications enabled')
    },
    onError: (error: any) => {
      toast.error('Failed to enable push notifications', error.response?.data?.message || error.message)
    },
  })
}

/**
 * Hook to unsubscribe from push notifications
 */
export function useUnsubscribeFromPushNotifications() {
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: (userId: string) => unsubscribeFromPushNotifications(userId),
    onSuccess: () => {
      toast.success('Push notifications disabled')
    },
    onError: (error: any) => {
      toast.error('Failed to disable push notifications', error.response?.data?.message || error.message)
    },
  })
}
