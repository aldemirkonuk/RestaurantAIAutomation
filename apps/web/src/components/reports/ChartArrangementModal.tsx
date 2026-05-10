import { useState, useCallback } from 'react'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import {
  X,
  Check,
  GripVertical,
  Eye,
  EyeOff,
  RotateCcw,
  BarChart3,
  LineChart,
  PieChart,
  AreaChart,
  Layers,
} from 'lucide-react'
import { ChartConfig, DataSource, ChartType, ChartSize } from './ChartConfigModal'

interface ChartArrangementModalProps {
  isOpen: boolean
  onClose: () => void
  charts: ChartConfig[]
  onSave: (charts: ChartConfig[]) => void
  onReset: () => void
}

const CHART_TYPE_ICONS: Record<ChartType, React.ElementType> = {
  area: AreaChart,
  bar: BarChart3,
  line: LineChart,
  donut: PieChart,
  'stacked-bar': Layers,
}

const SIZE_LABELS: Record<ChartSize, string> = {
  small: '1 col',
  medium: '2 cols',
  large: '3 cols',
  full: 'Full width',
}

const DATA_SOURCE_LABELS: Record<DataSource, string> = {
  revenue: 'Revenue',
  orders: 'Orders',
  bottles: 'Bottles Sold',
  wineDistribution: 'Wine Distribution',
  topWines: 'Top Wines',
  purchaseCost: 'Purchase Cost',
  profitMargin: 'Profit Margin',
  inventoryValue: 'Inventory Value',
  ordersByType: 'Orders by Type',
  dailyBreakdown: 'Daily Breakdown',
  providerPerformance: 'Provider Performance',
  salesTrend: 'Sales Trend',
}

export function ChartArrangementModal({
  isOpen,
  onClose,
  charts,
  onSave,
  onReset,
}: ChartArrangementModalProps) {
  const [localCharts, setLocalCharts] = useState<ChartConfig[]>(charts)
  const [hasChanges, setHasChanges] = useState(false)

  // Reset local state when modal opens
  useState(() => {
    setLocalCharts(charts)
    setHasChanges(false)
  })

  const handleReorder = useCallback((newOrder: ChartConfig[]) => {
    setLocalCharts(newOrder)
    setHasChanges(true)
  }, [])

  const toggleChartVisibility = useCallback((chartId: string) => {
    setLocalCharts(prev => prev.map(chart =>
      chart.id === chartId ? { ...chart, visible: !chart.visible } : chart
    ))
    setHasChanges(true)
  }, [])

  const handleSave = () => {
    onSave(localCharts)
    onClose()
  }

  const handleReset = () => {
    onReset()
    onClose()
  }

  const handleCancel = () => {
    setLocalCharts(charts)
    setHasChanges(false)
    onClose()
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={handleCancel}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50 flex items-center justify-between shrink-0">
            <div>
              <h3 className="text-lg font-bold text-gray-900">Arrange Charts</h3>
              <p className="text-sm text-gray-500">Drag to reorder, toggle visibility</p>
            </div>
            <button
              onClick={handleCancel}
              className="p-2 hover:bg-white/50 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Preview Area */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-gray-600 font-medium">
                Preview Layout ({localCharts.filter(c => c.visible).length} visible charts)
              </p>
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Reset to Default
              </button>
            </div>

            {/* Draggable Chart Grid Preview */}
            <div className="bg-gray-50 rounded-xl p-4 border-2 border-dashed border-gray-200">
              <Reorder.Group
                axis="y"
                values={localCharts}
                onReorder={handleReorder}
                className="space-y-3"
              >
                {localCharts.map((chart) => {
                  const TypeIcon = CHART_TYPE_ICONS[chart.chartType]
                  
                  return (
                    <Reorder.Item
                      key={chart.id}
                      value={chart}
                      className="cursor-grab active:cursor-grabbing"
                    >
                      <motion.div
                        layout
                        className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all ${
                          chart.visible
                            ? 'bg-white border-gray-200 shadow-sm'
                            : 'bg-gray-100 border-gray-200 opacity-60'
                        }`}
                        whileDrag={{ scale: 1.02, boxShadow: '0 10px 30px rgba(0,0,0,0.15)' }}
                      >
                        {/* Drag Handle */}
                        <div className="text-gray-400 hover:text-gray-600">
                          <GripVertical className="w-5 h-5" />
                        </div>

                        {/* Chart Icon */}
                        <div className={`p-2.5 rounded-lg ${
                          chart.visible ? 'bg-blue-100' : 'bg-gray-200'
                        }`}>
                          <TypeIcon className={`w-5 h-5 ${
                            chart.visible ? 'text-blue-600' : 'text-gray-400'
                          }`} />
                        </div>

                        {/* Chart Info */}
                        <div className="flex-1 min-w-0">
                          <p className={`font-semibold truncate ${
                            chart.visible ? 'text-gray-900' : 'text-gray-500'
                          }`}>
                            {chart.title}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-gray-500">
                              {DATA_SOURCE_LABELS[chart.dataSource]}
                            </span>
                            <span className="text-gray-300">•</span>
                            <span className="text-xs text-gray-500">
                              {SIZE_LABELS[chart.size]}
                            </span>
                          </div>
                        </div>

                        {/* Size Indicator */}
                        <div className="hidden sm:flex items-center gap-1">
                          {Array.from({ length: chart.size === 'small' ? 1 : chart.size === 'medium' ? 2 : chart.size === 'large' ? 3 : 5 }).map((_, i) => (
                            <div
                              key={i}
                              className={`w-3 h-6 rounded ${
                                chart.visible ? 'bg-blue-200' : 'bg-gray-200'
                              }`}
                            />
                          ))}
                        </div>

                        {/* Visibility Toggle */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleChartVisibility(chart.id)
                          }}
                          className={`p-2 rounded-lg transition-colors ${
                            chart.visible
                              ? 'text-blue-600 hover:bg-blue-50'
                              : 'text-gray-400 hover:bg-gray-200'
                          }`}
                          title={chart.visible ? 'Hide chart' : 'Show chart'}
                        >
                          {chart.visible ? (
                            <Eye className="w-5 h-5" />
                          ) : (
                            <EyeOff className="w-5 h-5" />
                          )}
                        </button>
                      </motion.div>
                    </Reorder.Item>
                  )
                })}
              </Reorder.Group>

              {localCharts.filter(c => c.visible).length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <EyeOff className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>All charts are hidden</p>
                </div>
              )}
            </div>

            {/* Visual Preview Grid */}
            <div className="mt-6">
              <p className="text-sm text-gray-600 font-medium mb-3">Visual Preview</p>
              <div className="bg-gray-100 rounded-xl p-4 min-h-[150px]">
                <div className="grid grid-cols-5 gap-2">
                  {localCharts.filter(c => c.visible).map((chart) => {
                    const colSpan = chart.size === 'small' ? 1 : chart.size === 'medium' ? 2 : chart.size === 'large' ? 3 : 5
                    const TypeIcon = CHART_TYPE_ICONS[chart.chartType]
                    
                    return (
                      <motion.div
                        key={chart.id}
                        layout
                        className={`col-span-${colSpan} bg-white rounded-lg border border-gray-200 p-3 flex flex-col items-center justify-center min-h-[80px]`}
                        style={{ gridColumn: `span ${colSpan}` }}
                      >
                        <TypeIcon className="w-5 h-5 text-gray-400 mb-1" />
                        <p className="text-xs text-gray-600 text-center truncate w-full">{chart.title}</p>
                      </motion.div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between shrink-0">
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg font-medium transition-colors"
            >
              Cancel
            </button>
            <div className="flex items-center gap-3">
              {hasChanges && (
                <span className="text-sm text-amber-600 font-medium">Unsaved changes</span>
              )}
              <button
                onClick={handleSave}
                disabled={!hasChanges}
                className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors ${
                  hasChanges
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                <Check className="w-4 h-4" />
                Apply Changes
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
