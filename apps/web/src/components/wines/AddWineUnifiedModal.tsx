import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Wine as WineIcon, FileText } from 'lucide-react'
import { Wine as WineType } from '../../data/wineData'
import { AddWineModal } from './AddWineModal'
import { MenuScannerTab } from './MenuScannerTab'

interface AddWineUnifiedModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (wine: Partial<WineType>) => void
  existingWines: WineType[] // For duplicate detection
}

type TabType = 'single' | 'menu'

export function AddWineUnifiedModal({ isOpen, onClose, onSave, existingWines }: AddWineUnifiedModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('single')
  const [showSingleModal, setShowSingleModal] = useState(false)

  // When tab changes to single, show the AddWineModal, close unified modal
  useEffect(() => {
    if (isOpen && activeTab === 'single') {
      setShowSingleModal(true)
      onClose() // Close unified modal
    }
  }, [activeTab, isOpen, onClose])

  if (!isOpen) return null

  const handleWinesDetected = (detectedWines: any[]) => {
    console.log('Wines detected from menu:', detectedWines)
    
    // Check for duplicates
    detectedWines.forEach(detected => {
      const isDuplicate = existingWines.some(existing => 
        existing.name.toLowerCase() === detected.name.toLowerCase() &&
        existing.vintage === detected.vintage
      )
      
      if (isDuplicate) {
        console.warn(`Duplicate detected: ${detected.name} (${detected.vintage})`)
      }
    })
  }

  const handleSaveWithDuplicateCheck = (wine: Partial<WineType>) => {
    // Check for duplicates before saving
    const isDuplicate = existingWines.some(existing => 
      existing.name.toLowerCase() === wine.name?.toLowerCase() &&
      existing.vintage === wine.vintage
    )
    
    if (isDuplicate) {
      const confirmOverwrite = window.confirm(
        `A wine named "${wine.name}" (${wine.vintage || 'NV'}) already exists in your library.\n\nDo you want to add it anyway?`
      )
      if (!confirmOverwrite) return
    }
    
    onSave(wine)
  }

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
            className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
          >
            {/* Header with Tabs */}
            <div className="flex flex-col border-b border-gray-100 bg-gradient-to-r from-wine-50 to-wine-100">
              <div className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-wine-600 rounded-xl">
                    <WineIcon className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">Add Wine to Library</h2>
                    <p className="text-sm text-gray-500">Choose how to add wines</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-white/50 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              {/* Tab Navigation */}
              <div className="flex gap-2 px-6 pb-4">
                <button
                  onClick={() => setActiveTab('single')}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
                    activeTab === 'single'
                      ? 'bg-wine-600 text-white shadow-lg shadow-wine-600/30'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <WineIcon className="w-4 h-4" />
                  Single Wine
                  {activeTab === 'single' && (
                    <span className="ml-1 px-2 py-0.5 bg-white/20 rounded-full text-xs">Default</span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('menu')}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
                    activeTab === 'menu'
                      ? 'bg-wine-600 text-white shadow-lg shadow-wine-600/30'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <FileText className="w-4 h-4" />
                  Menu Scanner
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
              {activeTab === 'menu' ? (
                <MenuScannerTab
                  onWinesDetected={(wines) => {
                    // Filter out duplicates and show notification
                    const newWines = wines.filter(detected => {
                      const isDuplicate = existingWines.some(existing =>
                        existing.name.toLowerCase() === detected.name.toLowerCase() &&
                        existing.vintage === detected.vintage
                      )
                      return !isDuplicate
                    })
                    
                    const duplicateCount = wines.length - newWines.length
                    if (duplicateCount > 0) {
                      alert(`ℹ️ ${duplicateCount} wine(s) are already in your library and will be skipped.`)
                    }
                    
                    handleWinesDetected(newWines)
                    
                    // Auto-add wines that are in master library
                    const masterLibraryWines = newWines.filter(w => w.inMasterLibrary)
                    if (masterLibraryWines.length > 0) {
                      // TODO: Implement batch add to wine library
                      console.log('Auto-adding wines from master library:', masterLibraryWines)
                    }
                  }}
                />
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

