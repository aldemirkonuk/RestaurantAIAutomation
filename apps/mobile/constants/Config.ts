import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * Get the correct localhost URL based on the platform
 * 
 * - iOS Simulator: localhost works
 * - Android Emulator: Must use 10.0.2.2 (special IP that maps to host's localhost)
 * - Physical Device: Use your Mac's IP address (find with: ifconfig | grep "inet ")
 * - Web (Expo): localhost works
 */
function getLocalhostUrl(): string {
  const isDev = __DEV__;
  
  if (!isDev) {
    // Production: Use your production API URL
    return 'https://api.wineops.ai';
  }

  // Development: Platform-specific localhost handling
  if (Platform.OS === 'android') {
    // Android Emulator uses special IP to access host machine
    return 'http://10.0.2.2:4000';
  }
  
  if (Platform.OS === 'ios') {
    // iOS Simulator can use localhost
    return 'http://localhost:4000';
  }
  
  if (Platform.OS === 'web') {
    // Web (Expo) can use localhost
    return 'http://localhost:4000';
  }

  // Default fallback
  return 'http://localhost:4000';
}

/**
 * Get your Mac's local IP address for physical device testing
 * Run this command to find it: ifconfig | grep "inet " | grep -v 127.0.0.1
 * 
 * Current Mac IP detected: 10.103.240.113
 * Update this if your IP changes!
 */
function getPhysicalDeviceUrl(): string {
  // Replace with your Mac's IP address
  // Find it with: ifconfig | grep "inet " | grep -v 127.0.0.1
  const MAC_IP = '10.103.240.113'; // Update this!
  return `http://${MAC_IP}:4000`;
}

/**
 * API Configuration
 */
export const API_CONFIG = {
  // Base API URL
  BASE_URL: getLocalhostUrl(),
  
  // WebSocket URL
  WS_URL: getLocalhostUrl().replace('http://', 'ws://').replace('https://', 'wss://'),
  
  // For physical device testing (uncomment and use this instead of BASE_URL)
  // BASE_URL: getPhysicalDeviceUrl(),
  // WS_URL: getPhysicalDeviceUrl().replace('http://', 'ws://'),
  
  // API Endpoints
  ENDPOINTS: {
    // Auth
    AUTH: {
      LOGIN: '/api/v1/auth/login',
      REGISTER: '/api/v1/auth/register',
      LOGOUT: '/api/v1/auth/logout',
      REFRESH: '/api/v1/auth/refresh',
      ME: '/api/v1/auth/me',
    },
    
    // Inventory
    INVENTORY: {
      LIST: '/api/v1/inventory',
      ITEM: (id: string) => `/api/v1/inventory/${id}`,
      UPDATE: (id: string) => `/api/v1/inventory/${id}`,
    },
    
    // Orders
    ORDERS: {
      LIST: '/api/v1/procurement/orders',
      CREATE: '/api/v1/procurement/orders',
      APPROVE: (id: string) => `/api/v1/procurement/orders/${id}/approve`,
      CANCEL: (id: string) => `/api/v1/procurement/orders/${id}/cancel`,
      DELIVER: (id: string) => `/api/v1/procurement/orders/${id}/deliver`,
    },
    
    // Notifications
    NOTIFICATIONS: {
      LIST: '/api/v1/notifications',
      MARK_READ: (id: string) => `/api/v1/notifications/${id}/read`,
    },
  },
  
  // Timeouts
  TIMEOUT: 10000, // 10 seconds
  
  // Retry config
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // 1 second
};

/**
 * Helper to build full API URL
 */
export const getApiUrl = (endpoint: string): string => {
  return `${API_CONFIG.BASE_URL}${endpoint}`;
};

/**
 * Helper to build WebSocket URL
 */
export const getWebSocketUrl = (): string => {
  return API_CONFIG.WS_URL;
};

/**
 * Debug helper: Log current configuration
 */
export const logConfig = () => {
  if (__DEV__) {
    console.log('📱 API Configuration:');
    console.log(`   Platform: ${Platform.OS}`);
    console.log(`   Base URL: ${API_CONFIG.BASE_URL}`);
    console.log(`   WebSocket URL: ${API_CONFIG.WS_URL}`);
    console.log(`   Is Dev: ${__DEV__}`);
  }
};

