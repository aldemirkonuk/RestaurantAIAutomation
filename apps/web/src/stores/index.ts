/**
 * Zustand Stores
 * 
 * Centralized state management for cross-cutting concerns.
 * 
 * Usage:
 * ```tsx
 * import { useAuthStore, useUIStore, useNotificationStore } from '@/stores'
 * 
 * function MyComponent() {
 *   const user = useAuthStore(state => state.user)
 *   const theme = useUIStore(state => state.theme)
 *   const toast = useNotificationStore()
 *   
 *   const handleClick = () => {
 *     toast.success('Action completed!')
 *   }
 * }
 * ```
 */

export { useAuthStore } from './authStore'
export type { User, RegisterData } from './authStore'

export { useUIStore } from './uiStore'
export type { Theme } from './uiStore'
export type { PendingReorder } from './uiStore'

export { useNotificationStore } from './notificationStore'
export type { Toast, NotificationPreferences } from './notificationStore'

export { useRestaurantSettingsStore } from './restaurantSettingsStore'
export type { MeasurementUnit } from './restaurantSettingsStore'
