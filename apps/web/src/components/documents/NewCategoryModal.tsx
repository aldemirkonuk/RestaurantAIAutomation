import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Check,
  FileText,
  Package,
  DollarSign,
  TrendingUp,
  BarChart3,
  PieChart,
  Mail,
  Calendar,
  Wine,
  Truck,
  Users,
  Clock,
  Star,
  Tag,
  Folder,
  BookOpen,
  AlertCircle,
} from 'lucide-react'
import { addUserCategory, isCategoryNameAvailable, CATEGORY_COLORS, type CategoryIcon } from '../../data/userTemplateCategories'
import { Button } from '../ui'

interface NewCategoryModalProps {
  onClose: () => void
  onSuccess: (categoryName: string) => void
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  FileText,
  Package,
  DollarSign,
  TrendingUp,
  BarChart3,
  PieChart,
  Mail,
  Calendar,
  Wine,
  Truck,
  Users,
  Clock,
  Star,
  Tag,
  Folder,
  BookOpen,
}

export function NewCategoryModal({ onClose, onSuccess }: NewCategoryModalProps) {
  const [categoryName, setCategoryName] = useState('')
  const [selectedIcon, setSelectedIcon] = useState<CategoryIcon>('FileText')
  const [selectedColor, setSelectedColor] = useState(CATEGORY_COLORS[0].value)
  const [error, setError] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const handleCreate = async () => {
    setError('')

    // Validate name
    if (!categoryName.trim()) {
      setError('Please enter a category name')
      return
    }

    if (categoryName.length < 3) {
      setError('Category name must be at least 3 characters')
      return
    }

    if (categoryName.length > 30) {
      setError('Category name must be less than 30 characters')
      return
    }

    // Check if name is available
    if (!isCategoryNameAvailable(categoryName)) {
      setError('A category with this name already exists')
      return
    }

    setIsCreating(true)

    try {
      // Get current user (in production, this would come from auth context)
      const currentUser = localStorage.getItem('userEmail') || 'manager@restaurant.com'

      addUserCategory({
        name: categoryName.trim(),
        color: selectedColor,
        icon: selectedIcon,
        createdBy: currentUser,
      })

      // Success
      onSuccess(categoryName.trim())
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create category')
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
          <div className="px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-lg">
                  <Tag className="w-5 h-5 text-white" />
                </div>
                <h2 className="text-lg font-bold text-white">Create Category</h2>
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

            {/* Category Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Category Name
              </label>
              <input
                type="text"
                value={categoryName}
                onChange={(e) => {
                  setCategoryName(e.target.value)
                  setError('')
                }}
                placeholder="e.g., Reports, Promotions, Analytics..."
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
              />
              <p className="mt-1 text-xs text-gray-500">
                Choose a unique name for your custom category
              </p>
            </div>

            {/* Icon Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Icon
              </label>
              <div className="grid grid-cols-8 gap-2">
                {Object.entries(ICON_MAP).map(([iconName, IconComponent]) => (
                  <button
                    key={iconName}
                    onClick={() => setSelectedIcon(iconName as CategoryIcon)}
                    className={`p-2.5 rounded-lg border-2 transition-all hover:scale-105 ${
                      selectedIcon === iconName
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    title={iconName}
                  >
                    <IconComponent className="w-5 h-5 mx-auto text-gray-700" />
                  </button>
                ))}
              </div>
            </div>

            {/* Color Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Color
              </label>
              <div className="grid grid-cols-6 gap-2">
                {CATEGORY_COLORS.map((color) => (
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
                  {(() => {
                    const IconComponent = ICON_MAP[selectedIcon]
                    return <IconComponent className="w-5 h-5" style={{ color: selectedColor }} />
                  })()}
                </div>
                <div>
                  <p className="font-semibold text-gray-900">
                    {categoryName || 'Category Name'}
                  </p>
                  <p className="text-xs text-gray-500">Email Template Category</p>
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
              disabled={!categoryName.trim() || isCreating}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isCreating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Creating...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Create Category
                </>
              )}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

