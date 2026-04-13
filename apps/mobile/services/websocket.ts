import io, { Socket } from 'socket.io-client';
import { getWebSocketUrl } from '../constants/Config';
import * as SecureStore from 'expo-secure-store';

let socket: Socket | null = null;

/**
 * Initialize WebSocket connection
 */
export async function initWebSocket(restaurantId: string): Promise<Socket> {
  if (socket?.connected) {
    return socket;
  }

  // Get auth token for connection
  const token = await SecureStore.getItemAsync('auth_token');
  
  const wsUrl = getWebSocketUrl();
  
  socket = io(wsUrl, {
    transports: ['websocket'],
    autoConnect: false,
    auth: {
      token,
      restaurantId,
    },
  });

  // Connection events
  socket.on('connect', () => {
    console.log('✅ WebSocket connected');
    
    // Subscribe to restaurant-specific events
    socket?.emit('subscribe', { restaurantId });
  });

  socket.on('disconnect', (reason) => {
    console.log('❌ WebSocket disconnected:', reason);
  });

  socket.on('connect_error', (error) => {
    console.error('❌ WebSocket connection error:', error);
  });

  // Connect
  socket.connect();

  return socket;
}

/**
 * Get current socket instance
 */
export function getSocket(): Socket | null {
  return socket;
}

/**
 * Disconnect WebSocket
 */
export function disconnectWebSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/**
 * Subscribe to events
 */
export function subscribeToEvent(
  event: string,
  callback: (data: any) => void
): void {
  if (socket) {
    socket.on(event, callback);
  }
}

/**
 * Unsubscribe from events
 */
export function unsubscribeFromEvent(
  event: string,
  callback?: (data: any) => void
): void {
  if (socket) {
    if (callback) {
      socket.off(event, callback);
    } else {
      socket.off(event);
    }
  }
}

/**
 * Emit event to server
 */
export function emitEvent(event: string, data: any): void {
  if (socket?.connected) {
    socket.emit(event, data);
  } else {
    console.warn('⚠️ WebSocket not connected, cannot emit:', event);
  }
}

