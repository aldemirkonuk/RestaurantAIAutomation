import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CheckCircle,
  AlertCircle,
  Wine,
  Plus,
  CheckSquare,
  Square,
  Trash2,
  Edit3,
  ChevronDown,
  ChevronUp,
  MapPin,
  Grape,
  Save,
  Sparkles,
} from 'lucide-react'
import { DetectedWine } from '../../services/wineDetection'
import { getWineTypeColor } from '../../data/wineData'

// Field source badge colors
const SOURCE_BADGE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  yolo_detected: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'YOLO' },
  ocr_extracted: { bg: 'bg-cyan-100', text: 'text-cyan-700', label: 'OCR' },
  ai_inferred: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'AI' },
  ai_enriched: { bg: 'bg-violet-100', text: 'text-violet-700', label: 'Enriched' },
  section_context: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Context' },
  local_match: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Library' },
}

function FieldSourceBadge({ source }: { source?: string }) {
  if (!source) return null
  const style = SOURCE_BADGE_COLORS[source] || { bg: 'bg-gray-100', text: 'text-gray-600', label: source }
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold ${style.bg} ${style.text}`}>
      {style.label}
    </span>
  )
}

interface EditableFields {
  name: string
  producer: string
  vintage: string
  wineType: string
  country: string
  region: string
  grape: string
  price: string
}

interface ScanResultsPanelProps {
  wines: DetectedWine[]
  previewImage?: string | null
  sectionHeaders?: string[]
  onConfirm: (acceptedWines: DetectedWine[]) => void
  onRescan: () => void
}

export function ScanResultsPanel({
  wines,
  previewImage,
  sectionHeaders = [],
  onConfirm,
  onRescan,
}: ScanResultsPanelProps) {
  const [selectedWines, setSelectedWines] = useState<Set<string>>(() => {
    // Auto-select wines in master library
    return new Set(wines.filter((w) => w.inMasterLibrary).map((w) => w.id))
  })
  const [expandedWineId, setExpandedWineId] = useState<string | null>(null)
  const [editingWineId, setEditingWineId] = useState<string | null>(null)
  const [editFields, setEditFields] = useState<EditableFields | null>(null)
  const [rejectedWines, setRejectedWines] = useState<Set<string>>(new Set())

  const visibleWines = useMemo(
    () => wines.filter((w) => !rejectedWines.has(w.id)),
    [wines, rejectedWines],
  )

  const toggleWineSelection = (wineId: string) => {
    const newSelection = new Set(selectedWines)
    if (newSelection.has(wineId)) newSelection.delete(wineId)
    else newSelection.add(wineId)
    setSelectedWines(newSelection)
  }

  const selectAll = () => setSelectedWines(new Set(visibleWines.map((w) => w.id)))
  const deselectAll = () => setSelectedWines(new Set())

  const rejectWine = (wineId: string) => {
    setRejectedWines((prev) => new Set([...prev, wineId]))
    setSelectedWines((prev) => {
      const next = new Set(prev)
      next.delete(wineId)
      return next
    })
  }

  const undoReject = (wineId: string) => {
    setRejectedWines((prev) => {
      const next = new Set(prev)
      next.delete(wineId)
      return next
    })
  }

  const startEditing = (wine: DetectedWine) => {
    setEditingWineId(wine.id)
    setEditFields({
      name: wine.name,
      producer: wine.producer || '',
      vintage: wine.vintage?.toString() || '',
      wineType: wine.wineType || wine.type || '',
      country: wine.country || '',
      region: wine.region || '',
      grape: wine.grape || '',
      price: wine.price?.toString() || '',
    })
  }

  const saveEditing = () => {
    // In a real implementation, update the wine data. For now we just close the editor.
    setEditingWineId(null)
    setEditFields(null)
  }

  const cancelEditing = () => {
    setEditingWineId(null)
    setEditFields(null)
  }

  const handleConfirm = () => {
    const accepted = wines.filter((w) => selectedWines.has(w.id))
    if (accepted.length === 0) {
      alert('Please select at least one wine to add')
      return
    }
    onConfirm(accepted)
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header with stats */}
      <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-purple-50">
        <div className="flex items-start gap-4">
          {previewImage && (
            <div className="w-24 h-24 rounded-xl overflow-hidden border-2 border-white shadow-lg flex-shrink-0">
              <img src={previewImage} alt="Scanned menu" className="w-full h-full object-cover" />
            </div>
          )}
          <div className="flex-1">
            <div className="flex items-start justify-between mb-2">
              <div>
                <h3 className="font-semibold text-gray-900 text-lg flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-indigo-600" />
                  {visibleWines.length} Wines Detected
                </h3>
                <p className="text-sm text-gray-600">
                  {selectedWines.size} selected
                  {' '}&middot;{' '}{visibleWines.filter((w) => w.inMasterLibrary).length} in Library
                  {' '}&middot;{' '}{visibleWines.filter((w) => !w.inMasterLibrary).length} new
                  {rejectedWines.size > 0 && <> &middot; {rejectedWines.size} rejected</>}
                </p>
              </div>
            </div>

            {sectionHeaders.length > 0 && (
              <div className="flex gap-1.5 mb-2 flex-wrap">
                {sectionHeaders.map((h, i) => (
                  <span key={i} className="px-2 py-0.5 bg-white/70 rounded text-[10px] font-medium text-gray-600 border border-gray-200">
                    {h}
                  </span>
                ))}
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              <button onClick={selectAll} className="px-3 py-1.5 text-xs font-medium text-indigo-700 bg-white border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors">
                Select All
              </button>
              <button onClick={deselectAll} className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                Deselect All
              </button>
              <button onClick={onRescan} className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                Scan Again
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Wine list */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-3">
          {visibleWines.map((wine) => {
            const isSelected = selectedWines.has(wine.id)
            const isExpanded = expandedWineId === wine.id
            const isEditing = editingWineId === wine.id
            const typeColors = (wine.wineType || wine.type)
              ? getWineTypeColor((wine.wineType || wine.type) as string)
              : { bg: 'bg-gray-100', text: 'text-gray-700' }

            return (
              <motion.div
                key={wine.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -100 }}
                className={`rounded-xl border-2 transition-all ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-50/50 shadow-md'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {/* Main row */}
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <button onClick={() => toggleWineSelection(wine.id)} className="pt-0.5">
                      {isSelected ? (
                        <CheckSquare className="w-5 h-5 text-indigo-600" />
                      ) : (
                        <Square className="w-5 h-5 text-gray-400" />
                      )}
                    </button>

                    <div className={`w-10 h-14 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      wine.inMasterLibrary ? 'bg-emerald-100' : 'bg-amber-100'
                    }`}>
                      <Wine className={`w-5 h-5 ${wine.inMasterLibrary ? 'text-emerald-600' : 'text-amber-600'}`} />
                    </div>

                    <div className="flex-1 min-w-0">
                      {isEditing && editFields ? (
                        /* Inline edit mode */
                        <div className="space-y-2">
                          <input
                            value={editFields.name}
                            onChange={(e) => setEditFields({ ...editFields, name: e.target.value })}
                            className="w-full px-2 py-1 text-sm font-semibold border border-indigo-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            placeholder="Wine name"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              value={editFields.producer}
                              onChange={(e) => setEditFields({ ...editFields, producer: e.target.value })}
                              className="px-2 py-1 text-xs border border-gray-300 rounded-lg"
                              placeholder="Producer"
                            />
                            <input
                              value={editFields.vintage}
                              onChange={(e) => setEditFields({ ...editFields, vintage: e.target.value })}
                              className="px-2 py-1 text-xs border border-gray-300 rounded-lg"
                              placeholder="Vintage"
                            />
                            <input
                              value={editFields.wineType}
                              onChange={(e) => setEditFields({ ...editFields, wineType: e.target.value })}
                              className="px-2 py-1 text-xs border border-gray-300 rounded-lg"
                              placeholder="Type (red/white/...)"
                            />
                            <input
                              value={editFields.country}
                              onChange={(e) => setEditFields({ ...editFields, country: e.target.value })}
                              className="px-2 py-1 text-xs border border-gray-300 rounded-lg"
                              placeholder="Country"
                            />
                            <input
                              value={editFields.region}
                              onChange={(e) => setEditFields({ ...editFields, region: e.target.value })}
                              className="px-2 py-1 text-xs border border-gray-300 rounded-lg"
                              placeholder="Region"
                            />
                            <input
                              value={editFields.grape}
                              onChange={(e) => setEditFields({ ...editFields, grape: e.target.value })}
                              className="px-2 py-1 text-xs border border-gray-300 rounded-lg"
                              placeholder="Grape"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button onClick={saveEditing} className="px-3 py-1 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 flex items-center gap-1">
                              <Save className="w-3 h-3" />
                              Save
                            </button>
                            <button onClick={cancelEditing} className="px-3 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* Display mode */
                        <>
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <h4 className={`font-semibold text-sm ${isSelected ? 'text-indigo-900' : 'text-gray-900'}`}>
                              {wine.name}
                            </h4>
                            <div className="flex items-center gap-1">
                              {wine.inMasterLibrary ? (
                                <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" title="In Master Library" />
                              ) : (
                                <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" title="New wine" />
                              )}
                            </div>
                          </div>

                          <p className="text-xs text-gray-500 mb-2">
                            {wine.producer || 'Unknown Producer'} &middot; {wine.vintage || 'NV'}
                          </p>

                          {/* Tags row */}
                          <div className="flex items-center gap-1.5 flex-wrap mb-2">
                            {(wine.wineType || wine.type) && (
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${typeColors.bg} ${typeColors.text}`}>
                                {wine.wineType || wine.type}
                              </span>
                            )}
                            {wine.country && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-600">
                                <MapPin className="w-2.5 h-2.5" />
                                {wine.country}{wine.region && `, ${wine.region}`}
                              </span>
                            )}
                            {wine.grape && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-600">
                                <Grape className="w-2.5 h-2.5" />
                                {wine.grape}
                              </span>
                            )}
                            {wine.price != null && (
                              <span className="text-[10px] font-medium text-gray-700">${wine.price}</span>
                            )}
                          </div>

                          {/* Confidence bar */}
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className={`h-full transition-all ${
                                  wine.confidence >= 0.9 ? 'bg-emerald-500' :
                                  wine.confidence >= 0.7 ? 'bg-yellow-500' :
                                  'bg-rose-500'
                                }`}
                                style={{ width: `${wine.confidence * 100}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-gray-500 font-medium">
                              {Math.round(wine.confidence * 100)}%
                            </span>
                            {wine.fieldSources && Object.values(wine.fieldSources).length > 0 && (
                              <div className="flex gap-0.5">
                                {[...new Set(Object.values(wine.fieldSources))].slice(0, 3).map((src, i) => (
                                  <FieldSourceBadge key={i} source={src} />
                                ))}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Action buttons */}
                    {!isEditing && (
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        <button
                          onClick={() => startEditing(wine)}
                          className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="Edit wine details"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => rejectWine(wine.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Reject wine"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Expand toggle */}
                {!isEditing && (
                  <button
                    onClick={() => setExpandedWineId((prev) => (prev === wine.id ? null : wine.id))}
                    className="w-full px-4 py-1.5 border-t border-gray-100 flex items-center justify-center gap-1 text-[10px] text-gray-500 hover:bg-gray-50 transition-colors"
                  >
                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {isExpanded ? 'Less' : 'All fields'}
                  </button>
                )}

                {/* Expanded details */}
                <AnimatePresence>
                  {isExpanded && !isEditing && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 border-t border-gray-100">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5 mt-3 text-xs">
                          <FieldRow label="Producer" value={wine.producer} source={wine.fieldSources?.producer} />
                          <FieldRow label="Vintage" value={wine.vintage?.toString()} source={wine.fieldSources?.vintage} />
                          <FieldRow label="Wine Type" value={wine.wineType || wine.type} source={wine.fieldSources?.wine_type} />
                          <FieldRow label="Country" value={wine.country} source={wine.fieldSources?.country} />
                          <FieldRow label="Region" value={wine.region} source={wine.fieldSources?.region} />
                          <FieldRow label="Sub-Region" value={wine.subRegion} source={wine.fieldSources?.sub_region} />
                          <FieldRow label="Appellation" value={wine.appellation} source={wine.fieldSources?.appellation} />
                          <FieldRow label="Grape" value={wine.grape} source={wine.fieldSources?.grape_variety} />
                          <FieldRow label="Price" value={wine.price ? `$${wine.price}` : undefined} source={wine.fieldSources?.price} />
                          <FieldRow label="ABV" value={wine.alcoholPct ? `${wine.alcoholPct}%` : undefined} source={wine.fieldSources?.alcohol_pct} />
                          <FieldRow label="Body" value={wine.body} source={wine.fieldSources?.body} />
                          <FieldRow label="Sweetness" value={wine.sweetness} source={wine.fieldSources?.sweetness} />
                          {wine.tastingNotes && (
                            <div className="col-span-full">
                              <FieldRow label="Tasting Notes" value={wine.tastingNotes} source={wine.fieldSources?.tasting_notes} />
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </div>

        {/* Rejected wines (collapsed) */}
        {rejectedWines.size > 0 && (
          <div className="mt-4 p-3 bg-gray-50 rounded-xl border border-gray-200">
            <p className="text-xs font-medium text-gray-500 mb-2">{rejectedWines.size} rejected wines</p>
            <div className="flex gap-2 flex-wrap">
              {wines.filter((w) => rejectedWines.has(w.id)).map((wine) => (
                <button
                  key={wine.id}
                  onClick={() => undoReject(wine.id)}
                  className="px-2 py-1 text-[10px] text-gray-500 bg-white border border-gray-200 rounded-lg hover:border-indigo-300 hover:text-indigo-600 transition-colors flex items-center gap-1"
                >
                  {wine.name}
                  <Plus className="w-2.5 h-2.5" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom action bar */}
      <div className="p-4 border-t border-gray-200 bg-white">
        <button
          onClick={handleConfirm}
          disabled={selectedWines.size === 0}
          className="w-full px-6 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20"
        >
          <Plus className="w-5 h-5" />
          Add {selectedWines.size} Wine{selectedWines.size !== 1 ? 's' : ''} to Inventory
        </button>
      </div>
    </div>
  )
}

function FieldRow({ label, value, source }: { label: string; value?: string | null; source?: string }) {
  if (!value)
    return (
      <div className="flex items-center justify-between py-0.5">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300 italic">--</span>
      </div>
    )
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-gray-500 flex-shrink-0">{label}</span>
      <div className="flex items-center gap-1 min-w-0">
        <span className="text-gray-900 font-medium truncate">{value}</span>
        <FieldSourceBadge source={source} />
      </div>
    </div>
  )
}
