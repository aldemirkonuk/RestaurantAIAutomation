/**
 * useOrdersMetrics Hook
 * Aggregates order data for reports and dashboards
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { ordersApi } from '../services/api'
import type { OrderStatus } from '../services/api/types'
import { useOrdersSubscription } from '../contexts/RealtimeContext'

interface StoredOrder {
  id: string
  wineId: string
  wineName: string
  quantity: number
  unitPrice: number
  totalPrice: number
  providerId: string
  providerName: string
  status: 'pending' | 'approved' | 'ordered' | 'delivered' | 'cancelled'
  createdAt: string
  approvedAt?: string
  deliveredAt?: string
  cancelledAt?: string
  wineType?: 'red' | 'white' | 'sparkling' | 'rose' | 'dessert'
}

interface OrderMetrics {
  // Overall metrics
  totalOrders: number
  totalOrderValue: number
  totalBottlesOrdered: number
  avgOrderValue: number
  
  // Status breakdown
  pendingOrders: number
  approvedOrders: number
  deliveredOrders: number
  cancelledOrders: number
  
  // Time-based metrics
  ordersThisMonth: number
  ordersLastMonth: number
  revenueThisMonth: number
  revenueLastMonth: number
  monthOverMonthGrowth: number
  
  // Wine type distribution
  ordersByWineType: {
    red: number
    white: number
    sparkling: number
    rose: number
    dessert: number
  }
  
  // Top performers
  topOrderedWines: Array<{
    wineId: string
    wineName: string
    quantity: number
    totalValue: number
  }>
  
  // Provider metrics
  ordersByProvider: Array<{
    providerId: string
    providerName: string
    orderCount: number
    totalValue: number
  }>
  
  // Daily data for charts
  dailyOrderData: Array<{
    date: string
    orders: number
    bottles: number
    revenue: number
  }>
}

const mapOrderStatus = (status?: string): StoredOrder['status'] => {
  const lower = (status || '').toLowerCase().replace(/-/g, '_')
  switch (lower) {
    case 'pending':
    case 'pending_approval':
    case 'approval_needed':
    case 'draft':
    case 'negotiating':
      return 'pending'
    case 'approved':
    case 'confirmed':
    case 'ordered':
    case 'in_transit':
    case 'intransit':
      return 'approved'
    case 'delivered':
    case 'completed':
    case 'verified':
      return 'delivered'
    case 'cancelled':
    case 'canceled':
    case 'rejected':
    case 'failed':
      return 'cancelled'
    default:
      return 'pending'
  }
}

export function useOrdersMetrics() {
  const [orders, setOrders] = useState<StoredOrder[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const { activeRestaurantId, isAuthenticated } = useAuth()

  const fetchOrders = useCallback(async () => {
    if (!activeRestaurantId) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    try {
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - 90)
      const [historyResult, approvedOrders] = await Promise.all([
        ordersApi.getOrderHistory(
          {
            limit: 100,
            dateFrom: startDate.toISOString().split('T')[0],
          },
          activeRestaurantId
        ),
        ordersApi.getOrders({ status: 'approved' as OrderStatus }, activeRestaurantId).catch(() => []),
      ])

      const combined = [
        ...historyResult.data,
        ...approvedOrders,
      ]

      const unique = new Map<string, any>()
      combined.forEach((order) => {
        if (order?.id && !unique.has(order.id)) {
          unique.set(order.id, order)
        }
      })

      const mapped: StoredOrder[] = Array.from(unique.values()).map((order) => ({
        id: order.id,
        wineId: order.wineId || order.inventoryId || '',
        wineName: order.wineName || order.wine_name || 'Unknown Wine',
        quantity: order.quantity,
        unitPrice: order.unitPrice ?? order.unit_price ?? 0,
        totalPrice: order.totalPrice ?? order.total_price ?? (order.unitPrice ?? 0) * (order.quantity ?? 0),
        providerId: order.providerId || order.provider_id || '',
        providerName: order.providerName || order.provider_name || 'Unknown Provider',
        status: mapOrderStatus(order.status),
        createdAt: order.createdAt || order.requestedAt || order.created_at,
        approvedAt: order.approvedAt || order.approved_at,
        deliveredAt: order.deliveredAt || order.delivered_at,
        cancelledAt: undefined,
      }))
      setOrders(mapped)
    } catch (error) {
      setOrders([])
    } finally {
      setIsLoading(false)
    }
  }, [activeRestaurantId])

  useEffect(() => {
    if (isAuthenticated) {
      fetchOrders()
    }
  }, [fetchOrders, isAuthenticated])

  useOrdersSubscription(() => {
    if (!activeRestaurantId || !isAuthenticated) return
    fetchOrders()
  })

  const addOrder = useCallback((_order: Omit<StoredOrder, 'id' | 'createdAt'>) => {
    fetchOrders()
    return null
  }, [fetchOrders])

  const updateOrderStatus = useCallback((_orderId: string, _status: StoredOrder['status']) => {
    fetchOrders()
  }, [fetchOrders])

  // Calculate metrics
  const metrics: OrderMetrics = useMemo(() => {
    const now = new Date()
    const thisMonth = now.getMonth()
    const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1
    const thisYear = now.getFullYear()
    const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear

    // Filter by time period
    const thisMonthOrders = orders.filter(o => {
      const date = new Date(o.createdAt)
      return date.getMonth() === thisMonth && date.getFullYear() === thisYear
    })
    
    const lastMonthOrders = orders.filter(o => {
      const date = new Date(o.createdAt)
      return date.getMonth() === lastMonth && date.getFullYear() === lastMonthYear
    })

    // Calculate base metrics
    const totalOrders = orders.length
    const totalOrderValue = orders.reduce((sum, o) => sum + o.totalPrice, 0)
    const totalBottlesOrdered = orders.reduce((sum, o) => sum + o.quantity, 0)
    const avgOrderValue = totalOrders > 0 ? totalOrderValue / totalOrders : 0

    // Status counts
    const pendingOrders = orders.filter(o => o.status === 'pending').length
    const approvedOrders = orders.filter(o => o.status === 'approved').length
    const deliveredOrders = orders.filter(o => o.status === 'delivered').length
    const cancelledOrders = orders.filter(o => o.status === 'cancelled').length

    // Time-based metrics
    const ordersThisMonth = thisMonthOrders.length
    const ordersLastMonth = lastMonthOrders.length
    const revenueThisMonth = thisMonthOrders.reduce((sum, o) => sum + o.totalPrice, 0)
    const revenueLastMonth = lastMonthOrders.reduce((sum, o) => sum + o.totalPrice, 0)
    const monthOverMonthGrowth = revenueLastMonth > 0 
      ? ((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100 
      : 0

    // Wine type distribution
    const ordersByWineType = {
      red: orders.filter(o => o.wineType === 'red').reduce((sum, o) => sum + o.quantity, 0),
      white: orders.filter(o => o.wineType === 'white').reduce((sum, o) => sum + o.quantity, 0),
      sparkling: orders.filter(o => o.wineType === 'sparkling').reduce((sum, o) => sum + o.quantity, 0),
      rose: orders.filter(o => o.wineType === 'rose').reduce((sum, o) => sum + o.quantity, 0),
      dessert: orders.filter(o => o.wineType === 'dessert').reduce((sum, o) => sum + o.quantity, 0),
    }

    // Top ordered wines
    const wineAggregation = orders.reduce((acc, order) => {
      if (!acc[order.wineId]) {
        acc[order.wineId] = {
          wineId: order.wineId,
          wineName: order.wineName,
          quantity: 0,
          totalValue: 0,
        }
      }
      acc[order.wineId].quantity += order.quantity
      acc[order.wineId].totalValue += order.totalPrice
      return acc
    }, {} as Record<string, { wineId: string; wineName: string; quantity: number; totalValue: number }>)

    const topOrderedWines = Object.values(wineAggregation)
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, 10)

    // Provider metrics
    const providerAggregation = orders.reduce((acc, order) => {
      if (!acc[order.providerId]) {
        acc[order.providerId] = {
          providerId: order.providerId,
          providerName: order.providerName,
          orderCount: 0,
          totalValue: 0,
        }
      }
      acc[order.providerId].orderCount += 1
      acc[order.providerId].totalValue += order.totalPrice
      return acc
    }, {} as Record<string, { providerId: string; providerName: string; orderCount: number; totalValue: number }>)

    const ordersByProvider = Object.values(providerAggregation)
      .sort((a, b) => b.totalValue - a.totalValue)

    // Daily data for last 30 days
    const dailyOrderData: OrderMetrics['dailyOrderData'] = []
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now)
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]
      
      const dayOrders = orders.filter(o => 
        o.createdAt.startsWith(dateStr)
      )
      
      dailyOrderData.push({
        date: dateStr,
        orders: dayOrders.length,
        bottles: dayOrders.reduce((sum, o) => sum + o.quantity, 0),
        revenue: dayOrders.reduce((sum, o) => sum + o.totalPrice, 0),
      })
    }

    return {
      totalOrders,
      totalOrderValue,
      totalBottlesOrdered,
      avgOrderValue,
      pendingOrders,
      approvedOrders,
      deliveredOrders,
      cancelledOrders,
      ordersThisMonth,
      ordersLastMonth,
      revenueThisMonth,
      revenueLastMonth,
      monthOverMonthGrowth,
      ordersByWineType,
      topOrderedWines,
      ordersByProvider,
      dailyOrderData,
    }
  }, [orders])

  return {
    orders,
    metrics,
    isLoading,
    addOrder,
    updateOrderStatus,
    refreshOrders: () => fetchOrders(),
  }
}

export type { StoredOrder, OrderMetrics }
