/**
 * DashboardGrid Component
 * A responsive, draggable grid system for dashboard widgets
 * Inspired by iOS app rearrangement with jiggle animation
 */

import { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import {
  X,
  Plus,
  Check,
  Pencil,
  Maximize2,
  TrendingUp,
  Package,
  BarChart3,
  Activity,
  PieChart,
  LineChart,
  Calendar,
} from 'lucide-react'

// Widget size configurations
export type WidgetSize = 'small' | 'medium' | 'large' | 'wide' | 'tall'

export interface DashboardWidget {
  id: string
  type: WidgetType
  title: string
  size: WidgetSize
  visible: boolean
  data?: any
}

export type WidgetType = 
  | 'kpi'
  | 'chart_line'
  | 'chart_bar'
  | 'chart_pie'
  | 'table'
  | 'list'
  | 'calendar'
  | 'activity'

// Widget type configurations
export const WIDGET_TYPES: { type: WidgetType; title: string; icon: React.ElementType; description: string; defaultSize: WidgetSize }[] = [
  { type: 'kpi', title: 'KPI Card', icon: TrendingUp, description: 'Single metric with trend', defaultSize: 'small' },
  { type: 'chart_line', title: 'Line Chart', icon: LineChart, description: 'Trend over time', defaultSize: 'medium' },
  { type: 'chart_bar', title: 'Bar Chart', icon: BarChart3, description: 'Compare categories', defaultSize: 'medium' },
  { type: 'chart_pie', title: 'Pie Chart', icon: PieChart, description: 'Distribution breakdown', defaultSize: 'small' },
  { type: 'table', title: 'Data Table', icon: Package, description: 'Detailed data view', defaultSize: 'large' },
  { type: 'list', title: 'List View', icon: Activity, description: 'Ranked items', defaultSize: 'medium' },
  { type: 'calendar', title: 'Calendar', icon: Calendar, description: 'Date-based view', defaultSize: 'wide' },
  { type: 'activity', title: 'Activity Feed', icon: Activity, description: 'Recent actions', defaultSize: 'tall' },
]

// Size to grid classes mapping
const SIZE_CLASSES: Record<WidgetSize, string> = {
  small: 'col-span-1 row-span-1',
  medium: 'col-span-2 row-span-1',
  large: 'col-span-2 row-span-2',
  wide: 'col-span-3 row-span-1',
  tall: 'col-span-1 row-span-2',
}

const SIZE_MIN_HEIGHTS: Record<WidgetSize, string> = {
  small: 'min-h-[140px]',
  medium: 'min-h-[180px]',
  large: 'min-h-[360px]',
  wide: 'min-h-[180px]',
  tall: 'min-h-[320px]',
}

// CSS for jiggle animation
const jiggleStyles = `
@keyframes widget-jiggle {
  0%, 100% { transform: rotate(-0.3deg); }
  50% { transform: rotate(0.3deg); }
}

.widget-edit-mode {
  animation: widget-jiggle 0.2s ease-in-out infinite;
}

.widget-edit-mode:nth-child(2n) { animation-delay: 0.05s; }
.widget-edit-mode:nth-child(3n) { animation-delay: 0.1s; }
.widget-edit-mode:nth-child(4n) { animation-delay: 0.15s; }
`

const STORAGE_KEY = 'wineops_dashboard_layout'

// Default widgets
const DEFAULT_WIDGETS: DashboardWidget[] = [
  { id: 'w1', type: 'kpi', title: 'Total Revenue', size: 'small', visible: true },
  { id: 'w2', type: 'kpi', title: 'Orders Today', size: 'small', visible: true },
  { id: 'w3', type: 'kpi', title: 'Bottles Sold', size: 'small', visible: true },
  { id: 'w4', type: 'chart_line', title: 'Revenue Trend', size: 'medium', visible: true },
  { id: 'w5', type: 'chart_pie', title: 'Wine Distribution', size: 'small', visible: true },
  { id: 'w6', type: 'list', title: 'Top Sellers', size: 'medium', visible: true },
]

function loadDashboardLayout(): DashboardWidget[] {
  if (typeof window === 'undefined') return DEFAULT_WIDGETS
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : DEFAULT_WIDGETS
  } catch {
    return DEFAULT_WIDGETS
  }
}

function saveDashboardLayout(widgets: DashboardWidget[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets))
}

interface DashboardGridProps {
  renderWidget: (widget: DashboardWidget) => React.ReactNode
  onWidgetChange?: (widgets: DashboardWidget[]) => void
}

export function DashboardGrid({ renderWidget, onWidgetChange }: DashboardGridProps) {
  const [widgets, setWidgets] = useState<DashboardWidget[]>(loadDashboardLayout())
  const [isEditMode, setIsEditMode] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [showAddWidget, setShowAddWidget] = useState(false)
  const [editingWidget, setEditingWidget] = useState<string | null>(null)
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null)

  // Save layout when widgets change
  useEffect(() => {
    saveDashboardLayout(widgets)
    onWidgetChange?.(widgets)
  }, [widgets, onWidgetChange])

  // Long press to enter edit mode
  const handleLongPressStart = useCallback(() => {
    const timer = setTimeout(() => {
      setIsEditMode(true)
      if (navigator.vibrate) {
        navigator.vibrate(50)
      }
    }, 500)
    setLongPressTimer(timer)
  }, [])

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      setLongPressTimer(null)
    }
  }, [longPressTimer])

  const handleReorder = useCallback((newOrder: DashboardWidget[]) => {
    setWidgets(newOrder)
  }, [])



  const changeWidgetSize = useCallback((id: string, size: WidgetSize) => {
    setWidgets(prev => prev.map(w => 
      w.id === id ? { ...w, size } : w
    ))
    setEditingWidget(null)
  }, [])

  const addWidget = useCallback((type: WidgetType) => {
    const config = WIDGET_TYPES.find(t => t.type === type)
    if (!config) return

    const newWidget: DashboardWidget = {
      id: `w-${Date.now()}`,
      type,
      title: config.title,
      size: config.defaultSize,
      visible: true,
    }
    setWidgets(prev => [...prev, newWidget])
    setShowAddWidget(false)
  }, [])

  const removeWidget = useCallback((id: string) => {
    setWidgets(prev => prev.filter(w => w.id !== id))
  }, [])

  const resetLayout = useCallback(() => {
    setWidgets(DEFAULT_WIDGETS)
  }, [])

  const visibleWidgets = widgets.filter(w => w.visible)

  return (
    <div className="space-y-4">
      {/* Inject styles */}
      <style>{jiggleStyles}</style>

      {/* Edit Mode Header */}
      <AnimatePresence>
        {isEditMode && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl p-4 flex items-center justify-between shadow-lg"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-lg">
                <Pencil className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-white font-semibold">Dashboard Edit Mode</h3>
                <p className="text-white/80 text-sm">Drag to reorder, tap to resize, X to remove</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAddWidget(true)}
                className="flex items-center gap-2 px-3 py-2 bg-white/20 text-white rounded-lg font-medium hover:bg-white/30 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Widget
              </button>
              <button
                onClick={resetLayout}
                className="px-3 py-2 bg-white/20 text-white rounded-lg font-medium hover:bg-white/30 transition-colors"
              >
                Reset
              </button>
              <button
                onClick={() => setIsEditMode(false)}
                className="flex items-center gap-2 px-4 py-2 bg-white text-indigo-700 rounded-lg font-medium hover:bg-indigo-50 transition-colors"
              >
                <Check className="w-4 h-4" />
                Done
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Grid Container */}
      <Reorder.Group
        axis="y"
        values={visibleWidgets}
        onReorder={handleReorder}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-min"
      >
        {visibleWidgets.map((widget, _index) => (
          <Reorder.Item
            key={widget.id}
            value={widget}
            onDragStart={() => { setIsDragging(true); setIsEditMode(true); }}
            onDragEnd={() => setIsDragging(false)}
            whileDrag={{ scale: 1.02, boxShadow: '0 20px 40px rgba(0,0,0,0.15)', zIndex: 50 }}
            className={`${SIZE_CLASSES[widget.size]} ${isEditMode ? 'widget-edit-mode' : ''}`}
            onPointerDown={handleLongPressStart}
            onPointerUp={handleLongPressEnd}
            onPointerLeave={handleLongPressEnd}
          >
            <div
              className={`relative h-full bg-white rounded-xl border-2 transition-all overflow-hidden ${SIZE_MIN_HEIGHTS[widget.size]} ${
                isDragging ? 'select-none' : ''
              } ${
                isEditMode
                  ? 'border-indigo-300 shadow-indigo-100 cursor-grab active:cursor-grabbing'
                  : 'border-gray-100 hover:shadow-md hover:border-gray-200'
              }`}
            >
              {/* Edit mode controls */}
              {isEditMode && (
                <>
                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeWidget(widget.id)
                    }}
                    className="absolute -top-2 -left-2 w-6 h-6 bg-gray-800 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-red-600 transition-colors z-20"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>

                  {/* Size selector */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingWidget(editingWidget === widget.id ? null : widget.id)
                    }}
                    className="absolute top-2 right-2 p-1.5 bg-indigo-100 text-indigo-600 rounded-lg hover:bg-indigo-200 transition-colors z-20"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>

                  {/* Size dropdown */}
                  <AnimatePresence>
                    {editingWidget === widget.id && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="absolute top-10 right-2 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-30"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {(['small', 'medium', 'large', 'wide', 'tall'] as WidgetSize[]).map(size => (
                          <button
                            key={size}
                            onClick={() => changeWidgetSize(widget.id, size)}
                            className={`w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 flex items-center justify-between ${
                              widget.size === size ? 'text-indigo-600 font-medium' : 'text-gray-700'
                            }`}
                          >
                            <span className="capitalize">{size}</span>
                            {widget.size === size && <Check className="w-4 h-4" />}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Drag handle */}
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-0.5 z-10">
                    <div className="w-1 h-1 bg-gray-300 rounded-full" />
                    <div className="w-1 h-1 bg-gray-300 rounded-full" />
                    <div className="w-1 h-1 bg-gray-300 rounded-full" />
                  </div>
                </>
              )}

              {/* Widget content */}
              <div className="h-full p-4">
                {renderWidget(widget)}
              </div>
            </div>
          </Reorder.Item>
        ))}
      </Reorder.Group>

      {/* Empty state */}
      {visibleWidgets.length === 0 && (
        <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl p-12 text-center">
          <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-600 mb-2">No widgets visible</h3>
          <p className="text-gray-500 mb-4">Add widgets to customize your dashboard</p>
          <button
            onClick={() => setShowAddWidget(true)}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
          >
            Add Widget
          </button>
        </div>
      )}

      {/* Add Widget Modal */}
      <AnimatePresence>
        {showAddWidget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowAddWidget(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
            >
              <div className="px-6 py-4 border-b bg-gradient-to-r from-indigo-50 to-purple-50">
                <h3 className="text-lg font-bold text-gray-900">Add Widget</h3>
                <p className="text-sm text-gray-500">Choose a widget type to add to your dashboard</p>
              </div>
              <div className="p-4 max-h-[60vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-3">
                  {WIDGET_TYPES.map(widgetType => {
                    const Icon = widgetType.icon
                    return (
                      <button
                        key={widgetType.type}
                        onClick={() => addWidget(widgetType.type)}
                        className="flex flex-col items-center gap-3 p-4 rounded-xl border-2 border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-all text-center"
                      >
                        <div className="p-3 bg-indigo-100 rounded-xl">
                          <Icon className="w-6 h-6 text-indigo-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">{widgetType.title}</p>
                          <p className="text-xs text-gray-500">{widgetType.description}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="px-6 py-4 border-t bg-gray-50">
                <button
                  onClick={() => setShowAddWidget(false)}
                  className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit mode toggle button (floating) */}
      {!isEditMode && (
        <button
          onClick={() => setIsEditMode(true)}
          className="fixed bottom-6 right-6 p-4 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 transition-colors z-40"
          title="Edit Dashboard"
        >
          <Pencil className="w-5 h-5" />
        </button>
      )}
    </div>
  )
}

export default DashboardGrid
