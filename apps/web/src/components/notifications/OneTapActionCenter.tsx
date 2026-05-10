/**
 * ONE-TAP ACTION CENTER
 * 
 * This is the CRITICAL component for WineOps AI.
 * Per Blueprint requirements:
 * - Human-in-the-loop for all critical decisions
 * - One-tap actions for: Approve/Reject orders, stock corrections, price acceptance
 * - No autonomous purchasing without manager approval
 */

import { useState, useMemo, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertTriangle,
  Check,
  X,
  Package,
  DollarSign,
  Truck,
  Wine,
  Plus,
  Clock,
  ChevronRight,
  Bell,
  Zap,
  RefreshCw,
  Filter,
  CheckSquare,
  Square,
  Command,
  Sparkles,
  Mail,
  Send,
} from 'lucide-react'
import { getWineTypeColor, Wine as WineType } from '../../data/wineData'
import { QuickGmailModal } from '../emails/QuickGmailModal'
import { useRealtimeDispatch } from '../../contexts/RealtimeContext'
import { getOrdersNeedingApproval, getOrders } from '../../services/api/orders'
import type { Order } from '../../services/api/types'
import { useAuthStore } from '../../stores'
import { useWines } from '../../hooks/queries'
import { mapApiWinesToUiWines } from '../../lib/wine-library'
import { useInventoryData } from '../../hooks/useInventoryData'

export interface ActionItem {
  id: string
  type: 'low_stock' | 'price_change' | 'delivery_confirm' | 'inequality' | 'vintage_sub' | 'stock_receipt' | 'gmail_send' | 'gmail_contextual'
  priority: 'critical' | 'high' | 'medium'
  title: string
  subtitle: string
  wine?: WineType
  details: Record<string, any>
  timestamp: Date
}

// Helper function to add a new action (can be called from anywhere)
export function addOneTapAction(action: Omit<ActionItem, 'id' | 'timestamp'>): void {
  const newAction: ActionItem = {
    ...action,
    id: `action_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    timestamp: new Date()
  }
  
  const stored = loadPersistedActions()
  stored.unshift(newAction)
  saveActionsToStorage(stored)
  
  // Dispatch event to notify components
  window.dispatchEvent(new CustomEvent('onetap_action_added', { detail: newAction }))
}

// Storage keys for persisted actions
const ACTIONS_STORAGE_KEY = 'wineops_pending_actions'
const SHADOW_STOCK_KEY = 'wineops_shadow_stock'
const PENDING_ORDERS_KEY = 'wineops_orders_history'

// Load persisted actions from localStorage
function loadPersistedActions(): ActionItem[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = localStorage.getItem(ACTIONS_STORAGE_KEY)
    if (stored) {
      const actions = JSON.parse(stored)
      // Convert timestamps back to Date objects
      return actions.map((a: any) => ({ ...a, timestamp: new Date(a.timestamp) }))
    }
  } catch {}
  return []
}

// Save actions to localStorage
function saveActionsToStorage(actions: ActionItem[]): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(ACTIONS_STORAGE_KEY, JSON.stringify(actions))
}

// Generate real actions from data sources
function generateRealActions(
  wines: WineType[],
  lowStockItems: Array<{ wineId?: string; wineName?: string; stockLive?: number; thresholdMin?: number; thresholdMax?: number; providerName?: string }>,
  apiOrders: Order[] = [],
): ActionItem[] {
  const actions: ActionItem[] = []
  const now = new Date()
  
  // 1. Low Stock Alerts - from actual wine inventory
  lowStockItems.slice(0, 5).forEach((item, index) => {
    const wine = wines.find(w => w.id === item.wineId)
    const stock = item.stockLive || 0
    const threshold = item.thresholdMin ?? wine?.threshold ?? 6
    const isCritical = stock <= threshold * 0.5
    actions.push({
      id: `low_stock_${item.wineId || item.wineName || index}`,
      type: 'low_stock',
      priority: isCritical ? 'critical' : 'high',
      title: wine?.name || item.wineName || 'Low stock wine',
      subtitle: `Only ${stock} bottles left • Threshold: ${threshold}`,
      wine,
      details: { 
        currentStock: stock, 
        threshold, 
        suggestedOrder: Math.max(threshold * 2 - stock, 6),
        estimatedPrice: (wine?.price || 0) * Math.max(threshold * 2 - stock, 6),
      },
      timestamp: new Date(now.getTime() - (index + 1) * 1000 * 60 * 5),
    })
  })
  
  // 2. Shadow Stock Reconciliation - check for wines with shadow stock > 0
  try {
    const shadowStockData = localStorage.getItem(SHADOW_STOCK_KEY)
    if (shadowStockData) {
      const shadowItems = JSON.parse(shadowStockData)
      Object.entries(shadowItems).slice(0, 3).forEach(([wineId, data]: [string, any], index) => {
        if (data.quantity > 0) {
          const wine = wines.find(w => w.id === wineId)
          actions.push({
            id: `stock_receipt_${wineId}`,
            type: 'stock_receipt',
            priority: 'high',
            title: 'Confirm Stock Receipt',
            subtitle: `${wine?.name || 'Wine'} • ${data.quantity} bottles in Shadow Stock`,
            wine,
            details: { 
              quantity: data.quantity, 
              cost: data.cost || (wine?.price || 0) * data.quantity, 
              supplier: data.provider || 'Unknown Supplier',
              orderId: data.orderId || 'N/A'
            },
            timestamp: new Date(data.timestamp || now.getTime() - (index + 1) * 1000 * 60 * 10),
          })
        }
      })
    }
  } catch {}
  
  // 3. Pending Orders - from API (passed in) or fallback to localStorage
  const ordersToProcess = apiOrders.length > 0 ? apiOrders : []
  
  // If API orders are available, use them
  if (ordersToProcess.length > 0) {
    ordersToProcess
      .filter((o) => o.status === 'approved' || o.status === 'in_transit' || o.status === 'APPROVED')
      .slice(0, 3)
      .forEach((order, index: number) => {
        const wine = wines.find(w => w.id === order.wineId)
        actions.push({
          id: `delivery_${order.id}`,
          type: 'delivery_confirm',
          priority: 'high',
          title: `${order.wineName || wine?.name || 'Wine'} Delivery`,
          subtitle: `${order.quantity} bottles • Verify & Confirm`,
          wine,
          details: { 
            expectedQty: order.quantity, 
            invoicePrice: order.totalPrice || order.quantity * (order.unitPrice || 0), 
            negotiatedPrice: (order.totalPrice || order.quantity * (order.unitPrice || 0)) * 0.97,
            supplier: order.providerName || 'Unknown Provider',
            orderId: order.id
          },
          timestamp: new Date(order.createdAt || now.getTime() - (index + 1) * 1000 * 60 * 15),
        })
      })
  } else {
    // Fallback to localStorage for offline/demo mode
    try {
      const ordersData = localStorage.getItem(PENDING_ORDERS_KEY)
      if (ordersData) {
        const localOrders = JSON.parse(ordersData)
        localOrders
          .filter((o: any) => o.status === 'approved' || o.status === 'ordered')
          .slice(0, 3)
          .forEach((order: any, index: number) => {
            const wine = wines.find(w => w.name === order.wineName)
            actions.push({
              id: `delivery_${order.id}`,
              type: 'delivery_confirm',
              priority: 'high',
              title: `${order.wineName} Delivery`,
              subtitle: `${order.quantity} bottles • Verify & Confirm`,
              wine,
              details: { 
                expectedQty: order.quantity, 
                invoicePrice: order.totalPrice, 
                negotiatedPrice: order.totalPrice * 0.97,
                supplier: order.providerName
              },
              timestamp: new Date(order.createdAt || now.getTime() - (index + 1) * 1000 * 60 * 15),
            })
          })
      }
    } catch {}
  }
  
  // 4. Always include Gmail quick action
  actions.push({
    id: 'action_gmail_001',
    type: 'gmail_send',
    priority: 'medium',
    title: 'Send Email Report',
    subtitle: 'Quick access to saved templates',
    details: { templates: [] },
    timestamp: new Date(now.getTime() - 1000 * 60 * 1),
  })
  
  // Sort by priority and timestamp
  const priorityOrder = { critical: 0, high: 1, medium: 2 }
  actions.sort((a, b) => {
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
    if (priorityDiff !== 0) return priorityDiff
    return b.timestamp.getTime() - a.timestamp.getTime()
  })
  
  return actions
}

// Initial actions - load from storage first, generate with empty API orders if no persisted
function getInitialActions(wines: WineType[], lowStockItems: Array<{ wineId?: string; wineName?: string; stockLive?: number; thresholdMin?: number }>): ActionItem[] {
  const persisted = loadPersistedActions()
  if (persisted.length > 0) return persisted
  // Generate actions without API orders initially - they'll be updated when API data loads
  return generateRealActions(wines, lowStockItems, [])
}

export function OneTapActionCenter() {
  const { data: apiWines = [] } = useWines({ limit: 500 })
  const libraryWines = useMemo(() => mapApiWinesToUiWines(apiWines), [apiWines])
  const { lowStockItems = [] } = useInventoryData()
  const initialActions = useMemo(
    () => getInitialActions(libraryWines, lowStockItems),
    [libraryWines, lowStockItems],
  )
  const [actions, setActions] = useState<ActionItem[]>(initialActions)
  const [expandedAction, setExpandedAction] = useState<string | null>(null)
  const [processingAction, setProcessingAction] = useState<string | null>(null)
  const [_ordersLoading, setOrdersLoading] = useState(false)
  
  // Get restaurant ID from auth store
  const restaurantId = useAuthStore(state => state.activeRestaurantId)
  
  // Realtime dispatch for cross-page sync
  const { dispatchInventoryUpdate, dispatchOrderUpdate } = useRealtimeDispatch()

  // Fetch orders from API and regenerate actions
  useEffect(() => {
    if (!restaurantId) return
    
    const fetchOrders = async () => {
      setOrdersLoading(true)
      try {
        // Fetch both pending orders and recent in-transit orders
        const [pendingOrders, allOrders] = await Promise.all([
          getOrdersNeedingApproval(restaurantId).catch(() => [] as Order[]),
          getOrders({ status: 'in_transit' }, restaurantId).catch(() => [] as Order[])
        ])
        
        // Combine and dedupe
        const combinedOrders = [...pendingOrders, ...allOrders]
        const uniqueOrders = combinedOrders.filter(
          (order, index, self) => self.findIndex(o => o.id === order.id) === index
        )
        
        // Only update if we got API data
        if (uniqueOrders.length > 0) {
          const newActions = generateRealActions(libraryWines, lowStockItems, uniqueOrders)
          setActions(prev => {
            // Merge with any user-created actions
            const userCreatedActions = prev.filter(
              a => !a.id.startsWith('delivery_') && !a.id.startsWith('stock_')
            )
            return [...newActions, ...userCreatedActions]
          })
        }
      } catch (error) {
        console.warn('[OneTapActions] Failed to fetch orders from API:', error)
        // Keep using existing actions (localStorage fallback already happened)
      } finally {
        setOrdersLoading(false)
      }
    }
    
    fetchOrders()
    
    // Refresh every 60 seconds
    const interval = setInterval(fetchOrders, 60000)
    return () => clearInterval(interval)
  }, [restaurantId, libraryWines, lowStockItems])
  
  // **NEW: Efficiency Features**
  const [selectedActions, setSelectedActions] = useState<Set<string>>(new Set())
  const [showFilters, setShowFilters] = useState(false)
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'critical' | 'high' | 'medium'>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | ActionItem['type']>('all')
  const [showKeyboardHints, setShowKeyboardHints] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  
  // Gmail Modal
  const [showGmailModal, setShowGmailModal] = useState(false)
  const [gmailRecipient, setGmailRecipient] = useState('')
  const [gmailSubject, setGmailSubject] = useState('')
  
  useEffect(() => {
    setActions(initialActions)
  }, [initialActions])

  // Persist actions when they change
  useEffect(() => {
    saveActionsToStorage(actions)
  }, [actions])
  
  // Refresh actions periodically and on window focus
  const refreshActions = useCallback(() => {
    const newActions = generateRealActions(libraryWines, lowStockItems)
    // Merge with existing custom actions
    setActions(prev => {
      const customActions = prev.filter(a => 
        !a.id.startsWith('low_stock_') && 
        !a.id.startsWith('stock_receipt_') && 
        !a.id.startsWith('delivery_') &&
        a.id !== 'action_gmail_001'
      )
      return [...newActions, ...customActions]
    })
  }, [libraryWines, lowStockItems])
  
  useEffect(() => {
    const handleFocus = () => refreshActions()
    const handleNewAction = (event: Event) => {
      const customEvent = event as CustomEvent<ActionItem>
      if (customEvent.detail) {
        setActions(prev => [customEvent.detail, ...prev])
      }
    }
    
    window.addEventListener('focus', handleFocus)
    window.addEventListener('onetap_action_added', handleNewAction)
    
    // Refresh every 2 minutes
    const interval = setInterval(refreshActions, 120000)
    
    return () => {
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('onetap_action_added', handleNewAction)
      clearInterval(interval)
    }
  }, [refreshActions])

  const getPriorityColor = (priority: ActionItem['priority']) => {
    switch (priority) {
      case 'critical': return 'bg-rose-500'
      case 'high': return 'bg-amber-500'
      case 'medium': return 'bg-blue-500'
      default: return 'bg-gray-400'
    }
  }

  const getTypeIcon = (type: ActionItem['type']) => {
    switch (type) {
      case 'low_stock': return AlertTriangle
      case 'price_change': return DollarSign
      case 'delivery_confirm': return Truck
      case 'inequality': return RefreshCw
      case 'vintage_sub': return Wine
      default: return Bell
    }
  }

  const handleApprove = async (action: ActionItem) => {
    setProcessingAction(action.id)
    
    try {
      // Real effects based on action type
      switch (action.type) {
        case 'stock_receipt':
          // Move shadow stock to live stock
          if (action.wine) {
            dispatchInventoryUpdate({
              type: 'stock_change',
              wineId: action.wine.id,
              wineName: action.wine.name,
              quantity: action.details.quantity,
              source: 'reconciliation',
              timestamp: new Date().toISOString(),
              metadata: {
                stockType: 'live',
                action: 'shadow_to_live',
                orderId: action.details.orderId,
                cost: action.details.cost,
                provider: action.details.supplier
              }
            })
            
            // Clear shadow stock for this wine
            try {
              const shadowData = localStorage.getItem(SHADOW_STOCK_KEY)
              if (shadowData) {
                const shadow = JSON.parse(shadowData)
                delete shadow[action.wine.id]
                localStorage.setItem(SHADOW_STOCK_KEY, JSON.stringify(shadow))
              }
            } catch {}
          }
          break
          
        case 'low_stock':
          // Create a reorder - dispatch order created event
          if (action.wine) {
            dispatchOrderUpdate({
              type: 'created',
              orderId: `ORD-${Date.now()}`,
              wineId: action.wine.id,
              quantity: action.details.suggestedOrder,
              providerId: action.wine.provider.name,
              timestamp: new Date().toISOString()
            })
            
            // Store in orders history
            try {
              const ordersData = localStorage.getItem(PENDING_ORDERS_KEY)
              const orders = ordersData ? JSON.parse(ordersData) : []
              orders.unshift({
                id: `ORD-${Date.now()}`,
                wineId: action.wine.id,
                wineName: action.wine.name,
                quantity: action.details.suggestedOrder,
                unitPrice: action.wine.price,
                totalPrice: action.details.estimatedPrice,
                providerId: action.wine.provider.name,
                providerName: action.wine.provider.name,
                status: 'pending',
                createdAt: new Date().toISOString(),
                wineType: action.wine.type
              })
              localStorage.setItem(PENDING_ORDERS_KEY, JSON.stringify(orders))
            } catch {}
          }
          break
          
        case 'delivery_confirm':
          // Mark order as delivered, add to shadow stock
          if (action.wine) {
            dispatchInventoryUpdate({
              type: 'stock_change',
              wineId: action.wine.id,
              wineName: action.wine.name,
              quantity: action.details.expectedQty,
              source: 'order_delivery',
              timestamp: new Date().toISOString(),
              metadata: {
                stockType: 'shadow',
                cost: action.details.negotiatedPrice,
                provider: action.details.supplier
              }
            })
          }
          break
          
        case 'price_change':
          // Accept the new price - update order
          console.log('Price accepted:', action.details.counterPrice)
          break
          
        case 'inequality':
          // Acknowledge inequality and schedule physical count
          console.log('Inequality acknowledged, scheduling count')
          break
          
        case 'vintage_sub':
          // Accept vintage substitution
          console.log('Vintage substitution accepted')
          break
      }
      
      // Small delay for visual feedback
      await new Promise(resolve => setTimeout(resolve, 300))
      
      // Remove action from list
      setActions(prev => prev.filter(a => a.id !== action.id))
      
    } catch (error) {
      console.error('Error processing action:', error)
    } finally {
      setProcessingAction(null)
    }
  }

  const handleReject = async (action: ActionItem) => {
    setProcessingAction(action.id)
    
    try {
      // Real effects for rejection based on action type
      switch (action.type) {
        case 'low_stock':
          // Mark as acknowledged but don't reorder
          console.log('Reorder rejected for:', action.wine?.name)
          break
          
        case 'delivery_confirm':
          // Reject delivery - needs investigation
          console.log('Delivery rejected, flagging for investigation')
          break
          
        case 'price_change':
          // Reject price - continue negotiation
          console.log('Price rejected, continuing negotiation')
          break
      }
      
      await new Promise(resolve => setTimeout(resolve, 200))
      setActions(prev => prev.filter(a => a.id !== action.id))
      
    } finally {
      setProcessingAction(null)
    }
  }

  const handleGmailAction = (action: ActionItem) => {
    if (action.type === 'gmail_send') {
      // Open Gmail modal with template selector
      setGmailRecipient('')
      setGmailSubject('')
      setShowGmailModal(true)
    } else if (action.type === 'gmail_contextual') {
      // Open Gmail modal with pre-filled data
      setGmailRecipient(action.details.recipient || '')
      setGmailSubject(action.details.subject || '')
      setShowGmailModal(true)
    }
  }

  const handleStockCorrection = async (action: ActionItem, _correction: number) => {
    setProcessingAction(action.id)
    await new Promise(resolve => setTimeout(resolve, 800))
    setActions(prev => prev.filter(a => a.id !== action.id))
    setProcessingAction(null)
    // In real app: update inventory with correction
  }

  const formatTimeAgo = (date: Date) => {
    const mins = Math.floor((Date.now() - date.getTime()) / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    return `${Math.floor(mins / 60)}h ago`
  }

  // **NEW: Filtered Actions**
  const filteredActions = useMemo(() => {
    let filtered = actions
    
    if (priorityFilter !== 'all') {
      filtered = filtered.filter(a => a.priority === priorityFilter)
    }
    
    if (typeFilter !== 'all') {
      filtered = filtered.filter(a => a.type === typeFilter)
    }
    
    // Sort by priority and timestamp
    return filtered.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2 }
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (priorityDiff !== 0) return priorityDiff
      return b.timestamp.getTime() - a.timestamp.getTime()
    })
  }, [actions, priorityFilter, typeFilter])

  // **NEW: Batch Actions**
  const handleBatchApprove = async () => {
    if (selectedActions.size === 0) return
    setProcessingAction('batch')
    
    // Simulate batch processing
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    setActions(prev => prev.filter(a => !selectedActions.has(a.id)))
    setSelectedActions(new Set())
    setProcessingAction(null)
    setBatchMode(false)
  }

  const toggleActionSelection = (actionId: string) => {
    setSelectedActions(prev => {
      const newSet = new Set(prev)
      if (newSet.has(actionId)) {
        newSet.delete(actionId)
      } else {
        newSet.add(actionId)
      }
      return newSet
    })
  }

  const selectAllFiltered = () => {
    setSelectedActions(new Set(filteredActions.map(a => a.id)))
  }

  const deselectAll = () => {
    setSelectedActions(new Set())
  }

  // **NEW: Smart Suggestions** 
  const smartSuggestions = useMemo(() => {
    const suggestions: { text: string; action: () => void }[] = []
    
    const lowStockActions = filteredActions.filter(a => a.type === 'low_stock')
    if (lowStockActions.length >= 3) {
      suggestions.push({
        text: `Approve all ${lowStockActions.length} low stock reorders`,
        action: () => {
          setSelectedActions(new Set(lowStockActions.map(a => a.id)))
          setBatchMode(true)
        }
      })
    }
    
    const deliveryActions = filteredActions.filter(a => a.type === 'delivery_confirm')
    if (deliveryActions.length >= 2) {
      suggestions.push({
        text: `Confirm all ${deliveryActions.length} deliveries`,
        action: () => {
          setSelectedActions(new Set(deliveryActions.map(a => a.id)))
          setBatchMode(true)
        }
      })
    }
    
    return suggestions
  }, [filteredActions])

  // **NEW: Keyboard Shortcuts**
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K: Toggle filters
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowFilters(prev => !prev)
      }
      
      // Cmd/Ctrl + B: Toggle batch mode
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        setBatchMode(prev => !prev)
      }
      
      // Cmd/Ctrl + A: Select all
      if ((e.metaKey || e.ctrlKey) && e.key === 'a' && batchMode) {
        e.preventDefault()
        selectAllFiltered()
      }
      
      // Cmd/Ctrl + ?: Show keyboard hints
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        setShowKeyboardHints(prev => !prev)
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [batchMode, filteredActions])

  const criticalCount = actions.filter(a => a.priority === 'critical').length

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-wine-50 to-transparent">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 bg-wine-100 rounded-xl flex items-center justify-center">
              <Zap className="w-5 h-5 text-wine-600" />
            </div>
            {criticalCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white text-xs font-bold rounded-full flex items-center justify-center animate-pulse">
                {criticalCount}
              </span>
            )}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">One-Tap Actions</h3>
            <p className="text-sm text-gray-500">{filteredActions.length} pending • {selectedActions.size} selected</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowFilters(!showFilters)}
            className={`p-2 rounded-lg transition-colors ${showFilters ? 'bg-wine-100 text-wine-600' : 'text-gray-500 hover:bg-gray-100'}`}
            title="Filters (⌘K)"
          >
            <Filter className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setBatchMode(!batchMode)}
            className={`p-2 rounded-lg transition-colors ${batchMode ? 'bg-emerald-100 text-emerald-600' : 'text-gray-500 hover:bg-gray-100'}`}
            title="Batch Mode (⌘B)"
          >
            <CheckSquare className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setShowKeyboardHints(!showKeyboardHints)}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
            title="Keyboard Shortcuts (⌘/)"
          >
            <Command className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-gray-100 overflow-hidden"
          >
            <div className="px-6 py-3 flex items-center gap-4">
              <span className="text-sm font-medium text-gray-600">Filters:</span>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value as any)}
                className="text-sm px-3 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
              >
                <option value="all">All Priorities</option>
                <option value="critical">Critical Only</option>
                <option value="high">High Only</option>
                <option value="medium">Medium Only</option>
              </select>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as any)}
                className="text-sm px-3 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
              >
                <option value="all">All Types</option>
                <option value="low_stock">Low Stock</option>
                <option value="delivery_confirm">Delivery</option>
                <option value="price_change">Price</option>
                <option value="inequality">Inequality</option>
                <option value="vintage_sub">Vintage Sub</option>
                <option value="stock_receipt">Stock Receipt</option>
              </select>
              {(priorityFilter !== 'all' || typeFilter !== 'all') && (
                <button
                  onClick={() => {
                    setPriorityFilter('all')
                    setTypeFilter('all')
                  }}
                  className="text-sm text-wine-600 hover:text-wine-700 font-medium"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Smart Suggestions */}
      <AnimatePresence>
        {smartSuggestions.length > 0 && !batchMode && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-gray-100 overflow-hidden bg-gradient-to-r from-purple-50 to-indigo-50"
          >
            <div className="px-6 py-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <Sparkles className="w-4 h-4 text-purple-600" />
                AI Suggestions
              </div>
              {smartSuggestions.map((suggestion, index) => (
                <button
                  key={index}
                  onClick={suggestion.action}
                  className="w-full text-left px-3 py-2 bg-white hover:bg-purple-50 border border-purple-100 rounded-lg text-sm text-gray-700 transition-colors"
                >
                  {suggestion.text}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Batch Action Bar */}
      <AnimatePresence>
        {batchMode && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-gray-100 overflow-hidden bg-emerald-50"
          >
            <div className="px-6 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-900">
                  {selectedActions.size} action(s) selected
                </span>
                {selectedActions.size > 0 && (
                  <button
                    onClick={deselectAll}
                    className="text-xs text-gray-600 hover:text-gray-900"
                  >
                    Deselect All
                  </button>
                )}
                <button
                  onClick={selectAllFiltered}
                  className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                >
                  Select All Visible
                </button>
              </div>
              <button
                onClick={handleBatchApprove}
                disabled={selectedActions.size === 0 || processingAction === 'batch'}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium flex items-center gap-2"
              >
                {processingAction === 'batch' ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Approve Selected ({selectedActions.size})
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Keyboard Shortcuts Hint */}
      <AnimatePresence>
        {showKeyboardHints && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-gray-100 overflow-hidden bg-gray-50"
          >
            <div className="px-6 py-3 grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Toggle Filters</span>
                <kbd className="px-2 py-1 bg-white border border-gray-200 rounded">⌘K</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Batch Mode</span>
                <kbd className="px-2 py-1 bg-white border border-gray-200 rounded">⌘B</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Select All</span>
                <kbd className="px-2 py-1 bg-white border border-gray-200 rounded">⌘A</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Shortcuts</span>
                <kbd className="px-2 py-1 bg-white border border-gray-200 rounded">⌘/</kbd>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action List */}
      <div className="divide-y divide-gray-50 max-h-[500px] overflow-y-auto">
        <AnimatePresence>
          {filteredActions.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="p-8 text-center"
            >
              <div className="w-16 h-16 bg-emerald-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                <Check className="w-8 h-8 text-emerald-600" />
              </div>
              <p className="font-medium text-gray-900">All caught up!</p>
              <p className="text-sm text-gray-500 mt-1">No pending actions require your attention</p>
            </motion.div>
          ) : (
            filteredActions.map((action) => {
              const Icon = getTypeIcon(action.type)
              const isExpanded = expandedAction === action.id
              const isProcessing = processingAction === action.id
              const typeColors = action.wine ? getWineTypeColor(action.wine.type) : null
              const isSelected = selectedActions.has(action.id)

              return (
                <motion.div
                  key={action.id}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  className="overflow-hidden"
                >
                  <div
                    onClick={() => !batchMode && setExpandedAction(isExpanded ? null : action.id)}
                    className={`px-6 py-4 ${batchMode ? 'cursor-default' : 'cursor-pointer'} transition-colors ${
                      isExpanded ? 'bg-gray-50' : batchMode && isSelected ? 'bg-emerald-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      {/* Batch Mode Checkbox */}
                      {batchMode && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleActionSelection(action.id)
                          }}
                          className="p-1 hover:bg-gray-100 rounded transition-colors"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-5 h-5 text-emerald-600" />
                          ) : (
                            <Square className="w-5 h-5 text-gray-400" />
                          )}
                        </button>
                      )}

                      {/* Priority Indicator */}
                      <div className={`w-1.5 h-full min-h-[60px] rounded-full ${getPriorityColor(action.priority)}`} />

                      {/* Icon */}
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        action.priority === 'critical' ? 'bg-rose-100' :
                        action.priority === 'high' ? 'bg-amber-100' : 'bg-blue-100'
                      }`}>
                        <Icon className={`w-5 h-5 ${
                          action.priority === 'critical' ? 'text-rose-600' :
                          action.priority === 'high' ? 'text-amber-600' : 'text-blue-600'
                        }`} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold text-gray-900 truncate">{action.title}</h4>
                          {typeColors && (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeColors.bg} ${typeColors.text}`}>
                              {action.wine?.type}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500">{action.subtitle}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <Clock className="w-3.5 h-3.5 text-gray-400" />
                          <span className="text-xs text-gray-400">{formatTimeAgo(action.timestamp)}</span>
                        </div>
                      </div>

                      {/* Quick Actions (when collapsed) */}
                      {!isExpanded && !isProcessing && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleApprove(action)
                            }}
                            className="p-2 bg-emerald-100 text-emerald-600 rounded-lg hover:bg-emerald-200 transition-colors"
                          >
                            <Check className="w-5 h-5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleReject(action)
                            }}
                            className="p-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>
                      )}

                      {isProcessing && (
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 border-2 border-wine-600 border-t-transparent rounded-full animate-spin" />
                        </div>
                      )}

                      {!isProcessing && (
                        <ChevronRight className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                      )}
                    </div>
                  </div>

                  {/* Expanded Details */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="px-6 pb-4 bg-gray-50"
                      >
                        <div className="ml-14 pt-2 border-t border-gray-200">
                          {/* Low Stock Action */}
                          {action.type === 'low_stock' && (
                            <div className="space-y-4">
                              <div className="grid grid-cols-2 gap-4">
                                <div className="p-3 bg-white rounded-xl">
                                  <p className="text-xs text-gray-500 mb-1">Current Stock</p>
                                  <p className="text-xl font-bold text-rose-600">{action.details.currentStock} bottles</p>
                                </div>
                                <div className="p-3 bg-white rounded-xl">
                                  <p className="text-xs text-gray-500 mb-1">Suggested Order</p>
                                  <p className="text-xl font-bold text-gray-900">{action.details.suggestedOrder} bottles</p>
                                </div>
                              </div>
                              <div className="p-3 bg-white rounded-xl">
                                <p className="text-xs text-gray-500 mb-1">Estimated Cost</p>
                                <p className="text-2xl font-bold text-gray-900">
                                  ${action.details.estimatedPrice.toLocaleString()}
                                </p>
                              </div>
                              <div className="flex gap-3">
                                <button
                                  onClick={() => handleApprove(action)}
                                  disabled={isProcessing}
                                  className="flex-1 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
                                >
                                  <Check className="w-5 h-5" />
                                  Approve Reorder
                                </button>
                                <button
                                  onClick={() => handleReject(action)}
                                  disabled={isProcessing}
                                  className="px-6 py-3 bg-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-300 transition-colors"
                                >
                                  Reject
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Stock Receipt Confirmation */}
                          {action.type === 'stock_receipt' && (
                            <div className="space-y-4">
                              <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl border border-blue-100">
                                <div className="flex items-center gap-3 mb-3">
                                  <div className="p-2 bg-blue-600 rounded-lg">
                                    <Package className="w-5 h-5 text-white" />
                                  </div>
                                  <div>
                                    <p className="font-semibold text-gray-900">Shadow Stock → Live Stock</p>
                                    <p className="text-xs text-gray-600">Verify received quantity and approve transfer</p>
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="p-3 bg-white rounded-lg">
                                    <p className="text-xs text-gray-500 mb-1">Quantity</p>
                                    <p className="text-lg font-bold text-gray-900">{action.details.quantity} bottles</p>
                                  </div>
                                  <div className="p-3 bg-white rounded-lg">
                                    <p className="text-xs text-gray-500 mb-1">Cost</p>
                                    <p className="text-lg font-bold text-gray-900">${action.details.cost}</p>
                                  </div>
                                </div>
                              </div>
                              <p className="text-sm text-gray-600">
                                Supplier: <span className="font-medium">{action.details.supplier}</span> • Order: <span className="font-mono text-xs">{action.details.orderId}</span>
                              </p>
                              <div className="flex gap-3">
                                <button
                                  onClick={() => handleApprove(action)}
                                  disabled={isProcessing}
                                  className="flex-1 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                                >
                                  <Check className="w-5 h-5" />
                                  Approve & Move to Live Stock
                                </button>
                                <button
                                  onClick={() => handleReject(action)}
                                  disabled={isProcessing}
                                  className="px-4 py-3 bg-rose-100 text-rose-700 font-semibold rounded-xl hover:bg-rose-200 transition-colors"
                                  title="Report discrepancy"
                                >
                                  <AlertTriangle className="w-5 h-5" />
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Delivery Confirmation */}
                          {action.type === 'delivery_confirm' && (
                            <div className="space-y-4">
                              <div className="grid grid-cols-3 gap-3">
                                <div className="p-3 bg-white rounded-xl">
                                  <p className="text-xs text-gray-500 mb-1">Expected</p>
                                  <p className="text-lg font-bold text-gray-900">{action.details.expectedQty} btls</p>
                                </div>
                                <div className="p-3 bg-white rounded-xl">
                                  <p className="text-xs text-gray-500 mb-1">Invoice Price</p>
                                  <p className="text-lg font-bold text-gray-900">${action.details.invoicePrice}</p>
                                </div>
                                <div className="p-3 bg-white rounded-xl">
                                  <p className="text-xs text-gray-500 mb-1">Negotiated</p>
                                  <p className="text-lg font-bold text-emerald-600">${action.details.negotiatedPrice}</p>
                                </div>
                              </div>
                              <p className="text-sm text-gray-600">
                                Supplier: <span className="font-medium">{action.details.supplier}</span>
                              </p>
                              <div className="flex gap-3">
                                <button
                                  onClick={() => handleApprove(action)}
                                  disabled={isProcessing}
                                  className="flex-1 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
                                >
                                  <Truck className="w-5 h-5" />
                                  Confirm Received
                                </button>
                                <button
                                  onClick={() => handleReject(action)}
                                  disabled={isProcessing}
                                  className="px-6 py-3 bg-rose-100 text-rose-700 font-medium rounded-xl hover:bg-rose-200 transition-colors"
                                >
                                  Report Issue
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Price Change */}
                          {action.type === 'price_change' && (
                            <div className="space-y-4">
                              <div className="grid grid-cols-2 gap-4">
                                <div className="p-3 bg-white rounded-xl">
                                  <p className="text-xs text-gray-500 mb-1">Your Price</p>
                                  <p className="text-xl font-bold text-gray-900">${action.details.originalPrice}</p>
                                </div>
                                <div className="p-3 bg-white rounded-xl">
                                  <p className="text-xs text-gray-500 mb-1">Counter Offer</p>
                                  <p className="text-xl font-bold text-amber-600">${action.details.counterPrice}</p>
                                  <p className="text-xs text-amber-500">+{action.details.deviation}% deviation</p>
                                </div>
                              </div>
                              <div className="flex gap-3">
                                <button
                                  onClick={() => handleApprove(action)}
                                  disabled={isProcessing}
                                  className="flex-1 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-colors"
                                >
                                  Accept ${action.details.counterPrice}
                                </button>
                                <button
                                  onClick={() => handleReject(action)}
                                  disabled={isProcessing}
                                  className="px-6 py-3 bg-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-300 transition-colors"
                                >
                                  Decline
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Inequality Detection - ONE TAP CORRECTION */}
                          {action.type === 'inequality' && (
                            <div className="space-y-4">
                              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                                <p className="text-sm text-amber-800">
                                  <strong>Inequality Detected:</strong> Sales exceed recorded stock. 
                                  Did you make a manual purchase?
                                </p>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 bg-white rounded-xl">
                                  <p className="text-xs text-gray-500 mb-1">DB Stock</p>
                                  <p className="text-xl font-bold text-gray-900">{action.details.dbStock}</p>
                                </div>
                                <div className="p-3 bg-white rounded-xl">
                                  <p className="text-xs text-gray-500 mb-1">Sales Count</p>
                                  <p className="text-xl font-bold text-gray-900">{action.details.salesCount}</p>
                                </div>
                              </div>
                              
                              {/* ONE-TAP CORRECTION BUTTONS */}
                              <div className="space-y-2">
                                <p className="text-sm font-medium text-gray-700">Quick Correction:</p>
                                <div className="grid grid-cols-2 gap-3">
                                  <button
                                    onClick={() => handleStockCorrection(action, 6)}
                                    className="py-3 bg-blue-100 text-blue-700 font-semibold rounded-xl hover:bg-blue-200 transition-colors flex items-center justify-center gap-2"
                                  >
                                    <Plus className="w-5 h-5" />
                                    +6 bottles
                                  </button>
                                  <button
                                    onClick={() => handleStockCorrection(action, 12)}
                                    className="py-3 bg-blue-100 text-blue-700 font-semibold rounded-xl hover:bg-blue-200 transition-colors flex items-center justify-center gap-2"
                                  >
                                    <Plus className="w-5 h-5" />
                                    +1 case (12)
                                  </button>
                                </div>
                                <button
                                  onClick={() => handleReject(action)}
                                  className="w-full py-3 bg-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-300 transition-colors"
                                >
                                  Investigate Later
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Vintage Substitution */}
                          {action.type === 'vintage_sub' && (
                            <div className="space-y-4">
                              <div className="grid grid-cols-2 gap-4">
                                <div className="p-3 bg-white rounded-xl border-2 border-dashed border-gray-200">
                                  <p className="text-xs text-gray-500 mb-1">Requested</p>
                                  <p className="text-xl font-bold text-gray-400 line-through">{action.details.requestedVintage}</p>
                                  <p className="text-xs text-rose-500">Unavailable</p>
                                </div>
                                <div className="p-3 bg-emerald-50 rounded-xl border-2 border-emerald-200">
                                  <p className="text-xs text-emerald-600 mb-1">Offered</p>
                                  <p className="text-xl font-bold text-emerald-700">{action.details.offeredVintage}</p>
                                  <p className="text-xs text-emerald-600">${action.details.priceChange} price diff</p>
                                </div>
                              </div>
                              <div className="flex gap-3">
                                <button
                                  onClick={() => handleApprove(action)}
                                  disabled={isProcessing}
                                  className="flex-1 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-colors"
                                >
                                  Accept {action.details.offeredVintage}
                                </button>
                                <button
                                  onClick={() => handleReject(action)}
                                  disabled={isProcessing}
                                  className="px-6 py-3 bg-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-300 transition-colors"
                                >
                                  Decline
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Gmail Send Action */}
                          {action.type === 'gmail_send' && (
                            <div className="space-y-4">
                              <div className="p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200">
                                <div className="flex items-center gap-3 mb-3">
                                  <Mail className="w-6 h-6 text-blue-600" />
                                  <div>
                                    <p className="font-semibold text-gray-900">Quick Email Access</p>
                                    <p className="text-sm text-gray-600">Send reports, alerts, or updates using saved templates</p>
                                  </div>
                                </div>
                              </div>
                              <button
                                onClick={() => handleGmailAction(action)}
                                className="w-full py-3 bg-wine-600 text-white font-semibold rounded-xl hover:bg-wine-700 transition-colors flex items-center justify-center gap-2"
                              >
                                <Send className="w-5 h-5" />
                                Open Gmail Composer
                              </button>
                            </div>
                          )}

                          {/* Gmail Contextual Action */}
                          {action.type === 'gmail_contextual' && (
                            <div className="space-y-4">
                              <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
                                <div className="grid grid-cols-2 gap-3 mb-3">
                                  <div>
                                    <p className="text-xs text-amber-700 mb-1">To</p>
                                    <p className="text-sm font-semibold text-gray-900">{action.details.recipient}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-amber-700 mb-1">Subject</p>
                                    <p className="text-sm font-semibold text-gray-900">{action.details.subject}</p>
                                  </div>
                                </div>
                                {action.details.prefilledData && (
                                  <div className="pt-3 border-t border-amber-200 space-y-1">
                                    <p className="text-xs text-amber-700 font-medium">Pre-filled Data:</p>
                                    {Object.entries(action.details.prefilledData).map(([key, value]) => (
                                      <p key={key} className="text-xs text-gray-600">
                                        <span className="font-medium">{key}:</span> {String(value)}
                                      </p>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <button
                                onClick={() => handleGmailAction(action)}
                                className="w-full py-3 bg-wine-600 text-white font-semibold rounded-xl hover:bg-wine-700 transition-colors flex items-center justify-center gap-2"
                              >
                                <Send className="w-5 h-5" />
                                Review & Send Email
                              </button>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })
          )}
        </AnimatePresence>
      </div>

      {/* Gmail Modal */}
      {showGmailModal && (
        <QuickGmailModal
          onClose={() => {
            setShowGmailModal(false)
            setGmailRecipient('')
            setGmailSubject('')
          }}
          prefilledRecipient={gmailRecipient}
          prefilledSubject={gmailSubject}
        />
      )}
    </div>
  )
}

