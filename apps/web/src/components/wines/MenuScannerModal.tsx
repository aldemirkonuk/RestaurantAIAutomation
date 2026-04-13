import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { MenuScannerTab } from './MenuScannerTab'

interface MenuScannerModalProps {
  isOpen: boolean
  onClose: () => void
  onWinesDetected: (wines: any[]) => void
}

export function MenuScannerModal({ isOpen, onClose, onWinesDetected }: MenuScannerModalProps) {
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
            className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl h-[80vh] overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-purple-50">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Menu Scanner</h2>
                <p className="text-sm text-gray-500">Upload your menu to detect multiple wines at once</p>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/50 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Content */}
            <MenuScannerTab onWinesDetected={onWinesDetected} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

