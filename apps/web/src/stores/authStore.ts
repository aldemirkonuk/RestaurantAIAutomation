import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import axios from 'axios'
import { doRefresh } from '../lib/sessionRefresh'

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

const api = axios.create({
  baseURL: API_URL,
  timeout: 8000,
})

export interface User {
  userId: string
  email: string
  name: string
  role: 'owner' | 'manager' | 'staff'
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
  
  // Auth methods
  login: (email: string, password: string) => Promise<void>
  register: (data: RegisterData) => Promise<void>
  loginWithGoogle: (token: string) => Promise<void>
  loginWithMicrosoft: (token: string) => Promise<void>
  logout: () => Promise<void>
  refreshAccessToken: () => Promise<void>
  loadUser: () => Promise<void>
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
      
      loadUser: async () => {
        const token = localStorage.getItem('accessToken')
        if (!token) {
          set({ loading: false })
          return
        }
        if (token === 'demo-token') {
          get().clearTokens()
          localStorage.removeItem('demoMode')
          set({ loading: false })
          return
        }

        api.defaults.headers.common['Authorization'] = `Bearer ${token}`

        const applyUserData = (user: any, availableRestaurants: any[]) => {
          const restaurants = Array.isArray(availableRestaurants) && availableRestaurants.length > 0
            ? availableRestaurants
            : [user.restaurantId]
          const storedActive = localStorage.getItem('activeRestaurantId')
          const isUuid = storedActive
            ? /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(storedActive)
            : false
          const resolvedActive =
            storedActive && isUuid && restaurants.includes(storedActive)
              ? storedActive
              : user.restaurantId
          set({
            user,
            availableRestaurants: restaurants,
            activeRestaurantId: resolvedActive,
            accessToken: localStorage.getItem('accessToken'),
            refreshToken: localStorage.getItem('refreshToken'),
            loading: false,
          })
        }

        try {
          const response = await api.get('/api/v1/auth/me')
          applyUserData(response.data.user, response.data.availableRestaurants)
        } catch (err: any) {
          const status = err?.response?.status
          if (status === 401) {
            // ADR 0164, item 2/3: the one shared, single-flight refresh
            // (`doRefresh`, also used by AuthContext.tsx and its axios
            // interceptor) instead of a fourth independent implementation —
            // a refresh AuthContext started around the same moment is
            // shared, not raced, and houseAccessEnded/503 are handled the
            // one place both clients rely on.
            const newAccess = await doRefresh()
            if (newAccess) {
              get().setTokens(newAccess, localStorage.getItem('refreshToken') || '')
              try {
                const retryRes = await api.get('/api/v1/auth/me')
                applyUserData(retryRes.data.user, retryRes.data.availableRestaurants)
                return
              } catch (retryErr) {
                console.error('Failed to load user after refresh:', retryErr)
              }
            }
            // `doRefresh` removes the stored refresh token itself only when
            // it was genuinely rejected. A houseAccessEnded response leaves a
            // fresh (no-house) pair in place and has already sent the person
            // to the chooser; a 503 or a dropped connection while refreshing
            // leaves the original pair untouched. Only the first case is
            // actually signed out — the other two keep whatever session is
            // now on disk instead of wiping it.
            if (!localStorage.getItem('refreshToken')) {
              get().clearTokens()
              set({ user: null, loading: false })
              window.location.href = '/login'
            } else {
              set({ loading: false })
            }
            return
          }
          // A rate limit, a 500, a 503, and a dropped connection all say "ask
          // again later"; none of them says "you are not who you said you
          // were" — this used to clear both tokens on ANY error here,
          // including a 503, which is the exact failure AuthContext.tsx's own
          // `/auth/me` load was already fixed for (ADR 0164 claimed "both web
          // clients"; this one was not).
          console.warn(
            `Keeping the session: /auth/me failed with ${status ?? 'no status (network)'}, which is not an authentication failure.`,
          )
          set({ loading: false })
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        activeRestaurantId: state.activeRestaurantId,
        availableRestaurants: state.availableRestaurants,
      }),
    }
  )
)

// Initialize auth on app load
useAuthStore.getState().loadUser()
