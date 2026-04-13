import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Loader2,
  CheckCircle2,
  ArrowLeft,
  Sparkles,
  Wine,
} from 'lucide-react'
import { CameraCapture } from './CameraCapture'
import { ScanResultsPanel } from './ScanResultsPanel'
import { scanMenuImage, DetectedWine } from '../../services/wineDetection'

type FlowStep = 'capture' | 'processing' | 'results' | 'done'

interface MenuScannerFlowProps {
  isOpen: boolean
  onClose: () => void
  onWinesAdded?: (wines: DetectedWine[]) => void
  restaurantId?: string
}

const PROCESSING_STEPS = [
  { label: 'YOLOv8 region detection (13 classes)', delay: 0 },
  { label: 'Multi-language OCR extraction', delay: 150 },
  { label: 'Gemini Pro field parsing (25 fields)', delay: 300 },
  { label: 'Master Wine Library matching', delay: 450 },
]

export function MenuScannerFlow({ isOpen, onClose, onWinesAdded, restaurantId }: MenuScannerFlowProps) {
  const [step, setStep] = useState<FlowStep>('capture')
  const [processingStepText, setProcessingStepText] = useState('')
  const [detectedWines, setDetectedWines] = useState<DetectedWine[]>([])
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [sectionHeaders, setSectionHeaders] = useState<string[]>([])
  const [addedCount, setAddedCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setStep('capture')
    setDetectedWines([])
    setPreviewImage(null)
    setSectionHeaders([])
    setAddedCount(0)
    setError(null)
    setProcessingStepText('')
  }

  const processImage = useCallback(async (imageBase64: string) => {
    setStep('processing')
    setError(null)

    try {
      // Step 1: YOLO detection
      setProcessingStepText('Running YOLOv8 detection (13-class)...')
      
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

  const handleConfirmWines = useCallback((acceptedWines: DetectedWine[]) => {
    setAddedCount(acceptedWines.length)
    setStep('done')
    onWinesAdded?.(acceptedWines)
  }, [onWinesAdded])

  const handleRescan = useCallback(() => {
    reset()
  }, [])

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
            className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl h-[85vh] overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-purple-50 flex-shrink-0">
              <div className="flex items-center gap-3">
                {step !== 'capture' && step !== 'done' && (
                  <button
                    onClick={step === 'results' ? handleRescan : undefined}
                    className="p-1.5 hover:bg-white/50 rounded-lg transition-colors"
                    disabled={step === 'processing'}
                  >
                    <ArrowLeft className="w-5 h-5 text-gray-500" />
                  </button>
                )}
                <div>
                  <h2 className="text-xl font-bold text-gray-900">
                    {step === 'capture' && 'Menu Scanner'}
                    {step === 'processing' && 'Analyzing Menu...'}
                    {step === 'results' && 'Scan Results'}
                    {step === 'done' && 'Wines Added'}
                  </h2>
                  <p className="text-sm text-gray-500">
                    {step === 'capture' && 'Capture or upload your wine menu for AI analysis'}
                    {step === 'processing' && 'Running 4-layer AI detection pipeline'}
                    {step === 'results' && 'Review and confirm detected wines'}
                    {step === 'done' && `${addedCount} wines added to your inventory`}
                  </p>
                </div>
              </div>

              {/* Step indicator */}
              <div className="flex items-center gap-4">
                <div className="hidden sm:flex items-center gap-2">
                  {(['capture', 'processing', 'results', 'done'] as FlowStep[]).map((s, i) => (
                    <div key={s} className="flex items-center gap-1">
                      <div className={`w-2 h-2 rounded-full transition-all ${
                        step === s ? 'bg-indigo-600 scale-125' :
                        (['capture', 'processing', 'results', 'done'].indexOf(step) > i) ? 'bg-indigo-400' :
                        'bg-gray-300'
                      }`} />
                      {i < 3 && <div className="w-4 h-px bg-gray-300" />}
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
                      {addedCount} Wine{addedCount !== 1 ? 's' : ''} Added!
                    </h3>
                    <p className="text-gray-500 mb-6">
                      Wines have been added to your inventory. You can view and manage them from the Inventory page.
                    </p>
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
