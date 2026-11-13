import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import axios from 'axios'
import { AUTH_STORAGE_KEY } from '../lib/deadSession'

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

const api = axios.create({
  baseURL: API_URL,
  timeout: 8000,
})

export interface User {
  userId: string
  email: string
  name: string
  /** The role in the session's house; null for a session in no house. */
  role: 'owner' | 'manager' | 'staff' | null
  /** The session's house; "" for a session in no house. */
  restaurantId: string
}

export interface RegisterData {
  email: string
  password: string
  name: string
  restaurantId: string
  role: 'owner' | 'manager' | 'staff'
  phone?: string
}

interface AuthState {
  // State
  user: User | null
  loading: boolean
  error: string | null
  activeRestaurantId: string | null
  availableRestaurants: string[]
  accessToken: string | null
  refreshToken: string | null
  
  // Computed
  isAuthenticated: boolean
  
  // Actions
  setUser: (user: User | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setActiveRestaurantId: (restaurantId: string) => void
  setTokens: (accessToken: string, refreshToken: string) => void
  clearTokens: () => void
  /**
   * Takes the signed-in person from AuthProvider (contexts/AuthContext.tsx),
   * or null once signed out. AuthProvider owns the session; this store is the
   * copy hooks read when they cannot call `useAuth()`.
   */
  followSession: (user: User | null) => void
  
  // Auth methods
  login: (email: string, password: string) => Promise<void>
  register: (data: RegisterData) => Promise<void>
  loginWithGoogle: (token: string) => Promise<void>
  loginWithMicrosoft: (token: string) => Promise<void>
  logout: () => Promise<void>
  refreshAccessToken: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      user: null,
      loading: true,
      error: null,
      activeRestaurantId: null,
      availableRestaurants: [],
      accessToken: null,
      refreshToken: null,
      
      // Computed
      get isAuthenticated() {
        return !!get().user
      },
      
      // Setters
      setUser: (user) => set({ user }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),
      setActiveRestaurantId: (restaurantId) => {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(restaurantId)
        if (!isUuid) {
          return
        }
        set({ activeRestaurantId: restaurantId })
        localStorage.setItem('activeRestaurantId', restaurantId)
      },
      setTokens: (accessToken, refreshToken) => {
        set({ accessToken, refreshToken })
        localStorage.setItem('accessToken', accessToken)
        localStorage.setItem('refreshToken', refreshToken)
        api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`
      },
      followSession: (user) => {
        if (user) {
          set({
            user: {
              userId: user.userId,
              email: user.email,
              name: user.name,
              role: user.role,
              restaurantId: user.restaurantId,
            },
          })
        } else {
          // Signed out: nothing of the last person stays for the next one.
          set({ user: null, activeRestaurantId: null, availableRestaurants: [] })
        }
      },
      clearTokens: () => {
        set({ accessToken: null, refreshToken: null })
        localStorage.removeItem('accessToken')
        localStorage.removeItem('refreshToken')
        localStorage.removeItem('demoMode')
        delete api.defaults.headers.common['Authorization']
      },
      
      // Auth methods
      login: async (email, password) => {
        set({ loading: true, error: null })
        
        try {
          const response = await api.post('/api/v1/auth/login', { email, password })
          const { user, accessToken, refreshToken, availableRestaurants } = response.data
          
          get().setTokens(accessToken, refreshToken)
          set({
            user,
            availableRestaurants: availableRestaurants || [user.restaurantId],
            activeRestaurantId: user.restaurantId,
            loading: false,
          })
        } catch (err: any) {
          const errorMessage = err.response?.data?.message || 'Login failed'
          set({ error: errorMessage, loading: false })
          throw new Error(errorMessage)
        }
      },
      
      register: async (data) => {
        set({ loading: true, error: null })
        
        try {
          const response = await api.post('/api/v1/auth/register', data)
          const { user, accessToken, refreshToken } = response.data
          
          get().setTokens(accessToken, refreshToken)
          set({
            user,
            availableRestaurants: [user.restaurantId],
            activeRestaurantId: user.restaurantId,
            loading: false,
          })
        } catch (err: any) {
          const errorMessage = err.response?.data?.message || 'Registration failed'
          set({ error: errorMessage, loading: false })
          throw new Error(errorMessage)
        }
      },
      
      loginWithGoogle: async (token) => {
        set({ loading: true, error: null })
        
        try {
          const response = await api.post('/api/v1/auth/oauth/google', { token })
          const { user, accessToken, refreshToken, availableRestaurants } = response.data
          
          get().setTokens(accessToken, refreshToken)
          set({
            user,
            availableRestaurants: availableRestaurants || [user.restaurantId],
            activeRestaurantId: user.restaurantId,
            loading: false,
          })
        } catch (err: any) {
          const errorMessage = err.response?.data?.message || 'Google login failed'
          set({ error: errorMessage, loading: false })
          throw new Error(errorMessage)
        }
      },
      
      loginWithMicrosoft: async (token) => {
        set({ loading: true, error: null })
        
        try {
          const response = await api.post('/api/v1/auth/oauth/microsoft', { token })
          const { user, accessToken, refreshToken, availableRestaurants } = response.data
          
          get().setTokens(accessToken, refreshToken)
          set({
            user,
            availableRestaurants: availableRestaurants || [user.restaurantId],
            activeRestaurantId: user.restaurantId,
            loading: false,
          })
        } catch (err: any) {
          const errorMessage = err.response?.data?.message || 'Microsoft login failed'
          set({ error: errorMessage, loading: false })
          throw new Error(errorMessage)
        }
      },
      
      logout: async () => {
        try {
          await api.post('/api/v1/auth/logout')
        } catch (err) {
          console.error('Logout error:', err)
        } finally {
          get().clearTokens()
          set({
            user: null,
            activeRestaurantId: null,
            availableRestaurants: [],
            error: null,
          })
        }
      },
      
      refreshAccessToken: async () => {
        const { refreshToken } = get()
        
        if (!refreshToken) {
          throw new Error('No refresh token available')
        }
        
        try {
          const response = await api.post('/api/v1/auth/refresh', { refreshToken })
          const { accessToken: newAccessToken } = response.data
          
          get().setTokens(newAccessToken, refreshToken)
        } catch (err) {
          console.error('Token refresh failed:', err)
          get().clearTokens()
          set({ user: null })
          throw err
        }
      },
    }),
    {
      name: AUTH_STORAGE_KEY,
      partialize: (state) => ({
        user: state.user,
        activeRestaurantId: state.activeRestaurantId,
        availableRestaurants: state.availableRestaurants,
      }),
    }
  )
)


// No boot load here. AuthProvider (contexts/AuthContext.tsx) reads `/auth/me`
// once per page load and writes this copy through `followSession`; this store
// used to read it a second time at import (r18, 2026-11-13).
