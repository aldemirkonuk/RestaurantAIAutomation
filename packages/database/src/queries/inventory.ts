import { getSupabaseClient } from "../client"
import type {
  InventoryItem,
  InventorySummary,
} from "../types/database.types"

/**
 * Get all inventory items for a restaurant
 */
export async function getRestaurantInventory(
  restaurantId: string
): Promise<InventoryItem[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from("restaurant_inventory")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("last_updated", { ascending: false })

  if (error) throw error
  return data || []
}

/**
 * Get inventory items with wine details
 */
export async function getInventoryWithWines(restaurantId: string) {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from("restaurant_inventory")
    .select(`
      *,
      master_wine_library (*)
    `)
    .eq("restaurant_id", restaurantId)
    .order("last_updated", { ascending: false })

  if (error) throw error
  return data || []
}

/**
 * Get low stock items
 */
export async function getLowStockItems(restaurantId: string): Promise<InventoryItem[]> {
  // PostgREST cannot compare two columns in a filter, so fetch the restaurant's
  // inventory and evaluate stock_live <= threshold_min in memory.
  const items = await getRestaurantInventory(restaurantId)
  return items
    .filter((item) => item.stock_live <= item.threshold_min)
    .sort((a, b) => a.stock_live - b.stock_live)
}

/**
 * Get inventory summary statistics
 */
export async function getInventorySummary(
  restaurantId: string
): Promise<InventorySummary> {
  const inventory = await getRestaurantInventory(restaurantId)

  const summary: InventorySummary = {
    total_wines: inventory.length,
    low_stock_count: 0,
    critical_stock_count: 0,
    healthy_stock_count: 0,
    total_value: 0,
  }

  inventory.forEach((item) => {
    const ratio = item.stock_live / item.threshold_min
    
    if (ratio < 1) {
      summary.critical_stock_count++
    } else if (ratio < 2) {
      summary.low_stock_count++
    } else {
      summary.healthy_stock_count++
    }
  })

  return summary
}

/**
 * Update inventory stock level
 */
export async function updateInventoryStock(
  inventoryId: string,
  stockLive: number
): Promise<InventoryItem> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from("restaurant_inventory")
    .update({
      stock_live: stockLive,
      last_updated: new Date().toISOString(),
    })
    .eq("inventory_id", inventoryId)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Create new inventory item
 */
export async function createInventoryItem(
  item: Omit<InventoryItem, "inventory_id" | "created_at" | "last_updated">
): Promise<InventoryItem> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from("restaurant_inventory")
    .insert(item)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Delete inventory item
 */
export async function deleteInventoryItem(inventoryId: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from("restaurant_inventory")
    .delete()
    .eq("inventory_id", inventoryId)

  if (error) throw error
}

