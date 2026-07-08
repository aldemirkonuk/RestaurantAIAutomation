import { useState, useMemo, useCallback } from 'react'
import { Wine } from '../../data/wineData'
import { useWines, useInventory, useProviders } from '../../hooks/queries'
import { useAuth } from '../../contexts/AuthContext'
import { mapApiWinesToUiWines } from '../../lib/wine-library'

export type SortField = 'name' | 'price' | 'vintage' | 'stock' | 'type' | 'country' | 'status' | 'format'
export type SortOrder = 'asc' | 'desc'
export type ViewMode = 'grid' | 'list'

interface FilterState {
  type: string
  region: string
  country: string
  vintage: string
  priceRange: string
  stockStatus: string
  body: string
  totalSize: string
  bottleSize: string
}

const TYPE_ORDER = ['red', 'white', 'sparkling', 'rose', 'dessert']

const getStockStatus = (wine: Wine) => {
  const stock = wine.liveStock || 0
  const threshold = wine.threshold
  const ratio = stock / threshold

  if (stock === 0) return { status: 'out', label: 'Out of Stock', color: 'rose', priority: 4 }
  if (ratio <= 0.25) return { status: 'critical', label: 'Critical', color: 'rose', priority: 3 }
  if (ratio <= 0.5) return { status: 'low', label: 'Low Stock', color: 'amber', priority: 2 }
  if (ratio <= 1) return { status: 'warning', label: 'Below Min', color: 'yellow', priority: 1 }
  return { status: 'healthy', label: 'In Stock', color: 'emerald', priority: 0 }
}

const normalizeType = (type: string): string => {
  if (type.includes('red')) return 'Red'
  if (type.includes('white')) return 'White'
  if (type === 'sparkling') return 'Sparkling'
  if (type === 'rose') return 'Rosé'
  if (type === 'dessert') return 'Dessert'
  return type.charAt(0).toUpperCase() + type.slice(1)
}

const matchesPriceRange = (price: number, range: string): boolean => {
  if (range === 'All') return true
  switch (range) {
    case 'Under $50': return price < 50
    case '$50 - $100': return price >= 50 && price < 100
    case '$100 - $250': return price >= 100 && price < 250
    case '$250 - $500': return price >= 250 && price < 500
    case 'Over $500': return price >= 500
    default: return true
  }
}

const matchesTotalSize = (stock: number, size: string): boolean => {
  if (size === 'All') return true
  switch (size) {
    case '0': return stock === 0
    case '1-10': return stock >= 1 && stock <= 10
    case '11-25': return stock >= 11 && stock <= 25
    case '26-50': return stock >= 26 && stock <= 50
    case '50+': return stock > 50
    default: return true
  }
}

export function useWineLibraryPage() {
  const { user } = useAuth()

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [searchQuery, setSearchQuery] = useState('')

  // Filter state
  const [filters, setFilters] = useState<FilterState>({
    type: 'All',
    region: 'All',
    country: 'All',
    vintage: 'All',
    priceRange: 'All',
    stockStatus: 'All',
    body: 'All',
    totalSize: 'All',
    bottleSize: 'All',
  })

  // Sort state
  const [sortField, setSortField] = useState<SortField>('type')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [typeSortCycle, setTypeSortCycle] = useState<number>(0)

  // Data from hooks
  const { data: apiWines = [], isLoading: winesLoading, error: winesError } = useWines({
    search: searchQuery || undefined,
    limit: 500,
  })
  const { data: inventoryItems = [] } = useInventory()
  const { data: providers = [] } = useProviders(user?.restaurantId || '')

  // Map inventory data to wines
  const inventoryByWineId = useMemo(() => {
    const map = new Map<string, { stockLive: number; shadowStock: number; threshold: number; isActive: boolean }>()
    inventoryItems.forEach(item => {
      map.set(item.wineId, {
        stockLive: item.stockLive ?? 0,
        shadowStock: item.shadowStock ?? 0,
        threshold: item.thresholdMin ?? 6,
        isActive: item.isActive ?? true,
      })
    })
    return map
  }, [inventoryItems])

  // Convert API wines to UI format with inventory data
  const libraryWines = useMemo(() => {
    const baseWines = mapApiWinesToUiWines(apiWines)
    return baseWines.map(wine => {
      const inv = inventoryByWineId.get(wine.id)
      if (inv) {
        return {
          ...wine,
          liveStock: inv.stockLive,
          threshold: inv.threshold,
          isActive: inv.isActive,
        }
      }
      return wine
    })
  }, [apiWines, inventoryByWineId])

  // Computed values
  const uniqueRegions = useMemo(
    () => [...new Set(libraryWines.map(w => w.region))].sort(),
    [libraryWines],
  )
  const uniqueCountries = useMemo(
    () => [...new Set(libraryWines.map(w => w.country))].sort(),
    [libraryWines],
  )
  const uniqueVintages = useMemo(
    () =>
      [...new Set(libraryWines.map(w => w.vintage).filter(Boolean))].sort(
        (a, b) => (b || 0) - (a || 0),
      ),
    [libraryWines],
  )
  const uniqueBottleSizes = useMemo(() => {
    const sizes = [...new Set(libraryWines.map(w => w.bottleSizeMl ?? 750))].sort((a, b) => a - b)
    return sizes
  }, [libraryWines])

  const filteredWines = useMemo(() => {
    let wines = [...libraryWines]

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      wines = wines.filter(wine =>
        wine.name.toLowerCase().includes(query) ||
        wine.grape.toLowerCase().includes(query) ||
        wine.producer.toLowerCase().includes(query) ||
        wine.region.toLowerCase().includes(query) ||
        wine.country.toLowerCase().includes(query)
      )
    }

    // Type filter
    if (filters.type !== 'All') {
      wines = wines.filter(wine => normalizeType(wine.type) === filters.type)
    }

    // Region filter
    if (filters.region !== 'All') {
      wines = wines.filter(wine => wine.region === filters.region)
    }

    // Country filter
    if (filters.country !== 'All') {
      wines = wines.filter(wine => wine.country === filters.country)
    }

    // Vintage filter
    if (filters.vintage !== 'All') {
      wines = wines.filter(wine => String(wine.vintage) === filters.vintage)
    }

    // Price range filter
    if (filters.priceRange !== 'All') {
      wines = wines.filter(wine => matchesPriceRange(wine.price, filters.priceRange))
    }

    // Stock status filter
    if (filters.stockStatus !== 'All') {
      wines = wines.filter(wine => {
        const status = getStockStatus(wine)
        return status.label === filters.stockStatus
      })
    }

    // Body filter
    if (filters.body !== 'All') {
      wines = wines.filter(wine => wine.body === filters.body)
    }

    // Total size filter
    if (filters.totalSize !== 'All') {
      wines = wines.filter(wine => matchesTotalSize(wine.liveStock || 0, filters.totalSize))
    }

    // Bottle size filter
    if (filters.bottleSize !== 'All') {
      const sizeMl = parseInt(filters.bottleSize, 10)
      wines = wines.filter(wine => (wine.bottleSizeMl ?? 750) === sizeMl)
    }

    // Sort
    wines.sort((a, b) => {
      let aVal: any, bVal: any

      switch (sortField) {
        case 'name':
          aVal = a.name.toLowerCase()
          bVal = b.name.toLowerCase()
          break
        case 'price':
          aVal = a.price
          bVal = b.price
          break
        case 'vintage':
          aVal = a.vintage || 0
          bVal = b.vintage || 0
          break
        case 'stock':
          aVal = a.liveStock || 0
          bVal = b.liveStock || 0
          break
        case 'type': {
          const typeOrder = ['red', 'white', 'rose', 'sparkling']
          const primaryType = typeOrder[typeSortCycle]
          const aIsPrimary = a.type === primaryType ? 0 : 1
          const bIsPrimary = b.type === primaryType ? 0 : 1
          if (aIsPrimary !== bIsPrimary) {
            aVal = aIsPrimary
            bVal = bIsPrimary
          } else {
            aVal = TYPE_ORDER.indexOf(a.type)
            bVal = TYPE_ORDER.indexOf(b.type)
          }
          break
        }
        case 'country':
          aVal = a.country
          bVal = b.country
          break
        case 'status':
          aVal = getStockStatus(a).priority
          bVal = getStockStatus(b).priority
          break
        case 'format':
          aVal = a.bottleSizeMl ?? 750
          bVal = b.bottleSizeMl ?? 750
          break
        default:
          aVal = a.name
          bVal = b.name
      }

      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1
      return 0
    })

    return wines
  }, [libraryWines, searchQuery, filters, sortField, sortOrder, typeSortCycle])

  const stats = useMemo(() => {
    const statusCounts = { 'In Stock': 0, 'Below Min': 0, 'Low Stock': 0, 'Critical': 0, 'Out of Stock': 0 }
    libraryWines.forEach(wine => {
      const status = getStockStatus(wine)
      statusCounts[status.label as keyof typeof statusCounts]++
    })
    return statusCounts
  }, [libraryWines])

  // Actions
  const updateFilter = useCallback((key: keyof FilterState, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }, [])

  const clearAllFilters = useCallback(() => {
    setFilters({
      type: 'All',
      region: 'All',
      country: 'All',
      vintage: 'All',
      priceRange: 'All',
      stockStatus: 'All',
      body: 'All',
      totalSize: 'All',
      bottleSize: 'All',
    })
    setSearchQuery('')
  }, [])

  const handleSort = useCallback((field: SortField) => {
    if (field === 'type') {
      setTypeSortCycle((prev) => (prev + 1) % 4)
      setSortField('type')
    } else {
      if (sortField === field) {
        setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
      } else {
        setSortField(field)
        setSortOrder('asc')
      }
      setTypeSortCycle(0)
    }
  }, [sortField, sortOrder])

  return {
    // View state
    viewMode,
    setViewMode,
    searchQuery,
    setSearchQuery,

    // Filter state
    filters,
    updateFilter,
    clearAllFilters,

    // Sort state
    sortField,
    sortOrder,
    handleSort,

    // Data
    wines: libraryWines,
    isLoading: winesLoading,
    error: winesError,
    providers,
    inventoryItems,

    // Computed values
    filteredWines,
    stats,
    uniqueRegions,
    uniqueCountries,
    uniqueVintages,
    uniqueBottleSizes,
  }
}
