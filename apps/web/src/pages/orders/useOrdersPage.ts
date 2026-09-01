import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useProviders, useWines } from '../../hooks/queries'
import { useOrders } from '../../hooks/queries/useOrderQueries'
import { useInventoryData } from '../../hooks/useInventoryData'

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

const isUuid = (v?: string | null) => !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const mapApiStatusToUi = (s?: string): Order['status'] => {
  if (['PENDING', 'APPROVAL_NEEDED', 'NEGOTIATING'].includes(s || '')) return 'pending_approval'
  if (s === 'APPROVED') return 'approved'
  if (['CONFIRMED', 'IN_TRANSIT'].includes(s || '')) return 'ordered'
  if (['DELIVERED', 'COMPLETED'].includes(s || '')) return 'delivered'
  if (['CANCELLED', 'REJECTED', 'FAILED'].includes(s || '')) return 'cancelled'
  return 'pending_approval'
}
const mapApiOrderToUi = (o: any): Order => ({
  order_id: o.id ?? o.order_id,
  wine_id: o.inventoryId ?? o.wine_id ?? '',
  wine_name: o.wineName ?? o.wine_name,
  quantity: o.quantity ?? 0,
  provider_name: o.providerName ?? o.provider_id ?? o.providerId,
  status: mapApiStatusToUi(o.status),
  suggested_price: o.quotedPrice ?? o.suggested_price,
  final_price: o.finalPrice ?? o.final_price,
  created_at: o.requestedAt ?? o.created_at ?? new Date().toISOString(),
  approved_at: o.approvedAt ?? o.approved_at,
  delivered_at: o.deliveredAt ?? o.delivered_at,
})
const isPlaceholderName = (v?: string) => !v || v.trim().length === 0 || v.trim().toLowerCase() === 'unknown wine'

export function useOrdersPage() {
  const { user, activeRestaurantId } = useAuth()
  const { data: apiProviders = [] } = useProviders(activeRestaurantId || user?.restaurantId || '')
  // `inventoryLoading` is exposed because the `/orders?draft=new&inventoryId=`
  // deep link resolves ids against this list: an empty array while the query
  // is in flight must not be read as "that inventory row is gone".
  const { inventory, isLoading: inventoryLoading } = useInventoryData()
  const { data: apiWines = [] } = useWines({ limit: 200 })

  const providers = apiProviders

  const { data: rawOrdersData, refetch: refetchOrders, isLoading: loading } = useOrders()
  const [orders, setOrders] = useState<Order[]>([])
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterOrderType, setFilterOrderType] = useState<'all' | 'one-time' | 'recurring'>('all')
  const [orderSearch, setOrderSearch] = useState('')
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified')
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [groupBy, setGroupBy] = useState<'wine' | 'provider'>('wine')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [showRecurringSection, setShowRecurringSection] = useState(true)
  const [recurringGroupBy, setRecurringGroupBy] = useState<'wine' | 'provider'>('wine')
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set())

  const providerNameById = useMemo(() => {
    const map = new Map<string, string>()
    providers.forEach((p) => p.id && p.name && map.set(p.id, p.name))
    return map
  }, [providers])

  const inventoryById = useMemo(() => {
    const map = new Map<string, any>()
    inventory.forEach((item: any) => {
      if (item?.id) map.set(item.id, item)
      if (item?.wineId) map.set(item.wineId, item)
    })
    return map
  }, [inventory])

  // Master wine lookup from the library (already fetched, stable cache)
  const wineNameByMasterId = useMemo(() => {
    const map = new Map<string, string>()
    apiWines.forEach((w: any) => {
      const id = w.id || w.wineId
      const name = w.name || w.wineName
      if (id && name) map.set(id, name)
    })
    return map
  }, [apiWines])

  const resolveOrderWineName = useCallback((order: Order, fallbackName?: string) => {
    if (order.wine_name && !isUuid(order.wine_name) && !isPlaceholderName(order.wine_name)) return order.wine_name
    if (fallbackName && !isUuid(fallbackName) && !isPlaceholderName(fallbackName)) return fallbackName
    // Try inventory item first
    const inv = inventoryById.get(order.wine_id)
    const invName = inv?.wineName || inv?.wine_name || inv?.name
    if (invName && !isUuid(invName) && !isPlaceholderName(invName)) return invName
    // Fallback: master wine ID stored on the inventory item
    const masterWineId = inv?.wineId || inv?.wine_id
    if (masterWineId) {
      const masterName = wineNameByMasterId.get(masterWineId)
      if (masterName && !isPlaceholderName(masterName)) return masterName
    }
    // Fallback: treat wine_id itself as a master wine ID
    const directName = wineNameByMasterId.get(order.wine_id)
    if (directName && !isPlaceholderName(directName)) return directName
    return order.wine_name || undefined
  }, [inventoryById, wineNameByMasterId])

  const resolveOrderProviderName = useCallback((order: Order) => {
    if (!order.provider_name) return 'Unknown Provider'
    return isUuid(order.provider_name) ? (providerNameById.get(order.provider_name) || 'Unknown Provider') : order.provider_name
  }, [providerNameById])

  useEffect(() => {
    if (!rawOrdersData) return
    const list = Array.isArray(rawOrdersData) ? rawOrdersData : (rawOrdersData as any).orders || []
    const resolved = list.map(mapApiOrderToUi).map((o: Order) => {
      const resolved = resolveOrderWineName(o)
      return { ...o, wine_name: resolved ?? o.wine_name }
    })
    setOrders(resolved)
  }, [rawOrdersData, resolveOrderWineName])

  const filteredOrders = useMemo(() => orders.filter((o) => !o.isRecurring && (filterStatus === 'all' || o.status === filterStatus)), [orders, filterStatus])
  const searchFilteredOrders = useMemo(() => {
    if (!orderSearch.trim()) return filteredOrders
    const s = orderSearch.toLowerCase()
    return filteredOrders.filter((o) => o.wine_name?.toLowerCase().includes(s) || o.provider_name?.toLowerCase().includes(s) || o.order_id.toLowerCase().includes(s))
  }, [filteredOrders, orderSearch])
  const sortedOrders = useMemo(() => [...searchFilteredOrders].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [searchFilteredOrders])
  const groupedOrders = useMemo(() => {
    const groups: { [key: string]: Order[] } = {}
    sortedOrders.forEach((o) => {
      const key = groupBy === 'wine'
        ? (resolveOrderWineName(o) ?? 'Unknown Wine')
        : resolveOrderProviderName(o)
      if (!groups[key]) groups[key] = []
      groups[key].push(o)
    })
    return groups
  }, [sortedOrders, groupBy, resolveOrderWineName, resolveOrderProviderName])

  const orderAnalytics = useMemo(() => {
    const now = new Date()
    const oneTime = orders.filter((o) => !o.isRecurring)
    // Exclude cancelled orders from monetary totals — cancellations should reduce the spend card.
    const activeOrders = orders.filter((o) => o.status !== 'cancelled')
    const thisMonth = activeOrders.filter((o) => {
      const d = new Date(o.created_at)
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    })
    const lastMonth = activeOrders.filter((o) => {
      const d = new Date(o.created_at)
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear()
    })
    const getVal = (os: Order[]) => os.reduce((s, o) => s + o.quantity * (o.final_price || o.suggested_price || 0), 0)
    const thisVal = getVal(thisMonth)
    const lastVal = getVal(lastMonth)
    return {
      thisMonthValue: thisVal,
      lastMonthValue: lastVal,
      valueChange: lastVal > 0 ? ((thisVal - lastVal) / lastVal) * 100 : 0,
      avgOrderValue: orders.length ? getVal(orders) / orders.length : 0,
      totalBottles: orders.reduce((s, o) => s + o.quantity, 0),
      pendingCount: oneTime.filter((o) => o.status === 'pending_approval').length,
      approvedCount: oneTime.filter((o) => o.status === 'approved').length,
      orderedCount: oneTime.filter((o) => o.status === 'ordered').length,
      deliveredCount: oneTime.filter((o) => o.status === 'delivered').length,
    }
  }, [orders])

  const toggleStatusFilter = useCallback((status: string) => setFilterStatus((p) => p === status ? 'all' : status), [])
  const toggleGroup = useCallback((name: string) => setExpandedGroups((p) => {
    const n = new Set(p)
    n.has(name) ? n.delete(name) : n.add(name)
    return n
  }), [])

  return {
    orders, providers, wines: apiWines, inventory, inventoryLoading, loading, error,
    filterStatus, filterOrderType, orderSearch, setFilterStatus, setFilterOrderType, setOrderSearch, toggleStatusFilter,
    viewMode, selectedOrder, groupBy, expandedGroups, showRecurringSection, recurringGroupBy,
    setViewMode, setSelectedOrder, setGroupBy, setExpandedGroups, setShowRecurringSection, setRecurringGroupBy, toggleGroup,
    selectedOrders, setSelectedOrders,
    filteredOrders, searchFilteredOrders, sortedOrders, groupedOrders, orderAnalytics,
    loadOrders: refetchOrders, setError, setOrders, resolveOrderWineName, resolveOrderProviderName,
  }
}
