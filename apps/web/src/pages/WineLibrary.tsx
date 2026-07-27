import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Header } from '../components/layout/Header'
import { AddWineModal } from '../components/wines/AddWineModal'
import { AddWineSelectionModal } from '../components/wines/AddWineSelectionModal'
import { MenuScannerModal } from '../components/wines/MenuScannerModal'
import { MenuScannerFlow } from '../components/scanner/MenuScannerFlow'
import { DevWinePhotoUpload } from '../components/wines/DevWinePhotoUpload'
import { DevManualWineEntry } from '../components/wines/DevManualWineEntry'
import { AddToInventoryFromLibraryModal } from '../components/wines/AddToInventoryFromLibraryModal'
import { useUserPreferences } from '../hooks/useUserPreferences'
import {
  Search,
  Filter,
  Grid,
  List,
  Star,
  Wine,
  MapPin,
  Calendar,
  Grape,
  X,
  Camera,
  ArrowUpDown,
  SortAsc,
  SortDesc,
  ShoppingCart,
  Save,
  RotateCcw,
  Plus,
  Minus,
  AlertTriangle,
  Phone,
  Upload,
  Package,
  Trash2,
  Copy,
  CheckSquare,
  ChevronDown,
} from 'lucide-react'
import { Wine as WineType, getWineTypeColor } from '../data/wineData'
import type { Provider } from '../services/api/providers'
import { useRecommendedProviders } from '../hooks/queries'
import { useAuth } from '../contexts/AuthContext'
import { ExportMenu } from '../components/ui/ExportMenu'
import { exportTable, type TableExportColumn, type TableExportFormat } from '../lib/tableExport'
import { toast } from 'sonner'
import { useWineSubscription, WineUpdatePayload } from '../contexts/RealtimeContext'
import { formatVolume } from '../utils/volumeUtils'
import { useUIStore, useRestaurantSettingsStore } from '../stores'
import { useWineLibraryPage } from './wine-library/useWineLibraryPage'

const getStockStatus = (wine: WineType) => {
  const stock = wine.liveStock || 0
  const threshold = wine.threshold
  const ratio = stock / threshold

  if (stock === 0) return { status: 'out', label: 'Out of Stock', color: 'wine', priority: 4 }
  if (ratio <= 0.25) return { status: 'critical', label: 'Critical', color: 'wine', priority: 3 }
  if (ratio <= 0.5) return { status: 'low', label: 'Low Stock', color: 'amber', priority: 2 }
  if (ratio <= 1) return { status: 'warning', label: 'Below Min', color: 'yellow', priority: 1 }
  return { status: 'healthy', label: 'In Stock', color: 'emerald', priority: 0 }
}

const getRecommendedProviders = (providerList: Provider[]) => {
  const sorted = [...providerList].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
  return {
    primary: sorted[0],
    alternatives: sorted.slice(1, 3),
  }
}

interface ReorderState {
  wine: WineType
  quantity: number
  selectedProviders: string[]
  notes: string
  saveAsRecurring: boolean
  recurringFrequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly'
  priceMode: 'custom' | 'ask'
  customPrice?: number
}

export function WineLibrary() {
  const { setPendingReorder } = useUIStore()
  const { measurementUnit } = useRestaurantSettingsStore()
  const { preferences, updatePreferences } = useUserPreferences()

  // Page hook: filter, sort, view, computed data
  const {
    viewMode, setViewMode,
    searchQuery, setSearchQuery,
    filters, updateFilter, clearAllFilters: hookClearAllFilters,
    sortField, sortOrder, handleSort,
    wines: libraryWines,
    isLoading: _winesLoading,
    error: _winesError,
    providers,
    filteredWines: hookFilteredWines,
    stats: statusCounts,
    uniqueRegions,
    uniqueCountries,
    uniqueVintages,
    uniqueBottleSizes: rawUniqueBottleSizes,
  } = useWineLibraryPage()

  const uniqueBottleSizes = useMemo(
    () => rawUniqueBottleSizes.map(ml => ({ ml, label: formatVolume(ml, measurementUnit) })),
    [rawUniqueBottleSizes, measurementUnit],
  )

  const [showFilters, setShowFilters] = useState(false)
  const [selectedWine, setSelectedWine] = useState<WineType | null>(null)

  const favoritesArray: string[] = preferences.wineFavorites ?? []
  const removedWinesArray: string[] = preferences.removedWines ?? []
  const favorites = useMemo(() => new Set(favoritesArray), [favoritesArray])
  const removedWines = useMemo(() => new Set(removedWinesArray), [removedWinesArray])
  const [showAddSelectionModal, setShowAddSelectionModal] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showMenuScanner, setShowMenuScanner] = useState(false)
  const [showNewScannerFlow, setShowNewScannerFlow] = useState(false)
  const [page, setPage] = useState(1)
  const [reorderModal, setReorderModal] = useState<ReorderState | null>(null)
  const [savedPreferences, setSavedPreferences] = useState<{ [wineId: string]: Partial<ReorderState> }>({})
  const [providerSearch, setProviderSearch] = useState('')
  
  const [showAddToInventoryModal, setShowAddToInventoryModal] = useState(false)
  const [selectedWineForInventory, setSelectedWineForInventory] = useState<WineType | null>(null)
  // Multi-select (NEW-200): the stub that shipped with no UI is now the real thing.
  const [bulkSelectedWines, setBulkSelectedWines] = useState<Set<string>>(new Set())
  const [wineMenu, setWineMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false)

  // Apply removed-wines filter on top of hook's filtered wines
  const filteredWines = useMemo(
    () => hookFilteredWines.filter(wine => !removedWines.has(wine.id)),
    [hookFilteredWines, removedWines],
  )
  
  const [devMode, setDevMode] = useState(false)
  const [showDevPhotoUpload, setShowDevPhotoUpload] = useState(false)
  const [showDevManualEntry, setShowDevManualEntry] = useState(false)
  const [titleClickCount, setTitleClickCount] = useState(0)

  const { user } = useAuth()
  const { data: recommendedProviders = [] } = useRecommendedProviders(user?.restaurantId || '', selectedWine?.id || '')

  useEffect(() => {
    setProviderDropdownOpen(false)
  }, [selectedWine?.id])

  const recommendedProvidersArray: Provider[] = Array.isArray(recommendedProviders)
    ? recommendedProviders
    : (recommendedProviders as { primary: Provider; alternatives: Provider[] }).primary
      ? [(recommendedProviders as { primary: Provider; alternatives: Provider[] }).primary, ...(recommendedProviders as { primary: Provider; alternatives: Provider[] }).alternatives]
      : []
  const wineProviders: Provider[] = recommendedProvidersArray.length > 0 ? recommendedProvidersArray : providers
  const providerLabel = wineProviders.length > 1 ? 'Providers' : 'Provider'

  // Track wine stock updates from Inventory page
  const [_wineStockUpdates, setWineStockUpdates] = useState<Map<string, { liveStock: number; shadowStock: number; isActive: boolean }>>(new Map())

  useWineSubscription((payload: WineUpdatePayload) => {
    if (payload.source === 'inventory' && payload.data) {
      setWineStockUpdates(prev => {
        const updated = new Map(prev)
        updated.set(payload.wineId, {
          liveStock: payload.data?.liveStock ?? 0,
          shadowStock: payload.data?.shadowStock ?? 0,
          isActive: payload.data?.isActive ?? true,
        })
        return updated
      })
    }
  })
  
  // Triple-click on "Wine Library" title to toggle dev mode
  const handleTitleClick = () => {
    setTitleClickCount(prev => prev + 1)
    setTimeout(() => setTitleClickCount(0), 1000)
    
    if (titleClickCount === 2) {
      setDevMode(!devMode)
      if (!devMode) {
        alert('🔧 Developer Mode Activated!\n\nYou now have access to:\n• Wine Label Photo Testing\n• Manual Wine Entry Mode')
      } else {
        alert('👋 Developer Mode Deactivated.')
      }
    }
  }
  
  const clearAllFilters = () => {
    hookClearAllFilters()
    setPage(1)
  }

  const toggleFavorite = useCallback((id: string) => {
    const current = [...favoritesArray]
    const idx = current.indexOf(id)
    if (idx > -1) {
      current.splice(idx, 1)
    } else {
      current.push(id)
    }
    updatePreferences({ wineFavorites: current })
  }, [favoritesArray, updatePreferences])

  // toggleActive removed - active/inactive status now managed in Inventory.tsx

  const normalizeType = (type: string): string => {
    if (type.includes('red')) return 'Red'
    if (type.includes('white')) return 'White'
    if (type === 'sparkling') return 'Sparkling'
    if (type === 'rose') return 'Rosé'
    if (type === 'dessert') return 'Dessert'
    return type.charAt(0).toUpperCase() + type.slice(1)
  }

  const getTypeColorClass = (type: string) => {
    const colors = getWineTypeColor(type as WineType['type'])
    return `${colors.bg} ${colors.text}`
  }

  const handleAddWine = (wine: any) => {
    console.log('Adding wine:', wine)
    setShowAddModal(false)
  }

  const getWineImage = (wine: WineType) => {
    const typeImages: Record<string, string> = {
      red: 'https://images.vivino.com/thumbs/ApnCVCFZgHIDkvlJbWWqhA_375x500.jpg',
      white: 'https://images.vivino.com/thumbs/GCBwC5BcKLx1bWb0fB2ZZQ_375x500.jpg',
      sparkling: 'https://images.vivino.com/thumbs/Hk2pJTVKT3LMcmcKRbNkPg_375x500.jpg',
      rose: 'https://images.vivino.com/thumbs/I5aChR5T2XSP1sI-aXiYkA_375x500.jpg',
      dessert: 'https://images.vivino.com/thumbs/kpS1D-qzSvOvPFGqT8yUbA_375x500.jpg',
    }
    return wine.image || typeImages[wine.type] || typeImages.red
  }

  const openReorderModal = (wine: WineType, e?: React.MouseEvent) => {
    e?.stopPropagation()
    const saved = savedPreferences[wine.id]
    const recommended = getRecommendedProviders(providers)
    
    // Default to primary provider if available, otherwise empty
    const defaultProviders = recommended.primary ? [recommended.primary.id] : []
    
    setReorderModal({
      wine,
      quantity: saved?.quantity || Math.max(1, wine.threshold - (wine.liveStock || 0)),
      selectedProviders: saved?.selectedProviders || defaultProviders,
      notes: saved?.notes || '',
      saveAsRecurring: saved?.saveAsRecurring || false,
      recurringFrequency: saved?.recurringFrequency || 'monthly',
      priceMode: saved?.priceMode || 'ask',
      customPrice: saved?.customPrice,
    })
    setProviderSearch('') // Reset search
  }

  // Add to Inventory handlers
  const handleAddToInventory = (wine: WineType, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setSelectedWineForInventory(wine)
    setShowAddToInventoryModal(true)
  }

  const handleInventorySuccess = (message: string) => {
    alert(message)
    setShowAddToInventoryModal(false)
    setSelectedWineForInventory(null)
  }

  const handleRemoveFromLibrary = (wine: WineType, e?: React.MouseEvent) => {
    e?.stopPropagation()
    
    const confirmMessage = `Are you sure you want to remove "${wine.name}" from your Wine Library?

This action will:
• Remove the wine from your curated library
• Keep the wine in the Master Library (can be re-added anytime)
• NOT affect any existing inventory or orders

This cannot be undone.`

    if (confirm(confirmMessage)) {
      const newRemoved = [...removedWinesArray, wine.id]
      const newFavs = favoritesArray.filter(fId => fId !== wine.id)
      updatePreferences({ removedWines: newRemoved, wineFavorites: newFavs })
      
      console.log('Removing wine from library:', wine.name, wine.id)
      alert(`"${wine.name}" has been removed from your Wine Library.

The wine is still available in the Master Library if you want to add it back later.`)
    }
  }

  const handlePlaceOrder = () => {
    if (!reorderModal || reorderModal.selectedProviders.length === 0) {
      alert('Please select at least one provider.')
      return
    }
    
    // Save preferences if requested
    if (reorderModal.saveAsRecurring) {
      setSavedPreferences(prev => ({
        ...prev,
        [reorderModal.wine.id]: {
          quantity: reorderModal.quantity,
          selectedProviders: reorderModal.selectedProviders,
          notes: reorderModal.notes,
          saveAsRecurring: reorderModal.saveAsRecurring,
          recurringFrequency: reorderModal.recurringFrequency,
          priceMode: reorderModal.priceMode,
          customPrice: reorderModal.customPrice,
        },
      }))
    }
    
    // Create order data to pass to Orders page
    const orderData = {
      wineId: reorderModal.wine.id,
      wineName: reorderModal.wine.name,
      quantity: reorderModal.quantity,
      unitType: 'bottle' as const, // Default to bottle, can be extended if needed
      price: reorderModal.priceMode === 'custom' && reorderModal.customPrice 
        ? reorderModal.customPrice 
        : reorderModal.wine.price,
      selectedProviders: reorderModal.selectedProviders,
      notes: reorderModal.notes,
    }
    
    // Store order data in Zustand store to be picked up by Orders page
    setPendingReorder(orderData)
    
    // Get provider names for the alert
    const selectedProviderNames = reorderModal.selectedProviders
      .map(id => providers.find(p => p.id === id)?.name)
      .filter(Boolean)
      .join(', ')
    
    console.log('Creating reorder from Wine Library:', orderData)
    
    alert(`✅ Order created for ${reorderModal.wine.name}
    
Quantity: ${reorderModal.quantity} bottles
Providers: ${selectedProviderNames}
${reorderModal.priceMode === 'custom' ? `Price: $${reorderModal.customPrice}/bottle` : 'Price: To be negotiated by AI'}

The AI will contact the selected provider(s) via Plivo. You'll receive notifications as they respond.

Redirecting to Orders page...`)
    
    setReorderModal(null)
    
    // Navigate to Orders page
    window.location.href = '/orders'
  }

  const pageSize = viewMode === 'grid' ? 24 : 50
  const totalPages = Math.max(1, Math.ceil(filteredWines.length / pageSize))
  const currentPage = Math.min(page, totalPages)

  useEffect(() => {
    setPage(1)
  }, [searchQuery, filters, viewMode, sortField, sortOrder])

  const pagedWines = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredWines.slice(start, start + pageSize)
  }, [filteredWines, currentPage, pageSize])

  const activeFiltersCount = Object.values(filters).filter(v => v !== 'All').length

  // ── Multi-select (NEW-200/201/250) ────────────────────────────────────────
  const toggleWineSelection = useCallback((id: string) => {
    setBulkSelectedWines(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const allPageSelected = pagedWines.length > 0 && pagedWines.every(w => bulkSelectedWines.has(w.id))
  const toggleSelectAllFiltered = useCallback(() => {
    setBulkSelectedWines(prev =>
      filteredWines.length > 0 && filteredWines.every(w => prev.has(w.id))
        ? new Set()
        : new Set(filteredWines.map(w => w.id)),
    )
  }, [filteredWines])
  const clearWineSelection = useCallback(() => setBulkSelectedWines(new Set()), [])

  const selectedWineObjects = useMemo(
    () => filteredWines.filter(w => bulkSelectedWines.has(w.id)),
    [filteredWines, bulkSelectedWines],
  )

  /** NEW-201: bulk favorite / unfavorite. Unfavorites only when all are already starred. */
  const bulkToggleFavorite = useCallback(() => {
    const ids = selectedWineObjects.map(w => w.id)
    if (ids.length === 0) return
    const allFav = ids.every(id => favorites.has(id))
    const next = allFav
      ? favoritesArray.filter(id => !ids.includes(id))
      : Array.from(new Set([...favoritesArray, ...ids]))
    updatePreferences({ wineFavorites: next })
  }, [selectedWineObjects, favorites, favoritesArray, updatePreferences])

  /** NEW-250: bulk remove from library (master library keeps the record). */
  const bulkRemoveFromLibrary = useCallback(() => {
    const ids = selectedWineObjects.map(w => w.id)
    if (ids.length === 0) return
    if (!confirm(`Remove ${ids.length} wine${ids.length === 1 ? '' : 's'} from your Wine Library?\n\nThey stay in the Master Library and can be re-added. Inventory and orders are unaffected.`)) return
    updatePreferences({
      removedWines: Array.from(new Set([...removedWinesArray, ...ids])),
      wineFavorites: favoritesArray.filter(id => !ids.includes(id)),
    })
    clearWineSelection()
  }, [selectedWineObjects, removedWinesArray, favoritesArray, updatePreferences, clearWineSelection])

  const wineExportColumns: TableExportColumn<WineType>[] = useMemo(
    () => [
      { header: 'Wine ID', value: (w) => w.id },
      { header: 'SKU', value: (w) => w.sku ?? '' },
      { header: 'Wine Name', value: (w) => w.name },
      { header: 'Producer', value: (w) => w.producer },
      { header: 'Vintage', value: (w) => w.vintage ?? 'NV' },
      { header: 'Type', value: (w) => w.type },
      { header: 'Grape Variety', value: (w) => w.grape },
      { header: 'Country', value: (w) => w.country },
      { header: 'Region', value: (w) => w.region },
      { header: 'Appellation', value: (w) => w.appellation },
      { header: 'Body', value: (w) => w.body },
      { header: 'Sweetness', value: (w) => w.sweetness },
      { header: 'Acidity', value: (w) => w.acidity },
      { header: 'Alcohol %', value: (w) => w.alcohol },
      { header: 'Aromas', value: (w) => (w.aromas ?? []).join('; ') },
      { header: 'Flavors', value: (w) => (w.flavors ?? []).join('; ') },
      { header: 'Current Stock', value: (w) => w.liveStock ?? 0 },
      { header: 'Threshold', value: (w) => w.threshold },
      { header: 'Stock Status', value: (w) => getStockStatus(w).label },
      { header: 'Price ($)', value: (w) => w.price },
      { header: 'Provider Name', value: (w) => w.provider?.name ?? '' },
      { header: 'Provider Phone', value: (w) => w.provider?.phone ?? '' },
      { header: 'Provider Email', value: (w) => w.provider?.email ?? '' },
    ],
    [],
  )

  const runWineExport = useCallback(
    async (format: TableExportFormat, rows: WineType[], filename: string, title: string) => {
      try {
        await exportTable({ format, rows, columns: wineExportColumns, filename, title })
        toast.success(
          format === 'clipboard'
            ? `Copied ${rows.length} wines`
            : format === 'print'
              ? 'Opening print view'
              : `Exported ${rows.length} wines`,
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Export failed')
      }
    },
    [wineExportColumns],
  )

  const exportFilteredWines = useCallback(
    (format: TableExportFormat) =>
      runWineExport(
        format,
        filteredWines,
        `wine-library-${new Date().toISOString().slice(0, 10)}`,
        'Wine Library',
      ),
    [filteredWines, runWineExport],
  )

  /** Bulk export just the selected rows (NEW-200 bulk bar). */
  const bulkExportSelected = useCallback(
    (format: TableExportFormat) => {
      if (selectedWineObjects.length === 0) return
      return runWineExport(
        format,
        selectedWineObjects,
        `wine-library-selection-${new Date().toISOString().slice(0, 10)}`,
        'Wine Library selection',
      )
    },
    [selectedWineObjects, runWineExport],
  )

  // ── Keyboard shortcuts (NEW-208/234) ──────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey) return
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      const modalOpen = !!selectedWine || !!reorderModal || showAddModal || showMenuScanner || showAddToInventoryModal
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        if (typing || modalOpen) return
        e.preventDefault()
        setBulkSelectedWines(new Set(filteredWines.map(w => w.id)))
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        if (typing || modalOpen) return
        e.preventDefault()
        void exportFilteredWines('csv')
        return
      }
      if (e.metaKey || e.ctrlKey || typing || modalOpen) return
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus() }
      else if (e.key === 'g') setViewMode('grid')
      else if (e.key === 'l') setViewMode('list')
      else if (e.key === 'f') setShowFilters(s => !s)
      else if (e.key === 'Escape' && bulkSelectedWines.size) clearWineSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filteredWines, selectedWine, reorderModal, showAddModal, showMenuScanner, showAddToInventoryModal, bulkSelectedWines.size, clearWineSelection, setViewMode, exportFilteredWines])

  // Close the right-click menu on any outside click.
  useEffect(() => {
    if (!wineMenu) return
    const close = () => setWineMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [wineMenu])

  return (
    <div className="min-h-screen">
      {/* Header with secret dev mode toggle */}
      <div onClick={handleTitleClick} className="cursor-pointer select-none">
        <Header 
          title={devMode ? "🔧 Wine Library [DEV MODE]" : "Wine Library"} 
          subtitle={`${libraryWines.length} wines in your collection`}
        />
      </div>

      <div className="p-6">
        {/* Dev Mode Toolbar */}
        {devMode && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 bg-gradient-to-r from-wine-600 to-wine-800 rounded-xl shadow-lg"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-lg">
                  <Camera className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-white font-bold text-lg">Developer Testing Tools</h3>
                  <p className="text-white/80 text-sm">Wine label photo testing & manual data entry for development</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowDevManualEntry(true)}
                  className="px-6 py-3 bg-white text-red-600 font-semibold rounded-lg hover:bg-gray-100 transition-colors shadow-lg flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  Manual Entry Mode
                </button>
                <button
                  onClick={() => setShowDevPhotoUpload(true)}
                  className="px-6 py-3 bg-white text-red-600 font-semibold rounded-lg hover:bg-gray-100 transition-colors shadow-lg flex items-center gap-2"
                >
                  <Upload className="w-5 h-5" />
                  Upload Test Photos
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Toolbar */}
        <div className="flex flex-col lg:flex-row gap-4 mb-6">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search wines, grapes, producers, regions...    ( / )"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent outline-none transition-all"
            />
          </div>

          {/* Type Filter Pills - Ordered: Red → White → Sparkling → Rosé → Dessert */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 lg:pb-0">
            {['All', 'Red', 'White', 'Sparkling', 'Rosé', 'Dessert'].map((type) => (
              <button
                key={type}
                onClick={() => updateFilter('type', type)}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                  filters.type === type
                    ? 'bg-wine-600 text-white shadow-lg shadow-wine-600/30'
                    : 'bg-white text-gray-600 border border-gray-200 hover:border-wine-300 hover:text-wine-600'
                }`}
              >
                {type}
              </button>
            ))}
          </div>

          {/* View Toggle & Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl border transition-all relative ${
                showFilters || activeFiltersCount > 0
                  ? 'bg-wine-50 border-wine-200 text-wine-600'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              <Filter className="w-4 h-4" />
              <span className="text-sm font-medium">Filters</span>
              {activeFiltersCount > 0 && (
                <span className="absolute -top-2 -right-2 w-5 h-5 bg-wine-600 text-white text-xs rounded-full flex items-center justify-center">
                  {activeFiltersCount}
                </span>
              )}
            </button>

            <div className="flex bg-white border border-gray-200 rounded-xl p-1">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded-lg transition-all ${
                  viewMode === 'grid' ? 'bg-gray-100 text-gray-900' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <Grid className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-lg transition-all ${
                  viewMode === 'list' ? 'bg-gray-100 text-gray-900' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <List className="w-5 h-5" />
              </button>
            </div>

            <ExportMenu
              variant="solid"
              label="Export"
              count={filteredWines.length}
              onExport={exportFilteredWines}
              triggerClassName="rounded-xl px-4 py-3 h-auto"
              title="Export the filtered wine library"
            />

            <button 
              onClick={() => setShowAddSelectionModal(true)}
              className="flex items-center gap-2 px-4 py-3 bg-wine-600 text-white rounded-xl hover:bg-wine-700 shadow-lg shadow-wine-600/30 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span className="text-sm font-medium">Add Wine</span>
            </button>
          </div>
        </div>

        {/* Extended Filters */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6 overflow-hidden"
            >
              <div className="p-4 bg-white border border-gray-200 rounded-xl space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
                  {/* Country */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Country</label>
                    <select
                      value={filters.country}
                      onChange={(e) => updateFilter('country', e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                    >
                      <option value="All">All Countries</option>
                      {uniqueCountries.map((country) => (
                        <option key={country} value={country}>{country}</option>
                      ))}
                    </select>
                  </div>

                  {/* Region */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Region</label>
                    <select
                      value={filters.region}
                      onChange={(e) => updateFilter('region', e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                    >
                      <option value="All">All Regions</option>
                      {uniqueRegions.map((region) => (
                        <option key={region} value={region}>{region}</option>
                      ))}
                    </select>
                  </div>

                  {/* Vintage */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Vintage</label>
                    <select
                      value={filters.vintage}
                      onChange={(e) => updateFilter('vintage', e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                    >
                      <option value="All">All Years</option>
                      {uniqueVintages.map((vintage) => (
                        <option key={vintage} value={String(vintage)}>{vintage}</option>
                      ))}
                    </select>
                  </div>

                  {/* Price Range */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Price Range</label>
                    <select
                      value={filters.priceRange}
                      onChange={(e) => updateFilter('priceRange', e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                    >
                      <option value="All">All Prices</option>
                      <option value="Under $50">Under $50</option>
                      <option value="$50 - $100">$50 - $100</option>
                      <option value="$100 - $250">$100 - $250</option>
                      <option value="$250 - $500">$250 - $500</option>
                      <option value="Over $500">Over $500</option>
                    </select>
                  </div>

                  {/* Total Size (Stock Quantity) */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Total Size</label>
                    <select
                      value={filters.totalSize}
                      onChange={(e) => updateFilter('totalSize', e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                    >
                      <option value="All">All Sizes</option>
                      <option value="0">0 bottles</option>
                      <option value="1-10">1-10 bottles</option>
                      <option value="11-25">11-25 bottles</option>
                      <option value="26-50">26-50 bottles</option>
                      <option value="50+">50+ bottles</option>
                    </select>
                  </div>

                  {/* Status (Based on threshold_min) */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Status</label>
                    <select
                      value={filters.stockStatus}
                      onChange={(e) => updateFilter('stockStatus', e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                    >
                      <option value="All">All Status</option>
                      <option value="In Stock">In Stock ({statusCounts['In Stock']})</option>
                      <option value="Below Min">Below Min ({statusCounts['Below Min']})</option>
                      <option value="Low Stock">Low Stock ({statusCounts['Low Stock']})</option>
                      <option value="Critical">Critical ({statusCounts['Critical']})</option>
                      <option value="Out of Stock">Out of Stock ({statusCounts['Out of Stock']})</option>
                    </select>
                  </div>

                  {/* Body */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Body</label>
                    <select
                      value={filters.body}
                      onChange={(e) => updateFilter('body', e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                    >
                      <option value="All">All Bodies</option>
                      <option value="light">Light</option>
                      <option value="medium">Medium</option>
                      <option value="full">Full</option>
                    </select>
                  </div>

                  {/* Bottle Size (Format) */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Format</label>
                    <select
                      value={filters.bottleSize}
                      onChange={(e) => updateFilter('bottleSize', e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                    >
                      <option value="All">All Sizes</option>
                      {uniqueBottleSizes.map(({ ml, label }) => (
                        <option key={ml} value={String(ml)}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Clear Filters */}
                <div className="flex justify-end">
                  <button
                    onClick={clearAllFilters}
                    className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-wine-600 transition-colors"
                  >
                    Clear All Filters
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results Count & Sort (alphabet row removed) */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <p className="text-sm text-gray-500">
            Showing <span className="font-medium text-gray-900">{pagedWines.length}</span> of{' '}
            <span className="font-medium text-gray-900">{filteredWines.length}</span> wines
          </p>
          
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Sort by:</span>
            <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
              {[
                { field: 'type' as const, label: 'Type' },
                { field: 'format' as const, label: 'Format' },
                { field: 'name' as const, label: 'A-Z' },
                { field: 'country' as const, label: 'Country' },
                { field: 'vintage' as const, label: 'Year' },
                { field: 'price' as const, label: 'Price' },
                { field: 'stock' as const, label: 'Stock' },
                { field: 'status' as const, label: 'Status' },
              ].map((option) => (
                <button
                  key={option.field}
                  onClick={() => handleSort(option.field)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    sortField === option.field
                      ? 'bg-wine-100 text-wine-700'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {option.label}
                  {sortField === option.field && (
                    sortOrder === 'asc' ? <SortAsc className="w-3.5 h-3.5" /> : <SortDesc className="w-3.5 h-3.5" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Wine List View - With Year, Country, Vintage columns - Horizontally Scrollable */}
        {/* Bulk action bar (NEW-200/201/250) */}
        {bulkSelectedWines.size > 0 && (
          <div className="sticky top-2 z-20 flex items-center justify-between gap-3 mb-4 px-4 py-2.5 bg-gray-900 text-white rounded-xl shadow-lg">
            <span className="text-sm font-semibold">
              {bulkSelectedWines.size} selected
              {bulkSelectedWines.size < filteredWines.length && (
                <button onClick={toggleSelectAllFiltered} className="ml-3 text-xs font-medium text-amber-300 hover:text-amber-200">
                  Select all {filteredWines.length}
                </button>
              )}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={bulkToggleFavorite} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-white/10 hover:bg-white/20 rounded-lg">
                <Star className="w-3.5 h-3.5" /> Favorite
              </button>
              <ExportMenu
                variant="dark"
                size="sm"
                label="Export"
                count={selectedWineObjects.length}
                onExport={bulkExportSelected}
                title="Export selected wines"
              />
              <button onClick={bulkRemoveFromLibrary} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-wine-600/90 hover:bg-wine-600 rounded-lg">
                <Trash2 className="w-3.5 h-3.5" /> Remove
              </button>
              <button onClick={clearWineSelection} className="p-1.5 hover:bg-white/20 rounded-lg" aria-label="Clear selection">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {filteredWines.length === 0 ? (
          /* Empty filter state (NEW-244): name what emptied the set + one-click clear */
          <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
            <Wine className="w-10 h-10 mx-auto mb-3 text-gray-300" />
            <p className="text-gray-900 font-semibold mb-1">No wines match your filters</p>
            <p className="text-sm text-gray-500 mb-4">
              {[
                searchQuery ? `search “${searchQuery}”` : null,
                ...Object.entries(filters)
                  .filter(([, v]) => v !== 'All')
                  .map(([k, v]) => `${k}: ${v}`),
              ].filter(Boolean).join(' · ') || 'Your library is empty.'}
            </p>
            {(searchQuery || activeFiltersCount > 0) && (
              <button
                onClick={() => { setSearchQuery(''); clearAllFilters() }}
                className="px-4 py-2 text-sm font-semibold text-white bg-wine-600 hover:bg-wine-700 rounded-lg"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : viewMode === 'list' ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-white rounded-2xl border border-gray-100 overflow-hidden"
            data-wine-container="list"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px]">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="pl-4 py-4 text-left w-[40px]">
                      <input
                        type="checkbox"
                        checked={allPageSelected}
                        onChange={() =>
                          setBulkSelectedWines(prev =>
                            allPageSelected
                              ? new Set([...prev].filter(id => !pagedWines.some(w => w.id === id)))
                              : new Set([...prev, ...pagedWines.map(w => w.id)]),
                          )
                        }
                        className="w-4 h-4 rounded border-gray-300 text-wine-600 focus:ring-wine-500 cursor-pointer"
                        aria-label="Select all on this page"
                      />
                    </th>
                    <th className="px-4 py-4 text-left w-[300px]">
                      <button onClick={() => handleSort('name')} className="flex items-center gap-1 text-sm font-semibold text-gray-900">
                        Wine <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                    </th>
                    <th className="px-4 py-4 text-left w-[120px]">
                      <button onClick={() => handleSort('type')} className="flex items-center gap-1 text-sm font-semibold text-gray-900">
                        Type <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                    </th>
                    <th className="px-4 py-4 text-left w-[90px]">
                      <button onClick={() => handleSort('format')} className="flex items-center gap-1 text-sm font-semibold text-gray-900">
                        Format <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                    </th>
                    <th className="px-4 py-4 text-left w-[150px]">
                      <button onClick={() => handleSort('country')} className="flex items-center gap-1 text-sm font-semibold text-gray-900">
                        Country <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                    </th>
                    <th className="px-4 py-4 text-left w-[100px]">
                      <button onClick={() => handleSort('vintage')} className="flex items-center gap-1 text-sm font-semibold text-gray-900">
                        Year <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                    </th>
                    <th className="px-4 py-4 text-left w-[120px]">
                      <button onClick={() => handleSort('price')} className="flex items-center gap-1 text-sm font-semibold text-gray-900">
                        Price <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                    </th>
                    <th className="px-4 py-4 text-left w-[130px]">
                      <button onClick={() => handleSort('stock')} className="flex items-center gap-1 text-sm font-semibold text-gray-900">
                        Stock <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                    </th>
                    <th className="px-4 py-4 text-left w-[140px]">
                      <button onClick={() => handleSort('status')} className="flex items-center gap-1 text-sm font-semibold text-gray-900">
                        Status <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                    </th>
                    <th className="px-4 py-4 text-center w-[160px] text-sm font-semibold text-gray-900">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pagedWines.map((wine) => {
                    const typeColors = getWineTypeColor(wine.type)
                    const status = getStockStatus(wine)
                    const hasRecurring = savedPreferences[wine.id]?.saveAsRecurring
                    
                    return (
                      <tr
                        key={wine.id}
                        onClick={() => setSelectedWine(wine)}
                        onContextMenu={(e) => { e.preventDefault(); setWineMenu({ id: wine.id, x: e.clientX, y: e.clientY }) }}
                        className={`cursor-pointer transition-colors ${bulkSelectedWines.has(wine.id) ? 'bg-wine-50/60' : 'hover:bg-gray-50'}`}
                        data-wine-item="list-row"
                      >
                        <td className="pl-4 py-3 w-[40px]" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={bulkSelectedWines.has(wine.id)}
                              onChange={() => toggleWineSelection(wine.id)}
                              className="w-4 h-4 rounded border-gray-300 text-wine-600 focus:ring-wine-500 cursor-pointer"
                              aria-label={`Select ${wine.name}`}
                            />
                            {/* NEW-210: favorite star in list view (parity with grid) */}
                            <button
                              onClick={() => toggleFavorite(wine.id)}
                              title={favorites.has(wine.id) ? 'Unfavorite' : 'Add to Favorites'}
                              className="p-0.5 rounded hover:bg-gray-100"
                            >
                              <Star className={`w-3.5 h-3.5 ${favorites.has(wine.id) ? 'fill-amber-500 text-amber-500' : 'text-gray-300'}`} />
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3 w-[300px]">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-14 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
                              <img 
                                src={getWineImage(wine)} 
                                alt={wine.name} 
                                loading="lazy"
                                decoding="async"
                                className="w-full h-full object-contain"
                                onError={(e) => {
                                  e.currentTarget.src = 'https://via.placeholder.com/48x64?text=🍷'
                                }}
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-gray-900 truncate">{wine.name}</p>
                              <p className="text-xs text-gray-500 truncate">{wine.producer} · {wine.grape}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 w-[120px]">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${typeColors.bg} ${typeColors.text}`}>
                            {normalizeType(wine.type)}
                          </span>
                        </td>
                        <td className="px-4 py-3 w-[90px] whitespace-nowrap">
                          {(() => {
                            const formatted = formatVolume(wine.bottleSizeMl ?? 750, measurementUnit)
                            const match = formatted.match(/^(\d+(?:\.\d+)?)(ml|L)$/i)
                            if (match) {
                              return (
                                <>
                                  <span className="text-gray-900">{match[1]}</span>
                                  <span className="text-gray-400">{match[2]}</span>
                                </>
                              )
                            }
                            return <span className="text-gray-700">{formatted}</span>
                          })()}
                        </td>
                        <td className="px-4 py-3 w-[150px] text-sm text-gray-700 whitespace-nowrap">{wine.country}</td>
                        <td className="px-4 py-3 w-[100px] text-sm font-medium text-gray-900 whitespace-nowrap">{wine.vintage || 'NV'}</td>
                        <td className="px-4 py-3 w-[120px] font-medium text-gray-900 whitespace-nowrap">${wine.price}</td>
                        <td className="px-4 py-3 w-[130px]">
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            <span className="font-medium text-gray-900">{wine.liveStock || 0}</span>
                            <span className="text-xs text-gray-400">/ {wine.threshold}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 w-[140px]">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                            status.color === 'emerald' ? 'bg-success-100 text-success-700' :
                            status.color === 'yellow' ? 'bg-yellow-100 text-yellow-800' :
                            status.color === 'amber' ? 'bg-warning-100 text-warning-800' :
                            'bg-wine-100 text-wine-700'
                          }`}>
                            {status.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 w-[240px]">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => handleAddToInventory(wine, e)}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap bg-blue-50 text-blue-700 hover:bg-blue-100"
                              title="Add to Inventory"
                            >
                              <Package className="w-4 h-4 flex-shrink-0" />
                              <span>Add</span>
                            </button>
                            <button
                              onClick={(e) => openReorderModal(wine, e)}
                              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                                status.status === 'healthy'
                                  ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                  : 'bg-wine-600 text-white hover:bg-wine-700 shadow-lg shadow-wine-600/30' +
                                    (status.status === 'critical' || status.status === 'out' ? ' animate-pulse' : '')
                              }`}
                            >
                              <ShoppingCart className="w-4 h-4 flex-shrink-0" />
                              <span>Reorder</span>
                              {hasRecurring && <RotateCcw className="w-3 h-3 flex-shrink-0" />}
                            </button>
                            <button
                              onClick={(e) => handleRemoveFromLibrary(wine, e)}
                              className="p-2 text-danger-600 hover:bg-danger-50 rounded-lg transition-colors"
                              title="Remove from Library"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </motion.div>
        ) : (
          /* Grid View */
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
            data-wine-container="grid"
          >
            {pagedWines.map((wine, index) => {
              const typeColors = getWineTypeColor(wine.type)
              const status = getStockStatus(wine)
              
              return (
                <motion.div
                  key={wine.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.02 }}
                  onClick={() => setSelectedWine(wine)}
                  onContextMenu={(e) => { e.preventDefault(); setWineMenu({ id: wine.id, x: e.clientX, y: e.clientY }) }}
                  className={`group bg-white rounded-2xl border overflow-hidden hover:shadow-xl transition-all cursor-pointer relative ${
                    bulkSelectedWines.has(wine.id) ? 'border-wine-500 ring-2 ring-wine-200' : 'border-gray-100 hover:border-wine-200'
                  }`}
                  data-wine-item="grid-card"
                >
                  {/* Selection checkbox (NEW-200) — visible when selected or on hover */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className={`absolute top-3 left-3 z-10 transition-opacity ${bulkSelectedWines.has(wine.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}
                  >
                    <input
                      type="checkbox"
                      checked={bulkSelectedWines.has(wine.id)}
                      onChange={() => toggleWineSelection(wine.id)}
                      className="w-4 h-4 rounded border-gray-300 text-wine-600 focus:ring-wine-500 cursor-pointer shadow"
                      aria-label={`Select ${wine.name}`}
                    />
                  </div>
                  <div className="relative h-56 bg-gradient-to-b from-gray-50 to-gray-100 p-4">
                    <img
                      src={getWineImage(wine)}
                      alt={wine.name}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                      onError={(e) => {
                        e.currentTarget.src = 'https://via.placeholder.com/200x300?text=🍷'
                      }}
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleFavorite(wine.id)
                      }}
                      className="absolute top-3 right-3 p-2 bg-white/80 backdrop-blur rounded-full shadow-lg hover:bg-white transition-colors"
                      title="Add to Favorites"
                    >
                      <Star
                        className={`w-4 h-4 transition-colors ${
                          favorites.has(wine.id) ? 'fill-amber-500 text-amber-500' : 'text-gray-400'
                        }`}
                      />
                    </button>
                    {/* left-10 leaves room for the selection checkbox at left-3 */}
                    <div className="absolute top-3 left-10 flex items-center gap-2">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${typeColors.bg} ${typeColors.text}`}>
                        {normalizeType(wine.type)}
                      </span>
                      <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                        {formatVolume(wine.bottleSizeMl ?? 750, measurementUnit)}
                      </span>
                    </div>
                    
                    {/* Status Badge */}
                    {status.status !== 'healthy' && (
                      <span className={`absolute bottom-3 left-3 px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1 ${
                        status.color === 'wine' ? 'bg-wine-600 text-white' :
                        status.color === 'amber' ? 'bg-warning-500 text-white' :
                        'bg-yellow-400 text-yellow-900'
                      }`}>
                        <AlertTriangle className="w-3 h-3" />
                        {status.label}
                      </span>
                    )}
                  </div>

                  <div className="p-4">
                    <h3 className="font-semibold text-gray-900 group-hover:text-wine-600 transition-colors truncate">
                      {wine.name}
                    </h3>
                    <p className="text-sm text-gray-500 mt-0.5">{wine.vintage || 'NV'} · {wine.country}</p>

                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                      <div>
                        <p className="text-xl font-bold text-gray-900">${wine.price}</p>
                        <p className="text-xs text-gray-500">{wine.liveStock || 0} / {wine.threshold}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => handleAddToInventory(wine, e)}
                          className="p-2.5 rounded-xl transition-all bg-blue-50 text-blue-700 hover:bg-blue-100"
                          title="Add to Inventory"
                        >
                          <Package className="w-5 h-5" />
                        </button>
                        <button
                          onClick={(e) => openReorderModal(wine, e)}
                          className={`p-2.5 rounded-xl transition-all ${
                            status.status === 'healthy'
                              ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                              : 'bg-wine-600 text-white hover:bg-wine-700 shadow-lg shadow-wine-600/30' +
                                (status.status === 'critical' || status.status === 'out' ? ' animate-pulse' : '')
                          }`}
                        >
                          <ShoppingCart className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </motion.div>
        )}

        {/* Pagination */}
        <div className="flex items-center justify-between mt-8">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>

          <span className="text-sm text-gray-500">
            Page <span className="font-medium text-gray-900">{currentPage}</span> of{' '}
            <span className="font-medium text-gray-900">{totalPages}</span>
          </span>

          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>

        {/* Wine Detail Modal */}
        <AnimatePresence>
          {selectedWine && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setSelectedWine(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden"
              >
                <div className="grid md:grid-cols-2">
                  <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-8 flex items-center justify-center relative">
                    <button
                      onClick={() => setSelectedWine(null)}
                      className="absolute top-4 right-4 p-2 bg-white rounded-full shadow-lg hover:bg-gray-50 transition-colors md:hidden"
                    >
                      <X className="w-5 h-5 text-gray-600" />
                    </button>
                    <img
                      src={getWineImage(selectedWine)}
                      alt={selectedWine.name}
                      className="max-h-96 object-contain"
                      onError={(e) => {
                        e.currentTarget.src = 'https://via.placeholder.com/300x400?text=🍷'
                      }}
                    />
                  </div>

                  <div className="p-8 overflow-y-auto max-h-[90vh]">
                    <button
                      onClick={() => setSelectedWine(null)}
                      className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors hidden md:block"
                    >
                      <X className="w-5 h-5 text-gray-600" />
                    </button>

                    <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium mb-4 ${getTypeColorClass(selectedWine.type)}`}>
                      {normalizeType(selectedWine.type)}
                    </span>

                    <h2 className="text-3xl font-bold text-gray-900 mb-2">{selectedWine.name}</h2>
                    <p className="text-lg text-gray-500 mb-6">{selectedWine.vintage || 'Non-Vintage'} · {selectedWine.producer}</p>

                    <div className="grid grid-cols-2 gap-4 mb-6">
                      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                        <MapPin className="w-5 h-5 text-gray-400" />
                        <div>
                          <p className="text-xs text-gray-500">Country & Region</p>
                          <p className="text-sm font-medium text-gray-900">{selectedWine.country}, {selectedWine.region}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                        <Grape className="w-5 h-5 text-gray-400" />
                        <div>
                          <p className="text-xs text-gray-500">Grape</p>
                          <p className="text-sm font-medium text-gray-900">{selectedWine.grape}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                        <Calendar className="w-5 h-5 text-gray-400" />
                        <div>
                          <p className="text-xs text-gray-500">Vintage Year</p>
                          <p className="text-sm font-medium text-gray-900">{selectedWine.vintage || 'NV'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                        <Wine className="w-5 h-5 text-gray-400" />
                        <div>
                          <p className="text-xs text-gray-500">Stock / Threshold</p>
                          <p className={`text-sm font-medium ${
                            (selectedWine.liveStock || 0) <= selectedWine.threshold
                              ? 'text-wine-600'
                              : 'text-success-600'
                          }`}>
                            {selectedWine.liveStock ?? 'N/A'} / {selectedWine.threshold}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mb-6 p-4 bg-gray-50 rounded-xl">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-semibold text-gray-700">{providerLabel}</h4>
                        {wineProviders.length > 1 && (
                          <button
                            onClick={() => setProviderDropdownOpen(prev => !prev)}
                            className="text-xs font-medium text-wine-600 hover:text-wine-700 flex items-center gap-1"
                          >
                            {providerDropdownOpen ? 'Hide' : 'Show all'}
                            <ChevronDown className={`w-3 h-3 transition-transform ${providerDropdownOpen ? 'rotate-180' : ''}`} />
                          </button>
                        )}
                      </div>

                      {wineProviders.length === 0 && (
                        <p className="text-sm text-gray-500">No providers available.</p>
                      )}

                      {wineProviders.length > 0 && (
                        <div className="space-y-3">
                          <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-full bg-wine-100 flex items-center justify-center text-wine-600 font-semibold">
                              {wineProviders[0].name.charAt(0)}
                            </div>
                            <div className="flex-1">
                              <p className="font-medium text-gray-900">{wineProviders[0].name}</p>
                              <p className="text-xs text-gray-500">{wineProviders[0].primaryBusinessType}</p>
                              <p className="text-xs text-gray-500">{wineProviders[0].phone || 'No phone listed'}</p>
                              <p className="text-xs text-gray-500">{wineProviders[0].email || 'No email listed'}</p>
                            </div>
                          </div>

                          {providerDropdownOpen && wineProviders.length > 1 && (
                            <div className="pt-2 border-t border-gray-200 space-y-2">
                              {wineProviders.slice(1).map((provider) => (
                                <div key={provider.id} className="flex items-start gap-3 p-2 bg-white rounded-lg border border-gray-100">
                                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 text-xs font-semibold">
                                    {provider.name.charAt(0)}
                                  </div>
                                  <div className="flex-1">
                                    <p className="text-sm font-medium text-gray-900">{provider.name}</p>
                                    <p className="text-xs text-gray-500">{provider.primaryBusinessType}</p>
                                    <p className="text-xs text-gray-500">{provider.phone || 'No phone listed'}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="pt-6 border-t border-gray-100 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-500">Price per bottle</p>
                          <p className="text-3xl font-bold text-gray-900">${selectedWine.price}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => {
                              const wine = selectedWine
                              setSelectedWine(null)
                              setSelectedWineForInventory(wine)
                              setShowAddToInventoryModal(true)
                            }}
                            className="px-4 py-3 border border-wine-200 text-wine-700 font-medium rounded-xl hover:bg-wine-50 transition-all flex items-center gap-2"
                          >
                            <Package className="w-5 h-5" />
                            Add to Inventory
                          </button>
                          <button
                            onClick={() => {
                              setSelectedWine(null)
                              openReorderModal(selectedWine)
                            }}
                            className="px-6 py-3 bg-wine-600 text-white font-medium rounded-xl hover:bg-wine-700 shadow-lg shadow-wine-600/30 transition-all flex items-center gap-2"
                          >
                            <ShoppingCart className="w-5 h-5" />
                            Reorder Now
                          </button>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          const wine = selectedWine
                          setSelectedWine(null)
                          handleRemoveFromLibrary(wine)
                        }}
                        className="w-full px-4 py-2 text-wine-600 hover:bg-wine-50 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm font-medium"
                      >
                        <Trash2 className="w-4 h-4" />
                        Remove from Library
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Reorder Modal */}
        <AnimatePresence>
          {reorderModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setReorderModal(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden"
              >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-wine-50 to-wine-100">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-wine-600 rounded-xl">
                      <ShoppingCart className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">Reorder Wine</h3>
                      <p className="text-sm text-gray-500">{reorderModal.wine.name}</p>
                    </div>
                  </div>
                  <button onClick={() => setReorderModal(null)} className="p-2 hover:bg-white/50 rounded-lg">
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>

                <div className="p-6 space-y-6">
                  {/* Wine Summary */}
                  <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                    <img
                      src={getWineImage(reorderModal.wine)}
                      alt={reorderModal.wine.name}
                      className="w-16 h-20 object-contain"
                    />
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{reorderModal.wine.name}</p>
                      <p className="text-sm text-gray-500">{reorderModal.wine.vintage} · {reorderModal.wine.country}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-sm font-medium ${
                          (reorderModal.wine.liveStock || 0) <= reorderModal.wine.threshold
                            ? 'text-wine-600'
                            : 'text-success-600'
                        }`}>
                          {reorderModal.wine.liveStock} in stock
                        </span>
                        <span className="text-gray-400">·</span>
                        <span className="text-sm text-gray-500">Min: {reorderModal.wine.threshold}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-gray-900">${reorderModal.wine.price}</p>
                      <p className="text-xs text-gray-500">per bottle</p>
                    </div>
                  </div>

                  {/* Quantity */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Quantity</label>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden">
                        <button
                          onClick={() => setReorderModal(prev => prev ? { ...prev, quantity: Math.max(1, prev.quantity - 6) } : null)}
                          className="p-3 hover:bg-gray-100 transition-colors"
                        >
                          <Minus className="w-4 h-4 text-gray-500" />
                        </button>
                        <input
                          type="number"
                          value={reorderModal.quantity}
                          onChange={(e) => setReorderModal(prev => prev ? { ...prev, quantity: Math.max(1, parseInt(e.target.value) || 1) } : null)}
                          className="w-20 text-center text-lg font-medium border-x border-gray-200 py-2 focus:outline-none"
                        />
                        <button
                          onClick={() => setReorderModal(prev => prev ? { ...prev, quantity: prev.quantity + 6 } : null)}
                          className="p-3 hover:bg-gray-100 transition-colors"
                        >
                          <Plus className="w-4 h-4 text-gray-500" />
                        </button>
                      </div>
                      <div className="flex gap-2">
                        {[6, 12, 24].map((qty) => (
                          <button
                            key={qty}
                            onClick={() => setReorderModal(prev => prev ? { ...prev, quantity: qty } : null)}
                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                              reorderModal.quantity === qty
                                ? 'bg-wine-100 text-wine-700'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            {qty}
                          </button>
                        ))}
                      </div>
                    </div>
                    <p className="text-sm text-gray-500 mt-2">
                      Total: <span className="font-semibold text-gray-900">${(reorderModal.quantity * reorderModal.wine.price).toLocaleString()}</span>
                    </p>
                  </div>

                  {/* Price Mode */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Price Selection</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => setReorderModal(prev => prev ? { ...prev, priceMode: 'custom' } : null)}
                        className={`p-3 rounded-xl border-2 transition-all text-left ${
                          reorderModal.priceMode === 'custom'
                            ? 'border-wine-500 bg-wine-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <p className="font-medium text-sm text-gray-900">Custom Price</p>
                        <p className="text-xs text-gray-500 mt-1">Set specific price</p>
                      </button>
                      <button
                        onClick={() => setReorderModal(prev => prev ? { ...prev, priceMode: 'ask' } : null)}
                        className={`p-3 rounded-xl border-2 transition-all text-left ${
                          reorderModal.priceMode === 'ask'
                            ? 'border-wine-500 bg-wine-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <p className="font-medium text-sm text-gray-900">Ask Provider</p>
                        <p className="text-xs text-gray-500 mt-1">AI negotiates</p>
                      </button>
                    </div>
                    {reorderModal.priceMode === 'custom' && (
                      <div className="mt-3">
                        <input
                          type="number"
                          step="0.01"
                          value={reorderModal.customPrice || reorderModal.wine.price}
                          onChange={(e) => setReorderModal(prev => prev ? { ...prev, customPrice: parseFloat(e.target.value) || 0 } : null)}
                          placeholder="Enter price per bottle"
                          className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                        />
                      </div>
                    )}
                  </div>

                  {/* Provider Selection */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-gray-700">Select Providers to Contact</label>
                      <button
                        onClick={() => {
                          if (reorderModal.selectedProviders.length === providers.length) {
                            setReorderModal(prev => prev ? { ...prev, selectedProviders: [] } : null)
                          } else {
                            setReorderModal(prev => prev ? { ...prev, selectedProviders: providers.map(p => p.id) } : null)
                          }
                        }}
                        className="text-xs text-wine-600 hover:text-wine-700 font-medium"
                      >
                        {reorderModal.selectedProviders.length === providers.length ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>
                    <div className="relative mb-2">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={providerSearch}
                        onChange={(e) => setProviderSearch(e.target.value)}
                        placeholder="Search providers..."
                        className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                      />
                    </div>
                    <div className="border border-gray-200 rounded-xl max-h-48 overflow-y-auto">
                      {providers
                        .filter(p => 
                          providerSearch === '' ||
                          p.name.toLowerCase().includes(providerSearch.toLowerCase()) ||
                          p.winePortfolio.toLowerCase().includes(providerSearch.toLowerCase())
                        )
                        .map((provider) => (
                          <label
                            key={provider.id}
                            className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                          >
                            <input
                              type="checkbox"
                              checked={reorderModal.selectedProviders.includes(provider.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setReorderModal(prev => prev ? {
                                    ...prev,
                                    selectedProviders: [...prev.selectedProviders, provider.id]
                                  } : null)
                                } else {
                                  setReorderModal(prev => prev ? {
                                    ...prev,
                                    selectedProviders: prev.selectedProviders.filter(id => id !== provider.id)
                                  } : null)
                                }
                              }}
                              className="rounded border-gray-300 text-wine-600 focus:ring-wine-500"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{provider.name}</p>
                              <p className="text-xs text-gray-500 truncate">{provider.primaryBusinessType}</p>
                            </div>
                            {provider.id === getRecommendedProviders(providers).primary?.id && (
                              <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                                Recommended
                              </span>
                            )}
                          </label>
                        ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      {reorderModal.selectedProviders.length} provider(s) selected
                    </p>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Notes (optional)</label>
                    <textarea
                      value={reorderModal.notes}
                      onChange={(e) => setReorderModal(prev => prev ? { ...prev, notes: e.target.value } : null)}
                      placeholder="Any special instructions for this order..."
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent resize-none"
                      rows={2}
                    />
                  </div>

                  {/* Save for Recurring */}
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        id="saveRecurring"
                        checked={reorderModal.saveAsRecurring}
                        onChange={(e) => setReorderModal(prev => prev ? { ...prev, saveAsRecurring: e.target.checked } : null)}
                        className="mt-1 rounded border-gray-300 text-wine-600 focus:ring-wine-500"
                      />
                      <div className="flex-1">
                        <label htmlFor="saveRecurring" className="font-medium text-gray-900 cursor-pointer flex items-center gap-2">
                          <Save className="w-4 h-4 text-amber-600" />
                          Save preferences for recurring orders
                        </label>
                        <p className="text-xs text-gray-500 mt-1">
                          Next time you reorder this wine, these settings will be pre-filled
                        </p>
                        
                        {reorderModal.saveAsRecurring && (
                          <div className="mt-3">
                            <label className="block text-xs font-medium text-gray-600 mb-1.5">Auto-reorder frequency</label>
                            <select
                              value={reorderModal.recurringFrequency}
                              onChange={(e) => setReorderModal(prev => prev ? { ...prev, recurringFrequency: e.target.value as any } : null)}
                              className="w-full px-3 py-2 text-sm border border-amber-200 rounded-lg bg-white focus:ring-2 focus:ring-wine-500"
                            >
                              <option value="weekly">Weekly</option>
                              <option value="biweekly">Bi-weekly</option>
                              <option value="monthly">Monthly</option>
                              <option value="quarterly">Quarterly</option>
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Order Total</p>
                    <p className="text-2xl font-bold text-gray-900">${(reorderModal.quantity * reorderModal.wine.price).toLocaleString()}</p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setReorderModal(null)}
                      className="px-5 py-3 border border-gray-200 rounded-xl text-gray-700 font-medium hover:bg-gray-100 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handlePlaceOrder}
                      className="px-6 py-3 bg-wine-600 text-white font-medium rounded-xl hover:bg-wine-700 shadow-lg shadow-wine-600/30 transition-all flex items-center gap-2"
                    >
                      <Phone className="w-5 h-5" />
                      Contact Provider
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Add Wine Selection Modal */}
        <AddWineSelectionModal
          isOpen={showAddSelectionModal}
          onClose={() => setShowAddSelectionModal(false)}
          onSelectSingle={() => setShowAddModal(true)}
          onSelectMenu={() => setShowNewScannerFlow(true)}
        />

        {/* Single Wine Scanner */}
        <AddWineModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          onSave={(wine) => {
            // Check for duplicates
            const isDuplicate = filteredWines.some(existing => 
              existing.name.toLowerCase() === wine.name?.toLowerCase() &&
              existing.vintage === wine.vintage
            )
            
            if (isDuplicate) {
              const confirmAdd = window.confirm(
                `⚠️ A wine named "${wine.name}" (${wine.vintage || 'NV'}) already exists in your library.\n\nDo you want to add it anyway?`
              )
              if (!confirmAdd) return
            }
            
            handleAddWine(wine)
          }}
        />

        {/* Menu Scanner */}
        <MenuScannerModal
          isOpen={showMenuScanner}
          onClose={() => setShowMenuScanner(false)}
          onWinesDetected={(detectedWines) => {
            console.log('Detected wines from menu:', detectedWines)
            
            // Filter out duplicates
            const newWines = detectedWines.filter(detected => {
              const isDuplicate = filteredWines.some(existing =>
                existing.name.toLowerCase() === detected.name.toLowerCase() &&
                existing.vintage === detected.vintage
              )
              return !isDuplicate
            })
            
            const duplicateCount = detectedWines.length - newWines.length
            if (duplicateCount > 0) {
              alert(`ℹ️ ${duplicateCount} wine(s) are already in your library and were skipped.`)
            }
            
            if (newWines.length > 0) {
              alert(`✅ Successfully detected ${newWines.length} new wine(s) from your menu!`)
              // TODO: Implement batch add to wine library
            }
          }}
        />

        {/* New Menu Scanner Flow (Camera + YOLO + Full Pipeline) */}
        <MenuScannerFlow
          isOpen={showNewScannerFlow}
          onClose={() => setShowNewScannerFlow(false)}
          onWinesAdded={(wines) => {
            console.log(`${wines.length} wines added from scanner flow`)
            setShowNewScannerFlow(false)
          }}
        />

        {/* Add Wine to Inventory Modal */}
        {selectedWineForInventory && showAddToInventoryModal && (
          <AddToInventoryFromLibraryModal
            wine={selectedWineForInventory}
            onClose={() => {
              setShowAddToInventoryModal(false)
              setSelectedWineForInventory(null)
            }}
            onSuccess={handleInventorySuccess}
          />
        )}
      </div>

      {/* Right-click wine context menu (NEW-203) */}
      {wineMenu && (() => {
        const wine = filteredWines.find(w => w.id === wineMenu.id)
        if (!wine) return null
        const MItem = ({ icon: Icon, label, danger, onClick }: { icon: any; label: string; danger?: boolean; onClick: () => void }) => (
          <button
            onClick={onClick}
            className={`flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm rounded-lg hover:bg-gray-50 ${danger ? 'text-red-600' : 'text-gray-700'}`}
          >
            <Icon className={`w-4 h-4 ${danger ? 'text-red-500' : 'text-gray-400'}`} /> {label}
          </button>
        )
        return (
          <div
            className="fixed z-[60] w-56 bg-white border border-gray-200 rounded-xl shadow-xl p-1"
            style={{ top: Math.min(wineMenu.y, window.innerHeight - 260), left: Math.min(wineMenu.x, window.innerWidth - 240) }}
            onClick={(e) => e.stopPropagation()}
          >
            <MItem icon={Wine} label="Open details" onClick={() => { setSelectedWine(wine); setWineMenu(null) }} />
            <MItem icon={Package} label="Add to inventory" onClick={() => { handleAddToInventory(wine); setWineMenu(null) }} />
            <MItem icon={ShoppingCart} label="Reorder" onClick={() => { openReorderModal(wine); setWineMenu(null) }} />
            <MItem
              icon={Star}
              label={favorites.has(wine.id) ? 'Unfavorite' : 'Add to favorites'}
              onClick={() => { toggleFavorite(wine.id); setWineMenu(null) }}
            />
            <MItem icon={CheckSquare} label={bulkSelectedWines.has(wine.id) ? 'Deselect' : 'Select'} onClick={() => { toggleWineSelection(wine.id); setWineMenu(null) }} />
            <MItem icon={Copy} label="Copy name" onClick={() => { navigator.clipboard?.writeText(wine.name); setWineMenu(null) }} />
            <MItem icon={Trash2} label="Remove from library" danger onClick={() => { setWineMenu(null); handleRemoveFromLibrary(wine) }} />
          </div>
        )
      })()}

      {/* 🔧 DEV: Wine Photo Testing Modal */}
      {showDevPhotoUpload && (
        <DevWinePhotoUpload onClose={() => setShowDevPhotoUpload(false)} />
      )}

      {/* 🔧 DEV: Manual Wine Entry Modal */}
      {showDevManualEntry && (
        <DevManualWineEntry 
          onClose={() => setShowDevManualEntry(false)}
          onWineAdded={(wine) => {
            console.log('✅ New wine added:', wine)
            // In a real app, this would refresh the wine library
            setShowDevManualEntry(false)
          }}
        />
      )}
    </div>
  )
}
export default WineLibrary