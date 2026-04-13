/**
 * Dashboard Widgets Configuration
 * Defines available widgets, their types, and default configurations
 */

import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Package,
  ShoppingCart,
  BarChart3,
  Wine,
  Users,
  Activity,
  Percent,
  PieChart,
  LineChart,
  Calendar,
  Truck,
  AlertTriangle,
  Star,
  Clock,
} from 'lucide-react'

// Widget size types
export type WidgetSize = 'small' | 'medium' | 'large' | 'wide' | 'tall'

// Widget types
export type WidgetType = 
  | 'kpi'
  | 'chart_line'
  | 'chart_bar'
  | 'chart_pie'
  | 'chart_area'
  | 'table'
  | 'list'
  | 'calendar'
  | 'activity'

// KPI metric types
export type KPIMetricType = 
  | 'revenue'
  | 'orders'
  | 'bottles'
  | 'avgOrder'
  | 'profitMargin'
  | 'inventoryValue'
  | 'lowStock'
  | 'pendingOrders'
  | 'deliveries'
  | 'topSeller'
  | 'customerCount'
  | 'turnoverRate'
  | 'dailySales'
  | 'wineTypes'

// Chart data source types
export type ChartDataSourceType =
  | 'revenueTrend'
  | 'wineDistribution'
  | 'orderVolume'
  | 'inventoryLevels'
  | 'providerSpend'
  | 'profitTrend'
  | 'salesByDay'
  | 'topWines'

// Widget configuration interface
export interface DashboardWidgetConfig {
  id: string
  type: WidgetType
  title: string
  size: WidgetSize
  visible: boolean
  metric?: KPIMetricType
  dataSource?: ChartDataSourceType
  settings?: Record<string, any>
}

// Size configurations
export const WIDGET_SIZE_CONFIG: Record<WidgetSize, { cols: number; rows: number; minWidth: string; minHeight: string }> = {
  small: { cols: 1, rows: 1, minWidth: '200px', minHeight: '140px' },
  medium: { cols: 2, rows: 1, minWidth: '400px', minHeight: '180px' },
  large: { cols: 2, rows: 2, minWidth: '400px', minHeight: '360px' },
  wide: { cols: 3, rows: 1, minWidth: '600px', minHeight: '180px' },
  tall: { cols: 1, rows: 2, minWidth: '200px', minHeight: '320px' },
}

// Grid class mappings for Tailwind
export const WIDGET_SIZE_CLASSES: Record<WidgetSize, string> = {
  small: 'col-span-1 row-span-1',
  medium: 'col-span-2 row-span-1',
  large: 'col-span-2 row-span-2',
  wide: 'col-span-3 row-span-1',
  tall: 'col-span-1 row-span-2',
}

// KPI metric configurations
export const KPI_METRIC_CONFIG: Record<KPIMetricType, {
  title: string
  description: string
  icon: typeof DollarSign
  valueType: 'currency' | 'number' | 'percentage'
  category: 'sales' | 'inventory' | 'orders' | 'performance'
}> = {
  revenue: {
    title: 'Total Revenue',
    description: 'Total sales revenue',
    icon: DollarSign,
    valueType: 'currency',
    category: 'sales',
  },
  orders: {
    title: 'Total Orders',
    description: 'Number of orders placed',
    icon: ShoppingCart,
    valueType: 'number',
    category: 'orders',
  },
  bottles: {
    title: 'Bottles Sold',
    description: 'Total bottles sold',
    icon: Package,
    valueType: 'number',
    category: 'inventory',
  },
  avgOrder: {
    title: 'Avg Order Value',
    description: 'Average order amount',
    icon: BarChart3,
    valueType: 'currency',
    category: 'sales',
  },
  profitMargin: {
    title: 'Profit Margin',
    description: 'Overall profit percentage',
    icon: Percent,
    valueType: 'percentage',
    category: 'sales',
  },
  inventoryValue: {
    title: 'Inventory Value',
    description: 'Total inventory worth',
    icon: Package,
    valueType: 'currency',
    category: 'inventory',
  },
  lowStock: {
    title: 'Low Stock Items',
    description: 'Items below threshold',
    icon: AlertTriangle,
    valueType: 'number',
    category: 'inventory',
  },
  pendingOrders: {
    title: 'Pending Orders',
    description: 'Awaiting approval',
    icon: Clock,
    valueType: 'number',
    category: 'orders',
  },
  deliveries: {
    title: 'Deliveries Today',
    description: 'Expected deliveries',
    icon: Truck,
    valueType: 'number',
    category: 'orders',
  },
  topSeller: {
    title: 'Top Seller',
    description: 'Best performing wine',
    icon: Star,
    valueType: 'number',
    category: 'performance',
  },
  customerCount: {
    title: 'Customers',
    description: 'Unique customers',
    icon: Users,
    valueType: 'number',
    category: 'performance',
  },
  turnoverRate: {
    title: 'Turnover Rate',
    description: 'Inventory turnover',
    icon: Activity,
    valueType: 'percentage',
    category: 'performance',
  },
  dailySales: {
    title: 'Daily Sales',
    description: "Today's sales total",
    icon: TrendingUp,
    valueType: 'currency',
    category: 'sales',
  },
  wineTypes: {
    title: 'Wine Types',
    description: 'Unique wine varieties',
    icon: Wine,
    valueType: 'number',
    category: 'inventory',
  },
}

// Chart data source configurations
export const CHART_DATA_SOURCE_CONFIG: Record<ChartDataSourceType, {
  title: string
  description: string
  icon: typeof LineChart
  supportedChartTypes: WidgetType[]
}> = {
  revenueTrend: {
    title: 'Revenue Trend',
    description: 'Sales over time',
    icon: TrendingUp,
    supportedChartTypes: ['chart_line', 'chart_area', 'chart_bar'],
  },
  wineDistribution: {
    title: 'Wine Distribution',
    description: 'Sales by wine type',
    icon: PieChart,
    supportedChartTypes: ['chart_pie', 'chart_bar'],
  },
  orderVolume: {
    title: 'Order Volume',
    description: 'Orders over time',
    icon: ShoppingCart,
    supportedChartTypes: ['chart_line', 'chart_bar', 'chart_area'],
  },
  inventoryLevels: {
    title: 'Inventory Levels',
    description: 'Stock by category',
    icon: Package,
    supportedChartTypes: ['chart_bar', 'chart_pie'],
  },
  providerSpend: {
    title: 'Provider Spend',
    description: 'Spending by provider',
    icon: Truck,
    supportedChartTypes: ['chart_pie', 'chart_bar'],
  },
  profitTrend: {
    title: 'Profit Trend',
    description: 'Profit over time',
    icon: DollarSign,
    supportedChartTypes: ['chart_line', 'chart_area'],
  },
  salesByDay: {
    title: 'Sales by Day',
    description: 'Daily sales breakdown',
    icon: Calendar,
    supportedChartTypes: ['chart_bar', 'chart_line'],
  },
  topWines: {
    title: 'Top Wines',
    description: 'Best selling wines',
    icon: Star,
    supportedChartTypes: ['chart_bar'],
  },
}

// Default dashboard layout
export const DEFAULT_DASHBOARD_LAYOUT: DashboardWidgetConfig[] = [
  { id: 'w1', type: 'kpi', title: 'Total Revenue', size: 'small', visible: true, metric: 'revenue' },
  { id: 'w2', type: 'kpi', title: 'Total Orders', size: 'small', visible: true, metric: 'orders' },
  { id: 'w3', type: 'kpi', title: 'Bottles Sold', size: 'small', visible: true, metric: 'bottles' },
  { id: 'w4', type: 'kpi', title: 'Profit Margin', size: 'small', visible: true, metric: 'profitMargin' },
  { id: 'w5', type: 'chart_line', title: 'Revenue Trend', size: 'medium', visible: true, dataSource: 'revenueTrend' },
  { id: 'w6', type: 'chart_pie', title: 'Wine Distribution', size: 'small', visible: true, dataSource: 'wineDistribution' },
  { id: 'w7', type: 'list', title: 'Top Sellers', size: 'medium', visible: true, dataSource: 'topWines' },
]

// Storage key for persisting layout
export const DASHBOARD_STORAGE_KEY = 'wineops_dashboard_layout_v2'

// Load dashboard layout from localStorage
export function loadDashboardLayout(): DashboardWidgetConfig[] {
  if (typeof window === 'undefined') return DEFAULT_DASHBOARD_LAYOUT
  try {
    const stored = localStorage.getItem(DASHBOARD_STORAGE_KEY)
    return stored ? JSON.parse(stored) : DEFAULT_DASHBOARD_LAYOUT
  } catch {
    return DEFAULT_DASHBOARD_LAYOUT
  }
}

// Save dashboard layout to localStorage
export function saveDashboardLayout(layout: DashboardWidgetConfig[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(layout))
}
