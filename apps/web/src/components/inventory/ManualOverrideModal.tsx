import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  AlertTriangle,
  Save,
  Edit3,
  Plus,
  Minus,
  ShieldAlert,
  FileText,
  User,
  Clock,
} from 'lucide-react'
import { Wine } from '../../data/wineData'

interface ManualOverrideModalProps {
  isOpen: boolean
  onClose: () => void
  wine: Wine
  currentLiveStock: number
  currentShadowStock: number
  onSave: (data: ManualOverrideData) => void
}

export interface ManualOverrideData {
  wineId: string
  wineName: string
  oldLiveStock: number
  newLiveStock: number
  oldShadowStock: number
  newShadowStock: number
  reason: string
  reasonCategory: string
  notes: string
  managerId: string
  managerName: string
  timestamp: Date
}

const REASON_CATEGORIES = [
  { value: 'count_discrepancy', label: 'Physical Count Discrepancy', icon: AlertTriangle, color: 'text-amber-600' },
  { value: 'breakage', label: 'Breakage/Spillage', icon: AlertTriangle, color: 'text-rose-600' },
  { value: 'staff_consumption', label: 'Staff Consumption', icon: User, color: 'text-blue-600' },
  { value: 'gift', label: 'Gift to Customer', icon: User, color: 'text-purple-600' },
  { value: 'transfer', label: 'Transfer Between Locations', icon: Clock, color: 'text-gray-600' },
  { value: 'correction', label: 'Data Entry Correction', icon: Edit3, color: 'text-indigo-600' },
  { value: 'other', label: 'Other (specify below)', icon: FileText, color: 'text-gray-600' },
]

export function ManualOverrideModal({
  isOpen,
  onClose,
  wine,
  currentLiveStock,
  currentShadowStock,
  onSave,
}: ManualOverrideModalProps) {
  const [newLiveStock, setNewLiveStock] = useState(currentLiveStock)
  const [newShadowStock, setNewShadowStock] = useState(currentShadowStock)
  const [reasonCategory, setReasonCategory] = useState('')
  const [notes, setNotes] = useState('')
  const [validationError, setValidationError] = useState('')

  const liveStockDiff = newLiveStock - currentLiveStock
  const shadowStockDiff = newShadowStock - currentShadowStock
  const hasChanges = liveStockDiff !== 0 || shadowStockDiff !== 0

  const handleClose = () => {
    // Reset form
    setNewLiveStock(currentLiveStock)
    setNewShadowStock(currentShadowStock)
    setReasonCategory('')
    setNotes('')
    setValidationError('')
    onClose()
  }

  const handleSave = () => {
    // Validation
    if (!hasChanges) {
      setValidationError('No changes detected. Please modify stock values.')
      return
    }

    if (!reasonCategory) {
      setValidationError('Please select a reason category.')
      return
    }

    if (reasonCategory === 'other' && !notes.trim()) {
      setValidationError('Please provide details for "Other" reason.')
      return
    }

    if (newLiveStock < 0 || newShadowStock < 0) {
      setValidationError('Stock values cannot be negative.')
      return
    }

    // Create override data
    const overrideData: ManualOverrideData = {
      wineId: wine.id,
      wineName: wine.name,
      oldLiveStock: currentLiveStock,
      newLiveStock,
      oldShadowStock: currentShadowStock,
      newShadowStock,
      reason: REASON_CATEGORIES.find(r => r.value === reasonCategory)?.label || reasonCategory,
      reasonCategory,
      notes: notes.trim(),
      managerId: 'MGR_001', // TODO: Get from auth context
      managerName: 'Current Manager', // TODO: Get from auth context
      timestamp: new Date(),
    }

    onSave(overrideData)
    handleClose()
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={handleClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-amber-50 to-rose-50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-600 rounded-xl">
                <ShieldAlert className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Manual Stock Override</h2>
                <p className="text-sm text-gray-500">Adjust inventory with audit trail</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-white/50 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Warning Banner */}
          <div className="px-6 pt-4">
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-amber-900 text-sm">Manager Override Required</p>
                <p className="text-xs text-amber-700 mt-1">
                  All manual adjustments are logged with full audit trail and require owner/manager permissions.
                </p>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-6">
              {/* Wine Info */}
              <div className="p-4 bg-gray-50 rounded-xl">
                <h3 className="font-semibold text-gray-900 mb-1">{wine.name}</h3>
                <p className="text-sm text-gray-600">{wine.producer} · {wine.vintage || 'NV'}</p>
              </div>

              {/* Stock Adjustments */}
              <div className="space-y-4">
                {/* Live Stock */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">Live Stock</label>
                    <span className="text-xs text-gray-500">Current: {currentLiveStock}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setNewLiveStock(Math.max(0, newLiveStock - 1))}
                      className="p-2 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <Minus className="w-4 h-4 text-gray-600" />
                    </button>
                    <input
                      type="number"
                      value={newLiveStock}
                      onChange={(e) => setNewLiveStock(Math.max(0, parseInt(e.target.value) || 0))}
                      className="flex-1 px-4 py-3 border border-gray-200 rounded-xl text-center font-semibold text-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                      min={0}
                    />
                    <button
                      onClick={() => setNewLiveStock(newLiveStock + 1)}
                      className="p-2 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <Plus className="w-4 h-4 text-gray-600" />
                    </button>
                  </div>
                  {liveStockDiff !== 0 && (
                    <p className={`text-sm mt-2 font-medium ${liveStockDiff > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {liveStockDiff > 0 ? '+' : ''}{liveStockDiff} bottles
                    </p>
                  )}
                </div>

                {/* Shadow Stock */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">Shadow Stock</label>
                    <span className="text-xs text-gray-500">Current: {currentShadowStock}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setNewShadowStock(Math.max(0, newShadowStock - 1))}
                      className="p-2 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <Minus className="w-4 h-4 text-gray-600" />
                    </button>
                    <input
                      type="number"
                      value={newShadowStock}
                      onChange={(e) => setNewShadowStock(Math.max(0, parseInt(e.target.value) || 0))}
                      className="flex-1 px-4 py-3 border border-gray-200 rounded-xl text-center font-semibold text-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                      min={0}
                    />
                    <button
                      onClick={() => setNewShadowStock(newShadowStock + 1)}
                      className="p-2 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <Plus className="w-4 h-4 text-gray-600" />
                    </button>
                  </div>
                  {shadowStockDiff !== 0 && (
                    <p className={`text-sm mt-2 font-medium ${shadowStockDiff > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {shadowStockDiff > 0 ? '+' : ''}{shadowStockDiff} bottles
                    </p>
                  )}
                </div>
              </div>

              {/* Reason Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Reason for Override <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {REASON_CATEGORIES.map((category) => {
                    const Icon = category.icon
                    const isSelected = reasonCategory === category.value
                    return (
                      <button
                        key={category.value}
                        onClick={() => setReasonCategory(category.value)}
                        className={`p-3 rounded-xl border-2 text-left transition-all ${
                          isSelected
                            ? 'border-amber-500 bg-amber-50'
                            : 'border-gray-200 hover:border-amber-300 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Icon className={`w-4 h-4 ${isSelected ? 'text-amber-600' : category.color}`} />
                          <span className={`text-sm font-medium ${isSelected ? 'text-amber-900' : 'text-gray-700'}`}>
                            {category.label}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Additional Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Additional Notes {reasonCategory === 'other' && <span className="text-rose-500">*</span>}
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none"
                  placeholder="Provide details about this stock adjustment..."
                  rows={3}
                />
              </div>

              {/* Validation Error */}
              {validationError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                  <p className="text-sm text-rose-700">{validationError}</p>
                </div>
              )}

              {/* Summary */}
              {hasChanges && reasonCategory && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
                  <p className="text-sm font-medium text-blue-900 mb-2">Override Summary</p>
                  <div className="space-y-1 text-xs text-blue-700">
                    {liveStockDiff !== 0 && (
                      <p>• Live Stock: {currentLiveStock} → {newLiveStock} ({liveStockDiff > 0 ? '+' : ''}{liveStockDiff})</p>
                    )}
                    {shadowStockDiff !== 0 && (
                      <p>• Shadow Stock: {currentShadowStock} → {newShadowStock} ({shadowStockDiff > 0 ? '+' : ''}{shadowStockDiff})</p>
                    )}
                    <p>• Reason: {REASON_CATEGORIES.find(r => r.value === reasonCategory)?.label}</p>
                    {notes && <p>• Notes: {notes.substring(0, 50)}{notes.length > 50 ? '...' : ''}</p>}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
            <div className="flex gap-3">
              <button
                onClick={handleClose}
                className="px-6 py-3 border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!hasChanges || !reasonCategory}
                className="flex-1 py-3 bg-amber-600 text-white font-semibold rounded-xl hover:bg-amber-700 shadow-lg shadow-amber-600/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="w-5 h-5" />
                Save Override
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

