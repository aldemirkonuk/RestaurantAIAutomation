/**
 * API Client Configuration
 * 
 * Base axios client configured for the NestJS API Gateway.
 * Handles authentication, error handling, and request/response interceptors.
 */

import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios';

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

  // Request interceptor - add auth token and restaurant ID
  client.interceptors.request.use(
    (config) => {
      // Add auth token
      const token = localStorage.getItem('accessToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      // Add restaurant ID header
      const restaurantId = localStorage.getItem('activeRestaurantId');
      if (restaurantId) {
        config.headers['X-Restaurant-Id'] = restaurantId;
      }

      return config;
    },
    (error) => Promise.reject(error)
  );

  // Response interceptor - handle errors and token refresh
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

      // Handle 401 Unauthorized - try to refresh token
      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;

        try {
          const refreshToken = localStorage.getItem('refreshToken');
          if (refreshToken) {
            const response = await axios.post(`${API_GATEWAY_URL}/api/v1/auth/refresh`, {
              refreshToken,
            });

            const { accessToken, refreshToken: newRefresh } = response.data;
            localStorage.setItem('accessToken', accessToken);
            localStorage.setItem('refreshToken', newRefresh);

            // Retry the original request
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${accessToken}`;
            }
            return client(originalRequest);
          }
        } catch (refreshError) {
          // Refresh failed, clear tokens and redirect to login
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          window.location.href = '/login';
        }
      }

      return Promise.reject(error);
    }
  );

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
