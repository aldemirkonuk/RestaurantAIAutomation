import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Sparkles,
  Calendar,
  Check,
  AlertCircle,
  ChevronRight,
} from 'lucide-react'
import { ExtractedDateMention } from '../../utils/aiDateContext'

interface AIDateExtractionAlertProps {
  extractions: ExtractedDateMention[]
  onAccept: (extraction: ExtractedDateMention) => void
  onDismiss: (extraction: ExtractedDateMention) => void
  onDismissAll: () => void
}

export function AIDateExtractionAlert({
  extractions,
  onAccept,
  onDismiss,
  onDismissAll,
}: AIDateExtractionAlertProps) {
  const [currentIndex, setCurrentIndex] = useState(0)

  useEffect(() => {
    if (currentIndex >= extractions.length) {
      setCurrentIndex(Math.max(0, extractions.length - 1))
    }
  }, [extractions.length, currentIndex])

  if (extractions.length === 0) return null

  const current = extractions[currentIndex]
  const hasMultiple = extractions.length > 1

  const handleAccept = () => {
    onAccept(current)
    if (currentIndex < extractions.length - 1) {
      setCurrentIndex(prev => prev + 1)
    }
  }

  const handleDismiss = () => {
    onDismiss(current)
    if (currentIndex < extractions.length - 1) {
      setCurrentIndex(prev => prev + 1)
    }
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Unknown date'
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    } catch {
      return dateStr
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        className="fixed top-4 right-4 z-50 w-96 bg-white rounded-2xl shadow-2xl border border-purple-100 overflow-hidden"
      >
        {/* Header */}
        <div className="px-4 py-3 bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-purple-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-purple-100 rounded-lg">
              <Sparkles className="w-4 h-4 text-purple-600" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-900">AI Detected Date</h4>
              {hasMultiple && (
                <p className="text-xs text-gray-500">
                  {currentIndex + 1} of {extractions.length} suggestions
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onDismissAll}
            className="p-1.5 hover:bg-white/50 rounded-lg transition-colors"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Extracted Text */}
          <div className="mb-3 p-3 bg-gray-50 rounded-xl">
            <p className="text-xs text-gray-500 mb-1">Found in communication:</p>
            <p className="text-sm text-gray-700 italic">"{current.text}"</p>
          </div>

          {/* Suggested Date Info */}
          <div className="space-y-2 mb-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-purple-500" />
              <span className="text-sm font-medium text-gray-900">
                {current.suggestedTitle || 'Important Date'}
              </span>
            </div>
            <div className="flex items-center gap-2 pl-6">
              <span className="text-sm text-gray-600">
                {formatDate(current.suggestedDate)}
              </span>
              {current.suggestedType && (
                <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs font-medium rounded-full">
                  {current.suggestedType}
                </span>
              )}
            </div>
            {/* Confidence indicator */}
            <div className="flex items-center gap-2 pl-6">
              <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-purple-500 rounded-full"
                  style={{ width: `${current.confidence * 100}%` }}
                />
              </div>
              <span className="text-xs text-gray-500">
                {Math.round(current.confidence * 100)}% confident
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleAccept}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 transition-colors"
            >
              <Check className="w-4 h-4" />
              Add to Calendar
            </button>
            <button
              onClick={handleDismiss}
              className="px-4 py-2.5 text-gray-600 hover:bg-gray-100 rounded-xl font-medium transition-colors"
            >
              Skip
            </button>
          </div>

          {/* Navigation for multiple */}
          {hasMultiple && (
            <div className="mt-3 flex items-center justify-center gap-1">
              {extractions.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentIndex(idx)}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    idx === currentIndex ? 'bg-purple-500' : 'bg-gray-200 hover:bg-gray-300'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

/**
 * Hook to manage AI date extraction state
 */
export function useAIDateExtraction() {
  const [extractions, setExtractions] = useState<ExtractedDateMention[]>([])

  const addExtraction = (extraction: ExtractedDateMention) => {
    setExtractions(prev => [...prev, extraction])
  }

  const addExtractions = (newExtractions: ExtractedDateMention[]) => {
    setExtractions(prev => [...prev, ...newExtractions])
  }

  const removeExtraction = (extraction: ExtractedDateMention) => {
    setExtractions(prev => prev.filter(e => e.text !== extraction.text))
  }

  const clearExtractions = () => {
    setExtractions([])
  }

  return {
    extractions,
    addExtraction,
    addExtractions,
    removeExtraction,
    clearExtractions,
  }
}
