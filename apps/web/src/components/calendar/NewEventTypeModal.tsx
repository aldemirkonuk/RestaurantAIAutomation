import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Check,
  Star,
  AlertCircle,
  Sparkles,
} from 'lucide-react'
import { addCustomEventType, isEventTypeNameAvailable, EVENT_TYPE_COLORS } from '../../data/customEventTypes'
import { Button } from '../ui'

interface NewEventTypeModalProps {
  onClose: () => void
  onSuccess: (eventTypeName: string, color: string) => void
}

export function NewEventTypeModal({ onClose, onSuccess }: NewEventTypeModalProps) {
  const [eventTypeName, setEventTypeName] = useState('')
  const [selectedColor, setSelectedColor] = useState<string>(EVENT_TYPE_COLORS[0].value)
  const [error, setError] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const handleCreate = async () => {
    setError('')

    // Validate name
    if (!eventTypeName.trim()) {
      setError('Please enter an event type name')
      return
    }

    if (eventTypeName.length < 3) {
      setError('Event type name must be at least 3 characters')
      return
    }

    if (eventTypeName.length > 30) {
      setError('Event type name must be less than 30 characters')
      return
    }

    // Check if name is available
    if (!isEventTypeNameAvailable(eventTypeName)) {
      setError('An event type with this name already exists')
      return
    }

    setIsCreating(true)

    try {
      // Get current user (in production, this would come from auth context)
      const currentUser = localStorage.getItem('userEmail') || 'manager@restaurant.com'

      addCustomEventType({
        name: eventTypeName.trim(),
        color: selectedColor,
        icon: 'Star', // For now, all custom events use Star icon
        createdBy: currentUser,
      })

      // Success
      onSuccess(eventTypeName.trim(), selectedColor)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event type')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[300] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        >
          {/* Header */}
          <div className="px-6 py-4 bg-gradient-to-r from-purple-600 to-indigo-600">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-lg">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <h2 className="text-lg font-bold text-white">Create Custom Event Type</h2>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>

          {/* Form */}
          <div className="p-6 space-y-5">
            {/* Error Message */}
            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            {/* Event Type Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Event Type Name
              </label>
              <input
                type="text"
                value={eventTypeName}
                onChange={(e) => {
                  setEventTypeName(e.target.value)
                  setError('')
                }}
                placeholder="e.g., Social Media, Staff Training, Marketing..."
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                autoFocus
              />
              <p className="mt-1 text-xs text-gray-500">
                Choose a descriptive name for your custom event type
              </p>
            </div>

            {/* Color Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Color
              </label>
              <div className="grid grid-cols-6 gap-2">
                {EVENT_TYPE_COLORS.map((color) => (
                  <button
                    key={color.value}
                    onClick={() => setSelectedColor(color.value)}
                    className={`h-10 rounded-lg transition-all hover:scale-105 ${
                      selectedColor === color.value
                        ? 'ring-2 ring-offset-2 ring-gray-400'
                        : ''
                    }`}
                    style={{ backgroundColor: color.value }}
                    title={color.name}
                  />
                ))}
              </div>
            </div>

            {/* Preview */}
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-xs font-medium text-gray-500 mb-2">Preview</p>
              <div className="flex items-center gap-3">
                <div
                  className="p-2.5 rounded-lg"
                  style={{ backgroundColor: `${selectedColor}20` }}
                >
                  <Star className="w-5 h-5" style={{ color: selectedColor }} />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">
                    {eventTypeName || 'Event Type Name'}
                  </p>
                  <p className="text-xs text-gray-500">Custom Calendar Event</p>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={isCreating}>
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={handleCreate}
              disabled={!eventTypeName.trim() || isCreating}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {isCreating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Creating...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Create Event Type
                </>
              )}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

