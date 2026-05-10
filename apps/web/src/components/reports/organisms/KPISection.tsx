/**
 * KPISection - Organism Component
 * Grid of KPI cards with drag-and-drop
 */

import { useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import { Plus, Check, EyeOff, LucideIcon } from 'lucide-react'
import { KPICard, KPICardData, KPIValue } from '../molecules'

interface KPIOption {
  key: string
  title: string
  icon: LucideIcon
  description: string
}

interface KPISectionProps {
  cards: KPICardData[]
  getKPIValue: (key: string) => KPIValue
  availableOptions: KPIOption[]
  isEditMode: boolean
  onReorder: (cards: KPICardData[]) => void
  onAdd: (key: string) => void
  onEdit: (cardId: string, newKey: string) => void
  onDelete: (cardId: string) => void
  onReset: () => void
  className?: string
}

export function KPISection({
  cards,
  getKPIValue,
  availableOptions,
  isEditMode,
  onReorder,
  onAdd,
  onEdit,
  onDelete,
  onReset,
  className = '',
}: KPISectionProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [editingCardId, setEditingCardId] = useState<string | null>(null)
  const [showAddKPIModal, setShowAddKPIModal] = useState(false)
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null)

  const handleLongPressStart = useCallback(() => {
    const timer = setTimeout(() => {
      if (navigator.vibrate) {
        navigator.vibrate(50)
      }
    }, 500)
    setLongPressTimer(timer)
  }, [])

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      setLongPressTimer(null)
    }
  }, [longPressTimer])

  const getKPIGridClass = useMemo(() => {
    const visibleCount = cards.filter((c) => c.visible).length
    if (visibleCount <= 3) return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
    if (visibleCount === 4) return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'
    if (visibleCount === 5) return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-5'
    if (visibleCount === 6) return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
    if (visibleCount === 7) return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'
    if (visibleCount === 8) return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'
    return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5'
  }, [cards])

  return (
    <div className={className}>
      {/* Floating Add KPI Button in Edit Mode */}
      {isEditMode && (
        <div className="relative">
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={() => setShowAddKPIModal(true)}
            className="absolute -top-2 -right-2 z-20 w-10 h-10 bg-wine-600 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-wine-700 transition-colors"
            title="Add KPI Card"
          >
            <Plus className="w-5 h-5" />
          </motion.button>
        </div>
      )}

      <Reorder.Group
        axis="x"
        values={cards}
        onReorder={onReorder}
        className={`grid ${getKPIGridClass} gap-4`}
      >
        {cards
          .filter((card) => card.visible)
          .map((card) => {
            const kpiData = getKPIValue(card.key)

            return (
              <Reorder.Item
                key={card.id}
                value={card}
                onDragStart={() => setIsDragging(true)}
                onDragEnd={() => setIsDragging(false)}
                whileDrag={{ scale: 1.05, boxShadow: '0 20px 40px rgba(0,0,0,0.2)', zIndex: 50 }}
                className={`cursor-grab active:cursor-grabbing ${isEditMode ? 'edit-mode-glow' : ''}`}
              >
                <KPICard
                  card={card}
                  value={kpiData}
                  isEditMode={isEditMode}
                  isDragging={isDragging}
                  onEdit={() => setEditingCardId(card.id)}
                  onDelete={() => onDelete(card.id)}
                  onLongPressStart={handleLongPressStart}
                  onLongPressEnd={handleLongPressEnd}
                />
              </Reorder.Item>
            )
          })}
      </Reorder.Group>

      {/* Show message if all cards are hidden */}
      {cards.filter((c) => c.visible).length === 0 && (
        <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl p-8 text-center">
          <EyeOff className="w-8 h-8 text-gray-400 mx-auto mb-2" />
          <p className="text-gray-600 font-medium">All KPI cards are hidden</p>
          <button
            onClick={onReset}
            className="mt-2 text-wine-600 hover:text-wine-700 text-sm font-medium"
          >
            Reset to show all
          </button>
        </div>
      )}

      {/* KPI Content Selector Modal */}
      <AnimatePresence>
        {editingCardId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setEditingCardId(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="px-6 py-4 border-b bg-gradient-to-r from-wine-50 to-rose-50">
                <h3 className="text-lg font-bold text-gray-900">Choose KPI Metric</h3>
                <p className="text-sm text-gray-500">Select what this card should display</p>
              </div>
              <div className="p-4 max-h-[60vh] overflow-y-auto">
                <div className="grid grid-cols-1 gap-2">
                  {availableOptions.map((option) => {
                    const OptionIcon = option.icon
                    const currentCard = cards.find((c) => c.id === editingCardId)
                    const isSelected = currentCard?.key === option.key

                    return (
                      <button
                        key={option.key}
                        onClick={() => {
                          onEdit(editingCardId, option.key)
                          setEditingCardId(null)
                        }}
                        className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left ${
                          isSelected
                            ? 'border-wine-500 bg-wine-50'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <div className={`p-3 rounded-xl ${isSelected ? 'bg-wine-200' : 'bg-gray-100'}`}>
                          <OptionIcon className={`w-5 h-5 ${isSelected ? 'text-wine-700' : 'text-gray-600'}`} />
                        </div>
                        <div className="flex-1">
                          <p className={`font-semibold ${isSelected ? 'text-wine-700' : 'text-gray-900'}`}>
                            {option.title}
                          </p>
                          <p className="text-sm text-gray-500">{option.description}</p>
                        </div>
                        {isSelected && <Check className="w-5 h-5 text-wine-600" />}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="px-6 py-4 border-t bg-gray-50">
                <button
                  onClick={() => setEditingCardId(null)}
                  className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add KPI Modal */}
      <AnimatePresence>
        {showAddKPIModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowAddKPIModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="px-6 py-4 border-b bg-gradient-to-r from-wine-50 to-rose-50">
                <h3 className="text-lg font-bold text-gray-900">Add KPI Card</h3>
                <p className="text-sm text-gray-500">Select a metric to add to your dashboard</p>
              </div>
              <div className="p-4 max-h-[60vh] overflow-y-auto">
                <div className="grid grid-cols-1 gap-2">
                  {availableOptions.map((option) => {
                    const OptionIcon = option.icon
                    const existingCard = cards.find((c) => c.key === option.key)
                    const isVisible = existingCard?.visible
                    const isHidden = existingCard && !existingCard.visible

                    return (
                      <button
                        key={option.key}
                        onClick={() => {
                          onAdd(option.key)
                          setShowAddKPIModal(false)
                        }}
                        disabled={isVisible}
                        className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left ${
                          isVisible
                            ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
                            : isHidden
                              ? 'border-amber-300 bg-amber-50 hover:border-amber-400'
                              : 'border-gray-200 hover:border-wine-300 hover:bg-wine-50'
                        }`}
                      >
                        <div
                          className={`p-3 rounded-xl ${
                            isVisible ? 'bg-gray-200' : isHidden ? 'bg-amber-200' : 'bg-gray-100'
                          }`}
                        >
                          <OptionIcon
                            className={`w-5 h-5 ${
                              isVisible ? 'text-gray-400' : isHidden ? 'text-amber-700' : 'text-gray-600'
                            }`}
                          />
                        </div>
                        <div className="flex-1">
                          <p
                            className={`font-semibold ${
                              isVisible ? 'text-gray-400' : isHidden ? 'text-amber-700' : 'text-gray-900'
                            }`}
                          >
                            {option.title}
                          </p>
                          <p className="text-sm text-gray-500">{option.description}</p>
                        </div>
                        {isVisible && <span className="text-xs text-gray-400 font-medium">Already visible</span>}
                        {isHidden && <span className="text-xs text-amber-600 font-medium">Restore</span>}
                        {!existingCard && <Plus className="w-5 h-5 text-wine-600" />}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="px-6 py-4 border-t bg-gray-50">
                <button
                  onClick={() => setShowAddKPIModal(false)}
                  className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export type { KPIOption }
