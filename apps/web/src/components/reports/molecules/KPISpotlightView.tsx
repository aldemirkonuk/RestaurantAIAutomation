/**
 * KPISpotlightView - Pure Spotlight Mode drill-down for KPI cards.
 *
 * When a KPI card is clicked it scales up in-place and this panel slides in
 * below, spanning full width, with custom tabs per KPI type.
 */

import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, TrendingUp, TrendingDown, Calendar, BarChart3, PieChart, Table2, FileDown } from 'lucide-react'
import { AreaChart, BarChart, DonutChart } from '@tremor/react'
import { formatMoney, formatNumber } from '../../../lib/utils'
import { ExportMenu } from '../../ui/ExportMenu'
import { exportTable, type TableExportColumn, type TableExportFormat } from '../../../lib/tableExport'
import { toast } from 'sonner'

// ─── Types ─────────────────────────────────────────────────────────────

export interface SpotlightTab {
  id: string
  label: string
  icon: React.ElementType
}

export interface KPISpotlightConfig {
  kpiKey: string
  title: string
  tabs: SpotlightTab[]
}

interface KPISpotlightViewProps {
  kpiKey: string
  title: string
  currentValue: string | number
  isOpen: boolean
  onClose: () => void
  purchaseDayData: PurchaseDayPoint[]
  wineTypeTotals: { red: number; white: number; sparkling: number; rose: number; dessert: number }
  topWines: { name: string; value: number }[]
  metrics: {
    /** Total vendor spend (procurement_orders), not sales revenue. */
    totalSpend: number
    totalOrders: number
    totalBottles: number
    avgOrderValue: number
    inventoryValue: number
    profitMargin: number
  }
}

/**
 * One day of PURCHASE-order activity. `spend` is money paid to vendors
 * (procurement_orders); this view never reads POS sales revenue.
 */
interface PurchaseDayPoint {
  date: string
  spend: number
  orders: number
  bottles: number
  avgOrderValue: number
  red: number
  white: number
  sparkling: number
  rose: number
  dessert: number
}

// ─── Tab Configs ───────────────────────────────────────────────────────

const KPI_TAB_CONFIGS: Record<string, SpotlightTab[]> = {
  revenue: [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'heatmap', label: 'Heatmap', icon: Calendar },
    { id: 'byType', label: 'By Wine Type', icon: PieChart },
    { id: 'export', label: 'Export', icon: FileDown },
  ],
  orders: [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'byProvider', label: 'By Provider', icon: Table2 },
    { id: 'status', label: 'Status Breakdown', icon: PieChart },
    { id: 'export', label: 'Export', icon: FileDown },
  ],
  bottles: [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'byCategory', label: 'By Category', icon: PieChart },
    { id: 'heatmap', label: 'Heatmap', icon: Calendar },
    { id: 'export', label: 'Export', icon: FileDown },
  ],
  avgOrder: [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'distribution', label: 'Distribution', icon: PieChart },
    { id: 'byProvider', label: 'By Provider', icon: Table2 },
    { id: 'export', label: 'Export', icon: FileDown },
  ],
  inventoryValue: [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'byCategory', label: 'By Category', icon: PieChart },
    { id: 'costVsMenu', label: 'Cost vs Menu', icon: Table2 },
    { id: 'export', label: 'Export', icon: FileDown },
  ],
  profitMargin: [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'bestWorst', label: 'Best / Worst', icon: TrendingUp },
    { id: 'byCategory', label: 'By Category', icon: PieChart },
    { id: 'export', label: 'Export', icon: FileDown },
  ],
}

// ─── Heatmap Calendar Sub-component ────────────────────────────────────

function HeatmapCalendar({ data, valueKey }: { data: PurchaseDayPoint[]; valueKey: 'spend' | 'bottles' | 'orders' }) {
  const maxVal = Math.max(...data.map(d => (d as any)[valueKey] || 0), 1)

  const getIntensity = (val: number) => {
    if (val === 0) return 'bg-gray-100'
    const ratio = val / maxVal
    if (ratio > 0.75) return 'bg-wine-600'
    if (ratio > 0.5) return 'bg-wine-400'
    if (ratio > 0.25) return 'bg-wine-300'
    return 'bg-wine-200'
  }

  const weeks: PurchaseDayPoint[][] = []
  for (let i = 0; i < data.length; i += 7) {
    weeks.push(data.slice(i, i + 7))
  }

  const hasData = data.some(d => (d as any)[valueKey] > 0)

  if (!hasData) {
    return (
      <EmptyStateCard
        title="No Activity Data"
        description="Purchasing intensity appears here once orders are recorded."
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-[3px] overflow-x-auto pb-2">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {week.map((day, di) => (
              <div
                key={di}
                className={`w-4 h-4 rounded-sm ${getIntensity((day as any)[valueKey] || 0)} transition-colors`}
                title={`${day.date}: ${valueKey === 'spend' ? formatMoney((day as any)[valueKey], 'full') : (day as any)[valueKey]}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span>Less</span>
        <div className="flex gap-[2px]">
          <div className="w-3 h-3 rounded-sm bg-gray-100" />
          <div className="w-3 h-3 rounded-sm bg-wine-200" />
          <div className="w-3 h-3 rounded-sm bg-wine-300" />
          <div className="w-3 h-3 rounded-sm bg-wine-400" />
          <div className="w-3 h-3 rounded-sm bg-wine-600" />
        </div>
        <span>More</span>
      </div>
    </div>
  )
}

// ─── Empty State Card ──────────────────────────────────────────────────

function EmptyStateCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mb-4">
        <BarChart3 className="w-7 h-7 text-gray-400" />
      </div>
      <h4 className="text-base font-medium text-gray-700 mb-1">{title}</h4>
      <p className="text-sm text-gray-500 max-w-xs">{description}</p>
      <Link
        to="/settings?tab=pos"
        className="mt-4 px-4 py-2 text-sm font-medium text-wine-600 bg-wine-50 rounded-lg hover:bg-wine-100 transition-colors"
      >
        Configure POS
      </Link>
    </div>
  )
}

// ─── Stats Row ─────────────────────────────────────────────────────────

function StatsRow({ stats }: { stats: { label: string; value: string; trend?: 'up' | 'down' | null }[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((stat, i) => (
        <div key={i} className="bg-gray-50 rounded-xl p-4">
          <p className="text-xs font-medium text-gray-500 mb-1">{stat.label}</p>
          <div className="flex items-center gap-1.5">
            <p className="text-lg font-bold text-gray-900">{stat.value}</p>
            {stat.trend === 'up' && <TrendingUp className="w-4 h-4 text-emerald-500" />}
            {stat.trend === 'down' && <TrendingDown className="w-4 h-4 text-rose-500" />}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Wine Type Donut ───────────────────────────────────────────────────

function WineTypeDonut({ totals, mode }: { totals: Record<string, number>; mode: 'spend' | 'bottles' }) {
  const data = [
    { name: 'Red', value: totals.red || 0 },
    { name: 'White', value: totals.white || 0 },
    { name: 'Sparkling', value: totals.sparkling || 0 },
    { name: 'Rose', value: totals.rose || 0 },
    { name: 'Dessert', value: totals.dessert || 0 },
  ].filter(d => d.value > 0)

  if (data.length === 0) {
    return <EmptyStateCard title="No Category Data" description="Purchasing by wine type appears here once orders are recorded." />
  }

  return (
    <div className="flex items-center gap-8">
      <DonutChart
        data={data}
        category="value"
        index="name"
        colors={['rose', 'amber', 'yellow', 'pink', 'purple']}
        className="w-48 h-48"
        valueFormatter={mode === 'spend' ? (v) => formatMoney(v, 'compact') : (v) => formatNumber(v, 'compact')}
      />
      <div className="space-y-2">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <div className={`w-3 h-3 rounded-full ${
              ['bg-rose-500', 'bg-amber-500', 'bg-yellow-500', 'bg-pink-500', 'bg-purple-500'][i]
            }`} />
            <span className="text-gray-600">{d.name}</span>
            <span className="font-semibold text-gray-900 ml-auto">
              {mode === 'spend' ? formatMoney(d.value, 'compact') : formatNumber(d.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────

export function KPISpotlightView({
  kpiKey,
  title,
  currentValue: _currentValue,
  isOpen,
  onClose,
  purchaseDayData,
  wineTypeTotals,
  topWines,
  metrics: _metrics,
}: KPISpotlightViewProps) {
  const tabs = KPI_TAB_CONFIGS[kpiKey] || KPI_TAB_CONFIGS.revenue
  const [activeTab, setActiveTab] = useState(tabs[0].id)

  // Computed stats per KPI
  const statsRow = useMemo(() => {
    // NOTE: 'revenue' is a frozen persisted layout key; the value it selects
    // is vendor spend.
    const vals = purchaseDayData.map(d => {
      switch (kpiKey) {
        case 'revenue': return d.spend
        case 'orders': return d.orders
        case 'bottles': return d.bottles
        case 'avgOrder': return d.avgOrderValue
        default: return d.spend
      }
    }).filter(v => v > 0)

    if (vals.length === 0) return null

    const sum = vals.reduce((a, b) => a + b, 0)
    const avg = sum / vals.length
    const best = Math.max(...vals)
    const worst = Math.min(...vals)
    const isCurrency = kpiKey === 'revenue' || kpiKey === 'avgOrder'
    const fmt = (v: number) => isCurrency ? formatMoney(v, 'compact') : formatNumber(v, 'compact')

    return [
      { label: 'Daily Average', value: fmt(avg), trend: null as 'up' | 'down' | null },
      { label: 'Best Day', value: fmt(best), trend: 'up' as const },
      { label: 'Worst Day', value: fmt(worst), trend: 'down' as const },
      { label: 'Total', value: fmt(sum), trend: null },
    ]
  }, [purchaseDayData, kpiKey])

  const hasData = purchaseDayData.some(d => d.spend > 0 || d.orders > 0 || d.bottles > 0)

  // Chart data key mapping
  const chartValueKey = kpiKey === 'revenue' ? 'spend'
    : kpiKey === 'orders' ? 'orders'
    : kpiKey === 'bottles' ? 'bottles'
    : kpiKey === 'avgOrder' ? 'avgOrderValue'
    : 'spend'

  const isCurrency = kpiKey === 'revenue' || kpiKey === 'avgOrder' || kpiKey === 'inventoryValue' || kpiKey === 'purchaseCost'

  const handleExport = async (format: TableExportFormat) => {
    const columns: TableExportColumn<(typeof purchaseDayData)[number]>[] = [
      { header: 'Date', value: (d) => d.date },
      { header: 'Vendor Spend', value: (d) => d.spend },
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
        rows: purchaseDayData,
        columns,
        filename: `wineops-${kpiKey}-${new Date().toISOString().split('T')[0]}`,
        title: `KPI · ${kpiKey}`,
      })
      toast.success(format === 'clipboard' ? 'Copied KPI data' : format === 'print' ? 'Opening print view' : 'Exported KPI data')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    }
  }

  // ─── Tab Content Renderers ───────────────────────────────────────────

  const renderOverview = () => {
    if (!hasData) {
      return <EmptyStateCard title="No Data Available" description="This metric fills in once purchase orders are recorded." />
    }

    const chartData = purchaseDayData.map(d => ({
      date: d.date,
      [chartValueKey]: (d as any)[chartValueKey] ?? 0,
    }))

    return (
      <div className="space-y-6">
        {statsRow && <StatsRow stats={statsRow} />}
        <div className="h-64">
          <AreaChart
            data={chartData}
            index="date"
            categories={[chartValueKey]}
            colors={['rose']}
            valueFormatter={isCurrency ? (v) => formatMoney(v, 'compact') : (v) => formatNumber(v, 'compact')}
            showLegend={false}
            showGridLines
            showYAxis
            showAnimation
            className="h-full"
          />
        </div>
      </div>
    )
  }

  const renderHeatmap = () => (
    <div className="space-y-4">
      <h4 className="text-sm font-medium text-gray-700">
        {kpiKey === 'bottles' ? 'Bottles Purchased' : 'Vendor Spend'} Intensity by Day
      </h4>
      <HeatmapCalendar data={purchaseDayData} valueKey={kpiKey === 'bottles' ? 'bottles' : 'spend'} />
    </div>
  )

  const renderByType = () => (
    <div className="space-y-6">
      <WineTypeDonut totals={wineTypeTotals} mode={kpiKey === 'bottles' ? 'bottles' : 'spend'} />
      {topWines.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-3">Top Performers</h4>
          <div className="space-y-2">
            {topWines.slice(0, 5).map((wine, i) => (
              <div key={i} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 bg-wine-100 text-wine-700 rounded-full flex items-center justify-center text-xs font-bold">
                    {i + 1}
                  </span>
                  <span className="text-sm font-medium text-gray-900 truncate max-w-[200px]">{wine.name}</span>
                </div>
                <span className="text-sm font-bold text-gray-900">{formatMoney(wine.value, 'compact')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  const renderStatus = () => {
    if (!hasData) return <EmptyStateCard title="No Order Data" description="Order status breakdown will appear when you have active orders." />
    return (
      <EmptyStateCard title="Status Breakdown" description="Order status distribution will populate from real order data once POS is connected." />
    )
  }

  const renderDistribution = () => {
    if (!hasData) return <EmptyStateCard title="No Distribution Data" description="Order value distribution appears once purchase orders are recorded." />
    return (
      <div className="space-y-6">
        {statsRow && <StatsRow stats={statsRow} />}
        <div className="h-64">
          <BarChart
            data={purchaseDayData.filter(d => d.avgOrderValue > 0).map(d => ({ date: d.date, 'Avg Value': d.avgOrderValue }))}
            index="date"
            categories={['Avg Value']}
            colors={['rose']}
            valueFormatter={(v) => formatMoney(v, 'compact')}
            className="h-full"
            showAnimation
          />
        </div>
      </div>
    )
  }

  const renderBestWorst = () => {
    if (topWines.length === 0) return <EmptyStateCard title="No Margin Data" description="Best and worst margin wines will appear when inventory cost and menu price data is available." />
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h4 className="text-sm font-semibold text-emerald-700 mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> Top 5 Highest
          </h4>
          <div className="space-y-2">
            {topWines.slice(0, 5).map((w, i) => (
              <div key={i} className="flex items-center justify-between py-2 px-3 bg-emerald-50 rounded-lg">
                <span className="text-sm text-gray-900 truncate max-w-[180px]">{w.name}</span>
                <span className="text-sm font-bold text-emerald-700">{formatMoney(w.value, 'compact')}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-rose-700 mb-3 flex items-center gap-2">
            <TrendingDown className="w-4 h-4" /> Bottom 5 Lowest
          </h4>
          <div className="space-y-2">
            {[...topWines].reverse().slice(0, 5).map((w, i) => (
              <div key={i} className="flex items-center justify-between py-2 px-3 bg-rose-50 rounded-lg">
                <span className="text-sm text-gray-900 truncate max-w-[180px]">{w.name}</span>
                <span className="text-sm font-bold text-rose-700">{formatMoney(w.value, 'compact')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const renderByProvider = () => (
    <EmptyStateCard title="Provider Breakdown" description="Orders grouped by provider will populate from real procurement data." />
  )

  const renderCostVsMenu = () => (
    <EmptyStateCard title="Cost vs Menu Price" description="Margin comparison per wine will appear when both cost and menu prices are set." />
  )

  const renderExport = () => (
    <div className="flex flex-col items-center justify-center py-8 space-y-4">
      <FileDown className="w-10 h-10 text-gray-400" />
      <p className="text-sm text-gray-600">Export this KPI's data for external analysis</p>
      <ExportMenu
        variant="wine"
        label="Export"
        count={purchaseDayData.length}
        onExport={handleExport}
        title="Export this KPI's data"
      />
    </div>
  )

  const tabContent: Record<string, () => React.ReactNode> = {
    overview: renderOverview,
    heatmap: renderHeatmap,
    byType: renderByType,
    byCategory: renderByType,
    status: renderStatus,
    distribution: renderDistribution,
    bestWorst: renderBestWorst,
    byProvider: renderByProvider,
    costVsMenu: renderCostVsMenu,
    export: renderExport,
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40"
            onClick={onClose}
          />

          {/* Detail Panel */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="relative z-50 mt-4 bg-white rounded-2xl border border-gray-200 shadow-xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-wine-50 to-purple-50">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{title}</h3>
                <p className="text-sm text-gray-500">Detailed breakdown and analysis</p>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/50 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200">
              {tabs.map(tab => {
                const TabIcon = tab.icon
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                      activeTab === tab.id
                        ? 'text-wine-700 border-b-2 border-wine-600 bg-wine-50/50'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <TabIcon className="w-4 h-4" />
                    {tab.label}
                  </button>
                )
              })}
            </div>

            {/* Tab Content */}
            <div className="p-6 max-h-[50vh] overflow-y-auto">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.15 }}
                >
                  {(tabContent[activeTab] || renderOverview)()}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
