/**
 * Event System Type Definitions
 * 
 * Shared types for the event ingestion system used across:
 * - Backend (NestJS API Gateway)
 * - Frontend (React/RealtimeContext)
 * - Database (Supabase)
 * 
 * These types align with the database enums and schema in:
 * - services/database/migrations/003_add_events_table.sql
 * - Supabase_SQL_Files/supabase_sql_file_v2.sql
 */

// ============================================================================
// ENUMS - Must match database event_type and source_page enums
// ============================================================================

export const EventTypes = {
  INVENTORY_CHANGE: 'inventory_change',
  ORDER_CHANGE: 'order_change',
  CALENDAR_EVENT: 'calendar_event',
  DASHBOARD_UPDATE: 'dashboard_update',
  WINE_UPDATE: 'wine_update',
  REPORT_EVENT: 'report_event',
  NOTIFICATION_SENT: 'notification_sent',
  USER_ACTION: 'user_action',
  SYSTEM_EVENT: 'system_event',
} as const

export type EventType = typeof EventTypes[keyof typeof EventTypes]

export const SourcePages = {
  DASHBOARD: 'dashboard',
  INVENTORY: 'inventory',
  WINE_LIBRARY: 'wine_library',
  ORDERS: 'orders',
  CALENDAR: 'calendar',
  REPORTS: 'reports',
  COMMUNICATIONS: 'communications',
  PROVIDERS: 'providers',
  DOCUMENTS: 'documents',
  NOTIFICATIONS: 'notifications',
  SETTINGS: 'settings',
  SYSTEM: 'system',
} as const

export type SourcePage = typeof SourcePages[keyof typeof SourcePages]

// ============================================================================
// DATABASE ROW TYPES
// ============================================================================

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
  archived_at: string | null
  archive_path: string | null
  is_recent: boolean
  is_archive_candidate: boolean
  created_at: string
}

export interface EventDeadLetterRow {
  id: string
  restaurant_id: string
  user_id: string | null
  event_type: EventType
  source_page: SourcePage
  payload: Record<string, unknown>
  schema_version: number | null
  idempotency_key: string | null
  trace_id: string | null
  error_code: string
  error_message: string
  error_details: Record<string, unknown> | null
  error_stack: string | null
  retry_count: number
  max_retries: number
  next_retry_at: string | null
  status: 'pending' | 'retrying' | 'exhausted' | 'resolved' | 'ignored'
  resolved_by: string | null
  resolution_notes: string | null
  resolved_event_id: string | null
  failed_at: string
  last_retry_at: string | null
  resolved_at: string | null
}

export interface EventReplayJobRow {
  id: string
  restaurant_id: string | null
  event_types: EventType[] | null
  from_timestamp: string
  to_timestamp: string
  source: 'database' | 'archive' | 'both'
  archive_paths: string[] | null
  target_type: 'realtime' | 'webhook' | 'internal'
  target_endpoint: string | null
  target_config: Record<string, unknown> | null
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  total_events: number | null
  processed_events: number
  failed_events: number
  skipped_events: number
  last_processed_id: string | null
  last_processed_at: string | null
  events_per_second: number
  batch_size: number
  created_by: string
  description: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  error_message: string | null
}

export interface EventSchemaRegistryRow {
  id: number
  event_type: EventType
  schema_version: number
  json_schema: Record<string, unknown>
  description: string | null
  is_active: boolean
  created_at: string
  deprecated_at: string | null
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

export interface CreateEventRequest {
  eventType: EventType
  sourcePage: SourcePage
  payload: Record<string, unknown>
  schemaVersion?: number
  idempotencyKey?: string
  traceId?: string
  correlationId?: string
}

export interface CreateEventResponse {
  id: string
  restaurantId: string
  userId?: string
  eventType: EventType
  sourcePage: SourcePage
  payload: Record<string, unknown>
  schemaVersion: number
  idempotencyKey?: string
  traceId?: string
  correlationId?: string
  createdAt: string
  deduped: boolean
}

export interface ListEventsRequest {
  eventType?: EventType
  sourcePage?: SourcePage
  page?: number
  limit?: number
  after?: string  // ISO timestamp
  before?: string // ISO timestamp
}

export interface ListEventsResponse {
  events: EventResponse[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

export interface EventResponse {
  id: string
  restaurantId: string
  userId?: string
  eventType: EventType
  sourcePage: SourcePage
  payload: Record<string, unknown>
  schemaVersion: number
  idempotencyKey?: string
  traceId?: string
  correlationId?: string
  createdAt: string
}

// ============================================================================
// PAYLOAD TYPES - Schema v1
// ============================================================================

/**
 * Inventory Change Event Payload (v1)
 * Triggered when inventory stock levels change
 */
export interface InventoryChangePayloadV1 {
  wineId: string
  wineName?: string
  quantity: number
  previousQuantity?: number
  changeType: 'add' | 'remove' | 'adjust' | 'transfer'
  reason?: string
  locationId?: string
}

/**
 * Order Change Event Payload (v1)
 * Triggered when order status changes
 */
export interface OrderChangePayloadV1 {
  orderId: string
  status: 'created' | 'approved' | 'ordered' | 'shipped' | 'delivered' | 'cancelled'
  wineId?: string
  quantity?: number
  providerId?: string
  totalAmount?: number
}

/**
 * Calendar Event Payload (v1)
 * Triggered when calendar events are created/modified
 */
export interface CalendarEventPayloadV1 {
  eventId: string
  title: string
  eventType?: string
  action: 'created' | 'updated' | 'deleted' | 'completed'
  date: string  // ISO date
  startTime?: string
  endTime?: string
  allDay?: boolean
}

/**
 * Dashboard Update Payload (v1)
 * Triggered when dashboard metrics change
 */
export interface DashboardUpdatePayloadV1 {
  updateType: 'metric' | 'alert' | 'reminder' | 'widget'
  metricKey?: string
  value?: number
  previousValue?: number
  alertLevel?: 'info' | 'warning' | 'critical'
  message?: string
}

/**
 * Wine Update Payload (v1)
 * Triggered when wine catalog entries change
 */
export interface WineUpdatePayloadV1 {
  wineId: string
  wineName?: string
  action: 'added' | 'updated' | 'removed' | 'archived'
  changes?: Record<string, unknown>
}

/**
 * Report Event Payload (v1)
 * Triggered when reports are generated/sent
 */
export interface ReportEventPayloadV1 {
  reportId: string
  reportType?: string
  action: 'generated' | 'scheduled' | 'sent' | 'failed'
  format?: 'pdf' | 'csv' | 'excel'
  recipients?: string[]
  fileUrl?: string
}

/**
 * Notification Sent Payload (v1)
 * Triggered when notifications are sent
 */
export interface NotificationSentPayloadV1 {
  notificationId: string
  channel: 'email' | 'sms' | 'push' | 'in_app'
  recipientId?: string
  templateId?: string
  status: 'sent' | 'delivered' | 'failed' | 'bounced'
}

/**
 * User Action Payload (v1)
 * Triggered for user interactions
 */
export interface UserActionPayloadV1 {
  action: string
  targetType: string
  targetId: string
  metadata?: Record<string, unknown>
}

/**
 * System Event Payload (v1)
 * Triggered for system-level events
 */
export interface SystemEventPayloadV1 {
  eventName: string
  severity: 'info' | 'warning' | 'error'
  details?: Record<string, unknown>
}

// ============================================================================
// PAYLOAD TYPE MAP
// ============================================================================

export type EventPayloadMap = {
  inventory_change: InventoryChangePayloadV1
  order_change: OrderChangePayloadV1
  calendar_event: CalendarEventPayloadV1
  dashboard_update: DashboardUpdatePayloadV1
  wine_update: WineUpdatePayloadV1
  report_event: ReportEventPayloadV1
  notification_sent: NotificationSentPayloadV1
  user_action: UserActionPayloadV1
  system_event: SystemEventPayloadV1
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Typed event with specific payload
 */
export interface TypedEvent<T extends EventType> extends Omit<EventResponse, 'payload'> {
  eventType: T
  payload: EventPayloadMap[T]
}

/**
 * Helper to check if an event is of a specific type
 */
export function isEventType<T extends EventType>(
  event: EventResponse,
  type: T
): event is TypedEvent<T> {
  return event.eventType === type
}

/**
 * Generate idempotency key
 */
export function generateIdempotencyKey(prefix?: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 11)
  return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`
}
