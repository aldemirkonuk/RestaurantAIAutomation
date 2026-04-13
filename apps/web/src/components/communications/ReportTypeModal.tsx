/**
 * Report Type Selection Modal
 * Displays report types with template integration
 */

import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  FileText,
  Package,
  DollarSign,
  TrendingUp,
  Truck,
  Star,
  Check,
  ChevronRight,
  LayoutTemplate,
  Sparkles,
} from 'lucide-react'
import { 
  REPORT_TYPES, 
  getReportDefaults, 
  setReportDefault,
  getDefaultTemplateForReport,
  ReportTypeConfig 
} from '../../data/reportDefaults'

interface SavedTemplate {
  id: string
  name: string
  category: string
  type: 'email' | 'sms'
  createdAt: string
}

interface ReportTypeModalProps {
  isOpen: boolean
  onClose: () => void
  onSelectReportType: (reportType: string, templateId?: string) => void
  savedTemplates?: SavedTemplate[]
}

const iconMap: Record<string, React.ElementType> = {
  FileText,
  Package,
  DollarSign,
  TrendingUp,
  Truck,
}

export function ReportTypeModal({ 
  isOpen, 
  onClose, 
  onSelectReportType,
  savedTemplates = []
}: ReportTypeModalProps) {
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [defaults, setDefaults] = useState<Record<string, any>>({})

  // Load defaults on mount
  useEffect(() => {
    setDefaults(getReportDefaults())
  }, [isOpen])

  // Filter templates relevant to selected report type
  const relevantTemplates = useMemo(() => {
    if (!selectedType) return []
    
    // Match templates by category or name containing report type
    return savedTemplates.filter(template => {
      const typeLabel = REPORT_TYPES.find(t => t.value === selectedType)?.label.toLowerCase() || ''
      return (
        template.category?.toLowerCase().includes(typeLabel) ||
        template.category?.toLowerCase().includes(selectedType) ||
        template.name.toLowerCase().includes(typeLabel) ||
        template.name.toLowerCase().includes(selectedType)
      )
    })
  }, [selectedType, savedTemplates])

  const handleSelectType = (type: string) => {
    setSelectedType(type)
    setSelectedTemplate(null)
    
    // Check if there's a default template for this type
    const defaultForType = getDefaultTemplateForReport(type)
    if (defaultForType?.templateId) {
      setSelectedTemplate(defaultForType.templateId)
    }
  }

  const handleSetDefault = (reportType: string, templateId: string, templateName: string) => {
    setReportDefault(reportType, templateId, templateName)
    setDefaults(getReportDefaults())
  }

  const handleRemoveDefault = (reportType: string) => {
    setReportDefault(reportType, null)
    setDefaults(getReportDefaults())
  }

  const handleConfirm = () => {
    if (selectedType) {
      onSelectReportType(selectedType, selectedTemplate || undefined)
      onClose()
    }
  }

  const getIcon = (iconName: string) => {
    return iconMap[iconName] || FileText
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
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
          className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-wine-50 to-purple-50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-wine-600 rounded-xl">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Select Report Type</h2>
                <p className="text-sm text-gray-500">Choose a report type and optionally link a template</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/50 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden flex">
            {/* Left Panel: Report Types */}
            <div className="w-1/2 border-r border-gray-200 p-6 overflow-y-auto">
              <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Report Types
              </h3>
              
              <div className="space-y-3">
                {REPORT_TYPES.map((type) => {
                  const Icon = getIcon(type.icon)
                  const isSelected = selectedType === type.value
                  const hasDefault = defaults[type.value]?.templateId
                  
                  return (
                    <button
                      key={type.value}
                      onClick={() => handleSelectType(type.value)}
                      className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                        isSelected
                          ? 'border-wine-500 bg-wine-50 shadow-lg shadow-wine-500/10'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`p-2.5 rounded-xl ${type.bgColor}`}>
                          <Icon className={`w-5 h-5 ${type.color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-900">{type.label}</span>
                            {hasDefault && (
                              <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-full">
                                <Star className="w-3 h-3 fill-amber-500" />
                                Default
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-500 mt-1">{type.description}</p>
                          {hasDefault && (
                            <p className="text-xs text-wine-600 mt-2 truncate">
                              Template: {defaults[type.value]?.templateName}
                            </p>
                          )}
                        </div>
                        {isSelected && (
                          <Check className="w-5 h-5 text-wine-600 flex-shrink-0" />
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Right Panel: Templates */}
            <div className="w-1/2 p-6 overflow-y-auto bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <LayoutTemplate className="w-4 h-4" />
                {selectedType ? 'Available Templates' : 'Select a Report Type'}
              </h3>

              {!selectedType ? (
                <div className="flex flex-col items-center justify-center h-64 text-center">
                  <div className="p-4 bg-gray-200 rounded-full mb-4">
                    <ChevronRight className="w-8 h-8 text-gray-400" />
                  </div>
                  <p className="text-gray-500">Select a report type to see available templates</p>
                </div>
              ) : relevantTemplates.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-center">
                  <div className="p-4 bg-gray-200 rounded-full mb-4">
                    <LayoutTemplate className="w-8 h-8 text-gray-400" />
                  </div>
                  <p className="text-gray-500 mb-2">No templates found for this report type</p>
                  <p className="text-xs text-gray-400">
                    Create templates in the Gmail Template Builder and categorize them
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* No Template Option */}
                  <button
                    onClick={() => setSelectedTemplate(null)}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                      selectedTemplate === null
                        ? 'border-wine-500 bg-white shadow-lg'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-gray-100 rounded-lg">
                        <FileText className="w-4 h-4 text-gray-500" />
                      </div>
                      <div className="flex-1">
                        <span className="font-medium text-gray-900">Use Default Format</span>
                        <p className="text-xs text-gray-500 mt-0.5">Standard report without custom template</p>
                      </div>
                      {selectedTemplate === null && (
                        <Check className="w-5 h-5 text-wine-600" />
                      )}
                    </div>
                  </button>

                  {/* Template Options */}
                  {relevantTemplates.map((template) => {
                    const isSelected = selectedTemplate === template.id
                    const isDefault = defaults[selectedType]?.templateId === template.id
                    
                    return (
                      <div
                        key={template.id}
                        className={`p-4 rounded-xl border-2 transition-all ${
                          isSelected
                            ? 'border-wine-500 bg-white shadow-lg'
                            : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        <button
                          onClick={() => setSelectedTemplate(template.id)}
                          className="w-full text-left"
                        >
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-100 rounded-lg">
                              <Sparkles className="w-4 h-4 text-blue-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-900 truncate">{template.name}</span>
                                {isDefault && (
                                  <Star className="w-4 h-4 text-amber-500 fill-amber-500 flex-shrink-0" />
                                )}
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {template.category || 'Custom Template'} • {template.type.toUpperCase()}
                              </p>
                            </div>
                            {isSelected && (
                              <Check className="w-5 h-5 text-wine-600 flex-shrink-0" />
                            )}
                          </div>
                        </button>
                        
                        {/* Set/Remove Default Button */}
                        <div className="mt-3 pt-3 border-t border-gray-100 flex justify-end">
                          {isDefault ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleRemoveDefault(selectedType)
                              }}
                              className="text-xs text-gray-500 hover:text-rose-600 transition-colors flex items-center gap-1"
                            >
                              <Star className="w-3 h-3" />
                              Remove as Default
                            </button>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleSetDefault(selectedType, template.id, template.name)
                              }}
                              className="text-xs text-wine-600 hover:text-wine-700 transition-colors flex items-center gap-1"
                            >
                              <Star className="w-3 h-3" />
                              Set as Default
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between">
            <div className="text-sm text-gray-500">
              {selectedType && (
                <span>
                  Selected: <strong className="text-gray-900">
                    {REPORT_TYPES.find(t => t.value === selectedType)?.label}
                  </strong>
                  {selectedTemplate && relevantTemplates.find(t => t.id === selectedTemplate) && (
                    <span className="text-wine-600 ml-2">
                      with "{relevantTemplates.find(t => t.id === selectedTemplate)?.name}"
                    </span>
                  )}
                </span>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!selectedType}
                className="px-6 py-2 bg-wine-600 text-white font-medium rounded-lg hover:bg-wine-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Check className="w-4 h-4" />
                Confirm Selection
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
