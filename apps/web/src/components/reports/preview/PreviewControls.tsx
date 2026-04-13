/**
 * PreviewControls - Preview Component
 * Floating action bar for preview mode
 */

import { Check, X, RotateCcw, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'

interface PreviewControlsProps {
  onApply: () => void
  onCancel: () => void
  onReset?: () => void
  zoom?: number
  onZoomChange?: (zoom: number) => void
  hasChanges?: boolean
  className?: string
}

export function PreviewControls({
  onApply,
  onCancel,
  onReset,
  zoom = 100,
  onZoomChange,
  hasChanges = true,
  className = '',
}: PreviewControlsProps) {
  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] ${className}`}>
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 p-3 flex items-center gap-3">
        {/* Zoom Controls */}
        {onZoomChange && (
          <div className="flex items-center gap-2 px-3 border-r border-gray-200">
            <button
              onClick={() => onZoomChange(Math.max(50, zoom - 10))}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4 text-gray-600" />
            </button>
            <span className="text-sm font-medium text-gray-700 min-w-[3rem] text-center">
              {zoom}%
            </span>
            <button
              onClick={() => onZoomChange(Math.min(150, zoom + 10))}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4 text-gray-600" />
            </button>
            <button
              onClick={() => onZoomChange(100)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Fit to Screen"
            >
              <Maximize2 className="w-4 h-4 text-gray-600" />
            </button>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {onReset && (
            <button
              onClick={onReset}
              className="flex items-center gap-2 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
          )}

          <button
            onClick={onCancel}
            className="flex items-center gap-2 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition-colors"
          >
            <X className="w-4 h-4" />
            Cancel
          </button>

          <button
            onClick={onApply}
            disabled={!hasChanges}
            className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium transition-colors ${
              hasChanges
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            <Check className="w-4 h-4" />
            Apply Changes
          </button>
        </div>
      </div>

      {/* Keyboard Shortcuts Hint */}
      <div className="mt-2 text-center">
        <p className="text-xs text-white/80 bg-black/50 px-3 py-1 rounded-full inline-block">
          Press <kbd className="px-1.5 py-0.5 bg-white/20 rounded">ESC</kbd> to cancel •{' '}
          <kbd className="px-1.5 py-0.5 bg-white/20 rounded">Enter</kbd> to apply
        </p>
      </div>
    </div>
  )
}
