import { useState, useMemo, useCallback } from 'react'
import { Wine } from '../../data/wineData'
import { useInventoryData } from '../../hooks/useInventoryData'
import { useWinesByIds } from '../../hooks/queries'
import { mapApiWinesToUiWines } from '../../lib/wine-library'

export interface InventoryItem extends Wine {
  inventoryId?: string
  storageLocation?: string
  location?: string
  liveStock?: number
  shadowStock?: number
  threshold: number
  lastCounted: string | null
  isActive: boolean
  lastManualAdjustment?: {
    timestamp: Date
    managerName: string
  }
}

export type ViewMode = 'all' | 'live' | 'shadow'
export type SortField = 'name' | 'liveStock' | 'shadowStock' | 'price' | 'menuPrice' | 'margin' | 'threshold' | 'bottleSizeMl'
export type SortOrder = 'asc' | 'desc'

function calculateMargin(costPrice: number, menuPrice?: number): number {
  if (!menuPrice || menuPrice === 0) return 0
  return ((menuPrice - costPrice) / menuPrice) * 100
}

function getDefaultMenuPrice(costPrice: number): number {
  return Math.round(costPrice * 3)
}

export interface UseInventoryPageOptions {
  /** Hide these `restaurant_inventory.id` rows until the server list no longer contains them */
  excludeInventoryRowIds?: string[]
}

export function useInventoryPage(options: UseInventoryPageOptions = {}) {
  // Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterActiveStatus, setFilterActiveStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [filterBottleSize, setFilterBottleSize] = useState<number | 'all'>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('all')
  const [selectedLocationFilter, setSelectedLocationFilter] = useState<string | null>(null)

  // Sort state
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

  // Selection state
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())

  // Data from hooks
  const {
    inventory: apiInventory,
    summary: inventorySummary,
    lowStockItems: apiLowStock,
    isLoading: inventoryLoading,
    error: inventoryError,
    refetch: refetchInventory,
    updateItem: updateInventoryItem,
  } = useInventoryData()

  const excludeRowIdSet = useMemo(
    () => new Set((options.excludeInventoryRowIds ?? []).filter(Boolean)),
    [options.excludeInventoryRowIds],
  )

  const visibleApiInventory = useMemo(
    () => apiInventory.filter((row) => !excludeRowIdSet.has(row.id)),
    [apiInventory, excludeRowIdSet],
  )

  /** Row IDs present in the last successful API payload (before client-side exclusions) */
  const serverInventoryRowIds = useMemo(
    () => apiInventory.map((row) => row.id),
    [apiInventory],
  )

  const wineIds = useMemo(
    () => Array.from(new Set(visibleApiInventory.map((item) => item.wineId).filter(Boolean))),
    [visibleApiInventory],
  )
  const { data: apiWines = [] } = useWinesByIds(wineIds)
  const winesById = useMemo(() => {
    const map = new Map<string, Wine>()
    mapApiWinesToUiWines(apiWines).forEach(wine => {
      map.set(wine.id, wine)
    })
    return map
  }, [apiWines])

  // Convert API data to local format
  const inventory = useMemo(() => {
    if (inventoryLoading || visibleApiInventory.length === 0) {
      return []
    }

    return visibleApiInventory.map((item) => {
      const wine = winesById.get(item.wineId)
      const fallback: Wine = wine || {
        id: item.wineId,
        sku: undefined,
        name: item.wineName || 'Unknown Wine',
        producer: item.wineProducer || 'Unknown Producer',
        vintage: null,
        price: 0,
        type: 'red',
        grape: '',
        country: '',
        region: '',
        appellation: '',
        body: '',
        sweetness: '',
        acidity: '',
        alcohol: 0,
        aromas: [],
        flavors: [],
        liveStock: null,
        threshold: 10,
        bottleSizeMl: 750,
        provider: {
          name: '',
          contact: '',
          phone: '',
          email: undefined,
          address: undefined,
        },
        image: undefined,
        isActive: true,
      }

      return {
        ...fallback,
        inventoryId: item.id,
        id: item.wineId,
        storageLocation: (item as any).storageLocation,
        location: (item as any).location,
        liveStock: item.stockLive || 0,
        shadowStock: item.shadowStock || 0,
        threshold: item.thresholdMin || fallback.threshold || 10,
        lastCounted: item.updatedAt || null,
        isActive: item.isActive ?? true,
        bottleSizeMl: item.bottleSizeMl ?? fallback.bottleSizeMl,
        saleType: item.saleType ?? fallback.saleType,
        pourSizeMl: item.pourSizeMl ?? fallback.pourSizeMl,
        menuPriceGlass: item.menuPriceGlass ?? fallback.menuPriceGlass,
      } as InventoryItem
    })
  }, [visibleApiInventory, inventoryLoading, winesById])

  // Computed values
  const filteredInventory = useMemo(() => {
    let items = [...inventory]

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      items = items.filter(item =>
        item.name.toLowerCase().includes(query) ||
        item.producer.toLowerCase().includes(query) ||
        item.grape.toLowerCase().includes(query)
      )
    }

    // Type filter
    if (filterType !== 'all') {
      items = items.filter(item => item.type === filterType)
    }

    // Status filter
    if (filterStatus !== 'all') {
      if (filterStatus === 'critical') {
        items = items.filter(item => (item.liveStock || 0) <= item.threshold * 0.5)
      } else if (filterStatus === 'low') {
        items = items.filter(item =>
          (item.liveStock || 0) > item.threshold * 0.5 &&
          (item.liveStock || 0) <= item.threshold
        )
      } else if (filterStatus === 'healthy') {
        items = items.filter(item => (item.liveStock || 0) > item.threshold)
      }
    }

    // Active status filter
    if (filterActiveStatus === 'active') {
      items = items.filter(item => item.isActive)
    } else if (filterActiveStatus === 'inactive') {
      items = items.filter(item => !item.isActive)
    }

    // Bottle size filter
    if (filterBottleSize !== 'all') {
      items = items.filter(item => (item.bottleSizeMl || 750) === filterBottleSize)
    }

    // View mode filter
    if (viewMode === 'live') {
      items = items.filter(item => (item.liveStock || 0) > 0)
    } else if (viewMode === 'shadow') {
      items = items.filter(item => (item.shadowStock || 0) > 0)
    }

    // Sort
    items.sort((a, b) => {
      let aVal: any, bVal: any
      switch (sortField) {
        case 'name':
          aVal = a.name.toLowerCase()
          bVal = b.name.toLowerCase()
          break
        case 'liveStock':
          aVal = a.liveStock || 0
          bVal = b.liveStock || 0
          break
        case 'shadowStock':
          aVal = a.shadowStock || 0
          bVal = b.shadowStock || 0
          break
        case 'price':
          aVal = a.price
          bVal = b.price
          break
        case 'menuPrice':
          aVal = a.menuPrice || getDefaultMenuPrice(a.price)
          bVal = b.menuPrice || getDefaultMenuPrice(b.price)
          break
        case 'margin':
          aVal = calculateMargin(a.price, a.menuPrice || getDefaultMenuPrice(a.price))
          bVal = calculateMargin(b.price, b.menuPrice || getDefaultMenuPrice(b.price))
          break
        case 'threshold':
          aVal = a.threshold
          bVal = b.threshold
          break
        case 'bottleSizeMl':
          aVal = a.bottleSizeMl || 750
          bVal = b.bottleSizeMl || 750
          break
        default:
          aVal = a.name
          bVal = b.name
      }

      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1
      return 0
    })

    return items
  }, [
    inventory,
    searchQuery,
    filterType,
    filterStatus,
    viewMode,
    sortField,
    sortOrder,
    filterActiveStatus,
    filterBottleSize,
    selectedLocationFilter,
  ])

  const stats = useMemo(() => {
    const total = inventory.length
    const liveTotal = inventory.reduce((sum, item) => sum + (item.liveStock || 0), 0)
    const shadowTotal = inventory.reduce((sum, item) => sum + (item.shadowStock || 0), 0)
    const critical = inventory.filter(item => (item.liveStock || 0) <= item.threshold * 0.5).length
    const low = inventory.filter(item =>
      (item.liveStock || 0) > item.threshold * 0.5 &&
      (item.liveStock || 0) <= item.threshold
    ).length
    const healthy = inventory.filter(item => (item.liveStock || 0) > item.threshold).length
    const needsReconciliation = inventory.filter(item => (item.shadowStock || 0) > 0).length

    return { total, liveTotal, shadowTotal, critical, low, healthy, needsReconciliation }
  }, [inventory])

  const uniqueBottleSizes = useMemo(() => {
    const sizes = new Set(inventory.map(item => item.bottleSizeMl || 750))
    return Array.from(sizes).sort((a, b) => a - b)
  }, [inventory])

  // Actions
  const toggleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }, [sortField, sortOrder])

  const toggleSelection = useCallback((id: string) => {
    setSelectedItems(prev => {
      const newSelected = new Set(prev)
      if (newSelected.has(id)) {
        newSelected.delete(id)
      } else {
        newSelected.add(id)
      }
      return newSelected
    })
  }, [])

  const clearFilters = useCallback(() => {
    setFilterType('all')
    setFilterStatus('all')
    setFilterActiveStatus('all')
    setFilterBottleSize('all')
    setSearchQuery('')
    setSelectedLocationFilter(null)
  }, [])

  return {
    // Filter state
    searchQuery,
    setSearchQuery,
    filterType,
    setFilterType,
    filterStatus,
    setFilterStatus,
    filterActiveStatus,
    setFilterActiveStatus,
    filterBottleSize,
    setFilterBottleSize,
    viewMode,
    setViewMode,
    selectedLocationFilter,
    setSelectedLocationFilter,
    clearFilters,

    // Sort state
    sortField,
    sortOrder,
    toggleSort,

    // Selection state
    selectedItems,
    toggleSelection,
    setSelectedItems,

    // Data
    inventory,
    serverInventoryRowIds,
    inventorySummary,
    lowStockItems: apiLowStock,
    isLoading: inventoryLoading,
    error: inventoryError,
    refetchInventory,
    updateInventoryItem,

    // Computed values
    filteredInventory,
    stats,
    uniqueBottleSizes,
  }
}
