/**
 * State-of-the-Art WebSocket Provider
 * ====================================
 * Production-grade real-time communication with:
 * - Automatic reconnection with exponential backoff
 * - Connection state machine
 * - Event-driven architecture with TypeScript
 * - Optimistic updates support
 * - Heartbeat/ping-pong for connection health
 * - Message queuing during disconnection
 * - React Query integration for cache invalidation
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from 'react'
import { io, Socket } from 'socket.io-client'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { queryKeys } from './query-keys'

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

/** WebSocket connection states */
enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error',
}

/** Event types from server */
export interface ServerEvents {
  'connection:success': { message: string; timestamp: string }
  'stock:updated': StockUpdatedEvent
  'stock:low': LowStockAlertEvent
  'order:created': OrderCreatedEvent
  'order:status_changed': OrderStatusChangedEvent
  'notification:new': NotificationEvent
  'report:ready': ReportReadyEvent
  'calendar:event_created': CalendarEventCreatedEvent
  'calendar:event_updated': CalendarEventUpdatedEvent
  'conversation:updated': ConversationUpdatedEvent
  'conversation:summary_updated': ConversationSummaryUpdatedEvent
  'system:message': SystemMessageEvent
  'event:new': EventRow
  'heartbeat': { timestamp: string }
}

export interface EventRow {
  id: string
  restaurant_id: string
  user_id: string | null
  event_type: string
  source_page: string
  payload: Record<string, unknown>
  schema_version: number
  idempotency_key: string | null
  trace_id: string | null
  correlation_id: string | null
  created_at: string
}

/** Event payloads */
export interface StockUpdatedEvent {
  event: 'StockUpdated'
  data: {
    inventory_id: string
    restaurant_id: string
    wine_name: string
    stock_before: number
    stock_after: number
  }
  timestamp: string
}

export interface LowStockAlertEvent {
  event: 'LowStockAlert'
  data: {
    inventory_id: string
    restaurant_id: string
    wine_name: string
    stock_after: number
    threshold: number
    urgency: 'low' | 'medium' | 'high' | 'critical'
    estimated_stockout_days: number
  }
  timestamp: string
}

export interface OrderCreatedEvent {
  event: 'OrderCreated'
  data: {
    order_id: string
    wine_name: string
    quantity: number
    provider_name: string
    target_price: number
  }
  timestamp: string
}

export interface OrderStatusChangedEvent {
  event: 'OrderStatusChanged'
  data: {
    order_id: string
    status: string
    previous_status: string
  }
  timestamp: string
}

export interface NotificationEvent {
  event: 'NewNotification'
  data: {
    id: string
    title: string
    message: string
    type: 'info' | 'success' | 'warning' | 'error'
    action_url?: string
  }
  timestamp: string
}

export interface ReportReadyEvent {
  event: 'ReportReady'
  data: {
    report_id: string
    report_type: string
    download_url: string
  }
  timestamp: string
}

export interface SystemMessageEvent {
  message: string
  level: 'info' | 'warning' | 'error'
  timestamp: string
}

export interface CalendarEventCreatedEvent {
  event: 'CalendarEventCreated'
  data: {
    event_id: string
    title: string
    event_type: string
    date: string
    start_time?: string
    end_time?: string
  }
  timestamp: string
}

export interface CalendarEventUpdatedEvent {
  event: 'CalendarEventUpdated'
  data: {
    event_id: string
    title: string
    event_type: string
    date: string
    start_time?: string
    end_time?: string
    changes?: Record<string, unknown>
  }
  timestamp: string
}

export interface ConversationUpdatedEvent {
  event: 'ConversationUpdated'
  data: {
    conversation_id: string
    provider_name?: string
    last_message?: string
  }
  timestamp: string
}

export interface ConversationSummaryUpdatedEvent {
  event: 'ConversationSummaryUpdated'
  data: {
    conversation_id: string
    summary: string
  }
  timestamp: string
}

/** Client events to server */
export interface ClientEvents {
  'subscribe:restaurant': { restaurantId: string }
  'unsubscribe:restaurant': { restaurantId: string }
  'ping': void
}

/** Connection configuration */
export interface WebSocketConfig {
  url: string
  autoConnect: boolean
  reconnection: boolean
  reconnectionAttempts: number
  reconnectionDelay: number
  reconnectionDelayMax: number
  timeout: number
  heartbeatInterval: number
}

/** Event handler type */
type EventHandler<T> = (data: T) => void

/** Event subscription */
interface EventSubscription {
  event: keyof ServerEvents
  handler: EventHandler<any>
}

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

const DEFAULT_CONFIG: WebSocketConfig = {
  url: import.meta.env.VITE_WS_URL || 'ws://localhost:4000',
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
  timeout: 20000,
  heartbeatInterval: 30000,
}

// =============================================================================
// WEBSOCKET CONTEXT
// =============================================================================

interface WebSocketContextType {
  /** Socket instance */
  socket: Socket | null
  
  /** Current connection state */
  connectionState: ConnectionState
  
  /** Whether connected and ready */
  isConnected: boolean
  
  /** Current reconnection attempt */
  reconnectAttempt: number
  
  /** Last error message */
  lastError: string | null
  
  /** Subscribe to a restaurant's events */
  subscribeToRestaurant: (restaurantId: string) => void
  
  /** Unsubscribe from a restaurant */
  unsubscribeFromRestaurant: (restaurantId: string) => void
  
  /** Add event listener */
  on: <K extends keyof ServerEvents>(event: K, handler: EventHandler<ServerEvents[K]>) => () => void
  
  /** Emit event to server */
  emit: <K extends keyof ClientEvents>(event: K, data: ClientEvents[K]) => void
  
  /** Force reconnect */
  reconnect: () => void
  
  /** Connection statistics (read via getter to avoid re-renders on every heartbeat) */
  getStats: () => ConnectionStats
}

interface ConnectionStats {
  connectedAt: Date | null
  disconnectedAt: Date | null
  totalReconnects: number
  messagesReceived: number
  messagesSent: number
  latencyMs: number | null
}

const WebSocketContext = createContext<WebSocketContextType | null>(null)

// =============================================================================
// CUSTOM HOOK
// =============================================================================

export function useWebSocket(): WebSocketContextType {
  const context = useContext(WebSocketContext)
  
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider')
  }
  
  return context
}

/** Hook for specific event subscription */
export function useWebSocketEvent<K extends keyof ServerEvents>(
  event: K,
  handler: EventHandler<ServerEvents[K]>,
  deps: React.DependencyList = []
): void {
  const { on } = useWebSocket()
  
  useEffect(() => {
    const unsubscribe = on(event, handler)
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, ...deps])
}

/** Hook for connection state */
export function useConnectionState(): {
  state: ConnectionState
  isConnected: boolean
  isReconnecting: boolean
} {
  const { connectionState, isConnected } = useWebSocket()
  
  return {
    state: connectionState,
    isConnected,
    isReconnecting: connectionState === ConnectionState.RECONNECTING,
  }
}

// =============================================================================
// PROVIDER COMPONENT
// =============================================================================

interface WebSocketProviderProps {
  children: ReactNode
  config?: Partial<WebSocketConfig>
  userId?: string
  restaurantId?: string
}

export function WebSocketProvider({
  children,
  config: userConfig,
  userId,
  restaurantId,
}: WebSocketProviderProps): JSX.Element {
  const { user, activeRestaurantId } = useAuth()
  const config = useMemo(
    () => ({ ...DEFAULT_CONFIG, ...userConfig }),
    [userConfig]
  )
  const resolvedUserId = userId || user?.userId
  const resolvedRestaurantId = restaurantId || activeRestaurantId
  const authToken = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null
  
  const queryClient = useQueryClient()
  
  // State
  const [socket, setSocket] = useState<Socket | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ConnectionState.DISCONNECTED
  )
  const [reconnectAttempt, setReconnectAttempt] = useState(0)
  const [lastError, setLastError] = useState<string | null>(null)
  const statsRef = useRef<ConnectionStats>({
    connectedAt: null,
    disconnectedAt: null,
    totalReconnects: 0,
    messagesReceived: 0,
    messagesSent: 0,
    latencyMs: null,
  })
  const updateStats = useCallback((updater: (prev: ConnectionStats) => ConnectionStats) => {
    statsRef.current = updater(statsRef.current)
  }, [])
  const getStats = useCallback(() => statsRef.current, [])
  
  // Refs
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const messageQueueRef = useRef<Array<{ event: string; data: any }>>([])
  const subscriptionsRef = useRef<Set<string>>(new Set())
  
  // =========================================================================
  // CONNECTION MANAGEMENT
  // =========================================================================
  
  useEffect(() => {
    console.log('🔌 Initializing WebSocket connection...')
    
    if (!authToken || !resolvedUserId) {
      setConnectionState(ConnectionState.DISCONNECTED)
      return
    }

    const newSocket = io(`${config.url}/ws`, {
      auth: { token: authToken },
      transports: ['websocket', 'polling'],
      reconnection: config.reconnection,
      reconnectionAttempts: config.reconnectionAttempts,
      reconnectionDelay: config.reconnectionDelay,
      reconnectionDelayMax: config.reconnectionDelayMax,
      timeout: config.timeout,
      autoConnect: config.autoConnect,
    })
    
    // Connection events
    newSocket.on('connect', () => {
      console.log('✅ WebSocket connected')
      setConnectionState(ConnectionState.CONNECTED)
      setReconnectAttempt(0)
      setLastError(null)
      updateStats(prev => ({
        ...prev,
        connectedAt: new Date(),
        disconnectedAt: null,
      }))
      
      // Start heartbeat
      startHeartbeat(newSocket)
      
      // Flush message queue
      flushMessageQueue(newSocket)
      
      // Resubscribe to restaurants
      subscriptionsRef.current.forEach(restaurantId => {
        newSocket.emit('subscribe:restaurant', { restaurantId })
      })
    })
    
    newSocket.on('disconnect', (reason) => {
      console.log(`❌ WebSocket disconnected: ${reason}`)
      setConnectionState(ConnectionState.DISCONNECTED)
      updateStats(prev => ({
        ...prev,
        disconnectedAt: new Date(),
      }))
      stopHeartbeat()
    })
    
    newSocket.on('connect_error', (error) => {
      console.error('🔴 Connection error:', error.message)
      setConnectionState(ConnectionState.ERROR)
      setLastError(error.message)
    })
    
    newSocket.io.on('reconnect_attempt', (attempt) => {
      console.log(`🔄 Reconnection attempt ${attempt}/${config.reconnectionAttempts}`)
      setConnectionState(ConnectionState.RECONNECTING)
      setReconnectAttempt(attempt)
    })
    
    newSocket.io.on('reconnect', (attempt) => {
      console.log(`✅ Reconnected after ${attempt} attempts`)
      updateStats(prev => ({
        ...prev,
        totalReconnects: prev.totalReconnects + 1,
      }))
    })
    
    newSocket.io.on('reconnect_failed', () => {
      console.error('❌ Reconnection failed after max attempts')
      setConnectionState(ConnectionState.ERROR)
      setLastError('Connection failed after maximum retry attempts')
      
      toast.error('Connection Lost', {
        description: 'Unable to connect to server. Please refresh the page.',
        duration: Infinity,
        action: {
          label: 'Retry',
          onClick: () => newSocket.connect(),
        },
      })
    })
    
    // Server events
    newSocket.on('connection:success', (data) => {
      console.log('🎉 Connection confirmed:', data)
    })
    
    newSocket.on('heartbeat', (data) => {
      const latency = Date.now() - new Date(data.timestamp).getTime()
      updateStats(prev => ({ ...prev, latencyMs: latency }))
    })
    
    // Business events with React Query cache invalidation
    newSocket.on('stock:updated', (data: StockUpdatedEvent) => {
      console.log('📦 Stock updated:', data)
      incrementMessagesReceived()
      
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.wines.all })
      
      window.dispatchEvent(new CustomEvent('inventory_change', {
        detail: { eventType: 'UPDATE', new: data.data, source: 'websocket' },
      }))
      window.dispatchEvent(new CustomEvent('ws:dashboard-invalidate'))
    })
    
    newSocket.on('stock:low', (data: LowStockAlertEvent) => {
      console.log('🚨 Low stock alert:', data)
      incrementMessagesReceived()
      
      // Show toast notification
      const urgencyColors = {
        critical: 'error',
        high: 'warning',
        medium: 'warning',
        low: 'info',
      } as const
      
      toast[urgencyColors[data.data.urgency] || 'warning'](
        `Low Stock: ${data.data.wine_name}`,
        {
          description: `Only ${data.data.stock_after} bottles left (threshold: ${data.data.threshold})`,
          duration: data.data.urgency === 'critical' ? Infinity : 5000,
        }
      )
      
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
      
      window.dispatchEvent(new CustomEvent('inventory_change', {
        detail: { eventType: 'UPDATE', new: data.data, source: 'websocket' },
      }))
      window.dispatchEvent(new CustomEvent('ws:dashboard-invalidate'))
    })
    
    newSocket.on('order:created', (data: OrderCreatedEvent) => {
      console.log('📋 Order created:', data)
      incrementMessagesReceived()
      
      toast.success('Order Created', {
        description: `${data.data.quantity}x ${data.data.wine_name} from ${data.data.provider_name}`,
      })
      
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all })
      
      window.dispatchEvent(new CustomEvent('order_change', {
        detail: { eventType: 'INSERT', new: data.data, source: 'websocket' },
      }))
      window.dispatchEvent(new CustomEvent('ws:dashboard-invalidate'))
    })
    
    newSocket.on('order:status_changed', (data: OrderStatusChangedEvent) => {
      console.log('📋 Order status changed:', data)
      incrementMessagesReceived()
      
      toast.info('Order Updated', {
        description: `Order status: ${data.data.previous_status} → ${data.data.status}`,
      })
      
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all })
      
      window.dispatchEvent(new CustomEvent('order_change', {
        detail: { eventType: 'UPDATE', new: data.data, source: 'websocket' },
      }))
      window.dispatchEvent(new CustomEvent('ws:dashboard-invalidate'))
    })
    
    newSocket.on('notification:new', (data: NotificationEvent) => {
      console.log('🔔 New notification:', data)
      incrementMessagesReceived()
      
      const toastFn = data.data.type === 'error' ? toast.error
        : data.data.type === 'success' ? toast.success
        : data.data.type === 'warning' ? toast.warning
        : toast.info
      
      toastFn(data.data.title, {
        description: data.data.message,
        action: data.data.action_url ? {
          label: 'View',
          onClick: () => window.location.href = data.data.action_url!,
        } : undefined,
      })
      
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all })
      
      window.dispatchEvent(new CustomEvent('notification_sent', {
        detail: { eventType: 'INSERT', new: data.data, source: 'websocket' },
      }))
    })
    
    // AI Conversation Approval (80% Push + 20% OneTap)
    newSocket.on('ai:conversation_approval', (data: any) => {
      console.log('🤖 AI conversation needs approval:', data)
      incrementMessagesReceived()
      
      // Browser Push Notification (PRIMARY: 80%)
      if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification('🤖 AI Needs Approval', {
          body: `${data.provider_name}: ${data.ai_message.slice(0, 60)}...`,
          icon: '/wine-icon.png',
          badge: '/badge.png',
          tag: data.conversation_id,
          requireInteraction: true,
        })
        
        notification.onclick = () => {
          window.location.href = `/conversations/${data.conversation_id}`
        }
      }
      
      // Also show in-app toast with action
      toast.info('🤖 AI Needs Your Approval', {
        description: `Message to ${data.provider_name} about ${data.wine_name}`,
        duration: 10000,
        action: {
          label: 'Review',
          onClick: () => {
            // This will trigger OneTapActionCenter (SECONDARY: 20%)
            queryClient.invalidateQueries({ queryKey: ['onetap-actions'] })
            window.location.href = '/dashboard'
          },
        },
      })
      
      // Invalidate queries to update UI
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] })
      queryClient.invalidateQueries({ queryKey: ['onetap-actions'] })
    })
    
    // AI Conversation Resumed (confirmation after approval)
    newSocket.on('ai:conversation_resumed', (data: any) => {
      console.log('✅ AI conversation resumed:', data)
      incrementMessagesReceived()
      
      toast.success('Message Sent', {
        description: `AI message to ${data.provider_name} was sent successfully`,
      })
      
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] })
    })
    
    newSocket.on('report:ready', (data: ReportReadyEvent) => {
      console.log('📊 Report ready:', data)
      incrementMessagesReceived()
      
      toast.success('Report Ready', {
        description: `Your ${data.data.report_type} report is ready`,
        action: {
          label: 'Download',
          onClick: () => window.open(data.data.download_url, '_blank'),
        },
      })
      
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all })
      
      window.dispatchEvent(new CustomEvent('report_event', {
        detail: { eventType: 'INSERT', new: data.data, source: 'websocket' },
      }))
    })
    
    // Calendar events
    newSocket.on('calendar:event_created', (data: CalendarEventCreatedEvent) => {
      console.log('📅 Calendar event created:', data)
      incrementMessagesReceived()
      
      toast.success('Calendar Event Created', {
        description: data.data.title,
      })
      
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
      
      window.dispatchEvent(new CustomEvent('calendar_event_change', {
        detail: { eventType: 'INSERT', new: data.data, source: 'websocket' },
      }))
      window.dispatchEvent(new CustomEvent('ws:dashboard-invalidate'))
    })
    
    newSocket.on('calendar:event_updated', (data: CalendarEventUpdatedEvent) => {
      console.log('📅 Calendar event updated:', data)
      incrementMessagesReceived()
      
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
      
      window.dispatchEvent(new CustomEvent('calendar_event_change', {
        detail: { eventType: 'UPDATE', new: data.data, source: 'websocket' },
      }))
      window.dispatchEvent(new CustomEvent('ws:dashboard-invalidate'))
    })
    
    // Conversation events
    newSocket.on('conversation:updated', (data: ConversationUpdatedEvent) => {
      console.log('💬 Conversation updated:', data)
      incrementMessagesReceived()
      
      queryClient.invalidateQueries({ queryKey: queryKeys.sommelier.all })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] })
      
      window.dispatchEvent(new CustomEvent('conversation_change', {
        detail: { eventType: 'UPDATE', new: data.data, source: 'websocket' },
      }))
    })
    
    newSocket.on('conversation:summary_updated', (data: ConversationSummaryUpdatedEvent) => {
      console.log('💬 Conversation summary updated:', data)
      incrementMessagesReceived()
      
      queryClient.invalidateQueries({ queryKey: queryKeys.sommelier.all })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      
      window.dispatchEvent(new CustomEvent('conversation_change', {
        detail: { eventType: 'UPDATE', new: data.data, source: 'websocket', type: 'summary' },
      }))
    })
    
    newSocket.on('system:message', (data: SystemMessageEvent) => {
      console.log('⚙️ System message:', data)
      incrementMessagesReceived()
      
      const toastFn = data.level === 'error' ? toast.error
        : data.level === 'warning' ? toast.warning
        : toast.info
      
      toastFn('System Message', {
        description: data.message,
        duration: data.level === 'error' ? Infinity : 5000,
      })
    })
    
    setSocket(newSocket)
    
    // Auto-subscribe to restaurant if provided
    if (resolvedRestaurantId && config.autoConnect) {
      subscriptionsRef.current.add(resolvedRestaurantId)
    }
    
    return () => {
      console.log('🔌 Cleaning up WebSocket connection...')
      stopHeartbeat()
      newSocket.removeAllListeners()
      newSocket.close()
    }
  }, [config.url, resolvedUserId, authToken, resolvedRestaurantId, queryClient])

  
  // =========================================================================
  // HELPERS
  // =========================================================================
  
  const incrementMessagesReceived = useCallback(() => {
    updateStats(prev => ({ ...prev, messagesReceived: prev.messagesReceived + 1 }))
  }, [updateStats])
  
  const incrementMessagesSent = useCallback(() => {
    updateStats(prev => ({ ...prev, messagesSent: prev.messagesSent + 1 }))
  }, [updateStats])
  
  const startHeartbeat = useCallback((sock: Socket) => {
    stopHeartbeat()
    heartbeatIntervalRef.current = setInterval(() => {
      sock.emit('ping')
    }, config.heartbeatInterval)
  }, [config.heartbeatInterval])
  
  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current)
      heartbeatIntervalRef.current = null
    }
  }, [])
  
  const flushMessageQueue = useCallback((sock: Socket) => {
    while (messageQueueRef.current.length > 0) {
      const { event, data } = messageQueueRef.current.shift()!
      sock.emit(event, data)
      incrementMessagesSent()
    }
  }, [incrementMessagesSent])
  
  // =========================================================================
  // PUBLIC API
  // =========================================================================
  
  const subscribeToRestaurant = useCallback((restaurantId: string) => {
    subscriptionsRef.current.add(restaurantId)
    
    if (socket?.connected) {
      socket.emit('subscribe:restaurant', { restaurantId })
      incrementMessagesSent()
      console.log(`📡 Subscribed to restaurant: ${restaurantId}`)
    }
  }, [socket, incrementMessagesSent])
  
  const unsubscribeFromRestaurant = useCallback((restaurantId: string) => {
    subscriptionsRef.current.delete(restaurantId)
    
    if (socket?.connected) {
      socket.emit('unsubscribe:restaurant', { restaurantId })
      incrementMessagesSent()
      console.log(`📡 Unsubscribed from restaurant: ${restaurantId}`)
    }
  }, [socket, incrementMessagesSent])

  const subscribeRef = useRef(subscribeToRestaurant)
  subscribeRef.current = subscribeToRestaurant
  const unsubscribeRef = useRef(unsubscribeFromRestaurant)
  unsubscribeRef.current = unsubscribeFromRestaurant

  useEffect(() => {
    if (!resolvedRestaurantId) return
    subscribeRef.current(resolvedRestaurantId)
    return () => {
      unsubscribeRef.current(resolvedRestaurantId)
    }
  }, [resolvedRestaurantId])
  
  const on = useCallback(<K extends keyof ServerEvents>(
    event: K,
    handler: EventHandler<ServerEvents[K]>
  ): (() => void) => {
    if (!socket) return () => {}
    
    socket.on(event as string, handler as any)
    
    return () => {
      socket.off(event as string, handler as any)
    }
  }, [socket])
  
  const emit = useCallback(<K extends keyof ClientEvents>(
    event: K,
    data: ClientEvents[K]
  ): void => {
    if (socket?.connected) {
      socket.emit(event, data)
      incrementMessagesSent()
    } else {
      // Queue message for later
      messageQueueRef.current.push({ event, data })
      console.log(`📭 Message queued (offline): ${event}`)
    }
  }, [socket, incrementMessagesSent])
  
  const reconnect = useCallback(() => {
    if (socket) {
      socket.connect()
    }
  }, [socket])
  
  // =========================================================================
  // CONTEXT VALUE
  // =========================================================================
  
  const contextValue = useMemo<WebSocketContextType>(
    () => ({
      socket,
      connectionState,
      isConnected: connectionState === ConnectionState.CONNECTED,
      reconnectAttempt,
      lastError,
      subscribeToRestaurant,
      unsubscribeFromRestaurant,
      on,
      emit,
      reconnect,
      getStats,
    }),
    [
      socket,
      connectionState,
      reconnectAttempt,
      lastError,
      subscribeToRestaurant,
      unsubscribeFromRestaurant,
      on,
      emit,
      reconnect,
      getStats,
    ]
  )
  
  return (
    <WebSocketContext.Provider value={contextValue}>
      {children}
    </WebSocketContext.Provider>
  )
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  WebSocketContext,
  ConnectionState,
  type ServerEvents,
  type ClientEvents,
  type WebSocketConfig,
  type ConnectionStats,
}
