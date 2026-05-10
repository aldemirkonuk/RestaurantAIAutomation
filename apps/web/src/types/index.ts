/**
 * Centralized Type Exports
 * 
 * This file consolidates types from different sources:
 * - API types (services/api/types.ts) - For API requests/responses
 * - Database types (types/database.ts) - For Supabase schema
 * - Domain types - Business logic types
 * 
 * Usage:
 * ```typescript
 * import { InventoryItem, Order, Wine } from '@/types'
 * ```
 */

import type { Order, InventoryItem, Wine } from '../services/api/types'

// ==================== Re-export API Types ====================
// These are the primary types for API communication
export type {
  // Pagination
  PaginatedResponse,
  PaginationParams,
  
  // Inventory
  InventoryItem,
  InventorySummary,
  UpdateInventoryItemRequest,
  ToastMappingRequest,
  BulkToastMappingRequest,
  BulkMappingResult,
  
  // Orders
  Order,
  OrderStatus,
  CreateOrderRequest,
  UpdateOrderRequest,
  
  // Wines
  Wine,
  WineSearchParams,
  
  // Calendar
  CalendarEvent,
  CreateCalendarEventRequest,
  RecurrenceRule,
  
  // Toast POS
  ToastMenu,
  ToastMenuGroup,
  ToastMenuItem,
  ToastSalesData,
  ToastSalesResponse,
  
  // Dashboard
  DashboardStats,
  DashboardWidget,
  
  // Events
  AppEvent,
  EventType,
  SourcePage,
  CreateEventRequest,
  
  // Notifications
  Notification,
  
  // Providers
  Provider,
} from '../services/api/types'

// ==================== Re-export Company Class Types ====================
// Modular ID system for entity classification
export type {
  CompanyClass,
  CompanyClassCategory,
  ProviderClass,
  WineTypeClass,
  EventClass,
  LabelClass,
  OrderClass,
  ClassifiedEntity,
  CompanyClassConfig,
} from './companyClass'

export {
  COMPANY_CLASS_CONFIG,
  getClassesByCategory,
  getClassConfig,
  isValidClass,
  generateClassifiedId,
  parseClassFromId,
  getClassBadge,
  providerTypeToClass,
  wineTypeToClass,
  filterEntitiesByClass,
  groupEntitiesByCategory,
  isProviderClass,
  isWineTypeClass,
  isEventClass,
  isLabelClass,
  isOrderClass,
} from './companyClass'

// ==================== Re-export Database Types ====================
// These are Supabase-specific types
export type {
  RecurringOrder,
  VendorDeadline,
  CalendarEventType,
  OrderItem,
  WineUnitDefault,
  InvoiceOCRStatus,
  InvoiceScan,
  ExtractedInvoiceData,
  ExtractedWineItem,
} from './database'

// ==================== Domain Types ====================
// Business logic types that don't fit in API or Database

export interface AuthUser {
  userId: string
  email: string
  name: string
  role: 'owner' | 'manager' | 'staff'
  restaurantId: string
}

export interface UIState {
  sidebarCollapsed: boolean
  theme: 'light' | 'dark' | 'system'
  modalOpen: boolean
}

export interface ToastNotification {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  description?: string
  duration?: number
}

// ==================== Type Guards ====================

export function isOrder(obj: any): obj is Order {
  return obj && typeof obj.id === 'string' && typeof obj.status === 'string'
}

export function isInventoryItem(obj: any): obj is InventoryItem {
  return obj && typeof obj.id === 'string' && typeof obj.stockLive === 'number'
}

export function isWine(obj: any): obj is Wine {
  return obj && typeof obj.id === 'string' && typeof obj.name === 'string'
}

// ==================== Utility Types ====================

export type Nullable<T> = T | null
export type Optional<T> = T | undefined
export type Maybe<T> = T | null | undefined

export type AsyncState<T> = {
  data: T | null
  loading: boolean
  error: Error | null
}

export type MutationState = {
  loading: boolean
  error: Error | null
  success: boolean
}

// ==================== Form Types ====================

export type FormErrors<T> = Partial<Record<keyof T, string>>

export interface FormState<T> {
  values: T
  errors: FormErrors<T>
  touched: Partial<Record<keyof T, boolean>>
  isSubmitting: boolean
  isValid: boolean
}
