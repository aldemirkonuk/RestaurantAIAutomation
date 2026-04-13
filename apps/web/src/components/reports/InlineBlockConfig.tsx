/**
 * InlineBlockConfig - Popover for configuring a dashboard block.
 * Replaces the full-screen ChartConfigModal with a lightweight inline popover
 * that attaches directly to the block being configured.
 *
 * Tabs: Data Source | Block Type | Chart Type
 */

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Check,
  BarChart3,
  Table2,
  Gauge,
} from 'lucide-react'
import {
  DATA_SOURCES,
  CHART_TYPES,
  getCompatibleChartTypes,
  isBlockTypeCompatible,
  getDefaultChartType,
} from './dashboardMeta'
import type { DashboardBlock, BlockType, ChartType, DataSource } from './dashboardTypes'

interface InlineBlockConfigProps {
  block: DashboardBlock
  onSave: (updated: DashboardBlock) => void
  onClose: () => void
  onDelete: () => void
}

type Tab = 'data' | 'blockType' | 'chartType'

const BLOCK_TYPE_OPTIONS: { key: BlockType; title: string; icon: typeof BarChart3; description: string }[] = [
  { key: 'chart', title: 'Chart', icon: BarChart3, description: 'Visual chart (area, bar, donut, etc.)' },
  { key: 'kpi', title: 'KPI Card', icon: Gauge, description: 'Single big number with trend' },
  { key: 'table', title: 'Data Table', icon: Table2, description: 'Sortable tabular data' },
]

export function InlineBlockConfig({ block, onSave, onClose, onDelete }: InlineBlockConfigProps) {
  const [draft, setDraft] = useState<DashboardBlock>({ ...block })
  const [activeTab, setActiveTab] = useState<Tab>('data')
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handleDataSourceChange = (ds: DataSource) => {
    const updated = { ...draft, dataSource: ds }
    // Auto-correct block type / chart type if incompatible
    if (updated.blockType === 'kpi' && !isBlockTypeCompatible(ds, 'kpi')) {
      updated.blockType = 'chart'
    }
    const compatible = getCompatibleChartTypes(ds)
    if (updated.blockType === 'chart' && !compatible.includes(updated.chartType)) {
      updated.chartType = getDefaultChartType(ds)
    }
    // Update title to match new source
    const sourceMeta = DATA_SOURCES.find((s) => s.key === ds)
    if (sourceMeta) {
      updated.title = sourceMeta.title
    }
    setDraft(updated)
  }

  const handleBlockTypeChange = (bt: BlockType) => {
    const updated = { ...draft, blockType: bt }
    if (bt === 'chart') {
      const compatible = getCompatibleChartTypes(updated.dataSource)
      if (!compatible.includes(updated.chartType)) {
        updated.chartType = compatible[0] ?? 'bar'
      }
    }
    setDraft(updated)
  }

  const handleChartTypeChange = (ct: ChartType) => {
    setDraft({ ...draft, chartType: ct })
  }

  const compatibleCharts = getCompatibleChartTypes(draft.dataSource)

  const tabs: { key: Tab; label: string }[] = [
    { key: 'data', label: 'Data Source' },
    { key: 'blockType', label: 'Block Type' },
    ...(draft.blockType === 'chart' ? [{ key: 'chartType' as Tab, label: 'Chart Style' }] : []),
  ]

  return (
    <AnimatePresence>
      <motion.div
        ref={panelRef}
        initial={{ opacity: 0, y: 8, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.96 }}
        transition={{ duration: 0.15 }}
        className="absolute z-50 top-full left-0 mt-2 w-[380px] bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden"
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b bg-gray-50">
          <span className="text-sm font-semibold text-gray-700">Configure Block</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === tab.key
                  ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/40'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-3 max-h-[300px] overflow-y-auto">
          {activeTab === 'data' && (
            <div className="grid grid-cols-2 gap-1.5">
              {DATA_SOURCES.map((source) => {
                const Icon = source.icon
                const selected = draft.dataSource === source.key
                return (
                  <button
                    key={source.key}
                    onClick={() => handleDataSourceChange(source.key)}
                    className={`flex items-center gap-2 p-2 rounded-lg border text-left transition-all text-xs ${
                      selected
                        ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200'
                        : 'border-gray-150 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className={`p-1.5 rounded-md ${selected ? 'bg-blue-200' : 'bg-gray-100'}`}>
                      <Icon className={`w-3.5 h-3.5 ${selected ? 'text-blue-700' : 'text-gray-500'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium leading-tight ${selected ? 'text-blue-700' : 'text-gray-800'}`}>
                        {source.title}
                      </p>
                    </div>
                    {selected && <Check className="w-3 h-3 text-blue-600 flex-shrink-0" />}
                  </button>
                )
              })}
            </div>
          )}

          {activeTab === 'blockType' && (
            <div className="space-y-1.5">
              {BLOCK_TYPE_OPTIONS.map((bt) => {
                const Icon = bt.icon
                const selected = draft.blockType === bt.key
                const disabled = !isBlockTypeCompatible(draft.dataSource, bt.key)
                return (
                  <button
                    key={bt.key}
                    onClick={() => !disabled && handleBlockTypeChange(bt.key)}
                    disabled={disabled}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
                      disabled
                        ? 'opacity-40 cursor-not-allowed border-gray-100 bg-gray-50'
                        : selected
                        ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200'
                        : 'border-gray-150 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className={`p-2 rounded-lg ${selected ? 'bg-blue-200' : 'bg-gray-100'}`}>
                      <Icon className={`w-4 h-4 ${selected ? 'text-blue-700' : 'text-gray-500'}`} />
                    </div>
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${selected ? 'text-blue-700' : 'text-gray-800'}`}>
                        {bt.title}
                      </p>
                      <p className="text-xs text-gray-500">{bt.description}</p>
                    </div>
                    {selected && <Check className="w-4 h-4 text-blue-600 flex-shrink-0" />}
                    {disabled && <span className="text-xs text-gray-400 italic flex-shrink-0">N/A</span>}
                  </button>
                )
              })}
            </div>
          )}

          {activeTab === 'chartType' && draft.blockType === 'chart' && (
            <div className="space-y-1.5">
              {CHART_TYPES.map((ct) => {
                const Icon = ct.icon
                const selected = draft.chartType === ct.key
                const disabled = !compatibleCharts.includes(ct.key)
                return (
                  <button
                    key={ct.key}
                    onClick={() => !disabled && handleChartTypeChange(ct.key)}
                    disabled={disabled}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
                      disabled
                        ? 'opacity-40 cursor-not-allowed border-gray-100 bg-gray-50'
                        : selected
                        ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200'
                        : 'border-gray-150 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className={`p-2 rounded-lg ${selected ? 'bg-blue-200' : 'bg-gray-100'}`}>
                      <Icon className={`w-4 h-4 ${selected ? 'text-blue-700' : 'text-gray-500'}`} />
                    </div>
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${selected ? 'text-blue-700' : 'text-gray-800'}`}>
                        {ct.title}
                      </p>
                      <p className="text-xs text-gray-500">{ct.description}</p>
                    </div>
                    {selected && <Check className="w-4 h-4 text-blue-600 flex-shrink-0" />}
                    {disabled && <span className="text-xs text-gray-400 italic flex-shrink-0">Incompatible</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t bg-gray-50">
          <button
            onClick={onDelete}
            className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
          >
            Remove block
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200 rounded-md font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(draft)}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-colors flex items-center gap-1"
            >
              <Check className="w-3 h-3" />
              Apply
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
