/**
 * EditLayoutPanel - Unified Edit Mode & Chart Arrangement Component
 * 
 * A state-of-the-art slide-out panel that combines:
 * - Edit mode toggle with iOS-style wobble animation
 * - Drag-and-drop chart reordering
 * - KPI card management
 * - Layout presets
 * - Visibility toggles
 * - Reset to default
 */

import { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import {
  X,
  Pencil,
  LayoutGrid,
  Eye,
  EyeOff,
  GripVertical,
  RotateCcw,
  Sparkles,
  Check,
  BarChart3,
  LineChart,
  PieChart,
  AreaChart,
  Layers,
  Save,
  Zap,
  Grid3X3,
  Rows,
  Columns,
  Maximize2,
} from 'lucide-react'
import { ChartConfig, ChartType, ChartSize, DataSource } from './ChartConfigModal'

// Types
interface KPICard {
  id: string
  title: string
  visible: boolean
}

interface LayoutPreset {
  id: string
  name: string
  icon: React.ElementType
  description: string
  chartLayout: ChartSize[]
}

interface EditLayoutPanelProps {
  isOpen: boolean
  onClose: () => void
  isEditMode: boolean
  onEditModeToggle: () => void
  charts: ChartConfig[]
  onChartsChange: (charts: ChartConfig[]) => void
  onChartsReset: () => void
  kpiCards?: KPICard[]
  onKPICardsChange?: (cards: KPICard[]) => void
}

// Constants
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
  full: 'Full',
}

const SIZE_COLORS: Record<ChartSize, string> = {
  small: 'bg-blue-100 text-blue-700',
  medium: 'bg-purple-100 text-purple-700',
  large: 'bg-emerald-100 text-emerald-700',
  full: 'bg-amber-100 text-amber-700',
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

const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    id: 'default',
    name: 'Default',
    icon: Grid3X3,
    description: 'Balanced 3-column layout',
    chartLayout: ['large', 'medium', 'medium', 'full'],
  },
  {
    id: 'compact',
    name: 'Compact',
    icon: Rows,
    description: 'Dense information view',
    chartLayout: ['small', 'small', 'small', 'medium'],
  },
  {
    id: 'presentation',
    name: 'Presentation',
    icon: Maximize2,
    description: 'Full-width charts',
    chartLayout: ['full', 'full', 'full'],
  },
  {
    id: 'dashboard',
    name: 'Dashboard',
    icon: Columns,
    description: 'Mixed sizes for overview',
    chartLayout: ['medium', 'medium', 'large', 'small', 'small'],
  },
]

export function EditLayoutPanel({
  isOpen,
  onClose,
  isEditMode,
  onEditModeToggle,
  charts,
  onChartsChange,
  onChartsReset,
  kpiCards: _kpiCards = [],
  onKPICardsChange: _onKPICardsChange,
}: EditLayoutPanelProps) {
  const [localCharts, setLocalCharts] = useState<ChartConfig[]>(charts)
  const [activeSection, setActiveSection] = useState<'charts' | 'kpis' | 'presets'>('charts')
  const [hasChanges, setHasChanges] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)

  // Sync local state with props
  useEffect(() => {
    setLocalCharts(charts)
    setHasChanges(false)
  }, [charts])

  // Handle chart reordering
  const handleReorder = useCallback((newOrder: ChartConfig[]) => {
    setLocalCharts(newOrder)
    setHasChanges(true)
  }, [])

  // Toggle chart visibility
  const toggleChartVisibility = useCallback((chartId: string) => {
    setLocalCharts(prev => prev.map(chart =>
      chart.id === chartId ? { ...chart, visible: !chart.visible } : chart
    ))
    setHasChanges(true)
  }, [])

  // Change chart size
  const changeChartSize = useCallback((chartId: string, size: ChartSize) => {
    setLocalCharts(prev => prev.map(chart =>
      chart.id === chartId ? { ...chart, size } : chart
    ))
    setHasChanges(true)
  }, [])

  // Apply preset
  const applyPreset = useCallback((preset: LayoutPreset) => {
    setSelectedPreset(preset.id)
    setLocalCharts(prev => prev.map((chart, index) => ({
      ...chart,
      size: preset.chartLayout[index % preset.chartLayout.length] || 'medium',
      visible: true,
    })))
    setHasChanges(true)
  }, [])

  // Save changes
  const handleSave = useCallback(() => {
    onChartsChange(localCharts)
    setHasChanges(false)
  }, [localCharts, onChartsChange])

  // Reset to default
  const handleReset = useCallback(() => {
    onChartsReset()
    setSelectedPreset(null)
    setHasChanges(false)
  }, [onChartsReset])

  // Close panel
  const handleClose = useCallback(() => {
    if (hasChanges) {
      // Auto-save on close
      handleSave()
    }
    onClose()
  }, [hasChanges, handleSave, onClose])

  const visibleChartsCount = localCharts.filter(c => c.visible).length

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
            onClick={handleClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-2xl z-50 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-wine-50 to-purple-50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-wine-600 rounded-xl">
                  <LayoutGrid className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Edit Layout</h2>
                  <p className="text-sm text-gray-500">Customize your dashboard</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="p-2 hover:bg-white/50 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Edit Mode Toggle */}
            <div className="px-6 py-4 border-b bg-gray-50">
              <button
                onClick={onEditModeToggle}
                className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all ${
                  isEditMode
                    ? 'border-wine-500 bg-wine-50'
                    : 'border-gray-200 bg-white hover:border-wine-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${isEditMode ? 'bg-wine-600' : 'bg-gray-100'}`}>
                    <Pencil className={`w-5 h-5 ${isEditMode ? 'text-white' : 'text-gray-500'}`} />
                  </div>
                  <div className="text-left">
                    <p className={`font-semibold ${isEditMode ? 'text-wine-900' : 'text-gray-900'}`}>
                      Edit Mode
                    </p>
                    <p className="text-sm text-gray-500">
                      {isEditMode ? 'Drag cards to reorder' : 'Click to enable editing'}
                    </p>
                  </div>
                </div>
                <div className={`w-12 h-7 rounded-full transition-colors flex items-center ${
                  isEditMode ? 'bg-wine-600 justify-end' : 'bg-gray-300 justify-start'
                }`}>
                  <motion.div
                    layout
                    className="w-5 h-5 bg-white rounded-full shadow-sm mx-1"
                  />
                </div>
              </button>
            </div>

            {/* Section Tabs */}
            <div className="flex border-b">
              {[
                { id: 'charts' as const, label: 'Charts', icon: BarChart3 },
                { id: 'presets' as const, label: 'Presets', icon: Sparkles },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveSection(id)}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
                    activeSection === id
                      ? 'text-wine-600 border-b-2 border-wine-600 bg-wine-50/50'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {/* Charts Section */}
              {activeSection === 'charts' && (
                <div className="p-4">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm font-medium text-gray-700">
                      {visibleChartsCount} of {localCharts.length} charts visible
                    </p>
                    <button
                      onClick={handleReset}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Reset
                    </button>
                  </div>

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
                            className={`rounded-xl border-2 transition-all overflow-hidden ${
                              chart.visible
                                ? 'bg-white border-gray-200 shadow-sm'
                                : 'bg-gray-50 border-gray-100 opacity-60'
                            }`}
                            whileDrag={{ scale: 1.02, boxShadow: '0 10px 30px rgba(0,0,0,0.15)' }}
                          >
                            {/* Chart Header */}
                            <div className="flex items-center gap-3 p-3">
                              <div className="text-gray-400 hover:text-gray-600">
                                <GripVertical className="w-5 h-5" />
                              </div>

                              <div className={`p-2 rounded-lg ${
                                chart.visible ? 'bg-blue-100' : 'bg-gray-200'
                              }`}>
                                <TypeIcon className={`w-4 h-4 ${
                                  chart.visible ? 'text-blue-600' : 'text-gray-400'
                                }`} />
                              </div>

                              <div className="flex-1 min-w-0">
                                <p className={`font-medium truncate text-sm ${
                                  chart.visible ? 'text-gray-900' : 'text-gray-500'
                                }`}>
                                  {chart.title}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {DATA_SOURCE_LABELS[chart.dataSource]}
                                </p>
                              </div>

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
                              >
                                {chart.visible ? (
                                  <Eye className="w-5 h-5" />
                                ) : (
                                  <EyeOff className="w-5 h-5" />
                                )}
                              </button>
                            </div>

                            {/* Size Selector */}
                            {chart.visible && (
                              <div className="px-3 pb-3 pt-0">
                                <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                                  {(['small', 'medium', 'large', 'full'] as ChartSize[]).map((size) => (
                                    <button
                                      key={size}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        changeChartSize(chart.id, size)
                                      }}
                                      className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                                        chart.size === size
                                          ? SIZE_COLORS[size]
                                          : 'text-gray-500 hover:bg-gray-200'
                                      }`}
                                    >
                                      {SIZE_LABELS[size]}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </motion.div>
                        </Reorder.Item>
                      )
                    })}
                  </Reorder.Group>
                </div>
              )}

              {/* Presets Section */}
              {activeSection === 'presets' && (
                <div className="p-4 space-y-3">
                  <p className="text-sm text-gray-600 mb-4">
                    Quick apply a layout preset to all charts
                  </p>
                  
                  {LAYOUT_PRESETS.map((preset) => {
                    const Icon = preset.icon
                    const isSelected = selectedPreset === preset.id
                    
                    return (
                      <button
                        key={preset.id}
                        onClick={() => applyPreset(preset)}
                        className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all ${
                          isSelected
                            ? 'border-wine-500 bg-wine-50'
                            : 'border-gray-200 bg-white hover:border-wine-300 hover:bg-gray-50'
                        }`}
                      >
                        <div className={`p-3 rounded-xl ${
                          isSelected ? 'bg-wine-600' : 'bg-gray-100'
                        }`}>
                          <Icon className={`w-5 h-5 ${
                            isSelected ? 'text-white' : 'text-gray-500'
                          }`} />
                        </div>
                        <div className="flex-1 text-left">
                          <p className={`font-semibold ${
                            isSelected ? 'text-wine-900' : 'text-gray-900'
                          }`}>
                            {preset.name}
                          </p>
                          <p className="text-sm text-gray-500">{preset.description}</p>
                        </div>
                        {isSelected && (
                          <div className="p-1 bg-wine-600 rounded-full">
                            <Check className="w-4 h-4 text-white" />
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t bg-gray-50">
              <div className="flex items-center justify-between">
                {hasChanges && (
                  <span className="text-sm text-amber-600 font-medium flex items-center gap-1">
                    <Zap className="w-4 h-4" />
                    Unsaved changes
                  </span>
                )}
                <div className="flex items-center gap-3 ml-auto">
                  <button
                    onClick={handleClose}
                    className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!hasChanges}
                    className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors ${
                      hasChanges
                        ? 'bg-wine-600 text-white hover:bg-wine-700 shadow-lg shadow-wine-600/30'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    <Save className="w-4 h-4" />
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// Hook for managing edit layout state
export function useEditLayout(initialCharts: ChartConfig[]) {
  const [isOpen, setIsOpen] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [charts, setCharts] = useState(initialCharts)

  const openPanel = useCallback(() => setIsOpen(true), [])
  const closePanel = useCallback(() => setIsOpen(false), [])
  const toggleEditMode = useCallback(() => setIsEditMode(prev => !prev), [])
  
  const resetCharts = useCallback(() => {
    setCharts(initialCharts)
  }, [initialCharts])

  return {
    isOpen,
    isEditMode,
    charts,
    openPanel,
    closePanel,
    toggleEditMode,
    setCharts,
    resetCharts,
  }
}
