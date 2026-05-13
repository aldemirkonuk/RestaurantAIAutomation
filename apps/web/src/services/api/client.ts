/**
 * API Client Configuration
 *
 * Synchronous request setup + reactive 401 handling.
 *
 * Design principles:
 *  1. Request interceptor is SYNCHRONOUS — it only reads localStorage and
 *     attaches headers. No async/await, no HTTP calls, no blocking.
 *  2. Token refresh is REACTIVE — it only happens when the server actually
 *     returns 401, not speculatively. This eliminates the "async barrier"
 *     that previously serialized all parallel page-load requests behind a
 *     token refresh round-trip.
 *  3. Refresh is DEDUPLICATED — a single in-flight refreshPromise is shared
 *     by all concurrent 401 responses so the refresh endpoint is called
 *     at most once per expiry cycle, regardless of how many requests failed.
 */

import axios, { AxiosInstance, AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';

const API_GATEWAY_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000';

/** Single in-flight refresh promise — shared across all concurrent 401s */
let refreshPromise: Promise<string> | null = null;

/**
 * Exchange the refresh token for a new access token.
 * Throws (does NOT navigate) when there is no refresh token — the caller is
 * responsible for deciding whether to redirect. This prevents an infinite
 * reload loop when the SyncManager makes API calls while the user is already
 * logged out (no token → 401 → doTokenRefresh → window.location.href →
 * page reload → SyncManager restarts → repeat).
 */
async function doTokenRefresh(): Promise<string> {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) {
    throw new Error('No refresh token available');
  }

  const response = await axios.post(
    `${API_GATEWAY_URL}/api/v1/auth/refresh`,
    { refreshToken },
  );
  const { accessToken, refreshToken: newRefresh } = response.data;
  localStorage.setItem('accessToken', accessToken);
  if (newRefresh) localStorage.setItem('refreshToken', newRefresh);
  return accessToken as string;
}

function createApiClient(): AxiosInstance {
  const client = axios.create({
    baseURL: `${API_GATEWAY_URL}/api/v1`,
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
  });

  // ─── Request interceptor — SYNCHRONOUS ──────────────────────────────────
  // Just reads localStorage and stamps the headers. Never awaits anything.
  // This means all parallel queries on a page mount fire immediately instead
  // of being serialized behind a token-refresh round-trip.
  client.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      const token = localStorage.getItem('accessToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      const restaurantId = localStorage.getItem('activeRestaurantId');
      if (restaurantId) {
        config.headers['X-Restaurant-Id'] = restaurantId;
      }

      return config;
    },
    (error) => Promise.reject(error),
  );

  // ─── Response interceptor — reactive 401 handling ───────────────────────
  // When the server rejects a token (expired or revoked), we:
  //   1. Start a single refresh call (or join the in-flight one)
  //   2. Retry the original request with the new token
  //   3. If refresh fails, clear auth and redirect to /login
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;

        // If there is no refresh token the user is logged out — don't attempt
        // a refresh and do NOT navigate. Just reject so the caller can handle
        // the 401 gracefully (e.g. SyncManager skips, queries show an error).
        if (!localStorage.getItem('refreshToken')) {
          return Promise.reject(error);
        }

        // Deduplicate: all concurrent 401s share the same refresh call
        if (!refreshPromise) {
          refreshPromise = doTokenRefresh()
            .catch((err) => {
              // Refresh endpoint itself failed (expired/revoked) — clear tokens
              // and send the user back to login only in this case.
              localStorage.removeItem('accessToken');
              localStorage.removeItem('refreshToken');
              window.location.href = '/login';
              throw err;
            })
            .finally(() => {
              refreshPromise = null;
            });
        }

        try {
          const newToken = await refreshPromise;
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
          }
          return client(originalRequest);
        } catch {
          return Promise.reject(error);
        }
      }

      return Promise.reject(error);
    },
  );

  return client;
}

export const apiClient = createApiClient();

export interface ApiError {
  message: string;
  statusCode: number;
  error?: string;
  details?: Record<string, any>;
}

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

export function getActiveRestaurantId(): string {
  return localStorage.getItem('activeRestaurantId') || '';
}

export default apiClient;
