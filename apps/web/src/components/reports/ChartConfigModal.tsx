import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Check,
  BarChart3,
  LineChart,
  PieChart,
  AreaChart,
  TrendingUp,
  DollarSign,
  Package,
  ShoppingCart,
  Wine,
  Users,
  Percent,
  Activity,
  Calendar,
  Target,
  Layers,
  Maximize2,
  Minimize2,
  Square,
} from 'lucide-react'

export type ChartType = 'area' | 'bar' | 'line' | 'donut' | 'stacked-bar'
export type ChartSize = 'small' | 'medium' | 'large' | 'full'
export type DataSource = 
  | 'revenue' 
  | 'orders' 
  | 'bottles' 
  | 'wineDistribution' 
  | 'topWines' 
  | 'purchaseCost'
  | 'profitMargin'
  | 'inventoryValue'
  | 'ordersByType'
  | 'dailyBreakdown'
  | 'providerPerformance'
  | 'salesTrend'

interface ChartConfig {
  id: string
  title: string
  dataSource: DataSource
  chartType: ChartType
  size: ChartSize
  visible: boolean
}

interface ChartConfigModalProps {
  isOpen: boolean
  onClose: () => void
  currentConfig: ChartConfig
  onSave: (config: ChartConfig) => void
}

const DATA_SOURCES: { key: DataSource; title: string; icon: React.ElementType; description: string }[] = [
  { key: 'revenue', title: 'Revenue', icon: DollarSign, description: 'Total sales revenue over time' },
  { key: 'orders', title: 'Orders', icon: ShoppingCart, description: 'Number of orders placed' },
  { key: 'bottles', title: 'Bottles Sold', icon: Package, description: 'Total bottles sold' },
  { key: 'wineDistribution', title: 'Wine Distribution', icon: Wine, description: 'Sales breakdown by wine type' },
  { key: 'topWines', title: 'Top Wines', icon: TrendingUp, description: 'Best performing wines' },
  { key: 'purchaseCost', title: 'Purchase Cost', icon: Activity, description: 'Total purchase expenses' },
  { key: 'profitMargin', title: 'Profit Margin', icon: Percent, description: 'Profit percentage over time' },
  { key: 'inventoryValue', title: 'Inventory Value', icon: Layers, description: 'Total inventory worth' },
  { key: 'ordersByType', title: 'Orders by Type', icon: BarChart3, description: 'Orders categorized by wine type' },
  { key: 'dailyBreakdown', title: 'Daily Breakdown', icon: Calendar, description: 'Day-by-day performance' },
  { key: 'providerPerformance', title: 'Provider Performance', icon: Users, description: 'Supplier metrics' },
  { key: 'salesTrend', title: 'Sales Trend', icon: Target, description: 'Sales trajectory analysis' },
]

const CHART_TYPES: { key: ChartType; title: string; icon: React.ElementType; description: string }[] = [
  { key: 'area', title: 'Area Chart', icon: AreaChart, description: 'Filled area visualization' },
  { key: 'line', title: 'Line Chart', icon: LineChart, description: 'Simple line graph' },
  { key: 'bar', title: 'Bar Chart', icon: BarChart3, description: 'Vertical bars' },
  { key: 'donut', title: 'Donut Chart', icon: PieChart, description: 'Circular distribution' },
  { key: 'stacked-bar', title: 'Stacked Bar', icon: Layers, description: 'Stacked categories' },
]

const SIZE_OPTIONS: { key: ChartSize; title: string; icon: React.ElementType; cols: string }[] = [
  { key: 'small', title: 'Small', icon: Minimize2, cols: '1 column' },
  { key: 'medium', title: 'Medium', icon: Square, cols: '2 columns' },
  { key: 'large', title: 'Large', icon: Maximize2, cols: '3 columns' },
  { key: 'full', title: 'Full Width', icon: Layers, cols: '5 columns' },
]

export function ChartConfigModal({ isOpen, onClose, currentConfig, onSave }: ChartConfigModalProps) {
  const [config, setConfig] = useState<ChartConfig>(currentConfig)
  const [activeTab, setActiveTab] = useState<'data' | 'type' | 'size'>('data')

  const handleSave = () => {
    onSave(config)
    onClose()
  }

  return (
    <AnimatePresence>
      {isOpen && (
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
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Configure Chart</h3>
                <p className="text-sm text-gray-500">Customize data source, chart type, and size</p>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/50 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b">
              {[
                { key: 'data' as const, label: 'Data Source' },
                { key: 'type' as const, label: 'Chart Type' },
                { key: 'size' as const, label: 'Size' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                    activeTab === tab.key
                      ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="p-4 max-h-[50vh] overflow-y-auto">
              {activeTab === 'data' && (
                <div className="grid grid-cols-2 gap-2">
                  {DATA_SOURCES.map((source) => {
                    const SourceIcon = source.icon
                    const isSelected = config.dataSource === source.key
                    
                    return (
                      <button
                        key={source.key}
                        onClick={() => setConfig({ ...config, dataSource: source.key })}
                        className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <div className={`p-2 rounded-lg ${isSelected ? 'bg-blue-200' : 'bg-gray-100'}`}>
                          <SourceIcon className={`w-4 h-4 ${isSelected ? 'text-blue-700' : 'text-gray-600'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium text-sm ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}>
                            {source.title}
                          </p>
                          <p className="text-xs text-gray-500 truncate">{source.description}</p>
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              )}

              {activeTab === 'type' && (
                <div className="grid grid-cols-1 gap-2">
                  {CHART_TYPES.map((type) => {
                    const TypeIcon = type.icon
                    const isSelected = config.chartType === type.key
                    
                    return (
                      <button
                        key={type.key}
                        onClick={() => setConfig({ ...config, chartType: type.key })}
                        className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <div className={`p-3 rounded-xl ${isSelected ? 'bg-blue-200' : 'bg-gray-100'}`}>
                          <TypeIcon className={`w-6 h-6 ${isSelected ? 'text-blue-700' : 'text-gray-600'}`} />
                        </div>
                        <div className="flex-1">
                          <p className={`font-semibold ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}>
                            {type.title}
                          </p>
                          <p className="text-sm text-gray-500">{type.description}</p>
                        </div>
                        {isSelected && <Check className="w-5 h-5 text-blue-600" />}
                      </button>
                    )
                  })}
                </div>
              )}

              {activeTab === 'size' && (
                <div className="grid grid-cols-2 gap-3">
                  {SIZE_OPTIONS.map((size) => {
                    const SizeIcon = size.icon
                    const isSelected = config.size === size.key
                    
                    return (
                      <button
                        key={size.key}
                        onClick={() => setConfig({ ...config, size: size.key })}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <div className={`p-3 rounded-xl ${isSelected ? 'bg-blue-200' : 'bg-gray-100'}`}>
                          <SizeIcon className={`w-6 h-6 ${isSelected ? 'text-blue-700' : 'text-gray-600'}`} />
                        </div>
                        <div className="text-center">
                          <p className={`font-semibold ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}>
                            {size.title}
                          </p>
                          <p className="text-xs text-gray-500">{size.cols}</p>
                        </div>
                        {isSelected && (
                          <Check className="w-4 h-4 text-blue-600 absolute top-2 right-2" />
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Preview */}
            <div className="px-6 py-3 bg-gray-50 border-t">
              <p className="text-xs text-gray-500 mb-2">Preview</p>
              <div className="flex items-center gap-3 p-3 bg-white rounded-lg border">
                <div className="p-2 bg-blue-100 rounded-lg">
                  {(() => {
                    const Icon = DATA_SOURCES.find(s => s.key === config.dataSource)?.icon || BarChart3
                    return <Icon className="w-5 h-5 text-blue-600" />
                  })()}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-gray-900">
                    {DATA_SOURCES.find(s => s.key === config.dataSource)?.title}
                  </p>
                  <p className="text-xs text-gray-500">
                    {CHART_TYPES.find(t => t.key === config.chartType)?.title} • {SIZE_OPTIONS.find(s => s.key === config.size)?.title}
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t flex items-center justify-end gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
              >
                <Check className="w-4 h-4" />
                Save Changes
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export type { ChartConfig }
