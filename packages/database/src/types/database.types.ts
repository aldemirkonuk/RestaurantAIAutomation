/**
 * Database type definitions generated from Supabase schema
 * These types match the DATABASE_SCHEMA.sql structure
 */

export interface Database {
  public: {
    Tables: {
      restaurants: {
        Row: Restaurant
        Insert: Omit<Restaurant, "restaurant_id" | "created_at">
        Update: Partial<Omit<Restaurant, "restaurant_id" | "created_at">>
      }
      users: {
        Row: User
        Insert: Omit<User, "user_id" | "created_at">
        Update: Partial<Omit<User, "user_id" | "created_at">>
      }
      master_wine_library: {
        Row: Wine
        Insert: Omit<Wine, "created_at" | "updated_at">
        Update: Partial<Omit<Wine, "wine_id" | "created_at" | "updated_at">>
      }
      restaurant_inventory: {
        Row: InventoryItem
        Insert: Omit<InventoryItem, "inventory_id" | "created_at" | "last_updated">
        Update: Partial<Omit<InventoryItem, "inventory_id" | "created_at">>
      }
      providers: {
        Row: Provider
        Insert: Omit<Provider, "provider_id" | "created_at">
        Update: Partial<Omit<Provider, "provider_id" | "created_at">>
      }
      procurement_orders: {
        Row: ProcurementOrder
        Insert: Omit<ProcurementOrder, "order_id" | "created_at">
        Update: Partial<Omit<ProcurementOrder, "order_id" | "created_at">>
      }
      audit_logs: {
        Row: AuditLog
        Insert: Omit<AuditLog, "log_id" | "timestamp">
        Update: never
      }
      notification_preferences: {
        Row: NotificationPreference
        Insert: Omit<NotificationPreference, "preference_id" | "created_at">
        Update: Partial<Omit<NotificationPreference, "preference_id" | "created_at">>
      }
    }
  }
}

// Core entity types
export interface Restaurant {
  restaurant_id: string
  name: string
  address?: string
  phone?: string
  email?: string
  franchise_id?: string
  created_at: string
  settings?: RestaurantSettings
}

export interface RestaurantSettings {
  buffer_window_minutes?: number
  default_threshold_min?: number
  currency?: string
  timezone?: string
}

export interface User {
  user_id: string
  restaurant_id: string
  email: string
  name: string
  role: "owner" | "manager" | "staff"
  phone?: string
  created_at: string
}

export interface Wine {
  wine_id: string
  name: string
  producer?: string
  vintage?: number
  varietal?: string
  region?: string
  country?: string
  type?: "red" | "white" | "rosé" | "sparkling" | "dessert" | "fortified"
  color?: string
  abv?: number
  price_range?: string
  tasting_notes?: string
  food_pairings?: string[]
  sensory_profile?: SensoryProfile
  structure?: WineStructure
  provider_info?: ProviderInfo
  embeddings?: number[]
  created_at: string
  updated_at: string
}

export interface SensoryProfile {
  primary_aromas?: string[]
  secondary_aromas?: string[]
  tertiary_aromas?: string[]
  dominant_flavors?: string[]
}

export interface WineStructure {
  body?: "light" | "medium" | "full"
  sweetness?: "bone dry" | "dry" | "off-dry" | "medium sweet" | "sweet" | "very sweet"
  acidity?: "low" | "medium" | "high"
  tannins?: "none" | "low" | "medium" | "high"
  alcohol_level?: "low" | "medium" | "high"
}

export interface ProviderInfo {
  default_provider_id?: string
  lead_time_days?: number
  min_order_quantity?: number
  price_per_bottle?: number
}

export interface InventoryItem {
  inventory_id: string
  restaurant_id: string
  wine_id: string
  stock_live: number
  stock_buffer: number
  threshold_min: number
  threshold_max: number
  last_updated: string
  created_at: string
}

export interface Provider {
  provider_id: string
  name: string
  contact_email?: string
  contact_phone?: string
  specialties?: string[]
  lead_time_days?: number
  rating?: number
  notes?: string
  created_at: string
}

export interface ProcurementOrder {
  order_id: string
  restaurant_id: string
  wine_id: string
  provider_id: string
  quantity: number
  status: "pending_approval" | "approved" | "ordered" | "delivered" | "cancelled"
  suggested_price?: number
  final_price?: number
  negotiation_history?: NegotiationMessage[]
  created_at: string
  approved_at?: string
  delivered_at?: string
}

export interface NegotiationMessage {
  sender: "agent" | "provider"
  message: string
  timestamp: string
  price_offered?: number
}

export interface AuditLog {
  log_id: string
  log_type: string
  event_type: string
  restaurant_id?: string
  user_id?: string
  wine_id?: string
  details?: Record<string, any>
  timestamp: string
}

export interface NotificationPreference {
  preference_id: string
  user_id: string
  email_enabled: boolean
  sms_enabled: boolean
  push_enabled: boolean
  low_stock_alerts: boolean
  order_updates: boolean
  daily_reports: boolean
  created_at: string
  updated_at: string
}

// Query filters
export interface RestaurantFilters {
  restaurant_id?: string
  franchise_id?: string
  name?: string
}

export interface InventoryFilters {
  restaurant_id: string
  wine_id?: string
  low_stock?: boolean
  critical_stock?: boolean
}

export interface OrderFilters {
  restaurant_id: string
  status?: ProcurementOrder["status"]
  provider_id?: string
  date_from?: string
  date_to?: string
}

// Response types
export interface InventorySummary {
  total_wines: number
  low_stock_count: number
  critical_stock_count: number
  healthy_stock_count: number
  total_value: number
}

export interface WineSearchResult {
  wine: Wine
  similarity_score?: number
  current_stock?: number
  status?: "healthy" | "low" | "critical"
}

