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
import { goToChooser, noteHouseEnded, storeSession } from '../../lib/houseMemory';

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
  const { accessToken, refreshToken: newRefresh, houseAccessEnded } = response.data;
  storeSession(accessToken, newRefresh);
  // The session's house ended (ADR 0164, R5): the new pair names no house.
  // The person chooses; retrying this request would only be refused again.
  if (noteHouseEnded(accessToken, houseAccessEnded?.restaurantId)) {
    goToChooser();
    throw new HouseAccessEnded();
  }
  return accessToken as string;
}

/** Thrown by a refresh whose answer was "that house is no longer yours". */
class HouseAccessEnded extends Error {
  constructor() {
    super('Your access to this house has ended.');
    this.name = 'HouseAccessEnded';
  }
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
              // Only a refused refresh token ends the session (a 401 from the
              // refresh route). A house that ended already sent the person to
              // the chooser; a 503 or a dropped connection says "try again",
              // not "you are not who you said you were" (ADR 0164).
              const status = (err as AxiosError)?.response?.status;
              if (!(err instanceof HouseAccessEnded) && status === 401) {
                localStorage.removeItem('accessToken');
                localStorage.removeItem('refreshToken');
                window.location.href = '/login';
              }
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

      // OD-79. The API now refuses gated routes for an unverified account.
      // ProtectedRoute catches this on navigation, but not for a request fired
      // by an already-mounted page, a background refetch, or a direct link —
      // those would surface a bare "Forbidden" that tells the user nothing
      // about what to do. Route on the code, not the prose.
      if (
        error.response?.status === 403 &&
        (error.response.data as { code?: string } | undefined)?.code ===
          'EMAIL_NOT_VERIFIED' &&
        window.location.pathname !== '/verify-email'
      ) {
        window.location.href = '/verify-email';
      }

      // ADR 0164, R4: a session in no house asked for something that belongs
      // to a house. The person has not chosen one yet.
      if (
        error.response?.status === 403 &&
        (error.response.data as { code?: string } | undefined)?.code === 'HOUSE_REQUIRED'
      ) {
        goToChooser();
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

/**
 * The HTTP status of a request failure, or null when there is none to read.
 *
 * Duck-typed on `response.status` rather than gated on `axios.isAxiosError` —
 * that check requires the `isAxiosError` marker axios itself stamps on, which
 * a plain `Object.assign(new Error(...), { response: { status } })` (how a
 * live caller's status is read elsewhere, e.g. `ApproveFromBellPanel.tsx`,
 * `SealedApproveDie.tsx`, `useBellBook.ts`) does not carry.
 */
export function getErrorStatus(error: unknown): number | null {
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === 'number' ? status : null;
}

/**
 * True when a write's outcome is genuinely unknown: the server errored after
 * it may have already committed (5xx), or the request went out and nothing
 * came back at all (a live axios request with no response — a timeout or a
 * dropped connection). Anything else (a 4xx, or no network evidence at all —
 * a caller-side throw before any request was sent) is a real refusal, and a
 * caller may say so with "nothing was written".
 */
export function isUnconfirmedWrite(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status != null) return status >= 500;
  return Boolean(axios.isAxiosError(error) && error.request && !error.response);
}

export function getActiveRestaurantId(): string {
  return localStorage.getItem('activeRestaurantId') || '';
}

export default apiClient;
