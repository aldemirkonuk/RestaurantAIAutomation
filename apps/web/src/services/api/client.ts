/**
 * API Client Configuration
 * 
 * Base axios client configured for the NestJS API Gateway.
 * Handles authentication, error handling, and request/response interceptors.
 */

import axios, { AxiosInstance, AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';

/** Decode JWT exp claim — returns expiry timestamp in ms, or 0 if unreadable */
function jwtExpiry(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return (payload.exp ?? 0) * 1000
  } catch {
    return 0
  }
}

/** Deduplicated in-flight refresh promise so concurrent requests don't race */
let refreshPromise: Promise<string> | null = null

async function ensureFreshToken(): Promise<string | null> {
  const token = localStorage.getItem('accessToken')
  if (!token) return null

  const expiry = jwtExpiry(token)
  // expiry === 0 means the claim couldn't be decoded (non-standard format, Supabase variant, etc.)
  // Treat as valid and let the server reject — don't force a refresh on every request.
  // Only refresh when we KNOW the token expires within 60 seconds.
  if (expiry === 0 || expiry - Date.now() > 60_000) return token

  const refreshToken = localStorage.getItem('refreshToken')
  if (!refreshToken) return token

  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'}/api/v1/auth/refresh`, { refreshToken })
      .then((res) => {
        const { accessToken, refreshToken: newRefresh } = res.data
        localStorage.setItem('accessToken', accessToken)
        if (newRefresh) localStorage.setItem('refreshToken', newRefresh)
        return accessToken as string
      })
      .finally(() => { refreshPromise = null })
  }

  try {
    return await refreshPromise
  } catch {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    window.location.href = '/login'
    return null
  }
}

// API Gateway URL from environment
const API_GATEWAY_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000';

/**
 * Create and configure the axios client
 */
function createApiClient(): AxiosInstance {
  const client = axios.create({
    baseURL: `${API_GATEWAY_URL}/api/v1`,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Request interceptor — proactively refresh token if near expiry, then attach headers
  client.interceptors.request.use(
    async (config: InternalAxiosRequestConfig) => {
      const token = await ensureFreshToken()
      if (token) {
        config.headers.Authorization = `Bearer ${token}`
      }

      const restaurantId = localStorage.getItem('activeRestaurantId')
      if (restaurantId) {
        config.headers['X-Restaurant-Id'] = restaurantId
      }

      return config
    },
    (error) => Promise.reject(error)
  )

  // Response interceptor — fallback 401 handling (token was valid but still rejected)
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean }

      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true
        // Force a refresh regardless of expiry (server may have revoked the token)
        localStorage.removeItem('accessToken') // ensure ensureFreshToken re-fetches
        const newToken = await ensureFreshToken()
        if (newToken && originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newToken}`
          return client(originalRequest)
        }
      }

      return Promise.reject(error)
    }
  )

  return client;
}

// Export singleton instance
export const apiClient = createApiClient();

/**
 * API Error type for consistent error handling
 */
export interface ApiError {
  message: string;
  statusCode: number;
  error?: string;
  details?: Record<string, any>;
}

/**
 * Extract error message from API error response
 */
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const apiError = error.response?.data as ApiError | undefined;
    return apiError?.message || error.message || 'An unexpected error occurred';
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unexpected error occurred';
}

/**
 * Helper to get active restaurant ID
 */
export function getActiveRestaurantId(): string {
  return localStorage.getItem('activeRestaurantId') || '';
}

export default apiClient;
