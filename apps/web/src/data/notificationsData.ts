/**
 * Shared Notifications Data Store
 * Central location for managing notifications across the app
 */

export type NotificationType = 
  | 'alert'
  | 'warning'
  | 'info'
  | 'success'
  | 'order'
  | 'inventory'
  | 'report'
  | 'reminder'
  | 'event'

export type NotificationStatus = 'unread' | 'read' | 'archived'
export type NotificationPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface Notification {
  id: string
  type: NotificationType
  title: string
  message: string
  timestamp: string
  status: NotificationStatus
  priority: NotificationPriority
  actionUrl?: string
  metadata?: {
    wineName?: string
    quantity?: number
    provider?: string
    eventId?: string
    orderId?: string
  }
}

// Mock notifications - In production, this would be managed by a state management solution
let notifications: Notification[] = [
  {
    id: '1',
    type: 'alert',
    title: 'Low Stock Alert',
    message: 'Cabernet Sauvignon 2019 is running low',
    timestamp: new Date(Date.now() - 5 * 60000).toISOString(),
    status: 'unread',
    priority: 'high',
    actionUrl: '/inventory',
    metadata: {
      wineName: 'Cabernet Sauvignon 2019',
      quantity: 3,
    },
  },
  {
    id: '2',
    type: 'success',
    title: 'Order Approved',
    message: 'Order #1234 has been approved',
    timestamp: new Date(Date.now() - 60 * 60000).toISOString(),
    status: 'unread',
    priority: 'medium',
    actionUrl: '/orders',
    metadata: {
      orderId: '1234',
    },
  },
  {
    id: '3',
    type: 'info',
    title: 'New Report Ready',
    message: 'Weekly sales report is available',
    timestamp: new Date(Date.now() - 2 * 60 * 60000).toISOString(),
    status: 'read',
    priority: 'low',
    actionUrl: '/reports',
  },
  {
    id: '4',
    type: 'reminder',
    title: 'Upcoming Delivery',
    message: 'Wine delivery scheduled for today at 2:00 PM',
    timestamp: new Date(Date.now() - 30 * 60000).toISOString(),
    status: 'unread',
    priority: 'medium',
    actionUrl: '/calendar',
  },
  {
    id: '5',
    type: 'warning',
    title: 'Price Change Detected',
    message: 'Pinot Noir 2020 price increased by 15%',
    timestamp: new Date(Date.now() - 3 * 60 * 60000).toISOString(),
    status: 'unread',
    priority: 'medium',
    actionUrl: '/wine-library',
    metadata: {
      wineName: 'Pinot Noir 2020',
    },
  },
]

// Getters
export function getAllNotifications(): Notification[] {
  return [...notifications]
}

export function getUnreadNotifications(): Notification[] {
  return notifications.filter((n) => n.status === 'unread')
}

export function getUnreadCount(): number {
  return notifications.filter((n) => n.status === 'unread').length
}

export function getNotificationById(id: string): Notification | undefined {
  return notifications.find((n) => n.id === id)
}

// Setters
export function addNotification(notification: Omit<Notification, 'id' | 'timestamp' | 'status'>): Notification {
  const newNotification: Notification = {
    ...notification,
    id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    timestamp: new Date().toISOString(),
    status: 'unread',
  }
  notifications = [newNotification, ...notifications]
  return newNotification
}

export function markAsRead(id: string): void {
  const notification = notifications.find((n) => n.id === id)
  if (notification) {
    notification.status = 'read'
  }
}

export function markAllAsRead(): void {
  notifications.forEach((n) => {
    if (n.status === 'unread') {
      n.status = 'read'
    }
  })
}

export function archiveNotification(id: string): void {
  const notification = notifications.find((n) => n.id === id)
  if (notification) {
    notification.status = 'archived'
  }
}

export function deleteNotification(id: string): void {
  notifications = notifications.filter((n) => n.id !== id)
}

// Time formatting helper
export function formatTimestamp(timestamp: string): string {
  const now = new Date()
  const date = new Date(timestamp)
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) {
    return 'Just now'
  } else if (diffMins < 60) {
    return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
}

// Type icon mapping helper
export function getNotificationTypeColor(type: NotificationType): string {
  const colors: Record<NotificationType, string> = {
    alert: '#EF4444', // red
    warning: '#F59E0B', // amber
    info: '#3B82F6', // blue
    success: '#10B981', // green
    order: '#8B5CF6', // purple
    inventory: '#EC4899', // pink
    report: '#6366F1', // indigo
    reminder: '#F97316', // orange
    event: '#06B6D4', // cyan
  }
  return colors[type] || '#6B7280' // gray fallback
}

export function getNotificationPriorityColor(priority: NotificationPriority): string {
  const colors: Record<NotificationPriority, string> = {
    low: '#10B981', // green
    medium: '#F59E0B', // amber
    high: '#F97316', // orange
    urgent: '#EF4444', // red
  }
  return colors[priority]
}

