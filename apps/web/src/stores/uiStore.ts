import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system'

interface Modal {
  id: string
  component: React.ComponentType<any>
  props?: Record<string, any>
}

export interface PendingReorder {
  wineId: string
  wineName: string
  quantity: number
  unitType: 'case' | 'bottle'
  bottlesPerCase?: number
  price: number
  selectedProviders: string[]
  notes?: string
}

interface UIState {
  // Sidebar
  sidebarCollapsed: boolean
  sidebarOpen: boolean
  
  // Theme
  theme: Theme
  resolvedTheme: 'light' | 'dark'
  
  // Modals
  modals: Modal[]
  
  // Loading states
  globalLoading: boolean
  loadingMessage: string | null
  
  // Pending reorder (cross-page communication: WineLibrary -> Orders)
  pendingReorder: PendingReorder | null
  
  // Actions
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setSidebarOpen: (open: boolean) => void
  
  setTheme: (theme: Theme) => void
  setResolvedTheme: (theme: 'light' | 'dark') => void
  
  openModal: (id: string, component: React.ComponentType<any>, props?: Record<string, any>) => void
  closeModal: (id: string) => void
  closeAllModals: () => void
  
  setGlobalLoading: (loading: boolean, message?: string) => void
  
  setPendingReorder: (reorder: PendingReorder | null) => void
  clearPendingReorder: () => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      // Initial state
      sidebarCollapsed: false,
      // Mobile drawer starts closed; desktop ignores this (always visible via md:translate-x-0)
      sidebarOpen: false,
      theme: 'light',
      resolvedTheme: 'light',
      modals: [],
      globalLoading: false,
      loadingMessage: null,
      pendingReorder: null,
      
      // Sidebar actions
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      
      // Theme actions
      setTheme: (theme) => {
        set({ theme })
        
        // Update resolved theme based on system preference
        if (theme === 'system') {
          const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
          get().setResolvedTheme(systemTheme)
        } else {
          get().setResolvedTheme(theme)
        }
      },
      
      setResolvedTheme: (resolvedTheme) => {
        set({ resolvedTheme })
        
        // Update DOM
        if (resolvedTheme === 'dark') {
          document.documentElement.classList.add('dark')
        } else {
          document.documentElement.classList.remove('dark')
        }
      },
      
      // Modal actions
      openModal: (id, component, props) => {
        set((state) => ({
          modals: [...state.modals, { id, component, props }],
        }))
      },
      
      closeModal: (id) => {
        set((state) => ({
          modals: state.modals.filter((modal) => modal.id !== id),
        }))
      },
      
      closeAllModals: () => set({ modals: [] }),
      
      // Loading actions
      setGlobalLoading: (loading, message) => {
        set({ globalLoading: loading, loadingMessage: message || null })
      },
      
      // Pending reorder actions
      setPendingReorder: (reorder) => {
        set({ pendingReorder: reorder })
      },
      clearPendingReorder: () => {
        set({ pendingReorder: null })
      },
    }),
    {
      name: 'ui-storage',
      // v1: product default switched to light; reset themes stored under the
      // old default (system/dark) exactly once.
      version: 1,
      migrate: (persistedState) => {
        const state = persistedState as Partial<UIState>
        return { sidebarCollapsed: state.sidebarCollapsed ?? false, theme: 'light' as Theme }
      },
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
        // Don't persist pendingReorder - it's session-only
      }),
    }
  )
)

// Listen for system theme changes
if (typeof window !== 'undefined') {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  
  mediaQuery.addEventListener('change', (e) => {
    const { theme, setResolvedTheme } = useUIStore.getState()
    if (theme === 'system') {
      setResolvedTheme(e.matches ? 'dark' : 'light')
    }
  })
  
  // Initialize theme on load
  const { theme, setResolvedTheme } = useUIStore.getState()
  if (theme === 'system') {
    setResolvedTheme(mediaQuery.matches ? 'dark' : 'light')
  } else {
    setResolvedTheme(theme)
  }
}
