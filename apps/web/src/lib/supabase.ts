/**
 * Supabase Client Integration
 * 
 * This module provides the Supabase client and utility hooks
 * for interacting with the WineOps database.
 */

import { createClient } from '@supabase/supabase-js'

// Get environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// Create Supabase client with safe defaults
// If URL/key are empty, create a mock client to prevent crashes
export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : createClient('https://placeholder.supabase.co', 'placeholder-key')

// Database Types (based on your schema)
export interface Wine {
  wine_id: string
  name: string
  producer: string
  vintage: number | null
  price: number
  classification: {
    primary_type: string
    grape_variety: string
    country: string
    region: string
    appellation: string
    sub_region: string
  }
  wine_structure: {
    body: string
    sweetness: string
    acidity: string
    tannins: string
    alcohol_level: string
    texture: string
    finish: string
    alcohol_pct: number
  }
  sensory_profile: {
    primary_aromas: string[]
    secondary_aromas: string[]
    tertiary_aromas: string[]
    flavor_intensity: string
    aroma_complexity: string
    flavor_profile: string[]
  }
  quality_signals: {
    quality_level: string
    producer_tier: string
    reserve_status: boolean
    vintage_quality: string
    awards_ratings: string[]
    appellation_class: string
  }
  provider_info: {
    primary: {
      name: string
      contact: string
      phone: string
      location: string
      specialties: string[]
      minimum_order: number
      lead_time_days: number
      primary_vendor: string
    }
    alternative: any[]
  }
  created_at: string
  updated_at: string
}

export interface InventoryItem {
  inventory_id: string
  restaurant_id: string
  wine_id: string
  live_stock: number
  shadow_stock: number
  threshold_min: number
  threshold_max: number
  last_counted_at: string | null
  last_sold_at: string | null
  status: 'active' | 'inactive' | 'pending'
  created_at: string
  updated_at: string
  // Joined fields
  wine?: Wine
}

export interface Order {
  order_id: string
  restaurant_id: string
  wine_id: string
  provider_id: string
  quantity: number
  unit_price: number
  total_price: number
  status: 'pending' | 'approved' | 'in_transit' | 'delivered' | 'cancelled'
  requested_at: string
  approved_at: string | null
  delivered_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
  // Joined fields
  wine?: Wine
  provider?: any
}

// ============ Wine Library Functions ============

export async function getWines(options?: {
  search?: string
  type?: string
  region?: string
  country?: string
  minPrice?: number
  maxPrice?: number
  sortBy?: 'name' | 'price' | 'vintage' | 'type'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  offset?: number
}) {
  let query = supabase
    .from('master_wine_library')
    .select('*')

  if (options?.search) {
    query = query.or(`name.ilike.%${options.search}%,producer.ilike.%${options.search}%`)
  }

  if (options?.type) {
    query = query.ilike('classification->primary_type', `%${options.type}%`)
  }

  if (options?.region) {
    query = query.ilike('classification->region', `%${options.region}%`)
  }

  if (options?.country) {
    query = query.ilike('classification->country', `%${options.country}%`)
  }

  if (options?.minPrice !== undefined) {
    query = query.gte('price', options.minPrice)
  }

  if (options?.maxPrice !== undefined) {
    query = query.lte('price', options.maxPrice)
  }

  if (options?.sortBy) {
    query = query.order(options.sortBy, { ascending: options.sortOrder === 'asc' })
  }

  if (options?.limit) {
    query = query.limit(options.limit)
  }

  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 10) - 1)
  }

  const { data, error } = await query
  
  if (error) throw error
  return data as Wine[]
}

export async function getWineById(wineId: string) {
  const { data, error } = await supabase
    .from('master_wine_library')
    .select('*')
    .eq('wine_id', wineId)
    .single()
  
  if (error) throw error
  return data as Wine
}

// ============ Inventory Functions ============

export async function getInventory(restaurantId: string, options?: {
  status?: 'live' | 'shadow' | 'all'
  lowStockOnly?: boolean
  search?: string
}) {
  let query = supabase
    .from('restaurant_inventory')
    .select(`
      *,
      wine:master_wine_library(*)
    `)
    .eq('restaurant_id', restaurantId)

  if (options?.status === 'live') {
    query = query.gt('live_stock', 0)
  } else if (options?.status === 'shadow') {
    query = query.gt('shadow_stock', 0)
  }

  if (options?.lowStockOnly) {
    // This requires a custom RPC function or client-side filtering
  }

  const { data, error } = await query
  
  if (error) throw error
  return data as InventoryItem[]
}

// updateInventoryStock and reconcileShadowStock were removed (SimPOS testbed
// plan, decision A9): both wrote `inventory_id`/`live_stock`, neither of which
// exists on restaurant_inventory (the real columns are `id` and `stock_live`),
// and both had zero callers. Stock is never written directly — it is a
// projection of inventory_lots, mutated only through the apply_stock_movement
// RPC. Use POST /inventory/:restaurantId/:itemId or the counting endpoint.

// ============ Orders Functions ============

export async function getOrders(restaurantId: string, options?: {
  status?: Order['status']
  limit?: number
}) {
  let query = supabase
    .from('procurement_orders')
    .select(`
      *,
      wine:master_wine_library(*)
    `)
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })

  if (options?.status) {
    query = query.eq('status', options.status)
  }

  if (options?.limit) {
    query = query.limit(options.limit)
  }

  const { data, error } = await query
  
  if (error) throw error
  return data as Order[]
}

export async function createOrder(order: Omit<Order, 'order_id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase
    .from('procurement_orders')
    .insert(order)
    .select()
    .single()
  
  if (error) throw error
  return data as Order
}

export async function updateOrderStatus(orderId: string, status: Order['status']) {
  const updates: any = {
    status,
    updated_at: new Date().toISOString(),
  }

  if (status === 'approved') {
    updates.approved_at = new Date().toISOString()
  } else if (status === 'delivered') {
    updates.delivered_at = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('procurement_orders')
    .update(updates)
    .eq('order_id', orderId)
    .select()
    .single()
  
  if (error) throw error
  return data as Order
}

// ============ Dashboard Stats Functions ============

export async function getDashboardStats(restaurantId: string) {
  // Get inventory stats
  const { data: inventory, error: invError } = await supabase
    .from('restaurant_inventory')
    .select('live_stock, shadow_stock, threshold_min')
    .eq('restaurant_id', restaurantId)

  if (invError) throw invError

  // Get pending orders count
  const { count: pendingOrders, error: ordError } = await supabase
    .from('procurement_orders')
    .select('*', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .eq('status', 'pending')

  if (ordError) throw ordError

  // Calculate stats
  const totalWines = inventory?.length || 0
  const totalBottles = inventory?.reduce((sum, item) => sum + (item.live_stock || 0), 0) || 0
  const lowStockItems = inventory?.filter(item => 
    item.live_stock <= item.threshold_min
  ).length || 0

  return {
    totalWines,
    totalBottles,
    lowStockItems,
    pendingOrders: pendingOrders || 0,
  }
}

// ============ Real-time Subscriptions ============

export function subscribeToInventoryChanges(
  restaurantId: string,
  callback: (payload: any) => void
) {
  return supabase
    .channel(`inventory:${restaurantId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'restaurant_inventory',
        filter: `restaurant_id=eq.${restaurantId}`,
      },
      callback
    )
    .subscribe()
}

export function subscribeToOrderChanges(
  restaurantId: string,
  callback: (payload: any) => void
) {
  return supabase
    .channel(`orders:${restaurantId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'procurement_orders',
        filter: `restaurant_id=eq.${restaurantId}`,
      },
      callback
    )
    .subscribe()
}

// Export default client
export default supabase

