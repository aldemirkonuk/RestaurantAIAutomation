import { Wine } from './wineData'

export interface InventoryItem {
  inventoryId: string
  wineId: string
  quantity: number
  cost: number
  provider: string
  location?: string
  notes?: string
  addedAt: string
  lastUpdated: string
  addedBy?: string
}

// In-memory inventory store (will be replaced with Supabase integration)
let inventoryStore: InventoryItem[] = []

/**
 * Check if a wine already exists in inventory
 */
export function checkInventoryDuplicate(wineId: string): InventoryItem | null {
  const existingItem = inventoryStore.find(item => item.wineId === wineId)
  return existingItem || null
}

/**
 * Add a new wine to inventory
 */
export function addWineToInventory(
  wine: Wine,
  quantity: number,
  cost: number,
  provider: string,
  location?: string,
  notes?: string
): InventoryItem {
  const newItem: InventoryItem = {
    inventoryId: `INV-${Date.now()}`,
    wineId: wine.id,
    quantity,
    cost,
    provider,
    location,
    notes,
    addedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  }

  inventoryStore.push(newItem)
  
  // TODO: Call Supabase API to persist
  console.log('Added to inventory:', newItem)
  
  return newItem
}

/**
 * Update quantity of existing inventory item (add more stock)
 */
export function updateInventoryQuantity(
  inventoryId: string,
  additionalQuantity: number,
  cost?: number
): InventoryItem | null {
  const itemIndex = inventoryStore.findIndex(item => item.inventoryId === inventoryId)
  
  if (itemIndex === -1) {
    return null
  }

  const item = inventoryStore[itemIndex]
  
  // Calculate weighted average cost if new cost provided
  if (cost !== undefined) {
    const totalOldCost = item.cost * item.quantity
    const totalNewCost = cost * additionalQuantity
    const newTotalQuantity = item.quantity + additionalQuantity
    item.cost = (totalOldCost + totalNewCost) / newTotalQuantity
  }

  item.quantity += additionalQuantity
  item.lastUpdated = new Date().toISOString()

  inventoryStore[itemIndex] = item

  // TODO: Call Supabase API to update
  console.log('Updated inventory:', item)

  return item
}

/**
 * Get all inventory items
 */
export function getAllInventory(): InventoryItem[] {
  return [...inventoryStore]
}

/**
 * Get inventory item by wine ID
 */
export function getInventoryByWineId(wineId: string): InventoryItem | null {
  return inventoryStore.find(item => item.wineId === wineId) || null
}

/**
 * Remove inventory item
 */
export function removeInventoryItem(inventoryId: string): boolean {
  const initialLength = inventoryStore.length
  inventoryStore = inventoryStore.filter(item => item.inventoryId !== inventoryId)
  
  // TODO: Call Supabase API to delete
  console.log('Removed from inventory:', inventoryId)
  
  return inventoryStore.length < initialLength
}

/**
 * Update inventory item details
 */
export function updateInventoryItem(
  inventoryId: string,
  updates: Partial<Omit<InventoryItem, 'inventoryId' | 'wineId' | 'addedAt'>>
): InventoryItem | null {
  const itemIndex = inventoryStore.findIndex(item => item.inventoryId === inventoryId)
  
  if (itemIndex === -1) {
    return null
  }

  inventoryStore[itemIndex] = {
    ...inventoryStore[itemIndex],
    ...updates,
    lastUpdated: new Date().toISOString(),
  }

  // TODO: Call Supabase API to update
  console.log('Updated inventory item:', inventoryStore[itemIndex])

  return inventoryStore[itemIndex]
}

/**
 * Clear all inventory (for testing)
 */
export function clearInventory(): void {
  inventoryStore = []
  console.log('Inventory cleared')
}

