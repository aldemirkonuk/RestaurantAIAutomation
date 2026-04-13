/**
 * EditToolbar - Floating toolbar shown at top of the charts area when edit mode is active.
 * Replaces the old EditLayoutPanel sidebar.
 *
 * Actions: + Add Block | Presets | Reset | Done
 */

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus,
  LayoutGrid,
  RotateCcw,
  Check,
  ChevronDown,
  Pencil,
} from 'lucide-react'
import { DATA_SOURCES, LAYOUT_PRESETS, getDefaultChartType } from './dashboardMeta'
import type { DashboardBlock, DataSource, LayoutPreset } from './dashboardTypes'

interface EditToolbarProps {
  isEditMode: boolean
  onToggleEditMode: () => void
  onAddBlock: (block: DashboardBlock) => void
  onApplyPreset: (preset: LayoutPreset) => void
  onReset: () => void
}

export function EditToolbar({
  isEditMode,
  onToggleEditMode,
  onAddBlock,
  onApplyPreset,
  onReset,
}: EditToolbarProps) {
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [showPresetMenu, setShowPresetMenu] = useState(false)
  const addRef = useRef<HTMLDivElement>(null)
  const presetRef = useRef<HTMLDivElement>(null)

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (addRef.current && !addRef.current.contains(e.target as Node)) {
        setShowAddMenu(false)
      }
      if (presetRef.current && !presetRef.current.contains(e.target as Node)) {
        setShowPresetMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleAddBlock = (dataSource: DataSource) => {
    const sourceMeta = DATA_SOURCES.find((s) => s.key === dataSource)
    if (!sourceMeta) return

    const newBlock: DashboardBlock = {
      id: `block-${dataSource}-${Date.now()}`,
      title: sourceMeta.title,
      blockType: sourceMeta.supportsKPI ? 'kpi' : 'chart',
      dataSource,
      chartType: getDefaultChartType(dataSource),
      layout: { x: 0, y: Infinity, w: 6, h: 4, minW: 3, minH: 2 },
      visible: true,
    }
    onAddBlock(newBlock)
    setShowAddMenu(false)
  }

  if (!isEditMode) {
    return (
      <motion.button
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={onToggleEditMode}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm"
      >
        <Pencil className="w-4 h-4" />
        Edit Layout
      </motion.button>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl shadow-sm"
    >
      <div className="flex items-center gap-1.5 mr-2">
        <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
        <span className="text-sm font-semibold text-blue-700">Editing Layout</span>
      </div>

      <div className="w-px h-6 bg-blue-200" />

      {/* Add Block */}
      <div ref={addRef} className="relative">
        <button
          onClick={() => {
            setShowAddMenu(!showAddMenu)
            setShowPresetMenu(false)
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-700 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Block
          <ChevronDown className="w-3 h-3" />
        </button>

        <AnimatePresence>
          {showAddMenu && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="absolute top-full left-0 mt-1 w-64 bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-50 max-h-[320px] overflow-y-auto"
            >
              <p className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Data Source
              </p>
              {DATA_SOURCES.map((source) => {
                const Icon = source.icon
                return (
                  <button
                    key={source.key}
                    onClick={() => handleAddBlock(source.key)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <div className="p-1 bg-gray-100 rounded">
                      <Icon className="w-3.5 h-3.5 text-gray-500" />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-medium text-gray-800">{source.title}</p>
                      <p className="text-xs text-gray-400 leading-tight">{source.description}</p>
                    </div>
                  </button>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Presets */}
      <div ref={presetRef} className="relative">
        <button
          onClick={() => {
            setShowPresetMenu(!showPresetMenu)
            setShowAddMenu(false)
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-700 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
        >
          <LayoutGrid className="w-4 h-4" />
          Presets
          <ChevronDown className="w-3 h-3" />
        </button>

        <AnimatePresence>
          {showPresetMenu && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="absolute top-full left-0 mt-1 w-60 bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-50"
            >
              {LAYOUT_PRESETS.map((preset) => {
                const Icon = preset.icon
                return (
                  <button
                    key={preset.id}
                    onClick={() => {
                      onApplyPreset(preset)
                      setShowPresetMenu(false)
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <div className="p-1.5 bg-gray-100 rounded-lg">
                      <Icon className="w-4 h-4 text-gray-500" />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-medium text-gray-800">{preset.name}</p>
                      <p className="text-xs text-gray-400">{preset.description}</p>
                    </div>
                  </button>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Reset */}
      <button
        onClick={onReset}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        title="Reset to default layout"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        Reset
      </button>

      <div className="flex-1" />

      {/* Done */}
      <button
        onClick={onToggleEditMode}
        className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
      >
        <Check className="w-4 h-4" />
        Done
      </button>
    </motion.div>
  )
}
