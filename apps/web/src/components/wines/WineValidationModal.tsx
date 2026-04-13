import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  AlertCircle,
  CheckCircle,
  Edit3,
  Save,
  Sparkles,
  Wine,
  MapPin,
  Calendar,
  DollarSign,
  Tag,
  AlertTriangle,
} from 'lucide-react'

interface WineDetails {
  name: string
  producer: string
  vintage: number | null
  type: 'red' | 'white' | 'sparkling' | 'rose' | 'dessert'
  region: string
  country: string
  grape?: string
  price?: number
  alcohol?: number
}

interface WineValidationData extends WineDetails {
  confidence?: {
    name?: number
    producer?: number
    vintage?: number
    type?: number
    region?: number
    country?: number
    grape?: number
    price?: number
  }
  source: 'ai_detection' | 'external_api' | 'manual' | 'menu_scan'
}

interface WineValidationModalProps {
  isOpen: boolean
  onClose: () => void
  wineData: WineValidationData
  onApprove: (validatedData: WineDetails) => void
  onReject: () => void
}

export function WineValidationModal({ 
  isOpen, 
  onClose, 
  wineData, 
  onApprove, 
  onReject 
}: WineValidationModalProps) {
  const [editMode, setEditMode] = useState(false)
  const [editedData, setEditedData] = useState<WineDetails>({
    name: wineData.name,
    producer: wineData.producer,
    vintage: wineData.vintage,
    type: wineData.type,
    region: wineData.region,
    country: wineData.country,
    grape: wineData.grape || '',
    price: wineData.price || 0,
    alcohol: wineData.alcohol || 0,
  })

  const [validationErrors, setValidationErrors] = useState<{[key: string]: string}>({})

  // Get confidence color
  const getConfidenceColor = (confidence?: number) => {
    if (!confidence) return 'bg-gray-100 text-gray-600'
    if (confidence >= 0.9) return 'bg-emerald-100 text-emerald-700'
    if (confidence >= 0.7) return 'bg-yellow-100 text-yellow-700'
    return 'bg-rose-100 text-rose-700'
  }

  const getConfidenceLabel = (confidence?: number) => {
    if (!confidence) return 'Unknown'
    if (confidence >= 0.9) return 'High'
    if (confidence >= 0.7) return 'Medium'
    return 'Low'
  }

  // Get source badge
  const getSourceBadge = () => {
    switch (wineData.source) {
      case 'ai_detection':
        return { label: 'AI Label Detection', color: 'bg-purple-100 text-purple-700', icon: Sparkles }
      case 'external_api':
        return { label: 'External Database', color: 'bg-blue-100 text-blue-700', icon: CheckCircle }
      case 'menu_scan':
        return { label: 'Menu Scan', color: 'bg-indigo-100 text-indigo-700', icon: Sparkles }
      case 'manual':
        return { label: 'Manual Entry', color: 'bg-gray-100 text-gray-700', icon: Edit3 }
    }
  }

  // Validate data
  const validate = (): boolean => {
    const errors: {[key: string]: string} = {}

    if (!editedData.name || editedData.name.length < 3) {
      errors.name = 'Name must be at least 3 characters'
    }
    if (!editedData.producer) {
      errors.producer = 'Producer is required'
    }
    if (editedData.vintage && (editedData.vintage < 1900 || editedData.vintage > new Date().getFullYear())) {
      errors.vintage = 'Invalid vintage year'
    }
    if (!editedData.type) {
      errors.type = 'Wine type is required'
    }

    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  // Handle approve
  const handleApprove = () => {
    if (editMode) {
      if (!validate()) return
      onApprove(editedData)
    } else {
      onApprove({
        name: wineData.name,
        producer: wineData.producer,
        vintage: wineData.vintage,
        type: wineData.type,
        region: wineData.region,
        country: wineData.country,
        grape: wineData.grape,
        price: wineData.price,
        alcohol: wineData.alcohol,
      })
    }
    handleClose()
  }

  const handleClose = () => {
    setEditMode(false)
    setValidationErrors({})
    onClose()
  }

  if (!isOpen) return null

  const sourceBadge = getSourceBadge()
  const SourceIcon = sourceBadge.icon

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
          className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-wine-50 to-purple-50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-wine-600 rounded-xl">
                <Wine className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Validate Wine Details</h2>
                <p className="text-sm text-gray-500">Review and confirm wine information</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-white/50 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Source Badge */}
          <div className="px-6 pt-4">
            <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl ${sourceBadge.color}`}>
              <SourceIcon className="w-4 h-4" />
              <span className="text-sm font-medium">{sourceBadge.label}</span>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-4">
              {/* Name */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Wine Name <span className="text-rose-500">*</span>
                  </label>
                  {wineData.confidence?.name && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getConfidenceColor(wineData.confidence.name)}`}>
                      {getConfidenceLabel(wineData.confidence.name)} ({Math.round(wineData.confidence.name * 100)}%)
                    </span>
                  )}
                </div>
                {editMode ? (
                  <input
                    type="text"
                    value={editedData.name}
                    onChange={(e) => setEditedData({ ...editedData, name: e.target.value })}
                    className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-wine-500 ${validationErrors.name ? 'border-rose-500' : 'border-gray-200'}`}
                    placeholder="Enter wine name"
                  />
                ) : (
                  <p className="text-lg font-semibold text-gray-900">{wineData.name}</p>
                )}
                {validationErrors.name && (
                  <p className="text-sm text-rose-600 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    {validationErrors.name}
                  </p>
                )}
              </div>

              {/* Producer */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Producer <span className="text-rose-500">*</span>
                  </label>
                  {wineData.confidence?.producer && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getConfidenceColor(wineData.confidence.producer)}`}>
                      {getConfidenceLabel(wineData.confidence.producer)} ({Math.round(wineData.confidence.producer * 100)}%)
                    </span>
                  )}
                </div>
                {editMode ? (
                  <input
                    type="text"
                    value={editedData.producer}
                    onChange={(e) => setEditedData({ ...editedData, producer: e.target.value })}
                    className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-wine-500 ${validationErrors.producer ? 'border-rose-500' : 'border-gray-200'}`}
                    placeholder="Enter producer name"
                  />
                ) : (
                  <p className="text-lg font-semibold text-gray-900">{wineData.producer}</p>
                )}
                {validationErrors.producer && (
                  <p className="text-sm text-rose-600 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    {validationErrors.producer}
                  </p>
                )}
              </div>

              {/* Two columns: Vintage and Type */}
              <div className="grid grid-cols-2 gap-4">
                {/* Vintage */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700 flex items-center gap-1">
                      <Calendar className="w-4 h-4" />
                      Vintage
                    </label>
                    {wineData.confidence?.vintage && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getConfidenceColor(wineData.confidence.vintage)}`}>
                        {Math.round(wineData.confidence.vintage * 100)}%
                      </span>
                    )}
                  </div>
                  {editMode ? (
                    <input
                      type="number"
                      value={editedData.vintage || ''}
                      onChange={(e) => setEditedData({ ...editedData, vintage: e.target.value ? parseInt(e.target.value) : null })}
                      className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-wine-500 ${validationErrors.vintage ? 'border-rose-500' : 'border-gray-200'}`}
                      placeholder="e.g., 2019"
                      min={1900}
                      max={new Date().getFullYear()}
                    />
                  ) : (
                    <p className="text-lg font-semibold text-gray-900">{wineData.vintage || 'NV'}</p>
                  )}
                  {validationErrors.vintage && (
                    <p className="text-xs text-rose-600 mt-1">{validationErrors.vintage}</p>
                  )}
                </div>

                {/* Type */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700 flex items-center gap-1">
                      <Tag className="w-4 h-4" />
                      Type <span className="text-rose-500">*</span>
                    </label>
                    {wineData.confidence?.type && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getConfidenceColor(wineData.confidence.type)}`}>
                        {Math.round(wineData.confidence.type * 100)}%
                      </span>
                    )}
                  </div>
                  {editMode ? (
                    <select
                      value={editedData.type}
                      onChange={(e) => setEditedData({ ...editedData, type: e.target.value as any })}
                      className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-wine-500 ${validationErrors.type ? 'border-rose-500' : 'border-gray-200'}`}
                    >
                      <option value="red">Red</option>
                      <option value="white">White</option>
                      <option value="sparkling">Sparkling</option>
                      <option value="rose">Rosé</option>
                      <option value="dessert">Dessert</option>
                    </select>
                  ) : (
                    <p className="text-lg font-semibold text-gray-900 capitalize">{wineData.type}</p>
                  )}
                  {validationErrors.type && (
                    <p className="text-xs text-rose-600 mt-1">{validationErrors.type}</p>
                  )}
                </div>
              </div>

              {/* Region and Country */}
              <div className="grid grid-cols-2 gap-4">
                {/* Region */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700 flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      Region
                    </label>
                    {wineData.confidence?.region && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getConfidenceColor(wineData.confidence.region)}`}>
                        {Math.round(wineData.confidence.region * 100)}%
                      </span>
                    )}
                  </div>
                  {editMode ? (
                    <input
                      type="text"
                      value={editedData.region}
                      onChange={(e) => setEditedData({ ...editedData, region: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500"
                      placeholder="e.g., Napa Valley"
                    />
                  ) : (
                    <p className="text-lg font-semibold text-gray-900">{wineData.region}</p>
                  )}
                </div>

                {/* Country */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">Country</label>
                    {wineData.confidence?.country && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getConfidenceColor(wineData.confidence.country)}`}>
                        {Math.round(wineData.confidence.country * 100)}%
                      </span>
                    )}
                  </div>
                  {editMode ? (
                    <input
                      type="text"
                      value={editedData.country}
                      onChange={(e) => setEditedData({ ...editedData, country: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500"
                      placeholder="e.g., USA"
                    />
                  ) : (
                    <p className="text-lg font-semibold text-gray-900">{wineData.country}</p>
                  )}
                </div>
              </div>

              {/* Optional: Grape Variety and Price */}
              <div className="grid grid-cols-2 gap-4">
                {/* Grape */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">Grape Variety</label>
                    {wineData.confidence?.grape && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getConfidenceColor(wineData.confidence.grape)}`}>
                        {Math.round(wineData.confidence.grape * 100)}%
                      </span>
                    )}
                  </div>
                  {editMode ? (
                    <input
                      type="text"
                      value={editedData.grape || ''}
                      onChange={(e) => setEditedData({ ...editedData, grape: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500"
                      placeholder="e.g., Cabernet Sauvignon"
                    />
                  ) : (
                    <p className="text-lg font-semibold text-gray-900">{wineData.grape || 'N/A'}</p>
                  )}
                </div>

                {/* Price */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700 flex items-center gap-1">
                      <DollarSign className="w-4 h-4" />
                      Price (USD)
                    </label>
                    {wineData.confidence?.price && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getConfidenceColor(wineData.confidence.price)}`}>
                        {Math.round(wineData.confidence.price * 100)}%
                      </span>
                    )}
                  </div>
                  {editMode ? (
                    <input
                      type="number"
                      value={editedData.price || ''}
                      onChange={(e) => setEditedData({ ...editedData, price: e.target.value ? parseFloat(e.target.value) : undefined })}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500"
                      placeholder="e.g., 45.99"
                      min={0}
                      step={0.01}
                    />
                  ) : (
                    <p className="text-lg font-semibold text-gray-900">{wineData.price ? `$${wineData.price}` : 'N/A'}</p>
                  )}
                </div>
              </div>

              {/* Warning if low confidence */}
              {Object.values(wineData.confidence || {}).some(c => c && c < 0.7) && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-amber-900 text-sm">Low Confidence Detected</p>
                    <p className="text-xs text-amber-700 mt-1">
                      Some fields have low confidence scores. Please review carefully or edit before approving.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
            <div className="flex gap-3">
              <button
                onClick={onReject}
                className="px-6 py-3 border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-100 transition-colors"
              >
                Reject
              </button>
              {!editMode ? (
                <>
                  <button
                    onClick={() => setEditMode(true)}
                    className="px-6 py-3 border border-wine-200 text-wine-700 font-medium rounded-xl hover:bg-wine-50 transition-colors flex items-center gap-2"
                  >
                    <Edit3 className="w-4 h-4" />
                    Edit & Approve
                  </button>
                  <button
                    onClick={handleApprove}
                    className="flex-1 py-3 bg-wine-600 text-white font-semibold rounded-xl hover:bg-wine-700 shadow-lg shadow-wine-600/30 transition-all flex items-center justify-center gap-2"
                  >
                    <CheckCircle className="w-5 h-5" />
                    Approve All
                  </button>
                </>
              ) : (
                <button
                  onClick={handleApprove}
                  className="flex-1 py-3 bg-wine-600 text-white font-semibold rounded-xl hover:bg-wine-700 shadow-lg shadow-wine-600/30 transition-all flex items-center justify-center gap-2"
                >
                  <Save className="w-5 h-5" />
                  Save & Approve
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

