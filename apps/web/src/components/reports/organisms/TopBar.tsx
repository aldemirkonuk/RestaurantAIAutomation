/**
 * TopBar - Organism Component
 * Time range selector + Edit button + Export dropdown
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Download,
  ChevronDown,
  Pencil,
  FileSpreadsheet,
  Table,
  FileText,
  Cloud,
  CheckCircle,
  LayoutGrid,
  GitCompare,
} from 'lucide-react'
import { Button } from '../../ui'

interface TopBarProps {
  timeRange: '7d' | '30d' | '90d'
  onTimeRangeChange: (range: '7d' | '30d' | '90d') => void
  isEditMode: boolean
  onEditToggle: () => void
  onOpenArrange: () => void
  onExport: (format: string) => void
  exportSuccess?: string | null
  showComparison?: boolean
  onToggleComparison?: () => void
  className?: string
}

export function TopBar({
  timeRange,
  onTimeRangeChange,
  isEditMode,
  onEditToggle,
  onOpenArrange,
  onExport,
  exportSuccess,
  showComparison = false,
  onToggleComparison,
  className = '',
}: TopBarProps) {
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showEditMenu, setShowEditMenu] = useState(false)

  const handleExport = (format: string) => {
    setShowExportMenu(false)
    onExport(format)
  }

  return (
    <>
      <div className={`flex items-center justify-between bg-white rounded-xl border border-gray-200 p-4 ${className}`}>
        <div className="flex items-center gap-4">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {[
              { value: '7d' as const, label: '7D' },
              { value: '30d' as const, label: '30D' },
              { value: '90d' as const, label: '90D' },
            ].map((range) => (
              <button
                key={range.value}
                onClick={() => onTimeRangeChange(range.value)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  timeRange === range.value
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
          {isEditMode && (
            <div className="hidden md:flex items-center gap-2 text-xs text-wine-700 bg-wine-50 px-3 py-1.5 rounded-full border border-wine-200">
              <Pencil className="w-3.5 h-3.5" />
              Drag to reorder • Click cards to edit
            </div>
          )}
          {onToggleComparison && (
            <button
              onClick={onToggleComparison}
              className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                showComparison
                  ? 'bg-wine-50 text-wine-700 border-wine-200'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
              title="Toggle period comparison"
            >
              <GitCompare className="w-3.5 h-3.5" />
              Compare
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Edit Controls */}
          <div className="relative">
            <button
              onClick={() => setShowEditMenu(!showEditMenu)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors border ${
                isEditMode
                  ? 'bg-wine-600 text-white border-wine-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
              }`}
            >
              <Pencil className="w-4 h-4" />
              <span className="text-sm font-medium">{isEditMode ? 'Editing' : 'Edit Layout'}</span>
              <ChevronDown className="w-4 h-4" />
            </button>

            <AnimatePresence>
              {showEditMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute right-0 mt-2 w-60 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-50"
                >
                  <button
                    onClick={() => {
                      onEditToggle()
                      setShowEditMenu(false)
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
                  >
                    <Pencil className="w-4 h-4 text-wine-600" />
                    <div className="text-left">
                      <p className="text-sm font-medium text-gray-900">
                        {isEditMode ? 'Exit Edit Mode' : 'Enter Edit Mode'}
                      </p>
                      <p className="text-xs text-gray-500">Drag and click cards to edit</p>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      onOpenArrange()
                      setShowEditMenu(false)
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
                  >
                    <LayoutGrid className="w-4 h-4 text-blue-600" />
                    <div className="text-left">
                      <p className="text-sm font-medium text-gray-900">Arrange Charts</p>
                      <p className="text-xs text-gray-500">Customize chart layout</p>
                    </div>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Export Button with Dropdown */}
          <div className="relative">
            <Button variant="default" onClick={() => setShowExportMenu(!showExportMenu)}>
              <Download className="w-4 h-4 mr-2" />
              Export
              <ChevronDown className="w-4 h-4 ml-2" />
            </Button>

          <AnimatePresence>
            {showExportMenu && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-50"
              >
                <button
                  onClick={() => handleExport('csv')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
                >
                  <FileSpreadsheet className="w-4 h-4 text-green-600" />
                  <div className="text-left">
                    <p className="text-sm font-medium text-gray-900">CSV</p>
                    <p className="text-xs text-gray-500">Comma-separated values</p>
                  </div>
                </button>
                <button
                  onClick={() => handleExport('excel')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
                >
                  <Table className="w-4 h-4 text-green-700" />
                  <div className="text-left">
                    <p className="text-sm font-medium text-gray-900">Excel</p>
                    <p className="text-xs text-gray-500">.xlsx spreadsheet</p>
                  </div>
                </button>
                <button
                  onClick={() => handleExport('pdf')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
                >
                  <FileText className="w-4 h-4 text-red-600" />
                  <div className="text-left">
                    <p className="text-sm font-medium text-gray-900">PDF</p>
                    <p className="text-xs text-gray-500">Printable document</p>
                  </div>
                </button>
                <div className="border-t border-gray-100 my-1" />
                <button
                  onClick={() => handleExport('sheets')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
                >
                  <FileSpreadsheet className="w-4 h-4 text-green-500" />
                  <div className="text-left">
                    <p className="text-sm font-medium text-gray-900">Google Sheets</p>
                    <p className="text-xs text-gray-500">Open in Sheets</p>
                  </div>
                </button>
                <button
                  onClick={() => handleExport('drive')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
                >
                  <Cloud className="w-4 h-4 text-blue-500" />
                  <div className="text-left">
                    <p className="text-sm font-medium text-gray-900">Google Drive</p>
                    <p className="text-xs text-gray-500">Save to Drive</p>
                  </div>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Export Success Toast */}
      <AnimatePresence>
        {exportSuccess && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 right-4 bg-emerald-600 text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 z-50"
          >
            <CheckCircle className="w-5 h-5" />
            <span className="font-medium">Exported as {exportSuccess.toUpperCase()}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
