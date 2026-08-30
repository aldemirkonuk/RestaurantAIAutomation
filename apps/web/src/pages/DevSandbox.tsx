/**
 * DevSandbox - Development Testing Page
 * 
 * A comprehensive testing environment for manually triggering:
 * - Toast notifications
 * - POS/Sales simulations
 * - Stock changes
 * - Inventory threshold alerts
 * - Reports refresh
 * - OneTap Action triggers
 */

import { useState } from 'react'
import { Header } from '../components/layout/Header'
import {
  Bell,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Info,
  Package,
  TrendingUp,
  TrendingDown,
  DollarSign,
  ShoppingCart,
  Truck,
  RefreshCw,
  Zap,
  Play,
  Settings,
} from 'lucide-react'
import { useToast } from '../contexts/ToastContext'
import { useRealtimeDispatch } from '../contexts/RealtimeContext'
import { wineLibrary, getLowStockWines } from '../data/wineData'
import { addOneTapAction } from '../components/notifications/OneTapActionCenter'

// Section component for organizing test groups
function Section({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-gray-100 rounded-lg">
          <Icon className="w-5 h-5 text-gray-600" />
        </div>
        <h3 className="font-semibold text-gray-900">{title}</h3>
      </div>
      <div className="space-y-3">
        {children}
      </div>
    </div>
  )
}

// Button component for test actions
function TestButton({ 
  label, 
  onClick, 
  variant = 'default',
  icon: Icon 
}: { 
  label: string
  onClick: () => void
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info'
  icon?: any
}) {
  const variantStyles = {
    default: 'bg-gray-100 hover:bg-gray-200 text-gray-700',
    success: 'bg-emerald-100 hover:bg-emerald-200 text-emerald-700',
    warning: 'bg-amber-100 hover:bg-amber-200 text-amber-700',
    danger: 'bg-rose-100 hover:bg-rose-200 text-rose-700',
    info: 'bg-blue-100 hover:bg-blue-200 text-blue-700',
  }

  return (
    <button
      onClick={onClick}
      className={`w-full px-4 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${variantStyles[variant]}`}
    >
      {Icon && <Icon className="w-4 h-4" />}
      {label}
    </button>
  )
}

export default function DevSandbox() {
  const toast = useToast()
  const { dispatchInventoryUpdate, dispatchOrderUpdate: _dispatchOrderUpdate, dispatchCalendarEvent } = useRealtimeDispatch()
  
  // State for POS simulation
  const [selectedWine, setSelectedWine] = useState(wineLibrary[0])
  const [saleQuantity, setSaleQuantity] = useState(1)
  
  // State for stock adjustment
  const [stockWine, setStockWine] = useState(wineLibrary[0])
  const [stockAdjustment, setStockAdjustment] = useState(5)
  const [stockType, setStockType] = useState<'live' | 'shadow'>('live')
  
  // Toast test handlers
  const handleSuccessToast = () => {
    toast.success('Operation completed successfully!', {
      description: 'Your changes have been saved.'
    })
  }
  
  const handleErrorToast = () => {
    toast.error('Something went wrong', {
      description: 'Please try again or contact support.'
    })
  }
  
  const handleWarningToast = () => {
    toast.warning('Low stock alert', {
      description: 'Caymus Cabernet is below threshold.'
    })
  }
  
  const handleInfoToast = () => {
    toast.info('New order received', {
      description: 'Order #1234 from Premium Wines.'
    })
  }
  
  // POS simulation handler
  const handlePOSSale = () => {
    if (!selectedWine) return
    
    // Dispatch inventory update (decrease stock)
    dispatchInventoryUpdate({
      type: 'stock_change',
      wineId: selectedWine.id,
      wineName: selectedWine.name,
      quantity: -saleQuantity,
      source: 'manual',
      timestamp: new Date().toISOString(),
      metadata: {
        action: 'pos_sale',
        pricePerBottle: selectedWine.price,
        totalRevenue: selectedWine.price * saleQuantity
      }
    })
    
    toast.success(`Sale processed: ${saleQuantity} x ${selectedWine.name}`, {
      description: `Total: $${(selectedWine.price * saleQuantity * 3).toFixed(2)}`
    })
  }
  
  // Stock adjustment handler
  const handleStockAdjustment = (direction: 'add' | 'remove') => {
    if (!stockWine) return
    
    const quantity = direction === 'add' ? stockAdjustment : -stockAdjustment
    
    dispatchInventoryUpdate({
      type: 'stock_change',
      wineId: stockWine.id,
      wineName: stockWine.name,
      quantity,
      source: 'manual',
      timestamp: new Date().toISOString(),
      metadata: {
        stockType,
        action: direction === 'add' ? 'manual_add' : 'manual_remove',
        reason: 'DevSandbox test'
      }
    })
    
    toast.info(`Stock ${direction === 'add' ? 'added' : 'removed'}: ${stockAdjustment} bottles`, {
      description: `${stockWine.name} (${stockType} stock)`
    })
  }
  
  // Low stock alert trigger
  const handleLowStockAlert = () => {
    const lowStockWines = getLowStockWines(wineLibrary)
    if (lowStockWines.length > 0) {
      const wine = lowStockWines[0]
      
      // Add to OneTap Action Center
      addOneTapAction({
        type: 'low_stock',
        priority: 'critical',
        title: `${wine.name} Low Stock Alert`,
        subtitle: `Only ${wine.liveStock || 0} bottles left • Threshold: ${wine.threshold}`,
        wine,
        details: {
          currentStock: wine.liveStock || 0,
          threshold: wine.threshold,
          suggestedOrder: Math.max(wine.threshold * 2 - (wine.liveStock || 0), 6),
          estimatedPrice: wine.price * Math.max(wine.threshold * 2 - (wine.liveStock || 0), 6)
        }
      })
      
      toast.warning('Low stock alert triggered!', {
        description: `${wine.name} added to OneTap Action Center`
      })
    } else {
      toast.info('No low stock wines found')
    }
  }
  
  // Delivery action trigger
  const handleDeliveryAction = () => {
    const wine = wineLibrary[Math.floor(Math.random() * 10)]
    const quantity = Math.floor(Math.random() * 18) + 6
    
    addOneTapAction({
      type: 'delivery_confirm',
      priority: 'high',
      title: `${wine.name} Delivery`,
      subtitle: `${quantity} bottles arrived • Verify & Confirm`,
      wine,
      details: {
        expectedQty: quantity,
        invoicePrice: wine.price * quantity,
        negotiatedPrice: wine.price * quantity * 0.95,
        supplier: wine.provider.name
      }
    })
    
    toast.success('Delivery action created!', {
      description: `${wine.name} - ${quantity} bottles`
    })
  }
  
  // Stock receipt action trigger
  const handleStockReceiptAction = () => {
    const wine = wineLibrary[Math.floor(Math.random() * 15)]
    const quantity = Math.floor(Math.random() * 24) + 6
    
    // Add to shadow stock
    try {
      const shadowData = localStorage.getItem('wineops_shadow_stock')
      const shadow = shadowData ? JSON.parse(shadowData) : {}
      shadow[wine.id] = {
        quantity,
        cost: wine.price * quantity,
        provider: wine.provider.name,
        orderId: `ORD-${Date.now()}`,
        timestamp: new Date().toISOString()
      }
      localStorage.setItem('wineops_shadow_stock', JSON.stringify(shadow))
    } catch {
      /* sandbox action best-effort */
    }
    
    addOneTapAction({
      type: 'stock_receipt',
      priority: 'high',
      title: 'Confirm Stock Receipt',
      subtitle: `${wine.name} • ${quantity} bottles in Shadow Stock`,
      wine,
      details: {
        quantity,
        cost: wine.price * quantity,
        supplier: wine.provider.name,
        orderId: `ORD-${Date.now()}`
      }
    })
    
    toast.success('Stock receipt action created!', {
      description: `${wine.name} - ${quantity} bottles added to shadow stock`
    })
  }
  
  // Price change action trigger
  const handlePriceChangeAction = () => {
    const wine = wineLibrary[Math.floor(Math.random() * 20)]
    const priceChange = Math.round((Math.random() * 20 - 10) * 100) / 100
    
    addOneTapAction({
      type: 'price_change',
      priority: priceChange > 5 ? 'high' : 'medium',
      title: 'Price Negotiation Result',
      subtitle: `${wine.name} - Supplier countered at $${(wine.price + priceChange).toFixed(2)}`,
      wine,
      details: {
        originalPrice: wine.price,
        counterPrice: wine.price + priceChange,
        deviation: ((priceChange / wine.price) * 100).toFixed(1),
        supplier: wine.provider.name
      }
    })
    
    toast.info('Price change action created!', {
      description: `${wine.name}: $${wine.price} → $${(wine.price + priceChange).toFixed(2)}`
    })
  }
  
  // Calendar event trigger
  const handleCalendarEvent = () => {
    const eventTypes = ['delivery', 'order', 'meeting', 'tasting'] as const
    const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)]
    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + Math.floor(Math.random() * 14) + 1)
    
    dispatchCalendarEvent({
      type: 'created',
      eventId: `event-${Date.now()}`,
      title: `Test ${eventType} Event`,
      eventType,
      date: futureDate.toISOString().split('T')[0],
      description: 'Created from DevSandbox',
      source: 'manual',
      timestamp: new Date().toISOString()
    })
    
    toast.success('Calendar event created!', {
      description: `${eventType} on ${futureDate.toLocaleDateString()}`
    })
  }
  
  // Reports refresh trigger
  const handleReportsRefresh = () => {
    // Trigger window event that Reports page listens to
    window.dispatchEvent(new CustomEvent('reports_refresh_requested'))
    toast.info('Reports refresh triggered!')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header 
        title="Dev Sandbox" 
        subtitle="Test environment for system events and triggers"
      />
      
      <div className="p-6">
        {/* Warning banner */}
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-900">Development Only</p>
            <p className="text-sm text-amber-700">This page is for testing purposes. Actions here will affect local data and trigger real UI updates.</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Toast Tests */}
          <Section title="Toast Notifications" icon={Bell}>
            <TestButton label="Success Toast" onClick={handleSuccessToast} variant="success" icon={CheckCircle} />
            <TestButton label="Error Toast" onClick={handleErrorToast} variant="danger" icon={AlertCircle} />
            <TestButton label="Warning Toast" onClick={handleWarningToast} variant="warning" icon={AlertTriangle} />
            <TestButton label="Info Toast" onClick={handleInfoToast} variant="info" icon={Info} />
          </Section>
          
          {/* POS Simulation */}
          <Section title="POS / Sales Simulation" icon={ShoppingCart}>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Select Wine</label>
                <select
                  value={selectedWine?.id || ''}
                  onChange={(e) => setSelectedWine(wineLibrary.find(w => w.id === e.target.value) || wineLibrary[0])}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                >
                  {wineLibrary.slice(0, 30).map(wine => (
                    <option key={wine.id} value={wine.id}>{wine.name} (${wine.price})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Quantity</label>
                <input
                  type="number"
                  min="1"
                  max="12"
                  value={saleQuantity}
                  onChange={(e) => setSaleQuantity(parseInt(e.target.value) || 1)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                />
              </div>
              <TestButton label="Process Sale" onClick={handlePOSSale} variant="success" icon={DollarSign} />
            </div>
          </Section>
          
          {/* Inventory Actions */}
          <Section title="Inventory Actions" icon={Package}>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Select Wine</label>
                <select
                  value={stockWine?.id || ''}
                  onChange={(e) => setStockWine(wineLibrary.find(w => w.id === e.target.value) || wineLibrary[0])}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                >
                  {wineLibrary.slice(0, 30).map(wine => (
                    <option key={wine.id} value={wine.id}>{wine.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Amount</label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={stockAdjustment}
                    onChange={(e) => setStockAdjustment(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Stock Type</label>
                  <select
                    value={stockType}
                    onChange={(e) => setStockType(e.target.value as 'live' | 'shadow')}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  >
                    <option value="live">Live Stock</option>
                    <option value="shadow">Shadow Stock</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <TestButton label="Add Stock" onClick={() => handleStockAdjustment('add')} variant="success" icon={TrendingUp} />
                <TestButton label="Remove Stock" onClick={() => handleStockAdjustment('remove')} variant="danger" icon={TrendingDown} />
              </div>
            </div>
          </Section>
          
          {/* OneTap Action Triggers */}
          <Section title="OneTap Action Triggers" icon={Zap}>
            <TestButton label="Create Low Stock Alert" onClick={handleLowStockAlert} variant="warning" icon={AlertTriangle} />
            <TestButton label="Create Delivery Action" onClick={handleDeliveryAction} variant="info" icon={Truck} />
            <TestButton label="Create Stock Receipt" onClick={handleStockReceiptAction} variant="success" icon={Package} />
            <TestButton label="Create Price Change" onClick={handlePriceChangeAction} variant="default" icon={DollarSign} />
          </Section>
          
          {/* Calendar & Reports */}
          <Section title="Calendar & Reports" icon={RefreshCw}>
            <TestButton label="Create Calendar Event" onClick={handleCalendarEvent} variant="info" icon={Play} />
            <TestButton label="Trigger Reports Refresh" onClick={handleReportsRefresh} variant="default" icon={RefreshCw} />
          </Section>
          
          {/* System Info */}
          <Section title="System Info" icon={Settings}>
            <div className="space-y-2 text-sm text-gray-600">
              <p><strong>Wine Library:</strong> {wineLibrary.length} wines</p>
              <p><strong>Low Stock Wines:</strong> {getLowStockWines(wineLibrary).length}</p>
              <p><strong>Local Storage Keys:</strong></p>
              <ul className="pl-4 text-xs space-y-1">
                <li>• wineops_pending_actions</li>
                <li>• wineops_shadow_stock</li>
                <li>• wineops_orders_history</li>
                <li>• wineops_storage_locations</li>
              </ul>
            </div>
            <TestButton 
              label="Clear All Local Data" 
              onClick={() => {
                if (confirm('Clear all local Mudavym data? This cannot be undone.')) {
                  localStorage.removeItem('wineops_pending_actions')
                  localStorage.removeItem('wineops_shadow_stock')
                  localStorage.removeItem('wineops_orders_history')
                  localStorage.removeItem('wineops_storage_locations')
                  localStorage.removeItem('wineops_wine_location_mappings')
                  toast.warning('All local data cleared!')
                  window.location.reload()
                }
              }} 
              variant="danger" 
              icon={AlertCircle} 
            />
          </Section>
        </div>
      </div>
    </div>
  )
}
