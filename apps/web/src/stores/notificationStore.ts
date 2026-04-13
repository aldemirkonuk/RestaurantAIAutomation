import { create } from 'zustand'

export interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  description?: string
  duration?: number
  action?: {
    label: string
    onClick: () => void
  }
  createdAt: number
}

export interface NotificationPreferences {
  email: boolean
  push: boolean
  sms: boolean
  categories: {
    inventory: boolean
    orders: boolean
    calendar: boolean
    system: boolean
  }
}

interface NotificationState {
  // Toast queue
  toasts: Toast[]
  maxToasts: number
  
  // Notification preferences
  preferences: NotificationPreferences
  
  // Unread count
  unreadCount: number
  
  // Actions
  addToast: (toast: Omit<Toast, 'id' | 'createdAt'>) => string
  removeToast: (id: string) => void
  clearToasts: () => void
  
  success: (title: string, description?: string, duration?: number) => string
  error: (title: string, description?: string, duration?: number) => string
  warning: (title: string, description?: string, duration?: number) => string
  info: (title: string, description?: string, duration?: number) => string
  
  promise: <T>(
    promise: Promise<T>,
    messages: {
      loading: string
      success: string
      error: string
    }
  ) => Promise<T>
  
  setPreferences: (preferences: Partial<NotificationPreferences>) => void
  setUnreadCount: (count: number) => void
  incrementUnreadCount: () => void
  decrementUnreadCount: () => void
  clearUnreadCount: () => void
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  // Initial state
  toasts: [],
  maxToasts: 3,
  preferences: {
    email: true,
    push: true,
    sms: false,
    categories: {
      inventory: true,
      orders: true,
      calendar: true,
      system: true,
    },
  },
  unreadCount: 0,
  
  // Toast actions
  addToast: (toast) => {
    const id = Math.random().toString(36).substring(2, 9)
    const newToast: Toast = {
      ...toast,
      id,
      createdAt: Date.now(),
      duration: toast.duration || 5000,
    }
    
    set((state) => {
      const toasts = [...state.toasts, newToast]
      
      // Limit to maxToasts
      if (toasts.length > state.maxToasts) {
        toasts.shift()
      }
      
      return { toasts }
    })
    
    // Auto-dismiss
    if (newToast.duration && newToast.duration > 0) {
      setTimeout(() => {
        get().removeToast(id)
      }, newToast.duration)
    }
    
    return id
  },
  
  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    }))
  },
  
  clearToasts: () => set({ toasts: [] }),
  
  // Convenience methods
  success: (title, description, duration) => {
    return get().addToast({ type: 'success', title, description, duration })
  },
  
  error: (title, description, duration) => {
    return get().addToast({ type: 'error', title, description, duration })
  },
  
  warning: (title, description, duration) => {
    return get().addToast({ type: 'warning', title, description, duration })
  },
  
  info: (title, description, duration) => {
    return get().addToast({ type: 'info', title, description, duration })
  },
  
  promise: async (promise, messages) => {
    const loadingId = get().info(messages.loading, undefined, 0)
    
    try {
      const result = await promise
      get().removeToast(loadingId)
      get().success(messages.success)
      return result
    } catch (error) {
      get().removeToast(loadingId)
      get().error(messages.error)
      throw error
    }
  },
  
  // Preferences
  setPreferences: (preferences) => {
    set((state) => ({
      preferences: { ...state.preferences, ...preferences },
    }))
  },
  
  // Unread count
  setUnreadCount: (count) => set({ unreadCount: count }),
  incrementUnreadCount: () => set((state) => ({ unreadCount: state.unreadCount + 1 })),
  decrementUnreadCount: () => set((state) => ({ unreadCount: Math.max(0, state.unreadCount - 1) })),
  clearUnreadCount: () => set({ unreadCount: 0 }),
}))
