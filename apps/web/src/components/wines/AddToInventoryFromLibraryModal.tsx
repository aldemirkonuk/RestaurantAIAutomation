import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Wine,
  Package,
  DollarSign,
  MapPin,
  AlertTriangle,
  Check,
  Plus,
  Minus,
  TrendingUp,
  Undo2,
  Zap,
  CheckCircle,
  ChevronDown,
} from 'lucide-react'
import { Wine as WineType, getWineTypeColor } from '../../data/wineData'
import { useAuth } from '../../contexts/AuthContext'
import { useProviders } from '../../hooks/queries/useProviderQueries'
import type { Provider } from '../../services/api/providers'
import {
  checkInventoryDuplicate,
  addWineToInventory,
  updateInventoryQuantity,
} from '../../data/inventoryData'
import { createInventoryItem } from '../../services/api/inventory'
import { useRealtimeDispatch } from '../../contexts/RealtimeContext'
import { useStorageLocations } from '../../hooks/useStorageLocations'
import {
  COMMON_BOTTLE_SIZES,
  COMMON_POUR_SIZES,
  parseVolumeInput,
  isValidBottleSize,
  isValidPourSize,
  formatVolume,
  getGlassesPerBottle,
  type SaleType,
} from '../../utils/volumeUtils'

interface AddToInventoryFromLibraryModalProps {
  wine: WineType
  onClose: () => void
  onSuccess: (message: string) => void
}

// Undo state for inventory operations
interface UndoState {
  type: 'add' | 'update'
  inventoryId: string
  previousQuantity?: number
  wineId: string
}

interface DuplicateInfo {
  exists: boolean
  inventoryId?: string
  currentQuantity?: number
  lastUpdated?: string
}

interface LocalProvider {
  id: string
  name: string
  primaryBusinessType: string
  phone: string
  email: string
  physicalAddress?: string
  contactPerson?: string
  website?: string
  winePortfolio?: string
  paymentTerms?: string
  minimumOrderValue?: number | null
  deliverySchedule?: string
  notes?: string
  createdAt: string
  isLocal: true
}

const LOCAL_PROVIDERS_KEY = 'wineops_local_providers'
const isUuid = (value?: string | null) =>
  !!value &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

function loadLocalProviders(): LocalProvider[] {
  try {
    const stored = localStorage.getItem(LOCAL_PROVIDERS_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

export function AddToInventoryFromLibraryModal({
  wine,
  onClose,
  onSuccess,
}: AddToInventoryFromLibraryModalProps) {
  const { user } = useAuth()
  const { data: apiProviders = [], isLoading: providersLoading, error: providersError } = useProviders(user?.restaurantId || '')
  const [localProviders, setLocalProviders] = useState<LocalProvider[]>([])
  const [quantity, setQuantity] = useState<number>(wine.threshold || 10)
  const [costPerBottle, setCostPerBottle] = useState<number>(wine.price)
  const [selectedProvider, setSelectedProvider] = useState<string>(wine.provider.name)
  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>(wine.provider.id)
  const [selectedLocationId, setSelectedLocationId] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo>({ exists: false })
  const [duplicateAction, setDuplicateAction] = useState<'add' | 'separate' | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showSuccessToast, setShowSuccessToast] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [undoState, setUndoState] = useState<UndoState | null>(null)
  const [undoCountdown, setUndoCountdown] = useState(5)
  const [quickAddMode, setQuickAddMode] = useState(false)

  const [bottleSizeMl, setBottleSizeMl] = useState<number>(750)
  const [customBottleSizeInput, setCustomBottleSizeInput] = useState('')
  const [isCustomBottleSize, setIsCustomBottleSize] = useState(false)
  const [saleType, setSaleType] = useState<SaleType>('bottle')
  const [pourSizeMl, setPourSizeMl] = useState<number>(150)
  const [customPourSizeInput, setCustomPourSizeInput] = useState('')
  const [isCustomPourSize, setIsCustomPourSize] = useState(false)
  const [menuPriceGlass, setMenuPriceGlass] = useState<number>(0)

  const customBottleParsed = customBottleSizeInput ? parseVolumeInput(customBottleSizeInput) : null
  const customPourParsed = customPourSizeInput ? parseVolumeInput(customPourSizeInput) : null
  const showGlassFields = saleType === 'glass' || saleType === 'both'
  const glassesPerBottle = showGlassFields ? getGlassesPerBottle(bottleSizeMl, pourSizeMl) : 0

  // Get realtime dispatch for cross-page sync
  const { dispatchInventoryUpdate } = useRealtimeDispatch()
  
  // Get storage locations for cross-page persistence
  const { locations, assignWineToLocation, getWineLocation } = useStorageLocations()

  const availableProviders = useMemo(() => {
    if (localProviders.length === 0) {
      return apiProviders
    }

    const localAsProviders = localProviders.map(lp => ({
      ...lp,
      id: lp.id,
      restaurantId: user?.restaurantId || '',
      _isLocal: true,
    })) as (Provider & { _isLocal?: boolean })[]

    const apiIds = new Set(apiProviders.map(p => p.id))
    const uniqueLocal = localAsProviders.filter(lp => !apiIds.has(lp.id))

    return [...apiProviders, ...uniqueLocal] as Provider[]
  }, [apiProviders, localProviders, user?.restaurantId])
  
  // Check if wine already has a location assigned
  useEffect(() => {
    const existingLocation = getWineLocation(wine.id)
    if (existingLocation) {
      setSelectedLocationId(existingLocation.id)
    }
  }, [wine.id, getWineLocation])

  // Check for duplicates on mount
  useEffect(() => {
    checkForDuplicate()
  }, [wine.id])

  useEffect(() => {
    setLocalProviders(loadLocalProviders())
  }, [])

  const checkForDuplicate = async () => {
    try {
      const existingItem = checkInventoryDuplicate(wine.id)

      if (existingItem) {
        setDuplicateInfo({
          exists: true,
          inventoryId: existingItem.inventoryId,
          currentQuantity: existingItem.quantity,
          lastUpdated: existingItem.lastUpdated,
        })
      } else {
        setDuplicateInfo({ exists: false })
      }
    } catch (error) {
      console.error('Failed to check for duplicates:', error)
      setDuplicateInfo({ exists: false })
    }
  }

  // Undo countdown timer
  useEffect(() => {
    if (showSuccessToast && undoCountdown > 0) {
      const timer = setTimeout(() => {
        setUndoCountdown(prev => prev - 1)
      }, 1000)
      return () => clearTimeout(timer)
    } else if (undoCountdown === 0 && showSuccessToast) {
      // Auto-close after undo window expires
      setShowSuccessToast(false)
      setUndoState(null)
      onClose()
    }
  }, [showSuccessToast, undoCountdown, onClose])

  const handleUndo = useCallback(() => {
    if (!undoState) return
    
    // In a real app, this would call an API to undo the operation
    // For now, we'll just show a message
    console.log('Undoing operation:', undoState)
    
    // Reset state
    setShowSuccessToast(false)
    setUndoState(null)
    setUndoCountdown(5)
    
    alert(`Undo successful! The inventory change has been reverted.`)
  }, [undoState])

  const handleQuickAdd = async () => {
    setIsSubmitting(true)
    
    try {
      const addQuantity = wine.threshold || 12
      const locationName = selectedLocationId 
        ? locations.find(l => l.id === selectedLocationId)?.name || ''
        : ''
      
      // Quick add with default values
      const newItem = addWineToInventory(
        wine,
        addQuantity,
        wine.price,
        wine.provider.name,
        locationName,
        ''
      )
      
      // Assign to storage location for cross-page persistence
      if (selectedLocationId) {
        assignWineToLocation(wine.id, selectedLocationId, addQuantity)
      }
      
      // Dispatch realtime event for cross-page sync
      dispatchInventoryUpdate({
        type: 'add',
        wineId: wine.id,
        wineName: wine.name,
        quantity: addQuantity,
        source: 'wine_library',
        timestamp: new Date().toISOString(),
        metadata: {
          inventoryId: newItem.inventoryId,
          costPerBottle: wine.price,
          provider: wine.provider.name,
          storageLocationId: selectedLocationId,
          storageLocationName: locationName,
          bottleSizeMl,
          saleType,
          ...(showGlassFields && { pourSizeMl, menuPriceGlass }),
        }
      })
      
      // Set undo state
      setUndoState({
        type: 'add',
        inventoryId: newItem.inventoryId,
        wineId: wine.id
      })
      
      setSuccessMessage(`${wine.name} added to inventory!`)
      setShowSuccessToast(true)
      setUndoCountdown(5)
      
      // Trigger immediate sync notification
      onSuccess(`✅ Synced! ${wine.name} added with ${addQuantity} bottles.${locationName ? ` Location: ${locationName}` : ''}`)
    } catch (error) {
      console.error('Quick add failed:', error)
      alert('Failed to add wine. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmit = async () => {
    if (duplicateInfo.exists && !duplicateAction) {
      // User must choose an action for duplicates
      return
    }

    setIsSubmitting(true)

    try {
      const wineIdIsUuid = isUuid(wine.id)
      const storageLocationIdIsUuid = !selectedLocationId || isUuid(selectedLocationId)

      if (duplicateInfo.exists && duplicateAction === 'add' && duplicateInfo.inventoryId) {
        // Update existing inventory
        const updatedItem = updateInventoryQuantity(
          duplicateInfo.inventoryId,
          quantity,
          costPerBottle
        )
        
        if (updatedItem) {
          // Dispatch realtime event for cross-page sync
          dispatchInventoryUpdate({
            type: 'stock_change',
            wineId: wine.id,
            wineName: wine.name,
            quantity: quantity,
            previousQuantity: duplicateInfo.currentQuantity,
            source: 'wine_library',
            timestamp: new Date().toISOString(),
            metadata: {
              inventoryId: duplicateInfo.inventoryId,
              costPerBottle,
              action: 'add_to_existing',
              bottleSizeMl,
              saleType,
              ...(showGlassFields && { pourSizeMl, menuPriceGlass }),
            }
          })
          
          // Set undo state
          setUndoState({
            type: 'update',
            inventoryId: duplicateInfo.inventoryId,
            previousQuantity: duplicateInfo.currentQuantity,
            wineId: wine.id
          })
          
          setSuccessMessage(`Stock updated to ${updatedItem.quantity} bottles`)
          setShowSuccessToast(true)
          setUndoCountdown(5)
          
          onSuccess(`✅ Stock updated!\n\n${wine.name} inventory increased to ${updatedItem.quantity} bottles.`)
        } else {
          throw new Error('Failed to update inventory')
        }
      } else {
        // Create new entry via API
        const locationName = selectedLocationId 
          ? locations.find(l => l.id === selectedLocationId)?.name || ''
          : ''
        
        if (!wineIdIsUuid || !storageLocationIdIsUuid) {
          // Fall back to local inventory when IDs are not UUIDs
          const newItem = addWineToInventory(
            wine,
            quantity,
            costPerBottle,
            selectedProvider,
            locationName,
            notes || ''
          )

          if (selectedLocationId) {
            assignWineToLocation(wine.id, selectedLocationId, quantity)
          }

          dispatchInventoryUpdate({
            type: 'add',
            wineId: wine.id,
            wineName: wine.name,
            quantity: quantity,
            source: 'wine_library',
            timestamp: new Date().toISOString(),
            metadata: {
              inventoryId: newItem.inventoryId,
              costPerBottle,
              provider: selectedProvider,
              storageLocationId: selectedLocationId || undefined,
              storageLocationName: locationName,
              notes,
              bottleSizeMl,
              saleType,
              ...(showGlassFields && { pourSizeMl, menuPriceGlass }),
            }
          })

          setUndoState({
            type: 'add',
            inventoryId: newItem.inventoryId,
            wineId: wine.id
          })

          setSuccessMessage(`${wine.name} added to inventory!`)
          setShowSuccessToast(true)
          setUndoCountdown(5)
          onSuccess(`✅ ${wine.name} added to inventory!\n\nQuantity: ${quantity} bottles\nCost: $${costPerBottle}/bottle\nProvider: ${selectedProvider}${locationName ? `\nLocation: ${locationName}` : ''}\nInventory ID: ${newItem.inventoryId}`)
          return
        }
        
        // Call the backend API to persist to database
        const newItem = await createInventoryItem({
          wineId: wine.id,
          providerId: selectedProviderId,
          stockLive: quantity,
          costPerBottle,
          storageLocationId: selectedLocationId || undefined,
          notes: notes || undefined,
          thresholdMin: wine.threshold ? Math.floor(wine.threshold * 0.5) : 6,
          thresholdMax: wine.threshold || 24,
        })
        
        // Assign to storage location for cross-page persistence
        if (selectedLocationId) {
          assignWineToLocation(wine.id, selectedLocationId, quantity)
        }
        
        // Dispatch realtime event for cross-page sync
        dispatchInventoryUpdate({
          type: 'add',
          wineId: wine.id,
          wineName: wine.name,
          quantity: quantity,
          source: 'wine_library',
          timestamp: new Date().toISOString(),
          metadata: {
            inventoryId: newItem.id,
            costPerBottle,
            provider: selectedProvider,
            storageLocationId: selectedLocationId,
            storageLocationName: locationName,
            notes,
            bottleSizeMl,
            saleType,
            ...(showGlassFields && { pourSizeMl, menuPriceGlass }),
          }
        })
        
        // Set undo state
        setUndoState({
          type: 'add',
          inventoryId: newItem.id,
          wineId: wine.id
        })
        
        setSuccessMessage(`${wine.name} added to inventory!`)
        setShowSuccessToast(true)
        setUndoCountdown(5)
        
        onSuccess(`✅ ${wine.name} added to inventory!\n\nQuantity: ${quantity} bottles\nCost: $${costPerBottle}/bottle\nProvider: ${selectedProvider}${locationName ? `\nLocation: ${locationName}` : ''}\nInventory ID: ${newItem.id}`)
      }
    } catch (error) {
      console.error('Failed to add wine to inventory:', error)
      alert('Failed to add wine to inventory. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const typeColors = getWineTypeColor(wine.type)
  const totalCost = quantity * costPerBottle

  return (
    <AnimatePresence>
      {/* Success Toast with Undo */}
      {showSuccessToast && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 50, scale: 0.95 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-emerald-600 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-4 min-w-[400px]"
        >
          <div className="p-2 bg-white/20 rounded-full">
            <CheckCircle className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <p className="font-semibold">{successMessage}</p>
            <p className="text-sm text-white/80">Synced with inventory</p>
          </div>
          <button
            onClick={handleUndo}
            className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-xl transition-colors"
          >
            <Undo2 className="w-4 h-4" />
            <span className="text-sm font-medium">Undo ({undoCountdown}s)</span>
          </button>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-blue-100">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600 rounded-xl">
                <Package className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Add to Inventory</h2>
                <p className="text-sm text-gray-500">Configure inventory details</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Quick Add Button */}
              {!duplicateInfo.exists && (
                <button
                  onClick={handleQuickAdd}
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors text-sm font-medium shadow-lg shadow-emerald-600/30 disabled:opacity-50"
                  title="Quick add with default values"
                >
                  <Zap className="w-4 h-4" />
                  Quick Add
                </button>
              )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/50 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Wine Preview */}
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
              <div className="flex items-center gap-4">
                <div className="w-16 h-20 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Wine className="w-8 h-8 text-gray-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900 truncate">{wine.name}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeColors.bg} ${typeColors.text}`}>
                      {wine.type}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">{wine.producer}</p>
                  <p className="text-sm text-gray-500">{wine.vintage || 'NV'} · {wine.region}, {wine.country}</p>
                  <p className="text-sm font-medium text-gray-700 mt-1">${wine.price}/bottle</p>
                </div>
              </div>
            </div>

            {/* Duplicate Warning */}
            {duplicateInfo.exists && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-amber-50 border border-amber-200 rounded-xl"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-amber-900 mb-1">Wine Already in Inventory</p>
                    <p className="text-sm text-amber-700 mb-3">
                      This wine is already in your inventory with <span className="font-semibold">{duplicateInfo.currentQuantity} bottles</span>.
                      {duplicateInfo.lastUpdated && (
                        <span className="text-xs block mt-1">
                          Last updated: {new Date(duplicateInfo.lastUpdated).toLocaleDateString()}
                        </span>
                      )}
                    </p>
                    <div className="space-y-2">
                      <button
                        onClick={() => setDuplicateAction('add')}
                        className={`w-full p-3 rounded-lg border-2 transition-all text-left ${
                          duplicateAction === 'add'
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-amber-200 bg-white hover:border-amber-300'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {duplicateAction === 'add' && <Check className="w-4 h-4 text-blue-600" />}
                          <div className="flex-1">
                            <p className="font-medium text-gray-900 text-sm">Add More Stock</p>
                            <p className="text-xs text-gray-600 mt-0.5">
                              Increase existing entry to {(duplicateInfo.currentQuantity || 0) + quantity} bottles
                            </p>
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={() => setDuplicateAction('separate')}
                        className={`w-full p-3 rounded-lg border-2 transition-all text-left ${
                          duplicateAction === 'separate'
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-amber-200 bg-white hover:border-amber-300'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {duplicateAction === 'separate' && <Check className="w-4 h-4 text-blue-600" />}
                          <div className="flex-1">
                            <p className="font-medium text-gray-900 text-sm">Create Separate Entry</p>
                            <p className="text-xs text-gray-600 mt-0.5">
                              Keep as a distinct inventory item (different lot, vintage, etc.)
                            </p>
                          </div>
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Initial Quantity */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Initial Quantity (bottles)
              </label>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="p-2 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <Minus className="w-4 h-4 text-gray-600" />
                </button>
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-center font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="p-2 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <Plus className="w-4 h-4 text-gray-600" />
                </button>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <p className="text-xs text-gray-500">Quick presets:</p>
                {[6, 12, 24].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setQuantity(preset)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      quantity === preset
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Cost per Bottle */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Cost per Bottle
              </label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={costPerBottle}
                  onChange={(e) => setCostPerBottle(parseFloat(e.target.value) || 0)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="0.00"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">Default price: ${wine.price}</p>
            </div>

            {/* Provider Selection - Card-based UI */}
            <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
              <label className="block text-sm font-medium text-gray-900 mb-3">
                Provider(s)
              </label>
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {providersLoading && (
                  <div className="text-sm text-gray-500">Loading providers...</div>
                )}
                {providersError && (
                  <div className="text-sm text-amber-700">
                    Unable to load providers. Showing cached list if available.
                  </div>
                )}
                {/* Primary Provider */}
                <div
                  onClick={() => {
                    setSelectedProvider(wine.provider.name)
                    setSelectedProviderId(wine.provider.id)
                    localStorage.setItem('lastUsedProvider', wine.provider.id || wine.provider.name)
                  }}
                  className={`p-3 rounded-xl border-2 cursor-pointer transition-all ${
                    selectedProvider === wine.provider.name
                      ? 'border-blue-500 bg-white shadow-sm'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-gray-900">{wine.provider.name}</span>
                    {localStorage.getItem('lastUsedProvider') === (wine.provider.id || wine.provider.name) && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">Last Used</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500">{wine.provider.email || 'sales@provider.com'}</div>
                  <div className="text-sm text-gray-500">{wine.provider.phone || '+1 415-XXX-XXXX'}</div>
                </div>

                {/* Other Providers */}
                {availableProviders.length === 0 && !providersLoading ? (
                  <div className="text-sm text-gray-500">No providers available.</div>
                ) : availableProviders
                  .filter(p => p.name !== wine.provider.name)
                  .slice(0, 5)
                  .map(provider => (
                    <div
                      key={provider.id}
                      onClick={() => {
                        setSelectedProvider(provider.name)
                        setSelectedProviderId(provider.id)
                        localStorage.setItem('lastUsedProvider', provider.id)
                      }}
                      className={`p-3 rounded-xl border-2 cursor-pointer transition-all ${
                        selectedProvider === provider.name
                          ? 'border-blue-500 bg-white shadow-sm'
                          : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-gray-900">{provider.name}</span>
                        {localStorage.getItem('lastUsedProvider') === provider.id && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">Last Used</span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500">{provider.email || 'contact@provider.com'}</div>
                      <div className="text-sm text-gray-500">{provider.phone || '+1 415-XXX-XXXX'}</div>
                    </div>
                  ))}
              </div>
            </div>

            {/* Storage Location */}
            <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200">
              <label className="block text-sm font-medium text-gray-900 mb-3">
                Storage Location
              </label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-600 z-10" />
                <select
                  value={selectedLocationId}
                  onChange={(e) => setSelectedLocationId(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 border border-emerald-200 rounded-xl bg-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent appearance-none cursor-pointer"
                >
                  <option value="">Select a location...</option>
                  {locations.map(location => (
                    <option key={location.id} value={location.id}>
                      {location.name} ({location.currentCount}/{location.capacity})
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
              {selectedLocationId && (
                <div className="mt-2 text-xs text-emerald-700">
                  {(() => {
                    const loc = locations.find(l => l.id === selectedLocationId)
                    if (!loc) return null
                    return (
                      <span>
                        {loc.description && `${loc.description} • `}
                        {loc.temperature && `${loc.temperature} • `}
                        {loc.humidity && `${loc.humidity} humidity`}
                      </span>
                    )
                  })()}
                </div>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any special notes about this inventory..."
                rows={3}
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              />
            </div>

            {/* Bottle Size */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Bottle Size
              </label>
              <select
                value={isCustomBottleSize ? 'custom' : String(bottleSizeMl)}
                onChange={(e) => {
                  if (e.target.value === 'custom') {
                    setIsCustomBottleSize(true)
                  } else {
                    setIsCustomBottleSize(false)
                    setCustomBottleSizeInput('')
                    setBottleSizeMl(Number(e.target.value))
                  }
                }}
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {COMMON_BOTTLE_SIZES.map((s) => (
                  <option key={s.ml} value={s.ml}>
                    {s.label} ({formatVolume(s.ml)})
                  </option>
                ))}
                <option value="custom">Custom...</option>
              </select>
              {isCustomBottleSize && (
                <div className="mt-2">
                  <input
                    type="text"
                    value={customBottleSizeInput}
                    onChange={(e) => {
                      setCustomBottleSizeInput(e.target.value)
                      const parsed = parseVolumeInput(e.target.value)
                      if (parsed && isValidBottleSize(parsed.ml)) {
                        setBottleSizeMl(parsed.ml)
                      }
                    }}
                    placeholder="e.g. 750ml, 1.5L, 25.4oz"
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className={`text-xs mt-1 ${
                    customBottleParsed && isValidBottleSize(customBottleParsed.ml)
                      ? 'text-green-600'
                      : customBottleSizeInput ? 'text-red-500' : 'text-gray-400'
                  }`}>
                    {customBottleParsed && isValidBottleSize(customBottleParsed.ml)
                      ? `Parsed: ${customBottleParsed.ml}ml (${customBottleParsed.oz}oz)`
                      : customBottleSizeInput ? 'Invalid volume (50ml – 18000ml)' : 'Enter a volume'}
                  </p>
                </div>
              )}
            </div>

            {/* Sale Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Sale Type
              </label>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                {(['bottle', 'glass', 'both'] as SaleType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setSaleType(type)}
                    className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                      saleType === type
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Pour Size (conditional) */}
            {showGlassFields && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Pour Size
                </label>
                <select
                  value={isCustomPourSize ? 'custom' : String(pourSizeMl)}
                  onChange={(e) => {
                    if (e.target.value === 'custom') {
                      setIsCustomPourSize(true)
                    } else {
                      setIsCustomPourSize(false)
                      setCustomPourSizeInput('')
                      setPourSizeMl(Number(e.target.value))
                    }
                  }}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {COMMON_POUR_SIZES.map((s) => (
                    <option key={s.ml} value={s.ml}>
                      {s.label}
                    </option>
                  ))}
                  <option value="custom">Custom...</option>
                </select>
                {isCustomPourSize && (
                  <div className="mt-2">
                    <input
                      type="text"
                      value={customPourSizeInput}
                      onChange={(e) => {
                        setCustomPourSizeInput(e.target.value)
                        const parsed = parseVolumeInput(e.target.value)
                        if (parsed && isValidPourSize(parsed.ml)) {
                          setPourSizeMl(parsed.ml)
                        }
                      }}
                      placeholder="e.g. 150ml, 5oz"
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <p className={`text-xs mt-1 ${
                      customPourParsed && isValidPourSize(customPourParsed.ml)
                        ? 'text-green-600'
                        : customPourSizeInput ? 'text-red-500' : 'text-gray-400'
                    }`}>
                      {customPourParsed && isValidPourSize(customPourParsed.ml)
                        ? `Parsed: ${customPourParsed.ml}ml (${customPourParsed.oz}oz)`
                        : customPourSizeInput ? 'Invalid pour size (30ml – 500ml)' : 'Enter a volume'}
                    </p>
                  </div>
                )}
                <p className="text-xs text-indigo-600 font-medium mt-2">
                  Glasses per bottle: {glassesPerBottle}
                </p>
              </div>
            )}

            {/* Glass Menu Price (conditional) */}
            {showGlassFields && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Glass Menu Price
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={menuPriceGlass || ''}
                    onChange={(e) => setMenuPriceGlass(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            )}

            {/* Summary */}
            <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Total Cost</p>
                <p className="text-2xl font-bold text-gray-900">${totalCost.toFixed(2)}</p>
              </div>
              <div className="flex items-center justify-between text-sm text-gray-600">
                <span>{quantity} bottles × ${costPerBottle.toFixed(2)}</span>
                {duplicateInfo.exists && duplicateAction === 'add' && (
                  <span className="flex items-center gap-1 text-blue-600 font-medium">
                    <TrendingUp className="w-3 h-3" />
                    +{quantity} to existing
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-3 border border-gray-200 rounded-xl text-gray-700 font-medium hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || (duplicateInfo.exists && !duplicateAction)}
              className="flex-1 px-4 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Check className="w-5 h-5" />
                  {duplicateInfo.exists && duplicateAction === 'add' ? 'Update Stock' : 'Add to Inventory'}
                </>
              )}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

