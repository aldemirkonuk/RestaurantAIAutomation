import { getSupabaseClient } from "../client"
import type { ProcurementOrder, OrderFilters } from "../types/database.types"

/**
 * Get all orders for a restaurant
 */
export async function getRestaurantOrders(
  restaurantId: string,
  filters?: Omit<OrderFilters, "restaurant_id">
): Promise<ProcurementOrder[]> {
  const supabase = getSupabaseClient()
  let query = supabase
    .from("procurement_orders")
    .select("*")
    .eq("restaurant_id", restaurantId)

  if (filters?.status) {
    query = query.eq("status", filters.status)
  }

  if (filters?.provider_id) {
    query = query.eq("provider_id", filters.provider_id)
  }

  if (filters?.date_from) {
    query = query.gte("created_at", filters.date_from)
  }

  if (filters?.date_to) {
    query = query.lte("created_at", filters.date_to)
  }

  const { data, error } = await query.order("created_at", { ascending: false })

  if (error) throw error
  return data || []
}

/**
 * Get order by ID
 */
export async function getOrderById(orderId: string): Promise<ProcurementOrder | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from("procurement_orders")
    .select("*")
    .eq("order_id", orderId)
    .single()

  if (error) {
    if (error.code === "PGRST116") return null // Not found
    throw error
  }
  return data
}

/**
 * Get pending orders for approval
 */
export async function getPendingOrders(restaurantId: string): Promise<ProcurementOrder[]> {
  return getRestaurantOrders(restaurantId, { status: "pending_approval" })
}

/**
 * Create new procurement order
 */
export async function createOrder(
  order: Omit<ProcurementOrder, "order_id" | "created_at">
): Promise<ProcurementOrder> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from("procurement_orders")
    .insert(order)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Update order status
 */
export async function updateOrderStatus(
  orderId: string,
  status: ProcurementOrder["status"],
  additionalData?: Partial<ProcurementOrder>
): Promise<ProcurementOrder> {
  const supabase = getSupabaseClient()
  const updates: any = { status, ...additionalData }

  if (status === "approved") {
    updates.approved_at = new Date().toISOString()
  }

  if (status === "delivered") {
    updates.delivered_at = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from("procurement_orders")
    .update(updates)
    .eq("order_id", orderId)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Approve order
 */
export async function approveOrder(
  orderId: string,
  finalPrice?: number
): Promise<ProcurementOrder> {
  return updateOrderStatus(orderId, "approved", {
    final_price: finalPrice,
  })
}

/**
 * Cancel order
 */
export async function cancelOrder(orderId: string): Promise<ProcurementOrder> {
  return updateOrderStatus(orderId, "cancelled")
}

/**
 * Add negotiation message to order
 */
export async function addNegotiationMessage(
  orderId: string,
  sender: "agent" | "provider",
  message: string,
  priceOffered?: number
): Promise<ProcurementOrder> {
  const order = await getOrderById(orderId)
  if (!order) throw new Error(`Order ${orderId} not found`)

  const negotiationHistory = order.negotiation_history || []
  negotiationHistory.push({
    sender,
    message,
    timestamp: new Date().toISOString(),
    price_offered: priceOffered,
  })

  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from("procurement_orders")
    .update({ negotiation_history: negotiationHistory })
    .eq("order_id", orderId)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Get orders summary for a restaurant
 */
export async function getOrdersSummary(restaurantId: string) {
  const orders = await getRestaurantOrders(restaurantId)

  return {
    total: orders.length,
    pending: orders.filter((o) => o.status === "pending_approval").length,
    approved: orders.filter((o) => o.status === "approved").length,
    ordered: orders.filter((o) => o.status === "ordered").length,
    delivered: orders.filter((o) => o.status === "delivered").length,
    cancelled: orders.filter((o) => o.status === "cancelled").length,
    total_value: orders
      .filter((o) => o.final_price)
      .reduce((sum, o) => sum + (o.final_price || 0) * o.quantity, 0),
  }
}

