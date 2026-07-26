/**
 * Reports Page - Refactored with Notion-style DashboardCanvas
 * Uses react-grid-layout for drag/resize blocks with inline configuration.
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Reorder } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { useRealtimeDispatch } from '../contexts/RealtimeContext'
import { useInventoryData } from '../hooks/useInventoryData'
import { useOrdersMetrics } from '../hooks/useOrdersMetrics'
import { useWinesByIds } from '../hooks/queries'
import { mapApiWinesToUiWines } from '../lib/wine-library'
import { Header } from '../components/layout/Header'
import { exportTable, type TableExportColumn, type TableExportFormat } from '../lib/tableExport'
import {
  AlertTriangle,
  Wine,
  Settings,
} from 'lucide-react'
import { isInteractiveReorderSurfaceTarget } from '../lib/reports-drag'
import { ReportGenerator } from '../components/reports/ReportGenerator'
import { TopBar } from '../components/reports/organisms/TopBar'
import { HeadlineInsightsBar } from '../components/reports/organisms/HeadlineInsightsBar'
import { EngineInsightsPanel } from '../components/reports/organisms/EngineInsightsPanel'
import { SeatingDensityPanel } from '../components/reports/organisms/SeatingDensityPanel'
import { DataTablesSection, ExpandedSections } from '../components/reports/organisms/DataTablesSection'
import { AICommandPalette, AICommandPill } from '../components/reports/organisms/AICommandPalette'
import { MonthlyReconciliation } from '../components/reports/organisms/MonthlyReconciliation'
import { PeriodCompareBar } from '../components/reports/molecules/PeriodCompareBar'
import { formatMoney } from '../lib/utils'
import { formatVolume, costPerGlass, glassMarginPercent, bottlesToVolume, getGlassesPerBottle } from '../utils/volumeUtils'
import { useRestaurantSettingsStore } from '../stores/restaurantSettingsStore'
import {
  loadLayout,
  loadDashboardBlocks,
  parseLayoutFromPreferences,
  parseDashboardBlocksFromPreferences,
  serializeLayout,
  serializeDashboardBlocks,
} from '../lib/reports'
import { useUserPreferences } from '../hooks/useUserPreferences'
import type { LayoutConfig } from '../lib/reports/types'
import type { WineTypeDistribution, TopWine, PurchaseMetrics, CheckScan } from '../components/reports/molecules'

// New dashboard system
import { DashboardCanvas } from '../components/reports/DashboardCanvas'
import { EditToolbar } from '../components/reports/EditToolbar'
import { DEFAULT_BLOCKS } from '../components/reports/dashboardMeta'
import type { DashboardBlock, LayoutPreset } from '../components/reports/dashboardTypes'
import { KPISpotlightView } from '../components/reports/molecules/KPISpotlightView'

// Default sections configuration
const DEFAULT_SECTIONS = [
  { id: 'aiInsights', type: 'aiInsights' as const, visible: true, expanded: true },
  { id: 'reportGenerator', type: 'reportGenerator' as const, visible: true, expanded: false },
  { id: 'dailyBreakdown', type: 'dailyBreakdown' as const, visible: true, expanded: true },
  { id: 'purchasedWines', type: 'purchasedWines' as const, visible: true, expanded: false },
  { id: 'checkScanner', type: 'checkScanner' as const, visible: true, expanded: false },
]

type SalesDay = {
  date: string
  fullDate: string
  revenue: number
  orders: number
  bottles: number
  avgOrderValue: number
  red: number
  white: number
  sparkling: number
  rose: number
  dessert: number
}

const formatShortDate = (date: Date) =>
  date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

const createEmptySalesDay = (date: Date): SalesDay => ({
  date: formatShortDate(date),
  fullDate: date.toISOString().split('T')[0],
  revenue: 0,
  orders: 0,
  bottles: 0,
  avgOrderValue: 0,
  red: 0,
  white: 0,
  sparkling: 0,
  rose: 0,
  dessert: 0,
})

// Helper function to calculate margin
function calculateMargin(costPrice: number, menuPrice: number): number {
  if (!menuPrice || menuPrice === 0) return 0
  return ((menuPrice - costPrice) / menuPrice) * 100
}

// Helper function to get default menu price (3x markup as industry standard)
function getDefaultMenuPrice(costPrice: number): number {
  return Math.round(costPrice * 3)
}

// Generate metrics
const generateMetrics = (
  data: SalesDay[],
  inventoryData?: { inventory: any[]; summary: any },
  orderData?: {
    totalOrders: number
    totalOrderValue: number
    totalBottlesOrdered: number
    avgOrderValue: number
    revenueThisMonth: number
    monthOverMonthGrowth: number
    ordersByWineType: { red: number; white: number; sparkling: number; rose: number; dessert: number }
  },
) => {
  const totalRevenue = orderData?.totalOrderValue || data.reduce((sum, d) => sum + d.revenue, 0)
  const totalOrders = orderData?.totalOrders || data.reduce((sum, d) => sum + d.orders, 0)
  const totalBottles = orderData?.totalBottlesOrdered || data.reduce((sum, d) => sum + d.bottles, 0)
  const avgOrderValue = orderData?.avgOrderValue || (totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0)

  let revenueChange: number
  if (orderData) {
    revenueChange = orderData.monthOverMonthGrowth
  } else {
    const midpoint = Math.floor(data.length / 2)
    const firstHalf = data.slice(0, midpoint).reduce((sum, d) => sum + d.revenue, 0)
    const secondHalf = data.slice(midpoint).reduce((sum, d) => sum + d.revenue, 0)
    revenueChange = firstHalf > 0 ? parseFloat(((secondHalf - firstHalf) / firstHalf * 100).toFixed(1)) : 0
  }

  let totalCost: number
  let inventoryValue: number
  let profitMargin: number
  let totalMenuValue: number

  if (inventoryData?.inventory && inventoryData.inventory.length > 0) {
    totalCost = inventoryData.inventory.reduce((sum, item) => {
      const stock = (item.stockLive || 0) + (item.shadowStock || 0)
      const cost = item.price || item.costPrice || 0
      return sum + (cost * stock)
    }, 0)
    totalMenuValue = inventoryData.inventory.reduce((sum, item) => {
      const stock = (item.stockLive || 0) + (item.shadowStock || 0)
      const cost = item.price || item.costPrice || 0
      const menu = item.menuPrice || getDefaultMenuPrice(cost)
      return sum + (menu * stock)
    }, 0)
    inventoryValue = totalMenuValue
    profitMargin = totalMenuValue > 0 ? calculateMargin(totalCost, totalMenuValue) : 0
  } else {
    // No inventory data - show zeroes instead of fabricated estimates
    totalCost = 0
    inventoryValue = 0
    totalMenuValue = 0
    profitMargin = 0
  }

  const profitValue = totalMenuValue - totalCost

  return {
    totalRevenue,
    totalOrders,
    totalBottles,
    avgOrderValue,
    revenueChange,
    inventoryValue: Math.round(inventoryValue),
    profitMargin: parseFloat(profitMargin.toFixed(1)),
    profitValue: Math.round(profitValue),
    totalCost: Math.round(totalCost),
    totalMenuValue: Math.round(totalMenuValue),
    orderDataSource: orderData ? 'real' : 'synthetic',
  }
}


export function Reports() {
  const { user: _user } = useAuth()
  const { measurementUnit } = useRestaurantSettingsStore()
  const { dispatchReportEvent } = useRealtimeDispatch()

  // Fetch real inventory data
  const { inventory, summary: inventorySummary } = useInventoryData()
  const { metrics: orderMetrics, orders: _ordersHistory } = useOrdersMetrics()
  const { preferences, updatePreferences } = useUserPreferences()

  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d')
  const [loading, setLoading] = useState(true)
  const [exportSuccess, setExportSuccess] = useState<string | null>(null)

  // ── Legacy layout state (for sections - read-only) ──────────────────
  const [layout] = useState<LayoutConfig>(() => {
    const fromPrefs = parseLayoutFromPreferences(preferences.reportsLayout)
    return fromPrefs || loadLayout() || {
      kpiCards: [],
      charts: [],
      sections: DEFAULT_SECTIONS,
      version: 1,
    }
  })

  // ── New dashboard blocks state ─────────────────────────────────────
  const [dashboardBlocks, setDashboardBlocks] = useState<DashboardBlock[]>(() => {
    const fromPrefs = parseDashboardBlocksFromPreferences(preferences.dashboardBlocks)
    return fromPrefs || loadDashboardBlocks() || DEFAULT_BLOCKS
  })

  const [isEditMode, setIsEditMode] = useState(false)

  // Expanded sections state (includes extra keys beyond ExpandedSections for reconciliation)
  const [expandedSections, setExpandedSections] = useState<ExpandedSections & { reconciliation?: boolean }>({
    dailyBreakdown: true,
    purchasedWines: false,
    checkScanner: false,
    reconciliation: false,
  })

  // AI Insights state
  // (headline strip + EngineInsightsPanel; legacy AIInsightsSection removed)

  // KPI Spotlight state
  const [spotlightedKPI, setSpotlightedKPI] = useState<string | null>(null)

  // Period comparison state
  const [showComparison, setShowComparison] = useState(false)

  // AI Command Palette state
  const [showAIPalette, setShowAIPalette] = useState(false)

  // Reorderable section IDs (below the canvas)
  const [sectionOrder, setSectionOrder] = useState<string[]>([
    'aiInsights',
    'dataTable',
    'reconciliation',
    'consumption',
    'reportGenerator',
  ])

  // Close spotlight / AI palette on Escape key, ⌘K to open palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showAIPalette) { setShowAIPalette(false); return }
        if (spotlightedKPI) setSpotlightedKPI(null)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowAIPalette((v) => !v)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [spotlightedKPI, showAIPalette])

  // ── Data derivation ────────────────────────────────────────────────

  const inventoryById = useMemo(() => {
    const map = new Map<string, { wineId?: string }>()
    inventory.forEach((item) => {
      map.set(item.id, { wineId: item.wineId })
    })
    return map
  }, [inventory])

  const orderMasterWineIds = useMemo(() => {
    const ids = new Set<string>()
    _ordersHistory.forEach((order) => {
      const masterId = inventoryById.get(order.wineId)?.wineId || order.wineId
      if (masterId) ids.add(masterId)
    })
    return Array.from(ids)
  }, [_ordersHistory, inventoryById])

  const { data: orderWines = [] } = useWinesByIds(orderMasterWineIds)
  const wineTypeById = useMemo(() => {
    const map = new Map<string, 'red' | 'white' | 'sparkling' | 'rose' | 'dessert'>()
    mapApiWinesToUiWines(orderWines).forEach((wine) => {
      map.set(wine.id, wine.type)
    })
    return map
  }, [orderWines])

  const ordersWithType = useMemo(() => {
    return _ordersHistory.map((order) => {
      const masterId = inventoryById.get(order.wineId)?.wineId || order.wineId
      const wineType = masterId ? wineTypeById.get(masterId) : undefined
      return { ...order, wineType }
    })
  }, [_ordersHistory, inventoryById, wineTypeById])

  // Generate data based on time range using real orders
  const salesData = useMemo(() => {
    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90
    const now = new Date()
    const buckets = new Map<string, SalesDay>()
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now)
      date.setDate(date.getDate() - i)
      const day = createEmptySalesDay(date)
      buckets.set(day.fullDate, day)
    }

    ordersWithType.forEach((order) => {
      const orderDate = order.createdAt?.split('T')[0]
      if (!orderDate || !buckets.has(orderDate)) return
      const day = buckets.get(orderDate)!
      day.orders += 1
      day.bottles += order.quantity
      day.revenue += order.totalPrice
      if (order.wineType) {
        day[order.wineType] += order.quantity
      }
    })

    const result = Array.from(buckets.values())
    result.forEach((day) => {
      day.avgOrderValue = day.orders > 0 ? Math.round(day.revenue / day.orders) : 0
    })
    return result
  }, [ordersWithType, timeRange])

  const purchaseData = useMemo(() => {
    return salesData.map((day) => ({
      date: day.date,
      fullDate: day.fullDate,
      totalCost: day.revenue,
      totalBottles: day.bottles,
      orderCount: day.orders,
      red: day.red,
      white: day.white,
      sparkling: day.sparkling,
      rose: day.rose,
      dessert: day.dessert,
    }))
  }, [salesData])

  const wineTypeTotals = useMemo(() => ({
    red: salesData.reduce((sum, d) => sum + d.red, 0),
    white: salesData.reduce((sum, d) => sum + d.white, 0),
    sparkling: salesData.reduce((sum, d) => sum + d.sparkling, 0),
    rose: salesData.reduce((sum, d) => sum + d.rose, 0),
    dessert: salesData.reduce((sum, d) => sum + d.dessert, 0),
  }), [salesData])

  const metrics = useMemo(() => generateMetrics(
    salesData,
    { inventory, summary: inventorySummary },
    orderMetrics ? {
      totalOrders: orderMetrics.totalOrders,
      totalOrderValue: orderMetrics.totalOrderValue,
      totalBottlesOrdered: orderMetrics.totalBottlesOrdered,
      avgOrderValue: orderMetrics.avgOrderValue,
      revenueThisMonth: orderMetrics.revenueThisMonth,
      monthOverMonthGrowth: orderMetrics.monthOverMonthGrowth,
      ordersByWineType: wineTypeTotals,
    } : undefined,
  ), [salesData, inventory, inventorySummary, orderMetrics, wineTypeTotals])

  const purchaseMetrics: PurchaseMetrics = useMemo(() => {
    const totalSpent = purchaseData.reduce((sum, p) => sum + p.totalCost, 0)
    const totalBottlesPurchased = purchaseData.reduce((sum, p) => sum + p.totalBottles, 0)
    const totalOrders = purchaseData.length
    const avgCostPerBottle = totalBottlesPurchased > 0 ? totalSpent / totalBottlesPurchased : 0
    return { totalSpent, totalBottlesPurchased, totalOrders, avgCostPerBottle }
  }, [purchaseData])

  const checkScans: CheckScan[] = useMemo(() => [], [])

  const topWines: TopWine[] = useMemo(() => {
    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90
    const start = new Date()
    start.setDate(start.getDate() - (days - 1))
    const aggregation = new Map<string, TopWine>()
    ordersWithType.forEach((order) => {
      const orderDate = new Date(order.createdAt)
      if (orderDate < start) return
      const key = order.wineId || order.wineName
      const existing = aggregation.get(key) || {
        name: order.wineName,
        value: 0,
        orders: 0,
        red: 0,
        white: 0,
        sparkling: 0,
        rose: 0,
        dessert: 0,
      }
      existing.value += order.totalPrice
      existing.orders += order.quantity
      if (order.wineType) {
        existing[order.wineType] += order.quantity
      }
      aggregation.set(key, existing)
    })
    return Array.from(aggregation.values())
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
  }, [ordersWithType, timeRange])

  const wineTypeDistribution: WineTypeDistribution[] = useMemo(() => {
    const total = wineTypeTotals.red + wineTypeTotals.white + wineTypeTotals.sparkling + wineTypeTotals.rose + wineTypeTotals.dessert
    if (total <= 0) return []
    return [
      { name: 'Red', value: Math.round((wineTypeTotals.red / total) * 100), color: '#be123c' },
      { name: 'White', value: Math.round((wineTypeTotals.white / total) * 100), color: '#fbbf24' },
      { name: 'Sparkling', value: Math.round((wineTypeTotals.sparkling / total) * 100), color: '#facc15' },
      { name: 'Rosé', value: Math.round((wineTypeTotals.rose / total) * 100), color: '#f472b6' },
      { name: 'Dessert', value: Math.round((wineTypeTotals.dessert / total) * 100), color: '#a855f7' },
    ]
  }, [wineTypeTotals])

  // ── Consumption Analytics ────────────────────────────────────────────
  // Will come from wine_consumption_log API when POS is connected
  const consumptionData = useMemo(() => [], [])
  const hasConsumptionData = consumptionData.length > 0

  const bottleConsumptionRows = useMemo(() => consumptionData.filter((d: any) => d.bottlesSold > 0), [consumptionData])
  const glassConsumptionRows = useMemo(() => consumptionData.filter((d: any) => d.glassesSold > 0), [consumptionData])

  const consumptionTotals = useMemo(() => {
    if (!hasConsumptionData) {
      return { totalBottlesSold: 0, totalBottleRevenue: 0, totalBottleVolumeMl: 0, totalGlassesSold: 0, totalGlassRevenue: 0, totalGlassBottleEquiv: 0 }
    }
    const totalBottlesSold = consumptionData.reduce((s: number, d: any) => s + (d.bottlesSold || 0), 0)
    const totalBottleRevenue = consumptionData.reduce((s: number, d: any) => s + ((d.bottlesSold || 0) * (d.bottlePrice || 0)), 0)
    const totalBottleVolumeMl = consumptionData.reduce((s: number, d: any) => s + bottlesToVolume(d.bottlesSold || 0, d.bottleSizeMl || 750), 0)
    const totalGlassesSold = consumptionData.reduce((s: number, d: any) => s + (d.glassesSold || 0), 0)
    const totalGlassRevenue = consumptionData.reduce((s: number, d: any) => s + ((d.glassesSold || 0) * (d.glassPrice || 0)), 0)
    const totalGlassBottleEquiv = consumptionData.reduce((s: number, d: any) => {
      if (!d.glassesSold || d.glassesSold === 0) return s
      const gpb = getGlassesPerBottle(d.bottleSizeMl || 750, d.pourSizeMl || 150)
      return s + (gpb > 0 ? d.glassesSold / gpb : 0)
    }, 0)
    return { totalBottlesSold, totalBottleRevenue, totalBottleVolumeMl, totalGlassesSold, totalGlassRevenue, totalGlassBottleEquiv }
  }, [consumptionData, hasConsumptionData])

  // Get KPI value based on key
  const getKPIValue = useCallback((key: string): { value: string | number; change: number; changeType: 'increase' | 'decrease' } => {
    // All change values are 0 until real historical comparison data is available from POS
    switch (key) {
      case 'revenue':
        return { value: metrics.totalRevenue > 0 ? formatMoney(metrics.totalRevenue, 'compact') : '--', change: metrics.revenueChange, changeType: metrics.revenueChange >= 0 ? 'increase' : 'decrease' }
      case 'orders':
        return { value: metrics.totalOrders > 0 ? metrics.totalOrders : '--', change: 0, changeType: 'increase' as const }
      case 'bottles':
        return { value: metrics.totalBottles > 0 ? metrics.totalBottles : '--', change: 0, changeType: 'increase' as const }
      case 'avgOrder':
        return { value: metrics.avgOrderValue > 0 ? formatMoney(metrics.avgOrderValue, 'compact') : '--', change: 0, changeType: 'increase' as const }
      case 'profitMargin':
        return { value: metrics.profitMargin > 0 ? `${metrics.profitMargin}%` : '--', change: 0, changeType: 'increase' as const }
      case 'wineDistribution':
        return { value: (wineTypeTotals.red + wineTypeTotals.white) > 0 ? `${wineTypeTotals.red + wineTypeTotals.white}` : '--', change: 0, changeType: 'increase' as const }
      case 'topSellers':
        return { value: topWines.length > 0 ? `${topWines.length} wines` : '--', change: 0, changeType: 'increase' as const }
      case 'inventoryValue':
        return { value: metrics.inventoryValue > 0 ? formatMoney(metrics.inventoryValue, 'compact') : '--', change: 0, changeType: 'increase' as const }
      case 'purchaseCost':
        return { value: purchaseMetrics.totalSpent > 0 ? formatMoney(purchaseMetrics.totalSpent, 'compact') : '--', change: 0, changeType: 'increase' as const }
      default:
        return { value: '--', change: 0, changeType: 'increase' as const }
    }
  }, [metrics, wineTypeTotals, purchaseMetrics, topWines])

  // ── Persistence via user preferences API ────────────────────────────

  useEffect(() => {
    updatePreferences({ reportsLayout: serializeLayout(layout) as any })
    // Persist only when the layout changes. updatePreferences is a per-render
    // action wrapper; adding it would re-persist on every render (mutation →
    // re-render loop) and is not the intended trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout])

  useEffect(() => {
    updatePreferences({ dashboardBlocks: serializeDashboardBlocks(dashboardBlocks) as any })
    // Persist only when the dashboard blocks change (see note above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardBlocks])

  useEffect(() => {
    setLoading(true)
    const timer = setTimeout(() => setLoading(false), 500)
    return () => clearTimeout(timer)
  }, [timeRange])

  // ── Dashboard block handlers ────────────────────────────────────────

  const handleBlocksChange = useCallback((newBlocks: DashboardBlock[]) => {
    setDashboardBlocks(newBlocks)
  }, [])

  const handleAddBlock = useCallback((newBlock: DashboardBlock) => {
    setDashboardBlocks((prev) => [...prev, newBlock])
  }, [])

  const handleApplyPreset = useCallback((preset: LayoutPreset) => {
    setDashboardBlocks(preset.blocks.map((b) => ({ ...b })))
  }, [])

  const handleResetBlocks = useCallback(() => {
    setDashboardBlocks(DEFAULT_BLOCKS.map((b) => ({ ...b })))
  }, [])

  // ── Export handler (shared formats via tableExport) ─────────────────

  const handleExport = useCallback(async (format: TableExportFormat) => {
    const reportId = `rpt-${Date.now()}`
    const timestamp = new Date().toISOString()

    const columns: TableExportColumn<(typeof salesData)[number]>[] = [
      { header: 'Date', value: (d) => d.date },
      { header: 'Revenue', value: (d) => d.revenue },
      { header: 'Orders', value: (d) => d.orders },
      { header: 'Bottles', value: (d) => d.bottles },
      { header: 'Avg Order', value: (d) => d.avgOrderValue },
      { header: 'Red', value: (d) => d.red },
      { header: 'White', value: (d) => d.white },
      { header: 'Sparkling', value: (d) => d.sparkling },
      { header: 'Rose', value: (d) => d.rose },
      { header: 'Dessert', value: (d) => d.dessert },
    ]

    try {
      await exportTable({
        format,
        rows: salesData,
        columns,
        filename: `wineops-report-${timeRange}-${new Date().toISOString().slice(0, 10)}`,
        title: `WineOps AI Report · ${timeRange}`,
      })
      setExportSuccess(format)
      setTimeout(() => setExportSuccess(null), 3000)
    } catch {
      setExportSuccess(null)
    }

    await dispatchReportEvent({
      type: 'generated',
      reportId,
      reportType: 'sales-summary',
      format: format === 'excel' || format === 'pdf' || format === 'csv' ? format : 'csv',
      timestamp,
    })
  }, [salesData, timeRange, dispatchReportEvent])

  // Section toggle handler
  const handleSectionToggle = useCallback((section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section as keyof typeof prev] }))
  }, [])

  /** Renders one below-the-dashboard section (used both in static view and reorder mode). */
  function renderSectionContent(sectionId: string) {
    return (
      <>
        {sectionId === 'aiInsights' && (
          <div className="space-y-4">
            <div id="engine-insights">
              <EngineInsightsPanel />
            </div>
            <SeatingDensityPanel />
          </div>
        )}

        {sectionId === 'dataTable' && (
          <DataTablesSection
            dailyData={salesData}
            purchaseData={purchaseData}
            purchaseMetrics={purchaseMetrics}
            totalRevenue={metrics.totalRevenue}
            checkScans={checkScans}
            expandedSections={expandedSections}
            onToggle={handleSectionToggle}
            onCheckUpload={(file) => console.log('Check uploaded:', file.name)}
          />
        )}

        {sectionId === 'reconciliation' && (
          <MonthlyReconciliation totalBottlesSold={metrics.totalBottles} totalInventoryValue={metrics.inventoryValue} />
        )}

        {sectionId === 'consumption' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-pink-50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <Wine className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Wine Consumption Analytics</h3>
                  <p className="text-sm text-gray-500">Per-wine bottle and glass sales with volume tracking</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              {hasConsumptionData ? (
                <div className="space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 bg-purple-50 rounded-lg border border-purple-100">
                      <p className="text-xs text-purple-600 font-medium uppercase tracking-wide">Total Bottles Consumed</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">{consumptionTotals.totalBottlesSold} bottles</p>
                      <p className="text-sm text-gray-500">{formatVolume(consumptionTotals.totalBottleVolumeMl, measurementUnit)}</p>
                    </div>
                    <div className="p-4 bg-pink-50 rounded-lg border border-pink-100">
                      <p className="text-xs text-pink-600 font-medium uppercase tracking-wide">Total Glasses Consumed</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">{consumptionTotals.totalGlassesSold} glasses</p>
                      <p className="text-sm text-gray-500">= {consumptionTotals.totalGlassBottleEquiv.toFixed(1)} bottle equivalent</p>
                    </div>
                    <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100">
                      <p className="text-xs text-emerald-600 font-medium uppercase tracking-wide">Combined Revenue</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">
                        ${(consumptionTotals.totalBottleRevenue + consumptionTotals.totalGlassRevenue).toLocaleString()}
                      </p>
                      <p className="text-sm text-gray-500">
                        bottles: ${consumptionTotals.totalBottleRevenue.toLocaleString()} + glasses: $
                        {consumptionTotals.totalGlassRevenue.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {bottleConsumptionRows.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Bottles Consumed</h4>
                      <div className="overflow-x-auto rounded-lg border border-gray-200">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-200 bg-gray-50">
                              <th className="text-left py-2.5 px-3 font-medium text-gray-600">Wine</th>
                              <th className="text-left py-2.5 px-3 font-medium text-gray-600">Format</th>
                              <th className="text-right py-2.5 px-3 font-medium text-gray-600">Bottles Sold</th>
                              <th className="text-right py-2.5 px-3 font-medium text-gray-600">Revenue</th>
                              <th className="text-right py-2.5 px-3 font-medium text-gray-600">Total Volume</th>
                            </tr>
                          </thead>
                          <tbody>
                            {bottleConsumptionRows.map((d: any) => (
                              <tr key={d.wineName} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                                <td className="py-2.5 px-3 font-medium text-gray-900">{d.wineName}</td>
                                <td className="py-2.5 px-3 text-gray-600">{formatVolume(d.bottleSizeMl, measurementUnit)}</td>
                                <td className="py-2.5 px-3 text-right text-gray-900">{d.bottlesSold}</td>
                                <td className="py-2.5 px-3 text-right text-gray-900">
                                  ${((d.bottlesSold || 0) * (d.bottlePrice || 0)).toLocaleString()}
                                </td>
                                <td className="py-2.5 px-3 text-right text-gray-600">
                                  {formatVolume(bottlesToVolume(d.bottlesSold || 0, d.bottleSizeMl || 750), measurementUnit)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="bg-gray-50 font-semibold border-t border-gray-200">
                              <td className="py-2.5 px-3 text-gray-900" colSpan={2}>
                                Total
                              </td>
                              <td className="py-2.5 px-3 text-right text-gray-900">{consumptionTotals.totalBottlesSold}</td>
                              <td className="py-2.5 px-3 text-right text-gray-900">${consumptionTotals.totalBottleRevenue.toLocaleString()}</td>
                              <td className="py-2.5 px-3 text-right text-gray-900">
                                {formatVolume(consumptionTotals.totalBottleVolumeMl, measurementUnit)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}
                  {glassConsumptionRows.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Glasses Consumed</h4>
                      <div className="overflow-x-auto rounded-lg border border-gray-200">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-200 bg-gray-50">
                              <th className="text-left py-2.5 px-3 font-medium text-gray-600">Wine</th>
                              <th className="text-left py-2.5 px-3 font-medium text-gray-600">Pour Size</th>
                              <th className="text-right py-2.5 px-3 font-medium text-gray-600">Glasses Sold</th>
                              <th className="text-right py-2.5 px-3 font-medium text-gray-600">Revenue</th>
                              <th className="text-right py-2.5 px-3 font-medium text-gray-600">Bottle Equiv.</th>
                              <th className="text-right py-2.5 px-3 font-medium text-gray-600">Cost/Glass</th>
                              <th className="text-right py-2.5 px-3 font-medium text-gray-600">Margin</th>
                            </tr>
                          </thead>
                          <tbody>
                            {glassConsumptionRows.map((d: any) => {
                              const gpb = getGlassesPerBottle(d.bottleSizeMl || 750, d.pourSizeMl || 150)
                              const cpg = costPerGlass(d.costPerBottle || 0, gpb)
                              const margin = glassMarginPercent(cpg, d.glassPrice || 0)
                              const bottleEquiv = gpb > 0 ? ((d.glassesSold || 0) / gpb).toFixed(1) : '0'
                              return (
                                <tr key={d.wineName} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                                  <td className="py-2.5 px-3 font-medium text-gray-900">{d.wineName}</td>
                                  <td className="py-2.5 px-3 text-gray-600">{formatVolume(d.pourSizeMl || 150, measurementUnit)}</td>
                                  <td className="py-2.5 px-3 text-right text-gray-900">{d.glassesSold}</td>
                                  <td className="py-2.5 px-3 text-right text-gray-900">
                                    ${((d.glassesSold || 0) * (d.glassPrice || 0)).toLocaleString()}
                                  </td>
                                  <td className="py-2.5 px-3 text-right text-gray-600">{bottleEquiv}</td>
                                  <td className="py-2.5 px-3 text-right text-gray-600">${cpg.toFixed(2)}</td>
                                  <td className="py-2.5 px-3 text-right">
                                    <span
                                      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                                        margin >= 70
                                          ? 'bg-emerald-100 text-emerald-700'
                                          : margin >= 50
                                            ? 'bg-amber-100 text-amber-700'
                                            : 'bg-red-100 text-red-700'
                                      }`}
                                    >
                                      {margin.toFixed(1)}%
                                    </span>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="bg-gray-50 font-semibold border-t border-gray-200">
                              <td className="py-2.5 px-3 text-gray-900" colSpan={2}>
                                Total
                              </td>
                              <td className="py-2.5 px-3 text-right text-gray-900">{consumptionTotals.totalGlassesSold}</td>
                              <td className="py-2.5 px-3 text-right text-gray-900">
                                ${consumptionTotals.totalGlassRevenue.toLocaleString()}
                              </td>
                              <td className="py-2.5 px-3 text-right text-gray-900">
                                {consumptionTotals.totalGlassBottleEquiv.toFixed(1)}
                              </td>
                              <td className="py-2.5 px-3" colSpan={2}></td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 px-4">
                  <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mb-4">
                    <Wine className="w-8 h-8 text-purple-600" />
                  </div>
                  <h4 className="text-lg font-semibold text-gray-900 mb-2">
                    Connect your POS system to see wine consumption analytics
                  </h4>
                  <p className="text-sm text-gray-500 text-center max-w-md mb-6">
                    Once connected, you&apos;ll see detailed analytics including bottles sold, glasses sold, revenue breakdown, and margin
                    analysis per wine.
                  </p>
                  <Link
                    to="/settings?tab=pos"
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    Configure POS
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}

        {sectionId === 'reportGenerator' && (
          <ReportGenerator
            onGenerate={(templateId, options) => {
              console.log('Generating report:', templateId, options)
            }}
            salesData={salesData}
            metrics={metrics}
          />
        )}
      </>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-wine-200 border-t-wine-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading reports...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Reports & Analytics" subtitle="Track your wine operations performance" />

      <div className="p-6 space-y-6">
        {/* POS Connectivity Indicator */}
        {metrics.totalRevenue === 0 && metrics.totalOrders === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-900">POS Not Connected</p>
              <p className="text-xs text-amber-700">
                No sales data available. Connect your Toast POS system in Settings to see real revenue and order data.
                Currently showing placeholder metrics.
              </p>
            </div>
            <a
              href="/settings?tab=pos"
              className="ml-auto px-4 py-2 bg-amber-600 text-white text-xs font-medium rounded-lg hover:bg-amber-700 transition-colors whitespace-nowrap"
            >
              Configure POS
            </a>
          </div>
        )}

        {/* Plain-language AI insights (above controls) */}
        {(metrics.totalRevenue > 0 || metrics.totalOrders > 0) && (
          <HeadlineInsightsBar
            onSeeDetails={() => {
              const el = document.getElementById('engine-insights')
              const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
              el?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
            }}
          />
        )}

        {/* Top Control Bar */}
        <TopBar
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          isEditMode={isEditMode}
          onEditToggle={() => setIsEditMode(!isEditMode)}
          onOpenArrange={() => setIsEditMode(true)}
          onExport={handleExport}
          exportSuccess={exportSuccess}
          exportCount={salesData.length}
          showComparison={showComparison}
          onToggleComparison={() => setShowComparison((v) => !v)}
        />

        {/* Edit Toolbar (replaces old EditLayoutPanel) */}
        <EditToolbar
          isEditMode={isEditMode}
          onToggleEditMode={() => setIsEditMode(!isEditMode)}
          onAddBlock={handleAddBlock}
          onApplyPreset={handleApplyPreset}
          onReset={handleResetBlocks}
        />

        {/* Dashboard Canvas — react-grid-layout drag/resize for all chart blocks */}
        <DashboardCanvas
          blocks={dashboardBlocks}
          isEditMode={isEditMode}
          onBlocksChange={handleBlocksChange}
          salesData={salesData}
          wineTypeDistribution={wineTypeDistribution}
          topWines={topWines}
          timeRange={timeRange}
          getKPIValue={getKPIValue}
          onKPIClick={(kpiKey) => setSpotlightedKPI(prev => prev === kpiKey ? null : kpiKey)}
          spotlightedKPI={spotlightedKPI}
          totalOrders={metrics.totalOrders}
          totalRevenue={metrics.totalRevenue}
        />

        {/* Period Comparison Bar (optional, below canvas) */}
        {showComparison && salesData.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Period Comparison — Revenue
            </p>
            <PeriodCompareBar
              currentData={salesData.map((d) => ({ date: d.date, value: d.revenue }))}
              metric="revenue"
            />
          </div>
        )}

        {/* KPI Spotlight Detail Panel */}
        <KPISpotlightView
          kpiKey={spotlightedKPI || 'revenue'}
          title={spotlightedKPI ? {
            revenue: 'Total Revenue',
            orders: 'Total Orders',
            bottles: 'Bottles Sold',
            avgOrder: 'Average Order Value',
            inventoryValue: 'Inventory Value',
            profitMargin: 'Profit Margin',
            purchaseCost: 'Purchase Cost',
          }[spotlightedKPI] || 'KPI Detail' : ''}
          currentValue={spotlightedKPI ? getKPIValue(spotlightedKPI).value : 0}
          isOpen={!!spotlightedKPI}
          onClose={() => setSpotlightedKPI(null)}
          salesData={salesData.map(d => ({
            date: d.date,
            revenue: d.revenue,
            orders: d.orders ?? 0,
            bottles: d.bottles,
            avgOrderValue: (d as any).avgOrderValue ?? 0,
            red: d.red ?? 0,
            white: d.white ?? 0,
            sparkling: d.sparkling ?? 0,
            rose: d.rose ?? 0,
            dessert: d.dessert ?? 0,
          }))}
          wineTypeTotals={wineTypeTotals}
          topWines={topWines}
          metrics={metrics}
        />

        {/* Below-dashboard sections — full-card drag reorder in Edit layout */}
        {isEditMode ? (
          <Reorder.Group axis="y" values={sectionOrder} onReorder={setSectionOrder} className="space-y-6" as="div">
            {sectionOrder.map((sectionId) => (
              <Reorder.Item
                key={sectionId}
                value={sectionId}
                as="div"
                style={{ cursor: 'grab', listStyle: 'none' }}
                whileDrag={{
                  cursor: 'grabbing',
                  scale: 1.008,
                  boxShadow: '0 16px 40px rgba(0,0,0,0.12)',
                  zIndex: 40,
                  position: 'relative',
                }}
                className="rounded-xl outline outline-1 outline-transparent transition-[outline-color] hover:outline-blue-100"
              >
                <div
                  onPointerDown={(e) => {
                    if (isInteractiveReorderSurfaceTarget(e.target)) e.stopPropagation()
                  }}
                >
                  {renderSectionContent(sectionId)}
                </div>
              </Reorder.Item>
            ))}
          </Reorder.Group>
        ) : (
          <div className="space-y-6">
            {sectionOrder.map((sectionId) => (
              <div key={sectionId}>{renderSectionContent(sectionId)}</div>
            ))}
          </div>
        )}
      </div>

      {/* AI Command Palette (global overlay) */}
      <AICommandPalette
        isOpen={showAIPalette}
        onClose={() => setShowAIPalette(false)}
        timeRange={timeRange}
      />

      {/* Floating ⌘K pill — always visible */}
      {!showAIPalette && (
        <AICommandPill onClick={() => setShowAIPalette(true)} />
      )}
    </div>
  )
}

export default Reports
