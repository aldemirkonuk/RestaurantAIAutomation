/**
 * PreviewCanvas - Preview Component
 * Renders the preview layout with visual diff indicators
 */

import { motion } from 'framer-motion'

interface PreviewCanvasProps {
  zoom?: number
  isInteractive?: boolean
  children: React.ReactNode
  className?: string
}

export function PreviewCanvas({
  zoom = 100,
  isInteractive = false,
  children,
  className = '',
}: PreviewCanvasProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`relative w-full h-full overflow-auto ${className}`}
    >
      <div
        className="min-h-full bg-gray-50 p-6"
        style={{
          transform: `scale(${zoom / 100})`,
          transformOrigin: 'top center',
          transition: 'transform 0.2s ease-out',
        }}
      >
        {/* Preview Border Glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 border-4 border-blue-400/30 rounded-2xl shadow-[0_0_50px_rgba(59,130,246,0.3)]" />
        </div>

        {/* Preview Content */}
        <div className={`relative ${isInteractive ? '' : 'pointer-events-none'}`}>
          {children}
        </div>

        {/* Preview Label */}
        <div className="absolute top-8 right-8 bg-blue-600 text-white px-4 py-2 rounded-full shadow-lg font-semibold text-sm">
          Preview Mode
        </div>
      </div>
    </motion.div>
  )
}
