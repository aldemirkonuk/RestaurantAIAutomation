import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Loader2,
  CheckCircle2,
  ArrowLeft,
  Sparkles,
  Wine,
  AlertTriangle,
  PackagePlus,
} from 'lucide-react'
import { CameraCapture } from './CameraCapture'
import { ScanResultsPanel } from './ScanResultsPanel'
import { scanMenuImage, DetectedWine } from '../../services/wineDetection'
import {
  BatchReceiveGrid,
  batchRowsToBulkLines,
  batchTotals,
  validateBatchRows,
  type BatchReceiveRow,
} from '../inventory/BatchReceiveGrid'
import {
  detectedWinesToBatchRows,
  mergePersistResults,
  persistBatchToInventory,
  summarizeMenuScanPersist,
  type MenuScannerPersistResult,
} from '../../lib/menuScannerPersistence'

/** Single source of truth for the step order — the header copy and the dots both read it. */
const FLOW_STEPS = ['capture', 'processing', 'results', 'stock-setup', 'done'] as const
type FlowStep = (typeof FLOW_STEPS)[number]

interface MenuScannerFlowProps {
  isOpen: boolean
  onClose: () => void
  /**
   * Fired after the batch has actually been written to inventory. The result is
   * passed so the host can report it honestly instead of persisting a second time.
   */
  onWinesAdded?: (wines: DetectedWine[], result?: MenuScannerPersistResult) => void
  restaurantId?: string
}

const PROCESSING_STEPS = [
  { label: 'RF-DETR region detection (live boxes)', delay: 0 },
  { label: 'PaddleOCR text + layout (on shutter)', delay: 150 },
  { label: 'Gemini field parsing (wine schema)', delay: 300 },
  { label: 'Master Wine Library matching', delay: 450 },
]

export function MenuScannerFlow({ isOpen, onClose, onWinesAdded, restaurantId }: MenuScannerFlowProps) {
  const [step, setStep] = useState<FlowStep>('capture')
  const [processingStepText, setProcessingStepText] = useState('')
  const [detectedWines, setDetectedWines] = useState<DetectedWine[]>([])
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [sectionHeaders, setSectionHeaders] = useState<string[]>([])
  const [acceptedWines, setAcceptedWines] = useState<DetectedWine[]>([])
  const [stockRows, setStockRows] = useState<BatchReceiveRow[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [persistResult, setPersistResult] = useState<MenuScannerPersistResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setStep('capture')
    setDetectedWines([])
    setPreviewImage(null)
    setSectionHeaders([])
    setAcceptedWines([])
    setStockRows([])
    setPersistResult(null)
    setError(null)
    setProcessingStepText('')
  }

  const processImage = useCallback(async (imageBase64: string) => {
    setStep('processing')
    setError(null)

    try {
      // Step 1: YOLO detection
      setProcessingStepText('Detecting regions (RF-DETR target stack)...')
      
      const result = await scanMenuImage(imageBase64, restaurantId)
      
      if (result.wines.length > 0) {
        setDetectedWines(result.wines)
        setSectionHeaders(result.sectionHeaders)
        setStep('results')
      } else {
        setError('No wines were detected in the image. Please try a different image or angle.')
        setStep('capture')
      }
    } catch (err) {
      console.error('Scan failed:', err)
      setError('Failed to process the image. Please check your connection and try again.')
      setStep('capture')
    }
  }, [restaurantId])

  const handleCameraCapture = useCallback((imageBase64: string) => {
    // Store preview from base64
    setPreviewImage(`data:image/jpeg;base64,${imageBase64}`)
    processImage(imageBase64)
  }, [processImage])

  const handleFileUpload = useCallback((imageBase64: string) => {
    setPreviewImage(`data:image/jpeg;base64,${imageBase64}`)
    processImage(imageBase64)
  }, [processImage])

  const handleConfirmWines = useCallback((accepted: DetectedWine[]) => {
    setAcceptedWines(accepted)
    setStockRows(detectedWinesToBatchRows(accepted))
    setError(null)
    setStep('stock-setup')
  }, [])

  const handleSaveStock = useCallback(async () => {
    if (isSaving || stockRows.length === 0) return
    setIsSaving(true)
    setError(null)
    try {
      const result = await persistBatchToInventory(
        batchRowsToBulkLines(stockRows),
        { source: 'menu_scan' },
      )
      setPersistResult((prev) => (prev ? mergePersistResults(prev, result) : result))
      onWinesAdded?.(acceptedWines, result)

      if (result.failed.length === 0) {
        setStockRows([])
        setStep('done')
        return
      }
      // Keep only what didn't land, carrying the server's reason on the row, so the
      // manager can fix and resubmit instead of losing the lines.
      const failedByIndex = new Map(result.failed.map((f) => [f.index, f]))
      setStockRows((rows) =>
        rows
          .map((row, index) => ({ ...row, error: failedByIndex.get(index)?.error ?? 'Could not be saved' }))
          .filter((_, index) => failedByIndex.has(index)),
      )
      setError(
        `${summarizeMenuScanPersist(result)} — the rows below were not saved. Fix them and save again.`,
      )
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Could not save these wines. Check your connection and try again.')
    } finally {
      setIsSaving(false)
    }
  }, [isSaving, stockRows, acceptedWines, onWinesAdded])

  const handleRescan = useCallback(() => {
    reset()
  }, [])

  const stockIssues = validateBatchRows(stockRows)
  const stockSummary = batchTotals(stockRows)
  const savedCount = persistResult
    ? persistResult.added.length + persistResult.stockAdded.length + persistResult.reactivated.length
    : 0

  if (!isOpen) return null

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl h-[88vh] overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-purple-50 flex-shrink-0">
              <div className="flex items-center gap-3">
                {step !== 'capture' && step !== 'done' && (
                  <button
                    onClick={
                      step === 'results' ? handleRescan
                        : step === 'stock-setup' ? () => setStep('results')
                          : undefined
                    }
                    className="p-1.5 hover:bg-white/50 rounded-lg transition-colors"
                    disabled={step === 'processing' || isSaving}
                  >
                    <ArrowLeft className="w-5 h-5 text-gray-500" />
                  </button>
                )}
                <div>
                  <h2 className="text-xl font-bold text-gray-900">
                    {step === 'capture' && 'Menu Scanner'}
                    {step === 'processing' && 'Analyzing Menu...'}
                    {step === 'results' && 'Scan Results'}
                    {step === 'stock-setup' && `Batch setup — ${stockRows.length} wine${stockRows.length !== 1 ? 's' : ''}`}
                    {step === 'done' && 'Wines Added'}
                  </h2>
                  <p className="text-sm text-gray-500">
                    {step === 'capture' && 'Capture or upload your wine menu for AI analysis'}
                    {step === 'processing' && 'Running capture pipeline (OCR on shutter, not live frames)'}
                    {step === 'results' && 'Review and confirm detected wines'}
                    {step === 'stock-setup' && 'How many, what they cost, and where they live'}
                    {step === 'done' && summarizeMenuScanPersist(persistResult ?? { added: [], stockAdded: [], reactivated: [], provisional: [], failed: [] })}
                  </p>
                </div>
              </div>

              {/* Step indicator */}
              <div className="flex items-center gap-4">
                <div className="hidden sm:flex items-center gap-2">
                  {FLOW_STEPS.map((s, i) => (
                    <div key={s} className="flex items-center gap-1">
                      <div className={`w-2 h-2 rounded-full transition-all ${
                        step === s ? 'bg-indigo-600 scale-125' :
                        (FLOW_STEPS.indexOf(step) > i) ? 'bg-indigo-400' :
                        'bg-gray-300'
                      }`} />
                      {i < FLOW_STEPS.length - 1 && <div className="w-4 h-px bg-gray-300" />}
                    </div>
                  ))}
                </div>
                <button onClick={onClose} className="p-2 hover:bg-white/50 rounded-lg transition-colors">
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {/* Step: Capture */}
              {step === 'capture' && (
                <div className="flex-1 overflow-hidden">
                  {error && (
                    <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-start gap-2">
                      <span className="flex-shrink-0 mt-0.5">&#9888;</span>
                      <span>{error}</span>
                      <button onClick={() => setError(null)} className="ml-auto flex-shrink-0">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  <CameraCapture
                    onCapture={handleCameraCapture}
                    onFileUpload={handleFileUpload}
                    enableLiveDetection={true}
                  />
                </div>
              )}

              {/* Step: Processing */}
              {step === 'processing' && (
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="text-center max-w-md"
                  >
                    {previewImage && (
                      <div className="w-40 h-40 rounded-2xl overflow-hidden mx-auto mb-6 border-4 border-indigo-100 shadow-lg relative">
                        <img src={previewImage} alt="Scanning" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-indigo-600/20 flex items-center justify-center">
                          <Loader2 className="w-10 h-10 text-white animate-spin" />
                        </div>
                      </div>
                    )}

                    <h3 className="text-xl font-semibold text-gray-900 mb-2">Analyzing Menu...</h3>
                    <p className="text-gray-500 mb-6">{processingStepText || 'Processing...'}</p>

                    <div className="space-y-3 text-left">
                      {PROCESSING_STEPS.map((pStep, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: pStep.delay / 1000 }}
                          className="flex items-center gap-3"
                        >
                          <div className="w-2 h-2 bg-indigo-600 rounded-full animate-pulse" style={{ animationDelay: `${pStep.delay}ms` }} />
                          <span className="text-sm text-gray-600">Layer {i + 1}: {pStep.label}</span>
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                </div>
              )}

              {/* Step: Results */}
              {step === 'results' && (
                <ScanResultsPanel
                  wines={detectedWines}
                  previewImage={previewImage}
                  sectionHeaders={sectionHeaders}
                  onConfirm={handleConfirmWines}
                  onRescan={handleRescan}
                />
              )}

              {/* Step: Stock setup */}
              {step === 'stock-setup' && (
                <div className="flex-1 min-h-0 flex flex-col p-4">
                  {error && (
                    <div className="mb-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </div>
                  )}
                  <BatchReceiveGrid
                    rows={stockRows}
                    onChange={setStockRows}
                    disabled={isSaving}
                    className="flex-1 min-h-0"
                    emptyState={
                      <p className="text-sm text-gray-400">
                        Every detected wine was removed from this batch. Go back to review to pick some again.
                      </p>
                    }
                  />
                  <div className="flex items-center justify-between gap-3 pt-3 flex-shrink-0">
                    <button
                      onClick={() => setStep('results')}
                      disabled={isSaving}
                      className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50"
                    >
                      Back to review
                    </button>
                    <button
                      onClick={handleSaveStock}
                      disabled={isSaving || stockRows.length === 0 || stockIssues.length > 0}
                      className="px-5 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2 disabled:opacity-50 disabled:shadow-none"
                    >
                      {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackagePlus className="w-4 h-4" />}
                      {isSaving
                        ? 'Adding to inventory…'
                        : `Add ${stockSummary.bottles} bottle${stockSummary.bottles !== 1 ? 's' : ''} to inventory`}
                    </button>
                  </div>
                </div>
              )}

              {/* Step: Done */}
              {step === 'done' && (
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                    className="text-center max-w-md"
                  >
                    <div className="w-20 h-20 bg-emerald-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                      <CheckCircle2 className="w-10 h-10 text-emerald-600" />
                    </div>
                    <h3 className="text-2xl font-bold text-gray-900 mb-2">
                      {savedCount} Wine{savedCount !== 1 ? 's' : ''} in Inventory
                    </h3>
                    <p className="text-gray-500 mb-2">
                      {persistResult && persistResult.stockAdded.length > 0
                        ? `${persistResult.added.length} new row${persistResult.added.length !== 1 ? 's' : ''}, ${persistResult.stockAdded.length} restocked onto wines you already carried.`
                        : 'Stock is live. You can view and manage it from the Inventory page.'}
                    </p>
                    {persistResult && persistResult.provisional.length > 0 && (
                      <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mb-6">
                        {persistResult.provisional.length} wine{persistResult.provisional.length !== 1 ? 's were' : ' was'} not in the
                        Master Wine Library, so {persistResult.provisional.length !== 1 ? 'provisional entries were' : 'a provisional entry was'} created.
                        Worth reviewing in the Wine Library later.
                      </p>
                    )}
                    {(!persistResult || persistResult.provisional.length === 0) && <div className="mb-4" />}
                    <div className="flex gap-3 justify-center">
                      <button
                        onClick={reset}
                        className="px-5 py-2.5 text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-xl hover:bg-indigo-100 transition-colors flex items-center gap-2"
                      >
                        <Sparkles className="w-4 h-4" />
                        Scan Another Menu
                      </button>
                      <button
                        onClick={onClose}
                        className="px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-colors flex items-center gap-2"
                      >
                        <Wine className="w-4 h-4" />
                        Done
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
