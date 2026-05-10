/**
 * WidgetSelector Component
 * Modal for selecting and configuring dashboard widget content
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Check,
  TrendingUp,
  DollarSign,
  Package,
  ShoppingCart,
  BarChart3,
  Wine,
  Users,
  Activity,
  Percent,
  PieChart,
  Truck,
  AlertTriangle,
  Star,
  Clock,
} from 'lucide-react'

// KPI metric options
export interface KPIMetric {
  id: string
  title: string
  description: string
  icon: React.ElementType
  category: 'sales' | 'inventory' | 'orders' | 'performance'
  valueType: 'currency' | 'number' | 'percentage'
}

export const KPI_METRICS: KPIMetric[] = [
  // Sales metrics
  { id: 'revenue', title: 'Total Revenue', description: 'Total sales revenue', icon: DollarSign, category: 'sales', valueType: 'currency' },
  { id: 'avgOrder', title: 'Avg Order Value', description: 'Average order amount', icon: BarChart3, category: 'sales', valueType: 'currency' },
  { id: 'profitMargin', title: 'Profit Margin', description: 'Overall profit percentage', icon: Percent, category: 'sales', valueType: 'percentage' },
  { id: 'dailySales', title: 'Daily Sales', description: 'Today\'s sales total', icon: TrendingUp, category: 'sales', valueType: 'currency' },
  
  // Inventory metrics
  { id: 'bottles', title: 'Bottles Sold', description: 'Total bottles sold', icon: Package, category: 'inventory', valueType: 'number' },
  { id: 'inventoryValue', title: 'Inventory Value', description: 'Total inventory worth', icon: Package, category: 'inventory', valueType: 'currency' },
  { id: 'lowStock', title: 'Low Stock Items', description: 'Items below threshold', icon: AlertTriangle, category: 'inventory', valueType: 'number' },
  { id: 'wineTypes', title: 'Wine Types', description: 'Unique wine varieties', icon: Wine, category: 'inventory', valueType: 'number' },
  
  // Order metrics
  { id: 'orders', title: 'Total Orders', description: 'Number of orders', icon: ShoppingCart, category: 'orders', valueType: 'number' },
  { id: 'pendingOrders', title: 'Pending Orders', description: 'Awaiting approval', icon: Clock, category: 'orders', valueType: 'number' },
  { id: 'deliveries', title: 'Deliveries Today', description: 'Expected deliveries', icon: Truck, category: 'orders', valueType: 'number' },
  
  // Performance metrics
  { id: 'topSeller', title: 'Top Seller', description: 'Best performing wine', icon: Star, category: 'performance', valueType: 'number' },
  { id: 'customerCount', title: 'Customers', description: 'Unique customers', icon: Users, category: 'performance', valueType: 'number' },
  { id: 'turnoverRate', title: 'Turnover Rate', description: 'Inventory turnover', icon: Activity, category: 'performance', valueType: 'percentage' },
]

// Chart data source options
export interface ChartDataSource {
  id: string
  title: string
  description: string
  icon: React.ElementType
  chartTypes: ('line' | 'bar' | 'pie' | 'area')[]
}

export const CHART_DATA_SOURCES: ChartDataSource[] = [
  { id: 'revenueTrend', title: 'Revenue Trend', description: 'Sales over time', icon: TrendingUp, chartTypes: ['line', 'area', 'bar'] },
  { id: 'wineDistribution', title: 'Wine Distribution', description: 'Sales by wine type', icon: PieChart, chartTypes: ['pie', 'bar'] },
  { id: 'orderVolume', title: 'Order Volume', description: 'Orders over time', icon: ShoppingCart, chartTypes: ['line', 'bar', 'area'] },
  { id: 'inventoryLevels', title: 'Inventory Levels', description: 'Stock by category', icon: Package, chartTypes: ['bar', 'pie'] },
  { id: 'providerSpend', title: 'Provider Spend', description: 'Spending by provider', icon: Truck, chartTypes: ['pie', 'bar'] },
  { id: 'profitTrend', title: 'Profit Trend', description: 'Profit over time', icon: DollarSign, chartTypes: ['line', 'area'] },
]

interface WidgetSelectorProps {
  isOpen: boolean
  onClose: () => void
  widgetType: 'kpi' | 'chart'
  currentSelection?: string
  onSelect: (selection: string) => void
}

export function WidgetSelector({
  isOpen,
  onClose,
  widgetType,
  currentSelection,
  onSelect,
}: WidgetSelectorProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const categories = widgetType === 'kpi'
    ? ['all', 'sales', 'inventory', 'orders', 'performance']
    : ['all']

  const items = widgetType === 'kpi' ? KPI_METRICS : CHART_DATA_SOURCES

  const filteredItems = items.filter(item => {
    const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         item.description.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = selectedCategory === 'all' || 
                           (widgetType === 'kpi' && (item as KPIMetric).category === selectedCategory)
    return matchesSearch && matchesCategory
  })

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b bg-gradient-to-r from-indigo-50 to-purple-50">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  {widgetType === 'kpi' ? 'Select KPI Metric' : 'Select Data Source'}
                </h3>
                <p className="text-sm text-gray-500">
                  {widgetType === 'kpi' 
                    ? 'Choose what this card should display'
                    : 'Choose the data to visualize'}
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/50 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
          </div>

          {/* Search and filters */}
          <div className="px-6 py-3 border-b bg-gray-50">
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            {widgetType === 'kpi' && (
              <div className="flex gap-2 mt-3">
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1 rounded-full text-sm font-medium transition-colors capitalize ${
                      selectedCategory === cat
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Options list */}
          <div className="p-4 max-h-[50vh] overflow-y-auto">
            <div className="grid grid-cols-1 gap-2">
              {filteredItems.map(item => {
                const Icon = item.icon
                const isSelected = currentSelection === item.id
                
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      onSelect(item.id)
                      onClose()
                    }}
                    className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className={`p-3 rounded-xl ${isSelected ? 'bg-indigo-200' : 'bg-gray-100'}`}>
                      <Icon className={`w-5 h-5 ${isSelected ? 'text-indigo-700' : 'text-gray-600'}`} />
                    </div>
                    <div className="flex-1">
                      <p className={`font-semibold ${isSelected ? 'text-indigo-700' : 'text-gray-900'}`}>
                        {item.title}
                      </p>
                      <p className="text-sm text-gray-500">{item.description}</p>
                    </div>
                    {isSelected && (
                      <Check className="w-5 h-5 text-indigo-600" />
                    )}
                  </button>
                )
              })}
            </div>

            {filteredItems.length === 0 && (
              <div className="text-center py-8">
                <p className="text-gray-500">No matching options found</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-gray-50">
            <button
              onClick={onClose}
              className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default WidgetSelector
