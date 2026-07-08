import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Card, Button } from '../components/ui'
import { Header } from '../components/layout/Header'
import { OrderApprovalModal } from '../components/orders/OrderApprovalModal'
import { OrderGuardModal } from '../components/orders/OrderGuardModal'
import { DraftEmailApprovalPanel } from '../components/orders/DraftEmailApprovalPanel'
import { ActiveConversationsPanel } from '../components/orders/ActiveConversationsPanel'
import { CommsThreadDrawer } from '../components/orders/CommsThreadDrawer'
import { useApproveDraft, useDiscardDraft, useEditDraft, useActiveConversations, type ActiveConversationDto } from '../hooks/queries/useDraftEmailQueries'
import {
  Package,
  Clock,
  CheckCircle,
  XCircle,
  DollarSign,
  Truck,
  MessageSquare,
  Plus,
  Search,
  Wine,
  X,
  Minus,
  ShoppingCart,
  Check,
  ChevronRight,
  Building2,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
  Trash2,
  Zap,
  Pause,
  Play,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import axios from 'axios'
import { Wine as WineType } from '../data/wineData'
import type { Provider } from '../services/api/providers'
import { apiClient } from '../services/api/client'
import { inventoryApi, getInventory } from '../services/api'
import { useRealtimeDispatch } from '../contexts/RealtimeContext'
import { useWinesByIds } from '../hooks/queries'
import { mapApiWinesToUiWines } from '../lib/wine-library'
import { formatVolume } from '../utils/volumeUtils'
import { useOrders } from '../hooks/queries/useOrderQueries'
import { useUIStore, useRestaurantSettingsStore } from '../stores'
import { useOrdersPage, OrderSummary, OrderFilters, CreateOrderModal } from './orders/index'

// @ts-expect-error Vite injects import.meta.env at build time
const API_URL = import.meta.env?.VITE_API_GATEWAY_URL || 'http://localhost:4000'
const isUuid = (value?: string | null) =>
  !!value &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

const mapApiStatusToUi = (status?: string): Order['status'] => {
  switch (status) {
    case 'PENDING':
    case 'APPROVAL_NEEDED':
      return 'pending_approval'
    case 'NEGOTIATING':
      return 'pending_approval'
    case 'APPROVED':
      return 'approved'
    case 'CONFIRMED':
    case 'IN_TRANSIT':
      return 'ordered'
    case 'DELIVERED':
    case 'COMPLETED':
      return 'delivered'
    case 'CANCELLED':
    case 'REJECTED':
    case 'FAILED':
      return 'cancelled'
    default:
      return 'pending_approval'
  }
}

const mapApiOrderToUi = (order: any): Order => ({
  order_id: order.id ?? order.order_id,
  wine_id: order.inventoryId ?? order.wine_id ?? '',
  wine_name: order.wineName ?? order.wine_name,
  quantity: order.quantity ?? 0,
  provider_name: order.providerName ?? order.provider_id ?? order.providerId,
  status: mapApiStatusToUi(order.status),
  suggested_price: order.quotedPrice ?? order.suggested_price,
  final_price: order.finalPrice ?? order.final_price,
  created_at: order.requestedAt ?? order.created_at ?? new Date().toISOString(),
  approved_at: order.approvedAt ?? order.approved_at,
  delivered_at: order.deliveredAt ?? order.delivered_at,
})

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
    selected: string[] // Selected provider IDs
  }
  notes: string
}

interface OrderApprovalData {
  orderId: string
  wineName: string
  quantity: number
  providerName: string
  proposedPrice: number
  finalPrice: number
  deliveryEstimate: string
  conversationSummary: string
  hasNegotiation?: boolean
  conversationId: string
  timestamp: string
}

const getRecommendedProviders = (providerList: Provider[]) => {
  const sorted = [...providerList].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
  return {
    primary: sorted[0],
    alternatives: sorted.slice(1, 3),
  }
}

export function Orders() {
  const { user, activeRestaurantId, availableRestaurants } = useAuth()
  const activeRestaurantName = availableRestaurants.find((b) => b.id === activeRestaurantId)?.name ?? ''
  const { dispatchOrderUpdate, dispatchInventoryUpdate } = useRealtimeDispatch()
  const { pendingReorder, clearPendingReorder } = useUIStore()
  const { measurementUnit } = useRestaurantSettingsStore()
  
  // Use the extracted orders page hook
  const ordersData = useOrdersPage()
  const {
    orders,
    providers,
    wines: apiWines,
    inventory,
    loading,
    error,
    filterStatus,
    filterOrderType,
    orderSearch,
    setFilterStatus,
    setFilterOrderType,
    setOrderSearch,
    toggleStatusFilter,
    viewMode,
    selectedOrder,
    groupBy,
    expandedGroups,
    showRecurringSection,
    recurringGroupBy,
    setViewMode,
    setSelectedOrder,
    setGroupBy,
    setExpandedGroups,
    setShowRecurringSection,
    setRecurringGroupBy,
    toggleGroup,
    selectedOrders,
    setSelectedOrders,
    filteredOrders: _hookFilteredOrders,
    searchFilteredOrders,
    sortedOrders: _sortedOrders,
    groupedOrders: _groupedOrders,
    orderAnalytics,
    loadOrders: _loadOrders,
    setError,
    setOrders,
    resolveOrderWineName,
    resolveOrderProviderName,
  } = ordersData

  const providersLoading = false
  const providersError = false
  
  const inventoryById = useMemo(() => {
    const map = new Map<string, any>()
    inventory.forEach((item: any) => {
      if (item?.id) {
        map.set(item.id, item)
      }
    })
    return map
  }, [inventory])
  const inventoryByWineKey = useMemo(() => {
    const map = new Map<string, { id: string; wineId?: string; wineName?: string }>()
    inventory.forEach((item) => {
      if (item.wineId) {
        map.set(item.wineId, { id: item.id, wineId: item.wineId, wineName: item.wineName })
      }
      if (item.wineName) {
        map.set(item.wineName.toLowerCase(), { id: item.id, wineId: item.wineId, wineName: item.wineName })
      }
    })
    return map
  }, [inventory])

  // Use API orders hook for real-time updates (hook handles loading via loadOrders)
  const { refetch: refetchOrders } = useOrders()
  const [showApprovalModal, setShowApprovalModal] = useState(false)
  const [showOrderApprovalModal, setShowOrderApprovalModal] = useState(false)
  const [orderApprovalData, setOrderApprovalData] = useState<OrderApprovalData | null>(null)
  const [showCreateOrderModal, setShowCreateOrderModal] = useState(false)
  const [showOrderGuard, setShowOrderGuard] = useState(false)
  const [draftPanelData, setDraftPanelData] = useState<{
    conversationId: string
    orderId: string
    orderNumber?: string
    restaurantName?: string
    wineName: string
    quantity?: number
    providerName: string
    providerEmail: string
    emailType: 'PRICE_INQUIRY' | 'DEMAND_OFFER' | 'PROMO_INQUIRY' | 'WINE_INQUIRY'
    draftContent: string
    disclaimer: string
    constraintWarnings: Array<{ code: string; message: string; severity: 'annotating' | 'soft' }>
    roundCount: number
    timestamp: string
  } | null>(null)
  const [isDraftPanelOpen, setIsDraftPanelOpen] = useState(false)
  const [commsDrawerOrder, setCommsDrawerOrder] = useState<{ orderId: string; wineName: string; orderStatus: string } | null>(null)
  const approveDraftMutation = useApproveDraft()
  const discardDraftMutation = useDiscardDraft()
  const editDraftMutation = useEditDraft()
  const [isActiveConvPanelOpen, setIsActiveConvPanelOpen] = useState(false)
  const { data: activeConversations = [], isLoading: activeConvLoading } = useActiveConversations()
  const pendingDraftOrderIds = useMemo(
    () => new Set(activeConversations.map((c) => c.orderId)),
    [activeConversations],
  )

  // Single entry-point guard. Pre-empts the wine picker when no vendors exist
  // so the user gets the actionable OrderGuardModal instead of a dead-end
  // "Add to Order" disabled button inside the picker.
  const openCreateOrderFlow = useCallback(() => {
    if (!providers || providers.length === 0) {
      setShowOrderGuard(true)
      return
    }
    setShowCreateOrderModal(true)
  }, [providers])
  const [createOrderItems, setCreateOrderItems] = useState<CreateOrderItem[]>([])
  const [wineSearch, setWineSearch] = useState('')
  const inventoryMasterIds = useMemo(() => {
    const ids = inventory
      .map((item: any) => item?.wineId)
      .filter((id: string | undefined): id is string => Boolean(id))
    return Array.from(new Set(ids))
  }, [inventory])
  const { data: inventoryWines = [] } = useWinesByIds(inventoryMasterIds)
  const wineNameById = useMemo(() => {
    const map = new Map<string, string>()
    inventoryWines.forEach((wine) => {
      if (wine.id && wine.name) {
        map.set(wine.id, wine.name)
      }
    })
    return map
  }, [inventoryWines])

  const wineIdToBottleSizeMl = useMemo(() => {
    const map = new Map<string, number>()
    inventory.forEach((item: any) => {
      if (item?.id != null && (item.bottleSizeMl ?? 750) > 0) {
        map.set(item.id, item.bottleSizeMl ?? 750)
      }
      if (item?.wineId != null && (item.bottleSizeMl ?? 750) > 0) {
        map.set(item.wineId, item.bottleSizeMl ?? 750)
      }
    })
    const libraryWines = mapApiWinesToUiWines(apiWines)
    libraryWines.forEach((wine) => {
      if (wine.id && (wine.bottleSizeMl ?? 750) > 0) {
        map.set(wine.id, wine.bottleSizeMl ?? 750)
      }
    })
    return map
  }, [inventory, apiWines])

  const resolveOrderBottleSizeMl = useCallback(
    (order: Order) =>
      inventoryById.get(order.wine_id)?.bottleSizeMl ??
      wineIdToBottleSizeMl.get(order.wine_id) ??
      750,
    [inventoryById, wineIdToBottleSizeMl]
  )

  const [isCreatingRecurring, setIsCreatingRecurring] = useState(false)
  const [recurringFrequency, setRecurringFrequency] = useState<'daily' | 'weekly' | 'biweekly' | 'monthly'>('weekly')
  const [recurringAutoApprove, setRecurringAutoApprove] = useState(false)
  const [recurringStartDate, setRecurringStartDate] = useState(new Date().toISOString().split('T')[0])
  
  // Auto-hide settings for completed/cancelled orders
  type AutoHideOption = 'never' | 'immediate' | '24h' | '48h' | '1week' | '2weeks' | '1month'
  const [autoHideSetting] = useState<AutoHideOption>('never')
  
  // Wine config modal
  const [showWineConfigModal, setShowWineConfigModal] = useState(false)
  const [configWine, setConfigWine] = useState<WineType | null>(null)
  const [configQuantity, setConfigQuantity] = useState(6)
  const [configUnitType, setConfigUnitType] = useState<'case' | 'bottle'>('bottle')
  const [configBottlesPerCase, setConfigBottlesPerCase] = useState(12)
  const [configSaveAsDefault, setConfigSaveAsDefault] = useState(false)
  const [configSelectedProviders, setConfigSelectedProviders] = useState<string[]>([])
  const [configNotes, setConfigNotes] = useState('')
  const [configPriceMode, setConfigPriceMode] = useState<'custom' | 'ask_provider'>('custom')
  const [configCustomPrice, setConfigCustomPrice] = useState<number>(0)
  const [providerSearchQuery, setProviderSearchQuery] = useState('')
  
  // Multi-provider approval pagination
  const [currentApprovalIndex, setCurrentApprovalIndex] = useState(0)
  const [allProviderResponses, setAllProviderResponses] = useState<OrderApprovalData[]>([])

  
  // Wine list pagination for create order modal
  const [wineListLimit, setWineListLimit] = useState(20)
  const WINES_PER_PAGE = 20

  // Error handling
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Request notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        console.log('Notification permission:', permission)
      })
    }
  }, [])

  // Listen for draft_ready notifications from the WebSocket bridge
  useEffect(() => {
    const handleNotification = async (event: Event) => {
      const detail = (event as CustomEvent).detail
      const payload = detail?.new as Record<string, any> | undefined
      if (!payload || payload.type !== 'draft_ready') return
      const orderId = payload.metadata?.order_id ?? payload.order_id
      if (!orderId) return
      try {
        const res = await apiClient.get(`/procurement/orders/${orderId}/draft`)
        // Backend now returns { draft: {...} | null } — unwrap the envelope.
        const draft = res.data?.draft ?? res.data
        if (draft && draft.id) {
          setDraftPanelData({
            conversationId: payload.metadata?.conversation_id ?? payload.conversation_id ?? draft.id ?? orderId,
            orderId,
            restaurantName: activeRestaurantName,
            wineName: draft.wine_name ?? payload.metadata?.wine_name ?? '',
            providerName: draft.provider_name ?? payload.metadata?.provider_name ?? '',
            providerEmail: draft.provider_email ?? '',
            emailType: draft.outbound_email_type ?? 'PRICE_INQUIRY',
            draftContent: draft.content ?? '',
            disclaimer: draft.content?.split('\n\n—\n')?.[1] ?? 'Sent via WineOps AI — This message was generated with AI assistance.',
            constraintWarnings: (draft.constraint_flags?.annotating ?? []).map((c: string) => ({
              code: c, message: c, severity: 'annotating' as const,
            })),
            roundCount: draft.round_count ?? 0,
            timestamp: draft.created_at ?? new Date().toISOString(),
          })
          setIsDraftPanelOpen(true)
        }
      } catch (err) {
        console.error('Failed to fetch pending draft:', err)
      }
    }
    window.addEventListener('notification_sent', handleNotification)
    return () => window.removeEventListener('notification_sent', handleNotification)
  }, [])

  // Check for pending reorder from Wine Library (using Zustand store instead of sessionStorage)
  useEffect(() => {
    if (pendingReorder) {
      try {
        // Add the wine to createOrderItems
        const recommended = getRecommendedProviders(providers)
        setCreateOrderItems([{
          wineId: pendingReorder.wineId,
          wineName: pendingReorder.wineName,
          quantity: pendingReorder.quantity,
          unitType: pendingReorder.unitType === 'case' ? 'case' : 'bottle',
          bottlesPerCase: pendingReorder.unitType === 'case' ? pendingReorder.bottlesPerCase || 12 : undefined,
          price: pendingReorder.price,
          providers: {
            primary: recommended.primary,
            alternatives: recommended.alternatives,
            selected: pendingReorder.selectedProviders,
          },
          notes: pendingReorder.notes || '',
        }])
        // Clear the pending reorder from store
        clearPendingReorder()
        // Open create order modal to show the pending order
        setShowCreateOrderModal(true)
        // Show notification
        alert(`✅ Reorder for "${pendingReorder.wineName}" has been loaded.\n\nReview the order details and click "Contact Providers" to proceed.`)
      } catch (error) {
        console.error('Failed to load pending reorder:', error)
        clearPendingReorder()
      }
    }
  }, [pendingReorder, providers, clearPendingReorder])

  const getStatusConfig = (status: Order['status']) => {
    const configs = {
      pending_approval: {
        label: 'Pending Approval',
        color: 'warning' as const,
        icon: Clock,
      },
      approved: {
        label: 'Approved',
        color: 'success' as const,
        icon: CheckCircle,
      },
      ordered: {
        label: 'Ordered',
        color: 'default' as const,
        icon: Package,
      },
      delivered: {
        label: 'Delivered',
        color: 'success' as const,
        icon: Truck,
      },
      cancelled: {
        label: 'Cancelled',
        color: 'destructive' as const,
        icon: XCircle,
      },
    }
    return configs[status] || configs.pending_approval
  }

  const confirmApproval = async (price: number) => {
    try {
      if (selectedOrder && isUuid(selectedOrder.order_id)) {
        await apiClient.post(`/procurement/orders/${selectedOrder.order_id}/approve`, {
          finalPrice: price,
        })
      }
      setShowApprovalModal(false)
      setSelectedOrder(null)
      // Refetch orders to sync with backend
      refetchOrders()
    } catch (error) {
      console.error('Approval failed:', error)
      alert('Failed to approve order')
    }
  }

  const handleReject = async (orderId: string) => {
    if (confirm('Are you sure you want to reject this order?')) {
      try {
        if (isUuid(orderId)) {
          await apiClient.delete(`/procurement/orders/${orderId}`)
        }
        // Refetch orders to sync with backend
        refetchOrders()
      } catch (error) {
        console.error('Rejection failed:', error)
      }
    }
  }

  const handleMarkAsOrdered = async (orderId: string) => {
    try {
      const order = orders.find(o => o.order_id === orderId)
      if (!order) {
        alert('Order not found')
        return
      }
      const inventoryMatch = inventoryById.get(order.wine_id)
      let targetWineId = inventoryMatch?.wineId || order.wine_id
      const resolvedName = resolveOrderWineName(order)
      let createdInventoryId: string | undefined
      if (!inventoryMatch && user?.restaurantId && wineNameById.has(order.wine_id)) {
        try {
          const createdInventory = await inventoryApi.createInventoryItem(
            {
              wineId: order.wine_id,
              stockLive: 0,
              costPerBottle: order.final_price || order.suggested_price || 0,
              thresholdMin: 10,
            },
            user.restaurantId
          )
          createdInventoryId = createdInventory.id
          targetWineId = createdInventory.wineId || order.wine_id
          await dispatchInventoryUpdate({
            type: 'add',
            wineId: targetWineId,
            wineName: resolvedName,
            quantity: 0,
            source: 'order_placed',
            timestamp: new Date().toISOString(),
            metadata: {
              inventoryId: createdInventoryId,
              action: 'created_from_order',
            },
          })
        } catch (error) {
          console.error('Failed to create inventory for order:', error)
        }
      }
      if (isUuid(orderId)) {
        await apiClient.patch(`/procurement/orders/${orderId}`, {
          status: 'CONFIRMED',
        })
      }
      
      const orderedAt = new Date().toISOString()
      // Update order status from 'approved' to 'ordered' (optimistic update)
      setOrders(prev => prev.map(order => 
        order.order_id === orderId 
          ? { ...order, status: 'ordered' }
          : order
      ))
      // Refetch orders to sync with backend
      refetchOrders()

      // Move expected stock into shadow stock on order placement
      await dispatchInventoryUpdate({
        type: 'stock_change',
        wineId: targetWineId,
        wineName: resolvedName,
        quantity: order.quantity,
        source: 'order_placed',
        timestamp: orderedAt,
        metadata: {
          orderId: orderId,
          inventoryId: createdInventoryId || order.wine_id,
          stockType: 'shadow',
          cost: order.final_price || order.suggested_price || 0,
          provider: order.provider_name || 'Unknown Provider',
          action: 'order_placed',
        }
      })
      const inventoryIdToUpdate = createdInventoryId || inventoryMatch?.id || order.wine_id
      if (inventoryIdToUpdate && user?.restaurantId) {
        const currentShadow = inventoryMatch?.shadowStock || 0
        const nextShadow = createdInventoryId ? order.quantity : currentShadow + order.quantity
        try {
          await inventoryApi.updateInventoryItem(
            inventoryIdToUpdate,
            { shadowStock: nextShadow },
            user.restaurantId
          )
        } catch (error) {
          // Shadow stock update failed — non-fatal
        }
      }
      
      alert('✅ Order marked as ordered!\n\nThe order has been placed with the provider.')
    } catch (error) {
      console.error('Failed to mark as ordered:', error)
      alert('Failed to mark order as ordered. Please try again.')
    }
  }

  const handleMarkAsDelivered = async (orderId: string) => {
    try {
      const order = orders.find(o => o.order_id === orderId)
      if (!order) {
        alert('Order not found')
        return
      }

      const inventoryMatch = inventoryById.get(order.wine_id)
      const targetWineId = inventoryMatch?.wineId || order.wine_id
      const resolvedName = resolveOrderWineName(order)

      // Try API call when this is a real backend order
      if (isUuid(orderId)) {
        await apiClient.post(`/procurement/orders/${orderId}/deliver`, {}, {
          params: { quantityReceived: order.quantity },
        })
      }
      
      const deliveredAt = new Date().toISOString()
      
      // Update order status from 'ordered' to 'delivered' (optimistic update)
      setOrders(prev => prev.map(o => 
        o.order_id === orderId 
          ? { ...o, status: 'delivered', delivered_at: deliveredAt }
          : o
      ))
      // Refetch orders to sync with backend
      refetchOrders()
      
      // Dispatch order update event for cross-page sync
      dispatchOrderUpdate({
        type: 'delivered',
        orderId: orderId,
        wineId: targetWineId,
        quantity: order.quantity,
        timestamp: deliveredAt,
        metadata: {
          action: 'shadow_to_live',
          transferFrom: 'shadow',
          transferTo: 'live',
          inventoryId: order.wine_id,
        }
      })

      // Also try API call for persistence
      try {
        await axios.post(`${API_URL}/api/v1/inventory/add-from-order`, {
          orderId: orderId,
          wineId: targetWineId,
          wineName: resolvedName,
          quantity: order.quantity,
          cost: order.final_price || order.suggested_price || 0,
          provider: order.provider_name || 'Unknown Provider',
          stockAction: 'shadow_to_live',
          transferFrom: 'shadow',
          transferTo: 'live',
        }).catch(err => {
          console.log('Inventory API endpoint not ready yet:', err.message)
        })

        // Create notification in One-Tap Action Center
        console.log('📦 Stock Receipt Notification:', {
          type: 'stock_receipt',
          wine: order.wine_name,
          quantity: order.quantity,
          orderId: orderId
        })

        alert(`✅ Order marked as delivered!

${resolvedName} - ${order.quantity} bottles

Shadow stock has been moved to Live Stock.`)
      } catch (error) {
        console.error('Failed to add to inventory:', error)
        alert('⚠️ Order marked as delivered, but failed to add to inventory. Please check inventory manually.')
      }
    } catch (error) {
      console.error('Failed to mark as delivered:', error)
      alert('Failed to mark order as delivered. Please try again.')
    }
  }

  // Create Order functions - Only show active wines
  const filteredWines = useMemo(() => {
    const uiWines = mapApiWinesToUiWines(apiWines)
    const query = wineSearch.toLowerCase()
    return uiWines.filter(
      wine =>
        (wine.isActive !== false) &&
        (wine.name.toLowerCase().includes(query) ||
          wine.producer.toLowerCase().includes(query)),
    )
  }, [apiWines, wineSearch])

  // Open wine config modal when clicking a wine
  const openWineConfigModal = (wine: WineType) => {
    const recommended = getRecommendedProviders(providers)
    setConfigWine(wine)
    setConfigQuantity(wine.threshold || 6)
    setConfigSelectedProviders(recommended.primary ? [recommended.primary.id] : [])
    setConfigNotes('')
    setConfigPriceMode('custom')
    setConfigCustomPrice(wine.price)
    setShowWineConfigModal(true)
  }

  // Toggle provider selection
  const toggleProvider = (providerId: string) => {
    setConfigSelectedProviders(prev => {
      if (prev.includes(providerId)) {
        // Don't allow deselecting if it's the only one
        if (prev.length === 1) return prev
        return prev.filter(id => id !== providerId)
      }
      return [...prev, providerId]
    })
  }

  // Select all providers
  const selectAllProviders = () => {
    if (!configWine) return
    const recommended = getRecommendedProviders(providers)
    const allProviders = [
      recommended.primary,
      ...recommended.alternatives,
      ...providers.filter(p => 
        p.id !== recommended.primary?.id && 
        !recommended.alternatives.some(a => a.id === p.id)
      )
    ].filter(Boolean) as Provider[]
    
    const allProviderIds = allProviders.map(p => p.id)
    setConfigSelectedProviders(allProviderIds)
  }

  // Add wine with config to order
  const confirmWineConfig = () => {
    if (!configWine || configSelectedProviders.length === 0) return

    const recommended = getRecommendedProviders(providers)
    const existing = createOrderItems.find(item => item.wineId === configWine.id)
    
    if (existing) {
      // Update existing item
      setCreateOrderItems(items =>
        items.map(item =>
          item.wineId === configWine.id
            ? {
                ...item,
                bottleSizeMl: configWine.bottleSizeMl ?? item.bottleSizeMl ?? 750,
                quantity: configQuantity,
                unitType: configUnitType,
                bottlesPerCase: configUnitType === 'case' ? configBottlesPerCase : undefined,
                providers: {
                  ...item.providers,
                  selected: configSelectedProviders,
                },
                notes: configNotes,
              }
            : item
        )
      )
    } else {
      // Add new item
      setCreateOrderItems(items => [
        ...items,
        {
          wineId: configWine.id,
          wineName: configWine.name,
          bottleSizeMl: configWine.bottleSizeMl ?? 750,
          quantity: configQuantity,
          unitType: configUnitType,
          bottlesPerCase: configUnitType === 'case' ? configBottlesPerCase : undefined,
          price: configWine.price,
          providers: {
            primary: recommended.primary,
            alternatives: recommended.alternatives,
            selected: configSelectedProviders,
          },
          notes: configNotes,
        },
      ])
    }

    setShowWineConfigModal(false)
    setConfigWine(null)
  }

  const updateItemQuantity = (wineId: string, delta: number) => {
    setCreateOrderItems(items =>
      items.map(item =>
        item.wineId === wineId
          ? { ...item, quantity: Math.max(1, item.quantity + delta) }
          : item
      )
    )
  }

  const removeItem = (wineId: string) => {
    setCreateOrderItems(items => items.filter(item => item.wineId !== wineId))
  }

  // Edit item - reopen config modal
  const editItem = (item: CreateOrderItem) => {
    const wine = filteredWines.find(w => w.id === item.wineId)
    if (wine) {
      setConfigWine(wine)
      setConfigQuantity(item.quantity)
      setConfigUnitType(item.unitType)
      setConfigBottlesPerCase(item.bottlesPerCase || 12)
      setConfigSelectedProviders(item.providers.selected)
      setConfigNotes(item.notes)
      setShowWineConfigModal(true)
    }
  }

  const totalOrderValue = createOrderItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  )

  const handleContactProviders = async () => {
    if (!user?.restaurantId) {
      alert('Please sign in and select a restaurant before creating orders.')
      return
    }

    // Pre-flight guard: block order creation when no vendors are configured
    if (!providers || providers.length === 0) {
      setShowOrderGuard(true)
      return
    }

    if (createOrderItems.length === 0) {
      alert('Add at least one wine to create an order.')
      return
    }

    if (isCreatingRecurring) {
      alert('Recurring orders are not supported yet. Create a one-time order instead.')
      return
    }

    const selectedProvidersTotal = createOrderItems.reduce(
      (sum, item) => sum + item.providers.selected.length,
      0
    )
    if (selectedProvidersTotal === 0) {
      alert('Select at least one provider to create an order.')
      return
    }

    setActionLoading('create-orders')
    const createdOrders: Order[] = []
    const failures: string[] = []

    try {
      for (const item of createOrderItems) {
        const wineNameKey = item.wineName ? item.wineName.toLowerCase() : ''
        let inventoryItem =
          inventoryByWineKey.get(item.wineId) ||
          (wineNameKey ? inventoryByWineKey.get(wineNameKey) : undefined)

        if (!inventoryItem) {
          if (!user?.restaurantId) {
            failures.push(`No inventory match for ${item.wineName}`)
            continue
          }
          try {
            const primaryProviderId =
              item.providers.primary?.id || item.providers.selected[0]
            const createdInventory = await inventoryApi.createInventoryItem(
              {
                wineId: item.wineId,
                providerId: primaryProviderId || undefined,
                stockLive: 0,
                costPerBottle: item.price,
                thresholdMin: 10,
              },
              user.restaurantId
            )
            inventoryItem = {
              id: createdInventory.id,
              wineId: createdInventory.wineId || item.wineId,
              wineName: createdInventory.wineName || item.wineName,
            }
          } catch (_createError: any) {
            // Fast path: backend 409 now includes the existing item's ID directly
            const existingId = _createError?.response?.data?.existingId
            if (existingId) {
              inventoryItem = { id: existingId, wineId: item.wineId, wineName: item.wineName }
            } else {
              // Fallback: fetch all inventory (including recently re-activated items).
              // Backend returns snake_case DB fields (master_wine_id, wine_name).
              try {
                const rawInventory = await getInventory(user.restaurantId)
                const allInventory = rawInventory.map((inv: any) => ({
                  ...inv,
                  wineId: inv.wineId ?? inv.master_wine_id,
                  wineName: inv.wineName ?? inv.wine_name ?? inv.master_wine_library?.name,
                }))
                const existing = allInventory.find(
                  (inv: any) =>
                    inv.wineId === item.wineId ||
                    (item.wineName && inv.wineName?.toLowerCase() === item.wineName.toLowerCase())
                )
                if (existing) {
                  inventoryItem = {
                    id: existing.id,
                    wineId: existing.wineId || item.wineId,
                    wineName: existing.wineName || item.wineName,
                  }
                } else {
                  failures.push(`Could not create or find inventory for ${item.wineName}`)
                  continue
                }
              } catch {
                failures.push(`Failed to add ${item.wineName} to inventory`)
                continue
              }
            }
          }

        }

        for (const providerId of item.providers.selected) {
          try {
            const response = await apiClient.post('/procurement/orders', {
              inventoryId: inventoryItem.id,
              providerId,
              quantity: item.quantity,
              unitType: item.unitType,
              quotedPrice: item.price,
              totalCost: item.price * item.quantity,
              managerNotes: item.notes || undefined,
            })
            const created = mapApiOrderToUi(response.data)
            const resolvedName = resolveOrderWineName(created, item.wineName)
            const normalizedCreated =
              created.wine_name && !isUuid(created.wine_name)
                ? created
                : { ...created, wine_name: resolvedName }
            createdOrders.push(normalizedCreated)
            dispatchOrderUpdate({
              type: 'created',
              orderId: normalizedCreated.order_id,
              wineId: normalizedCreated.wine_id,
              quantity: normalizedCreated.quantity,
              providerId: providerId,
              timestamp: normalizedCreated.created_at,
            })
          } catch (error: any) {
            // 403 no_vendors safety net: backend guard triggered
            if (
              error?.response?.status === 403 &&
              error?.response?.data?.reason === 'no_vendors'
            ) {
              setShowOrderGuard(true)
              setShowCreateOrderModal(false)
              setActionLoading(null)
              return
            }
            const message = error?.response?.data?.message || error?.message || 'Failed to create order'
            failures.push(`${item.wineName}: ${message}`)
          }
        }
      }

      if (createdOrders.length) {
        // Do NOT optimistically prepend — dispatchOrderUpdate already fires a window
        // 'order_change' event that invalidates the React Query cache synchronously,
        // triggering a background refetch.  If the refetch resolves before this line
        // runs, prev already includes the new orders and the prepend duplicates them.
        // Let the explicit refetchOrders() below be the single source of truth.
        refetchOrders()

        // Auto-popup draft panel: the Python agent needs ~5–20 s to classify,
        // build context, and insert the draft (longer when RabbitMQ must
        // round-trip to a remote broker).  Poll at increasing intervals so we
        // catch both fast (local) and slow (Railway cold-start) pipelines.
        const tryOpenDraft = async (orderId: string, fallbackOrder: typeof createdOrders[number]) => {
          try {
            const res = await apiClient.get(`/procurement/orders/${orderId}/draft`)
            // Backend now returns { draft: {...} | null } — unwrap the envelope.
            const draft = res.data?.draft ?? res.data
            if (draft && (draft.id || draft.conversationId)) {
              const conversationId = draft.conversationId ?? draft.id ?? orderId
              const rawContent = draft.draftContent ?? draft.content ?? ''
              const [bodyPart, disclaimerPart] = rawContent.split('\n\n—\n')
              setDraftPanelData({
                conversationId,
                orderId,
                restaurantName: activeRestaurantName,
                orderNumber: (fallbackOrder as any).orderNumber ?? undefined,
                wineName: fallbackOrder.wine_name || draft.wineName || draft.wine_name || 'Wine',
                quantity: fallbackOrder.quantity ?? undefined,
                providerName: draft.provider_name || draft.providerName || (/^[0-9a-f-]{36}$/i.test(fallbackOrder.provider_name ?? '') ? '' : fallbackOrder.provider_name) || 'Provider',
                providerEmail: draft.providerEmail ?? draft.provider_email ?? '',
                emailType: draft.emailType ?? draft.outbound_email_type ?? 'PRICE_INQUIRY',
                draftContent: bodyPart ?? rawContent,
                disclaimer: disclaimerPart ?? 'Sent via WineOps AI — This message was generated with AI assistance.',
                constraintWarnings: (draft.constraintWarnings ?? draft.constraint_flags?.annotating ?? []).map((c: any) => ({
                  code: typeof c === 'string' ? c : (c.code ?? 'C-??'),
                  message: typeof c === 'string' ? c : (c.message ?? ''),
                  severity: c.severity ?? 'annotating',
                })),
                roundCount: draft.roundCount ?? draft.round_count ?? 1,
                timestamp: draft.createdAt ?? draft.created_at ?? new Date().toISOString(),
              })
              setIsDraftPanelOpen(true)
              window.dispatchEvent(new Event('draftPanelOpened'))
              return true
            }
          } catch {
            // not ready yet — caller retries
          }
          return false
        }

        const pollForDraft = async () => {
          for (const order of createdOrders) {
            const found = await tryOpenDraft(order.order_id, order)
            if (found) return
          }
        }

        // Exponential-ish schedule: 6 s → 12 s → 20 s → 35 s → 55 s
        // Covers both fast LLM responses and Railway cold-start latency.
        const POLL_DELAYS = [6000, 12000, 20000, 35000, 55000]
        let pollStopped = false
        const schedulePolls = () => {
          POLL_DELAYS.forEach((delay) => {
            setTimeout(async () => {
              if (pollStopped) return
              await pollForDraft()
            }, delay)
          })
        }
        schedulePolls()
        // Cancel remaining polls once the panel opens
        const cancelPolls = () => { pollStopped = true }
        window.addEventListener('draftPanelOpened', cancelPolls, { once: true })
      }

      if (failures.length) {
        alert(`Some orders failed:\n\n${failures.slice(0, 5).join('\n')}${failures.length > 5 ? '\n...' : ''}`)
      } else {
        alert(`✅ Created ${createdOrders.length} order(s) successfully. Check for the AI draft email that will appear shortly.`)
      }
    } finally {
      setActionLoading(null)
    }

    setCreateOrderItems([])
    setShowCreateOrderModal(false)
    setIsCreatingRecurring(false)
    setRecurringFrequency('weekly')
    setRecurringAutoApprove(false)
    setRecurringStartDate(new Date().toISOString().split('T')[0])
  }

  // Apply auto-hide logic on top of hook's searchFilteredOrders.
  // Cancelled orders are always hidden from "all" view — they live under the
  // "Cancelled" filter. Delivered orders stay visible (autoHideSetting handles those).
  const filteredOrders = useMemo(() => {
    return searchFilteredOrders.filter((order) => {
      // Cancelled: only show when explicitly filtering for them
      if (order.status === 'cancelled' && filterStatus !== 'cancelled') return false

      if (order.status === 'delivered' && autoHideSetting !== 'never') {
        const completedDate = new Date(order.delivered_at || order.created_at)
        const now = new Date()
        const hoursSince = (now.getTime() - completedDate.getTime()) / (1000 * 60 * 60)

        switch (autoHideSetting) {
          case 'immediate': return false
          case '24h': if (hoursSince >= 24) return false; break
          case '48h': if (hoursSince >= 48) return false; break
          case '1week': if (hoursSince >= 24 * 7) return false; break
          case '2weeks': if (hoursSince >= 24 * 14) return false; break
          case '1month': if (hoursSince >= 24 * 30) return false; break
        }
      }
      return true
    })
  }, [searchFilteredOrders, autoHideSetting, filterStatus])

  // Re-sort filteredOrders (hook's sortedOrders is based on searchFilteredOrders, not filteredOrders)
  const sortedOrdersWithAutoHide = useMemo(() => {
    const copy = [...filteredOrders]
    copy.sort((a, b) => {
      const aTime = new Date(a.created_at).getTime()
      const bTime = new Date(b.created_at).getTime()
      return bTime - aTime
    })
    return copy
  }, [filteredOrders])

  // Re-group sortedOrdersWithAutoHide (hook's groupedOrders is based on sortedOrders, not sortedOrdersWithAutoHide)
  const groupedOrdersWithAutoHide = useMemo(() => {
    const sourceOrders = sortedOrdersWithAutoHide
    if (groupBy === 'wine') {
      const groups: { [key: string]: Order[] } = {}
      sourceOrders.forEach(order => {
        const wineName = resolveOrderWineName(order)
        if (!groups[wineName]) {
          groups[wineName] = []
        }
        groups[wineName].push(order)
      })
      return groups
    } else {
      const groups: { [key: string]: Order[] } = {}
      sourceOrders.forEach(order => {
        const providerName = resolveOrderProviderName(order)
        if (!groups[providerName]) {
          groups[providerName] = []
        }
        groups[providerName].push(order)
      })
      return groups
    }
  }, [sortedOrdersWithAutoHide, groupBy, resolveOrderWineName, resolveOrderProviderName])

  const oneTimeOrders = orders.filter(o => !o.isRecurring)
  const recurringOrders = orders.filter(o => o.isRecurring)
  const pendingCount = oneTimeOrders.filter((o) => o.status === 'pending_approval').length
  const approvedCount = oneTimeOrders.filter((o) => o.status === 'approved').length
  const orderedCount = oneTimeOrders.filter((o) => o.status === 'ordered').length
  const deliveredCount = oneTimeOrders.filter((o) => o.status === 'delivered').length

  // Bulk action handlers with multi-status support
  const handleBulkApprove = useCallback(async () => {
    if (selectedOrders.size === 0) return
    setActionLoading('bulk-approve')
    
    try {
      const ordersToApprove = orders.filter(o => 
        selectedOrders.has(o.order_id) && o.status === 'pending_approval'
      )
      
      // Update all selected orders
      setOrders(prev => prev.map(order => 
        selectedOrders.has(order.order_id) && order.status === 'pending_approval'
          ? { ...order, status: 'approved', approved_at: new Date().toISOString(), final_price: order.suggested_price }
          : order
      ))
      
      // Check if there are other actionable orders still selected
      const selectedOrdersList = orders.filter(o => selectedOrders.has(o.order_id))
      const hasOtherActionableOrders = selectedOrdersList.some(o => 
        o.status === 'approved' || o.status === 'ordered'
      )
      
      // Only clear selection if no other actionable orders remain
      if (!hasOtherActionableOrders) {
        setSelectedOrders(new Set())
      }
      
      alert(`✅ ${ordersToApprove.length} order(s) approved!${hasOtherActionableOrders ? '\n\n📋 Other selected orders remain - you can continue with bulk actions.' : ''}`)
    } catch (err) {
      setError('Failed to approve orders')
    } finally {
      setActionLoading(null)
    }
  }, [selectedOrders, orders])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to close modals
      if (e.key === 'Escape') {
        setShowCreateOrderModal(false)
        setShowOrderApprovalModal(false)
        setShowWineConfigModal(false)
        setSelectedOrders(new Set())
      }
      // Cmd/Ctrl + N to create new order
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        openCreateOrderFlow()
      }
      // Cmd/Ctrl + A to select all visible orders
      if ((e.metaKey || e.ctrlKey) && e.key === 'a' && !showCreateOrderModal) {
        e.preventDefault()
        const visibleOrderIds = orders
          .filter(o => !o.isRecurring)
          .map(o => o.order_id)
        setSelectedOrders(new Set(visibleOrderIds))
      }
      // Cmd/Ctrl + Shift + A to approve selected orders
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        handleBulkApprove()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [orders, showCreateOrderModal, handleBulkApprove])

  const handleBulkMarkAsOrdered = useCallback(async () => {
    if (selectedOrders.size === 0) return
    setActionLoading('bulk-ordered')
    
    try {
      const ordersToMark = orders.filter(o => 
        selectedOrders.has(o.order_id) && o.status === 'approved'
      )
      
      setOrders(prev => prev.map(order => 
        selectedOrders.has(order.order_id) && order.status === 'approved'
          ? { ...order, status: 'ordered' }
          : order
      ))
      
      // Check if there are other actionable orders still selected
      const selectedOrdersList = orders.filter(o => selectedOrders.has(o.order_id))
      const hasOtherActionableOrders = selectedOrdersList.some(o => 
        o.status === 'pending_approval' || o.status === 'ordered'
      )
      
      // Only clear selection if no other actionable orders remain
      if (!hasOtherActionableOrders) {
        setSelectedOrders(new Set())
      }
      
      alert(`✅ ${ordersToMark.length} order(s) marked as ordered!${hasOtherActionableOrders ? '\n\n📋 Other selected orders remain - you can continue with bulk actions.' : ''}`)
    } catch (err) {
      setError('Failed to mark orders as ordered')
    } finally {
      setActionLoading(null)
    }
  }, [selectedOrders, orders])

  const handleBulkMarkAsDelivered = useCallback(async () => {
    if (selectedOrders.size === 0) return
    setActionLoading('bulk-delivered')
    
    try {
      const ordersToMark = orders.filter(o => 
        selectedOrders.has(o.order_id) && o.status === 'ordered'
      )
      
      setOrders(prev => prev.map(order => 
        selectedOrders.has(order.order_id) && order.status === 'ordered'
          ? { ...order, status: 'delivered', delivered_at: new Date().toISOString() }
          : order
      ))
      
      // Check if there are other actionable orders still selected
      const selectedOrdersList = orders.filter(o => selectedOrders.has(o.order_id))
      const hasOtherActionableOrders = selectedOrdersList.some(o => 
        o.status === 'pending_approval' || o.status === 'approved'
      )
      
      // Only clear selection if no other actionable orders remain
      if (!hasOtherActionableOrders) {
        setSelectedOrders(new Set())
      }
      
      alert(`✅ ${ordersToMark.length} order(s) marked as delivered!\n\nWines have been added to Shadow Stock.${hasOtherActionableOrders ? '\n\n📋 Other selected orders remain - you can continue with bulk actions.' : ''}`)
    } catch (err) {
      setError('Failed to mark orders as delivered')
    } finally {
      setActionLoading(null)
    }
  }, [selectedOrders, orders])

  const handleBulkReject = useCallback(async () => {
    if (selectedOrders.size === 0) return
    
    const ordersToReject = orders.filter(o => 
      selectedOrders.has(o.order_id) && o.status === 'pending_approval'
    )
    
    if (!confirm(`Reject ${ordersToReject.length} pending order(s)?`)) return
    
    setActionLoading('bulk-reject')
    
    try {
      setOrders(prev => prev.map(order => 
        selectedOrders.has(order.order_id) && order.status === 'pending_approval'
          ? { ...order, status: 'cancelled' }
          : order
      ))
      
      // Check if there are other actionable orders still selected
      const selectedOrdersList = orders.filter(o => selectedOrders.has(o.order_id))
      const hasOtherActionableOrders = selectedOrdersList.some(o => 
        o.status === 'approved' || o.status === 'ordered'
      )
      
      // Only clear selection if no other actionable orders remain
      if (!hasOtherActionableOrders) {
        setSelectedOrders(new Set())
      }
      
      alert(`❌ ${ordersToReject.length} order(s) rejected${hasOtherActionableOrders ? '\n\n📋 Other selected orders remain - you can continue with bulk actions.' : ''}`)
    } catch (err) {
      setError('Failed to reject orders')
    } finally {
      setActionLoading(null)
    }
  }, [selectedOrders, orders])

  const toggleOrderSelection = (orderId: string) => {
    const newSelected = new Set(selectedOrders)
    if (newSelected.has(orderId)) {
      newSelected.delete(orderId)
    } else {
      newSelected.add(orderId)
    }
    setSelectedOrders(newSelected)
  }

  // Filter orders with search

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-wine-200 border-t-wine-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading orders...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <Header title="Order Management" subtitle="Review and approve wine procurement orders" />

      <div className="p-6">
        {/* Error Banner */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-600" />
              <span className="text-red-700 font-medium">{error}</span>
            </div>
            <button onClick={() => setError(null)} className="p-1 hover:bg-red-100 rounded">
              <X className="w-4 h-4 text-red-600" />
            </button>
          </motion.div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-bold text-gray-900">Order Management</h2>
            {/* View Mode Toggle */}
            <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setViewMode('unified')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'unified'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
                title="Unified Table View"
              >
                <Package className="w-4 h-4 inline mr-1" />
                Unified
              </button>
              <button
                onClick={() => setViewMode('split')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'split'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
                title="Split View"
              >
                <RefreshCw className="w-4 h-4 inline mr-1" />
                Split
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search orders... (⌘K)"
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-64 focus:ring-2 focus:ring-wine-500 focus:border-transparent"
              />
            </div>
            <Button
              variant="default"
              onClick={openCreateOrderFlow}
              className="bg-wine-600 hover:bg-wine-700 shadow-lg shadow-wine-600/30"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Order
              <span className="ml-2 text-xs opacity-70">⌘N</span>
            </Button>
          </div>
        </div>

        <OrderSummary
          pendingCount={pendingCount}
          approvedCount={approvedCount}
          orderedCount={orderedCount}
          deliveredCount={deliveredCount}
          recurringActiveCount={recurringOrders.filter(o => o.recurrence?.isActive).length}
          orderAnalytics={orderAnalytics}
          filterStatus={filterStatus}
          onToggleStatusFilter={toggleStatusFilter}
          activeDraftsCount={activeConversations.length}
          onActiveDraftsClick={() => {
            const first = activeConversations[0]
            if (first) {
              setCommsDrawerOrder({
                orderId: first.orderId,
                wineName: first.wineName ?? 'Order',
                orderStatus: 'pending_approval',
              })
            }
          }}
        />

         {/* Bulk Actions Bar */}
         <AnimatePresence>
           {selectedOrders.size > 0 && (() => {
             const selectedOrdersList = orders.filter(o => selectedOrders.has(o.order_id))
             const pendingCount = selectedOrdersList.filter(o => o.status === 'pending_approval').length
             const approvedCount = selectedOrdersList.filter(o => o.status === 'approved').length
             const orderedCount = selectedOrdersList.filter(o => o.status === 'ordered').length
             
             return (
               <motion.div
                 initial={{ opacity: 0, y: -20 }}
                 animate={{ opacity: 1, y: 0 }}
                 exit={{ opacity: 0, y: -20 }}
                 className="mb-6 p-4 bg-wine-50 border border-wine-200 rounded-xl"
               >
                 <div className="flex items-center justify-between mb-3">
                   <div className="flex items-center gap-3">
                     <div className="p-2 bg-wine-100 rounded-lg">
                       <Check className="w-5 h-5 text-wine-600" />
                     </div>
                     <div>
                       <span className="font-semibold text-wine-900">
                         {selectedOrders.size} order{selectedOrders.size !== 1 ? 's' : ''} selected
                       </span>
                       <p className="text-xs text-gray-600 mt-0.5">
                         {pendingCount > 0 && `${pendingCount} pending`}
                         {approvedCount > 0 && ` • ${approvedCount} approved`}
                         {orderedCount > 0 && ` • ${orderedCount} ordered`}
                       </p>
                     </div>
                   </div>
                   <Button
                     size="sm"
                     variant="outline"
                     onClick={() => setSelectedOrders(new Set())}
                   >
                     <X className="w-4 h-4 mr-1" />
                     Clear
                   </Button>
                 </div>
                 
                 <div className="flex items-center gap-2 flex-wrap">
                   {/* Pending Actions */}
                   {pendingCount > 0 && (
                     <>
                       <Button
                         size="sm"
                         onClick={handleBulkApprove}
                         disabled={actionLoading === 'bulk-approve'}
                         title="Shortcut: Cmd/Ctrl+Shift+A"
                         className="bg-emerald-600 hover:bg-emerald-700"
                       >
                         {actionLoading === 'bulk-approve' ? (
                           <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                         ) : (
                           <CheckCircle className="w-4 h-4 mr-1" />
                         )}
                         Approve ({pendingCount})
                       </Button>
                       <Button
                         size="sm"
                         variant="outline"
                         onClick={handleBulkReject}
                         disabled={actionLoading === 'bulk-reject'}
                         className="text-red-600 hover:bg-red-50 border-red-300"
                       >
                         <XCircle className="w-4 h-4 mr-1" />
                         Reject ({pendingCount})
                       </Button>
                     </>
                   )}
                   
                   {/* Approved Actions */}
                   {approvedCount > 0 && (
                     <Button
                       size="sm"
                       onClick={handleBulkMarkAsOrdered}
                       disabled={actionLoading === 'bulk-ordered'}
                       className="bg-blue-600 hover:bg-blue-700"
                     >
                       {actionLoading === 'bulk-ordered' ? (
                         <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                       ) : (
                         <ShoppingCart className="w-4 h-4 mr-1" />
                       )}
                       Mark as Ordered ({approvedCount})
                     </Button>
                   )}
                   
                   {/* Ordered Actions */}
                   {orderedCount > 0 && (
                     <Button
                       size="sm"
                       onClick={handleBulkMarkAsDelivered}
                       disabled={actionLoading === 'bulk-delivered'}
                       className="bg-purple-600 hover:bg-purple-700"
                     >
                       {actionLoading === 'bulk-delivered' ? (
                         <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                       ) : (
                         <Truck className="w-4 h-4 mr-1" />
                       )}
                       Mark as Delivered ({orderedCount})
                     </Button>
                   )}
                 </div>
               </motion.div>
             )
           })()}
         </AnimatePresence>
        {/* UNIFIED VIEW - State-of-the-Art Table */}
        {viewMode === 'unified' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            {/* Advanced Filters */}
            <Card variant="glass" padding="md">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-1">
                  {/* Order Type Filter */}
                  <select
                    value={filterOrderType}
                    onChange={(e) => setFilterOrderType(e.target.value as any)}
                    className="px-4 py-2 border border-gray-200 rounded-lg bg-white text-sm font-medium"
                  >
                    <option value="all">All Orders</option>
                    <option value="one-time">One-Time Only</option>
                    <option value="recurring">Recurring Only</option>
                  </select>

                  {/* Status Filter */}
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="px-4 py-2 border border-gray-200 rounded-lg bg-white text-sm font-medium"
                  >
                    <option value="all">All Status</option>
                    <option value="pending_approval">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="ordered">Ordered</option>
                    <option value="delivered">Delivered</option>
                    <option value="cancelled">Cancelled</option>
                  </select>

                  {/* Group By */}
                  <div className="flex items-center gap-2 bg-white rounded-lg p-1 border border-gray-200">
                    <button
                      onClick={() => setGroupBy('wine')}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        groupBy === 'wine'
                          ? 'bg-wine-600 text-white'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      <Wine className="w-4 h-4 inline mr-1" />
                      By Wine
                    </button>
                    <button
                      onClick={() => setGroupBy('provider')}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        groupBy === 'provider'
                          ? 'bg-wine-600 text-white'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      <Building2 className="w-4 h-4 inline mr-1" />
                      By Provider
                    </button>
                  </div>
                </div>

                {/* Quick Select & Stats */}
                <div className="flex items-center gap-4 px-4 py-2 bg-gray-50 rounded-lg">
                    <div className="text-center">
                      <p className="text-lg font-bold text-gray-900">
                        {orders.filter(o => filterOrderType === 'all' || (filterOrderType === 'recurring' ? o.isRecurring : !o.isRecurring)).length}
                      </p>
                      <p className="text-[10px] text-gray-500 uppercase">Total</p>
                    </div>
                    <div className="w-px h-8 bg-gray-200" />
                    <div className="text-center">
                      <p className="text-lg font-bold text-blue-600">
                        {orders.filter(o => o.isRecurring).length}
                      </p>
                      <p className="text-[10px] text-gray-500 uppercase">Recurring</p>
                    </div>
                  </div>
                </div>
            </Card>

            {/* Unified Orders Table */}
            <div className="space-y-4">
              {(() => {
                // Filter orders based on type and order-type (cancelled already excluded by sortedOrdersWithAutoHide)
                const filtered = sortedOrdersWithAutoHide.filter(order => {
                  const typeMatch = filterOrderType === 'all' ||
                    (filterOrderType === 'recurring' ? order.isRecurring : !order.isRecurring)
                  return typeMatch
                })

                // Group orders
                const grouped: { [key: string]: Order[] } = {}
                filtered.forEach(order => {
                  const key = groupBy === 'wine' 
                    ? resolveOrderWineName(order)
                    : resolveOrderProviderName(order)
                  if (!grouped[key]) grouped[key] = []
                  grouped[key].push(order)
                })

                if (Object.keys(grouped).length === 0) {
                  return (
                    <Card variant="glass" padding="lg">
                      <div className="text-center py-12">
                        <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">No Orders Found</h3>
                        <p className="text-gray-500">Try adjusting your filters or create a new order</p>
                      </div>
                    </Card>
                  )
                }

                return Object.entries(grouped).map(([groupName, groupOrders]) => {
                  const isExpanded = expandedGroups.has(groupName)
                  const hasRecurring = groupOrders.some(o => o.isRecurring)
                  const hasOneTime = groupOrders.some(o => !o.isRecurring)
                  
                  return (
                    <motion.div
                      key={groupName}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      layout
                    >
                      <Card variant="glass" padding="none" hover="lift">
                        {/* Group Header */}
                        <button
                          onClick={() => toggleGroup(groupName)}
                          className="w-full px-6 py-5 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-200"
                        >
                          <div className="flex items-center gap-4">
                            <motion.div
                              animate={{ rotate: isExpanded ? 90 : 0 }}
                              transition={{ duration: 0.2 }}
                            >
                              <ChevronRight className="w-6 h-6 text-gray-600" />
                            </motion.div>
                            
                            <div className="p-3 bg-wine-100 rounded-lg">
                              {groupBy === 'wine' ? (
                                <Wine className="w-6 h-6 text-wine-600" />
                              ) : (
                                <Building2 className="w-6 h-6 text-wine-600" />
                              )}
                            </div>
                            
                            <div className="text-left">
                              <div className="flex items-center gap-2">
                                <h3 className="text-xl font-bold text-gray-900">{groupName}</h3>
                                {hasRecurring && (
                                  <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded-full flex items-center gap-1">
                                    <RefreshCw className="w-3 h-3" />
                                    {groupOrders.filter(o => o.isRecurring).length} Recurring
                                  </span>
                                )}
                                {hasOneTime && (
                                  <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs font-semibold rounded-full">
                                    {groupOrders.filter(o => !o.isRecurring).length} One-Time
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-gray-600">
                                {groupOrders.length} {groupOrders.length === 1 ? 'order' : 'orders'}
                              </p>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-6">
                            <div className="text-right">
                              <p className="text-sm text-gray-600">Total Value</p>
                              <p className="text-2xl font-bold text-wine-600">
                                ${groupOrders.reduce((sum, o) => sum + (o.quantity * (o.final_price || o.suggested_price || 0)), 0).toFixed(2)}
                              </p>
                            </div>
                          </div>
                        </button>
                        
                        {/* Expandable Order List */}
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.3 }}
                              className="overflow-hidden"
                            >
                              <div className="p-4 space-y-3 bg-gray-50">
                                {groupOrders.map((order) => {
                                  const statusConfig = getStatusConfig(order.status)
                                  const StatusIcon = statusConfig.icon

                                  const isSelected = selectedOrders.has(order.order_id)
                                  const daysUntilRecurring = order.isRecurring && order.recurrence?.nextOrderDate
                                    ? Math.ceil((new Date(order.recurrence.nextOrderDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                                    : null

                                    return (
                                      <div
                                        key={order.order_id}
                                        className={`bg-white rounded-xl p-4 shadow-sm border-2 transition-all ${
                                          isSelected ? 'border-wine-500 bg-wine-50' :
                                          order.isRecurring ? 'border-blue-200 hover:border-blue-300' : 
                                          'border-gray-200 hover:shadow-md'
                                        }`}
                                      >
                                        <div className="flex items-start justify-between">
                                          {/* Selection Checkbox - Show for actionable orders */}
                                          {!order.isRecurring && order.status !== 'delivered' && order.status !== 'cancelled' && (
                                            <div className="mr-3 pt-1">
                                              <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => toggleOrderSelection(order.order_id)}
                                                className="w-4 h-4 rounded border-gray-300 text-wine-600 focus:ring-wine-500 cursor-pointer"
                                                title={`Select for bulk ${
                                                  order.status === 'pending_approval' ? 'approval/rejection' :
                                                  order.status === 'approved' ? 'ordering' :
                                                  'delivery confirmation'
                                                }`}
                                              />
                                            </div>
                                          )}
                                        <div className="flex-1">
                                          <div className="flex items-center gap-3 mb-3">
                                            <div className={`p-2 rounded-lg ${order.isRecurring ? 'bg-blue-100' : 'bg-wine-100'}`}>
                                              {order.isRecurring ? (
                                                <RefreshCw className="w-4 h-4 text-blue-600" />
                                              ) : (
                                                <StatusIcon className="w-4 h-4 text-wine-600" />
                                              )}
                                            </div>
                                            <div className="flex-1">
                                              <div className="flex items-center gap-2 mb-1">
                                                <h4 className="text-base font-semibold text-gray-900">
                                                  {groupBy === 'wine' ? (
                                                    <>
                                                      {resolveOrderWineName(order)}
                                                      <span className="text-gray-400 text-xs font-normal ml-1">
                                                        · {formatVolume(resolveOrderBottleSizeMl(order), measurementUnit)}
                                                      </span>
                                                    </>
                                                  ) : (
                                                    resolveOrderProviderName(order)
                                                  )}
                                                </h4>
                                                {order.isRecurring && (
                                                  <>
                                                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                                      order.recurrence?.frequency === 'weekly' ? 'bg-blue-100 text-blue-700' :
                                                      order.recurrence?.frequency === 'biweekly' ? 'bg-indigo-100 text-indigo-700' :
                                                      order.recurrence?.frequency === 'monthly' ? 'bg-purple-100 text-purple-700' :
                                                      'bg-gray-100 text-gray-700'
                                                    }`}>
                                                      {order.recurrence?.frequency === 'biweekly' ? 'Bi-weekly' : 
                                                       (order.recurrence?.frequency ? order.recurrence.frequency.charAt(0).toUpperCase() + order.recurrence.frequency.slice(1) : '')}
                                                    </span>
                                                    {order.recurrence?.autoApprove && (
                                                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-semibold">
                                                        Auto-Approve
                                                      </span>
                                                    )}
                                                    {!order.recurrence?.isActive && (
                                                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs font-semibold">
                                                        Paused
                                                      </span>
                                                    )}
                                                  </>
                                                )}
                                                {pendingDraftOrderIds.has(order.order_id) && (
                                                  <span
                                                    className="inline-flex items-center gap-1 text-xs bg-wine-50 text-wine-700 border border-wine-200 px-2 py-0.5 rounded-full cursor-pointer hover:bg-wine-100 transition-colors"
                                                    onClick={(e) => {
                                                      e.stopPropagation()
                                                      setCommsDrawerOrder({
                                                        orderId: order.order_id,
                                                        wineName: order.wine_name ?? 'Order',
                                                        orderStatus: order.status,
                                                      })
                                                    }}
                                                    title="AI draft ready for review"
                                                  >
                                                    <span className="w-1.5 h-1.5 rounded-full bg-wine-500 animate-pulse flex-shrink-0" />
                                                    AI Draft Ready
                                                  </span>
                                                )}
                                              </div>
                                              <p className="text-xs text-gray-500">
                                                Order #{order.order_id.slice(0, 12)}
                                              </p>
                                            </div>
                                            
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                setCommsDrawerOrder({
                                                  orderId: order.order_id,
                                                  wineName: resolveOrderWineName(order) ?? order.wine_name ?? 'Order',
                                                  orderStatus: order.status,
                                                })
                                              }}
                                              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold cursor-pointer transition-all hover:ring-2 hover:ring-offset-1 active:scale-95 ${
                                                statusConfig.color === 'warning' ? 'bg-yellow-100 text-yellow-700 hover:ring-yellow-300' :
                                                statusConfig.color === 'success' ? 'bg-emerald-100 text-emerald-700 hover:ring-emerald-300' :
                                                statusConfig.color === 'destructive' ? 'bg-red-100 text-red-700 hover:ring-red-300' :
                                                'bg-gray-100 text-gray-700 hover:ring-gray-300'
                                              }`}
                                              title="View email thread"
                                            >
                                              <MessageSquare className="w-3 h-3 flex-shrink-0" />
                                              {statusConfig.label}
                                            </button>
                                          </div>

                                          <div className="grid grid-cols-5 gap-4">
                                            <div>
                                              <p className="text-xs text-gray-500">Quantity</p>
                                              <p className="text-sm font-semibold text-gray-900">{order.quantity} bottles</p>
                                            </div>
                                            <div>
                                              <p className="text-xs text-gray-500">Price/Bottle</p>
                                              <p className="text-sm font-semibold text-gray-900">
                                                ${(order.final_price || order.suggested_price || 0).toFixed(2)}
                                              </p>
                                            </div>
                                            <div>
                                              <p className="text-xs text-gray-500">Total</p>
                                              <p className="text-sm font-semibold text-wine-600">
                                                ${((order.final_price || order.suggested_price || 0) * order.quantity).toFixed(2)}
                                              </p>
                                            </div>
                                            <div>
                                              <p className="text-xs text-gray-500">{order.isRecurring ? 'Next Order' : 'Created'}</p>
                                              <div className="flex items-center gap-1">
                                                <p className={`text-sm font-semibold ${
                                                  daysUntilRecurring !== null && daysUntilRecurring <= 2 
                                                    ? 'text-amber-600' 
                                                    : 'text-gray-900'
                                                }`}>
                                                  {order.isRecurring && order.recurrence?.nextOrderDate
                                                    ? `${daysUntilRecurring} days`
                                                    : new Date(order.created_at).toLocaleDateString()}
                                                </p>
                                                {daysUntilRecurring !== null && daysUntilRecurring <= 2 && (
                                                  <AlertTriangle className="w-3 h-3 text-amber-500" />
                                                )}
                                              </div>
                                              {order.status === 'delivered' && order.delivered_at && (
                                                <div className="mt-1">
                                                  <p className="text-xs text-gray-500">Finalized</p>
                                                  <p className="text-sm font-semibold text-gray-900">
                                                    {new Date(order.delivered_at).toLocaleDateString()}
                                                  </p>
                                                </div>
                                              )}
                                            </div>
                                            <div>
                                              <p className="text-xs text-gray-500">Type</p>
                                              <p className="text-sm font-semibold text-gray-900">
                                                {order.isRecurring ? '🔄 Recurring' : '📦 One-Time'}
                                              </p>
                                            </div>
                                          </div>
                                        </div>

                                        {/* Actions */}
                                        <div className="ml-4 flex gap-2">
                                          {order.isRecurring ? (
                                            <>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  // Toggle recurring order active status
                                                  setOrders(prev => prev.map(o => 
                                                    o.order_id === order.order_id && o.recurrence
                                                      ? { ...o, recurrence: { ...o.recurrence, isActive: !o.recurrence.isActive } }
                                                      : o
                                                  ))
                                                }}
                                                className={`p-2 rounded-lg transition-colors ${
                                                  order.recurrence?.isActive 
                                                    ? 'hover:bg-amber-100' 
                                                    : 'hover:bg-emerald-100'
                                                }`}
                                                title={order.recurrence?.isActive ? 'Pause' : 'Resume'}
                                              >
                                                {order.recurrence?.isActive ? (
                                                  <Pause className="w-4 h-4 text-amber-600" />
                                                ) : (
                                                  <Play className="w-4 h-4 text-emerald-600" />
                                                )}
                                              </button>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  // Trigger immediate order for recurring
                                                  if (confirm(`🔄 Trigger immediate recurring order for ${order.wine_name}?\n\nThis will create a new order based on your recurring schedule.`)) {
                                                    // Create a new one-time order from recurring template
                                                    const newOrderId = `ORD-${Date.now()}`
                                                    const newOrder: Order = {
                                                      order_id: newOrderId,
                                                      wine_id: order.wine_id,
                                                      wine_name: order.wine_name,
                                                      quantity: order.quantity,
                                                      provider_name: order.provider_name,
                                                      status: order.recurrence?.autoApprove ? 'approved' : 'pending_approval',
                                                      suggested_price: order.final_price || order.suggested_price,
                                                      final_price: order.recurrence?.autoApprove ? order.final_price : undefined,
                                                      created_at: new Date().toISOString(),
                                                      isRecurring: false,
                                                    }
                                                    setOrders(prev => [newOrder, ...prev])
                                                    
                                                    // Show different notification for recurring
                                                    if ('Notification' in window && Notification.permission === 'granted') {
                                                      new Notification('🔄 Recurring Order Triggered', {
                                                        body: `${order.wine_name} - ${order.quantity} bottles\nFrom: ${order.provider_name}\nStatus: ${order.recurrence?.autoApprove ? 'Auto-Approved ✓' : 'Pending Approval'}`,
                                                        icon: '/favicon.ico',
                                                        tag: `recurring-trigger-${newOrderId}`,
                                                      })
                                                    }
                                                    
                                                    alert(`🔄 RECURRING ORDER TRIGGERED\n\n` +
                                                      `Wine: ${order.wine_name}\n` +
                                                      `Quantity: ${order.quantity} bottles\n` +
                                                      `Provider: ${order.provider_name}\n` +
                                                      `Price: $${(order.final_price || order.suggested_price || 0).toFixed(2)}/bottle\n\n` +
                                                      `Status: ${order.recurrence?.autoApprove ? '✅ Auto-Approved (ready to order)' : '⏳ Pending Approval'}\n\n` +
                                                      `This order was created from your recurring schedule.\n` +
                                                      `Next scheduled order: ${order.recurrence?.nextOrderDate ? new Date(order.recurrence.nextOrderDate).toLocaleDateString() : 'N/A'}`)
                                                  }
                                                }}
                                                className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                                                title="Order Now (from recurring)"
                                              >
                                                <Zap className="w-4 h-4 text-blue-600" />
                                              </button>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  if (confirm(`Delete recurring order for ${order.wine_name}?`)) {
                                                    setOrders(prev => prev.filter(o => o.order_id !== order.order_id))
                                                  }
                                                }}
                                                className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                                                title="Delete"
                                              >
                                                <Trash2 className="w-4 h-4 text-red-600" />
                                              </button>
                                            </>
                                          ) : (
                                            <>
                                              {order.status === 'pending_approval' && (
                                                <>
                                                  <Button
                                                    size="sm"
                                                    variant="default"
                                                    onClick={() => setCommsDrawerOrder({
                                                      orderId: order.order_id,
                                                      wineName: resolveOrderWineName(order) ?? order.wine_name ?? 'Order',
                                                      orderStatus: order.status,
                                                    })}
                                                    className="bg-green-600 hover:bg-green-700"
                                                  >
                                                    <CheckCircle className="w-4 h-4 mr-1" />
                                                    Approve
                                                  </Button>
                                                  <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => handleReject(order.order_id)}
                                                    className="text-red-600 hover:bg-red-50"
                                                  >
                                                    <XCircle className="w-4 h-4 mr-1" />
                                                    Reject
                                                  </Button>
                                                </>
                                              )}
                                              {order.status === 'approved' && (
                                                <Button
                                                  size="sm"
                                                  variant="default"
                                                  onClick={() => handleMarkAsOrdered(order.order_id)}
                                                  className="bg-blue-600 hover:bg-blue-700"
                                                >
                                                  <ShoppingCart className="w-4 h-4 mr-1" />
                                                  Mark as Ordered
                                                </Button>
                                              )}
                                              {order.status === 'ordered' && (
                                                <Button
                                                  size="sm"
                                                  variant="default"
                                                  onClick={() => handleMarkAsDelivered(order.order_id)}
                                                  className="bg-purple-600 hover:bg-purple-700"
                                                >
                                                  <Truck className="w-4 h-4 mr-1" />
                                                  Mark as Delivered
                                                </Button>
                                              )}
                                              {order.status === 'delivered' && (
                                                <div className="px-4 py-2 bg-emerald-100 border border-emerald-300 rounded-lg">
                                                  <div className="flex items-center gap-2">
                                                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                                                    <span className="text-sm font-semibold text-emerald-700">Delivered</span>
                                                  </div>
                                                </div>
                                              )}
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </Card>
                    </motion.div>
                  )
                })
              })()}
            </div>
          </motion.div>
        )}

        {/* SPLIT VIEW - Original Layout */}
        {viewMode === 'split' && (
          <>
        {/* Recurring Orders Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <Card variant="glass" padding="none" className="overflow-hidden">
            {/* Recurring Orders Header */}
            <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-600 rounded-xl">
                  <RefreshCw className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Recurring Orders</h3>
                  <p className="text-sm text-gray-600">
                    {orders.filter(o => o.isRecurring).length} active schedules
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {/* Group By Toggle */}
                <div className="flex items-center gap-2 bg-white rounded-lg p-1 border border-gray-200">
                  <button
                    onClick={() => setRecurringGroupBy('wine')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      recurringGroupBy === 'wine'
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <Wine className="w-4 h-4 inline mr-1" />
                    By Wine
                  </button>
                  <button
                    onClick={() => setRecurringGroupBy('provider')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      recurringGroupBy === 'provider'
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <Building2 className="w-4 h-4 inline mr-1" />
                    By Provider
                  </button>
                </div>
                <button
                  onClick={() => setShowRecurringSection(!showRecurringSection)}
                  className="p-2 hover:bg-white rounded-lg transition-colors"
                >
                  {showRecurringSection ? (
                    <ChevronUp className="w-5 h-5 text-gray-600" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-600" />
                  )}
                </button>
              </div>
            </div>

            {/* Recurring Orders Content */}
            <AnimatePresence>
              {showRecurringSection && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="overflow-hidden"
                >
                  <div className="p-6 bg-gradient-to-b from-blue-50/30 to-white">
                    {(() => {
                      const recurringOrders = orders.filter(o => o.isRecurring)
                      
                      if (recurringOrders.length === 0) {
                        return (
                          <div className="text-center py-12">
                            <RefreshCw className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                            <h4 className="text-lg font-semibold text-gray-900 mb-2">No Recurring Orders</h4>
                            <p className="text-gray-500 mb-4">Set up automated orders for your regular stock wines</p>
                            <Button
                              onClick={() => alert('Create Recurring Order - Coming Soon!')}
                              className="bg-blue-600 hover:bg-blue-700"
                            >
                              <Plus className="w-4 h-4 mr-2" />
                              Create Recurring Order
                            </Button>
                          </div>
                        )
                      }

                      // Group recurring orders
                      const grouped: { [key: string]: Order[] } = {}
                      recurringOrders.forEach(order => {
                        const key = recurringGroupBy === 'wine' 
                          ? order.wine_name || 'Unknown Wine'
                          : order.provider_name || 'Unknown Provider'
                        if (!grouped[key]) grouped[key] = []
                        grouped[key].push(order)
                      })

                      return (
                        <div className="space-y-4">
                          {Object.entries(grouped).map(([groupName, groupOrders]) => (
                            <div key={groupName} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                              {/* Group Header */}
                              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="p-2 bg-blue-100 rounded-lg">
                                    {recurringGroupBy === 'wine' ? (
                                      <Wine className="w-4 h-4 text-blue-600" />
                                    ) : (
                                      <Building2 className="w-4 h-4 text-blue-600" />
                                    )}
                                  </div>
                                  <div>
                                    <h4 className="font-semibold text-gray-900">{groupName}</h4>
                                    <p className="text-xs text-gray-500">
                                      {groupOrders.length} recurring {groupOrders.length === 1 ? 'schedule' : 'schedules'}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {groupOrders.some(o => o.recurrence?.isActive) && (
                                    <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-full flex items-center gap-1">
                                      <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                                      Active
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Group Orders */}
                              <div className="divide-y divide-gray-100">
                                {groupOrders.map(order => {
                                  const nextDate = order.recurrence?.nextOrderDate 
                                    ? new Date(order.recurrence.nextOrderDate)
                                    : null
                                  const daysUntil = nextDate 
                                    ? Math.ceil((nextDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                                    : null

                                  return (
                                    <div key={order.order_id} className="p-4 hover:bg-blue-50/30 transition-colors">
                                      <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                          <div className="flex items-center gap-2 mb-2">
                                            <h5 className="font-medium text-gray-900">
                                              {recurringGroupBy === 'wine' ? (
                                                order.provider_name
                                              ) : (
                                                <>
                                                  {order.wine_name}
                                                  <span className="text-gray-400 text-xs font-normal ml-1">
                                                    · {formatVolume(resolveOrderBottleSizeMl(order), measurementUnit)}
                                                  </span>
                                                </>
                                              )}
                                            </h5>
                                            {/* Frequency Badge */}
                                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                              order.recurrence?.frequency === 'weekly' ? 'bg-blue-100 text-blue-700' :
                                              order.recurrence?.frequency === 'biweekly' ? 'bg-indigo-100 text-indigo-700' :
                                              order.recurrence?.frequency === 'monthly' ? 'bg-purple-100 text-purple-700' :
                                              'bg-gray-100 text-gray-700'
                                            }`}>
                                              {order.recurrence?.frequency === 'biweekly' ? 'Bi-weekly' : 
                                               (order.recurrence?.frequency ? order.recurrence.frequency.charAt(0).toUpperCase() + order.recurrence.frequency.slice(1) : '')}
                                            </span>
                                            {/* Auto-Approve Badge */}
                                            {order.recurrence?.autoApprove && (
                                              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-semibold">
                                                Auto-Approve
                                              </span>
                                            )}
                                            {/* Status Badge */}
                                            {!order.recurrence?.isActive && (
                                              <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs font-semibold">
                                                Paused
                                              </span>
                                            )}
                                          </div>
                                          
                                          <div className="grid grid-cols-4 gap-4 text-sm">
                                            <div>
                                              <p className="text-xs text-gray-500">Quantity</p>
                                              <p className="font-semibold text-gray-900">{order.quantity} bottles</p>
                                            </div>
                                            <div>
                                              <p className="text-xs text-gray-500">Price/Bottle</p>
                                              <p className="font-semibold text-gray-900">${order.final_price?.toFixed(2)}</p>
                                            </div>
                                            <div>
                                              <p className="text-xs text-gray-500">Next Order</p>
                                              <p className={`font-semibold ${
                                                daysUntil && daysUntil <= 3 ? 'text-amber-600' : 'text-gray-900'
                                              }`}>
                                                {nextDate ? `${daysUntil} days` : 'N/A'}
                                              </p>
                                            </div>
                                            <div>
                                              <p className="text-xs text-gray-500">Total/Order</p>
                                              <p className="font-semibold text-blue-600">
                                                ${((order.final_price || 0) * order.quantity).toFixed(2)}
                                              </p>
                                            </div>
                                          </div>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center gap-2 ml-4">
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              setOrders(prev => prev.map(o => 
                                                o.order_id === order.order_id && o.recurrence
                                                  ? { ...o, recurrence: { ...o.recurrence, isActive: !o.recurrence.isActive } }
                                                  : o
                                              ))
                                            }}
                                            className={`p-2 rounded-lg transition-colors ${
                                              order.recurrence?.isActive 
                                                ? 'hover:bg-amber-100' 
                                                : 'hover:bg-emerald-100'
                                            }`}
                                            title={order.recurrence?.isActive ? 'Pause' : 'Resume'}
                                          >
                                            {order.recurrence?.isActive ? (
                                              <Pause className="w-4 h-4 text-amber-600" />
                                            ) : (
                                              <Play className="w-4 h-4 text-emerald-600" />
                                            )}
                                          </button>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              if (confirm(`🔄 Trigger immediate recurring order for ${order.wine_name}?\n\nThis will create a new order based on your recurring schedule.`)) {
                                                const newOrderId = `ORD-${Date.now()}`
                                                const newOrder: Order = {
                                                  order_id: newOrderId,
                                                  wine_id: order.wine_id,
                                                  wine_name: order.wine_name,
                                                  quantity: order.quantity,
                                                  provider_name: order.provider_name,
                                                  status: order.recurrence?.autoApprove ? 'approved' : 'pending_approval',
                                                  suggested_price: order.final_price || order.suggested_price,
                                                  final_price: order.recurrence?.autoApprove ? order.final_price : undefined,
                                                  created_at: new Date().toISOString(),
                                                  isRecurring: false,
                                                }
                                                setOrders(prev => [newOrder, ...prev])
                                                
                                                if ('Notification' in window && Notification.permission === 'granted') {
                                                  new Notification('🔄 Recurring Order Triggered', {
                                                    body: `${order.wine_name} - ${order.quantity} bottles\nFrom: ${order.provider_name}\nStatus: ${order.recurrence?.autoApprove ? 'Auto-Approved ✓' : 'Pending Approval'}`,
                                                    icon: '/favicon.ico',
                                                    tag: `recurring-trigger-${newOrderId}`,
                                                  })
                                                }
                                                
                                                alert(`🔄 RECURRING ORDER TRIGGERED\n\n` +
                                                  `Wine: ${order.wine_name}\n` +
                                                  `Quantity: ${order.quantity} bottles\n` +
                                                  `Provider: ${order.provider_name}\n` +
                                                  `Price: $${(order.final_price || order.suggested_price || 0).toFixed(2)}/bottle\n\n` +
                                                  `Status: ${order.recurrence?.autoApprove ? '✅ Auto-Approved' : '⏳ Pending Approval'}`)
                                              }
                                            }}
                                            className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                                            title="Order Now (from recurring)"
                                          >
                                            <Zap className="w-4 h-4 text-blue-600" />
                                          </button>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              if (confirm(`Delete recurring order for ${order.wine_name}?`)) {
                                                setOrders(prev => prev.filter(o => o.order_id !== order.order_id))
                                              }
                                            }}
                                            className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                                            title="Delete"
                                          >
                                            <Trash2 className="w-4 h-4 text-red-600" />
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        </motion.div>

        {/* One-Time Orders Section */}
        <div className="mb-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-wine-600" />
            One-Time Orders
          </h3>
        </div>

        <OrderFilters
          filterStatus={filterStatus}
          setFilterStatus={setFilterStatus}
          groupBy={groupBy}
          setGroupBy={setGroupBy}
          setExpandedGroups={setExpandedGroups}
          oneTimeOrderCount={oneTimeOrders.length}
          pendingCount={pendingCount}
          approvedCount={approvedCount}
          orderedCount={orderedCount}
          deliveredCount={deliveredCount}
        />

        {/* Orders List - Grouped View */}
        <div className="space-y-4">
          {Object.entries(groupedOrdersWithAutoHide).map(([groupName, groupOrders]) => {
            const isExpanded = expandedGroups.has(groupName)
            const totalOrders = groupOrders.length
            const totalBottles = groupOrders.reduce((sum, order) => sum + order.quantity, 0)
            const totalValue = groupOrders.reduce((sum, order) => 
              sum + (order.quantity * (order.final_price || order.suggested_price || 0)), 0
            )
            
            return (
              <motion.div
                key={groupName}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                layout
              >
                <Card variant="glass" padding="none" hover="lift">
                  {/* Group Header - Clickable */}
                  <button
                    onClick={() => toggleGroup(groupName)}
                    className="w-full px-6 py-5 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-200"
                  >
                    <div className="flex items-center gap-4">
                      {/* Expand/Collapse Icon */}
                      <motion.div
                        animate={{ rotate: isExpanded ? 90 : 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <ChevronRight className="w-6 h-6 text-gray-600" />
                      </motion.div>
                      
                      {/* Group Icon */}
                      <div className="p-3 bg-wine-100 rounded-lg">
                        {groupBy === 'wine' ? (
                          <Wine className="w-6 h-6 text-wine-600" />
                        ) : (
                          <Building2 className="w-6 h-6 text-wine-600" />
                        )}
                      </div>
                      
                      {/* Group Name */}
                      <div className="text-left">
                        <h3 className="text-xl font-bold text-gray-900">{groupName}</h3>
                        <p className="text-sm text-gray-600">
                          {totalOrders} {totalOrders === 1 ? 'order' : 'orders'} • {totalBottles} bottles
                        </p>
                      </div>
                    </div>
                    
                    {/* Summary Stats */}
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-sm text-gray-600">Total Value</p>
                        <p className="text-2xl font-bold text-wine-600">${totalValue.toFixed(2)}</p>
                      </div>
                      
                      {/* Status Badges */}
                      <div className="flex gap-2 flex-wrap">
                        {groupOrders.filter(o => o.status === 'pending_approval').length > 0 && (
                          <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs font-semibold rounded-full">
                            {groupOrders.filter(o => o.status === 'pending_approval').length} pending
                          </span>
                        )}
                        {groupOrders.filter(o => o.status === 'approved').length > 0 && (
                          <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-full">
                            {groupOrders.filter(o => o.status === 'approved').length} approved
                          </span>
                        )}
                        {groupOrders.filter(o => o.status === 'ordered').length > 0 && (
                          <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded-full">
                            {groupOrders.filter(o => o.status === 'ordered').length} ordered
                          </span>
                        )}
                        {groupOrders.filter(o => o.status === 'delivered').length > 0 && (
                          <span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs font-semibold rounded-full">
                            {groupOrders.filter(o => o.status === 'delivered').length} delivered
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                  
                  {/* Expandable Order List */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden"
                      >
                        <div className="p-4 space-y-3 bg-gray-50">
                          {groupOrders.map((order) => {
                            const statusConfig = getStatusConfig(order.status)
                            const StatusIcon = statusConfig.icon

                            return (
                              <div
                                key={order.order_id}
                                className="bg-white rounded-xl p-4 shadow-sm border border-gray-200 hover:shadow-md transition-shadow"
                              >
                                <div className="flex items-start justify-between">
                                  {/* Order Info */}
                                  <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-3">
                                      <div className="p-2 bg-wine-100 rounded-lg">
                                        <StatusIcon className="w-4 h-4 text-wine-600" />
                                      </div>
                                      <div>
                                        <h4 className="text-base font-semibold text-gray-900">
                                          {groupBy === 'wine' ? (
                                            <>
                                              {resolveOrderWineName(order)}
                                              <span className="text-gray-400 text-xs font-normal ml-1">
                                                · {formatVolume(resolveOrderBottleSizeMl(order), measurementUnit)}
                                              </span>
                                            </>
                                          ) : (
                                            order.provider_name || 'Unknown Provider'
                                          )}
                                        </h4>
                                        <p className="text-xs text-gray-500">
                                          Order #{order.order_id.slice(0, 8)}
                                        </p>
                                      </div>
                                      {pendingDraftOrderIds.has(order.order_id) && (
                                        <span
                                          className="inline-flex items-center gap-1 text-xs bg-wine-50 text-wine-700 border border-wine-200 px-2 py-0.5 rounded-full cursor-pointer hover:bg-wine-100 transition-colors"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            setCommsDrawerOrder({
                                              orderId: order.order_id,
                                              wineName: resolveOrderWineName(order) ?? order.wine_name ?? 'Order',
                                              orderStatus: order.status,
                                            })
                                          }}
                                          title="AI draft ready for review"
                                        >
                                          <span className="w-1.5 h-1.5 rounded-full bg-wine-500 animate-pulse flex-shrink-0" />
                                          AI Draft Ready
                                        </span>
                                      )}

                                      {/* Status Badge — click to open email thread */}
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setCommsDrawerOrder({
                                            orderId: order.order_id,
                                            wineName: resolveOrderWineName(order) ?? order.wine_name ?? 'Order',
                                            orderStatus: order.status,
                                          })
                                        }}
                                        className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold cursor-pointer select-none transition-all hover:ring-2 hover:ring-offset-1 active:scale-95"
                                        style={{
                                          backgroundColor: statusConfig.color + '20',
                                          color: statusConfig.color,
                                          ['--tw-ring-color' as any]: statusConfig.color + '60',
                                        }}
                                        title="View email thread"
                                      >
                                        <MessageSquare className="w-3 h-3 flex-shrink-0" />
                                        {statusConfig.label}
                                      </button>
                                    </div>

                                    <div className="grid grid-cols-4 gap-4">
                                      <div>
                                        <p className="text-xs text-gray-500">Quantity</p>
                                        <p className="text-sm font-semibold text-gray-900">{order.quantity} bottles</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-gray-500">Price/Bottle</p>
                                        <p className="text-sm font-semibold text-gray-900">
                                          ${(order.final_price || order.suggested_price || 0).toFixed(2)}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-gray-500">Total</p>
                                        <p className="text-sm font-semibold text-wine-600">
                                          ${((order.final_price || order.suggested_price || 0) * order.quantity).toFixed(2)}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-gray-500">Created</p>
                                        <p className="text-sm font-semibold text-gray-900">
                                          {new Date(order.created_at).toLocaleDateString()}
                                        </p>
                                        {order.status === 'delivered' && order.delivered_at && (
                                          <div className="mt-1">
                                            <p className="text-xs text-gray-500">Finalized</p>
                                            <p className="text-sm font-semibold text-gray-900">
                                              {new Date(order.delivered_at).toLocaleDateString()}
                                            </p>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Actions */}
                                  {order.status === 'pending_approval' && (
                                    <div className="ml-4 flex gap-2">
                                      <Button
                                        size="sm"
                                        variant="default"
                                        onClick={() => setCommsDrawerOrder({
                                          orderId: order.order_id,
                                          wineName: resolveOrderWineName(order) ?? order.wine_name ?? 'Order',
                                          orderStatus: order.status,
                                        })}
                                        className="bg-green-600 hover:bg-green-700"
                                      >
                                        <CheckCircle className="w-4 h-4 mr-1" />
                                        Approve
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleReject(order.order_id)}
                                        className="text-red-600 hover:bg-red-50"
                                      >
                                        <XCircle className="w-4 h-4 mr-1" />
                                        Reject
                                      </Button>
                                    </div>
                                  )}
                                  {order.status === 'approved' && (
                                    <Button
                                      size="sm"
                                      variant="default"
                                      onClick={() => handleMarkAsOrdered(order.order_id)}
                                      className="ml-4 bg-blue-600 hover:bg-blue-700"
                                    >
                                      <ShoppingCart className="w-4 h-4 mr-1" />
                                      Mark as Ordered
                                    </Button>
                                  )}
                                  {order.status === 'ordered' && (
                                    <Button
                                      size="sm"
                                      variant="default"
                                      onClick={() => handleMarkAsDelivered(order.order_id)}
                                      className="ml-4 bg-purple-600 hover:bg-purple-700"
                                    >
                                      <Truck className="w-4 h-4 mr-1" />
                                      Mark as Delivered
                                    </Button>
                                  )}
                                  {order.status === 'delivered' && (
                                    <div className="ml-4 px-4 py-2 bg-emerald-100 border border-emerald-300 rounded-lg">
                                      <div className="flex items-center gap-2">
                                        <CheckCircle className="w-4 h-4 text-emerald-600" />
                                        <span className="text-sm font-semibold text-emerald-700">Delivery Finalized</span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
              </motion.div>
            )
          })}
        </div>

        {/* Empty State */}
        {Object.keys(groupedOrdersWithAutoHide).length === 0 && (
          <Card variant="glass" padding="lg">
            <div className="text-center py-12">
              <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No Orders Found</h3>
              <p className="text-gray-600 mb-4">
                {filterStatus === 'all'
                  ? 'No orders have been created yet'
                  : `No orders with status "${filterStatus}"`}
              </p>
              <Button
                variant="default"
                onClick={openCreateOrderFlow}
                className="bg-wine-600 hover:bg-wine-700"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Your First Order
              </Button>
            </div>
          </Card>
        )}
        </>
        )}
      </div>

      <CreateOrderModal
        isOpen={showCreateOrderModal}
        onClose={() => setShowCreateOrderModal(false)}
        createOrderItems={createOrderItems}
        filteredWines={filteredWines}
        orders={orders}
        providers={providers}
        wineSearch={wineSearch}
        setWineSearch={setWineSearch}
        wineListLimit={wineListLimit}
        setWineListLimit={setWineListLimit}
        winesPerPage={WINES_PER_PAGE}
        isCreatingRecurring={isCreatingRecurring}
        setIsCreatingRecurring={setIsCreatingRecurring}
        recurringFrequency={recurringFrequency}
        setRecurringFrequency={setRecurringFrequency}
        recurringStartDate={recurringStartDate}
        setRecurringStartDate={setRecurringStartDate}
        recurringAutoApprove={recurringAutoApprove}
        setRecurringAutoApprove={setRecurringAutoApprove}
        onOpenWineConfig={openWineConfigModal}
        onRemoveItem={removeItem}
        onUpdateItemQuantity={updateItemQuantity}
        onEditItem={editItem}
        onContactProviders={handleContactProviders}
        totalOrderValue={totalOrderValue}
        isLoading={actionLoading === 'create-orders'}
      />

      {/* Order Guard Modal — shown when no vendors are configured */}
      <OrderGuardModal
        open={showOrderGuard}
        onClose={() => setShowOrderGuard(false)}
      />

      {/* Wine Config Modal */}
      <AnimatePresence>
        {showWineConfigModal && configWine && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
            onClick={() => setShowWineConfigModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg h-[700px] flex flex-col overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-wine-50 to-rose-50 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-wine-100 rounded-lg">
                    <Wine className="w-5 h-5 text-wine-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{configWine.name}</h3>
                    <p className="text-sm text-gray-500">{configWine.producer} · ${configWine.price}/bottle</p>
                  </div>
                </div>
                <button onClick={() => setShowWineConfigModal(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              <div className="flex flex-col flex-1 overflow-hidden min-h-0">
                <div className="p-6 space-y-6 overflow-y-auto flex-1 min-h-0">
                {/* Unit Type Selection - Moved to top */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Order Unit</label>
                  <select
                    value={configUnitType}
                    onChange={(e) => setConfigUnitType(e.target.value as 'case' | 'bottle')}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500 bg-white"
                  >
                    <option value="bottle">Bottles</option>
                    <option value="case">Cases</option>
                  </select>
                </div>

                {/* Quantity - Label changes based on unit type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Quantity ({configUnitType === 'case' ? 'cases' : 'bottles'})
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setConfigQuantity(prev => Math.max(1, prev - 1))}
                      className="p-2 hover:bg-gray-100 rounded-lg border border-gray-200"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={configQuantity}
                      onChange={(e) => setConfigQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-20 text-center py-2 border border-gray-200 rounded-lg"
                    />
                    <button
                      onClick={() => setConfigQuantity(prev => prev + 1)}
                      className="p-2 hover:bg-gray-100 rounded-lg border border-gray-200"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                    <div className="flex gap-2 ml-4">
                      {(configUnitType === 'case' ? [2, 5, 10] : [6, 12, 24]).map(qty => (
                        <button
                          key={qty}
                          onClick={() => setConfigQuantity(qty)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                            configQuantity === qty
                              ? 'bg-wine-600 text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {qty}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  {/* Bottles per case - only for case orders */}
                  {configUnitType === 'case' && (
                    <div className="mt-3">
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Bottles per Case</label>
                      <input
                        type="number"
                        min="1"
                        value={configBottlesPerCase}
                        onChange={(e) => setConfigBottlesPerCase(Math.max(1, parseInt(e.target.value) || 12))}
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
                        placeholder="12"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Total: {configQuantity} cases × {configBottlesPerCase} bottles = {configQuantity * configBottlesPerCase} bottles
                      </p>
                    </div>
                  )}
                  
                  <label className="flex items-center mt-3">
                    <input 
                      type="checkbox" 
                      checked={configSaveAsDefault} 
                      onChange={(e) => setConfigSaveAsDefault(e.target.checked)}
                      className="rounded border-gray-300 text-wine-600 focus:ring-wine-500"
                    />
                    <span className="ml-2 text-sm text-gray-600">Save as default for this wine</span>
                  </label>
                </div>

                  {/* Price Selection Mode */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                      Price Selection
                    </label>
                    <select
                      value={configPriceMode}
                      onChange={(e) => setConfigPriceMode(e.target.value as 'custom' | 'ask_provider')}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent bg-white"
                    >
                      <option value="custom">Custom Price - I'll set the desired price</option>
                      <option value="ask_provider">Ask Provider - Let them quote their best price</option>
                    </select>

                    {/* Custom Price Input - Allow selection per bottle or per case */}
                    {configPriceMode === 'custom' && (
                      <div className="mt-3 space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1.5">
                            Price per {configUnitType === 'case' ? 'Case' : 'Bottle'}
                          </label>
                        <div className="relative">
                          <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={configCustomPrice}
                            onChange={(e) => setConfigCustomPrice(parseFloat(e.target.value) || 0)}
                            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                            placeholder="0.00"
                          />
                        </div>
                        </div>
                        
                        {/* Show conversion if ordering by case */}
                        {configUnitType === 'case' && configCustomPrice > 0 && configBottlesPerCase > 0 && (
                          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                            <p className="text-sm text-blue-900">
                              <span className="font-medium">Per bottle price:</span> ${(configCustomPrice / configBottlesPerCase).toFixed(2)}
                            </p>
                            <p className="text-sm text-blue-900 mt-1">
                              <span className="font-medium">Total cost:</span> ${(configCustomPrice * configQuantity).toFixed(2)} 
                              <span className="text-blue-700"> ({configQuantity * configBottlesPerCase} bottles)</span>
                            </p>
                          </div>
                        )}
                        
                        {configUnitType === 'bottle' && configCustomPrice > 0 && (
                          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                            <p className="text-sm text-blue-900">
                              <span className="font-medium">Total cost:</span> ${(configCustomPrice * configQuantity).toFixed(2)}
                            </p>
                          </div>
                        )}
                        
                        <p className="text-xs text-gray-500">
                          💡 AI will negotiate with providers to meet or beat this price
                        </p>
                      </div>
                    )}

                    {/* Ask Provider Mode Info */}
                    {configPriceMode === 'ask_provider' && (
                      <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="flex items-start gap-2">
                          <MessageSquare className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-blue-900">AI will ask providers</p>
                            <p className="text-xs text-blue-700 mt-1">
                              Plivo will contact selected providers and ask for their best price for {configQuantity} bottles. You'll review all quotes before approving.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Provider Selection */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">
                    Select Providers to Contact
                  </label>
                      <button
                        onClick={selectAllProviders}
                        className="text-xs font-medium text-wine-600 hover:text-wine-700 transition-colors"
                      >
                        Select All
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mb-2">
                    Primary provider is selected by default. Add alternatives to get competitive quotes.
                  </p>
                    
                    {/* Mini Search Bar */}
                    <div className="relative mb-2">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search providers..."
                        value={providerSearchQuery}
                        onChange={(e) => setProviderSearchQuery(e.target.value)}
                        className="w-full pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                      />
                    </div>

                    <div className="border border-gray-200 rounded-lg p-2 h-[180px] overflow-y-auto bg-gray-50">
                  <div className="space-y-2">
                    {providersLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
                        <span className="ml-2 text-sm text-gray-500">Loading providers...</span>
                      </div>
                    ) : providersError ? (
                      <div className="flex flex-col items-center justify-center py-8 text-center">
                        <AlertCircle className="w-5 h-5 text-amber-500 mb-2" />
                        <span className="text-sm text-amber-600">Unable to load providers</span>
                        <span className="text-xs text-gray-400 mt-1">Check your connection and try again</span>
                      </div>
                    ) : (() => {
                      const recommended = getRecommendedProviders(providers)
                      const allProviders = [
                        recommended.primary,
                        ...recommended.alternatives,
                        ...providers.filter(p => 
                          p.id !== recommended.primary?.id && 
                          !recommended.alternatives.some(a => a.id === p.id)
                        )
                      ].filter(Boolean) as Provider[]

                          // Filter providers based on search
                          const filteredProviders = allProviders.filter(provider =>
                            provider.name.toLowerCase().includes(providerSearchQuery.toLowerCase()) ||
                            provider.primaryBusinessType.toLowerCase().includes(providerSearchQuery.toLowerCase())
                          )

                          if (filteredProviders.length === 0) {
                            return (
                              <div className="flex flex-col items-center justify-center py-8 text-center">
                                <Building2 className="w-5 h-5 text-gray-300 mb-2" />
                                <span className="text-sm text-gray-500">No providers found</span>
                                {providerSearchQuery && (
                                  <span className="text-xs text-gray-400 mt-1">Try a different search term</span>
                                )}
                              </div>
                            )
                          }

                          return filteredProviders.map((provider) => {
                        const isSelected = configSelectedProviders.includes(provider.id)
                        const isPrimary = provider.id === recommended.primary?.id

                        return (
                          <button
                            key={provider.id}
                            onClick={() => toggleProvider(provider.id)}
                            className={`w-full flex items-center gap-3 p-2.5 rounded-lg border-2 transition-all text-left ${
                              isSelected
                                ? 'border-wine-500 bg-wine-50'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                              isSelected
                                ? 'border-wine-500 bg-wine-500'
                                : 'border-gray-300'
                            }`}>
                              {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium text-gray-900 truncate">{provider.name}</p>
                                {isPrimary && (
                                  <span className="text-[9px] px-1 py-0.5 bg-emerald-100 text-emerald-700 rounded font-medium flex-shrink-0">
                                    PRIMARY
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className={`text-[10px] px-1 py-0.5 rounded flex-shrink-0 ${
                                  provider.primaryBusinessType === 'Importer'
                                    ? 'bg-purple-100 text-purple-700'
                                    : provider.primaryBusinessType === 'Wholesaler'
                                    ? 'bg-blue-100 text-blue-700'
                                    : 'bg-gray-100 text-gray-700'
                                }`}>
                                  {provider.primaryBusinessType}
                                </span>
                              </div>
                            </div>
                          </button>
                        )
                      })
                    })()}
                    </div>
                  </div>
                </div>

                {/* Notes */}
                <div className="flex-shrink-0">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Notes (optional)
                  </label>
                  <textarea
                    value={configNotes}
                    onChange={(e) => setConfigNotes(e.target.value)}
                    placeholder="Special requests, delivery instructions..."
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500 resize-none"
                  />
                </div>

                {/* Summary */}
                  <div className="p-4 bg-gray-50 rounded-xl flex-shrink-0">
                  <div className="flex items-center justify-between">
                      <span className="text-gray-600">
                        {configPriceMode === 'custom' ? 'Target Total' : 'Estimated Total'}
                      </span>
                    <span className="text-xl font-bold text-gray-900">
                        {configPriceMode === 'custom' 
                          ? `$${(configCustomPrice * configQuantity).toLocaleString()}`
                          : `$${(configWine.price * configQuantity).toLocaleString()}`
                        }
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                      {configPriceMode === 'custom' 
                        ? `Your target: $${configCustomPrice}/bottle • Contacting ${configSelectedProviders.length} provider${configSelectedProviders.length > 1 ? 's' : ''}`
                        : `Requesting quotes from ${configSelectedProviders.length} provider${configSelectedProviders.length > 1 ? 's' : ''}`
                      }
                  </p>
                  </div>
                </div>

                {/* Actions - Fixed Footer */}
                <div className="px-6 py-4 border-t bg-gray-50 flex gap-3 flex-shrink-0">
                  <Button
                    variant="default"
                    onClick={confirmWineConfig}
                    disabled={configSelectedProviders.length === 0}
                    className="flex-1 bg-wine-600 hover:bg-wine-700"
                  >
                    <Check className="w-4 h-4 mr-2" />
                    Add to Order
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowWineConfigModal(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Order Approval Modal - One-Tap Approval with Multi-Provider Support */}
      {orderApprovalData && (
        <OrderApprovalModal
          isOpen={showOrderApprovalModal}
          orderData={orderApprovalData}
          totalResponses={allProviderResponses.length}
          currentIndex={currentApprovalIndex}
          onNext={() => {
            // Navigate to next response
            if (currentApprovalIndex < allProviderResponses.length - 1) {
              const nextIndex = currentApprovalIndex + 1
              setCurrentApprovalIndex(nextIndex)
              setOrderApprovalData(allProviderResponses[nextIndex])
            }
          }}
          onPrevious={() => {
            // Navigate to previous response
            if (currentApprovalIndex > 0) {
              const prevIndex = currentApprovalIndex - 1
              setCurrentApprovalIndex(prevIndex)
              setOrderApprovalData(allProviderResponses[prevIndex])
            }
          }}
          onConfirm={async () => {
            try {
              if (isUuid(orderApprovalData.orderId)) {
                await apiClient.post(`/procurement/orders/${orderApprovalData.orderId}/approve`, {
                  finalPrice: orderApprovalData.finalPrice,
                })
              } else {
                throw new Error('Invalid order id')
              }

              setOrders(prev => prev.map(order =>
                order.order_id === orderApprovalData.orderId
                  ? {
                      ...order,
                      status: 'approved',
                      final_price: orderApprovalData.finalPrice,
                      approved_at: new Date().toISOString(),
                    }
                  : order
              ))
              // Refetch orders to sync with backend
              refetchOrders()
              
              // Remove from all responses
              setAllProviderResponses(prev => {
                const updated = prev.filter((_, idx) => idx !== currentApprovalIndex)
                
                // If there are more responses, show the next one (or previous if at end)
                if (updated.length > 0) {
                  const nextIndex = Math.min(currentApprovalIndex, updated.length - 1)
                  setCurrentApprovalIndex(nextIndex)
                  setOrderApprovalData(updated[nextIndex])
                } else {
                  // No more responses, close modal
                  setShowOrderApprovalModal(false)
                  setOrderApprovalData(null)
                  setCurrentApprovalIndex(0)
                }
                
                return updated
              })
              
              alert('Order approved successfully! ✅')
            } catch (error) {
              console.error('Failed to confirm order:', error)
              alert('Failed to confirm order. Please try again.')
            }
          }}
          onCancel={async () => {
            try {
              if (isUuid(orderApprovalData.orderId)) {
                await apiClient.delete(`/procurement/orders/${orderApprovalData.orderId}`)
              } else {
                throw new Error('Invalid order id')
              }

              setOrders(prev => prev.map(order =>
                order.order_id === orderApprovalData.orderId
                  ? { ...order, status: 'cancelled' }
                  : order
              ))
              // Refetch orders to sync with backend
              refetchOrders()
              
              // Remove from all responses
              setAllProviderResponses(prev => {
                const updated = prev.filter((_, idx) => idx !== currentApprovalIndex)
                
                // If there are more responses, show the next one (or previous if at end)
                if (updated.length > 0) {
                  const nextIndex = Math.min(currentApprovalIndex, updated.length - 1)
                  setCurrentApprovalIndex(nextIndex)
                  setOrderApprovalData(updated[nextIndex])
                } else {
                  // No more responses - close modal
                  setShowOrderApprovalModal(false)
                  setOrderApprovalData(null)
                  setCurrentApprovalIndex(0)
                }
                
                return updated
              })
              
              alert('Order cancelled. ❌')
            } catch (error) {
              console.error('Failed to cancel order:', error)
              alert('Failed to cancel order. Please try again.')
            }
          }}
          onEdit={() => {
            // Open edit modal - for now just close approval and navigate to create order
            setShowOrderApprovalModal(false)
            openCreateOrderFlow()
            // In real app, would pre-fill with existing data
          }}
          onRequestMoreInfo={async () => {
            // Trigger another conversation with provider to ask for more information
            alert('Requesting additional information from provider. You will receive another notification when they respond.')
            
            // In real app, this would trigger Procurement AI agent to contact provider again
            // For now, simulate another conversation
            setTimeout(() => {
              const updatedData: OrderApprovalData = {
                ...orderApprovalData,
                conversationId: `CONV-${Date.now()}`,
                conversationSummary: orderApprovalData.conversationSummary + '\n\n**FOLLOW-UP CONVERSATION:**\n\nManager requested additional information. Provider provided detailed specifications and confirmed all requirements can be met.',
                timestamp: new Date().toISOString(),
              }
              setOrderApprovalData(updatedData)
              // Update in all provider responses too
              setAllProviderResponses(prev => prev.map((item, idx) => 
                idx === currentApprovalIndex ? updatedData : item
              ))
            }, 2000)
          }}
          onClose={() => {
            setShowOrderApprovalModal(false)
            // Keep pending approvals - user can review later
          }}
        />
      )}

      {/* AI Draft Email Approval Panel */}
      <DraftEmailApprovalPanel
        isOpen={isDraftPanelOpen}
        draftData={draftPanelData}
        managerName={user?.name ?? ''}
        onApprove={async (modifiedContent, managerNotes, ccEmails) => {
          if (!draftPanelData) return
          try {
            await approveDraftMutation.mutateAsync({
              orderId: draftPanelData.orderId,
              modifiedContent,
              managerNotes,
              ccEmails,
            })
            setIsDraftPanelOpen(false)
            setDraftPanelData(null)
          } catch (err: any) {
            // 4xx = email delivery explicitly failed — keep modal open for retry
            // Network/5xx = response lost but email may have sent — close anyway
            if (!err?.response?.status || err.response.status >= 500) {
              setIsDraftPanelOpen(false)
              setDraftPanelData(null)
            }
          }
        }}
        onDiscard={async () => {
          if (!draftPanelData) return
          await discardDraftMutation.mutateAsync(draftPanelData.orderId)
          setIsDraftPanelOpen(false)
          setDraftPanelData(null)
        }}
        onClose={(dirtyContent) => {
          if (dirtyContent && draftPanelData) {
            editDraftMutation.mutate({ orderId: draftPanelData.orderId, content: dirtyContent })
          }
          setIsDraftPanelOpen(false)
          setDraftPanelData(null)
        }}
        isSubmitting={approveDraftMutation.isPending || discardDraftMutation.isPending}
      />

      {/* Comms Thread Drawer */}
      <CommsThreadDrawer
        orderId={commsDrawerOrder?.orderId ?? null}
        orderWineName={commsDrawerOrder?.wineName}
        orderStatus={commsDrawerOrder?.orderStatus}
        isOpen={!!commsDrawerOrder}
        onClose={() => setCommsDrawerOrder(null)}
        onOpenDraftPanel={() => {
          if (!commsDrawerOrder) return
          const conv = activeConversations.find((c) => c.orderId === commsDrawerOrder.orderId)
          if (conv) {
            setDraftPanelData({
              conversationId: conv.id,
              orderId: conv.orderId,
              restaurantName: activeRestaurantName,
              orderNumber: conv.orderNumber ?? undefined,
              wineName: conv.wineName ?? 'Wine',
              quantity: conv.quantity ?? undefined,
              providerName: conv.providerName ?? 'Provider',
              providerEmail: conv.providerEmail ?? '',
              emailType: (conv.emailType as any) ?? 'PRICE_INQUIRY',
              draftContent: conv.draftContent ?? '',
              disclaimer: 'Sent via WineOps AI — This message was generated with AI assistance.',
              constraintWarnings: [],
              roundCount: conv.roundCount ?? 1,
              timestamp: conv.createdAt,
            })
            setIsDraftPanelOpen(true)
          }
        }}
      />

      {/* Active Conversations Panel */}
      <ActiveConversationsPanel
        isOpen={isActiveConvPanelOpen}
        onClose={() => setIsActiveConvPanelOpen(false)}
        conversations={activeConversations}
        isLoading={activeConvLoading}
        onViewDraft={(conv: ActiveConversationDto) => {
          setDraftPanelData({
            conversationId: conv.id,
            orderId: conv.orderId,
            restaurantName: activeRestaurantName,
            orderNumber: conv.orderNumber ?? undefined,
            wineName: conv.wineName ?? 'Wine',
            quantity: conv.quantity ?? undefined,
            providerName: conv.providerName ?? 'Provider',
            providerEmail: conv.providerEmail ?? '',
            emailType: (conv.emailType as any) ?? 'PRICE_INQUIRY',
            draftContent: conv.draftContent ?? '',
            disclaimer: 'Sent via WineOps AI — This message was generated with AI assistance.',
            constraintWarnings: [],
            roundCount: conv.roundCount ?? 1,
            timestamp: conv.createdAt,
          })
          setIsDraftPanelOpen(true)
          setIsActiveConvPanelOpen(false)
        }}
        onApprove={(orderId) => approveDraftMutation.mutate({ orderId })}
        onDiscard={(orderId) => discardDraftMutation.mutate(orderId)}
        isApproving={approveDraftMutation.isPending}
        isDiscarding={discardDraftMutation.isPending}
      />

      {/* Legacy Approval Modal - For orders from list */}
      <AnimatePresence>
        {showApprovalModal && selectedOrder && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowApprovalModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full"
            >
              <h3 className="text-2xl font-bold text-gray-900 mb-4">Approve Order</h3>
              <p className="text-gray-600 mb-6">
                Confirm order for {selectedOrder.quantity} bottles of {selectedOrder.wine_name}
              </p>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Final Price per Bottle
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="number"
                    step="0.01"
                    defaultValue={selectedOrder.suggested_price}
                    className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500"
                    id="final-price"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="default"
                  onClick={() => {
                    const price = parseFloat(
                      (document.getElementById('final-price') as HTMLInputElement).value
                    )
                    confirmApproval(price)
                  }}
                  className="flex-1"
                >
                  Approve Order
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowApprovalModal(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
