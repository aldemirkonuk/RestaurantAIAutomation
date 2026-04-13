/**
 * Dashboard Metadata Constants
 * Data source & chart type metadata, compatibility matrix, and default blocks.
 */

import {
  DollarSign,
  ShoppingCart,
  Package,
  Wine,
  TrendingUp,
  Activity,
  Percent,
  Layers,
  BarChart3,
  Calendar,
  Users,
  Target,
  AreaChart,
  LineChart,
  PieChart,
  LayoutGrid,
  Columns,
  Rows,
  Maximize2,
} from 'lucide-react'
import type {
  DataSourceMeta,
  ChartTypeMeta,
  DashboardBlock,
  LayoutPreset,
  ChartType,
} from './dashboardTypes'

// ── Data sources ───────────────────────────────────────────────────────

export const DATA_SOURCES: DataSourceMeta[] = [
  { key: 'revenue', title: 'Revenue', icon: DollarSign, description: 'Total sales revenue over time', compatibleChartTypes: ['area', 'line', 'bar'], supportsKPI: true, supportsTable: true, category: 'time-series' },
  { key: 'orders', title: 'Orders', icon: ShoppingCart, description: 'Number of orders placed', compatibleChartTypes: ['area', 'line', 'bar'], supportsKPI: true, supportsTable: true, category: 'time-series' },
  { key: 'bottles', title: 'Bottles Sold', icon: Package, description: 'Total bottles sold', compatibleChartTypes: ['area', 'line', 'bar'], supportsKPI: true, supportsTable: true, category: 'time-series' },
  { key: 'wineDistribution', title: 'Wine Distribution', icon: Wine, description: 'Sales breakdown by wine type', compatibleChartTypes: ['donut', 'bar', 'stacked-bar'], supportsKPI: false, supportsTable: true, category: 'distribution' },
  { key: 'topWines', title: 'Top Wines', icon: TrendingUp, description: 'Best performing wines', compatibleChartTypes: ['bar'], supportsKPI: false, supportsTable: true, category: 'ranked' },
  { key: 'purchaseCost', title: 'Purchase Cost', icon: Activity, description: 'Total purchase expenses', compatibleChartTypes: ['area', 'line', 'bar'], supportsKPI: true, supportsTable: true, category: 'time-series' },
  { key: 'profitMargin', title: 'Profit Margin', icon: Percent, description: 'Profit percentage over time', compatibleChartTypes: ['area', 'line', 'bar'], supportsKPI: true, supportsTable: true, category: 'time-series' },
  { key: 'inventoryValue', title: 'Inventory Value', icon: Layers, description: 'Total inventory worth', compatibleChartTypes: ['area', 'line', 'bar'], supportsKPI: true, supportsTable: true, category: 'time-series' },
  { key: 'ordersByType', title: 'Orders by Type', icon: BarChart3, description: 'Orders categorized by wine type', compatibleChartTypes: ['stacked-bar', 'bar', 'donut'], supportsKPI: false, supportsTable: true, category: 'categorical' },
  { key: 'dailyBreakdown', title: 'Daily Breakdown', icon: Calendar, description: 'Day-by-day performance', compatibleChartTypes: ['bar', 'line', 'area'], supportsKPI: false, supportsTable: true, category: 'time-series' },
  { key: 'providerPerformance', title: 'Provider Performance', icon: Users, description: 'Supplier metrics', compatibleChartTypes: ['bar'], supportsKPI: false, supportsTable: true, category: 'ranked' },
  { key: 'salesTrend', title: 'Sales Trend', icon: Target, description: 'Sales trajectory analysis', compatibleChartTypes: ['area', 'line', 'bar'], supportsKPI: true, supportsTable: true, category: 'time-series' },
]

export const DATA_SOURCE_MAP = Object.fromEntries(DATA_SOURCES.map((ds) => [ds.key, ds])) as Record<string, DataSourceMeta>

// ── Chart types ────────────────────────────────────────────────────────

export const CHART_TYPES: ChartTypeMeta[] = [
  { key: 'area', title: 'Area Chart', icon: AreaChart, description: 'Filled area visualization' },
  { key: 'line', title: 'Line Chart', icon: LineChart, description: 'Simple line graph' },
  { key: 'bar', title: 'Bar Chart', icon: BarChart3, description: 'Vertical bars' },
  { key: 'donut', title: 'Donut Chart', icon: PieChart, description: 'Circular distribution' },
  { key: 'stacked-bar', title: 'Stacked Bar', icon: Layers, description: 'Stacked categories' },
]

export const CHART_TYPE_MAP = Object.fromEntries(CHART_TYPES.map((ct) => [ct.key, ct])) as Record<string, ChartTypeMeta>

// ── Compatibility helpers ──────────────────────────────────────────────

export function getCompatibleChartTypes(dataSource: string): ChartType[] {
  return DATA_SOURCE_MAP[dataSource]?.compatibleChartTypes ?? ['bar']
}

export function isBlockTypeCompatible(dataSource: string, blockType: 'chart' | 'kpi' | 'table'): boolean {
  const meta = DATA_SOURCE_MAP[dataSource]
  if (!meta) return false
  if (blockType === 'kpi') return meta.supportsKPI
  if (blockType === 'table') return meta.supportsTable
  return true
}

/**
 * Given a data source, return the best default chart type for it.
 */
export function getDefaultChartType(dataSource: string): ChartType {
  const meta = DATA_SOURCE_MAP[dataSource]
  if (!meta) return 'bar'
  return meta.compatibleChartTypes[0] ?? 'bar'
}

// ── Default blocks ─────────────────────────────────────────────────────

export const DEFAULT_BLOCKS: DashboardBlock[] = [
  // KPI row
  { id: 'kpi-revenue', title: 'Total Revenue', blockType: 'kpi', dataSource: 'revenue', chartType: 'area', layout: { x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 }, visible: true },
  { id: 'kpi-orders', title: 'Total Orders', blockType: 'kpi', dataSource: 'orders', chartType: 'bar', layout: { x: 3, y: 0, w: 3, h: 2, minW: 2, minH: 2 }, visible: true },
  { id: 'kpi-bottles', title: 'Bottles Sold', blockType: 'kpi', dataSource: 'bottles', chartType: 'bar', layout: { x: 6, y: 0, w: 3, h: 2, minW: 2, minH: 2 }, visible: true },
  { id: 'kpi-avgorder', title: 'Avg Order Value', blockType: 'kpi', dataSource: 'profitMargin', chartType: 'line', layout: { x: 9, y: 0, w: 3, h: 2, minW: 2, minH: 2 }, visible: true },
  // Chart row
  { id: 'chart-revenue', title: 'Revenue Trend', blockType: 'chart', dataSource: 'revenue', chartType: 'area', layout: { x: 0, y: 2, w: 8, h: 4, minW: 4, minH: 3 }, visible: true },
  { id: 'chart-distribution', title: 'Wine Distribution', blockType: 'chart', dataSource: 'wineDistribution', chartType: 'donut', layout: { x: 8, y: 2, w: 4, h: 4, minW: 3, minH: 3 }, visible: true },
  // Second chart row
  { id: 'chart-ordertype', title: 'Orders by Wine Type', blockType: 'chart', dataSource: 'ordersByType', chartType: 'stacked-bar', layout: { x: 0, y: 6, w: 6, h: 4, minW: 4, minH: 3 }, visible: true },
  { id: 'chart-topwines', title: 'Top Performing Wines', blockType: 'chart', dataSource: 'topWines', chartType: 'bar', layout: { x: 6, y: 6, w: 6, h: 4, minW: 4, minH: 3 }, visible: true },
]

// ── Layout presets ─────────────────────────────────────────────────────

export const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    id: 'default',
    name: 'Default',
    icon: LayoutGrid,
    description: '4 KPI cards + 4 charts',
    blocks: DEFAULT_BLOCKS,
  },
  {
    id: 'compact',
    name: 'Compact',
    icon: Rows,
    description: 'Dense layout, more data per screen',
    blocks: [
      { id: 'kpi-revenue', title: 'Total Revenue', blockType: 'kpi', dataSource: 'revenue', chartType: 'area', layout: { x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 }, visible: true },
      { id: 'kpi-orders', title: 'Total Orders', blockType: 'kpi', dataSource: 'orders', chartType: 'bar', layout: { x: 3, y: 0, w: 3, h: 2, minW: 2, minH: 2 }, visible: true },
      { id: 'kpi-bottles', title: 'Bottles Sold', blockType: 'kpi', dataSource: 'bottles', chartType: 'bar', layout: { x: 6, y: 0, w: 3, h: 2, minW: 2, minH: 2 }, visible: true },
      { id: 'kpi-margin', title: 'Profit Margin', blockType: 'kpi', dataSource: 'profitMargin', chartType: 'line', layout: { x: 9, y: 0, w: 3, h: 2, minW: 2, minH: 2 }, visible: true },
      { id: 'chart-revenue', title: 'Revenue Trend', blockType: 'chart', dataSource: 'revenue', chartType: 'area', layout: { x: 0, y: 2, w: 6, h: 3, minW: 4, minH: 3 }, visible: true },
      { id: 'chart-distribution', title: 'Wine Distribution', blockType: 'chart', dataSource: 'wineDistribution', chartType: 'donut', layout: { x: 6, y: 2, w: 6, h: 3, minW: 3, minH: 3 }, visible: true },
      { id: 'table-daily', title: 'Daily Breakdown', blockType: 'table', dataSource: 'dailyBreakdown', chartType: 'bar', layout: { x: 0, y: 5, w: 12, h: 4, minW: 6, minH: 3 }, visible: true },
    ],
  },
  {
    id: 'presentation',
    name: 'Presentation',
    icon: Maximize2,
    description: 'Large charts for presenting',
    blocks: [
      { id: 'chart-revenue', title: 'Revenue Trend', blockType: 'chart', dataSource: 'revenue', chartType: 'area', layout: { x: 0, y: 0, w: 12, h: 5, minW: 6, minH: 3 }, visible: true },
      { id: 'chart-distribution', title: 'Wine Distribution', blockType: 'chart', dataSource: 'wineDistribution', chartType: 'donut', layout: { x: 0, y: 5, w: 6, h: 5, minW: 4, minH: 3 }, visible: true },
      { id: 'chart-topwines', title: 'Top Performing Wines', blockType: 'chart', dataSource: 'topWines', chartType: 'bar', layout: { x: 6, y: 5, w: 6, h: 5, minW: 4, minH: 3 }, visible: true },
    ],
  },
  {
    id: 'dashboard',
    name: 'Dashboard',
    icon: Columns,
    description: 'Mixed KPI + charts + tables',
    blocks: [
      { id: 'kpi-revenue', title: 'Total Revenue', blockType: 'kpi', dataSource: 'revenue', chartType: 'area', layout: { x: 0, y: 0, w: 4, h: 2, minW: 2, minH: 2 }, visible: true },
      { id: 'kpi-orders', title: 'Total Orders', blockType: 'kpi', dataSource: 'orders', chartType: 'bar', layout: { x: 4, y: 0, w: 4, h: 2, minW: 2, minH: 2 }, visible: true },
      { id: 'kpi-margin', title: 'Profit Margin', blockType: 'kpi', dataSource: 'profitMargin', chartType: 'line', layout: { x: 8, y: 0, w: 4, h: 2, minW: 2, minH: 2 }, visible: true },
      { id: 'chart-revenue', title: 'Revenue Trend', blockType: 'chart', dataSource: 'revenue', chartType: 'area', layout: { x: 0, y: 2, w: 8, h: 4, minW: 4, minH: 3 }, visible: true },
      { id: 'chart-distribution', title: 'Wine Distribution', blockType: 'chart', dataSource: 'wineDistribution', chartType: 'donut', layout: { x: 8, y: 2, w: 4, h: 4, minW: 3, minH: 3 }, visible: true },
      { id: 'table-topwines', title: 'Top Wines Table', blockType: 'table', dataSource: 'topWines', chartType: 'bar', layout: { x: 0, y: 6, w: 6, h: 4, minW: 4, minH: 3 }, visible: true },
      { id: 'chart-ordertype', title: 'Orders by Type', blockType: 'chart', dataSource: 'ordersByType', chartType: 'stacked-bar', layout: { x: 6, y: 6, w: 6, h: 4, minW: 4, minH: 3 }, visible: true },
    ],
  },
]
