import React, { createContext, useContext, useEffect, useCallback, useRef } from 'react'
import { useConnectionState, useWebSocketEvent } from '../lib/websocket'
import { useAuth } from './AuthContext'
import { apiClient } from '../services/api/client'

// ============================================================================
// ARCHITECTURE NOTE: Why Supabase Realtime is DISABLED
// ============================================================================
//
// WineOps uses a CUSTOM WebSocket system instead of Supabase Realtime because:
//
// 1. **Agent-driven updates**: The Python AI agents publish events via RabbitMQ.
//    The NestJS RabbitMqBridgeService consumes these and re-emits them through
//    our Socket.IO gateway, which Supabase Realtime cannot do natively.
//
// 2. **Duplicate event prevention**: If both Supabase Realtime and our WebSocket
//    system were active, every database change would produce TWO events —
//    one from each channel — causing UI double-renders and stale data races.
//
// 3. **Room-based targeting**: Our WebSocket gateway uses Socket.IO rooms
//    (e.g., `manager:{userId}`) for targeted messaging. Supabase Realtime
//    broadcasts to all subscribers of a table.
//
// 4. **Event enrichment**: The bridge service enriches events with context
//    (e.g., wine names, provider names) before sending to the frontend,
//    avoiding extra DB lookups on the client.
//
// The flow is: Agent -> RabbitMQ -> RabbitMqBridgeService -> WebSocket -> Frontend
// Frontend hooks (useOrdersSubscription, useInventorySubscription, etc.) listen
// on this custom WebSocket and trigger TanStack Query cache invalidation.
//
// If you need to re-enable Supabase Realtime for a specific use case, ensure
// you handle deduplication (e.g., idempotency via event IDs in window events).
// ============================================================================

// ============================================================================
// EVENT TYPES - Aligned with backend event_type enum
// ============================================================================

export type EventType =
  | 'inventory_change'
  | 'order_change'
  | 'calendar_event'
  | 'conversation_change'
  | 'dashboard_update'
  | 'wine_update'
  | 'report_event'
  | 'notification_sent'
  | 'user_action'
  | 'system_event'
  | 'provider_change'
  | 'template_change'

export type SourcePage =
  | 'dashboard'
  | 'inventory'
  | 'wine_library'
  | 'orders'
  | 'calendar'
  | 'reports'
  | 'communications'
  | 'providers'
  | 'documents'
  | 'notifications'
  | 'settings'
  | 'system'

// Database event row from Supabase Realtime
export interface EventRow {
  id: string
  restaurant_id: string
  user_id: string | null
  event_type: EventType
  source_page: SourcePage
  payload: Record<string, unknown>
  schema_version: number
  idempotency_key: string | null
  trace_id: string | null
  correlation_id: string | null
  created_at: string
}

// Types for inventory updates
export interface InventoryUpdatePayload {
  type: 'add' | 'update' | 'remove' | 'stock_change'
  wineId: string
  wineName?: string
  quantity?: number
  previousQuantity?: number
  source: 'wine_library' | 'order_delivery' | 'order_placed' | 'manual' | 'reconciliation'
  timestamp: string
  metadata?: Record<string, unknown>
}

export interface OrderUpdatePayload {
  type: 'created' | 'approved' | 'delivered' | 'cancelled'
  orderId: string
  wineId?: string
  quantity?: number
  providerId?: string
  timestamp: string
  metadata?: {
    skipInventoryUpdate?: boolean
    transferFrom?: 'shadow'
    transferTo?: 'live'
    action?: 'shadow_to_live'
    inventoryId?: string
  }
}

export interface CalendarEventPayload {
  type: 'created' | 'updated' | 'deleted'
  eventId: string
  title: string
  eventType: 'delivery' | 'order' | 'meeting' | 'inventory' | 'tasting' | 'reminder' | 'recurring' | 'custom'
  date: string
  startTime?: string
  endTime?: string
  allDay?: boolean
  description?: string
  recurring?: {
    enabled: boolean
    frequency: 'daily' | 'weekly' | 'monthly'
    interval: number
    daysOfWeek?: number[]
    endType: 'never' | 'date' | 'count'
    endDate?: string
    endCount?: number
  }
  color?: string
  source?: 'communications' | 'orders' | 'manual'
  timestamp: string
}

// Dashboard update payloads
export interface DashboardUpdatePayload {
  type: 'metric_update' | 'important_date' | 'reminder' | 'quick_action'
  source: 'inventory' | 'orders' | 'calendar' | 'reports' | 'manual'
  data: {
    metricKey?: string
    value?: number
    previousValue?: number
    dateInfo?: {
      id: number
      title: string
      date: string
      type: string
    }
    reminderInfo?: {
      id: string
      title: string
      completed: boolean
    }
  }
  timestamp: string
}

// Wine Library update payloads
export interface WineUpdatePayload {
  type: 'added' | 'updated' | 'removed' | 'stock_sync'
  wineId: string
  wineName: string
  data?: {
    price?: number
    threshold?: number
    provider?: string
    notes?: string
    isActive?: boolean
    liveStock?: number
    shadowStock?: number
  }
  source: 'inventory' | 'wine_library' | 'order' | 'manual'
  timestamp: string
}

// Report event payloads
export interface ReportEventPayload {
  type: 'generated' | 'scheduled' | 'sent'
  reportId: string
  reportType: string
  format: 'pdf' | 'csv' | 'excel'
  recipients?: string[]
  scheduledFor?: string
  timestamp: string
}

// Provider update payloads
export interface ProviderUpdatePayload {
  type: 'added' | 'updated' | 'removed'
  providerId: string
  providerName: string
  data?: {
    contactPerson?: string
    email?: string
    phone?: string
    businessType?: string
    specialties?: string[]
  }
  source: 'providers_page' | 'order_form' | 'import'
  timestamp: string
}

// Template update payloads
export interface TemplateUpdatePayload {
  type: 'created' | 'updated' | 'deleted' | 'duplicated'
  templateId: string
  templateName: string
  templateType: 'email' | 'sms' | 'notification'
  source: 'communications' | 'reports' | 'manual'
  timestamp: string
}

interface RealtimeContextType {
  isConnected: boolean
  restaurantId: string | null
  subscribe: (table: string, callback: (payload: unknown) => void) => () => void
  // Subscribe to events table for cross-device sync
  subscribeToEvents: (callback: (event: EventRow) => void) => () => void
  // Mutation helpers for cross-page sync (persist to backend)
  dispatchInventoryUpdate: (payload: InventoryUpdatePayload) => Promise<void>
  dispatchOrderUpdate: (payload: OrderUpdatePayload) => Promise<void>
  dispatchCalendarEvent: (payload: CalendarEventPayload) => Promise<void>
  dispatchDashboardUpdate: (payload: DashboardUpdatePayload) => Promise<void>
  dispatchWineUpdate: (payload: WineUpdatePayload) => Promise<void>
  dispatchReportEvent: (payload: ReportEventPayload) => Promise<void>
  dispatchProviderUpdate: (payload: ProviderUpdatePayload) => Promise<void>
  dispatchTemplateUpdate: (payload: TemplateUpdatePayload) => Promise<void>
}

const RealtimeContext = createContext<RealtimeContextType | undefined>(undefined)

export function useRealtime() {
  const context = useContext(RealtimeContext)
  if (!context) {
    throw new Error('useRealtime must be used within a RealtimeProvider')
  }
  return context
}

interface RealtimeProviderProps {
  children: React.ReactNode
  restaurantId?: string | null
}

// Generate idempotency key for event deduplication
function generateIdempotencyKey(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}


export function RealtimeProvider({ children, restaurantId = null }: RealtimeProviderProps) {
  const { activeRestaurantId } = useAuth()
  const resolvedRestaurantId = restaurantId ?? activeRestaurantId ?? null
  const { isConnected } = useConnectionState()
  const eventCallbacksRef = useRef<Set<(event: EventRow) => void>>(new Set())
  const processedEventsRef = useRef<Set<string>>(new Set()) // Track processed event IDs for dedup

  // Subscribe to websocket events for cross-device sync
  useWebSocketEvent(
    'event:new',
    (event) => {
      if (!resolvedRestaurantId || event.restaurant_id !== resolvedRestaurantId) return

      // Deduplicate: skip if we've already processed this event
      if (processedEventsRef.current.has(event.id)) {
        console.log('[Realtime] Skipping duplicate event:', event.id)
        return
      }

      // Mark as processed (keep last 1000 to prevent memory leak)
      processedEventsRef.current.add(event.id)
      if (processedEventsRef.current.size > 1000) {
        const firstKey = processedEventsRef.current.values().next().value
        if (firstKey) processedEventsRef.current.delete(firstKey)
      }

      console.log('[Realtime] Event received:', event.event_type, event.id)

      // Notify all registered callbacks
      eventCallbacksRef.current.forEach((callback) => {
        try {
          callback(event)
        } catch (err) {
          console.error('[Realtime] Event callback error:', err)
        }
      })

      // Also dispatch to window events for backward compatibility
      const eventTypeToWindowEvent: Record<EventType, string> = {
        inventory_change: 'inventory_change',
        order_change: 'order_change',
        calendar_event: 'calendar_event_change',
        conversation_change: 'conversation_change',
        dashboard_update: 'dashboard_update',
        wine_update: 'wine_update',
        report_event: 'report_event',
        notification_sent: 'notification_sent',
        user_action: 'user_action',
        system_event: 'system_event',
        provider_change: 'provider_change',
        template_change: 'template_change',
      }

      const windowEventName = eventTypeToWindowEvent[event.event_type]
      if (windowEventName) {
        window.dispatchEvent(
          new CustomEvent(windowEventName, {
            detail: {
              eventType: 'INSERT',
              new: event.payload,
              eventId: event.id,
              source: 'realtime',
              table: 'events',
            },
          })
        )
      }
    },
    [resolvedRestaurantId]
  )

  const subscribe = (table: string, _callback: (payload: unknown) => void) => {
    console.warn(
      `[Realtime] Table subscription skipped for ${table}. Supabase realtime is disabled.`,
    )
    return () => {}
  }

  // Subscribe to events table changes (cross-device sync)
  const subscribeToEvents = useCallback((callback: (event: EventRow) => void) => {
    eventCallbacksRef.current.add(callback)
    
    return () => {
      eventCallbacksRef.current.delete(callback)
    }
  }, [])

  // Helper to persist event to backend API
  const persistEvent = useCallback(async (
    eventType: EventType,
    sourcePage: SourcePage,
    payload: Record<string, unknown>,
    correlationId?: string
  ): Promise<{ id: string; deduped: boolean } | null> => {
    if (!resolvedRestaurantId) {
      console.warn('[Realtime] No restaurantId, skipping event persistence')
      return null
    }

    const idempotencyKey = generateIdempotencyKey()

    try {
      const response = await apiClient.post('/events', {
        eventType,
        sourcePage,
        payload,
        idempotencyKey,
        correlationId,
        schemaVersion: 1,
      })

      const result = response.data
      console.log('[Realtime] Event persisted:', result.id, result.deduped ? '(deduped)' : '')
      return { id: result.id, deduped: result.deduped }
    } catch (error) {
      console.error('[Realtime] Error persisting event:', error)
      return null
    }
  }, [resolvedRestaurantId])

  // Dispatch inventory update - broadcasts to all listening pages and persists to backend
  const dispatchInventoryUpdate = useCallback(async (payload: InventoryUpdatePayload) => {
    console.log('Dispatching inventory update:', payload)
    
    // Dispatch via window event for immediate local updates
    window.dispatchEvent(new CustomEvent('inventory_change', { 
      detail: { 
        eventType: 'UPDATE',
        new: payload,
        old: null,
        table: 'inventory',
        source: 'local'
      } 
    }))

    // Persist to backend events table for cross-device sync
    await persistEvent('inventory_change', 'inventory', payload as unknown as Record<string, unknown>)
  }, [persistEvent])

  // Dispatch order update - broadcasts to all listening pages and persists to backend
  const dispatchOrderUpdate = useCallback(async (payload: OrderUpdatePayload) => {
    console.log('Dispatching order update:', payload)
    
    window.dispatchEvent(new CustomEvent('order_change', { 
      detail: { 
        eventType: payload.type.toUpperCase(),
        new: payload,
        old: null,
        table: 'orders',
        source: 'local'
      } 
    }))

    // Persist to backend events table
    const result = await persistEvent('order_change', 'orders', payload as unknown as Record<string, unknown>)

    // If order is delivered, also trigger inventory update with correlation
    if (
      payload.type === 'delivered' &&
      payload.wineId &&
      payload.quantity &&
      !payload.metadata?.skipInventoryUpdate
    ) {      await dispatchInventoryUpdate({
        type: 'stock_change',
        wineId: payload.wineId,
        quantity: payload.quantity,
        source: 'order_delivery',
        timestamp: payload.timestamp,
        metadata: {
          orderId: payload.orderId,
          correlatedEventId: result?.id,
          ...(payload.metadata || {}),
        }
      })
    }
  }, [persistEvent, dispatchInventoryUpdate])

  // Dispatch calendar event - broadcasts to Calendar page and persists to backend
  const dispatchCalendarEvent = useCallback(async (payload: CalendarEventPayload) => {
    console.log('Dispatching calendar event:', payload)
    
    window.dispatchEvent(new CustomEvent('calendar_event_change', { 
      detail: { 
        eventType: payload.type.toUpperCase(),
        new: payload,
        old: null,
        table: 'calendar_events',
        source: 'local'
      } 
    }))

    // Persist to backend events table for cross-device sync
    await persistEvent('calendar_event', 'calendar', payload as unknown as Record<string, unknown>)
  }, [persistEvent])

  /**
   * Dashboard update dispatcher - persists to backend
   * 
   * Use this to notify the dashboard of metric changes, important dates, or reminders.
   * Example: After inventory reconciliation, dispatch to update dashboard KPIs.
   * 
   * @example
   * dispatchDashboardUpdate({
   *   type: 'metric_update',
   *   source: 'inventory',
   *   data: { metricKey: 'totalStock', value: 1234, previousValue: 1200 },
   *   timestamp: new Date().toISOString()
   * })
   */
  const dispatchDashboardUpdate = useCallback(async (payload: DashboardUpdatePayload) => {
    console.log('Dispatching dashboard update:', payload)
    window.dispatchEvent(new CustomEvent('dashboard_update', { 
      detail: { ...payload, source: 'local' }
    }))

    // Persist to backend events table
    await persistEvent('dashboard_update', 'dashboard', payload as unknown as Record<string, unknown>)
  }, [persistEvent])

  // Wine update dispatcher - persists to backend
  const dispatchWineUpdate = useCallback(async (payload: WineUpdatePayload) => {
    console.log('Dispatching wine update:', payload)
    window.dispatchEvent(new CustomEvent('wine_update', { 
      detail: { ...payload, source: 'local' }
    }))

    // Persist to backend events table
    await persistEvent('wine_update', 'wine_library', payload as unknown as Record<string, unknown>)
  }, [persistEvent])

  /**
   * Report event dispatcher - persists to backend
   * 
   * Use this when reports are generated, scheduled, or sent.
   * Example: After generating a CSV export, dispatch to log the action.
   * 
   * @example
   * dispatchReportEvent({
   *   type: 'generated',
   *   reportId: 'rpt-123',
   *   reportType: 'inventory-summary',
   *   format: 'csv',
   *   timestamp: new Date().toISOString()
   * })
   */
  const dispatchReportEvent = useCallback(async (payload: ReportEventPayload) => {
    console.log('Dispatching report event:', payload)
    window.dispatchEvent(new CustomEvent('report_event', { 
      detail: { ...payload, source: 'local' }
    }))

    // Persist to backend events table
    await persistEvent('report_event', 'reports', payload as unknown as Record<string, unknown>)
  }, [persistEvent])

  // Provider update dispatcher - broadcasts to Orders page for dropdown updates
  const dispatchProviderUpdate = useCallback(async (payload: ProviderUpdatePayload) => {
    console.log('Dispatching provider update:', payload)
    window.dispatchEvent(new CustomEvent('provider_change', { 
      detail: { 
        eventType: payload.type.toUpperCase(),
        new: payload,
        old: null,
        table: 'providers',
        source: 'local'
      }
    }))

    // Persist to backend events table
    await persistEvent('provider_change', 'providers', payload as unknown as Record<string, unknown>)
  }, [persistEvent])

  /**
   * Template update dispatcher - persists to backend
   * 
   * Use this when email/SMS templates are created, updated, or deleted.
   * Example: After saving a new email template in Communications.
   * 
   * @example
   * dispatchTemplateUpdate({
   *   type: 'created',
   *   templateId: 'tpl-456',
   *   templateName: 'Welcome Email',
   *   templateType: 'email',
   *   source: 'communications',
   *   timestamp: new Date().toISOString()
   * })
   */
  const dispatchTemplateUpdate = useCallback(async (payload: TemplateUpdatePayload) => {
    console.log('Dispatching template update:', payload)
    window.dispatchEvent(new CustomEvent('template_change', { 
      detail: { ...payload, source: 'local' }
    }))

    // Persist to backend events table
    await persistEvent('template_change', 'communications', payload as unknown as Record<string, unknown>)
  }, [persistEvent])

  return (
    <RealtimeContext.Provider value={{ 
      isConnected,
      restaurantId: resolvedRestaurantId,
      subscribe,
      subscribeToEvents,
      dispatchInventoryUpdate, 
      dispatchOrderUpdate, 
      dispatchCalendarEvent,
      dispatchDashboardUpdate,
      dispatchWineUpdate,
      dispatchReportEvent,
      dispatchProviderUpdate,
      dispatchTemplateUpdate,
    }}>
      {children}
    </RealtimeContext.Provider>
  )
}

// Utility hook for listening to specific table changes
export function useRealtimeSubscription(
  table: string,
  callback: (payload: any) => void,
  dependencies: any[] = []
) {
  const { subscribe } = useRealtime()
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    const unsubscribe = subscribe(table, (payload: any) => callbackRef.current(payload))
    return unsubscribe
  }, [table, subscribe, ...dependencies])
}

// Pre-configured hooks for common subscriptions
export function useRecurringOrdersSubscription(callback: (payload: any) => void) {
  const cbRef = useRef(callback)
  cbRef.current = callback

  useEffect(() => {
    const handleChange = (event: any) => cbRef.current(event.detail)
    window.addEventListener('recurring_order_change', handleChange)
    return () => window.removeEventListener('recurring_order_change', handleChange)
  }, [])
}

export function useCalendarEventsSubscription(callback: (payload: any) => void) {
  const cbRef = useRef(callback)
  cbRef.current = callback

  useEffect(() => {
    const handleChange = (event: any) => cbRef.current(event.detail)
    window.addEventListener('calendar_event_change', handleChange)
    return () => window.removeEventListener('calendar_event_change', handleChange)
  }, [])
}

export function useVendorDeadlinesSubscription(callback: (payload: any) => void) {
  const cbRef = useRef(callback)
  cbRef.current = callback

  useEffect(() => {
    const handleChange = (event: any) => cbRef.current(event.detail)
    window.addEventListener('vendor_deadline_change', handleChange)
    return () => window.removeEventListener('vendor_deadline_change', handleChange)
  }, [])
}

export function useOrdersSubscription(callback: (payload: any) => void) {
  const cbRef = useRef(callback)
  cbRef.current = callback

  useEffect(() => {
    const handleChange = (event: any) => cbRef.current(event.detail)
    window.addEventListener('order_change', handleChange)
    return () => window.removeEventListener('order_change', handleChange)
  }, [])
}

export function useInventorySubscription(callback: (payload: any) => void) {
  const cbRef = useRef(callback)
  cbRef.current = callback

  useEffect(() => {
    const handleChange = (event: any) => cbRef.current(event.detail)
    window.addEventListener('inventory_change', handleChange)
    return () => window.removeEventListener('inventory_change', handleChange)
  }, [])
}

export function useDashboardSubscription(callback: (payload: DashboardUpdatePayload) => void) {
  const cbRef = useRef(callback)
  cbRef.current = callback

  useEffect(() => {
    const handleChange = (event: any) => cbRef.current(event.detail)
    window.addEventListener('dashboard_update', handleChange)
    return () => window.removeEventListener('dashboard_update', handleChange)
  }, [])
}

export function useWineSubscription(callback: (payload: WineUpdatePayload) => void) {
  const cbRef = useRef(callback)
  cbRef.current = callback

  useEffect(() => {
    const handleChange = (event: any) => cbRef.current(event.detail)
    window.addEventListener('wine_update', handleChange)
    return () => window.removeEventListener('wine_update', handleChange)
  }, [])
}

export function useReportSubscription(callback: (payload: ReportEventPayload) => void) {
  const cbRef = useRef(callback)
  cbRef.current = callback

  useEffect(() => {
    const handleChange = (event: any) => cbRef.current(event.detail)
    window.addEventListener('report_event', handleChange)
    return () => window.removeEventListener('report_event', handleChange)
  }, [])
}

export function useProviderSubscription(callback: (payload: ProviderUpdatePayload) => void) {
  const cbRef = useRef(callback)
  cbRef.current = callback

  useEffect(() => {
    const handleChange = (event: any) => {
      const detail = event.detail
      if (detail?.new) {
        cbRef.current(detail.new as ProviderUpdatePayload)
      }
    }
    window.addEventListener('provider_change', handleChange)
    return () => window.removeEventListener('provider_change', handleChange)
  }, [])
}

export function useTemplateSubscription(callback: (payload: TemplateUpdatePayload) => void) {
  const cbRef = useRef(callback)
  cbRef.current = callback

  useEffect(() => {
    const handleChange = (event: any) => cbRef.current(event.detail)
    window.addEventListener('template_change', handleChange)
    return () => window.removeEventListener('template_change', handleChange)
  }, [])
}

export function useConversationSubscription(callback: (payload: any) => void) {
  const cbRef = useRef(callback)
  cbRef.current = callback

  useEffect(() => {
    const handleChange = (event: any) => cbRef.current(event.detail)
    window.addEventListener('conversation_change', handleChange)
    return () => window.removeEventListener('conversation_change', handleChange)
  }, [])
}

// Hook to get dispatch functions for cross-page updates
export function useRealtimeDispatch() {
  const context = useContext(RealtimeContext)
  if (!context) {
    // Return no-op async functions if not within provider (for safety)
    return {
      dispatchInventoryUpdate: async (payload: InventoryUpdatePayload) => {
        console.warn('RealtimeProvider not found, dispatching locally only')
        window.dispatchEvent(new CustomEvent('inventory_change', { detail: { new: payload } }))
      },
      dispatchOrderUpdate: async (payload: OrderUpdatePayload) => {
        console.warn('RealtimeProvider not found, dispatching locally only')
        window.dispatchEvent(new CustomEvent('order_change', { detail: { new: payload } }))
      },
      dispatchCalendarEvent: async (payload: CalendarEventPayload) => {
        console.warn('RealtimeProvider not found, dispatching locally only')
        window.dispatchEvent(new CustomEvent('calendar_event_change', { detail: { new: payload } }))
      },
      dispatchDashboardUpdate: async (payload: DashboardUpdatePayload) => {
        console.warn('RealtimeProvider not found, dispatching locally only')
        window.dispatchEvent(new CustomEvent('dashboard_update', { detail: payload }))
      },
      dispatchWineUpdate: async (payload: WineUpdatePayload) => {
        console.warn('RealtimeProvider not found, dispatching locally only')
        window.dispatchEvent(new CustomEvent('wine_update', { detail: payload }))
      },
      dispatchReportEvent: async (payload: ReportEventPayload) => {
        console.warn('RealtimeProvider not found, dispatching locally only')
        window.dispatchEvent(new CustomEvent('report_event', { detail: payload }))
      },
      dispatchProviderUpdate: async (payload: ProviderUpdatePayload) => {
        console.warn('RealtimeProvider not found, dispatching locally only')
        window.dispatchEvent(new CustomEvent('provider_change', { detail: { new: payload } }))
      },
      dispatchTemplateUpdate: async (payload: TemplateUpdatePayload) => {
        console.warn('RealtimeProvider not found, dispatching locally only')
        window.dispatchEvent(new CustomEvent('template_change', { detail: payload }))
      },
    }
  }
  return {
    dispatchInventoryUpdate: context.dispatchInventoryUpdate,
    dispatchOrderUpdate: context.dispatchOrderUpdate,
    dispatchCalendarEvent: context.dispatchCalendarEvent,
    dispatchDashboardUpdate: context.dispatchDashboardUpdate,
    dispatchWineUpdate: context.dispatchWineUpdate,
    dispatchReportEvent: context.dispatchReportEvent,
    dispatchProviderUpdate: context.dispatchProviderUpdate,
    dispatchTemplateUpdate: context.dispatchTemplateUpdate,
  }
}

// Hook to subscribe to cross-device events from the events table
export function useEventsSubscription(callback: (event: EventRow) => void) {
  const { subscribeToEvents } = useRealtime()
  const cbRef = useRef(callback)
  cbRef.current = callback
  
  useEffect(() => {
    const unsubscribe = subscribeToEvents((event: EventRow) => cbRef.current(event))
    return unsubscribe
  }, [subscribeToEvents])
}

// Enhanced inventory subscription with typed payload
export function useTypedInventorySubscription(
  callback: (payload: InventoryUpdatePayload) => void
) {
  const cbRef = useRef(callback)
  cbRef.current = callback

  useEffect(() => {
    const handleChange = (event: CustomEvent) => {
      const detail = event.detail
      if (detail?.new) {
        cbRef.current(detail.new as InventoryUpdatePayload)
      }
    }
    window.addEventListener('inventory_change', handleChange as EventListener)
    return () => window.removeEventListener('inventory_change', handleChange as EventListener)
  }, [])
}
