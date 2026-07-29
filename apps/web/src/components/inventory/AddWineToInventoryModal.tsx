import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  X,
  Search,
  Camera,
  Wine,
  Plus,
  Check,
  Sparkles,
  MapPin,
  Save,
  Minus,
} from 'lucide-react'
import { Wine as WineType, getWineTypeColor } from '../../data/wineData'
import { useWines } from '../../hooks/queries'
import { mapApiWinesToUiWines } from '../../lib/wine-library'
import { AddWineModal } from '../wines/AddWineModal'
import { MenuScannerFlow } from '../scanner/MenuScannerFlow'
import { summarizeMenuScanPersist } from '../../lib/menuScannerPersistence'
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
import { useRestaurantSettingsStore } from '../../stores/restaurantSettingsStore'

type TabType = 'search' | 'photo'

interface VolumeFields {
  bottleSizeMl: number
  saleType: SaleType
  pourSizeMl?: number
  menuPriceGlass?: number
  costPerBottle?: number
  /**
   * Free/comp bottle (distributor tasting sample, staff gift, etc.). The caller maps
   * this to `costProvenance: 'sample'` with a cost of $0, which the WAC rollup
   * excludes — the bottles count as stock, never toward average cost.
   */
  isSample?: boolean
}

interface AddWineToInventoryModalProps {
  isOpen: boolean
  onClose: () => void
  onAddWine: (wine: WineType, quantity: number, threshold: number, storageLocationId?: string, volumeFields?: VolumeFields) => void
}

export function AddWineToInventoryModal({ isOpen, onClose, onAddWine }: AddWineToInventoryModalProps) {
  const { measurementUnit } = useRestaurantSettingsStore()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<TabType>('search')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedWine, setSelectedWine] = useState<WineType | null>(null)
  const [quantity, setQuantity] = useState<number>(1)
  const [threshold, setThreshold] = useState<number>(10)
  const [costPerBottle, setCostPerBottle] = useState<number>(0)
  const [isSample, setIsSample] = useState(false)
  const [showPhotoModal, setShowPhotoModal] = useState(false)
  const [showScannerFlow, setShowScannerFlow] = useState(false)
  const [detectedWine, setDetectedWine] = useState<WineType | null>(null)
  const [selectedStorageLocationId, setSelectedStorageLocationId] = useState<string | undefined>(undefined)
  const { locations: storageLocations } = useStorageLocations()

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

  // Filter wines for search - SHOW ALL 200 WINES
  const { data: apiWines = [] } = useWines({
    search: searchQuery || undefined,
    limit: 200,
  })

  const filteredWines = useMemo(() => {
    const uiWines = mapApiWinesToUiWines(apiWines)
    if (!searchQuery) return uiWines
    const query = searchQuery.toLowerCase()
    return uiWines.filter(wine =>
      wine.name.toLowerCase().includes(query) ||
      wine.producer.toLowerCase().includes(query) ||
      wine.grape.toLowerCase().includes(query) ||
      wine.region.toLowerCase().includes(query) ||
      wine.country.toLowerCase().includes(query) ||
      wine.type.toLowerCase().includes(query)
    )
  }, [apiWines, searchQuery])

  const handleClose = () => {
    setActiveTab('search')
    setSearchQuery('')
    setSelectedWine(null)
    setDetectedWine(null)
    setQuantity(1)
    setThreshold(10)
    setCostPerBottle(0)
    setIsSample(false)
    setSelectedStorageLocationId(undefined)
    setBottleSizeMl(750)
    setCustomBottleSizeInput('')
    setIsCustomBottleSize(false)
    setSaleType('bottle')
    setPourSizeMl(150)
    setCustomPourSizeInput('')
    setIsCustomPourSize(false)
    setMenuPriceGlass(0)
    setShowPhotoModal(false)
    onClose()
  }

  const handleSelectWine = (wine: WineType) => {
    setSelectedWine(wine)
    setQuantity(wine.liveStock || 1)
    setThreshold(wine.threshold || 10)
    setCostPerBottle(wine.price || 0)
    setIsSample(false)
  }

  const handleAddToInventory = () => {
    if (selectedWine) {
      const volumeFields: VolumeFields = {
        bottleSizeMl,
        saleType,
        ...(showGlassFields && { pourSizeMl, menuPriceGlass }),
        // A sample carries a real $0, not an absent cost. The caller turns this flag
        // into costProvenance 'sample', which the WAC rollup excludes by name — so a
        // free bottle stays distinguishable from one whose price was never entered.
        ...(isSample ? { isSample: true, costPerBottle: 0 } : { costPerBottle }),
      }
      onAddWine(selectedWine, quantity, threshold, selectedStorageLocationId, volumeFields)
      handleClose()
    }
  }

  const handlePhotoWineDetected = (result: any) => {
    // Convert detection result to Wine format
    const newWine: WineType = {
      id: `WINE_${Date.now()}`,
      name: result.name || 'Unknown Wine',
      producer: result.producer || 'Unknown Producer',
      vintage: result.vintage || null,
      type: result.type || 'red',
      grape: result.grape || 'Unknown',
      country: result.country || 'Unknown',
      region: result.region || 'Unknown',
      appellation: result.appellation || result.region || 'Unknown',
      body: result.body || 'medium',
      sweetness: result.sweetness || 'dry',
      acidity: result.acidity || 'medium',
      alcohol: result.alcohol || 0,
      aromas: result.aromas || [],
      flavors: result.flavors || [],
      price: result.suggestedPrice || 0,
      liveStock: null, // Will be set when added to inventory
      threshold: 10, // Default threshold
      bottleSizeMl: 750, // Standard bottle size
      provider: {
        name: 'TBD',
        contact: 'N/A',
        phone: 'N/A',
      },
    }
    // Select the detected wine for configuration (keep photo tab active)
    setDetectedWine(newWine)
    setSelectedWine(newWine)
    setQuantity(1)
    setThreshold(10)
    setShowPhotoModal(false)
    // Keep photo tab active to show the detected wine
  }

  if (!isOpen) return null

  return (
    <>
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-wine-50 to-wine-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-wine-600 rounded-xl">
                  <Plus className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Add Wine to Inventory</h2>
                  <p className="text-sm text-gray-500">Choose from master library or scan a new wine</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="p-2 hover:bg-white/50 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 bg-gray-50">
              <button
                onClick={() => setActiveTab('search')}
                className={`flex-1 flex items-center justify-center gap-2 px-6 py-4 font-medium transition-all ${
                  activeTab === 'search'
                    ? 'bg-white text-wine-600 border-b-2 border-wine-600'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <Search className="w-5 h-5" />
                <span>Search Master Library</span>
                <span className="ml-2 px-2 py-0.5 bg-wine-100 text-wine-700 text-xs font-semibold rounded-full">
                  {filteredWines.length}
                </span>
              </button>
              <button
                onClick={() => setActiveTab('photo')}
                className={`flex-1 flex items-center justify-center gap-2 px-6 py-4 font-medium transition-all ${
                  activeTab === 'photo'
                    ? 'bg-white text-wine-600 border-b-2 border-wine-600'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <Camera className="w-5 h-5" />
                <span>Scan Wine Label</span>
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden flex">
              {/* Search Tab */}
              {activeTab === 'search' && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* Search Bar */}
                  <div className="p-4 border-b border-gray-100">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search wines, producers, regions, grapes..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent outline-none"
                        autoFocus
                      />
                    </div>
                  </div>

                  {/* Wine List */}
                  <div className="flex-1 overflow-y-auto p-4">
                    {filteredWines.length === 0 ? (
                      <div className="text-center py-12">
                        <Search className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                        <p className="text-gray-500">No wines found matching "{searchQuery}"</p>
                        <p className="text-sm text-gray-400 mt-1">Try a different search term</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {filteredWines.map((wine) => {
                          const typeColors = getWineTypeColor(wine.type)
                          const isSelected = selectedWine?.id === wine.id
                          
                          return (
                            <button
                              key={wine.id}
                              onClick={() => handleSelectWine(wine)}
                              className={`p-4 rounded-xl border-2 text-left transition-all ${
                                isSelected
                                  ? 'border-wine-500 bg-wine-50 shadow-lg'
                                  : 'border-gray-200 hover:border-wine-300 hover:bg-gray-50'
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <div className={`w-12 h-16 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                  isSelected ? 'ring-2 ring-wine-500' : ''
                                }`}>
                                  <Wine className={`w-6 h-6 ${isSelected ? 'text-wine-600' : 'text-gray-400'}`} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start justify-between gap-2 mb-1">
                                    <h3 className={`font-semibold text-sm truncate ${
                                      isSelected ? 'text-wine-900' : 'text-gray-900'
                                    }`}>
                                      {wine.name}
                                    </h3>
                                    {isSelected && (
                                      <Check className="w-5 h-5 text-wine-600 flex-shrink-0" />
                                    )}
                                  </div>
                                  <p className="text-xs text-gray-500 mb-2">{wine.producer} · {wine.vintage || 'NV'}</p>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeColors.bg} ${typeColors.text}`}>
                                      {wine.type}
                                    </span>
                                    <span className="text-xs text-gray-500 flex items-center gap-1">
                                      <MapPin className="w-3 h-3" />
                                      {wine.region}, {wine.country}
                                    </span>
                                  </div>
                                  <p className="text-xs text-gray-500 mt-2">${wine.price}/bottle</p>
                                </div>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Photo Tab */}
              {activeTab === 'photo' && !detectedWine && (
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                  <div className="text-center max-w-md">
                    <div className="w-20 h-20 bg-wine-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                      <Camera className="w-10 h-10 text-wine-600" />
                    </div>
                    <h3 className="text-xl font-semibold text-gray-900 mb-2">Scan Wine Label</h3>
                    <p className="text-gray-500 mb-6">
                      Use AI to automatically identify wine details from a photo of the label
                    </p>
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => setShowScannerFlow(true)}
                        className="px-6 py-3 bg-wine-600 text-white font-medium rounded-xl hover:bg-wine-700 shadow-lg shadow-wine-600/30 transition-all flex items-center gap-2 mx-auto"
                      >
                        <Camera className="w-5 h-5" />
                        Open Camera / Upload Image
                      </button>
                      <button
                        onClick={() => setShowPhotoModal(true)}
                        className="px-4 py-2 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-xl hover:bg-gray-100 transition-all flex items-center gap-2 mx-auto"
                      >
                        <Sparkles className="w-4 h-4" />
                        Single Wine Label Scan
                      </button>
                    </div>
                    <div className="mt-6 p-4 bg-purple-50 border border-purple-100 rounded-xl">
                      <div className="flex items-start gap-3">
                        <Sparkles className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
                        <div className="text-left">
                          <p className="font-medium text-gray-900 text-sm">AI Menu Scanner (4-Layer Pipeline)</p>
                          <p className="text-xs text-gray-600 mt-1">
                            YOLOv8 detection + Multi-language OCR + Gemini Pro parser + Master Library matching.
                            Scan full menus or individual wine labels with real-time camera detection.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Photo Tab - After Detection (when sidebar is showing) */}
              {activeTab === 'photo' && selectedWine && detectedWine && (
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                  <div className="text-center max-w-md">
                    <div className="w-20 h-20 bg-purple-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                      <Check className="w-10 h-10 text-purple-600" />
                    </div>
                    <h3 className="text-xl font-semibold text-gray-900 mb-2">Wine Detected Successfully!</h3>
                    <p className="text-gray-500 mb-4">
                      Configure inventory settings in the sidebar on the right →
                    </p>
                    <button
                      onClick={() => setShowPhotoModal(true)}
                      className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium"
                    >
                      Scan Another Wine
                    </button>
                  </div>
                </div>
              )}

              {/* Selected Wine Configuration Sidebar - Shows when wine is selected */}
              {selectedWine && (
                <div className="w-96 border-l border-gray-200 bg-gray-50 flex flex-col">
                  <div className="p-4 border-b border-gray-200 bg-white">
                    <h3 className="font-semibold text-gray-900 mb-1">Configure Inventory</h3>
                    <p className="text-sm text-gray-500">{selectedWine.name}</p>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {/* Wine Preview */}
                    <div className="p-4 bg-white rounded-xl border border-gray-200">
                      <div className="flex items-center gap-3 mb-3">
                        <div className={`w-12 h-16 rounded-lg flex items-center justify-center ${
                          detectedWine ? 'bg-purple-100' : 'bg-gray-100'
                        }`}>
                          <Wine className={`w-6 h-6 ${detectedWine ? 'text-purple-600' : 'text-gray-400'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-semibold text-gray-900 text-sm truncate">{selectedWine.name}</p>
                            {detectedWine && (
                              <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-[10px] font-medium">
                                AI Detected
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500">{selectedWine.producer}</p>
                          <p className="text-xs text-gray-500">{selectedWine.vintage || 'NV'} · {selectedWine.country}</p>
                        </div>
                      </div>
                    </div>

                    {/* Quantity */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Initial Quantity
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setQuantity(Math.max(0, quantity - 1))}
                          className="p-2 border border-gray-200 rounded-lg hover:bg-gray-100"
                        >
                          <Minus className="w-4 h-4 text-gray-600" />
                        </button>
                        <input
                          type="number"
                          value={quantity}
                          onChange={(e) => setQuantity(Math.max(0, parseInt(e.target.value) || 0))}
                          className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-center font-medium focus:ring-2 focus:ring-wine-500"
                        />
                        <button
                          onClick={() => setQuantity(quantity + 1)}
                          className="p-2 border border-gray-200 rounded-lg hover:bg-gray-100"
                        >
                          <Plus className="w-4 h-4 text-gray-600" />
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Current stock level</p>
                    </div>

                    {/* Cost per bottle / sample toggle */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-medium text-gray-700">Cost per Bottle</label>
                        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={isSample}
                            onChange={(e) => setIsSample(e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-gray-300 text-wine-600 focus:ring-wine-500 cursor-pointer"
                          />
                          Free sample
                        </label>
                      </div>
                      {isSample ? (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                          Marked as a free/comp bottle — no cost is recorded, so it won't skew your average cost (WAC) or value-on-hand.
                        </p>
                      ) : (
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={costPerBottle || ''}
                            onChange={(e) => setCostPerBottle(Math.max(0, parseFloat(e.target.value) || 0))}
                            placeholder="0.00"
                            className="w-full pl-7 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                          />
                        </div>
                      )}
                    </div>

                    {/* Threshold */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Minimum Threshold
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setThreshold(Math.max(1, threshold - 1))}
                          className="p-2 border border-gray-200 rounded-lg hover:bg-gray-100"
                        >
                          <Minus className="w-4 h-4 text-gray-600" />
                        </button>
                        <input
                          type="number"
                          value={threshold}
                          onChange={(e) => setThreshold(Math.max(1, parseInt(e.target.value) || 1))}
                          className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-center font-medium focus:ring-2 focus:ring-wine-500"
                        />
                        <button
                          onClick={() => setThreshold(threshold + 1)}
                          className="p-2 border border-gray-200 rounded-lg hover:bg-gray-100"
                        >
                          <Plus className="w-4 h-4 text-gray-600" />
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Alert when stock falls below this</p>
                    </div>

                    {/* Quick Presets */}
                    <div>
                      <p className="text-xs text-gray-500 mb-2">Quick Threshold Presets</p>
                      <div className="grid grid-cols-3 gap-2">
                        {[5, 10, 20].map((preset) => (
                          <button
                            key={preset}
                            onClick={() => setThreshold(preset)}
                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                              threshold === preset
                                ? 'bg-wine-600 text-white'
                                : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Storage Location */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-gray-600" />
                        Storage Location
                      </label>
                      <select
                        value={selectedStorageLocationId || ''}
                        onChange={(e) => setSelectedStorageLocationId(e.target.value || undefined)}
                        className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                      >
                        <option value="">Select a location...</option>
                        {storageLocations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name} ({loc.currentCount}/{loc.capacity})
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-500 mt-1">Physical location in cellar/storage</p>
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
                        className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                      >
                        {COMMON_BOTTLE_SIZES.map((s) => (
                          <option key={s.ml} value={s.ml}>
                            {s.label} ({formatVolume(s.ml, measurementUnit)})
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
                            className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
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
                            className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
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
                          className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
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
                              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
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
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={menuPriceGlass || ''}
                            onChange={(e) => setMenuPriceGlass(parseFloat(e.target.value) || 0)}
                            placeholder="0.00"
                            className="w-full pl-7 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="p-4 border-t border-gray-200 bg-white">
                    <button
                      onClick={handleAddToInventory}
                      className="w-full px-4 py-3 bg-wine-600 text-white font-medium rounded-xl hover:bg-wine-700 shadow-lg shadow-wine-600/30 transition-all flex items-center justify-center gap-2"
                    >
                      <Save className="w-5 h-5" />
                      Add to Inventory
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>

      {/* Photo Upload Modal - Rendered via Portal to ensure it appears above parent modal */}
      {typeof document !== 'undefined' && showPhotoModal && createPortal(
        <AddWineModal
          isOpen={showPhotoModal}
          onClose={() => setShowPhotoModal(false)}
          onSave={(result) => {
            handlePhotoWineDetected(result)
          }}
          zIndex={60}
        />,
        document.body
      )}

      {/* Full Menu Scanner Flow - Camera + YOLO + Results */}
      {typeof document !== 'undefined' && showScannerFlow && createPortal(
        <MenuScannerFlow
          isOpen={showScannerFlow}
          onClose={() => setShowScannerFlow(false)}
          onWinesAdded={(_wines, result) => {
            // The scanner's batch step already wrote these rows; reporting is all
            // that's left, so this must not persist a second time.
            if (!result) return
            toast.success(`Menu scan: ${summarizeMenuScanPersist(result)}`, {
              description:
                result.provisional.length > 0
                  ? `${result.provisional.map((r) => r.wineName).join(', ')} — added to the Master Wine Library as provisional entries.`
                  : undefined,
            })
            queryClient.invalidateQueries({ queryKey: ['inventory'] })
          }}
        />,
        document.body
      )}
    </>
  )
}

