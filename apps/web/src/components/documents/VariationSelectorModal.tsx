import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  BarChart3,
  PieChart,
  LineChart,
  Table,
  DollarSign,
  TrendingUp,
  Type,
  Mail,
  Check,
  Sparkles,
} from 'lucide-react'
import { Button } from '../ui'

type PanelType = 'text' | 'image' | 'chart-bar' | 'chart-pie' | 'chart-line' | 'table' | 'financial' | 'metric' | 'header' | 'divider' | 'spacer' | 'button'

interface VariationOption {
  type: PanelType
  icon: React.ComponentType<{ className?: string }>
  label: string
  description: string
  color: string
}

interface VariationSelectorModalProps {
  currentType: PanelType
  variations: PanelType[]
  onSelect: (newType: PanelType) => void
  onClose: () => void
}

const PANEL_TYPE_INFO: Record<PanelType, Omit<VariationOption, 'type'>> = {
  'chart-bar': {
    icon: BarChart3,
    label: 'Bar Chart',
    description: 'Compare values across categories',
    color: 'bg-purple-100 text-purple-600',
  },
  'chart-pie': {
    icon: PieChart,
    label: 'Pie Chart',
    description: 'Show proportions and percentages',
    color: 'bg-pink-100 text-pink-600',
  },
  'chart-line': {
    icon: LineChart,
    label: 'Line Chart',
    description: 'Display trends over time',
    color: 'bg-indigo-100 text-indigo-600',
  },
  'table': {
    icon: Table,
    label: 'Data Table',
    description: 'Structured rows and columns',
    color: 'bg-indigo-100 text-indigo-600',
  },
  'financial': {
    icon: DollarSign,
    label: 'Financial Panel',
    description: 'Multiple financial metrics',
    color: 'bg-emerald-100 text-emerald-600',
  },
  'metric': {
    icon: TrendingUp,
    label: 'Metric Card',
    description: 'Single key performance indicator',
    color: 'bg-amber-100 text-amber-600',
  },
  'text': {
    icon: Type,
    label: 'Text Block',
    description: 'Paragraph or formatted text',
    color: 'bg-blue-100 text-blue-600',
  },
  'header': {
    icon: Mail,
    label: 'Header',
    description: 'Title and subtitle section',
    color: 'bg-rose-100 text-rose-600',
  },
  'image': {
    icon: Sparkles,
    label: 'Image',
    description: 'Picture or logo',
    color: 'bg-teal-100 text-teal-600',
  },
  'divider': {
    icon: Type,
    label: 'Divider',
    description: 'Horizontal line separator',
    color: 'bg-gray-100 text-gray-600',
  },
  'spacer': {
    icon: Type,
    label: 'Spacer',
    description: 'Empty vertical space',
    color: 'bg-gray-100 text-gray-600',
  },
  'button': {
    icon: Check,
    label: 'Button',
    description: 'Call-to-action button',
    color: 'bg-orange-100 text-orange-600',
  },
}

export function VariationSelectorModal({ currentType, variations, onSelect, onClose }: VariationSelectorModalProps) {
  const currentInfo = PANEL_TYPE_INFO[currentType]
  const CurrentIcon = currentInfo.icon

  const variationOptions: VariationOption[] = variations.map(type => ({
    type,
    ...PANEL_TYPE_INFO[type],
  }))

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[400] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
        >
          {/* Header */}
          <div className="px-6 py-4 bg-gradient-to-r from-purple-600 to-indigo-600">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-lg">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Switch Component Type</h2>
                  <p className="text-sm text-white/70">Convert to a different format</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>

          {/* Current Type */}
          <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
            <p className="text-xs font-medium text-gray-500 mb-2">Current Type</p>
            <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200">
              <div className={`p-2 rounded-lg ${currentInfo.color}`}>
                <CurrentIcon className="w-5 h-5" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">{currentInfo.label}</p>
                <p className="text-xs text-gray-500">{currentInfo.description}</p>
              </div>
            </div>
          </div>

          {/* Variation Options */}
          <div className="p-6">
            <p className="text-xs font-medium text-gray-500 mb-3">
              Convert To ({variationOptions.length} options)
            </p>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {variationOptions.map((option) => {
                const OptionIcon = option.icon
                return (
                  <button
                    key={option.type}
                    onClick={() => {
                      onSelect(option.type)
                      onClose()
                    }}
                    className="w-full flex items-center gap-3 p-3 bg-gray-50 hover:bg-gradient-to-r hover:from-purple-50 hover:to-indigo-50 rounded-lg border border-gray-200 hover:border-purple-300 transition-all group"
                  >
                    <div className={`p-2 rounded-lg ${option.color} group-hover:scale-110 transition-transform`}>
                      <OptionIcon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-semibold text-gray-900 text-sm">{option.label}</p>
                      <p className="text-xs text-gray-500">{option.description}</p>
                    </div>
                    <Check className="w-5 h-5 text-purple-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                )
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-between items-center">
            <p className="text-xs text-gray-500">
              <Sparkles className="w-3 h-3 inline mr-1" />
              Data will be smartly adapted
            </p>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

