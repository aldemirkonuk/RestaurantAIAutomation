import { PhoneNumberInput } from '../ui/PhoneNumberInput'
import { isValidPhone } from '../../lib/phone'
import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Save,
  RotateCcw,
  Plus,
  Sparkles,
  Wine,
  AlertCircle,
  Check,
  Zap,
} from 'lucide-react'
import { Wine as WineType } from '../../data/wineData'
import {
  COMMON_BOTTLE_SIZES,
  parseVolumeInput,
  isValidBottleSize,
  formatVolume,
} from '../../utils/volumeUtils'

interface DevManualWineEntryProps {
  onClose: () => void
  onWineAdded?: (wine: WineType) => void
}

interface FormErrors {
  [key: string]: string
}

const wineTypes = ['red', 'white', 'sparkling', 'rose', 'dessert'] as const
const bodyOptions = ['light', 'medium', 'full', 'extra-full']
const sweetnessOptions = ['bone-dry', 'dry', 'off-dry', 'medium-sweet', 'sweet', 'very-sweet']
const acidityOptions = ['low', 'medium-low', 'medium', 'medium-high', 'high']

// Quick templates for common wine profiles
const quickTemplates = {
  'Bordeaux Red': {
    type: 'red' as const,
    grape: 'Cabernet Sauvignon Blend',
    body: 'full',
    sweetness: 'dry',
    acidity: 'medium-high',
    alcohol: 13.5,
    aromas: ['black currant', 'cedar', 'tobacco', 'graphite'],
    flavors: ['dark cherry', 'blackberry', 'oak', 'vanilla'],
  },
  'Burgundy White': {
    type: 'white' as const,
    grape: 'Chardonnay',
    body: 'medium',
    sweetness: 'dry',
    acidity: 'high',
    alcohol: 13.0,
    aromas: ['citrus', 'stone fruit', 'butter', 'hazelnut'],
    flavors: ['lemon', 'apple', 'cream', 'toast'],
  },
  'Champagne': {
    type: 'sparkling' as const,
    grape: 'Chardonnay/Pinot Noir',
    body: 'light',
    sweetness: 'bone-dry',
    acidity: 'high',
    alcohol: 12.5,
    aromas: ['citrus', 'brioche', 'almond', 'white flowers'],
    flavors: ['apple', 'pear', 'toast', 'cream'],
  },
  'Napa Cabernet': {
    type: 'red' as const,
    grape: 'Cabernet Sauvignon',
    body: 'full',
    sweetness: 'dry',
    acidity: 'medium',
    alcohol: 14.5,
    aromas: ['blackberry', 'cassis', 'vanilla', 'mocha'],
    flavors: ['black cherry', 'plum', 'chocolate', 'oak'],
  },
}

export function DevManualWineEntry({ onClose, onWineAdded }: DevManualWineEntryProps) {
  const [formData, setFormData] = useState<Partial<WineType>>({
    name: '',
    producer: '',
    vintage: null,
    price: 0,
    type: 'red',
    grape: '',
    country: '',
    region: '',
    appellation: '',
    body: 'medium',
    sweetness: 'dry',
    acidity: 'medium',
    alcohol: 13.0,
    aromas: [],
    flavors: [],
    liveStock: 0,
    threshold: 6,
    provider: {
      name: '',
      contact: '',
      phone: '',
      email: '',
      address: '',
    },
    isActive: true,
  })

  const [errors, setErrors] = useState<FormErrors>({})
  const [currentAroma, setCurrentAroma] = useState('')
  const [currentFlavor, setCurrentFlavor] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [bottleSizeMl, setBottleSizeMl] = useState<number>(750)
  const [customBottleSizeInput, setCustomBottleSizeInput] = useState('')
  const [isCustomBottleSize, setIsCustomBottleSize] = useState(false)
  const customBottleParsed = customBottleSizeInput ? parseVolumeInput(customBottleSizeInput) : null

  // Refs for keyboard navigation
  const formRef = useRef<HTMLFormElement>(null)
  const firstInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Auto-focus first input
    if (firstInputRef.current) {
      firstInputRef.current.focus()
    }

    // Keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + S to save
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
      // Cmd/Ctrl + N to clear form
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        handleClear()
      }
      // Escape to close
      if (e.key === 'Escape' && !e.shiftKey) {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [formData])

  const generateWineId = () => {
    const producer = formData.producer?.replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase() || 'WINE'
    const name = formData.name?.replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase() || 'NEW'
    const vintage = formData.vintage || 'NV'
    const random = Math.random().toString(36).substring(2, 5).toUpperCase()
    return `${producer}_${name}_${vintage}_${random}`
  }

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {}

    if (!formData.name?.trim()) newErrors.name = 'Wine name is required'
    if (!formData.producer?.trim()) newErrors.producer = 'Producer is required'
    if (!formData.price || formData.price <= 0) newErrors.price = 'Valid price is required'
    if (!formData.grape?.trim()) newErrors.grape = 'Grape variety is required'
    if (!formData.country?.trim()) newErrors.country = 'Country is required'
    if (!formData.region?.trim()) newErrors.region = 'Region is required'
    if (!formData.provider?.name?.trim()) newErrors.providerName = 'Provider name is required'
    if (!formData.provider?.contact?.trim()) newErrors.providerContact = 'Provider contact is required'
    if (!formData.provider?.phone?.trim()) newErrors.providerPhone = 'Provider phone is required'
    else if (!isValidPhone(formData.provider?.phone)) newErrors.providerPhone = 'Enter a valid phone number'

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSave = async () => {
    if (!validateForm()) {
      alert('Please fix validation errors before saving')
      return
    }

    setSaving(true)

    try {
      // Generate wine ID
      const wineId = generateWineId()

      const newWine: WineType = {
        id: wineId,
        name: formData.name!,
        producer: formData.producer!,
        vintage: formData.vintage ?? null,
        price: formData.price!,
        type: formData.type!,
        grape: formData.grape!,
        country: formData.country!,
        region: formData.region!,
        appellation: formData.appellation || '',
        body: formData.body!,
        sweetness: formData.sweetness!,
        acidity: formData.acidity!,
        alcohol: formData.alcohol!,
        aromas: formData.aromas || [],
        flavors: formData.flavors || [],
        liveStock: formData.liveStock || 0,
        threshold: formData.threshold || 6,
        provider: formData.provider!,
        isActive: true,
        bottleSizeMl,
      }

      // In a real app, this would save to backend
      // For DEV mode, we'll simulate saving to JSON (localStorage as workaround)
      const existingWines = JSON.parse(localStorage.getItem('dev_wines') || '[]')
      existingWines.push(newWine)
      localStorage.setItem('dev_wines', JSON.stringify(existingWines))

      console.log('✅ Wine saved to DEV storage:', newWine)

      setSaveSuccess(true)
      
      if (onWineAdded) {
        onWineAdded(newWine)
      }

      // Show success message
      setTimeout(() => {
        setSaveSuccess(false)
        handleClear()
      }, 2000)

    } catch (error) {
      console.error('Failed to save wine:', error)
      alert('Failed to save wine. Check console for details.')
    } finally {
      setSaving(false)
    }
  }

  const handleClear = () => {
    setFormData({
      name: '',
      producer: '',
      vintage: null,
      price: 0,
      type: 'red',
      grape: '',
      country: '',
      region: '',
      appellation: '',
      body: 'medium',
      sweetness: 'dry',
      acidity: 'medium',
      alcohol: 13.0,
      aromas: [],
      flavors: [],
      liveStock: 0,
      threshold: 6,
      provider: {
        name: '',
        contact: '',
        phone: '',
        email: '',
        address: '',
      },
      isActive: true,
    })
    setErrors({})
    setCurrentAroma('')
    setCurrentFlavor('')
    setBottleSizeMl(750)
    setCustomBottleSizeInput('')
    setIsCustomBottleSize(false)
    if (firstInputRef.current) {
      firstInputRef.current.focus()
    }
  }

  const applyTemplate = (templateName: keyof typeof quickTemplates) => {
    const template = quickTemplates[templateName]
    setFormData(prev => ({
      ...prev,
      ...template,
    }))
  }

  const addAroma = () => {
    if (currentAroma.trim()) {
      setFormData(prev => ({
        ...prev,
        aromas: [...(prev.aromas || []), currentAroma.trim()],
      }))
      setCurrentAroma('')
    }
  }

  const removeAroma = (index: number) => {
    setFormData(prev => ({
      ...prev,
      aromas: prev.aromas?.filter((_, i) => i !== index) || [],
    }))
  }

  const addFlavor = () => {
    if (currentFlavor.trim()) {
      setFormData(prev => ({
        ...prev,
        flavors: [...(prev.flavors || []), currentFlavor.trim()],
      }))
      setCurrentFlavor('')
    }
  }

  const removeFlavor = (index: number) => {
    setFormData(prev => ({
      ...prev,
      flavors: prev.flavors?.filter((_, i) => i !== index) || [],
    }))
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl my-8 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-wine-600 to-purple-600">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">DEV: Manual Wine Entry</h2>
                <p className="text-sm text-white/80">Keyboard-optimized rapid data entry</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden md:flex items-center gap-4 px-4 py-2 bg-white/10 rounded-lg backdrop-blur-sm text-white text-xs">
                <span><kbd className="px-1.5 py-0.5 bg-white/20 rounded">⌘S</kbd> Save</span>
                <span><kbd className="px-1.5 py-0.5 bg-white/20 rounded">⌘N</kbd> Clear</span>
                <span><kbd className="px-1.5 py-0.5 bg-white/20 rounded">Esc</kbd> Close</span>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/20 rounded-lg transition-colors text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Quick Templates */}
          <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-wine-600" />
              <span className="text-sm font-semibold text-gray-700">Quick Templates:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.keys(quickTemplates).map((template) => (
                <button
                  key={template}
                  onClick={() => applyTemplate(template as keyof typeof quickTemplates)}
                  className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-wine-50 hover:border-wine-300 hover:text-wine-700 transition-colors"
                >
                  {template}
                </button>
              ))}
            </div>
          </div>

          {/* Form */}
          <form ref={formRef} className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
            {/* Basic Info */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Wine className="w-5 h-5 text-wine-600" />
                Basic Information
              </h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Wine Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    ref={firstInputRef}
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className={`w-full px-4 py-2.5 border ${errors.name ? 'border-rose-500' : 'border-gray-300'} rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent`}
                    placeholder="e.g., Château Margaux"
                  />
                  {errors.name && (
                    <p className="mt-1 text-xs text-rose-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.name}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Producer <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.producer}
                    onChange={(e) => setFormData({ ...formData, producer: e.target.value })}
                    className={`w-full px-4 py-2.5 border ${errors.producer ? 'border-rose-500' : 'border-gray-300'} rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent`}
                    placeholder="e.g., Château Margaux"
                  />
                  {errors.producer && (
                    <p className="mt-1 text-xs text-rose-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.producer}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Vintage (optional)
                  </label>
                  <input
                    type="number"
                    value={formData.vintage || ''}
                    onChange={(e) => setFormData({ ...formData, vintage: e.target.value ? parseInt(e.target.value) : null })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                    placeholder="e.g., 2018"
                    min="1900"
                    max="2030"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Price per Bottle <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) })}
                    className={`w-full px-4 py-2.5 border ${errors.price ? 'border-rose-500' : 'border-gray-300'} rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent`}
                    placeholder="e.g., 95.00"
                    min="0"
                    step="0.01"
                  />
                  {errors.price && (
                    <p className="mt-1 text-xs text-rose-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.price}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Wine Type <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                  >
                    {wineTypes.map((type) => (
                      <option key={type} value={type}>
                        {type.charAt(0).toUpperCase() + type.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Grape Variety <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.grape}
                    onChange={(e) => setFormData({ ...formData, grape: e.target.value })}
                    className={`w-full px-4 py-2.5 border ${errors.grape ? 'border-rose-500' : 'border-gray-300'} rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent`}
                    placeholder="e.g., Cabernet Sauvignon"
                  />
                  {errors.grape && (
                    <p className="mt-1 text-xs text-rose-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.grape}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Location */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900">Location</h3>
              
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Country <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.country}
                    onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                    className={`w-full px-4 py-2.5 border ${errors.country ? 'border-rose-500' : 'border-gray-300'} rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent`}
                    placeholder="e.g., France"
                  />
                  {errors.country && (
                    <p className="mt-1 text-xs text-rose-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.country}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Region <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.region}
                    onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                    className={`w-full px-4 py-2.5 border ${errors.region ? 'border-rose-500' : 'border-gray-300'} rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent`}
                    placeholder="e.g., Bordeaux"
                  />
                  {errors.region && (
                    <p className="mt-1 text-xs text-rose-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.region}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Appellation
                  </label>
                  <input
                    type="text"
                    value={formData.appellation}
                    onChange={(e) => setFormData({ ...formData, appellation: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                    placeholder="e.g., Margaux AOC"
                  />
                </div>
              </div>
            </div>

            {/* Characteristics */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900">Characteristics</h3>
              
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
                  <select
                    value={formData.body}
                    onChange={(e) => setFormData({ ...formData, body: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                  >
                    {bodyOptions.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Sweetness</label>
                  <select
                    value={formData.sweetness}
                    onChange={(e) => setFormData({ ...formData, sweetness: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                  >
                    {sweetnessOptions.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Acidity</label>
                  <select
                    value={formData.acidity}
                    onChange={(e) => setFormData({ ...formData, acidity: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                  >
                    {acidityOptions.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Alcohol %</label>
                  <input
                    type="number"
                    value={formData.alcohol}
                    onChange={(e) => setFormData({ ...formData, alcohol: parseFloat(e.target.value) })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                    min="0"
                    max="20"
                    step="0.1"
                  />
                </div>
              </div>
            </div>

            {/* Aromas & Flavors */}
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Aromas</label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={currentAroma}
                    onChange={(e) => setCurrentAroma(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addAroma())}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                    placeholder="Type and press Enter"
                  />
                  <button
                    type="button"
                    onClick={addAroma}
                    className="p-2 bg-wine-600 text-white rounded-lg hover:bg-wine-700 transition-colors"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {formData.aromas?.map((aroma, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-wine-100 text-wine-700 rounded-full text-sm"
                    >
                      {aroma}
                      <button
                        type="button"
                        onClick={() => removeAroma(idx)}
                        className="hover:text-wine-900"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Flavors</label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={currentFlavor}
                    onChange={(e) => setCurrentFlavor(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addFlavor())}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                    placeholder="Type and press Enter"
                  />
                  <button
                    type="button"
                    onClick={addFlavor}
                    className="p-2 bg-wine-600 text-white rounded-lg hover:bg-wine-700 transition-colors"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {formData.flavors?.map((flavor, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm"
                    >
                      {flavor}
                      <button
                        type="button"
                        onClick={() => removeFlavor(idx)}
                        className="hover:text-purple-900"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Inventory */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900">Inventory</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Live Stock</label>
                  <input
                    type="number"
                    value={formData.liveStock || 0}
                    onChange={(e) => setFormData({ ...formData, liveStock: parseInt(e.target.value) })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                    min="0"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reorder Threshold</label>
                  <input
                    type="number"
                    value={formData.threshold}
                    onChange={(e) => setFormData({ ...formData, threshold: parseInt(e.target.value) })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                    min="0"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Bottle Size</label>
                  <select
                    value={isCustomBottleSize ? 'custom' : String(bottleSizeMl)}
                    onChange={(e) => {
                      if (e.target.value === 'custom') {
                        setIsCustomBottleSize(true)
                      } else {
                        setIsCustomBottleSize(false)
                        setCustomBottleSizeInput('')
                        setBottleSizeMl(Number(e.target.value))
                      }
                    }}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                  >
                    {COMMON_BOTTLE_SIZES.map((s) => (
                      <option key={s.ml} value={s.ml}>
                        {s.label} ({formatVolume(s.ml)})
                      </option>
                    ))}
                    <option value="custom">Custom...</option>
                  </select>
                  {isCustomBottleSize && (
                    <div className="mt-2">
                      <input
                        type="text"
                        value={customBottleSizeInput}
                        onChange={(e) => {
                          setCustomBottleSizeInput(e.target.value)
                          const parsed = parseVolumeInput(e.target.value)
                          if (parsed && isValidBottleSize(parsed.ml)) {
                            setBottleSizeMl(parsed.ml)
                          }
                        }}
                        placeholder="e.g. 750ml, 1.5L, 25.4oz"
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                      />
                      <p className={`text-xs mt-1 ${
                        customBottleParsed && isValidBottleSize(customBottleParsed.ml)
                          ? 'text-green-600'
                          : customBottleSizeInput ? 'text-red-500' : 'text-gray-400'
                      }`}>
                        {customBottleParsed && isValidBottleSize(customBottleParsed.ml)
                          ? `Parsed: ${customBottleParsed.ml}ml (${customBottleParsed.oz}oz)`
                          : customBottleSizeInput ? 'Invalid volume (50ml – 18000ml)' : 'Enter a volume'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Provider */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900">Provider Information</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Provider Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.provider?.name}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      provider: { ...formData.provider!, name: e.target.value }
                    })}
                    className={`w-full px-4 py-2.5 border ${errors.providerName ? 'border-rose-500' : 'border-gray-300'} rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent`}
                    placeholder="e.g., Fine Wine Imports"
                  />
                  {errors.providerName && (
                    <p className="mt-1 text-xs text-rose-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.providerName}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Contact Person <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.provider?.contact}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      provider: { ...formData.provider!, contact: e.target.value }
                    })}
                    className={`w-full px-4 py-2.5 border ${errors.providerContact ? 'border-rose-500' : 'border-gray-300'} rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent`}
                    placeholder="e.g., John Smith"
                  />
                  {errors.providerContact && (
                    <p className="mt-1 text-xs text-rose-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.providerContact}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Phone <span className="text-rose-500">*</span>
                  </label>
                  <PhoneNumberInput
                    value={formData.provider?.phone ?? ''}
                    onChange={(phone) => setFormData({
                      ...formData,
                      provider: { ...formData.provider!, phone },
                    })}
                    invalid={Boolean(errors.providerPhone)}
                  />
                  {errors.providerPhone && (
                    <p className="mt-1 text-xs text-rose-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.providerPhone}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={formData.provider?.email}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      provider: { ...formData.provider!, email: e.target.value }
                    })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                    placeholder="e.g., john@finewine.com"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                  <input
                    type="text"
                    value={formData.provider?.address}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      provider: { ...formData.provider!, address: e.target.value }
                    })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                    placeholder="e.g., 123 Wine St, Napa, CA 94558"
                  />
                </div>
              </div>
            </div>
          </form>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {saveSuccess && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-100 text-emerald-700 rounded-lg"
                >
                  <Check className="w-5 h-5" />
                  <span className="font-medium">Wine saved successfully!</span>
                </motion.div>
              )}
            </div>
            
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleClear}
                disabled={saving}
                className="px-5 py-2.5 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Clear Form
              </button>
              
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2.5 bg-wine-600 text-white font-medium rounded-xl hover:bg-wine-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                    >
                      <Save className="w-5 h-5" />
                    </motion.div>
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-5 h-5" />
                    Save Wine
                  </>
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

