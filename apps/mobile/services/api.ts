import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_CONFIG, getApiUrl } from '../constants/Config';

/**
 * Create axios instance with base configuration
 */
const api: AxiosInstance = axios.create({
  baseURL: API_CONFIG.BASE_URL,
  timeout: API_CONFIG.TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Request interceptor: Add auth token to requests
 */
api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    try {
      // Get auth token from secure storage
      const token = await SecureStore.getItemAsync('auth_token');
      
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (error) {
      console.error('Error getting auth token:', error);
    }
    
    // Log request in dev mode
    if (__DEV__) {
      console.log(`🚀 ${config.method?.toUpperCase()} ${config.url}`);
    }
    
    return config;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  }
);

/**
 * Response interceptor: Handle errors and token refresh
 */
api.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    
    // Handle 401 Unauthorized (token expired)
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      try {
        // Try to refresh token
        const refreshToken = await SecureStore.getItemAsync('refresh_token');
        
        if (refreshToken) {
          const response = await axios.post(getApiUrl(API_CONFIG.ENDPOINTS.AUTH.REFRESH), {
            refreshToken,
          });
          
          const { accessToken } = response.data;
          
          // Store new token
          await SecureStore.setItemAsync('auth_token', accessToken);
          
          // Retry original request with new token
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          }
          
          return api(originalRequest);
        }
      } catch (refreshError) {
        // Refresh failed, logout user
        await SecureStore.deleteItemAsync('auth_token');
        await SecureStore.deleteItemAsync('refresh_token');
        
        // You can dispatch a logout action here if using Redux/Zustand
        // For now, we'll just reject the error
        return Promise.reject(refreshError);
      }
    }
    
    // Log error in dev mode
    if (__DEV__) {
      console.error('❌ API Error:', {
        url: originalRequest?.url,
        method: originalRequest?.method,
        status: error.response?.status,
        data: error.response?.data,
      });
    }
    
    return Promise.reject(error);
  }
);

/**
 * API Service Methods
 */
export const apiService = {
  // Auth
  async login(email: string, password: string) {
    const response = await api.post(API_CONFIG.ENDPOINTS.AUTH.LOGIN, {
      email,
      password,
    });
    
    // Store tokens securely
    if (response.data.accessToken) {
      await SecureStore.setItemAsync('auth_token', response.data.accessToken);
    }
    if (response.data.refreshToken) {
      await SecureStore.setItemAsync('refresh_token', response.data.refreshToken);
    }
    
    return response.data;
  },
  
  async register(data: { email: string; password: string; name: string; restaurantId?: string }) {
    const response = await api.post(API_CONFIG.ENDPOINTS.AUTH.REGISTER, data);
    return response.data;
  },
  
  async logout() {
    try {
      await api.post(API_CONFIG.ENDPOINTS.AUTH.LOGOUT);
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      // Always clear tokens
      await SecureStore.deleteItemAsync('auth_token');
      await SecureStore.deleteItemAsync('refresh_token');
    }
  },
  
  async getCurrentUser() {
    const response = await api.get(API_CONFIG.ENDPOINTS.AUTH.ME);
    return response.data;
  },
  
  // Inventory
  async getInventory() {
    const response = await api.get(API_CONFIG.ENDPOINTS.INVENTORY.LIST);
    return response.data;
  },
  
  async getInventoryItem(id: string) {
    const response = await api.get(API_CONFIG.ENDPOINTS.INVENTORY.ITEM(id));
    return response.data;
  },
  
  // Orders
  async getOrders() {
    const response = await api.get(API_CONFIG.ENDPOINTS.ORDERS.LIST);
    return response.data;
  },
  
  async approveOrder(orderId: string) {
    const response = await api.post(API_CONFIG.ENDPOINTS.ORDERS.APPROVE(orderId));
    return response.data;
  },
  
  async cancelOrder(orderId: string) {
    const response = await api.post(API_CONFIG.ENDPOINTS.ORDERS.CANCEL(orderId));
    return response.data;
  },
  
  async deliverOrder(orderId: string) {
    const response = await api.post(API_CONFIG.ENDPOINTS.ORDERS.DELIVER(orderId));
    return response.data;
  },
  
  // Notifications
  async getNotifications() {
    const response = await api.get(API_CONFIG.ENDPOINTS.NOTIFICATIONS.LIST);
    return response.data;
  },
  
  async markNotificationRead(notificationId: string) {
    const response = await api.post(API_CONFIG.ENDPOINTS.NOTIFICATIONS.MARK_READ(notificationId));
    return response.data;
  },
};

export default api;

