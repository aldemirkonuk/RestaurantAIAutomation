import { useState, useRef } from 'react'
import { motion } from 'framer-motion'
import {
  Camera,
  Upload,
  X,
  CheckCircle,
  AlertCircle,
  Loader2,
  Wine,
  Plus,
  CheckSquare,
  Square,
  Sparkles,
  MapPin,
  Grape,
  Tag,
  Info,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { getWineTypeColor } from '../../data/wineData'
import { WineValidationModal } from './WineValidationModal'
import {
  scanMenuImage,
  DetectedWine as ServiceDetectedWine,
} from '../../services/wineDetection'

type DetectedWine = ServiceDetectedWine

interface MenuScannerTabProps {
  onWinesDetected: (wines: DetectedWine[]) => void
}

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

export function MenuScannerTab({ onWinesDetected }: MenuScannerTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingStep, setProcessingStep] = useState('')
  const [detectedWines, setDetectedWines] = useState<DetectedWine[]>([])
  const [selectedWines, setSelectedWines] = useState<Set<string>>(new Set())
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [validationWine, setValidationWine] = useState<DetectedWine | null>(null)
  const [showValidationModal, setShowValidationModal] = useState(false)
  const [expandedWineId, setExpandedWineId] = useState<string | null>(null)
  const [sectionHeaders, setSectionHeaders] = useState<string[]>([])

  // Process menu image through the real backend 4-layer pipeline
  const processMenuImage = async (file: File): Promise<DetectedWine[]> => {
    // Convert file to base64
    setProcessingStep('Preparing image...')
    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        // Strip data URL prefix to get raw base64
        const base64Data = result.includes(',') ? result.split(',')[1] : result
        resolve(base64Data)
      }
      reader.readAsDataURL(file)
    })

    // Step 1: Try full backend pipeline (YOLO + OCR + Gemini + Matching)
    setProcessingStep('Running YOLOv8 detection (13-class)...')
    try {
      const result = await scanMenuImage(base64)
      if (result.wines.length > 0) {
        setSectionHeaders(result.sectionHeaders)
        return result.wines
      }
    } catch (error) {
      console.error('Menu scan failed:', error)
      setProcessingStep('Scan failed — please check your connection and try again.')
      return []
    }

    // Backend returned no wines — return empty, not fake data
    setProcessingStep('No wines detected. Try a clearer image or different angle.')
    return []
  }

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      alert('Please select an image file')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => setPreviewImage(e.target?.result as string)
    reader.readAsDataURL(file)

    setIsProcessing(true)
    try {
      const detected = await processMenuImage(file)
      setDetectedWines(detected)
      const autoSelect = new Set(detected.filter(w => w.inMasterLibrary).map(w => w.id))
      setSelectedWines(autoSelect)
      onWinesDetected(detected)
    } catch (error) {
      console.error('Failed to process menu image:', error)
      alert('Failed to detect wines from menu. Please try again.')
    } finally {
      setIsProcessing(false)
      setProcessingStep('')
    }
  }

  const toggleWineSelection = (wineId: string) => {
    const newSelection = new Set(selectedWines)
    if (newSelection.has(wineId)) newSelection.delete(wineId)
    else newSelection.add(wineId)
    setSelectedWines(newSelection)
  }

  const toggleExpanded = (wineId: string) => {
    setExpandedWineId(prev => (prev === wineId ? null : wineId))
  }

  const selectAll = () => setSelectedWines(new Set(detectedWines.map(w => w.id)))
  const deselectAll = () => setSelectedWines(new Set())

  const handleAddSelected = () => {
    const selected = detectedWines.filter(w => selectedWines.has(w.id))
    if (selected.length === 0) {
      alert('Please select at least one wine to add')
      return
    }
    const notInMaster = selected.filter(w => !w.inMasterLibrary)
    if (notInMaster.length > 0) {
      setValidationWine(notInMaster[0])
      setShowValidationModal(true)
    } else {
      alert(`Adding ${selected.length} wines to your Wine Library!`)
    }
  }

  const handleValidationApprove = (_validatedData: any) => {
    setDetectedWines(prev => prev.filter(w => w.id !== validationWine?.id))
    setSelectedWines(prev => {
      const newSet = new Set(prev)
      newSet.delete(validationWine?.id || '')
      return newSet
    })
    setValidationWine(null)
    setShowValidationModal(false)

    const remainingNotInMaster = detectedWines.filter(
      w => selectedWines.has(w.id) && !w.inMasterLibrary && w.id !== validationWine?.id,
    )
    if (remainingNotInMaster.length > 0) {
      setValidationWine(remainingNotInMaster[0])
      setShowValidationModal(true)
    }
  }

  const handleValidationReject = () => {
    if (validationWine) {
      const newSelection = new Set(selectedWines)
      newSelection.delete(validationWine.id)
      setSelectedWines(newSelection)
    }
    setValidationWine(null)
    setShowValidationModal(false)
  }

  const reset = () => {
    setDetectedWines([])
    setSelectedWines(new Set())
    setPreviewImage(null)
    setIsProcessing(false)
    setExpandedWineId(null)
    setSectionHeaders([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />

      {/* No image uploaded yet */}
      {!previewImage && !isProcessing && detectedWines.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="text-center max-w-md">
            <div className="w-20 h-20 bg-indigo-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
              <Camera className="w-10 h-10 text-indigo-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Scan Restaurant Menu</h3>
            <p className="text-gray-500 mb-6">
              AI-powered detection: identifies wines, producers, vintages, prices, regions, grapes, and more.
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-6 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2 mx-auto"
            >
              <Upload className="w-5 h-5" />
              Upload Menu Image
            </button>
            <div className="mt-6 p-4 bg-purple-50 border border-purple-100 rounded-xl">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
                <div className="text-left">
                  <p className="font-medium text-gray-900 text-sm">AI Menu Analyzer (4-Layer Pipeline)</p>
                  <p className="text-xs text-gray-600 mt-1">
                    YOLOv8 (13-class detection) + Multi-language OCR + Gemini Pro (25-field parser) + Master Library matching.
                    Supports: English, Turkish, French, Italian, Spanish, German.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Processing */}
      {isProcessing && (
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="text-center max-w-md">
            <div className="w-20 h-20 bg-indigo-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
              <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Analyzing Menu...</h3>
            <p className="text-gray-500 mb-4">{processingStep || 'Processing...'}</p>
            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex items-center gap-2 justify-center">
                <div className="w-2 h-2 bg-indigo-600 rounded-full animate-pulse" />
                <span>Layer 1: YOLOv8 region detection (13 classes)</span>
              </div>
              <div className="flex items-center gap-2 justify-center">
                <div className="w-2 h-2 bg-indigo-600 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
                <span>Layer 2: OCR + text normalization (6 languages)</span>
              </div>
              <div className="flex items-center gap-2 justify-center">
                <div className="w-2 h-2 bg-indigo-600 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
                <span>Layer 3: Gemini Pro field parsing (25 fields)</span>
              </div>
              <div className="flex items-center gap-2 justify-center">
                <div className="w-2 h-2 bg-indigo-600 rounded-full animate-pulse" style={{ animationDelay: '450ms' }} />
                <span>Layer 4: Master library matching</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {!isProcessing && detectedWines.length > 0 && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-purple-50">
            <div className="flex items-start gap-4">
              {previewImage && (
                <div className="w-32 h-32 rounded-xl overflow-hidden border-2 border-white shadow-lg flex-shrink-0">
                  <img src={previewImage} alt="Menu preview" className="w-full h-full object-cover" />
                </div>
              )}
              <div className="flex-1">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold text-gray-900 text-lg">
                      {detectedWines.length} Wines Detected
                    </h3>
                    <p className="text-sm text-gray-600">
                      {selectedWines.size} selected{' '}
                      · {detectedWines.filter(w => w.inMasterLibrary).length} in Master Library{' '}
                      · {detectedWines.filter(w => !w.inMasterLibrary).length} new
                      {sectionHeaders.length > 0 && ` · ${sectionHeaders.length} sections`}
                    </p>
                  </div>
                  <button onClick={reset} className="p-2 hover:bg-white/50 rounded-lg transition-colors">
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
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

                <div className="flex gap-2">
                  <button onClick={selectAll} className="px-3 py-1.5 text-xs font-medium text-indigo-700 bg-white border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors">
                    Select All
                  </button>
                  <button onClick={deselectAll} className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                    Deselect All
                  </button>
                  <button
                    onClick={handleAddSelected}
                    disabled={selectedWines.size === 0}
                    className="px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Selected ({selectedWines.size})
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Wine List */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-1 gap-3">
              {detectedWines.map((wine) => {
                const isSelected = selectedWines.has(wine.id)
                const isExpanded = expandedWineId === wine.id
                const typeColors = (wine.wineType || wine.type)
                  ? getWineTypeColor((wine.wineType || wine.type) as string)
                  : { bg: 'bg-gray-100', text: 'text-gray-700' }

                return (
                  <motion.div
                    key={wine.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`rounded-xl border-2 text-left transition-all ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50/50 shadow-lg'
                        : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
                    }`}
                  >
                    {/* Main row */}
                    <button
                      onClick={() => toggleWineSelection(wine.id)}
                      className="w-full p-4 text-left"
                    >
                      <div className="flex items-start gap-3">
                        <div className="pt-0.5">
                          {isSelected ? (
                            <CheckSquare className="w-5 h-5 text-indigo-600" />
                          ) : (
                            <Square className="w-5 h-5 text-gray-400" />
                          )}
                        </div>

                        <div className={`w-10 h-14 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          wine.inMasterLibrary ? 'bg-emerald-100' : 'bg-amber-100'
                        }`}>
                          <Wine className={`w-5 h-5 ${wine.inMasterLibrary ? 'text-emerald-600' : 'text-amber-600'}`} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <h4 className={`font-semibold text-sm ${isSelected ? 'text-indigo-900' : 'text-gray-900'}`}>
                              {wine.name}
                            </h4>
                            {wine.inMasterLibrary ? (
                              <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" title="In Master Library" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" title="New wine" />
                            )}
                          </div>

                          <p className="text-xs text-gray-500 mb-2">
                            {wine.producer || 'Unknown Producer'} · {wine.vintage || 'NV'}
                          </p>

                          {/* Field badges row */}
                          <div className="flex items-center gap-1.5 flex-wrap mb-2">
                            {(wine.wineType || wine.type) && (
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${typeColors.bg} ${typeColors.text}`}>
                                {wine.wineType || wine.type}
                              </span>
                            )}
                            {wine.country && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-600">
                                <MapPin className="w-2.5 h-2.5" />
                                {wine.country}
                                {wine.region && `, ${wine.region}`}
                                {wine.subRegion && ` (${wine.subRegion})`}
                              </span>
                            )}
                            {wine.grape && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-600">
                                <Grape className="w-2.5 h-2.5" />
                                {wine.grape}
                              </span>
                            )}
                            {wine.price && (
                              <span className="text-[10px] font-medium text-gray-700">
                                {wine.priceCurrency === 'EUR' ? '€' : wine.priceCurrency === 'GBP' ? '£' : wine.priceCurrency === 'TRY' ? '₺' : '$'}
                                {wine.price}
                              </span>
                            )}
                            {wine.classification && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] text-indigo-600 font-medium">
                                <Tag className="w-2.5 h-2.5" />
                                {wine.classification}
                              </span>
                            )}
                            {wine.appellation && (
                              <span className="text-[10px] text-gray-500">{wine.appellation}</span>
                            )}
                          </div>

                          {/* Confidence bar + field source badges */}
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

                            {/* Source badges */}
                            {wine.fieldSources && Object.values(wine.fieldSources).length > 0 && (
                              <div className="flex gap-0.5">
                                {[...new Set(Object.values(wine.fieldSources))].slice(0, 3).map((src, i) => (
                                  <FieldSourceBadge key={i} source={src} />
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Warnings */}
                          {wine.warnings && wine.warnings.length > 0 && (
                            <div className="mt-1.5 flex items-start gap-1 text-[10px] text-amber-700">
                              <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
                              <span>{wine.warnings[0]}{wine.warnings.length > 1 ? ` (+${wine.warnings.length - 1} more)` : ''}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </button>

                    {/* Expand/collapse toggle */}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleExpanded(wine.id) }}
                      className="w-full px-4 py-1.5 border-t border-gray-100 flex items-center justify-center gap-1 text-[10px] text-gray-500 hover:bg-gray-50 transition-colors"
                    >
                      {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      {isExpanded ? 'Less' : 'All 25 fields'}
                    </button>

                    {/* Expanded detail panel */}
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-gray-100">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5 mt-3 text-xs">
                          <FieldRow label="Producer" value={wine.producer} source={wine.fieldSources?.producer} />
                          <FieldRow label="Vintage" value={wine.vintage?.toString()} source={wine.fieldSources?.vintage} />
                          <FieldRow label="Wine Type" value={wine.wineType || wine.type} source={wine.fieldSources?.wine_type} />
                          <FieldRow label="Country" value={wine.country} source={wine.fieldSources?.country} />
                          <FieldRow label="Region" value={wine.region} source={wine.fieldSources?.region} />
                          <FieldRow label="Sub-Region" value={wine.subRegion} source={wine.fieldSources?.sub_region} />
                          <FieldRow label="Appellation" value={wine.appellation} source={wine.fieldSources?.appellation} />
                          <FieldRow label="Appellation Class" value={wine.appellationClass} source={wine.fieldSources?.appellation_class} />
                          <FieldRow label="Grape" value={wine.grape} source={wine.fieldSources?.grape_variety} />
                          <FieldRow label="Blend" value={wine.isBlend != null ? (wine.isBlend ? 'Yes' : 'No') : undefined} source={wine.fieldSources?.is_blend} />
                          <FieldRow label="Price" value={wine.price ? `${wine.priceCurrency || '$'}${wine.price}` : undefined} source={wine.fieldSources?.price} />
                          <FieldRow label="Serving" value={wine.servingType} source={wine.fieldSources?.serving_type} />
                          <FieldRow label="Body" value={wine.body} source={wine.fieldSources?.body} />
                          <FieldRow label="Sweetness" value={wine.sweetness} source={wine.fieldSources?.sweetness} />
                          <FieldRow label="ABV" value={wine.alcoholPct ? `${wine.alcoholPct}%` : undefined} source={wine.fieldSources?.alcohol_pct} />
                          <FieldRow label="Volume" value={wine.bottleVolume} source={wine.fieldSources?.bottle_volume} />
                          <FieldRow label="Rating" value={wine.rating} source={wine.fieldSources?.rating} />
                          <FieldRow label="Classification" value={wine.classification} source={wine.fieldSources?.classification} />
                          {wine.tastingNotes && (
                            <div className="col-span-2 md:col-span-3">
                              <FieldRow label="Tasting Notes" value={wine.tastingNotes} source={wine.fieldSources?.tasting_notes} />
                            </div>
                          )}
                          {wine.foodPairings && wine.foodPairings.length > 0 && (
                            <div className="col-span-2 md:col-span-3">
                              <FieldRow label="Food Pairings" value={wine.foodPairings.join(', ')} source={wine.fieldSources?.food_pairings} />
                            </div>
                          )}
                        </div>

                        {/* All warnings */}
                        {wine.warnings && wine.warnings.length > 1 && (
                          <div className="mt-3 space-y-1">
                            {wine.warnings.map((w, i) => (
                              <div key={i} className="flex items-start gap-1 text-[10px] text-amber-700">
                                <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
                                <span>{w}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </motion.div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Wine Validation Modal */}
      {validationWine && (
        <WineValidationModal
          isOpen={showValidationModal}
          onClose={() => setShowValidationModal(false)}
          wineData={{
            name: validationWine.name,
            producer: validationWine.producer || 'Unknown',
            vintage: validationWine.vintage || null,
            type: (validationWine.wineType || validationWine.type || 'red') as any,
            region: validationWine.region || 'Unknown',
            country: validationWine.country || 'Unknown',
            grape: validationWine.grape,
            price: validationWine.price,
            confidence: {
              name: validationWine.confidence,
              producer: validationWine.confidence * 0.9,
              vintage: validationWine.confidence * 0.85,
              type: validationWine.confidence * 0.95,
              region: validationWine.confidence * 0.8,
              country: validationWine.confidence * 0.9,
            },
            source: 'menu_scan',
          }}
          onApprove={handleValidationApprove}
          onReject={handleValidationReject}
        />
      )}
    </div>
  )
}

// Small helper component for the expanded field rows
function FieldRow({ label, value, source }: { label: string; value?: string | null; source?: string }) {
  if (!value) return (
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
