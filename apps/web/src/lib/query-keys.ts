/**
 * Query Key Factory
 * 
 * Centralized query key management for React Query.
 * Ensures consistent cache keys across the application.
 * 
 * Usage:
 * ```tsx
 * import { queryKeys } from '@/lib/query-keys'
 * 
 * const { data } = useQuery({
 *   queryKey: queryKeys.inventory.list(restaurantId),
 *   queryFn: () => fetchInventory(restaurantId)
 * })
 * 
 * // Invalidate specific query
 * queryClient.invalidateQueries({ queryKey: queryKeys.inventory.list(restaurantId) })
 * 
 * // Invalidate all inventory queries
 * queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all })
 * ```
 */

export interface OrderFilters {
  status?: string
  providerId?: string
  dateFrom?: string
  dateTo?: string
}

export interface InventoryFilters {
  search?: string
  type?: string
  lowStock?: boolean
  storageLocation?: string
}

export interface WineFilters {
  search?: string
  type?: string
  region?: string
  vintage?: string
}

export interface CalendarFilters {
  startDate: string
  endDate: string
  eventType?: string
}

export interface ProviderFilters {
  search?: string
  category?: string
  rating?: number
}

export interface NotificationFilters {
  type?: string
  status?: 'read' | 'unread'
  dateFrom?: string
  dateTo?: string
}

export const queryKeys = {
  // Dashboard
  dashboard: {
    all: ['dashboard'] as const,
    summary: (restaurantId: string) => [...queryKeys.dashboard.all, 'summary', restaurantId] as const,
    stats: (restaurantId: string) => [...queryKeys.dashboard.all, 'stats', restaurantId] as const,
    recentActivity: (restaurantId: string) => [...queryKeys.dashboard.all, 'activity', restaurantId] as const,
  },
  
  // Inventory
  inventory: {
    all: ['inventory'] as const,
    lists: () => [...queryKeys.inventory.all, 'list'] as const,
    list: (restaurantId: string, filters?: InventoryFilters) => 
      [...queryKeys.inventory.lists(), restaurantId, filters] as const,
    detail: (id: string) => [...queryKeys.inventory.all, 'detail', id] as const,
    summary: (restaurantId: string) => [...queryKeys.inventory.all, 'summary', restaurantId] as const,
    lowStock: (restaurantId: string) => [...queryKeys.inventory.all, 'low-stock', restaurantId] as const,
    history: (wineId: string) => [...queryKeys.inventory.all, 'history', wineId] as const,
  },
  
  // Orders
  orders: {
    all: ['orders'] as const,
    lists: () => [...queryKeys.orders.all, 'list'] as const,
    list: (restaurantId: string, filters?: OrderFilters) => 
      [...queryKeys.orders.lists(), restaurantId, filters] as const,
    detail: (id: string) => [...queryKeys.orders.all, 'detail', id] as const,
    pending: (restaurantId: string) => [...queryKeys.orders.all, 'pending', restaurantId] as const,
    history: (restaurantId: string) => [...queryKeys.orders.all, 'history', restaurantId] as const,
  },
  
  // Wine Library
  wines: {
    all: ['wines'] as const,
    lists: () => [...queryKeys.wines.all, 'list'] as const,
    list: (filters?: WineFilters) => [...queryKeys.wines.lists(), filters] as const,
    detail: (id: string) => [...queryKeys.wines.all, 'detail', id] as const,
    search: (query: string) => [...queryKeys.wines.all, 'search', query] as const,
    recommendations: (wineId: string) => [...queryKeys.wines.all, 'recommendations', wineId] as const,
  },
  
  // Providers
  providers: {
    all: ['providers'] as const,
    lists: () => [...queryKeys.providers.all, 'list'] as const,
    list: (restaurantId: string, filters?: ProviderFilters) => 
      [...queryKeys.providers.lists(), restaurantId, filters] as const,
    detail: (id: string) => [...queryKeys.providers.all, 'detail', id] as const,
    contacts: (providerId: string) => [...queryKeys.providers.all, 'contacts', providerId] as const,
    orders: (providerId: string) => [...queryKeys.providers.all, 'orders', providerId] as const,
  },
  
  // Calendar
  calendar: {
    all: ['calendar'] as const,
    events: (restaurantId: string, filters: CalendarFilters) => 
      [...queryKeys.calendar.all, 'events', restaurantId, filters] as const,
    event: (id: string) => [...queryKeys.calendar.all, 'event', id] as const,
    eventTypes: (restaurantId: string) => [...queryKeys.calendar.all, 'types', restaurantId] as const,
    upcoming: (restaurantId: string) => [...queryKeys.calendar.all, 'upcoming', restaurantId] as const,
  },
  
  // Notifications
  notifications: {
    all: ['notifications'] as const,
    lists: () => [...queryKeys.notifications.all, 'list'] as const,
    list: (userId: string, filters?: NotificationFilters) => 
      [...queryKeys.notifications.lists(), userId, filters] as const,
    unread: (userId: string) => [...queryKeys.notifications.all, 'unread', userId] as const,
    count: (userId: string) => [...queryKeys.notifications.all, 'count', userId] as const,
    preferences: (userId: string) => [...queryKeys.notifications.all, 'preferences', userId] as const,
  },
  
  // Reports
  reports: {
    all: ['reports'] as const,
    list: (restaurantId: string) => [...queryKeys.reports.all, 'list', restaurantId] as const,
    detail: (id: string) => [...queryKeys.reports.all, 'detail', id] as const,
    generate: (type: string, params: Record<string, any>) => 
      [...queryKeys.reports.all, 'generate', type, params] as const,
    templates: () => [...queryKeys.reports.all, 'templates'] as const,
  },
  
  // Documents
  documents: {
    all: ['documents'] as const,
    templates: (restaurantId: string) => [...queryKeys.documents.all, 'templates', restaurantId] as const,
    template: (id: string) => [...queryKeys.documents.all, 'template', id] as const,
    history: (restaurantId: string) => [...queryKeys.documents.all, 'history', restaurantId] as const,
    categories: () => [...queryKeys.documents.all, 'categories'] as const,
  },
  
  // Sommelier AI
  sommelier: {
    all: ['sommelier'] as const,
    conversations: (userId: string) => [...queryKeys.sommelier.all, 'conversations', userId] as const,
    conversation: (id: string) => [...queryKeys.sommelier.all, 'conversation', id] as const,
    recommendations: (params: Record<string, any>) => 
      [...queryKeys.sommelier.all, 'recommendations', params] as const,
  },
  
  // Recurring Orders
  recurringOrders: {
    all: ['recurring-orders'] as const,
    list: (restaurantId: string) => [...queryKeys.recurringOrders.all, 'list', restaurantId] as const,
    detail: (id: string) => [...queryKeys.recurringOrders.all, 'detail', id] as const,
    upcoming: (restaurantId: string) => [...queryKeys.recurringOrders.all, 'upcoming', restaurantId] as const,
  },
  
  // User
  user: {
    all: ['user'] as const,
    profile: (userId: string) => [...queryKeys.user.all, 'profile', userId] as const,
    preferences: (userId: string) => [...queryKeys.user.all, 'preferences', userId] as const,
    permissions: (userId: string) => [...queryKeys.user.all, 'permissions', userId] as const,
  },
} as const

/**
 * Helper function to invalidate all queries for a specific restaurant
 */
export function getRestaurantQueryKeys(restaurantId: string) {
  return [
    queryKeys.dashboard.summary(restaurantId),
    queryKeys.dashboard.stats(restaurantId),
    queryKeys.inventory.list(restaurantId),
    queryKeys.orders.list(restaurantId),
    queryKeys.providers.list(restaurantId),
  ]
}

/**
 * Helper function to invalidate all queries for a specific user
 */
export function getUserQueryKeys(userId: string) {
  return [
    queryKeys.user.profile(userId),
    queryKeys.user.preferences(userId),
    queryKeys.notifications.list(userId),
    queryKeys.sommelier.conversations(userId),
  ]
}
