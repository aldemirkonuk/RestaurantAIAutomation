import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Zap } from 'lucide-react'
import type { WineLocationScore, AutoLocateResult } from '../../lib/autoLocateEngine'
import type { StorageLocation } from '../../hooks/useStorageLocations'

interface AutoLocatePreviewModalProps {
  isOpen: boolean
  onClose: () => void
  result: AutoLocateResult
  allLocations: StorageLocation[]
  includeAssigned: boolean
  onToggleIncludeAssigned: (val: boolean) => void
  onConfirm: (selected: WineLocationScore[]) => void
}

export function AutoLocatePreviewModal({
  isOpen,
  onClose,
  result,
  allLocations,
  includeAssigned,
  onToggleIncludeAssigned,
  onConfirm,
}: AutoLocatePreviewModalProps) {
  const [rows, setRows] = useState<WineLocationScore[]>([])
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setRows(result.assignments)
    const initial: Record<string, boolean> = {}
    result.assignments.forEach(a => {
      initial[a.wineId] = true
    })
    setChecked(initial)
  }, [result])

  const selectedCount = Object.values(checked).filter(Boolean).length
  const locationsUtilized = new Set(
    rows.filter(r => checked[r.wineId]).map(r => r.locationId),
  ).size
  const skippedCount = result.skipped.length

  const handleLocationChange = (wineId: string, newLocationId: string) => {
    setRows(prev =>
      prev.map(r =>
        r.wineId === wineId
          ? {
              ...r,
              locationId: newLocationId,
              locationName:
                allLocations.find(l => l.id === newLocationId)?.name ?? r.locationName,
            }
          : r,
      ),
    )
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/50 z-50"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[85vh] flex flex-col pointer-events-auto"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                    <Zap className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">Auto-Locate Preview</h2>
                    <div className="flex gap-5 mt-0.5 text-sm text-gray-500">
                      <span>
                        <strong className="text-gray-800">{selectedCount}</strong> wines to assign
                      </span>
                      <span>
                        <strong className="text-gray-800">{locationsUtilized}</strong> locations utilized
                      </span>
                      {skippedCount > 0 && (
                        <span className="text-amber-600">
                          <strong>{skippedCount}</strong> skipped (no valid match)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Toggle */}
              <div className="px-6 py-3 border-b border-gray-50 bg-gray-50/60">
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeAssigned}
                    onChange={e => onToggleIncludeAssigned(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  Include already-assigned wines (will reassign them)
                </label>
              </div>

              {/* Table */}
              <div className="flex-1 overflow-y-auto">
                {rows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                    <Zap className="w-8 h-8 mb-3 opacity-30" />
                    <p className="text-sm">No wines to assign</p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white border-b border-gray-100 z-10">
                      <tr>
                        <th className="w-8 pl-6 py-3 text-left">
                          <input
                            type="checkbox"
                            checked={rows.length > 0 && rows.every(r => checked[r.wineId])}
                            onChange={e => {
                              const next: Record<string, boolean> = {}
                              rows.forEach(r => {
                                next[r.wineId] = e.target.checked
                              })
                              setChecked(next)
                            }}
                            className="rounded border-gray-300"
                          />
                        </th>
                        <th className="py-3 text-left font-medium text-gray-500 pr-4">Wine</th>
                        <th className="py-3 text-left font-medium text-gray-500 pr-4">
                          Proposed Location
                        </th>
                        <th className="py-3 text-left font-medium text-gray-500 pr-4">Score</th>
                        <th className="py-3 text-left font-medium text-gray-500 pr-6">Reasons</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {rows.map(row => (
                        <tr
                          key={row.wineId}
                          className={`transition-colors ${
                            checked[row.wineId] ? 'bg-white' : 'bg-gray-50/50 opacity-60'
                          }`}
                        >
                          {/* Checkbox */}
                          <td className="pl-6 py-3 w-8">
                            <input
                              type="checkbox"
                              checked={checked[row.wineId] ?? true}
                              onChange={e =>
                                setChecked(prev => ({ ...prev, [row.wineId]: e.target.checked }))
                              }
                              className="rounded border-gray-300"
                            />
                          </td>

                          {/* Wine name + type */}
                          <td className="py-3 pr-4">
                            <div className="font-medium text-gray-900 truncate max-w-[180px]">
                              {row.wineName}
                            </div>
                            <div className="text-xs text-gray-400 capitalize">{row.wineType}</div>
                          </td>

                          {/* Location dropdown */}
                          <td className="py-3 pr-4">
                            <select
                              value={row.locationId}
                              onChange={e => handleLocationChange(row.wineId, e.target.value)}
                              className="text-sm border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 max-w-[200px]"
                            >
                              {allLocations.map(loc => (
                                <option key={loc.id} value={loc.id}>
                                  {loc.name} ({loc.currentCount}/{loc.capacity ?? '—'})
                                </option>
                              ))}
                            </select>
                          </td>

                          {/* Score badge */}
                          <td className="py-3 pr-4">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                                row.score >= 70
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : row.score >= 40
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {row.score}pts
                            </span>
                          </td>

                          {/* Reasons */}
                          <td className="py-3 pr-6">
                            <span className="text-xs text-gray-500">
                              {row.reasons.join(' · ') || '—'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-white rounded-b-xl">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => onConfirm(rows.filter(r => checked[r.wineId]))}
                  disabled={selectedCount === 0}
                  className="px-6 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Confirm Selected ({selectedCount})
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
