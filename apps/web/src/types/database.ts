// Database Type Definitions for WineOps AI
// Auto-generated from database schema
// Last updated: February 20, 2026

export type MeasurementUnit = 'ml' | 'oz'
export type SaleType = 'bottle' | 'glass' | 'both'

export interface RecurringOrder {
  id: string
  restaurant_id?: string
  wine_id: string
  quantity: number
  unit_type: 'case' | 'bottle'
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly'
  frequency_day?: number // 0-6 for weekly, 1-31 for monthly
  preferred_providers: string[]
  auto_approve: boolean
  next_order_date: string // ISO date string
  last_order_date?: string // ISO date string
  active: boolean
  created_at: string
  updated_at: string
}

export interface VendorDeadline { 
  id: string
  restaurant_id?: string
  provider_id: string
  provider_name: string
  deadline_day: number // 0-6 (Mon-Sun)
  deadline_time: string // HH:MM:SS format
  notification_hours_before: number
  active: boolean
  created_at: string
  updated_at: string
}

export type CalendarEventType = 
  | 'important_date'
  | 'vendor_deadline'
  | 'recurring_order'
  | 'report_schedule'
  | 'delivery'
  | 'birthday'
  | 'tasting'
  | 'inventory_count'
  | 'vip_reservation'

export interface CalendarEvent {
  id: string
  restaurant_id?: string
  event_type: CalendarEventType
  title: string
  description?: string
  event_date: string // ISO date string
  event_time?: string // HH:MM:SS format
  recurrence?: 'daily' | 'weekly' | 'monthly' | 'yearly'
  related_entity_id?: string
  notification_enabled: boolean
  notification_sent: boolean
  created_at: string
  updated_at: string
}

export interface OrderItem {
  id: string
  order_id: string
  wine_id: string
  wine_name: string
  quantity: number
  unit_type: 'case' | 'bottle'
  bottles_per_case: number
  unit_price: number
  total_price: number
  bottle_size_ml?: number
  created_at: string
}

export interface WineUnitDefault {
  wine_id: string
  default_unit_type: 'case' | 'bottle'
  bottles_per_case: number
  notes?: string
  updated_at: string
}

export type InvoiceOCRStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface InvoiceScan {
  id: string
  restaurant_id?: string
  provider_id?: string
  provider_name?: string
  scan_type: 'pdf' | 'image'
  file_url: string
  ocr_status: InvoiceOCRStatus
  extracted_data?: ExtractedInvoiceData
  processed_at?: string
  auto_added_to_inventory: boolean
  error_message?: string
  created_at: string
}

export interface ExtractedInvoiceData {
  wines: ExtractedWineItem[]
  invoice_number?: string
  invoice_date?: string
  total_amount?: number
  provider_info?: {
    name: string
    address?: string
    phone?: string
  }
}

export interface ExtractedWineItem {
  name: string
  quantity: number
  unit_type: 'case' | 'bottle'
  unit_price: number
  total_price: number
  vintage?: number
  producer?: string
  bottle_size_ml?: number
  notes?: string
}

export interface CheckScan {
  id: string
  restaurant_id?: string
  scan_date: string // ISO date string
  total_amount?: number
  wine_sales?: number
  wine_cost?: number
  profit_margin?: number // Percentage
  extracted_data?: CheckExtractedData
  file_url?: string
  processed_at?: string
  created_at: string
}

export interface CheckExtractedData {
  items: CheckLineItem[]
  subtotal?: number
  tax?: number
  tip?: number
  total: number
  timestamp?: string
}

export interface CheckLineItem {
  item_name: string
  quantity: number
  price: number
  is_wine: boolean
  wine_id?: string
}

export type AcquisitionType = 'standard' | 'auction' | 'direct_import' | 'special_allocation'

export interface WineAcquisitionDetails {
  wine_id: string
  acquisition_type: AcquisitionType
  auction_details?: AuctionDetails
  acquisition_date?: string // ISO date string
  acquisition_price?: number
  notes?: string
  created_at: string
}

export interface AuctionDetails {
  auction_house: string
  lot_number?: string
  auction_date: string
  hammer_price: number
  buyers_premium?: number
  total_cost: number
  provenance?: string
}

export interface ProfitMargin {
  id: string
  restaurant_id?: string
  date: string // ISO date string
  total_revenue: number
  total_cost: number
  profit_margin: number // Percentage
  wine_revenue?: number
  wine_cost?: number
  wine_profit_margin?: number // Percentage
  created_at: string
}

// API Request/Response Types
export interface CreateRecurringOrderRequest {
  wine_id: string
  quantity: number
  unit_type: 'case' | 'bottle'
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly'
  frequency_day?: number
  preferred_providers: string[]
  auto_approve: boolean
  next_order_date: string
}

export interface UpdateRecurringOrderRequest extends Partial<CreateRecurringOrderRequest> {
  active?: boolean
}

export interface CreateVendorDeadlineRequest {
  provider_id: string
  provider_name: string
  deadline_day: number
  deadline_time: string
  notification_hours_before: number
}

export interface CreateCalendarEventRequest {
  event_type: CalendarEventType
  title: string
  description?: string
  event_date: string
  event_time?: string
  recurrence?: 'daily' | 'weekly' | 'monthly' | 'yearly'
  related_entity_id?: string
  notification_enabled: boolean
}

export interface UploadInvoiceRequest {
  file: File
  provider_id?: string
}

export interface UploadCheckRequest {
  file: File
  scan_date: string
}

export interface ResearchWineRequest {
  wine_name: string
}

export interface ResearchWineResponse {
  name: string
  producer: string
  vintage?: number
  type: 'red' | 'white' | 'sparkling' | 'rose' | 'dessert'
  region: string
  country: string
  estimated_price: number
  grape: string
  research_confidence: 'low' | 'medium' | 'high'
  source: 'master_library' | 'gemini' | 'openai' | 'vivino'
}

export interface AuctionPurchaseRequest {
  wine_data: ResearchWineResponse
  quantity: number
  unit_type: 'case' | 'bottle'
  auction_details: AuctionDetails
}

// Export Formats
export type ExportFormat = 'csv' | 'pdf' | 'excel' | 'sheets' | 'drive'

export interface InventoryExportMetrics {
  physical_inventory_size: number
  ordered_wines_size: number
  sold_items_size: number
  profit_margin: number
  total_inventory_value: number
  low_stock_count: number
  out_of_stock_count: number
}

// Utility Types
export type DatabaseTables = 
  | 'recurring_orders'
  | 'vendor_deadlines'
  | 'calendar_events'
  | 'order_items'
  | 'wine_unit_defaults'
  | 'invoice_scans'
  | 'check_scans'
  | 'wine_acquisition_details'
  | 'profit_margins'

export interface WineConsumptionLog {
  id: string
  restaurant_id: string
  inventory_id: string
  wine_name?: string
  consumption_type: 'bottle' | 'glass'
  quantity: number
  volume_ml: number
  unit_price?: number
  total_revenue?: number
  source: 'manual' | 'pos' | 'ai_agent'
  recorded_at: string
  recorded_by?: string
  notes?: string
  created_at: string
}

export interface WineConsumptionSummary {
  restaurant_id: string
  inventory_id: string
  wine_name?: string
  bottles_consumed: number
  glasses_consumed: number
  total_volume_ml: number
  bottle_revenue: number
  glass_revenue: number
  total_revenue: number
}

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

