import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  MessageSquare,
  Send,
  Save,
  Copy,
  Check,
  Smartphone,
  Zap,
  Sparkles,
  Wine,
  Package,
  Truck,
  DollarSign,
  Calendar,
  User,
  Building,
  AlertCircle,
  ChevronDown,
  RotateCcw,
  Image,
  FileText,
} from 'lucide-react'

// SMS Template Types
interface SMSTemplate {
  id: string
  name: string
  category: 'order' | 'delivery' | 'alert' | 'promotion' | 'reminder' | 'custom'
  message: string
  variables: string[]
  characterCount: number
  segmentCount: number
  created_at: Date
  last_modified: Date
  used_count: number
  tags: string[]
}

interface SMSTemplateBuilderProps {
  onClose: () => void
  /**
   * May persist, and may therefore fail. A rejection means NOTHING was stored,
   * so the builder must not show its success state or close over it — see
   * `handleSave`.
   */
  onSave?: (template: SMSTemplate) => void | Promise<void>
  editingTemplate?: SMSTemplate | null
}

// Template variables with categories
const VARIABLE_CATEGORIES = [
  {
    name: 'Wine',
    icon: Wine,
    color: 'rose',
    variables: [
      { key: '{{wine_name}}', label: 'Wine Name', example: 'Château Margaux 2015' },
      { key: '{{wine_type}}', label: 'Wine Type', example: 'Red' },
      { key: '{{vintage}}', label: 'Vintage', example: '2015' },
      { key: '{{wine_count}}', label: 'Wine Count', example: '12' },
    ]
  },
  {
    name: 'Order',
    icon: Package,
    color: 'blue',
    variables: [
      { key: '{{order_id}}', label: 'Order ID', example: 'ORD-2024-1234' },
      { key: '{{order_total}}', label: 'Order Total', example: '$2,450.00' },
      { key: '{{order_status}}', label: 'Order Status', example: 'Confirmed' },
      { key: '{{order_date}}', label: 'Order Date', example: 'Jan 12, 2026' },
    ]
  },
  {
    name: 'Delivery',
    icon: Truck,
    color: 'emerald',
    variables: [
      { key: '{{delivery_date}}', label: 'Delivery Date', example: 'Jan 15, 2026' },
      { key: '{{delivery_time}}', label: 'Delivery Time', example: '2:00 PM' },
      { key: '{{tracking_number}}', label: 'Tracking #', example: 'TRK123456' },
      { key: '{{eta}}', label: 'ETA', example: '2 days' },
    ]
  },
  {
    name: 'Provider',
    icon: Building,
    color: 'purple',
    variables: [
      { key: '{{provider_name}}', label: 'Provider Name', example: 'Southern Glazer\'s' },
      { key: '{{provider_phone}}', label: 'Provider Phone', example: '(555) 123-4567' },
      { key: '{{rep_name}}', label: 'Rep Name', example: 'John Smith' },
    ]
  },
  {
    name: 'Restaurant',
    icon: User,
    color: 'amber',
    variables: [
      { key: '{{restaurant_name}}', label: 'Restaurant Name', example: 'The Wine Cellar' },
      { key: '{{manager_name}}', label: 'Manager Name', example: 'Sarah Johnson' },
      { key: '{{location}}', label: 'Location', example: 'Downtown' },
    ]
  },
  {
    name: 'Date/Time',
    icon: Calendar,
    color: 'indigo',
    variables: [
      { key: '{{date}}', label: 'Current Date', example: 'Jan 12, 2026' },
      { key: '{{time}}', label: 'Current Time', example: '3:45 PM' },
      { key: '{{day}}', label: 'Day of Week', example: 'Monday' },
    ]
  },
]

// Pre-built templates
const PRESET_TEMPLATES = [
  {
    id: 'preset-1',
    name: 'Order Confirmation',
    category: 'order' as const,
    message: '✅ Order Confirmed!\n\nOrder #{{order_id}} for {{wine_count}} bottles has been placed with {{provider_name}}.\n\nTotal: {{order_total}}\nETA: {{eta}}\n\n- {{restaurant_name}}',
    icon: Check,
    color: 'emerald',
  },
  {
    id: 'preset-2',
    name: 'Delivery Alert',
    category: 'delivery' as const,
    message: '🚚 Delivery Update\n\nYour order from {{provider_name}} is scheduled for delivery on {{delivery_date}} at {{delivery_time}}.\n\nTracking: {{tracking_number}}\n\nQuestions? Reply to this message.',
    icon: Truck,
    color: 'blue',
  },
  {
    id: 'preset-3',
    name: 'Low Stock Alert',
    category: 'alert' as const,
    message: '⚠️ Low Stock Alert\n\n{{wine_name}} is running low ({{wine_count}} remaining).\n\nReorder now to avoid stockouts.\n\nTap to reorder: [link]',
    icon: AlertCircle,
    color: 'amber',
  },
  {
    id: 'preset-4',
    name: 'Payment Reminder',
    category: 'reminder' as const,
    message: '💳 Payment Reminder\n\nInvoice #{{order_id}} for {{order_total}} from {{provider_name}} is due {{delivery_date}}.\n\nPay now to maintain your account status.',
    icon: DollarSign,
    color: 'rose',
  },
  {
    id: 'preset-5',
    name: 'Tasting Event',
    category: 'promotion' as const,
    message: '🍷 Wine Tasting Event\n\nJoin us {{delivery_date}} at {{delivery_time}} for an exclusive tasting of {{wine_name}}.\n\nRSVP: Reply YES\n\n- {{restaurant_name}}',
    icon: Wine,
    color: 'purple',
  },
  {
    id: 'preset-6',
    name: 'Delivery Confirmed',
    category: 'delivery' as const,
    message: '📦 Delivery Complete!\n\n{{wine_count}} bottles from {{provider_name}} have been delivered.\n\nPlease verify and confirm receipt.\n\nOrder #{{order_id}}',
    icon: Package,
    color: 'emerald',
  },
]

// Character limits
const SMS_SEGMENT_SIZE = 160
const SMS_UNICODE_SEGMENT_SIZE = 70

// All variables flattened for autocomplete
const ALL_VARIABLES = VARIABLE_CATEGORIES.flatMap(cat => 
  cat.variables.map(v => ({ ...v, category: cat.name, color: cat.color }))
)

export function SMSTemplateBuilder({ onClose, onSave, editingTemplate }: SMSTemplateBuilderProps) {
  const [templateName, setTemplateName] = useState(editingTemplate?.name || '')
  const [category, setCategory] = useState<SMSTemplate['category']>(editingTemplate?.category || 'custom')
  const [message, setMessage] = useState(editingTemplate?.message || '')
  const [tags, setTags] = useState<string[]>(editingTemplate?.tags || [])
  const [newTag, setNewTag] = useState('')
  const [showVariables, setShowVariables] = useState(false)
  const [activeVariableCategory, setActiveVariableCategory] = useState(0)
  const [showPreview, setShowPreview] = useState(true) // Default to showing preview
  const [previewTime, setPreviewTime] = useState(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [showPresets, setShowPresets] = useState(!editingTemplate)
  const [isDraft, setIsDraft] = useState(false)
  const [mmsEnabled, setMmsEnabled] = useState(false)
  const [mmsImageUrl, setMmsImageUrl] = useState('')
  const [showAutocomplete, setShowAutocomplete] = useState(false)
  const [autocompleteFilter, setAutocompleteFilter] = useState('')
  const [autocompletePosition, setAutocompletePosition] = useState({ top: 0, left: 0 })
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Calculate character count and segments
  const hasUnicode = [...message].some((ch) => ch.charCodeAt(0) > 127)
  const segmentSize = hasUnicode ? SMS_UNICODE_SEGMENT_SIZE : SMS_SEGMENT_SIZE
  const characterCount = message.length
  const segmentCount = Math.ceil(characterCount / segmentSize) || 1

  // Extract variables from message
  const extractedVariables = message.match(/\{\{[^}]+\}\}/g) || []
  const uniqueVariables = [...new Set(extractedVariables)]

  // Character progress percentage
  const characterProgress = Math.min((characterCount / segmentSize) * 100, 100)
  const isOverLimit = characterCount > segmentSize

  // Filtered autocomplete variables
  const filteredAutocompleteVars = ALL_VARIABLES.filter(v => 
    v.key.toLowerCase().includes(autocompleteFilter.toLowerCase()) ||
    v.label.toLowerCase().includes(autocompleteFilter.toLowerCase())
  )

  // Update preview time
  useEffect(() => {
    const interval = setInterval(() => {
      setPreviewTime(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
    }, 60000)
    return () => clearInterval(interval)
  }, [])

  // Handle autocomplete trigger
  const handleMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    const cursorPos = e.target.selectionStart
    setMessage(value)

    // Check if user is typing a variable (after {{)
    const textBeforeCursor = value.substring(0, cursorPos)
    const lastOpenBrace = textBeforeCursor.lastIndexOf('{{')
    const lastCloseBrace = textBeforeCursor.lastIndexOf('}}')

    if (lastOpenBrace > lastCloseBrace && lastOpenBrace !== -1) {
      const partialVar = textBeforeCursor.substring(lastOpenBrace + 2)
      if (!partialVar.includes(' ') && partialVar.length < 20) {
        setAutocompleteFilter(partialVar)
        setShowAutocomplete(true)
        
        // Calculate position
        if (textareaRef.current) {
          textareaRef.current.getBoundingClientRect()
          setAutocompletePosition({
            top: 60, // Fixed position below textarea start
            left: 20
          })
        }
      } else {
        setShowAutocomplete(false)
      }
    } else {
      setShowAutocomplete(false)
    }
  }

  // Insert variable from autocomplete
  const insertFromAutocomplete = (variable: string) => {
    if (textareaRef.current) {
      const cursorPos = textareaRef.current.selectionStart
      const textBeforeCursor = message.substring(0, cursorPos)
      const lastOpenBrace = textBeforeCursor.lastIndexOf('{{')
      const textAfterCursor = message.substring(cursorPos)
      
      const newMessage = message.substring(0, lastOpenBrace) + variable + textAfterCursor
      setMessage(newMessage)
      setShowAutocomplete(false)
      
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          const newPosition = lastOpenBrace + variable.length
          textareaRef.current.setSelectionRange(newPosition, newPosition)
        }
      }, 0)
    }
  }

  // Save as draft
  const handleSaveAsDraft = async () => {
    if (!templateName) {
      alert('Please enter a template name')
      return
    }

    setIsSaving(true)
    setIsDraft(true)

    await new Promise(resolve => setTimeout(resolve, 500))

    setIsSaving(false)
    setSaveSuccess(true)

    setTimeout(() => {
      setSaveSuccess(false)
    }, 2000)
  }

  // Insert variable at cursor
  const insertVariable = (variable: string) => {
    if (textareaRef.current) {
      const start = textareaRef.current.selectionStart
      const end = textareaRef.current.selectionEnd
      const newMessage = message.substring(0, start) + variable + message.substring(end)
      setMessage(newMessage)
      
      // Focus and set cursor position
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          const newPosition = start + variable.length
          textareaRef.current.setSelectionRange(newPosition, newPosition)
        }
      }, 0)
    } else {
      setMessage(message + variable)
    }
  }

  // Apply preset template
  const applyPreset = (preset: typeof PRESET_TEMPLATES[0]) => {
    setMessage(preset.message)
    setCategory(preset.category)
    if (!templateName) {
      setTemplateName(preset.name)
    }
    setShowPresets(false)
  }

  // Add tag
  const addTag = () => {
    if (newTag && !tags.includes(newTag)) {
      setTags([...tags, newTag])
      setNewTag('')
    }
  }

  // Remove tag
  const removeTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag))
  }

  // Generate preview with sample data
  const generatePreview = () => {
    let preview = message
    VARIABLE_CATEGORIES.forEach(cat => {
      cat.variables.forEach(v => {
        preview = preview.replace(new RegExp(v.key.replace(/[{}]/g, '\\$&'), 'g'), v.example)
      })
    })
    return preview
  }

  // Save template
  const handleSave = async () => {
    if (!templateName || !message) {
      alert('Please enter a template name and message')
      return
    }

    setIsSaving(true)

    const template: SMSTemplate = {
      id: editingTemplate?.id || `sms-${Date.now()}`,
      name: templateName,
      category,
      message,
      variables: uniqueVariables,
      characterCount,
      segmentCount,
      created_at: editingTemplate?.created_at || new Date(),
      last_modified: new Date(),
      used_count: editingTemplate?.used_count || 0,
      tags,
    }

    // The success state follows the outcome, it does not precede it. This used
    // to await a `// Simulate save delay` timer, then set success and call
    // `onSave` — so a handler that persists and FAILS still produced a green
    // tick and a closed builder, discarding the author's work while telling
    // them it was saved (ADR 0051 clause 3). The fake delay is gone with it:
    // the wait is now the real request.
    try {
      if (onSave) {
        await onSave(template)
      }
    } catch {
      // The caller surfaces the failure in words; the builder's job is only to
      // not claim success and to keep the work on screen.
      setIsSaving(false)
      return
    }

    setIsSaving(false)
    setSaveSuccess(true)

    setTimeout(() => {
      setSaveSuccess(false)
      onClose()
    }, 1500)
  }


  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl h-[95vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-2.5 bg-white/20 rounded-xl">
                <MessageSquare className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">SMS Template Builder</h2>
                <p className="text-sm text-white/80">Create professional SMS templates with dynamic variables</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowPreview(!showPreview)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  showPreview ? 'bg-white text-emerald-700' : 'bg-white/20 text-white hover:bg-white/30'
                }`}
              >
                <Smartphone className="w-4 h-4" />
                Preview
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || !message || !templateName}
                className="flex items-center gap-2 px-4 py-2 bg-white text-emerald-700 rounded-lg text-sm font-semibold hover:bg-emerald-50 transition-colors disabled:opacity-50"
              >
                {isSaving ? (
                  <div className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                ) : saveSuccess ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {isSaving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save'}
              </button>
              <button
                onClick={onClose}
                className="p-2 text-white/80 hover:text-white hover:bg-white/20 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 flex overflow-hidden">
            {/* Main Editor */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Template Meta */}
              <div className="p-4 border-b border-gray-200 bg-gray-50">
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Template Name</label>
                    <input
                      type="text"
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      placeholder="e.g., Order Confirmation"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    />
                  </div>
                  <div className="w-48">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Category</label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as SMSTemplate['category'])}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    >
                      <option value="order">📦 Order</option>
                      <option value="delivery">🚚 Delivery</option>
                      <option value="alert">⚠️ Alert</option>
                      <option value="promotion">✨ Promotion</option>
                      <option value="reminder">🔔 Reminder</option>
                      <option value="custom">💬 Custom</option>
                    </select>
                  </div>
                </div>

                {/* Tags */}
                <div className="mt-3">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Tags</label>
                  <div className="flex flex-wrap items-center gap-2">
                    {tags.map(tag => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium"
                      >
                        #{tag}
                        <button onClick={() => removeTag(tag)} className="hover:text-emerald-900">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addTag()}
                        placeholder="Add tag..."
                        className="w-24 px-2 py-1 border border-gray-200 rounded text-xs focus:ring-1 focus:ring-emerald-500"
                      />
                      <button
                        onClick={addTag}
                        disabled={!newTag}
                        className="p-1 text-emerald-600 hover:bg-emerald-50 rounded disabled:opacity-50"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Preset Templates */}
              <AnimatePresence>
                {showPresets && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-b border-gray-200 overflow-hidden"
                  >
                    <div className="p-4 bg-gradient-to-r from-gray-50 to-white">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Zap className="w-4 h-4 text-amber-500" />
                          <h3 className="text-sm font-semibold text-gray-900">Quick Start Templates</h3>
                        </div>
                        <button
                          onClick={() => setShowPresets(false)}
                          className="text-xs text-gray-500 hover:text-gray-700"
                        >
                          Hide
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {PRESET_TEMPLATES.map(preset => {
                          const Icon = preset.icon
                          return (
                            <button
                              key={preset.id}
                              onClick={() => applyPreset(preset)}
                              className={`p-3 rounded-xl border-2 border-transparent hover:border-${preset.color}-300 bg-white hover:bg-${preset.color}-50 transition-all text-left group`}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <div className={`p-1.5 bg-${preset.color}-100 rounded-lg`}>
                                  <Icon className={`w-3.5 h-3.5 text-${preset.color}-600`} />
                                </div>
                                <span className="text-sm font-medium text-gray-900">{preset.name}</span>
                              </div>
                              <p className="text-xs text-gray-500 line-clamp-2">{preset.message.slice(0, 60)}...</p>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Message Editor */}
              <div className="flex-1 p-4 overflow-hidden flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Message</label>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowVariables(!showVariables)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        showVariables ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Variables
                      <ChevronDown className={`w-3 h-3 transition-transform ${showVariables ? 'rotate-180' : ''}`} />
                    </button>
                    <button
                      onClick={() => setMessage('')}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-600 hover:bg-gray-200 rounded-lg text-xs font-medium transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Clear
                    </button>
                  </div>
                </div>

                {/* Variables Panel */}
                <AnimatePresence>
                  {showVariables && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="mb-3 overflow-hidden"
                    >
                      <div className="p-3 bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl border border-emerald-100">
                        {/* Category Tabs */}
                        <div className="flex gap-1 mb-3 overflow-x-auto pb-1">
                          {VARIABLE_CATEGORIES.map((cat, idx) => {
                            const Icon = cat.icon
                            return (
                              <button
                                key={cat.name}
                                onClick={() => setActiveVariableCategory(idx)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                                  activeVariableCategory === idx
                                    ? 'bg-white text-gray-900 shadow-sm'
                                    : 'text-gray-600 hover:bg-white/50'
                                }`}
                              >
                                <Icon className="w-3.5 h-3.5" />
                                {cat.name}
                              </button>
                            )
                          })}
                        </div>

                        {/* Variables Grid */}
                        <div className="grid grid-cols-4 gap-2">
                          {VARIABLE_CATEGORIES[activeVariableCategory].variables.map(v => (
                            <button
                              key={v.key}
                              onClick={() => insertVariable(v.key)}
                              className="p-2 bg-white rounded-lg border border-gray-200 hover:border-emerald-300 hover:bg-emerald-50 transition-all text-left group"
                            >
                              <p className="text-xs font-mono text-emerald-600 truncate">{v.key}</p>
                              <p className="text-[10px] text-gray-500 truncate">{v.label}</p>
                            </button>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Textarea */}
                <div className="flex-1 relative">
                  <textarea
                    ref={textareaRef}
                    value={message}
                    onChange={handleMessageChange}
                    placeholder="Type your SMS message here...

Use variables like {{wine_name}} or {{order_id}} that will be replaced with actual values when sending.

Start typing {{ to see variable autocomplete suggestions.

Tip: Keep messages under 160 characters for a single SMS segment."
                    className="w-full h-full px-4 py-3 border border-gray-200 rounded-xl text-sm resize-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent font-mono leading-relaxed"
                  />

                  {/* Autocomplete Dropdown */}
                  <AnimatePresence>
                    {showAutocomplete && filteredAutocompleteVars.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute z-10 bg-white rounded-xl shadow-xl border border-gray-200 max-h-64 overflow-y-auto"
                        style={{ top: autocompletePosition.top, left: autocompletePosition.left, width: '300px' }}
                      >
                        <div className="p-2 border-b border-gray-100 bg-gray-50 rounded-t-xl">
                          <p className="text-xs font-semibold text-gray-500">Insert Variable</p>
                        </div>
                        {filteredAutocompleteVars.slice(0, 8).map(v => (
                          <button
                            key={v.key}
                            onClick={() => insertFromAutocomplete(v.key)}
                            className="w-full px-3 py-2 text-left hover:bg-emerald-50 flex items-center justify-between group transition-colors"
                          >
                            <div>
                              <p className="text-sm font-mono text-emerald-600">{v.key}</p>
                              <p className="text-xs text-gray-500">{v.label} • {v.category}</p>
                            </div>
                            <span className="text-xs text-gray-400 group-hover:text-emerald-600">↵</span>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* MMS Toggle */}
                <div className="mt-3 p-3 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl border border-purple-100">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-purple-100 rounded-lg">
                        <Image className="w-4 h-4 text-purple-600" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">MMS Support</p>
                        <p className="text-xs text-gray-500">Include an image with your message</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setMmsEnabled(!mmsEnabled)}
                      className={`relative w-12 h-6 rounded-full transition-colors ${
                        mmsEnabled ? 'bg-purple-600' : 'bg-gray-300'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-sm ${
                          mmsEnabled ? 'translate-x-6' : ''
                        }`}
                      />
                    </button>
                  </div>
                  
                  <AnimatePresence>
                    {mmsEnabled && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="mt-3 overflow-hidden"
                      >
                        <input
                          type="url"
                          value={mmsImageUrl}
                          onChange={(e) => setMmsImageUrl(e.target.value)}
                          placeholder="Enter image URL..."
                          className="w-full px-3 py-2 border border-purple-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        />
                        <p className="text-xs text-gray-500 mt-1">Supported: JPG, PNG, GIF (max 1MB)</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Character Count & Stats with Progress Bar */}
                <div className="mt-3 pt-3 border-t border-gray-200 space-y-3">
                  {/* Progress Bar */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">Character Progress</span>
                      <span className={`font-medium ${isOverLimit ? 'text-rose-600' : characterProgress > 80 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {characterCount} / {segmentSize}
                      </span>
                    </div>
                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(characterProgress, 100)}%` }}
                        className={`h-full rounded-full transition-colors ${
                          isOverLimit ? 'bg-rose-500' : characterProgress > 80 ? 'bg-amber-500' : 'bg-emerald-500'
                        }`}
                      />
                    </div>
                    {segmentCount > 1 && (
                      <div className="flex items-center gap-1">
                        {Array.from({ length: Math.min(segmentCount, 5) }).map((_, i) => (
                          <div
                            key={i}
                            className={`flex-1 h-1 rounded ${
                              i < segmentCount ? 'bg-amber-400' : 'bg-gray-200'
                            }`}
                          />
                        ))}
                        {segmentCount > 5 && (
                          <span className="text-xs text-amber-600 ml-1">+{segmentCount - 5}</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Stats Row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-gray-400" />
                        <span className={`text-sm font-medium ${
                          segmentCount > 1 ? 'text-amber-600' : 'text-gray-600'
                        }`}>
                          {segmentCount} SMS segment{segmentCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                      {hasUnicode && (
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs font-medium rounded">
                          Unicode
                        </span>
                      )}
                      {mmsEnabled && (
                        <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs font-medium rounded flex items-center gap-1">
                          <Image className="w-3 h-3" />
                          MMS
                        </span>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {uniqueVariables.length > 0 && (
                        <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-full">
                          {uniqueVariables.length} variable{uniqueVariables.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Phone Preview */}
            <AnimatePresence>
              {showPreview && (
                <motion.div
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 380, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  className="border-l border-gray-200 bg-gradient-to-b from-gray-100 to-gray-200 flex items-center justify-center p-6"
                >
                  {/* iPhone Mockup - Larger */}
                  <div className="w-[320px] h-[640px] bg-black rounded-[3rem] p-3 shadow-2xl">
                    <div className="w-full h-full bg-white rounded-[2.5rem] overflow-hidden flex flex-col">
                      {/* Status Bar */}
                      <div className="h-12 bg-gray-100 flex items-center justify-between px-6 pt-2">
                        <span className="text-xs font-semibold">{previewTime}</span>
                        <div className="w-24 h-6 bg-black rounded-full" /> {/* Dynamic Island */}
                        <div className="flex items-center gap-1">
                          <div className="w-4 h-2 border border-gray-400 rounded-sm">
                            <div className="w-3 h-1.5 bg-gray-400 rounded-sm" />
                          </div>
                        </div>
                      </div>

                      {/* Messages Header */}
                      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3">
                        <div className="w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center">
                          <Building className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">
                            {VARIABLE_CATEGORIES[3].variables[0].example}
                          </p>
                          <p className="text-xs text-gray-500">Business</p>
                        </div>
                      </div>

                      {/* Message Content */}
                      <div className="flex-1 p-4 bg-gray-50 overflow-y-auto">
                        <div className="flex justify-end mb-2">
                          <span className="text-[10px] text-gray-400">Today {previewTime}</span>
                        </div>
                        
                        {message ? (
                          <div className="bg-emerald-500 text-white p-3 rounded-2xl rounded-br-md max-w-[85%] ml-auto shadow-sm">
                            <p className="text-sm whitespace-pre-wrap leading-relaxed">
                              {generatePreview()}
                            </p>
                          </div>
                        ) : (
                          <div className="text-center py-8">
                            <MessageSquare className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                            <p className="text-xs text-gray-400">Start typing to see preview</p>
                          </div>
                        )}

                        {/* Delivery Status */}
                        {message && (
                          <div className="flex justify-end mt-1">
                            <span className="text-[10px] text-gray-400 flex items-center gap-1">
                              Delivered
                              <Check className="w-3 h-3 text-emerald-500" />
                              <Check className="w-3 h-3 text-emerald-500 -ml-1.5" />
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Input Bar */}
                      <div className="p-3 bg-white border-t border-gray-200 flex items-center gap-2">
                        <div className="flex-1 h-9 bg-gray-100 rounded-full px-4 flex items-center">
                          <span className="text-xs text-gray-400">iMessage</span>
                        </div>
                        <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center">
                          <Send className="w-4 h-4 text-white" />
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm text-gray-600">
              {segmentCount > 1 && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-xs font-medium">
                    This message will be sent as {segmentCount} SMS segments
                  </span>
                </div>
              )}
              {mmsEnabled && mmsImageUrl && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-100 text-purple-700 rounded-lg">
                  <Image className="w-4 h-4" />
                  <span className="text-xs font-medium">MMS with image attached</span>
                </div>
              )}
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2.5 text-gray-700 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(message)
                  alert('Message copied to clipboard!')
                }}
                className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors"
              >
                <Copy className="w-4 h-4" />
                Copy
              </button>
              <button
                onClick={handleSaveAsDraft}
                disabled={isSaving || !templateName}
                className="flex items-center gap-2 px-4 py-2.5 border border-amber-300 bg-amber-50 text-amber-700 rounded-lg text-sm font-medium hover:bg-amber-100 transition-colors disabled:opacity-50"
              >
                <FileText className="w-4 h-4" />
                Save Draft
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || !message || !templateName}
                className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50 shadow-lg shadow-emerald-600/30"
              >
                {isSaving && !isDraft ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : saveSuccess && !isDraft ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {isSaving && !isDraft ? 'Saving...' : saveSuccess && !isDraft ? 'Saved!' : 'Save Template'}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

