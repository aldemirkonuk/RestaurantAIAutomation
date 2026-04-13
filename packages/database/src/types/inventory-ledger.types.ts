/**
 * Inventory Ledger Type Definitions
 * 
 * Shared types for the immutable inventory transaction ledger
 */

// ============================================================================
// ENUMS
// ============================================================================

export const TransactionTypes = {
  SALE: 'sale',
  PURCHASE: 'purchase',
  ADJUSTMENT: 'adjustment',
  TRANSFER: 'transfer',
  WASTE: 'waste',
  RETURN: 'return',
  COMP: 'comp',
  RECONCILIATION: 'reconciliation',
  INITIAL: 'initial',
  CORRECTION: 'correction',
} as const

export type TransactionType = typeof TransactionTypes[keyof typeof TransactionTypes]

export const TransactionSources = {
  POS: 'pos',
  MANUAL: 'manual',
  ORDER: 'order',
  MOBILE_COUNT: 'mobile_count',
  RECONCILIATION: 'reconciliation',
  SYSTEM: 'system',
  IMPORT: 'import',
  API: 'api',
} as const

export type TransactionSource = typeof TransactionSources[keyof typeof TransactionSources]

export const StockTypes = {
  LIVE: 'live',
  SHADOW: 'shadow',
  RESERVED: 'reserved',
} as const

export type StockType = typeof StockTypes[keyof typeof StockTypes]

// ============================================================================
// DATABASE ROW TYPES
// ============================================================================

export interface InventoryTransactionRow {
  id: string
  restaurant_id: string
  inventory_id: string
  wine_id: string
  transaction_type: TransactionType
  source: TransactionSource
  quantity_change: number
  quantity_before: number
  quantity_after: number
  stock_type: StockType
  reference_type: string | null
  reference_id: string | null
  pos_transaction_id: string | null
  order_id: string | null
  from_location_id: string | null
  to_location_id: string | null
  unit_cost: number | null
  total_cost: number | null
  performed_by: string | null
  performed_by_type: string
  reason: string | null
  notes: string | null
  metadata: Record<string, unknown>
  transaction_date: string
  created_at: string
}

// ============================================================================
// API TYPES
// ============================================================================

export interface CreateInventoryTransactionRequest {
  inventoryId: string
  wineId: string
  transactionType: TransactionType
  source: TransactionSource
  quantityChange: number
  stockType?: StockType
  referenceType?: string
  referenceId?: string
  posTransactionId?: string
  orderId?: string
  fromLocationId?: string
  toLocationId?: string
  unitCost?: number
  reason?: string
  notes?: string
  metadata?: Record<string, unknown>
}

export interface InventoryTransactionResponse {
  id: string
  restaurantId: string
  inventoryId: string
  wineId: string
  transactionType: TransactionType
  source: TransactionSource
  quantityChange: number
  quantityBefore: number
  quantityAfter: number
  stockType: StockType
  referenceType?: string
  referenceId?: string
  posTransactionId?: string
  orderId?: string
  fromLocationId?: string
  toLocationId?: string
  unitCost?: number
  totalCost?: number
  performedBy?: string
  performedByType: string
  reason?: string
  notes?: string
  metadata?: Record<string, unknown>
  transactionDate: string
  createdAt: string
}

export interface TransactionsListResponse {
  transactions: InventoryTransactionResponse[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

export interface InventoryBalanceResponse {
  inventoryId: string
  balance: number
  asOf: string
  stockType: StockType
}

export interface TransactionSummary {
  restaurantId: string
  period: string
  totalIn: number
  totalOut: number
  netChange: number
  transactionCount: number
  byType: Record<string, { count: number; quantity: number }>
  bySource: Record<string, { count: number; quantity: number }>
}

export interface BulkTransactionRequest {
  transactions: CreateInventoryTransactionRequest[]
  correlationId?: string
}

export interface BulkTransactionResponse {
  successCount: number
  failedCount: number
  createdIds: string[]
  errors: { index: number; error: string }[]
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Determine if a transaction type increases stock
 */
export function isStockIncrease(type: TransactionType): boolean {
  return [
    TransactionTypes.PURCHASE,
    TransactionTypes.RETURN,
    TransactionTypes.INITIAL,
  ].includes(type as any)
}

/**
 * Determine if a transaction type decreases stock
 */
export function isStockDecrease(type: TransactionType): boolean {
  return [
    TransactionTypes.SALE,
    TransactionTypes.WASTE,
    TransactionTypes.COMP,
  ].includes(type as any)
}

/**
 * Get a human-readable description for a transaction type
 */
export function getTransactionTypeLabel(type: TransactionType): string {
  const labels: Record<TransactionType, string> = {
    sale: 'Sale',
    purchase: 'Purchase',
    adjustment: 'Adjustment',
    transfer: 'Transfer',
    waste: 'Waste/Spillage',
    return: 'Customer Return',
    comp: 'Complimentary',
    reconciliation: 'Reconciliation',
    initial: 'Initial Stock',
    correction: 'Correction',
  }
  return labels[type] || type
}

/**
 * Get a human-readable description for a transaction source
 */
export function getTransactionSourceLabel(source: TransactionSource): string {
  const labels: Record<TransactionSource, string> = {
    pos: 'POS System',
    manual: 'Manual Entry',
    order: 'Order',
    mobile_count: 'Mobile Count',
    reconciliation: 'Reconciliation',
    system: 'System',
    import: 'Import',
    api: 'API',
  }
  return labels[source] || source
}

/**
 * Calculate running balance from transactions
 */
export function calculateRunningBalance(
  transactions: InventoryTransactionResponse[]
): { date: string; balance: number }[] {
  // Sort by date ascending
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime()
  )

  return sorted.map((txn) => ({
    date: txn.transactionDate,
    balance: txn.quantityAfter,
  }))
}
