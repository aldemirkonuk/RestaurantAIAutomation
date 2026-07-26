import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '../../components/ui'
import {
  Plus,
  Minus,
  Search,
  Wine,
  X,
  ShoppingCart,
  Phone,
  RefreshCw,
  Check,
  Truck,
} from 'lucide-react'
import { Wine as WineType } from '../../data/wineData'
import type { Provider } from '../../services/api/providers'
import { formatVolume, bottlesToVolume } from '../../utils/volumeUtils'
import { useRestaurantSettingsStore } from '../../stores/restaurantSettingsStore'
import { calculateDeliveryDate, deliverySignal } from '../../utils/deliveryDateUtils'

interface CreateOrderItem {
  wineId: string
  wineName: string
  bottleSizeMl?: number
  quantity: number
  unitType: 'case' | 'bottle'
  bottlesPerCase?: number
  price: number
  providers: {
    primary: Provider | undefined
    alternatives: Provider[]
    selected: string[]
  }
  notes: string
}

interface Order {
  order_id: string
  wine_id: string
  wine_name?: string
  quantity: number
  provider_name?: string
  status: 'pending_approval' | 'approved' | 'ordered' | 'delivered' | 'cancelled'
  suggested_price?: number
  final_price?: number
  created_at: string
  approved_at?: string
  delivered_at?: string
  isRecurring?: boolean
  recurrence?: {
    frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly'
    nextOrderDate: string
    autoApprove: boolean
    isActive: boolean
  }
}

interface CreateOrderModalProps {
  isOpen: boolean
  onClose: () => void
  createOrderItems: CreateOrderItem[]
  filteredWines: WineType[]
  orders: Order[]
  providers: Provider[]
  wineSearch: string
  setWineSearch: (search: string) => void
  wineListLimit: number
  setWineListLimit: (limit: number | ((prev: number) => number)) => void
  winesPerPage: number
  isCreatingRecurring: boolean
  setIsCreatingRecurring: (value: boolean) => void
  recurringFrequency: 'daily' | 'weekly' | 'biweekly' | 'monthly'
  setRecurringFrequency: (freq: 'daily' | 'weekly' | 'biweekly' | 'monthly') => void
  recurringStartDate: string
  setRecurringStartDate: (date: string) => void
  recurringAutoApprove: boolean
  setRecurringAutoApprove: (value: boolean) => void
  onOpenWineConfig: (wine: WineType) => void
  onRemoveItem: (wineId: string) => void
  onUpdateItemQuantity: (wineId: string, delta: number) => void
  onEditItem: (item: CreateOrderItem) => void
  onContactProviders: () => void
  totalOrderValue: number
  isLoading?: boolean
}

export function CreateOrderModal({
  isOpen,
  onClose,
  createOrderItems,
  filteredWines,
  orders,
  providers,
  wineSearch,
  setWineSearch,
  wineListLimit,
  setWineListLimit,
  winesPerPage,
  isCreatingRecurring,
  setIsCreatingRecurring,
  recurringFrequency,
  setRecurringFrequency,
  recurringStartDate,
  setRecurringStartDate,
  recurringAutoApprove,
  setRecurringAutoApprove,
  onOpenWineConfig,
  onRemoveItem,
  onUpdateItemQuantity,
  onEditItem,
  onContactProviders,
  totalOrderValue,
  isLoading,
}: CreateOrderModalProps) {
  const { measurementUnit } = useRestaurantSettingsStore()
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="px-6 py-4 border-b bg-gradient-to-r from-wine-50 to-rose-50">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-xl ${isCreatingRecurring ? 'bg-blue-600' : 'bg-wine-600'}`}>
                    {isCreatingRecurring ? (
                      <RefreshCw className="w-5 h-5 text-white" />
                    ) : (
                      <ShoppingCart className="w-5 h-5 text-white" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">
                      Create {isCreatingRecurring ? 'Recurring' : 'New'} Order
                    </h3>
                    <p className="text-sm text-gray-500">
                      {isCreatingRecurring ? 'Set up automated wine orders' : 'Click wines to configure and add to order'}
                    </p>
                  </div>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
              
              {/* Recurring Toggle */}
              <div className="flex items-center gap-3 bg-white rounded-lg p-3 border border-gray-200" data-tour="orders-create-recurring">
                <button
                  onClick={() => setIsCreatingRecurring(!isCreatingRecurring)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    isCreatingRecurring ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      isCreatingRecurring ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">Make this a recurring order</p>
                  <p className="text-xs text-gray-500">Automatically reorder on a schedule</p>
                </div>
                {isCreatingRecurring && (
                  <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded-full">
                    Recurring
                  </span>
                )}
              </div>
              
              {/* Recurring Options */}
              {isCreatingRecurring && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  className="mt-3 bg-blue-50 rounded-lg p-4 border border-blue-200"
                >
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">Frequency</label>
                      <select
                        value={recurringFrequency}
                        onChange={(e) => setRecurringFrequency(e.target.value as any)}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="biweekly">Bi-weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">Start Date</label>
                      <input
                        type="date"
                        value={recurringStartDate}
                        onChange={(e) => setRecurringStartDate(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 mt-3">
                    <input
                      type="checkbox"
                      checked={recurringAutoApprove}
                      onChange={(e) => setRecurringAutoApprove(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Auto-approve orders (skip manual approval)</span>
                  </label>
                </motion.div>
              )}
            </div>

            <div className="flex-1 overflow-hidden flex">
              {/* Wine Selection */}
              <div className="flex-1 border-r border-gray-200 overflow-hidden flex flex-col" data-tour="orders-create-wines">
                <div className="p-4 border-b border-gray-100">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search wines..."
                      value={wineSearch}
                      onChange={(e) => {
                        setWineSearch(e.target.value)
                        setWineListLimit(20)
                      }}
                      className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                    />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                    <span>Showing {Math.min(wineListLimit, filteredWines.length)} of {filteredWines.length} wines</span>
                    {filteredWines.length > wineListLimit && (
                      <button 
                        onClick={() => setWineListLimit(filteredWines.length)}
                        className="text-wine-600 hover:text-wine-700 font-medium"
                      >
                        Show all
                      </button>
                    )}
                  </div>
                  
                  {filteredWines.slice(0, wineListLimit).map((wine) => {
                    const isInOrder = createOrderItems.some(item => item.wineId === wine.id)
                    const hasRecurringOrder = orders.some(o => o.isRecurring && o.wine_id === wine.id && o.recurrence?.isActive)
                    
                    return (
                      <div key={wine.id} className="relative group">
                        <button
                          onClick={() => onOpenWineConfig(wine)}
                          className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left ${
                            isInOrder 
                              ? 'bg-wine-100 border-2 border-wine-300' 
                              : 'bg-gray-50 hover:bg-wine-50 border-2 border-transparent'
                          }`}
                        >
                          <div className={`p-2 rounded-lg ${isInOrder ? 'bg-wine-200' : 'bg-wine-100'}`}>
                            <Wine className="w-4 h-4 text-wine-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-gray-900 truncate">
                                {wine.name}
                                <span className="text-gray-400 text-xs font-normal ml-1">
                                  · {formatVolume(wine.bottleSizeMl ?? 750, measurementUnit)}
                                </span>
                              </p>
                              {hasRecurringOrder && (
                                <div className="relative">
                                  <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-bold flex items-center gap-1 cursor-help">
                                    <RefreshCw className="w-2.5 h-2.5" />
                                    R
                                  </span>
                                  <div className="absolute left-0 top-full mt-1 hidden group-hover:block z-50">
                                    <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg whitespace-nowrap">
                                      <div className="flex items-center gap-1.5 mb-1">
                                        <RefreshCw className="w-3 h-3" />
                                        <span className="font-semibold">Recurring Wine Order</span>
                                      </div>
                                      <p className="text-gray-300">This wine has an active recurring order</p>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                            <p className="text-xs text-gray-500">{wine.producer} · ${wine.price}</p>
                          </div>
                          {isInOrder ? (
                            <Check className="w-5 h-5 text-wine-600" />
                          ) : (
                            <Plus className="w-4 h-4 text-gray-400" />
                          )}
                        </button>
                      </div>
                    )
                  })}
                  
                  {filteredWines.length > wineListLimit && (
                    <button
                      onClick={() => setWineListLimit((prev: number) => Math.min(prev + winesPerPage, filteredWines.length))}
                      className="w-full py-3 mt-2 text-sm font-medium text-wine-600 bg-wine-50 hover:bg-wine-100 rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Load More ({Math.min(winesPerPage, filteredWines.length - wineListLimit)} more)
                    </button>
                  )}
                  
                  {filteredWines.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      <Wine className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                      <p className="font-medium">No wines found</p>
                      <p className="text-sm">Try adjusting your search</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Order Summary */}
              <div className="w-80 flex flex-col" data-tour="orders-create-summary">
                <div className="p-4 border-b border-gray-100">
                  <h4 className="font-semibold text-gray-900">Order Summary</h4>
                  <p className="text-sm text-gray-500">{createOrderItems.length} wines</p>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {createOrderItems.length === 0 ? (
                    <div className="text-center py-8">
                      <ShoppingCart className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm text-gray-500">Click wines to configure</p>
                    </div>
                  ) : (
                    createOrderItems.map((item) => (
                      <div key={item.wineId} className="p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-start justify-between mb-2">
                          <p className="font-medium text-gray-900 text-sm">
                            {item.wineName}
                            <span className="text-gray-400 text-xs font-normal ml-1">
                              · {formatVolume(item.bottleSizeMl || 750, measurementUnit)}
                            </span>
                          </p>
                          <button
                            onClick={() => onRemoveItem(item.wineId)}
                            className="p-1 hover:bg-gray-200 rounded"
                          >
                            <X className="w-3 h-3 text-gray-400" />
                          </button>
                        </div>
                        <p className="text-xs text-gray-500 mb-1">
                          {item.providers.selected.length} provider{item.providers.selected.length > 1 ? 's' : ''}
                        </p>
                        <div className="flex flex-wrap gap-1 mb-2">
                          {item.providers.selected.map(id => {
                            const provider = providers.find(p => p.id === id)
                            if (!provider) return null
                            const result = calculateDeliveryDate(
                              new Date(),
                              (provider as any).regionsCovered || provider.statesOrRegionsServed || [],
                              (provider as any).leadTimeDays || 3,
                            )
                            const sig = deliverySignal(result)
                            return (
                              <div key={id} className="flex items-center gap-1.5 w-full">
                                <span className="text-[10px] px-1.5 py-0.5 bg-wine-100 text-wine-700 rounded truncate max-w-[80px] font-medium">
                                  {provider.name.split(' ').map(w => w[0]).join('').slice(0, 3).toUpperCase()}
                                </span>
                                <span className={`text-[10px] flex items-center gap-0.5 ${sig.colorClass}`}>
                                  <Truck className="w-2.5 h-2.5 inline-block mr-0.5" />
                                  {sig.icon} {sig.text}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => onUpdateItemQuantity(item.wineId, -1)}
                              className="p-1 hover:bg-gray-200 rounded"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="text-sm font-medium w-8 text-center">{item.quantity}</span>
                            <button
                              onClick={() => onUpdateItemQuantity(item.wineId, 1)}
                              className="p-1 hover:bg-gray-200 rounded"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                          <span className="text-sm font-semibold text-gray-900">
                            ${(item.price * item.quantity).toLocaleString()}
                          </span>
                        </div>
                        <button
                          onClick={() => onEditItem(item)}
                          className="mt-2 w-full py-1 text-xs text-wine-600 hover:bg-wine-50 rounded transition-colors"
                        >
                          Edit Configuration
                        </button>
                      </div>
                    ))
                  )}
                </div>
                {createOrderItems.length > 0 && (() => {
                  // Compute earliest delivery across all selected providers
                  const allProviderIds = [...new Set(createOrderItems.flatMap(i => i.providers.selected))]
                  const deliveryDates = allProviderIds
                    .map(id => providers.find(p => p.id === id))
                    .filter(Boolean)
                    .map(p => calculateDeliveryDate(
                      new Date(),
                      (p as any).regionsCovered || p!.statesOrRegionsServed || [],
                      (p as any).leadTimeDays || 3,
                    ).date)
                    .filter((d): d is Date => d !== null)
                  const earliestDelivery = deliveryDates.length
                    ? deliveryDates.reduce((a, b) => (a < b ? b : a))  // latest of all providers = when order can be complete
                    : null
                  return (
                  <div className="p-4 border-t border-gray-200 bg-gray-50">
                    {earliestDelivery && (
                      <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                        <Truck className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                        <div>
                          <p className="text-[11px] font-semibold text-emerald-800">Order complete by</p>
                          <p className="text-xs text-emerald-700">{earliestDelivery.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-gray-900">Total</span>
                      <span className="text-xl font-bold text-wine-600">
                        ${totalOrderValue.toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mb-4">
                      {createOrderItems.reduce((s, i) => s + i.quantity, 0)} bottles
                      {' = '}
                      {formatVolume(
                        createOrderItems.reduce(
                          (s, i) => s + bottlesToVolume(i.quantity, i.bottleSizeMl || 750),
                          0
                        ),
                        measurementUnit
                      )}
                    </p>
                    <Button
                      variant="default"
                      onClick={onContactProviders}
                      disabled={isLoading}
                      data-tour="orders-create-submit"
                      className="w-full bg-wine-600 hover:bg-wine-700 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isLoading ? (
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Phone className="w-4 h-4 mr-2" />
                      )}
                      {isLoading ? 'Creating Orders…' : 'Contact Providers'}
                    </Button>
                  </div>
                  )
                })()}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
