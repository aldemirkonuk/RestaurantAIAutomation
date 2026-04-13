/**
 * PreviewOverlay - Preview Component
 * Main preview container with overlay UI
 */

import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { PreviewCanvas } from './PreviewCanvas'
import { PreviewControls } from './PreviewControls'

interface PreviewOverlayProps {
  isActive: boolean
  onApply: () => void
  onCancel: () => void
  onReset?: () => void
  zoom?: number
  onZoomChange?: (zoom: number) => void
  hasChanges?: boolean
  isInteractive?: boolean
  children: React.ReactNode
  className?: string
}

export function PreviewOverlay({
  isActive,
  onApply,
  onCancel,
  onReset,
  zoom = 100,
  onZoomChange,
  hasChanges = true,
  isInteractive = false,
  children,
  className = '',
}: PreviewOverlayProps) {
  // Keyboard shortcuts
  useEffect(() => {
    if (!isActive) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      } else if (e.key === 'Enter' && hasChanges) {
        e.preventDefault()
        onApply()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isActive, onApply, onCancel, hasChanges])

  // Prevent body scroll when active
  useEffect(() => {
    if (isActive) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isActive])

  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={`fixed inset-0 z-50 ${className}`}
        >
          {/* Semi-transparent backdrop */}
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onCancel} />

          {/* Preview Canvas */}
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full h-full max-w-[95vw] max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden">
              <PreviewCanvas zoom={zoom} isInteractive={isInteractive}>
                {children}
              </PreviewCanvas>
            </div>
          </div>

          {/* Floating Controls */}
          <PreviewControls
            onApply={onApply}
            onCancel={onCancel}
            onReset={onReset}
            zoom={zoom}
            onZoomChange={onZoomChange}
            hasChanges={hasChanges}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
