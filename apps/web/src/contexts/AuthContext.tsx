import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { errorTracking } from '../lib/error-tracking'
import { useAuthStore } from '../stores'
import {
  fallbackSignInMethods,
  type SignInMethodsResult,
} from '../lib/identityProviders'

/**
 * Thrown by `login()` for backend auth failures. `code`/`provider` carry the
 * structured fields the API sends for OAuth-only accounts (see
 * auth.service.ts#validateUser) — e.g. `{ code: 'OAUTH_ONLY', provider:
 * 'microsoft' }` — so callers can branch on the real provider instead of
 * pattern-matching the human-readable message text.
 */
export class LoginError extends Error {
  constructor(
    message: string,
    public code?: string,
    public provider?: 'google' | 'microsoft',
  ) {
    super(message)
    this.name = 'LoginError'
  }
}

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'
const api = axios.create({
  baseURL: API_URL,
  timeout: 20000,
})

/** Always stamp the latest token — defaults alone race with login / refresh. */
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('accessToken')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  const restaurantId = localStorage.getItem('activeRestaurantId')
  if (restaurantId) {
    config.headers['X-Restaurant-Id'] = restaurantId
  }
  return config
})

export interface User {
  userId: string
  email: string
  name: string
  role: 'owner' | 'manager' | 'staff'
  restaurantId: string
  emailVerified?: boolean
  studioRoles?: ('developer' | 'certified_contributor' | 'review_admin')[]
}

export interface RestaurantBranch {
  id: string
  name: string
  city: string | null
  chain_id: string | null    // null = standalone restaurant (D-10)
  chain_name: string | null  // null = standalone; set = chain label for Header grouping
}

interface RegisterRestaurantData {
  name: string
  email: string
  password: string
  restaurantName: string
  address: string
  city: string
  country: string
  stateProvince?: string
  postalCode?: string
  neighborhood?: string
  phone?: string
  cuisineType?: string
  timezone?: string
  /**
   * The money this house reports in, ISO 4217 alpha-3, from the sign-up form's
   * currency step.
   *
   * Omitted — not defaulted to `USD` — when the manager answered "not yet" or
   * when no default could be worked out from the address's country. The gateway
   * then writes NULL and every screen says "currency not recorded". Until
   * 2026-09-05 the column carried `DEFAULT 'USD'` and this payload never
   * mentioned it, which is how all fourteen production houses came to assert
   * dollars including two in Turkiye and one in London (ADR 0117 Q25).
   */
  currency?: string
  /**
   * The coordinate of the Google Places selection, when the operator chose one.
   *
   * Omitted — not zeroed, not defaulted — for a hand-typed address. The gateway
   * writes NULL in that case, and `/settings` then says "no coordinate — set the
   * address" rather than pointing the weather overlay at a place nobody named
   * (ADR 0111 slice 1).
   */
  latitude?: number
  longitude?: number
  googlePlaceId?: string
}

interface JoinViaInviteData {
  code: string
  name: string
  email: string
  password: string
}

export interface AuthContextType {
  user: User | null
  loading: boolean
  error: string | null
  clearError: () => void
  activeRestaurantId: string | null
  /** Role at the active branch from user_restaurant_access; null if unknown */
  activeRole: 'owner' | 'manager' | 'staff' | null
  availableRestaurants: RestaurantBranch[]
  setActiveRestaurantId: (restaurantId: string) => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (data: RegisterData) => Promise<void>
  registerRestaurant: (data: RegisterRestaurantData) => Promise<void>
  joinViaInvite: (data: JoinViaInviteData) => Promise<void>
  loginWithGoogle: (token: string) => Promise<void>
  loginWithMicrosoft: (token: string) => Promise<void>
  /**
   * Identity-first sign-in: ask the gateway which methods this address
   * actually has. Never throws — an unreachable gateway resolves to
   * `fallbackSignInMethods()` (marked `assumed`) so the page degrades to the
   * form it had before rather than locking the user out. See ADR 0024.
   */
  resolveSignInMethods: (email: string) => Promise<SignInMethodsResult>
  logout: () => Promise<void>
  refreshToken: () => Promise<void>
  refreshBranches: () => Promise<void>
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

/**
 * Exported so tests and Storybook can supply a mock auth value directly,
 * bypassing AuthProvider's network + localStorage bootstrap. Application code
 * should use `useAuth()` / `<AuthProvider>` rather than consuming this.
 */
export const AuthContext = createContext<AuthContextType | undefined>(undefined)
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
  const [availableRestaurants, setAvailableRestaurants] = useState<RestaurantBranch[]>([])
  const [activeRole, setActiveRole] = useState<'owner' | 'manager' | 'staff' | null>(null)
  const branchFetchSeq = React.useRef(0)

  // Configure axios defaults
  useEffect(() => {
    const token = localStorage.getItem('accessToken')
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`
    }
  }, [])

  useEffect(() => {
    if (user) {
      // Only opaque identifiers reach the error tracker. `user.email` and
      // `user.name` are in scope here and are deliberately not passed: an
      // error report needs to be routable to an account, not to a person.
      errorTracking.setUser({
        id: user.userId,
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
        let jwtRestaurantId: string | undefined
        if (token) {
          try {
            const payload = JSON.parse(atob(token.split('.')[1]))
            studioRoles = payload?.app_metadata?.roles ?? []
            if (payload?.restaurantId && isUuid(payload.restaurantId)) {
              jwtRestaurantId = payload.restaurantId
            }
          } catch { /* malformed token — no studio roles */ }
        }
        setUser({
          ...response.data.user,
          studioRoles,
          restaurantId: response.data.user.restaurantId || jwtRestaurantId || '',
        })
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

  // Centralized branch fetch — reused by initial load and refreshBranches()
  // IMPORTANT: preserves activeRestaurantId via the validSaved check below.
  // Do NOT reset activeRestaurantId on refresh — the validSaved check handles it correctly.
  const fetchAndSetBranches = useCallback(async (fallbackRestaurantId?: string) => {
    const requestId = ++branchFetchSeq.current
    const resolveJwtRestaurantId = (): string | null => {
      try {
        const token = localStorage.getItem('accessToken')
        if (!token) return null
        const payload = JSON.parse(atob(token.split('.')[1]))
        const rid = payload?.restaurantId as string | undefined
        return rid && isUuid(rid) ? rid : null
      } catch {
        return null
      }
    }

    const readCachedBranches = (): RestaurantBranch[] => {
      try {
        const raw = localStorage.getItem('availableRestaurants')
        if (!raw) return []
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return parsed.filter(
          (b: RestaurantBranch) => b && typeof b.id === 'string' && isUuid(b.id),
        )
      } catch {
        return []
      }
    }

    const applyBranches = (branches: RestaurantBranch[]) => {
      if (requestId !== branchFetchSeq.current) return
      setAvailableRestaurants(branches)
      localStorage.setItem('availableRestaurants', JSON.stringify(branches))

      const savedId = localStorage.getItem('activeRestaurantId')
      const validSaved = savedId && branches.some((b) => b.id === savedId)
      const resolvedActive = validSaved ? savedId : branches[0].id

      setActiveRestaurantIdState(resolvedActive)
      localStorage.setItem('activeRestaurantId', resolvedActive)
      api.defaults.headers.common['X-Restaurant-Id'] = resolvedActive
      useAuthStore.getState().setActiveRestaurantId(resolvedActive)
    }

    try {
      const response = await api.get('/api/v1/organizations/branches')
      if (requestId !== branchFetchSeq.current) return

      const raw = response.data
      const branches: RestaurantBranch[] = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.data)
          ? raw.data
          : []

      if (branches.length > 0) {
        applyBranches(branches)
        return
      }
    } catch (err) {
      console.warn('Failed to fetch branches, falling back to single restaurant:', err)
    }

    if (requestId !== branchFetchSeq.current) return

    // Prefer a previously fetched multi-location list over inventing a single stub.
    const cached = readCachedBranches()
    if (cached.length > 1) {
      applyBranches(cached)
      return
    }

    // Fallback: org-less / legacy user — NEVER use userId as restaurantId
    const savedId = localStorage.getItem('activeRestaurantId')
    const candidate =
      (fallbackRestaurantId && isUuid(fallbackRestaurantId) ? fallbackRestaurantId : null) ||
      resolveJwtRestaurantId() ||
      (savedId && isUuid(savedId) ? savedId : null) ||
      cached[0]?.id ||
      null

    if (!candidate) {
      console.warn('No restaurant context available for branch fallback')
      return
    }

    const fallbackBranch: RestaurantBranch =
      cached.find((b) => b.id === candidate) ?? {
        id: candidate,
        name: 'My Restaurant',
        city: null,
        chain_id: null,
        chain_name: null,
      }
    applyBranches([fallbackBranch])
  }, [])

  useEffect(() => {
    if (!user) {
      setActiveRole(null)
      return
    }
    const tid = activeRestaurantId
    const token = localStorage.getItem('accessToken')
    if (!tid || !token || !isUuid(tid)) {
      setActiveRole(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const { data } = await api.get('/api/v1/auth/me/role', {
          params: { restaurantId: tid },
        })
        if (cancelled) return
        const r = data.role as string | null | undefined
        if (r && ['owner', 'manager', 'staff'].includes(r)) {
          setActiveRole(r as 'owner' | 'manager' | 'staff')
        } else setActiveRole(null)
      } catch {
        if (!cancelled) setActiveRole(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user, activeRestaurantId])

  // Public refresh — can be called after chain/location changes to update the branch switcher
  const refreshBranches = useCallback(async () => {
    if (!user?.userId) return
    await fetchAndSetBranches(user.restaurantId)
  }, [user, fetchAndSetBranches])

  // Sync restaurant context when user changes
  useEffect(() => {
    if (!user) {
      setAvailableRestaurants([])
      setActiveRestaurantIdState(null)
      setActiveRole(null)
      return
    }

    fetchAndSetBranches(user.restaurantId)
  }, [user, fetchAndSetBranches])

  const setActiveRestaurantId = useCallback(async (restaurantId: string) => {
    if (!isUuid(restaurantId)) {
      return
    }

    try {
      // Re-issue JWT scoped to the new restaurant so backend API calls use the correct tenant.
      const response = await api.post('/api/v1/auth/switch-restaurant', { restaurantId })
      const { accessToken, refreshToken } = response.data

      localStorage.setItem('accessToken', accessToken)
      localStorage.setItem('refreshToken', refreshToken)
      api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`
    } catch (err) {
      console.warn('switch-restaurant failed, proceeding with X-Restaurant-Id header only', err)
    }

    setActiveRestaurantIdState(restaurantId)
    localStorage.setItem('activeRestaurantId', restaurantId)
    api.defaults.headers.common['X-Restaurant-Id'] = restaurantId
    // Sync Zustand store so all consumers (Providers, Dashboard, etc.) re-render immediately
    useAuthStore.getState().setActiveRestaurantId(restaurantId)
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
      // A network-level failure says what the person can do about it, and
      // nothing else. It used to read "Start the API Gateway: cd
      // apps/api-gateway && pnpm start:dev" — a developer instruction that
      // shipped to production and told a customer on mudavym.com to run a
      // terminal command. It was also misleading in the case that actually
      // occurred: the gateway was running fine and the real cause was a
      // CORS-blocked origin, which a browser reports as an indistinguishable
      // network error. Say the honest thing — we could not reach it — and
      // leave the diagnosis to the logs.
      const message = err?.code === 'ERR_NETWORK' && !err?.response
        ? "We couldn't reach the server. Check your connection and try again — if this keeps happening, it's on our side, not yours."
        : (err?.response?.data?.message || err?.message || 'Login failed.')
      setError(message)
      // Preserve the structured { code, provider } the backend sends for
      // OAuth-only accounts — callers (Login.tsx) branch on `provider` to
      // decide which sign-in flow to redirect into. Don't make them
      // regex-parse the human-readable `message` for that.
      throw new LoginError(message, err?.response?.data?.code, err?.response?.data?.provider)
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

  const registerRestaurant = useCallback(async (data: RegisterRestaurantData) => {
    try {
      setError(null)
      setLoading(true)
      const response = await api.post('/api/v1/auth/register/restaurant', {
        ...data,
        timezone: data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
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

  const joinViaInvite = useCallback(async (data: JoinViaInviteData) => {
    try {
      setError(null)
      setLoading(true)
      const response = await api.post('/api/v1/auth/join', data)
      const { accessToken, refreshToken: refresh } = response.data
      localStorage.setItem('accessToken', accessToken)
      localStorage.setItem('refreshToken', refresh)
      api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`
      const userResponse = await api.get('/api/v1/auth/me')
      setUser(userResponse.data.user)
    } catch (err: any) {
      const message = err.response?.data?.message || 'Failed to join restaurant'
      setError(message)
      throw new Error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  const resolveSignInMethods = useCallback(
    async (email: string): Promise<SignInMethodsResult> => {
      const normalized = email.trim().toLowerCase()
      try {
        const response = await api.post('/api/v1/auth/sign-in-methods', {
          email: normalized,
        })
        const { methods, unavailable, declared, noSignInMethod } = response.data
        // Trust the server's shape, but never let a malformed payload render
        // an empty page: an unusable response is the same situation as an
        // unreachable one.
        if (!Array.isArray(methods)) return fallbackSignInMethods(normalized)
        return {
          email: response.data.email ?? normalized,
          methods,
          unavailable: Array.isArray(unavailable) ? unavailable : [],
          declared: Array.isArray(declared) ? declared : [],
          noSignInMethod: noSignInMethod === true,
        }
      } catch {
        // Deliberately swallowed. A 429, a 500 or a dead gateway must not
        // strand someone on a page that used to work — they get the standard
        // form and the existing "Invalid credentials" path.
        return fallbackSignInMethods(normalized)
      }
    },
    [],
  )

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
      setActiveRole(null)
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

  const clearError = useCallback(() => setError(null), [])

  const value: AuthContextType = {
    user,
    loading,
    error,
    clearError,
    activeRestaurantId,
    activeRole,
    availableRestaurants,
    setActiveRestaurantId,
    login,
    register,
    registerRestaurant,
    joinViaInvite,
    loginWithGoogle,
    loginWithMicrosoft,
    resolveSignInMethods,
    logout,
    refreshToken: refreshTokenFn,
    refreshBranches,
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
