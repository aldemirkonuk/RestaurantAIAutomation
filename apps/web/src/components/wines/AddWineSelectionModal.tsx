import { motion, AnimatePresence } from 'framer-motion'
import { X, Wine as WineIcon, Camera, ScanText, ArrowRight, Truck, Lightbulb } from 'lucide-react'

interface AddWineSelectionModalProps {
  isOpen: boolean
  onClose: () => void
  onSelectSingle: () => void
  onSelectMenu: () => void
  /** Bulk manual receipt. Omitted on surfaces where stock isn't the point (e.g. the Wine Library). */
  onSelectReceipt?: () => void
  title?: string
  subtitle?: string
}

export function AddWineSelectionModal({
  isOpen,
  onClose,
  onSelectSingle,
  onSelectMenu,
  onSelectReceipt,
  title = 'Add Wine to Library',
  subtitle = 'Choose how to add wines',
}: AddWineSelectionModalProps) {
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
            className={`bg-white rounded-3xl shadow-2xl w-full overflow-hidden ${onSelectReceipt ? 'max-w-4xl' : 'max-w-2xl'}`}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-wine-50 to-wine-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-wine-600 rounded-xl">
                  <WineIcon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{title}</h2>
                  <p className="text-sm text-gray-500">{subtitle}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/50 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Options */}
            <div className={`p-6 grid grid-cols-1 gap-4 ${onSelectReceipt ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
              {/* Single Wine Scanner */}
              <button
                onClick={() => {
                  onSelectSingle()
                  onClose()
                }}
                className="group relative p-6 rounded-2xl border-2 border-wine-200 hover:border-wine-500 bg-gradient-to-br from-wine-50 to-white hover:shadow-xl transition-all text-left"
              >
                <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="p-1.5 bg-wine-600 rounded-full">
                    <ArrowRight className="w-4 h-4 text-white" />
                  </div>
                </div>
                
                <div className="w-14 h-14 bg-wine-100 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Camera className="w-7 h-7 text-wine-600" />
                </div>
                
                <h3 className="text-lg font-bold text-gray-900 mb-2">Single Wine</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Scan one wine label at a time using your camera or upload an image
                </p>
                
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 bg-wine-100 text-wine-700 text-xs font-medium rounded-full">
                    Default
                  </span>
                  <span className="text-xs text-gray-500">• Quick & precise</span>
                </div>
              </button>

              {/* Menu Scanner */}
              <button
                onClick={() => {
                  onSelectMenu()
                  onClose()
                }}
                className="group relative p-6 rounded-2xl border-2 border-indigo-200 hover:border-indigo-500 bg-gradient-to-br from-indigo-50 to-white hover:shadow-xl transition-all text-left"
              >
                <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="p-1.5 bg-indigo-600 rounded-full">
                    <ArrowRight className="w-4 h-4 text-white" />
                  </div>
                </div>
                
                <div className="w-14 h-14 bg-indigo-100 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <ScanText className="w-7 h-7 text-indigo-600" />
                </div>
                
                <h3 className="text-lg font-bold text-gray-900 mb-2">Menu Scanner</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Upload your restaurant menu and detect multiple wines at once
                </p>
                
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 bg-indigo-100 text-indigo-700 text-xs font-medium rounded-full">
                    AI Powered
                  </span>
                  <span className="text-xs text-gray-500">• Bulk import</span>
                </div>
              </button>

              {/* Manual bulk receipt */}
              {onSelectReceipt && (
                <button
                  onClick={() => {
                    onSelectReceipt()
                    onClose()
                  }}
                  className="group relative p-6 rounded-2xl border-2 border-emerald-200 hover:border-emerald-500 bg-gradient-to-br from-emerald-50 to-white hover:shadow-xl transition-all text-left"
                >
                  <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="p-1.5 bg-emerald-600 rounded-full">
                      <ArrowRight className="w-4 h-4 text-white" />
                    </div>
                  </div>

                  <div className="w-14 h-14 bg-emerald-100 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <Truck className="w-7 h-7 text-emerald-600" />
                  </div>

                  <h3 className="text-lg font-bold text-gray-900 mb-2">Receive a delivery</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Many wines at once with quantity, cost and location per line — no purchase order needed
                  </p>

                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-full">
                      Spreadsheet
                    </span>
                    <span className="text-xs text-gray-500">• Free samples too</span>
                  </div>
                </button>
              )}
            </div>

            {/* Info Footer */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
              <p className="text-xs text-gray-500 text-center inline-flex items-center justify-center gap-1.5 w-full">
                <Lightbulb size={14} aria-hidden="true" className="shrink-0" />
                Tip: Both methods automatically check for duplicates and cross-reference with the Master Wine Library
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

