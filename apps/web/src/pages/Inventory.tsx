import { useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Header } from '../components/layout/Header'
import {
  Search,
  Filter,
  Download,
  Plus,
  Edit,
  ShoppingCart,
  AlertTriangle,
  CheckCircle,
  Eye,
  EyeOff,
  RefreshCw,
  ArrowUpDown,
  X,
  Trash2,
  QrCode,
  MapPin,
  TrendingUp,
  Activity,
  ChevronDown,
  ChevronUp,
  BarChart3,
  FolderTree,
  RotateCcw,
} from 'lucide-react'
import { getWineTypeColor, Wine } from '../data/wineData'
import { AddWineToInventoryModal } from '../components/inventory/AddWineToInventoryModal'
import { ManualOverrideModal, ManualOverrideData } from '../components/inventory/ManualOverrideModal'
import { StorageLocationManager } from '../components/inventory/StorageLocationManager'
import { LocationPickerCell } from '../components/inventory/LocationPickerCell'
import { useStorageLocations } from '../hooks/useStorageLocations'
import { exportInventory, ExportFormat } from '../lib/exportHelpers'
import { formatVolume } from '../utils/volumeUtils'
import { useRestaurantSettingsStore } from '../stores/restaurantSettingsStore'
import { useTypedInventorySubscription, InventoryUpdatePayload, useRealtimeDispatch } from '../contexts/RealtimeContext'
import { useInventoryPage, InventoryItem } from './inventory/index'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { computeAutoLocatePlan, AutoLocateResult, WineLocationScore } from '../lib/autoLocateEngine'
import { AutoLocatePreviewModal } from '../components/inventory/AutoLocatePreviewModal'


function calculateMargin(costPrice: number, menuPrice?: number): number {
  if (!menuPrice || menuPrice === 0) return 0
  return ((menuPrice - costPrice) / menuPrice) * 100
}

function getDefaultMenuPrice(costPrice: number): number {
  return Math.round(costPrice * 3)
}

export function Inventory() {
  const measurementUnit = useRestaurantSettingsStore((s) => s.measurementUnit)
  const { dispatchInventoryUpdate, dispatchWineUpdate } = useRealtimeDispatch()
  const { activeRestaurantId } = useAuth()
  const queryClient = useQueryClient()
  const { locations: storageLocations, setLocations: setStorageLocations, getWineLocation, getLocationsWithActualCounts, assignWineToLocation, removeWineFromLocation, mappings } = useStorageLocations()
  
  // Page hook: filter, sort, selection, computed data — single source of truth
  const {
    searchQuery, setSearchQuery,
    filterType, setFilterType,
    filterStatus, setFilterStatus,
    filterActiveStatus, setFilterActiveStatus,
    filterBottleSize, setFilterBottleSize,
    viewMode, setViewMode,
    selectedLocationFilter, setSelectedLocationFilter,
    clearFilters,
    sortField: _sortField, sortOrder: _sortOrder, toggleSort,
    selectedItems, toggleSelection, setSelectedItems,
    inventory,
    isLoading: _inventoryLoading,
    error: _inventoryError,
    updateInventoryItem,
    filteredInventory,
    stats,
    uniqueBottleSizes,
  } = useInventoryPage()

  // Local overlay for optimistic updates. Keyed by item ID.
  const [localOverrides, setLocalOverrides] = useState<Record<string, Partial<InventoryItem>>>({})

  // Merge hook inventory with local optimistic overrides
  const mergedInventory = useMemo(() => {
    if (Object.keys(localOverrides).length === 0) return inventory
    return inventory.map(item => {
      const override = localOverrides[item.id]
      return override ? { ...item, ...override } : item
    })
  }, [inventory, localOverrides])

  // Apply location chip filter on top of text/type/status filters
  const displayedInventory = useMemo(
    () => selectedLocationFilter
      ? filteredInventory.filter(item => getWineLocation(item.id)?.id === selectedLocationFilter)
      : filteredInventory,
    [filteredInventory, selectedLocationFilter, getWineLocation]
  )

  // Compatibility wrapper — translates old setInventory calls to localOverrides
  const setInventory = useCallback(
    (updater: InventoryItem[] | ((prev: InventoryItem[]) => InventoryItem[])) => {
      setLocalOverrides(prevOverrides => {
        const base = inventory.map(item => {
          const override = prevOverrides[item.id]
          return override ? { ...item, ...override } : item
        })
        const next = typeof updater === 'function' ? updater(base) : updater
        const newOverrides: Record<string, Partial<InventoryItem>> = {}
        for (const item of next) {
          const original = inventory.find(i => i.id === item.id)
          if (!original || JSON.stringify(original) !== JSON.stringify(item)) {
            newOverrides[item.id] = item
          }
        }
        return newOverrides
      })
    },
    [inventory],
  )

  // Modal & UI state (kept local)
  const [showFilters, setShowFilters] = useState(false)
  const [reconcileModal, setReconcileModal] = useState<InventoryItem | null>(null)
  const [actualCount, setActualCount] = useState('')
  const [showAddWineModal, setShowAddWineModal] = useState(false)
  const [_showInvoiceScannerModal, _setShowInvoiceScannerModal] = useState(false)
  const [manualOverrideModal, setManualOverrideModal] = useState<InventoryItem | null>(null)
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv')
  const [includeMetrics, setIncludeMetrics] = useState(false)
  const [showInventoryInsights, setShowInventoryInsights] = useState(true)
  const [showStorageManager, setShowStorageManager] = useState(false)
  const [_realtimeUpdates, setRealtimeUpdates] = useState<InventoryUpdatePayload[]>([])
  const [_showRealtimeToast, setShowRealtimeToast] = useState(false)
  const [showResetStockModal, setShowResetStockModal] = useState(false)
  const [resetStockConfirmText, setResetStockConfirmText] = useState('')
  const [showAutoLocateModal, setShowAutoLocateModal] = useState(false)
  const [autoLocateResult, setAutoLocateResult] = useState<AutoLocateResult | null>(null)
  const [includeAssigned, setIncludeAssigned] = useState(false)

  const winesById = useMemo(() => {
    const map = new Map<string, Wine>()
    mergedInventory.forEach(item => map.set(item.id, item))
    return map
  }, [mergedInventory])

  // Handle realtime inventory updates from other pages (Wine Library, Orders)
  const handleInventoryUpdate = useCallback((payload: InventoryUpdatePayload) => {
    console.log('Inventory received realtime update:', payload)    
    setInventory(prev => {
      let existingIndex = prev.findIndex(item => item.id === payload.wineId)
      if (existingIndex === -1 && payload.metadata?.inventoryId) {
        existingIndex = prev.findIndex(item => item.inventoryId === payload.metadata?.inventoryId)
      }
      
      if (payload.type === 'add') {
        // New wine added from Wine Library
        const wineFromLibrary = winesById.get(payload.wineId)
        if (wineFromLibrary && existingIndex === -1) {
          const isShadow = payload.metadata?.stockType === 'shadow'
          const nextQuantity = payload.quantity ?? 0
          const newItem: InventoryItem = {
            ...wineFromLibrary,
            liveStock: isShadow ? 0 : (payload.quantity ?? wineFromLibrary.threshold ?? 0),
            shadowStock: isShadow ? nextQuantity : 0,
            lastCounted: new Date().toISOString(),
            isActive: true,
            inventoryId: payload.metadata?.inventoryId,
          }
          return [...prev, newItem]
        } else if (existingIndex !== -1) {
          // Wine exists, update stock
          const updated = [...prev]
          const isShadow = payload.metadata?.stockType === 'shadow'
          updated[existingIndex] = {
            ...updated[existingIndex],
            liveStock: isShadow
              ? updated[existingIndex].liveStock || 0
              : (updated[existingIndex].liveStock || 0) + (payload.quantity ?? 0),
            shadowStock: isShadow
              ? (updated[existingIndex].shadowStock || 0) + (payload.quantity ?? 0)
              : updated[existingIndex].shadowStock || 0,
            lastCounted: new Date().toISOString(),
          }
          return updated
        }
      } else if (payload.type === 'stock_change' && existingIndex === -1) {
        const wineFromLibrary = winesById.get(payload.wineId)
        if (wineFromLibrary) {
          const transferToLive =
            payload.metadata?.action === 'shadow_to_live' ||
            (payload.metadata?.transferFrom === 'shadow' && payload.metadata?.transferTo === 'live')
          const isShadow = payload.metadata?.stockType === 'shadow'
          const qty = payload.quantity ?? 0
          const newItem: InventoryItem = {
            ...wineFromLibrary,
            liveStock: transferToLive ? qty : (isShadow ? 0 : qty),
            shadowStock: isShadow ? qty : 0,
            lastCounted: new Date().toISOString(),
            isActive: true,
            inventoryId: payload.metadata?.inventoryId,
          }
          return [...prev, newItem]
        }
      } else if (payload.type === 'stock_change' && existingIndex !== -1) {
        // Stock change from order delivery
        const updated = [...prev]
        const transferToLive =
          payload.metadata?.action === 'shadow_to_live' ||
          (payload.metadata?.transferFrom === 'shadow' && payload.metadata?.transferTo === 'live')
        const isShadow = payload.metadata?.stockType === 'shadow'
        if (transferToLive) {
          const qty = payload.quantity ?? 0
          const currentShadow = updated[existingIndex].shadowStock || 0
          updated[existingIndex] = {
            ...updated[existingIndex],
            liveStock: (updated[existingIndex].liveStock || 0) + qty,
            shadowStock: Math.max(0, currentShadow - qty),
            lastCounted: new Date().toISOString(),
          }
        } else {
          updated[existingIndex] = {
            ...updated[existingIndex],
            liveStock: isShadow
              ? updated[existingIndex].liveStock || 0
              : (updated[existingIndex].liveStock || 0) + (payload.quantity ?? 0),
            shadowStock: isShadow
              ? (updated[existingIndex].shadowStock || 0) + (payload.quantity ?? 0)
              : updated[existingIndex].shadowStock || 0,
            lastCounted: new Date().toISOString(),
          }
        }
        return updated
      } else if (payload.type === 'update' && existingIndex !== -1) {
        // General update
        const updated = [...prev]
        if (payload.quantity !== undefined) {
          updated[existingIndex] = {
            ...updated[existingIndex],
            liveStock: payload.quantity,
            lastCounted: new Date().toISOString(),
          }
        }
        return updated
      } else if (payload.type === 'remove' && existingIndex !== -1) {
        return prev.filter(item => item.id !== payload.wineId)
      }
      
      return prev
    })

    // Show toast notification
    setRealtimeUpdates(prev => [...prev.slice(-4), payload])
    setShowRealtimeToast(true)
    setTimeout(() => setShowRealtimeToast(false), 3000)
  }, [winesById])

  // Subscribe to realtime inventory updates
  useTypedInventorySubscription(handleInventoryUpdate)

  const getStockStatus = (item: InventoryItem) => {
    const stock = item.liveStock || 0
    const ratio = stock / item.threshold
    if (ratio <= 0.5) return { label: 'Critical', color: 'rose', bg: 'bg-rose-100', text: 'text-rose-700' }
    if (ratio <= 1) return { label: 'Low', color: 'amber', bg: 'bg-amber-100', text: 'text-amber-700' }
    return { label: 'Healthy', color: 'emerald', bg: 'bg-emerald-100', text: 'text-emerald-700' }
  }

  const handleReconcile = async () => {
    if (!reconcileModal || !actualCount) return

    const actual = parseInt(actualCount, 10)
    if (Number.isNaN(actual)) return

    const patchId = reconcileModal.inventoryId || reconcileModal.id

    try {
      await updateInventoryItem(patchId, {
        stockLive: actual,
        shadowStock: 0,
      })
    } catch (err) {
      console.error('Failed to persist reconcile to DB:', err)
    }

    setInventory(prev => prev.map(item =>
      item.id === reconcileModal.id
        ? {
            ...item,
            liveStock: actual,
            shadowStock: 0,
            lastManualAdjustment: {
              timestamp: new Date(),
              managerName: 'Inventory Reconcile',
            },
          }
        : item
    ))

    setReconcileModal(null)
    setActualCount('')
  }

  const handleManualOverride = async (overrideData: ManualOverrideData) => {
    // Resolve the inventory row ID (not the wine ID) for the PATCH API
    const inventoryItem = mergedInventory.find(i => i.id === overrideData.wineId)
    const patchId = inventoryItem?.inventoryId || overrideData.wineId

    // 1. Persist to database via PATCH API (triggers threshold checks on backend)
    try {
      await updateInventoryItem(patchId, {
        stockLive: overrideData.newLiveStock,
        shadowStock: overrideData.newShadowStock,
      })
    } catch (err) {
      console.error('Failed to persist manual override to DB:', err)
    }

    // 2. Update local state immediately for responsiveness
    setInventory(prevInventory => 
      prevInventory.map(item => 
        item.id === overrideData.wineId
          ? {
              ...item,
              liveStock: overrideData.newLiveStock,
              shadowStock: overrideData.newShadowStock,
              lastManualAdjustment: {
                timestamp: overrideData.timestamp,
                managerName: overrideData.managerName,
              }
            }
          : item
      )
    )

    // 3. Dispatch realtime event for cross-page sync
    dispatchInventoryUpdate({
      type: 'update',
      wineId: overrideData.wineId,
      wineName: overrideData.wineName,
      quantity: overrideData.newLiveStock,
      previousQuantity: overrideData.oldLiveStock,
      source: 'manual',
      timestamp: overrideData.timestamp.toISOString(),
      metadata: {
        oldShadowStock: overrideData.oldShadowStock,
        newShadowStock: overrideData.newShadowStock,
        reason: overrideData.reason,
        reasonCategory: overrideData.reasonCategory,
        notes: overrideData.notes,
        managerId: overrideData.managerId,
        managerName: overrideData.managerName
      }
    })

    // 4. Show inline toast instead of alert()
    setRealtimeUpdates(prev => [...prev.slice(-4), {
      type: 'update' as const,
      wineId: overrideData.wineId,
      wineName: overrideData.wineName,
      quantity: overrideData.newLiveStock,
      previousQuantity: overrideData.oldLiveStock,
      source: 'manual' as const,
      timestamp: overrideData.timestamp.toISOString(),
      metadata: { reason: overrideData.reason, managerName: overrideData.managerName },
    }])
    setShowRealtimeToast(true)
    setTimeout(() => setShowRealtimeToast(false), 4000)

    setManualOverrideModal(null)
  }

  // Toggle active status for an inventory item
  const toggleItemActiveStatus = async (itemId: string) => {
    const item = mergedInventory.find(i => i.id === itemId)
    if (!item) return

    const newActiveStatus = !item.isActive
    const patchId = item.inventoryId || itemId

    try {
      await updateInventoryItem(patchId, { isActive: newActiveStatus })
    } catch (err) {
      console.error('Failed to persist active status toggle to DB:', err)
    }

    setInventory(prev => prev.map(i => 
      i.id === itemId ? { ...i, isActive: newActiveStatus } : i
    ))

    // Dispatch inventory update for cross-page sync
    dispatchInventoryUpdate({
      type: 'update',
      wineId: itemId,
      wineName: item.name,
      quantity: item.liveStock || 0,
      source: 'manual',
      timestamp: new Date().toISOString(),
      metadata: {
        action: 'toggle_active_status',
        newStatus: newActiveStatus,
      }
    })

    // Also dispatch wine update for Wine Library sync
    dispatchWineUpdate({
      type: 'updated',
      wineId: itemId,
      wineName: item.name,
      data: {
        isActive: newActiveStatus,
        liveStock: item.liveStock || 0,
        shadowStock: item.shadowStock || 0,
      },
      source: 'inventory',
      timestamp: new Date().toISOString(),
    })
  }

  // Reset all stock to zero
  const handleResetAllStock = () => {
    // Update all inventory items to have zero stock
    setInventory(prev => prev.map(item => ({
      ...item,
      liveStock: 0,
      shadowStock: 0,
      lastManualAdjustment: {
        timestamp: new Date(),
        managerName: 'System Reset',
      }
    })))

    // Dispatch reset event for cross-page sync
    dispatchInventoryUpdate({
      type: 'update',
      wineId: 'ALL',
      wineName: 'All Inventory Items',
      quantity: 0,
      previousQuantity: mergedInventory.reduce((sum, item) => sum + (item.liveStock || 0) + (item.shadowStock || 0), 0),
      source: 'system',
      timestamp: new Date().toISOString(),
      metadata: {
        action: 'reset_all_stock',
        itemCount: mergedInventory.length,
      }
    })

    setShowResetStockModal(false)
    setResetStockConfirmText('')
    
    // Show success message
    alert(`✅ All Stock Reset Successfully!

${mergedInventory.length} items have been reset to 0 stock.

This action has been logged to the audit trail.`)
  }

  const handleRemoveFromInventory = (item: InventoryItem) => {
    const confirmMessage = `Are you sure you want to remove "${item.name}" from your inventory?

This action will:
• Remove the wine from physical inventory tracking
• Keep the wine in your Wine Library (can be re-added to inventory anytime)
• Archive all stock records and transaction history

Current stock: ${item.liveStock || 0} live + ${(item.shadowStock || 0)} shadow = ${(item.liveStock || 0) + (item.shadowStock || 0)} total bottles

This cannot be undone.`

    if (confirm(confirmMessage)) {
      // Remove from inventory
      setInventory(prevInventory => prevInventory.filter(inv => inv.id !== item.id))
      
      // TODO: Integrate with backend API to soft delete
      console.log('Removing from inventory:', item.name, item.id)
      
      alert(`✅ "${item.name}" has been removed from inventory.

The wine is still in your Wine Library. You can re-add it to inventory anytime from the Wine Library page.`)
    }
  }

  const handleExport = async () => {
    // Prepare data for export
    const exportData = [
      ['Wine Name', 'Producer', 'Type', 'Bottle Size', 'Sale Type', 'Pour Size', 'Live Stock', 'Shadow Stock', 'Total', 'Threshold', 'Status', 'Purchased Price', 'Menu Price', 'Margin %', 'Cost Value', 'Menu Value'],
      ...displayedInventory.map(item => {
        const totalStock = (item.liveStock || 0) + (item.shadowStock || 0)
        const menuPrice = item.menuPrice || getDefaultMenuPrice(item.price)
        const margin = calculateMargin(item.price, menuPrice)
        const bottleSizeDisplay = item.bottleSizeMl ? formatVolume(item.bottleSizeMl, measurementUnit) : ''
        const pourSizeDisplay = item.pourSizeMl ? formatVolume(item.pourSizeMl, measurementUnit) : ''
        return [
          item.name,
          item.producer,
          item.type,
          bottleSizeDisplay,
          item.saleType ?? '',
          pourSizeDisplay,
          item.liveStock || 0,
          item.shadowStock || 0,
          totalStock,
          item.threshold,
          getStockStatus(item).label,
          item.price.toFixed(2),
          menuPrice.toFixed(2),
          margin.toFixed(1),
          (totalStock * item.price).toFixed(2),
          (totalStock * menuPrice).toFixed(2)
        ]
      }),
    ]

    // Calculate metrics if requested
    let metrics = undefined
    if (includeMetrics) {
      const physicalInventorySize = filteredInventory.reduce((sum, item) => sum + ((item.liveStock || 0) + (item.shadowStock || 0)), 0)
      const totalInventoryValue = filteredInventory.reduce((sum, item) => sum + (((item.liveStock || 0) + (item.shadowStock || 0)) * item.price), 0)
      const lowStockCount = filteredInventory.filter(item => {
        const status = getStockStatus(item)
        return status.status === 'low' || status.status === 'critical'
      }).length
      const outOfStockCount = filteredInventory.filter(item => {
        const status = getStockStatus(item)
        return status.status === 'out'
      }).length

      metrics = {
        physical_inventory_size: physicalInventorySize,
        total_inventory_value: totalInventoryValue,
        low_stock_count: lowStockCount,
        out_of_stock_count: outOfStockCount,
        total_unique_wines: filteredInventory.length,
      }
    }
    
    // Export using the appropriate format
    await exportInventory(exportFormat, exportData, metrics)
    setShowExportModal(false)
  }

  const handleAutoLocate = useCallback(() => {
    const result = computeAutoLocatePlan(
      mergedInventory,
      storageLocations,
      mappings,
      { skipAssigned: !includeAssigned }
    )
    setAutoLocateResult(result)
    setShowAutoLocateModal(true)
  }, [mergedInventory, storageLocations, mappings, includeAssigned])

  const handleConfirmAutoLocate = useCallback((selected: WineLocationScore[]) => {
    for (const assignment of selected) {
      assignWineToLocation(assignment.wineId, assignment.locationId, assignment.quantity)
    }
    queryClient.invalidateQueries({ queryKey: ['winesAtLocation', activeRestaurantId ?? ''] })
    queryClient.invalidateQueries({ queryKey: ['storageLocationMappings', activeRestaurantId ?? ''] })
    setShowAutoLocateModal(false)
    setAutoLocateResult(null)
  }, [assignWineToLocation, queryClient, activeRestaurantId])

  return (
    <div className="min-h-screen">
      <Header title="Inventory" subtitle="Manage live and shadow stock levels" />

      <div className="p-6 space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <p className="text-sm text-gray-500">Total Wines</p>
            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-blue-500" />
              <p className="text-sm text-gray-500">Live Stock</p>
            </div>
            <p className="text-2xl font-bold text-blue-600">{stats.liveTotal.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center gap-2">
              <EyeOff className="w-4 h-4 text-purple-500" />
              <p className="text-sm text-gray-500">Shadow Stock</p>
            </div>
            <p className="text-2xl font-bold text-purple-600">{stats.shadowTotal}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <p className="text-sm text-gray-500">Healthy</p>
            <p className="text-2xl font-bold text-emerald-600">{stats.healthy}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <p className="text-sm text-gray-500">Low Stock</p>
            <p className="text-2xl font-bold text-amber-600">{stats.low}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <p className="text-sm text-gray-500">Critical</p>
            <p className="text-2xl font-bold text-rose-600">{stats.critical}</p>
          </div>
        </div>

        {/* Inventory Insights Panel */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <button
            onClick={() => setShowInventoryInsights(!showInventoryInsights)}
            className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Activity className="w-5 h-5 text-wine-600" />
              <h3 className="font-semibold text-gray-900">Inventory Insights & Organization</h3>
            </div>
            {showInventoryInsights ? (
              <ChevronUp className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            )}
          </button>

          <AnimatePresence>
            {showInventoryInsights && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="border-t border-gray-100 overflow-hidden"
              >
                <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Storage Locations */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <FolderTree className="w-5 h-5 text-blue-600" />
                        <h4 className="font-semibold text-gray-900">Storage Locations</h4>
                      </div>
                      <button
                        onClick={() => setShowStorageManager(true)}
                        className="text-xs text-wine-600 hover:text-wine-700 font-medium"
                      >
                        Manage
                      </button>
                    </div>
                    <div className="space-y-2">
                      {(() => {
                        // Use actual counts calculated from wine-location mappings
                        const locationsWithActualCounts = getLocationsWithActualCounts()
                        return locationsWithActualCounts.slice(0, 4).map((location) => (
                          <button
                            key={location.id}
                            onClick={() => {
                              if (selectedLocationFilter === location.id) {
                                setSelectedLocationFilter(null) // Toggle off if already selected
                              } else {
                                setSelectedLocationFilter(location.id) // Filter by this location
                              }
                            }}
                            className={`w-full flex items-center justify-between p-3 rounded-lg transition-all ${
                              selectedLocationFilter === location.id
                                ? 'bg-wine-50 border-2 border-wine-500 shadow-md'
                                : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent hover:border-wine-300'
                            }`}
                            title={selectedLocationFilter === location.id ? "Click to clear filter" : "Click to filter by this location"}
                          >
                            <div className="flex items-center gap-2">
                              <div
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: location.color }}
                              />
                              <span className="text-sm font-medium text-gray-700">{location.name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-gray-900">{location.currentCount}</span>
                              <span className="text-xs text-gray-500">/ {location.capacity}</span>
                            </div>
                          </button>
                        ))
                      })()}
                    </div>
                    {storageLocations.length > 4 && (
                      <p className="text-xs text-gray-500 text-center">
                        +{storageLocations.length - 4} more locations
                      </p>
                    )}
                    <div className="flex gap-2 mt-2">
                      {selectedLocationFilter && (
                        <button
                          onClick={() => setSelectedLocationFilter(null)}
                          className="flex-1 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex items-center justify-center gap-2"
                        >
                          <X className="w-4 h-4" />
                          Clear Filter
                        </button>
                      )}
                      <button
                        onClick={() => setShowStorageManager(true)}
                        className={`${selectedLocationFilter ? 'flex-1' : 'w-full'} px-4 py-2 text-sm font-medium text-wine-600 hover:bg-wine-50 rounded-lg transition-colors flex items-center justify-center gap-2`}
                      >
                        <MapPin className="w-4 h-4" />
                        Manage Locations
                      </button>
                    </div>
                  </div>

                  {/* QR Code Quick Access */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-3">
                      <QrCode className="w-5 h-5 text-emerald-600" />
                      <h4 className="font-semibold text-gray-900">QR Quick Access</h4>
                    </div>
                    <div className="p-6 bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl text-center">
                      <div className="w-32 h-32 mx-auto bg-white rounded-lg shadow-sm flex items-center justify-center mb-3">
                        <QrCode className="w-20 h-20 text-gray-400" />
                      </div>
                      <p className="text-sm font-medium text-gray-900 mb-1">Inventory QR Code</p>
                      <p className="text-xs text-gray-600 mb-3">Scan to view/update inventory on mobile</p>
                      <button className="w-full px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 shadow-lg shadow-emerald-600/30">
                        Generate QR Code
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 text-center">
                      Print and place QR codes in cellar sections for instant mobile access
                    </p>
                  </div>

                  {/* Inventory Health Dashboard */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-3">
                      <BarChart3 className="w-5 h-5 text-purple-600" />
                      <h4 className="font-semibold text-gray-900">Inventory Health</h4>
                    </div>
                    
                    {/* Health Score */}
                    <div className="p-4 bg-gradient-to-br from-purple-50 to-indigo-50 rounded-xl">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-700">Overall Health Score</span>
                        <TrendingUp className="w-4 h-4 text-emerald-600" />
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-bold text-purple-600">
                          {Math.round((stats.healthy / stats.total) * 100)}
                        </span>
                        <span className="text-sm text-gray-600">/100</span>
                      </div>
                      <div className="mt-2 h-2 bg-white rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 transition-all"
                          style={{ width: `${(stats.healthy / stats.total) * 100}%` }}
                        />
                      </div>
                    </div>

                    {/* Quick Metrics */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-lg">
                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-emerald-600" />
                          <span className="text-sm font-medium text-gray-700">Healthy Stock</span>
                        </div>
                        <span className="text-sm font-semibold text-emerald-700">{stats.healthy} wines</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-amber-50 rounded-lg">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-600" />
                          <span className="text-sm font-medium text-gray-700">Needs Attention</span>
                        </div>
                        <span className="text-sm font-semibold text-amber-700">{stats.low + stats.critical} wines</span>
                      </div>
                    </div>

                    {stats.shadowTotal > 0 && (
                      <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
                        <div className="flex items-center gap-2">
                          <RefreshCw className="w-4 h-4 text-purple-600" />
                          <span className="text-sm font-medium text-gray-700">Pending Reconciliation</span>
                        </div>
                        <span className="text-sm font-semibold text-purple-700">{stats.shadowTotal} bottles</span>
                      </div>
                    )}

                    {/* Recommendations */}
                    <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                      <p className="text-xs font-medium text-blue-900 mb-1">💡 Recommendation</p>
                      <p className="text-xs text-blue-700">
                        {stats.critical > 0 && `${stats.critical} wines are critically low. Consider placing orders soon.`}
                        {stats.critical === 0 && stats.low > 0 && `${stats.low} wines approaching minimum threshold. Monitor closely.`}
                        {stats.critical === 0 && stats.low === 0 && `All wines are well-stocked. Great job!`}
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* View Mode Tabs */}
        <div className="flex items-center gap-4">
          <div className="flex bg-gray-100 rounded-lg p-1">
            {[
              { value: 'all' as const, label: 'All Stock', icon: null },
              { value: 'live' as const, label: 'Live Stock', icon: Eye },
              { value: 'shadow' as const, label: 'Shadow Stock', icon: EyeOff },
            ].map(tab => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.value}
                  onClick={() => setViewMode(tab.value)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    viewMode === tab.value
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {Icon && <Icon className="w-4 h-4" />}
                  {tab.label}
                </button>
              )
            })}
          </div>

          {stats.needsReconciliation > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-100 text-purple-700 rounded-lg text-sm">
              <RefreshCw className="w-4 h-4" />
              <span>{stats.needsReconciliation} items need reconciliation</span>
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search wines, producers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent outline-none"
              />
            </div>

            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border transition-colors ${
                showFilters ? 'bg-wine-50 border-wine-200 text-wine-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Filter className="w-4 h-4" />
              <span className="text-sm font-medium">Filters</span>
            </button>

            <button
              onClick={() => setShowExportModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
            >
              <Download className="w-4 h-4" />
              <span className="text-sm font-medium">Export</span>
            </button>

            <button 
              onClick={() => setShowAddWineModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-wine-600 text-white rounded-lg hover:bg-wine-700 shadow-lg shadow-wine-600/30 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span className="text-sm font-medium">Add Wine</span>
            </button>

            {/* Reset All Stock Button */}
            <button 
              onClick={() => setShowResetStockModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-all"
              title="Reset all inventory stock to zero"
            >
              <RotateCcw className="w-4 h-4" />
              <span className="text-sm font-medium">Reset Stock</span>
            </button>
          </div>

          {/* Extended Filters */}
          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mt-4 pt-4 border-t border-gray-200 overflow-hidden"
              >
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Wine Type</label>
                    <select
                      value={filterType}
                      onChange={(e) => setFilterType(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                    >
                      <option value="all">All Types</option>
                      <option value="red">Red</option>
                      <option value="white">White</option>
                      <option value="rose">Rosé</option>
                      <option value="sparkling">Sparkling</option>
                      <option value="dessert">Dessert</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Stock Status</label>
                    <select
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                    >
                      <option value="all">All Status</option>
                      <option value="healthy">Healthy</option>
                      <option value="low">Low Stock</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Active Status</label>
                    <select
                      value={filterActiveStatus}
                      onChange={(e) => setFilterActiveStatus(e.target.value as 'all' | 'active' | 'inactive')}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                    >
                      <option value="all">All Items</option>
                      <option value="active">Active Only</option>
                      <option value="inactive">Inactive Only</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Bottle Size</label>
                    <select
                      value={filterBottleSize}
                      onChange={(e) => setFilterBottleSize(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                    >
                      <option value="all">All Sizes</option>
                      {uniqueBottleSizes.map(size => (
                        <option key={size} value={size}>{formatVolume(size, measurementUnit)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={clearFilters}
                      className="w-full px-4 py-2 text-gray-600 hover:text-gray-900 font-medium"
                    >
                      Clear Filters
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bulk Actions */}
        {selectedItems.size > 0 && (
          <div className="flex items-center justify-between bg-wine-50 border border-wine-200 rounded-xl px-4 py-3">
            <p className="text-sm text-wine-700">{selectedItems.size} item(s) selected</p>
            <div className="flex gap-2">
              <button className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900">
                <Edit className="w-4 h-4" />
              </button>
              <button className="px-3 py-1.5 bg-wine-600 text-white text-sm font-medium rounded-lg hover:bg-wine-700">
                <ShoppingCart className="w-4 h-4 inline mr-2" />
                Reorder Selected
              </button>
            </div>
          </div>
        )}

        {/* Inventory Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[1432px]" style={{ width: 'max-content', tableLayout: 'fixed' }}>
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left w-12">
                    <input
                      type="checkbox"
                      checked={selectedItems.size === displayedInventory.length && displayedInventory.length > 0}
                      onChange={() => {
                        if (selectedItems.size === displayedInventory.length) {
                          setSelectedItems(new Set())
                        } else {
                          setSelectedItems(new Set(displayedInventory.map(i => i.id)))
                        }
                      }}
                      className="rounded border-gray-300"
                    />
                  </th>
                  <th className="px-4 py-3 text-left w-[300px]">
                    <button
                      onClick={() => toggleSort('name')}
                      className="flex items-center gap-1 text-sm font-semibold text-gray-900"
                    >
                      Wine
                      <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 w-28">Type</th>
                  <th className="px-4 py-3 text-left w-28">
                    <button
                      onClick={() => toggleSort('bottleSizeMl')}
                      className="flex items-center gap-1 text-sm font-semibold text-gray-900"
                    >
                      Format
                      <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left w-32">
                    <div className="flex items-center gap-1 text-sm font-semibold text-gray-900">
                      <MapPin className="w-4 h-4 text-emerald-500" />
                      Location
                    </div>
                  </th>
                  <th className="px-4 py-3 text-center w-24">
                    <button
                      onClick={() => toggleSort('liveStock')}
                      className="flex items-center gap-1 text-sm font-semibold text-gray-900 mx-auto"
                    >
                      <Eye className="w-4 h-4 text-blue-500" />
                      Live
                      <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-center w-24">
                    <button
                      onClick={() => toggleSort('shadowStock')}
                      className="flex items-center gap-1 text-sm font-semibold text-gray-900 mx-auto"
                    >
                      <EyeOff className="w-4 h-4 text-purple-500" />
                      Shadow
                      <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-gray-900 w-20">Total</th>
                  <th className="px-4 py-3 text-center w-20">
                    <button
                      onClick={() => toggleSort('threshold')}
                      className="flex items-center gap-1 text-sm font-semibold text-gray-900 mx-auto"
                    >
                      Min
                      <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right w-24">
                    <button
                      onClick={() => toggleSort('price')}
                      className="flex items-center gap-1 text-sm font-semibold text-gray-900 ml-auto"
                    >
                      Purchased Price
                      <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right w-24">
                    <button
                      onClick={() => toggleSort('menuPrice')}
                      className="flex items-center gap-1 text-sm font-semibold text-gray-900 ml-auto"
                    >
                      Menu Price
                      <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right w-20">
                    <button
                      onClick={() => toggleSort('margin')}
                      className="flex items-center gap-1 text-sm font-semibold text-gray-900 ml-auto"
                    >
                      Margin
                      <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900 w-28">Total Value</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 w-28">Status</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-gray-900 w-20">Active</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900 w-32">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayedInventory.map((item) => {
                  const status = getStockStatus(item)
                  const typeColors = getWineTypeColor(item.type)
                  const totalStock = (item.liveStock || 0) + (item.shadowStock || 0)
                  return (
                    <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 w-12">
                        <input
                          type="checkbox"
                          checked={selectedItems.has(item.id)}
                          onChange={() => toggleSelection(item.id)}
                          className="rounded border-gray-300"
                        />
                      </td>
                      <td className="px-4 py-3 w-[300px]">
                        <div>
                          <p className="font-medium text-gray-900">{item.name}</p>
                          <p className="text-sm text-gray-500">{item.producer} · {item.vintage || 'NV'}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3 w-28">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${typeColors.bg} ${typeColors.text}`}>
                          {item.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 w-28">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm">
                            {(() => {
                              const vol = formatVolume(item.bottleSizeMl || 750, measurementUnit)
                              const numMatch = vol.match(/^([\d.]+)(.+)$/)
                              if (numMatch) {
                                return <><span className="font-medium text-gray-900">{numMatch[1]}</span><span className="text-gray-400 text-xs">{numMatch[2]}</span></>
                              }
                              return <span className="font-medium text-gray-900">{vol}</span>
                            })()}
                          </span>
                          {item.saleType && (
                            <span className={`text-[10px] font-semibold leading-none px-1.5 py-0.5 rounded ${
                              item.saleType === 'bottle' ? 'bg-blue-50 text-blue-600' :
                              item.saleType === 'glass' ? 'bg-amber-50 text-amber-600' :
                              'bg-purple-50 text-purple-600'
                            }`}>
                              {item.saleType === 'bottle' ? 'BTL' : item.saleType === 'glass' ? 'GLS' : 'BTL+GLS'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 w-32 relative">
                        <LocationPickerCell
                          wineId={item.id}
                          quantity={(item.liveStock || 0) + (item.shadowStock || 0) || 1}
                          locations={storageLocations}
                          currentLocation={getWineLocation(item.id)}
                          onAssign={(locationId, qty) => {
                            assignWineToLocation(item.id, locationId, qty)
                            setInventory(prev => prev.map(inv =>
                              inv.id === item.id
                                ? { ...inv, storageLocation: storageLocations.find(l => l.id === locationId)?.name }
                                : inv
                            ))
                          }}
                          onRemove={() => {
                            removeWineFromLocation(item.id)
                            setInventory(prev => prev.map(inv =>
                              inv.id === item.id ? { ...inv, storageLocation: undefined } : inv
                            ))
                          }}
                        />
                      </td>
                      <td className="px-4 py-3 text-center w-24">
                        <div className="flex items-center justify-center gap-1">
                          <span className="text-lg font-semibold text-blue-600">{item.liveStock || 0}</span>
                          {item.lastManualAdjustment && (
                            <span className="text-amber-600" title={`Last adjusted by ${item.lastManualAdjustment.managerName} on ${new Date(item.lastManualAdjustment.timestamp).toLocaleString()}`}>
                              🔧
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center w-24">
                        {item.shadowStock && item.shadowStock > 0 ? (
                          <div className="flex items-center justify-center gap-1">
                            <span className="text-lg font-semibold text-purple-600">{item.shadowStock}</span>
                            {item.lastManualAdjustment && (
                              <span className="text-amber-600" title={`Last adjusted by ${item.lastManualAdjustment.managerName} on ${new Date(item.lastManualAdjustment.timestamp).toLocaleString()}`}>
                                🔧
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center w-20">
                        <span className="text-lg font-semibold text-gray-900">{totalStock}</span>
                      </td>
                      <td className="px-4 py-3 text-center w-20">
                        <span className="text-sm text-gray-600">{item.threshold}</span>
                      </td>
                      <td className="px-4 py-3 text-right w-24">
                        <span className="text-sm font-medium text-gray-900">${item.price.toFixed(2)}</span>
                      </td>
                      <td className="px-4 py-3 text-right w-24">
                        {item.menuPriceGlass && (item.saleType === 'glass' || item.saleType === 'both') ? (
                          <div className="text-sm">
                            <span className="font-medium text-blue-600">${(item.menuPrice || getDefaultMenuPrice(item.price)).toFixed(0)}</span>
                            <span className="text-gray-400">/btl</span>
                            <span className="text-gray-300 mx-0.5">·</span>
                            <span className="font-medium text-amber-600">${item.menuPriceGlass.toFixed(0)}</span>
                            <span className="text-gray-400">/gls</span>
                          </div>
                        ) : (
                          <span className="text-sm font-medium text-blue-600">
                            ${(item.menuPrice || getDefaultMenuPrice(item.price)).toFixed(2)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right w-20">
                        {(() => {
                          const margin = calculateMargin(item.price, item.menuPrice || getDefaultMenuPrice(item.price))
                          const marginColor = margin >= 70 ? 'text-emerald-600' : margin >= 60 ? 'text-amber-600' : 'text-red-600'
                          return (
                            <span className={`text-sm font-semibold ${marginColor}`}>
                              {margin.toFixed(1)}%
                            </span>
                          )
                        })()}
                      </td>
                      <td className="px-4 py-3 text-right w-28">
                        <span className="text-sm font-semibold text-emerald-600">
                          ${((item.menuPrice || getDefaultMenuPrice(item.price)) * totalStock).toLocaleString()}
                        </span>
                      </td>
                      <td className="px-4 py-3 w-28">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${status.bg} ${status.text}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center w-20">
                        <button
                          onClick={() => toggleItemActiveStatus(item.id)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            item.isActive ? 'bg-emerald-500' : 'bg-gray-300'
                          }`}
                          title={item.isActive ? 'Deactivate item' : 'Activate item'}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              item.isActive ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right w-48">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setManualOverrideModal(item)}
                            className="p-2 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                            title="Manual stock override"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          {item.shadowStock && item.shadowStock > 0 && (
                            <button
                              onClick={() => setReconcileModal(item)}
                              className="p-2 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                              title="Reconcile shadow stock"
                            >
                              <RefreshCw className="w-4 h-4" />
                            </button>
                          )}
                          <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" title="Reorder">
                            <ShoppingCart className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleRemoveFromInventory(item)}
                            className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            title="Remove from inventory"
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

          {filteredInventory.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-500">No wines found matching your filters</p>
            </div>
          )}
        </div>
      </div>

      {/* Add Wine Modal */}
      <AddWineToInventoryModal
        isOpen={showAddWineModal}
        onClose={() => setShowAddWineModal(false)}
        onAddWine={(wine, quantity, threshold, storageLocationId) => {
          console.log('Adding wine to inventory:', wine, quantity, threshold, storageLocationId)
          
          // Update storage location count if specified
          if (storageLocationId) {
            setStorageLocations(prev => 
              prev.map(loc => 
                loc.id === storageLocationId
                  ? { ...loc, currentCount: loc.currentCount + quantity }
                  : loc
              )
            )
          }
          
          // Add wine to inventory with storage location
          const newInventoryItem: InventoryItem = {
            ...wine,
            inventoryId: `inv-${Date.now()}`,
            liveStock: quantity,
            shadowStock: 0,
            threshold,
            storageLocation: storageLocationId 
              ? storageLocations.find(loc => loc.id === storageLocationId)?.name 
              : undefined,
            lastCounted: new Date().toISOString(),
            isActive: true,
          }
          
          setInventory(prev => [...prev, newInventoryItem])
          
          // Dispatch inventory update for cross-page sync
          dispatchInventoryUpdate({
            type: 'add',
            wineId: wine.id,
            wineName: wine.name,
            quantity,
            source: 'manual',
            timestamp: new Date().toISOString(),
            metadata: {
              threshold,
              storageLocationId,
              cost: wine.price,
            },
          })
          
          setShowAddWineModal(false)
        }}
      />

      {/* Manual Override Modal */}
      {/* Reconcile Modal */}
      <AnimatePresence>
        {reconcileModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setReconcileModal(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <RefreshCw className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Reconcile Shadow Stock</h3>
                  <p className="text-sm text-gray-500">{reconcileModal.name}</p>
                </div>
              </div>

              <div className="space-y-4 mb-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-blue-50 rounded-xl text-center">
                    <p className="text-sm text-blue-600">Live Stock</p>
                    <p className="text-2xl font-bold text-blue-700">{reconcileModal.liveStock || 0}</p>
                  </div>
                  <div className="p-4 bg-purple-50 rounded-xl text-center">
                    <p className="text-sm text-purple-600">Shadow Stock</p>
                    <p className="text-2xl font-bold text-purple-700">{reconcileModal.shadowStock || 0}</p>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Actual Count (Physical Count)
                  </label>
                  <input
                    type="number"
                    value={actualCount}
                    onChange={(e) => setActualCount(e.target.value)}
                    placeholder="Enter actual bottle count"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    This will update live stock and clear shadow stock
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setReconcileModal(null)}
                  className="flex-1 px-4 py-3 border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReconcile}
                  disabled={!actualCount}
                  className="flex-1 px-4 py-3 bg-purple-600 text-white font-medium rounded-xl hover:bg-purple-700 disabled:opacity-50"
                >
                  Reconcile
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {manualOverrideModal && (
        <ManualOverrideModal
          isOpen={!!manualOverrideModal}
          onClose={() => setManualOverrideModal(null)}
          wine={manualOverrideModal}
          currentLiveStock={manualOverrideModal.liveStock || 0}
          currentShadowStock={manualOverrideModal.shadowStock || 0}
          onSave={handleManualOverride}
        />
      )}

      {/* Export Options Modal */}
      <AnimatePresence>
        {showExportModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowExportModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-wine-50 to-blue-50">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-wine-600 rounded-xl">
                    <Download className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">Export Inventory</h2>
                    <p className="text-sm text-gray-500">Choose your export format</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowExportModal(false)}
                  className="p-2 hover:bg-white/50 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                {/* Format Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">Export Format</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['csv', 'pdf', 'excel', 'sheets', 'drive'] as ExportFormat[]).map((format) => {
                      const formatLabels = {
                        csv: { label: 'CSV', icon: '📄', desc: 'Compatible with Excel' },
                        pdf: { label: 'PDF', icon: '📑', desc: 'Printable report' },
                        excel: { label: 'Excel', icon: '📊', desc: 'Native .xlsx file' },
                        sheets: { label: 'Google Sheets', icon: '📈', desc: 'Cloud spreadsheet' },
                        drive: { label: 'Google Drive', icon: '☁️', desc: 'Save to Drive' },
                      }
                      const config = formatLabels[format]
                      
                      return (
                        <button
                          key={format}
                          onClick={() => setExportFormat(format)}
                          className={`p-3 rounded-lg border-2 transition-all text-left ${
                            exportFormat === format
                              ? 'border-wine-600 bg-wine-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xl">{config.icon}</span>
                            <div>
                              <p className="text-sm font-semibold text-gray-900">{config.label}</p>
                              <p className="text-xs text-gray-500">{config.desc}</p>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Include Metrics Toggle */}
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">Include Metrics</p>
                    <p className="text-sm text-gray-500">Add summary statistics to export</p>
                  </div>
                  <button
                    onClick={() => setIncludeMetrics(!includeMetrics)}
                    className={`relative w-11 h-6 rounded-full transition-colors ${
                      includeMetrics ? 'bg-wine-600' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                        includeMetrics ? 'translate-x-5' : ''
                      }`}
                    />
                  </button>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleExport}
                    className="flex-1 px-6 py-3 bg-wine-600 text-white font-medium rounded-xl hover:bg-wine-700 transition-colors flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    Export Now
                  </button>
                  <button
                    onClick={() => setShowExportModal(false)}
                    className="px-6 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Storage Location Manager Modal */}
      <StorageLocationManager
        isOpen={showStorageManager}
        onClose={() => setShowStorageManager(false)}
        inventoryItems={inventory}
        onSelectLocation={(location) => {
          setSelectedLocationFilter(location.id)
          setShowStorageManager(false)
        }}
        onLocationsChange={(updatedLocations) => {
          setStorageLocations(updatedLocations)
        }}
        onAutoLocate={handleAutoLocate}
      />

      {/* Reset All Stock Modal */}
      <AnimatePresence>
        {showResetStockModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowResetStockModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              {/* Header */}
              <div className="px-6 py-4 border-b bg-gradient-to-r from-rose-50 to-red-50">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-red-100 rounded-xl">
                    <AlertTriangle className="w-5 h-5 text-red-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">Reset All Stock</h3>
                    <p className="text-sm text-gray-500">This action cannot be undone</p>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-6 space-y-4">
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                  <p className="text-sm text-amber-800">
                    <strong>Warning:</strong> This will reset all inventory items to 0 stock (both live and shadow).
                    This affects <strong>{mergedInventory.length}</strong> items with a total of{' '}
                    <strong>{mergedInventory.reduce((sum, item) => sum + (item.liveStock || 0) + (item.shadowStock || 0), 0)}</strong> bottles.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Type <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">RESET</span> to confirm:
                  </label>
                  <input
                    type="text"
                    value={resetStockConfirmText}
                    onChange={(e) => setResetStockConfirmText(e.target.value)}
                    placeholder="Type RESET"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-end gap-3">
                <button
                  onClick={() => {
                    setShowResetStockModal(false)
                    setResetStockConfirmText('')
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleResetAllStock}
                  disabled={resetStockConfirmText !== 'RESET'}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    resetStockConfirmText === 'RESET'
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Reset All Stock
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {autoLocateResult && (
        <AutoLocatePreviewModal
          isOpen={showAutoLocateModal}
          onClose={() => { setShowAutoLocateModal(false); setAutoLocateResult(null) }}
          result={autoLocateResult}
          allLocations={storageLocations}
          includeAssigned={includeAssigned}
          onToggleIncludeAssigned={(val) => {
            setIncludeAssigned(val)
            const newResult = computeAutoLocatePlan(
              mergedInventory,
              storageLocations,
              mappings,
              { skipAssigned: !val }
            )
            setAutoLocateResult(newResult)
          }}
          onConfirm={handleConfirmAutoLocate}
        />
      )}
    </div>
  )
}
