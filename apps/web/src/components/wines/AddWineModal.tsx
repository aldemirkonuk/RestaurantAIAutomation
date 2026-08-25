/**
 * ADD WINE MODAL with Image Identifier Agent
 * 
 * Features:
 * - Upload image or use camera
 * - AI agent identifies wine from label
 * - Displays detected wine details in structured sections
 * - Allows manual editing before saving
 */

import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Upload,
  Camera,
  Loader2,
  Check,
  Wine,
  MapPin,
  Grape,
  Sparkles,
  Edit3,
  Save,
  Scan,
} from 'lucide-react'
import { SCAN_ACCEPT } from '../../lib/uploadAccept'

interface WineDetectionResult {
  confidence: number
  name: string
  producer: string
  vintage: number | null
  type: 'red' | 'white' | 'sparkling' | 'rose' | 'dessert'
  grape: string
  country: string
  region: string
  appellation: string
  body: string
  sweetness: string
  acidity: string
  alcohol: number | null
  aromas: string[]
  flavors: string[]
  description: string
  suggestedPrice: number | null
}

interface AddWineModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (wine: WineDetectionResult) => void
  zIndex?: number
  inline?: boolean // If true, renders without modal wrapper
}

// Mock AI detection results
const mockDetectionResults: Record<string, WineDetectionResult> = {
  default: {
    confidence: 94,
    name: 'Château Latour 2010',
    producer: 'Château Latour',
    vintage: 2010,
    type: 'red',
    grape: 'Cabernet Sauvignon, Merlot, Cabernet Franc, Petit Verdot',
    country: 'France',
    region: 'Bordeaux',
    appellation: 'Pauillac AOC, Premier Grand Cru Classé',
    body: 'Full',
    sweetness: 'Dry',
    acidity: 'Medium-High',
    alcohol: 13.5,
    aromas: ['Blackcurrant', 'Graphite', 'Cedar', 'Tobacco', 'Violet'],
    flavors: ['Dark fruit', 'Mineral', 'Spice', 'Leather'],
    description: 'A legendary First Growth Bordeaux known for its power, depth, and extraordinary aging potential. Dense and concentrated with firm tannins.',
    suggestedPrice: 1200,
  },
}

export function AddWineModal({ isOpen, onClose, onSave, zIndex = 50 }: AddWineModalProps) {
  const [step, setStep] = useState<'upload' | 'scanning' | 'result' | 'editing'>('upload')
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [detectionResult, setDetectionResult] = useState<WineDetectionResult | null>(null)
  const [editedResult, setEditedResult] = useState<WineDetectionResult | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      setSelectedImage(e.target?.result as string)
      startDetection()
    }
    reader.readAsDataURL(file)
  }

  const startDetection = async () => {
    setStep('scanning')
    
    // Simulate AI processing
    await new Promise(resolve => setTimeout(resolve, 3000))
    
    // Return mock result
    const result = mockDetectionResults.default
    setDetectionResult(result)
    setEditedResult(result)
    setStep('result')
  }

  const handleSave = () => {
    if (editedResult) {
      onSave(editedResult)
      handleClose()
    }
  }

  const handleClose = () => {
    setStep('upload')
    setSelectedImage(null)
    setDetectionResult(null)
    setEditedResult(null)
    setIsEditing(false)
    onClose()
  }

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'red': return 'bg-rose-100 text-rose-700'
      case 'white': return 'bg-amber-100 text-amber-700'
      case 'sparkling': return 'bg-yellow-100 text-yellow-700'
      case 'rose': return 'bg-pink-100 text-pink-700'
      case 'dessert': return 'bg-orange-100 text-orange-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
        style={{ zIndex }}
        onClick={handleClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-wine-100 rounded-xl flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-wine-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Add Wine</h2>
                <p className="text-sm text-gray-500">
                  {step === 'upload' && 'Upload an image to identify the wine'}
                  {step === 'scanning' && 'Analyzing wine label...'}
                  {step === 'result' && 'Wine detected! Review details below'}
                  {step === 'editing' && 'Edit wine details'}
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="overflow-y-auto max-h-[calc(90vh-140px)]">
            {/* Upload Step */}
            {step === 'upload' && (
              <div className="p-6 space-y-6">
                {/* Upload Area */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-2xl p-12 text-center cursor-pointer hover:border-wine-500 hover:bg-wine-50/50 transition-all"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={SCAN_ACCEPT}
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <div className="w-16 h-16 bg-gray-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                    <Upload className="w-8 h-8 text-gray-400" />
                  </div>
                  <p className="text-lg font-medium text-gray-900 mb-2">Upload Wine Label Image</p>
                  <p className="text-sm text-gray-500 mb-4">
                    Drag and drop or click to select an image
                  </p>
                  <p className="text-xs text-gray-400">
                    Supports: JPG, PNG, HEIC • Max 10MB
                  </p>
                </div>

                {/* Or Camera */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200" />
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-4 bg-white text-gray-500">or</span>
                  </div>
                </div>

                <button
                  onClick={() => {
                    // In real app, this would trigger camera
                    fileInputRef.current?.click()
                  }}
                  className="w-full flex items-center justify-center gap-3 py-4 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  <Camera className="w-5 h-5 text-gray-600" />
                  <span className="font-medium text-gray-700">Use Camera</span>
                </button>

                {/* AI Agent Info */}
                <div className="p-4 bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl border border-purple-100">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Scan className="w-4 h-4 text-purple-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Image Identifier Agent</p>
                      <p className="text-sm text-gray-600 mt-1">
                        Our AI will analyze the wine label and automatically fill in all details including 
                        producer, vintage, region, grape varieties, and tasting notes.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Scanning Step */}
            {step === 'scanning' && (
              <div className="p-12 text-center">
                <div className="relative w-32 h-32 mx-auto mb-6">
                  {selectedImage && (
                    <img
                      src={selectedImage}
                      alt="Uploaded wine"
                      className="w-full h-full object-cover rounded-2xl"
                    />
                  )}
                  <div className="absolute inset-0 bg-black/40 rounded-2xl flex items-center justify-center">
                    <div className="relative">
                      <div className="w-16 h-16 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                      <Scan className="w-6 h-6 text-white absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                    </div>
                  </div>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Analyzing Wine Label</h3>
                <p className="text-gray-500">
                  The AI is reading the label and searching for wine information...
                </p>
                <div className="mt-6 space-y-2">
                  <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Detecting text on label...</span>
                  </div>
                </div>
              </div>
            )}

            {/* Result Step */}
            {(step === 'result' || step === 'editing') && detectionResult && (
              <div className="p-6 space-y-6">
                {/* Detection Status */}
                <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
                    <Check className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-emerald-900">Wine Detected!</p>
                    <p className="text-sm text-emerald-700">
                      Confidence: {detectionResult.confidence}%
                    </p>
                  </div>
                  <button
                    onClick={() => setIsEditing(!isEditing)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                      isEditing 
                        ? 'bg-wine-600 text-white' 
                        : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <Edit3 className="w-4 h-4" />
                    {isEditing ? 'Editing' : 'Edit'}
                  </button>
                </div>

                {/* Wine Details Sections */}
                <div className="space-y-4">
                  {/* Basic Info */}
                  <div className="bg-gray-50 rounded-xl p-4 space-y-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wide">
                      <Wine className="w-4 h-4" />
                      Wine Detected
                    </div>
                    
                    <div className="grid gap-3">
                      <div>
                        <label className="text-xs text-gray-500 uppercase">Name</label>
                        {isEditing ? (
                          <input
                            type="text"
                            value={editedResult?.name || ''}
                            onChange={(e) => setEditedResult(prev => prev ? {...prev, name: e.target.value} : null)}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg mt-1"
                          />
                        ) : (
                          <p className="text-lg font-bold text-gray-900">{detectionResult.name}</p>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-gray-500 uppercase">Producer</label>
                          {isEditing ? (
                            <input
                              type="text"
                              value={editedResult?.producer || ''}
                              onChange={(e) => setEditedResult(prev => prev ? {...prev, producer: e.target.value} : null)}
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg mt-1"
                            />
                          ) : (
                            <p className="font-medium text-gray-900">{detectionResult.producer}</p>
                          )}
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 uppercase">Vintage</label>
                          {isEditing ? (
                            <input
                              type="number"
                              value={editedResult?.vintage || ''}
                              onChange={(e) => setEditedResult(prev => prev ? {...prev, vintage: parseInt(e.target.value)} : null)}
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg mt-1"
                            />
                          ) : (
                            <p className="font-medium text-gray-900">{detectionResult.vintage || 'NV'}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Classification */}
                  <div className="bg-gray-50 rounded-xl p-4 space-y-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wide">
                      <MapPin className="w-4 h-4" />
                      Classifications
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-gray-500 uppercase">Type</label>
                        <div className="mt-1">
                          <span className={`px-3 py-1 rounded-full text-sm font-medium ${getTypeColor(detectionResult.type)}`}>
                            {detectionResult.type.charAt(0).toUpperCase() + detectionResult.type.slice(1)}
                          </span>
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 uppercase">Grape Variety</label>
                        <p className="font-medium text-gray-900 text-sm">{detectionResult.grape}</p>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 uppercase">Country</label>
                        <p className="font-medium text-gray-900">{detectionResult.country}</p>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 uppercase">Region</label>
                        <p className="font-medium text-gray-900">{detectionResult.region}</p>
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs text-gray-500 uppercase">Appellation</label>
                        <p className="font-medium text-gray-900">{detectionResult.appellation}</p>
                      </div>
                    </div>
                  </div>

                  {/* Wine Structure */}
                  <div className="bg-gray-50 rounded-xl p-4 space-y-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wide">
                      <Grape className="w-4 h-4" />
                      Wine Structure
                    </div>
                    
                    <div className="grid grid-cols-4 gap-3">
                      <div className="text-center p-3 bg-white rounded-lg">
                        <p className="text-xs text-gray-500 uppercase">Body</p>
                        <p className="font-semibold text-gray-900">{detectionResult.body}</p>
                      </div>
                      <div className="text-center p-3 bg-white rounded-lg">
                        <p className="text-xs text-gray-500 uppercase">Sweetness</p>
                        <p className="font-semibold text-gray-900">{detectionResult.sweetness}</p>
                      </div>
                      <div className="text-center p-3 bg-white rounded-lg">
                        <p className="text-xs text-gray-500 uppercase">Acidity</p>
                        <p className="font-semibold text-gray-900">{detectionResult.acidity}</p>
                      </div>
                      <div className="text-center p-3 bg-white rounded-lg">
                        <p className="text-xs text-gray-500 uppercase">Alcohol</p>
                        <p className="font-semibold text-gray-900">{detectionResult.alcohol}%</p>
                      </div>
                    </div>
                  </div>

                  {/* Sensory Profile */}
                  <div className="bg-gray-50 rounded-xl p-4 space-y-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wide">
                      <Sparkles className="w-4 h-4" />
                      Sensory Profile
                    </div>
                    
                    <div>
                      <label className="text-xs text-gray-500 uppercase">Aromas</label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {detectionResult.aromas.map((aroma, i) => (
                          <span key={i} className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm">
                            {aroma}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 uppercase">Flavors</label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {detectionResult.flavors.map((flavor, i) => (
                          <span key={i} className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
                            {flavor}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Description */}
                  <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                    <label className="text-xs text-gray-500 uppercase">Description</label>
                    {isEditing ? (
                      <textarea
                        value={editedResult?.description || ''}
                        onChange={(e) => setEditedResult(prev => prev ? {...prev, description: e.target.value} : null)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg min-h-[100px]"
                      />
                    ) : (
                      <p className="text-gray-700">{detectionResult.description}</p>
                    )}
                  </div>

                  {/* Suggested Price */}
                  <div className="bg-wine-50 border border-wine-200 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-xs text-wine-600 uppercase font-semibold">Suggested Price</label>
                        {isEditing ? (
                          <input
                            type="number"
                            value={editedResult?.suggestedPrice || ''}
                            onChange={(e) => setEditedResult(prev => prev ? {...prev, suggestedPrice: parseInt(e.target.value)} : null)}
                            className="w-full px-3 py-2 border border-wine-200 rounded-lg mt-1"
                          />
                        ) : (
                          <p className="text-3xl font-bold text-wine-800">${detectionResult.suggestedPrice?.toLocaleString()}</p>
                        )}
                      </div>
                      <Wine className="w-8 h-8 text-wine-300" />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          {(step === 'result' || step === 'editing') && (
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between bg-gray-50">
              <button
                onClick={() => {
                  setStep('upload')
                  setSelectedImage(null)
                  setDetectionResult(null)
                }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium"
              >
                Scan Another
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-2 px-6 py-3 bg-wine-600 text-white font-semibold rounded-xl hover:bg-wine-700 shadow-lg shadow-wine-600/30 transition-all"
              >
                <Save className="w-5 h-5" />
                Add to Library
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

