import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { formatLocalDateKey, parseCalendarDateString } from '../../lib/calendar-dates'
import { DollarSign, Package, ShoppingCart, AlertTriangle } from 'lucide-react'
import { formatMoney, formatNumber as fmtNumber } from '../../lib/utils'
import { vendorLine } from '../../lib/mudavym/vendor'
import { formatVolume } from '../../utils/volumeUtils'
import { useDashboardData } from '../../hooks/useDashboardData'
import { useCalendarEvents, useWines } from '../../hooks/queries'
import { useAuthStore, useRestaurantSettingsStore } from '../../stores'
import { useOrdersMetrics } from '../../hooks/useOrdersMetrics'
import { useInventoryData } from '../../hooks/useInventoryData'
import { mapApiWinesToUiWines } from '../../lib/wine-library'

export interface Reminder {
  id: string
  title: string
  subtitle: string
  priority: 'high' | 'medium' | 'low'
  completed: boolean
  dueTime?: string
  type: 'reorder' | 'delivery' | 'price' | 'action'
  wineId?: string
}

export interface CalendarEvent {
  id: string
  type: 'important_date' | 'vendor_deadline' | 'recurring_order' | 'report_schedule' | 'delivery' | 'birthday' | 'tasting'
  title: string
  time?: string
  priority?: 'low' | 'medium' | 'high'
}

export type CalendarFilterType = 'all' | 'delivery' | 'order' | 'meeting' | 'inventory' | 'tasting' | 'reminder' | 'recurring' | 'custom'

export interface DayData {
  /** Vendor procurement SPEND for the day. Named and labelled as spend
   * since 2026-08-26 (OD-84) — it was rendered as "Total Revenue". */
  spend: number
  bottles: number
  avgPrice: number
  byType: { red: number; white: number; sparkling: number; rose: number; dessert: number }
  topSeller: string
  orders: number
  events: CalendarEvent[]
}

const formatEventTime = (time: string) => {
  const [h = '0', m = '00'] = time.split(':')
  const hour = parseInt(h, 10)
  return `${hour % 12 || 12}:${m.padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`
}

const formatDate = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

function generateRemindersFromRealData(
  wines: ReturnType<typeof mapApiWinesToUiWines>, 
  lowStockItems: Array<{ wineId?: string; wineName?: string; stockLive?: number; thresholdMin?: number }>,
  // `totalCost` and `inventoryId` are OrderResponseDto's own names. This
  // signature used to say `totalPrice` and `providerName`, which
  // GET /procurement/orders has never sent, so the reminder below printed
  // "$0" over every pending order and "Unknown provider" over every
  // delivery (measured 2026-09-05). `providerName` IS sent as of the same
  // day — the orders routes join `providers` — so the delivery reminder names
  // the vendor again, through `vendorLine` so an unnamed one says so.
  pendingOrders: Array<{ id?: string; inventoryId?: string; wineName?: string; quantity?: number; status?: string; totalCost?: number; providerName?: string | null }>,
  inventory: Array<{ wineId?: string; wineName?: string; shadowStock?: number }>
): Reminder[] {
  const reminders: Reminder[] = []
  lowStockItems.slice(0, 2).forEach((item, i) => {
    const wine = wines.find(w => w.id === item.wineId)
    const stock = item.stockLive || 0
    const threshold = item.thresholdMin ?? wine?.threshold ?? 6
    const bottleMl = (item as { bottleSizeMl?: number }).bottleSizeMl ?? wine?.bottleSizeMl ?? 750
    reminders.push({ id: `low_stock_${item.wineId || item.wineName || i}`, title: `${wine?.name || item.wineName || 'Wine'} (${formatVolume(bottleMl, useRestaurantSettingsStore.getState().measurementUnit)}) - ${stock} bottles remaining`, subtitle: `Min threshold: ${threshold}`, priority: stock <= threshold * 0.5 ? 'high' : 'medium', completed: false, type: 'action', wineId: item.wineId })
  })
  
  // Use pending orders from API instead of localStorage
  pendingOrders.filter((o: any) => o.status === 'pending' || o.status === 'approved' || o.status === 'PENDING' || o.status === 'APPROVED').slice(0, 2).forEach((order: any) => {
    reminders.push({ 
      id: `order_${order.id}`, 
      title: (order.status === 'pending' || order.status === 'PENDING') ? `Approve ${order.wineName || 'Order'} Reorder` : `Confirm ${order.wineName || 'Order'} Delivery`, 
      subtitle: `${order.quantity || 0} bottles · ${(order.status === 'pending' || order.status === 'PENDING') ? (typeof order.totalCost === 'number' ? `$${order.totalCost.toLocaleString()}` : 'no total on this order') : vendorLine(order)}`,
      priority: 'high', 
      completed: false, 
      dueTime: 'Today', 
      type: (order.status === 'pending' || order.status === 'PENDING') ? 'reorder' : 'delivery', 
      wineId: order.inventoryId 
    })
  })
  
  // Derive shadow stock from inventory data where shadow_stock > 0
  inventory.filter((item: any) => item.shadowStock && item.shadowStock > 0).slice(0, 1).forEach((item: any) => {
    const wine = wines.find(w => w.id === item.wineId)
    reminders.push({ 
      id: `shadow_${item.wineId}`, 
      title: 'Verify Stock Receipt', 
      subtitle: `${wine?.name || item.wineName || 'Wine'} · ${item.shadowStock} bottles in shadow stock`, 
      priority: 'medium', 
      completed: false, 
      type: 'action',
      wineId: item.wineId 
    })
  })
  
  if (reminders.length === 0) reminders.push({ id: 'default_1', title: 'All caught up!', subtitle: 'No pending actions at this time', priority: 'low', completed: true, type: 'action' })
  return reminders
}

/**
 * Per-day figures for the dashboard calendar. `spend` is vendor procurement
 * spend — either `dailyOrderData[].spend` from `useOrdersMetrics`, or
 * `daily[].procurement_spend` from the frozen `calendar-revenue` endpoint.
 * Both are money out. Nothing on this page reads POS sales.
 */
const generateCalendarSalesData = (baseDate: Date, eventsByDate: Record<string, CalendarEvent[]>, orderDailyData?: Array<{ date: string; orders: number; bottles: number; spend: number }>) => {
  const data: { [key: string]: DayData } = {}
  const m = baseDate.getMonth()
  const y = baseDate.getFullYear()
  const realDataByDate = new Map<string, { orders: number; bottles: number; spend: number }>()
  if (orderDailyData) orderDailyData.forEach(d => realDataByDate.set(d.date, d))
  for (let day = 1; day <= 31; day++) {
    const date = new Date(y, m, day)
    if (date.getMonth() !== m) break
    const dateStr = date.toISOString().split('T')[0]
    const realData = realDataByDate.get(dateStr)
    const spend = realData?.spend ?? 0
    const bottles = realData?.bottles ?? 0
    data[dateStr] = { spend, bottles, avgPrice: bottles > 0 ? Math.round(spend / bottles) : 0, byType: { red: 0, white: 0, sparkling: 0, rose: 0, dessert: 0 }, topSeller: '', orders: realData?.orders ?? 0, events: eventsByDate[dateStr] || [] }
  }
  return data
}

export function useDashboardPage() {
  const measurementUnit = useRestaurantSettingsStore((s) => s.measurementUnit)
  const [greeting, setGreeting] = useState('Good morning')
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [calendarMonth, setCalendarMonth] = useState(new Date())
  const [calendarFilterType, setCalendarFilterType] = useState<CalendarFilterType>('all')
  const [calendarSearchQuery, setCalendarSearchQuery] = useState('')
  const [selectedDay, setSelectedDay] = useState<{ date: string; data: DayData } | null>(null)
  // Vendor spend per day from the (misnamed) `calendar-revenue` endpoint. Shares
  // the shape of `useOrdersMetrics().dailyOrderData` because both feed
  // `generateCalendarSalesData`; the two must stay structurally identical.
  const [calendarSpendData, setCalendarSpendData] = useState<Array<{ date: string; orders: number; bottles: number; spend: number }>>([])
  
  const restaurantId = useAuthStore(state => state.activeRestaurantId)
  const { metrics: orderMetrics } = useOrdersMetrics()
  const { data: apiWines = [] } = useWines({ limit: 500 })
  const { stats: apiStats, inventorySummary, lowStockItems: apiLowStock, pendingOrders: apiPendingOrders, isLoading: dashboardLoading, error: dashboardError, refetch: refetchDashboard } = useDashboardData()
  
  const libraryWines = useMemo(() => mapApiWinesToUiWines(apiWines), [apiWines])
  
  const calendarStartDate = useMemo(
    () => formatLocalDateKey(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1)),
    [calendarMonth]
  )
  const calendarEndDate = useMemo(
    () => formatLocalDateKey(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0)),
    [calendarMonth]
  )
  
  const { data: dashboardCalendarEvents = [] } = useCalendarEvents(restaurantId || '', {
    startDate: calendarStartDate,
    endDate: calendarEndDate,
    eventType: calendarFilterType === 'all' ? undefined : calendarFilterType,
  })
  
  const mappedCalendarEvents = useMemo(
    () => dashboardCalendarEvents.map((e: any) => ({ ...e, date: parseCalendarDateString(e.date) })),
    [dashboardCalendarEvents]
  )
  const filteredCalendarEvents = useMemo(() => mappedCalendarEvents.filter((e: any) => {
    const matchesFilter = calendarFilterType === 'all' || e.type === calendarFilterType
    return matchesFilter && `${e.title || ''} ${e.description || ''} ${e.provider || ''}`.toLowerCase().includes(calendarSearchQuery.toLowerCase())
  }), [mappedCalendarEvents, calendarFilterType, calendarSearchQuery])
  
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {}
    filteredCalendarEvents.forEach((e: any) => {
      const dateKey = formatDate(e.date.getFullYear(), e.date.getMonth(), e.date.getDate())
      const event: CalendarEvent = { id: e.id, type: e.type || 'important_date', title: e.title, time: e.startTime ? formatEventTime(e.startTime) : undefined, priority: e.priority }
      map[dateKey] = map[dateKey] ? [...map[dateKey], event] : [event]
    })
    return map
  }, [filteredCalendarEvents])
  
  const calendarSalesData = useMemo(() => generateCalendarSalesData(calendarMonth, eventsByDate, calendarSpendData.length > 0 ? calendarSpendData : orderMetrics?.dailyOrderData), [calendarMonth, eventsByDate, calendarSpendData, orderMetrics?.dailyOrderData])
  const formatCurrency = (v: number) => formatMoney(v, 'compact')
  const formatNumber = (v: number) => fmtNumber(v)
  
  // Vendor spend on delivered procurement orders over the last 30 days. This was
  // labelled "Total Revenue"; it is the opposite — money out, not money in.
  const procurementSpendValue = typeof apiStats.monthProcurementSpend === 'number' ? formatCurrency(apiStats.monthProcurementSpend) : '—'
  const inventoryValue = typeof inventorySummary?.totalItems === 'number' ? formatNumber(inventorySummary.totalItems) : typeof apiStats.totalWines === 'number' ? formatNumber(apiStats.totalWines) : '—'
  const pendingOrdersValue = formatNumber(apiPendingOrders.length)
  const lowStockValue = formatNumber(apiLowStock.length)
  // `monthOverMonthGrowth` is computed from purchase-order totals, so it is the
  // month-over-month change in what we PAID vendors, not in what we earned.
  const procurementSpendChange = typeof orderMetrics?.monthOverMonthGrowth === 'number' ? orderMetrics.monthOverMonthGrowth : null
  const inventoryChange = typeof inventorySummary?.totalBottles === 'number' ? `${formatNumber(inventorySummary.totalBottles)} bottles · ${formatVolume(inventorySummary.totalBottles * 750)}` : typeof apiStats.totalBottles === 'number' ? `${formatNumber(apiStats.totalBottles)} bottles · ${formatVolume(apiStats.totalBottles * 750)}` : 'No data'
  const ordersChange = apiPendingOrders.length > 0 ? `${apiPendingOrders.length} awaiting` : 'No pending orders'
  const lowStockChange = typeof inventorySummary?.criticalCount === 'number' ? `${inventorySummary.criticalCount} critical` : 'No data'
  
  const stats = useMemo(() => [
    { id: 'procurementSpend' as const, label: 'Vendor Spend (30d)', value: procurementSpendValue, change: procurementSpendChange === null ? 'No data' : `${procurementSpendChange >= 0 ? '+' : ''}${procurementSpendChange.toFixed(1)}% vs last month`, trend: procurementSpendChange !== null && procurementSpendChange < 0 ? 'down' : 'up', icon: DollarSign, color: 'emerald' },
    { id: 'inventory' as const, label: 'Active Inventory', value: inventoryValue, change: inventoryChange, trend: typeof inventorySummary?.totalItems === 'number' || typeof apiStats.totalWines === 'number' ? 'up' : 'down', icon: Package, color: 'blue' },
    { id: 'orders' as const, label: 'Pending Orders', value: pendingOrdersValue, change: ordersChange, trend: apiPendingOrders.length > 0 ? 'up' : 'down', icon: ShoppingCart, color: 'amber' },
    { id: 'lowStock' as const, label: 'Low Stock Alerts', value: lowStockValue, change: lowStockChange, trend: typeof inventorySummary?.criticalCount === 'number' && inventorySummary.criticalCount > 0 ? 'down' : 'up', icon: AlertTriangle, color: 'rose' },
  ], [procurementSpendValue, inventoryValue, pendingOrdersValue, lowStockValue, procurementSpendChange, inventoryChange, ordersChange, lowStockChange, inventorySummary, apiStats, apiPendingOrders])
  
  const lowStockBuckets = useMemo(() => ({
    critical: apiLowStock.filter(i => i.stockLive <= i.thresholdMin * 0.5),
    warning: apiLowStock.filter(i => i.stockLive > i.thresholdMin * 0.5)
  }), [apiLowStock])
  
  const recentOrderRows = useMemo(() => apiPendingOrders.slice(0, 4).map(order => {
    const wine = libraryWines.find(w => w.id === order.inventoryId)
    const bottleMl = (order as { bottleSizeMl?: number }).bottleSizeMl ?? wine?.bottleSizeMl ?? 750
    // No producer and no vendor name on the wire: OrderResponseDto carries
    // `wineName` (joined from inventory) and `providerId` only.
    return { id: order.id, wine: order.wineName || 'Unknown wine', bottleFormat: formatVolume(bottleMl, measurementUnit), qty: order.quantity, status: order.status || 'pending', provider: 'Not named by this route' }
  }), [apiPendingOrders, libraryWines, measurementUnit])
  
  const libraryWinesRef = useRef(libraryWines)
  libraryWinesRef.current = libraryWines
  const apiLowStockRef = useRef(apiLowStock)
  apiLowStockRef.current = apiLowStock
  const apiPendingOrdersRef = useRef(apiPendingOrders)
  apiPendingOrdersRef.current = apiPendingOrders
  
  // Get inventory data for shadow stock
  const { inventory } = useInventoryData()
  const inventoryRef = useRef(inventory)
  inventoryRef.current = inventory
  
  const refreshReminders = useCallback(() => setReminders(generateRemindersFromRealData(
    libraryWinesRef.current, 
    apiLowStockRef.current || [],
    apiPendingOrdersRef.current || [],
    inventoryRef.current || []
  )), [])
  
  useEffect(() => {
    const h = new Date().getHours()
    setGreeting(h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening')
  }, [])
  
  useEffect(() => {
    if (!restaurantId) return
    const fetchCalendarSpend = async () => {
      try {
        const { getCalendarRevenue } = await import('../../services/api/dashboard')
        const data = await getCalendarRevenue(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, restaurantId)
        if (data?.daily?.length > 0) {
          setCalendarSpendData(data.daily.map(d => ({ date: d.date, orders: d.order_count, bottles: d.bottles_sold, spend: d.procurement_spend })))
        }
      } catch {
        /* calendar spend optional — dashboard still renders without it */
      }
    }
    fetchCalendarSpend()
  }, [calendarMonth, restaurantId])
  
  useEffect(() => {
    refreshReminders()
    const interval = setInterval(refreshReminders, 300000)
    return () => clearInterval(interval)
  }, [refreshReminders])
  
  const handleDayClick = useCallback((dateStr: string, dayData: DayData | undefined) => {
    const empty: DayData = {
      spend: 0,
      bottles: 0,
      avgPrice: 0,
      byType: { red: 0, white: 0, sparkling: 0, rose: 0, dessert: 0 },
      topSeller: '—',
      orders: 0,
      events: [],
    }
    setSelectedDay({ date: dateStr, data: dayData ?? empty })
  }, [])
  
  const navigateMonth = useCallback((direction: 'prev' | 'next') => {
    setCalendarMonth(prev => {
      const d = new Date(prev)
      d.setMonth(prev.getMonth() + (direction === 'prev' ? -1 : 1))
      return d
    })
  }, [])
  
  return {
    stats, apiStats, inventorySummary, lowStockItems: apiLowStock, pendingOrders: apiPendingOrders, orderMetrics, libraryWines, dashboardLoading, dashboardError,
    calendarMonth, calendarFilterType, calendarSearchQuery, selectedDay, calendarEvents: filteredCalendarEvents, calendarSalesData, eventsByDate,
    reminders, lowStockBuckets, recentOrderRows, greeting,
    refreshDashboard: refetchDashboard, refreshReminders, navigateMonth, handleDayClick, setCalendarFilterType, setCalendarSearchQuery, setSelectedDay, setReminders,
  }
}
