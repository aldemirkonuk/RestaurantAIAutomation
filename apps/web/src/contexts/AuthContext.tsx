import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { errorTracking } from '../lib/error-tracking'

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'
const api = axios.create({
  baseURL: API_URL,
  timeout: 8000,
})

interface User {
  userId: string
  email: string
  name: string
  role: 'owner' | 'manager' | 'staff'
  restaurantId: string
  studioRoles?: ('developer' | 'certified_contributor' | 'review_admin')[]
}

interface AuthContextType {
  user: User | null
  loading: boolean
  error: string | null
  activeRestaurantId: string | null
  availableRestaurants: string[]
  setActiveRestaurantId: (restaurantId: string) => void
  login: (email: string, password: string) => Promise<void>
  register: (data: RegisterData) => Promise<void>
  loginWithGoogle: (token: string) => Promise<void>
  loginWithMicrosoft: (token: string) => Promise<void>
  logout: () => Promise<void>
  refreshToken: () => Promise<void>
  isAuthenticated: boolean
}

interface RegisterData {
  email: string
  password: string
  name: string
  restaurantId: string
  role: 'owner' | 'manager' | 'staff'
  phone?: string
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)
const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

// ── 401 Interceptor: auto-refresh with deduplication ───────────────
let refreshPromise: Promise<string | null> | null = null

async function doRefresh(): Promise<string | null> {
  const refresh = localStorage.getItem('refreshToken')
  if (!refresh) return null
  try {
    const response = await axios.post(`${API_URL}/api/v1/auth/refresh`, {
      refreshToken: refresh,
    })
    const { accessToken, refreshToken: newRefresh } = response.data
    localStorage.setItem('accessToken', accessToken)
    localStorage.setItem('refreshToken', newRefresh)
    api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`
    return accessToken
  } catch {
    // Refresh failed — clear tokens
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('activeRestaurantId')
    delete api.defaults.headers.common['Authorization']
    delete api.defaults.headers.common['X-Restaurant-Id']
    return null
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }
    // Only intercept 401s that are NOT the refresh or login calls themselves
    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/refresh') &&
      !originalRequest.url?.includes('/auth/login')
    ) {
      originalRequest._retry = true

      // Deduplicate: share a single refresh promise across concurrent 401s
      if (!refreshPromise) {
        refreshPromise = doRefresh().finally(() => {
          refreshPromise = null
        })
      }
      const newToken = await refreshPromise
      if (newToken) {
        originalRequest.headers['Authorization'] = `Bearer ${newToken}`
        return api(originalRequest)
      }
    }
    return Promise.reject(error)
  },
)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeRestaurantId, setActiveRestaurantIdState] = useState<string | null>(null)
  const [availableRestaurants, setAvailableRestaurants] = useState<string[]>([])

  // Configure axios defaults
  useEffect(() => {
    const token = localStorage.getItem('accessToken')
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`
    }
  }, [])

  useEffect(() => {
    if (user) {
      errorTracking.setUser({
        id: user.userId,
        email: user.email,
        username: user.name,
        restaurantId: user.restaurantId,
      })
    } else {
      errorTracking.setUser(null)
    }
  }, [user])

  // Load user from token on mount
  useEffect(() => {
    const loadUser = async () => {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        setLoading(false)
        return
      }
      if (token === 'demo-token') {
        localStorage.removeItem('accessToken')
        localStorage.removeItem('refreshToken')
        localStorage.removeItem('demoMode')
        setLoading(false)
        return
      }

      try {
        const response = await api.get('/api/v1/auth/me')
        // Extract studio roles from the JWT itself (app_metadata.roles) — avoids cross-service call
        const token = localStorage.getItem('accessToken')
        let studioRoles: ('developer' | 'certified_contributor' | 'review_admin')[] = []
        if (token) {
          try {
            const payload = JSON.parse(atob(token.split('.')[1]))
            studioRoles = payload?.app_metadata?.roles ?? []
          } catch { /* malformed token — no studio roles */ }
        }
        setUser({ ...response.data.user, studioRoles })
      } catch (err) {
        console.error('Failed to load user:', err)
        // Clear invalid tokens
        localStorage.removeItem('accessToken')
        localStorage.removeItem('refreshToken')
      } finally {
        setLoading(false)
      }
    }

    loadUser()
  }, [])

  // Sync restaurant context when user changes
  useEffect(() => {
    if (!user) {
      setAvailableRestaurants([])
      setActiveRestaurantIdState(null)
      return
    }

    const restaurants = [user.restaurantId]

    setAvailableRestaurants(restaurants)
    localStorage.setItem('availableRestaurants', JSON.stringify(restaurants))

    const resolvedActive = user.restaurantId

    setActiveRestaurantIdState(resolvedActive)
    localStorage.setItem('activeRestaurantId', resolvedActive)
    api.defaults.headers.common['X-Restaurant-Id'] = resolvedActive
  }, [user])

  const setActiveRestaurantId = useCallback((restaurantId: string) => {
    if (!isUuid(restaurantId)) {
      return
    }
    setActiveRestaurantIdState(restaurantId)
    localStorage.setItem('activeRestaurantId', restaurantId)
    api.defaults.headers.common['X-Restaurant-Id'] = restaurantId
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    try {
      setError(null)
      setLoading(true)
      const response = await api.post('/api/v1/auth/login', {
        email,
        password,
      })

      const { accessToken, refreshToken: refresh } = response.data

      localStorage.setItem('accessToken', accessToken)
      localStorage.setItem('refreshToken', refresh)
      api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`

      const userResponse = await api.get('/api/v1/auth/me')
      let studioRoles: string[] = []
      try {
        const payload = JSON.parse(atob(accessToken.split('.')[1]))
        studioRoles = payload?.app_metadata?.roles ?? []
      } catch { /* malformed token */ }
      setUser({ ...userResponse.data.user, studioRoles })
    } catch (err: any) {
      const message = err?.code === 'ERR_NETWORK' && !err?.response
        ? 'Cannot reach server. Start the API Gateway: cd apps/api-gateway && pnpm start:dev'
        : (err?.response?.data?.message || err?.message || 'Login failed.')
      setError(message)
      throw new Error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  const register = useCallback(async (data: RegisterData) => {
    try {
      setError(null)
      setLoading(true)
      const response = await api.post('/api/v1/auth/register', data)

      const { accessToken, refreshToken: refresh } = response.data

      localStorage.setItem('accessToken', accessToken)
      localStorage.setItem('refreshToken', refresh)
      api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`

      const userResponse = await api.get('/api/v1/auth/me')
      setUser(userResponse.data.user)
    } catch (err: any) {
      const message = err.response?.data?.message || 'Registration failed'
      setError(message)
      throw new Error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loginWithGoogle = useCallback(async (token: string) => {
    try {
      setError(null)
      setLoading(true)
      const response = await api.post('/api/v1/auth/oauth/google', {
        token,
      })

      const { accessToken, refreshToken: refresh } = response.data

      localStorage.setItem('accessToken', accessToken)
      localStorage.setItem('refreshToken', refresh)
      api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`

      const userResponse = await api.get('/api/v1/auth/me')
      setUser(userResponse.data.user)
    } catch (err: any) {
      const message = err.response?.data?.message || 'Google login failed'
      setError(message)
      throw new Error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loginWithMicrosoft = useCallback(async (token: string) => {
    try {
      setError(null)
      setLoading(true)
      const response = await api.post('/api/v1/auth/oauth/microsoft', {
        token,
      })

      const { accessToken, refreshToken: refresh } = response.data

      localStorage.setItem('accessToken', accessToken)
      localStorage.setItem('refreshToken', refresh)
      api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`

      const userResponse = await api.get('/api/v1/auth/me')
      setUser(userResponse.data.user)
    } catch (err: any) {
      const message = err.response?.data?.message || 'Microsoft login failed'
      setError(message)
      throw new Error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/api/v1/auth/logout')
    } catch (err) {
      console.error('Logout error:', err)
    } finally {
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      localStorage.removeItem('demoMode')
      localStorage.removeItem('activeRestaurantId')
      localStorage.removeItem('availableRestaurants')
      delete api.defaults.headers.common['Authorization']
      delete api.defaults.headers.common['X-Restaurant-Id']
      setUser(null)
    }
  }, [])

  const refreshTokenFn = useCallback(async () => {
    try {
      const refresh = localStorage.getItem('refreshToken')
      if (!refresh) {
        throw new Error('No refresh token')
      }

      const response = await api.post('/api/v1/auth/refresh', {
        refreshToken: refresh,
      })

      const { accessToken, refreshToken: newRefresh } = response.data

      localStorage.setItem('accessToken', accessToken)
      localStorage.setItem('refreshToken', newRefresh)
      api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`
    } catch (err) {
      console.error('Token refresh failed:', err)
      await logout()
    }
  }, [logout])

  const value: AuthContextType = {
    user,
    loading,
    error,
    activeRestaurantId,
    availableRestaurants,
    setActiveRestaurantId,
    login,
    register,
    loginWithGoogle,
    loginWithMicrosoft,
    logout,
    refreshToken: refreshTokenFn,
    isAuthenticated: !!user,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
