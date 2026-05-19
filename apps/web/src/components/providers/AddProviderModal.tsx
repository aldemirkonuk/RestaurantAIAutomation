import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Building2,
  User,
  Mail,
  Globe,
  MapPin,
  DollarSign,
  Truck,
  Package,
  Download,
  FileText,
  Star,
  AlertCircle,
  CheckCircle,
  Plus,
  Store,
  Warehouse,
  Factory,
  ShoppingBag,
  Wine,
  Grape,
} from 'lucide-react'
import { PhoneNumberInput } from '../ui/PhoneNumberInput'
import { isValidPhone } from '../../lib/phone'

interface AddProviderModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (provider: NewProviderData) => void
}

// Custom provider type stored in localStorage
interface CustomProviderType {
  id: string
  name: string
  icon: string
}

// Default built-in types
const DEFAULT_BUSINESS_TYPES = ['Distributor', 'Importer', 'Wholesaler'] as const
type DefaultBusinessType = typeof DEFAULT_BUSINESS_TYPES[number]

// localStorage key for custom types
const CUSTOM_TYPES_KEY = 'wineops_custom_provider_types'

// Available icons for custom types
const AVAILABLE_ICONS = [
  { id: 'Store', icon: Store, label: 'Store' },
  { id: 'Warehouse', icon: Warehouse, label: 'Warehouse' },
  { id: 'Factory', icon: Factory, label: 'Factory' },
  { id: 'ShoppingBag', icon: ShoppingBag, label: 'Shopping Bag' },
  { id: 'Wine', icon: Wine, label: 'Wine' },
  { id: 'Grape', icon: Grape, label: 'Grape' },
  { id: 'Building2', icon: Building2, label: 'Building' },
  { id: 'Package', icon: Package, label: 'Package' },
]

// Helper functions for localStorage
function loadCustomTypes(): CustomProviderType[] {
  try {
    const stored = localStorage.getItem(CUSTOM_TYPES_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveCustomTypes(types: CustomProviderType[]) {
  localStorage.setItem(CUSTOM_TYPES_KEY, JSON.stringify(types))
}

export interface NewProviderData {
  name: string
  contactPerson: string
  phone: string
  email: string
  website: string
  address: string
  primaryBusinessType: string // Now accepts custom types too
  specialties: string[]
  paymentTerms: string
  deliveryDays: string[]
  minimumOrder: number | null
  notes: string
  rating: number
  accountNumber?: string
}

const WINE_SPECIALTIES = [
  'Red Wines',
  'White Wines',
  'Sparkling Wines',
  'Rosé Wines',
  'Dessert Wines',
  'French Wines',
  'Italian Wines',
  'Spanish Wines',
  'California Wines',
  'Oregon Wines',
  'Washington Wines',
  'Organic/Biodynamic',
  'Premium/Luxury',
  'Value Wines',
]

const DELIVERY_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const PAYMENT_TERMS = [
  'Net 15',
  'Net 30',
  'Net 45',
  'Net 60',
  'Net 90',
  'COD (Cash on Delivery)',
  '2/10 Net 30',
  'Custom',
]

export function AddProviderModal({ isOpen, onClose, onSave }: AddProviderModalProps) {
  const [formData, setFormData] = useState<NewProviderData>({
    name: '',
    contactPerson: '',
    phone: '',
    email: '',
    website: '',
    address: '',
    primaryBusinessType: 'Distributor',
    specialties: [],
    paymentTerms: 'Net 30',
    deliveryDays: [],
    minimumOrder: null,
    notes: '',
    rating: 0,
  })

  const [validationErrors, setValidationErrors] = useState<{[key: string]: string}>({})
  
  // Custom provider types state
  const [customTypes, setCustomTypes] = useState<CustomProviderType[]>(loadCustomTypes())
  const [showAddTypeModal, setShowAddTypeModal] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeIcon, setNewTypeIcon] = useState('Store')
  const [typeError, setTypeError] = useState('')

  // Load custom types on mount
  useEffect(() => {
    setCustomTypes(loadCustomTypes())
  }, [])

  // Save custom types when they change
  useEffect(() => {
    saveCustomTypes(customTypes)
  }, [customTypes])

  const handleAddCustomType = () => {
    if (!newTypeName.trim()) {
      setTypeError('Type name is required')
      return
    }
    if (DEFAULT_BUSINESS_TYPES.includes(newTypeName as DefaultBusinessType) || 
        customTypes.some(t => t.name.toLowerCase() === newTypeName.toLowerCase())) {
      setTypeError('This type already exists')
      return
    }

    const newType: CustomProviderType = {
      id: `custom-${Date.now()}`,
      name: newTypeName.trim(),
      icon: newTypeIcon,
    }

    setCustomTypes(prev => [...prev, newType])
    setFormData(prev => ({ ...prev, primaryBusinessType: newType.name }))
    setNewTypeName('')
    setNewTypeIcon('Store')
    setTypeError('')
    setShowAddTypeModal(false)
  }

  const handleDeleteCustomType = (typeId: string) => {
    const typeToDelete = customTypes.find(t => t.id === typeId)
    setCustomTypes(prev => prev.filter(t => t.id !== typeId))
    
    // If the deleted type was selected, reset to Distributor
    if (typeToDelete && formData.primaryBusinessType === typeToDelete.name) {
      setFormData(prev => ({ ...prev, primaryBusinessType: 'Distributor' }))
    }
  }

  const handleClose = () => {
    // Reset form
    setFormData({
      name: '',
      contactPerson: '',
      phone: '',
      email: '',
      website: '',
      address: '',
      primaryBusinessType: 'Distributor',
      specialties: [],
      paymentTerms: 'Net 30',
      deliveryDays: [],
      minimumOrder: null,
      notes: '',
      rating: 0,
    })
    setValidationErrors({})
    onClose()
  }

  const toggleSpecialty = (specialty: string) => {
    setFormData(prev => ({
      ...prev,
      specialties: prev.specialties.includes(specialty)
        ? prev.specialties.filter(s => s !== specialty)
        : [...prev.specialties, specialty]
    }))
  }

  const toggleDeliveryDay = (day: string) => {
    setFormData(prev => ({
      ...prev,
      deliveryDays: prev.deliveryDays.includes(day)
        ? prev.deliveryDays.filter(d => d !== day)
        : [...prev.deliveryDays, day]
    }))
  }

  const validate = (): boolean => {
    const errors: {[key: string]: string} = {}

    if (!formData.name.trim()) {
      errors.name = 'Provider name is required'
    }
    if (!formData.contactPerson.trim()) {
      errors.contactPerson = 'Contact person is required'
    }
    if (!formData.phone.trim()) {
      errors.phone = 'Phone number is required'
    } else if (!isValidPhone(formData.phone)) {
      errors.phone = 'Enter a valid phone number'
    }
    if (!formData.email.trim()) {
      errors.email = 'Email is required'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Invalid email format'
    }
    if (formData.specialties.length === 0) {
      errors.specialties = 'Select at least one specialty'
    }
    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSave = () => {
    if (!validate()) return
    onSave(formData)
    handleClose()
  }

  const getBusinessTypeIcon = (type: string, customIconId?: string) => {
    // Check default types first
    switch (type) {
      case 'Distributor':
        return Truck
      case 'Importer':
        return Download
      case 'Wholesaler':
        return Package
    }
    
    // Check custom types
    if (customIconId) {
      const iconConfig = AVAILABLE_ICONS.find(i => i.id === customIconId)
      if (iconConfig) return iconConfig.icon
    }
    
    // Check if it's a custom type by name
    const customType = customTypes.find(t => t.name === type)
    if (customType) {
      const iconConfig = AVAILABLE_ICONS.find(i => i.id === customType.icon)
      if (iconConfig) return iconConfig.icon
    }
    
    return Building2
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={handleClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600 rounded-xl">
                <Plus className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Add New Provider</h2>
                <p className="text-sm text-gray-500">Add a wine distributor, importer, or wholesaler</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-white/50 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-6">
              {/* Basic Information */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-blue-600" />
                  Basic Information
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Provider Name */}
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Provider Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                      className={`w-full px-4 py-3 border rounded-xl bg-white text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-blue-500 ${validationErrors.name ? 'border-rose-500' : 'border-gray-200'}`}
                      placeholder="e.g., Premium Wine Distributors"
                    />
                    {validationErrors.name && (
                      <p className="text-sm text-rose-600 mt-1 flex items-center gap-1">
                        <AlertCircle className="w-4 h-4" />
                        {validationErrors.name}
                      </p>
                    )}
                  </div>

                  {/* Contact Person */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Contact Person <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type="text"
                        value={formData.contactPerson}
                        onChange={(e) => setFormData({...formData, contactPerson: e.target.value})}
                        className={`w-full pl-10 pr-4 py-3 border rounded-xl bg-white text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-blue-500 ${validationErrors.contactPerson ? 'border-rose-500' : 'border-gray-200'}`}
                        placeholder="John Smith"
                      />
                    </div>
                    {validationErrors.contactPerson && (
                      <p className="text-xs text-rose-600 mt-1">{validationErrors.contactPerson}</p>
                    )}
                  </div>

                  {/* Phone */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Phone <span className="text-rose-500">*</span>
                    </label>
                    <PhoneNumberInput
                      value={formData.phone}
                      onChange={(phone) => setFormData({ ...formData, phone })}
                      invalid={Boolean(validationErrors.phone)}
                    />
                    {validationErrors.phone && (
                      <p className="text-xs text-rose-600 mt-1">{validationErrors.phone}</p>
                    )}
                  </div>

                  {/* Email */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Email <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({...formData, email: e.target.value})}
                        className={`w-full pl-10 pr-4 py-3 border rounded-xl bg-white text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-blue-500 ${validationErrors.email ? 'border-rose-500' : 'border-gray-200'}`}
                        placeholder="contact@provider.com"
                      />
                    </div>
                    {validationErrors.email && (
                      <p className="text-xs text-rose-600 mt-1">{validationErrors.email}</p>
                    )}
                  </div>

                  {/* Website */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Website
                    </label>
                    <div className="relative">
                      <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type="url"
                        value={formData.website}
                        onChange={(e) => setFormData({...formData, website: e.target.value})}
                        className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl bg-white text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-blue-500"
                        placeholder="https://www.provider.com"
                      />
                    </div>
                  </div>

                  {/* Address */}
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Physical Address
                    </label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                      <textarea
                        value={formData.address}
                        onChange={(e) => setFormData({...formData, address: e.target.value})}
                        className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl bg-white text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-blue-500 resize-none"
                        placeholder="123 Main St, City, State, ZIP"
                        rows={2}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Business Details */}
              <div className="pt-6 border-t border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Package className="w-5 h-5 text-blue-600" />
                  Business Details
                </h3>
                
                {/* Business Type */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Primary Business Type
                  </label>
                  <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
                    {/* Default business types */}
                    {DEFAULT_BUSINESS_TYPES.map((type) => {
                      const Icon = getBusinessTypeIcon(type)
                      const isSelected = formData.primaryBusinessType === type
                      return (
                        <button
                          key={type}
                          onClick={() => setFormData({...formData, primaryBusinessType: type})}
                          className={`p-4 rounded-xl border-2 transition-all ${
                            isSelected
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                          }`}
                        >
                          <Icon className={`w-6 h-6 mx-auto mb-2 ${isSelected ? 'text-blue-600' : 'text-gray-400'}`} />
                          <p className={`text-sm font-medium ${isSelected ? 'text-blue-900' : 'text-gray-700'}`}>
                            {type}
                          </p>
                        </button>
                      )
                    })}

                    {/* Custom business types */}
                    {customTypes.map((customType) => {
                      const Icon = getBusinessTypeIcon(customType.name, customType.icon)
                      const isSelected = formData.primaryBusinessType === customType.name
                      return (
                        <div key={customType.id} className="relative group">
                          <button
                            onClick={() => setFormData({...formData, primaryBusinessType: customType.name})}
                            className={`w-full p-4 rounded-xl border-2 transition-all ${
                              isSelected
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                            }`}
                          >
                            <Icon className={`w-6 h-6 mx-auto mb-2 ${isSelected ? 'text-blue-600' : 'text-gray-400'}`} />
                            <p className={`text-sm font-medium truncate ${isSelected ? 'text-blue-900' : 'text-gray-700'}`}>
                              {customType.name}
                            </p>
                          </button>
                          {/* Delete button for custom types */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteCustomType(customType.id)
                            }}
                            className="absolute -top-2 -right-2 p-1 bg-rose-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg hover:bg-rose-600"
                            title="Delete custom type"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )
                    })}

                    {/* Add Type Button */}
                    <button
                      onClick={() => setShowAddTypeModal(true)}
                      className="p-4 rounded-xl border-2 border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50/50 transition-all group"
                    >
                      <Plus className="w-6 h-6 mx-auto mb-2 text-gray-400 group-hover:text-blue-500" />
                      <p className="text-sm font-medium text-gray-500 group-hover:text-blue-600">
                        Add Type
                      </p>
                    </button>
                  </div>
                </div>

                {/* Add Custom Type Modal */}
                <AnimatePresence>
                  {showAddTypeModal && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
                      onClick={() => setShowAddTypeModal(false)}
                    >
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        onClick={(e) => e.stopPropagation()}
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
                      >
                        {/* Modal Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-purple-50">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-indigo-600 rounded-xl">
                              <Plus className="w-5 h-5 text-white" />
                            </div>
                            <div>
                              <h3 className="text-lg font-bold text-gray-900">Add Provider Type</h3>
                              <p className="text-sm text-gray-500">Create a custom business type</p>
                            </div>
                          </div>
                          <button
                            onClick={() => setShowAddTypeModal(false)}
                            className="p-2 hover:bg-white/50 rounded-lg transition-colors"
                          >
                            <X className="w-5 h-5 text-gray-500" />
                          </button>
                        </div>

                        {/* Modal Content */}
                        <div className="p-6 space-y-4">
                          {/* Type Name */}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Type Name <span className="text-rose-500">*</span>
                            </label>
                            <input
                              type="text"
                              value={newTypeName}
                              onChange={(e) => {
                                setNewTypeName(e.target.value)
                                setTypeError('')
                              }}
                              className={`w-full px-4 py-3 border rounded-xl bg-white text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-indigo-500 ${typeError ? 'border-rose-500' : 'border-gray-200'}`}
                              placeholder="e.g., Broker, Agent, Direct Producer"
                            />
                            {typeError && (
                              <p className="text-sm text-rose-600 mt-1 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {typeError}
                              </p>
                            )}
                          </div>

                          {/* Icon Selection */}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Select Icon
                            </label>
                            <div className="grid grid-cols-4 gap-2">
                              {AVAILABLE_ICONS.map((iconOption) => {
                                const IconComponent = iconOption.icon
                                const isSelected = newTypeIcon === iconOption.id
                                return (
                                  <button
                                    key={iconOption.id}
                                    onClick={() => setNewTypeIcon(iconOption.id)}
                                    className={`p-3 rounded-xl border-2 transition-all flex flex-col items-center gap-1 ${
                                      isSelected
                                        ? 'border-indigo-500 bg-indigo-50'
                                        : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
                                    }`}
                                    title={iconOption.label}
                                  >
                                    <IconComponent className={`w-5 h-5 ${isSelected ? 'text-indigo-600' : 'text-gray-400'}`} />
                                    <span className={`text-xs truncate ${isSelected ? 'text-indigo-700' : 'text-gray-500'}`}>
                                      {iconOption.label}
                                    </span>
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex gap-3">
                          <button
                            onClick={() => {
                              setShowAddTypeModal(false)
                              setNewTypeName('')
                              setTypeError('')
                            }}
                            className="px-4 py-2 border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-100 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleAddCustomType}
                            className="flex-1 py-2 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2"
                          >
                            <CheckCircle className="w-5 h-5" />
                            Add Type
                          </button>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Specialties */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Wine Specialties <span className="text-rose-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {WINE_SPECIALTIES.map((specialty) => {
                      const isSelected = formData.specialties.includes(specialty)
                      return (
                        <button
                          key={specialty}
                          onClick={() => toggleSpecialty(specialty)}
                          className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                            isSelected
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {specialty}
                        </button>
                      )
                    })}
                  </div>
                  {validationErrors.specialties && (
                    <p className="text-sm text-rose-600 mt-2 flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />
                      {validationErrors.specialties}
                    </p>
                  )}
                </div>
              </div>

              {/* Terms & Logistics */}
              <div className="pt-6 border-t border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-600" />
                  Terms & Logistics
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Payment Terms */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Payment Terms
                    </label>
                    <select
                      value={formData.paymentTerms}
                      onChange={(e) => setFormData({...formData, paymentTerms: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-white text-gray-900 focus:ring-2 focus:ring-blue-500"
                    >
                      {PAYMENT_TERMS.map(term => (
                        <option key={term} value={term}>{term}</option>
                      ))}
                    </select>
                  </div>

                  {/* Minimum Order */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Minimum Order Amount
                    </label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type="number"
                        value={formData.minimumOrder || ''}
                        onChange={(e) => setFormData({...formData, minimumOrder: e.target.value ? parseFloat(e.target.value) : null})}
                        className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl bg-white text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-blue-500"
                        placeholder="0.00"
                        min={0}
                        step={0.01}
                      />
                    </div>
                  </div>

                  {/* Delivery Days */}
                  <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Delivery Days <span className="text-gray-400 text-xs">(optional)</span>
                  </label>
                    <div className="flex flex-wrap gap-2">
                      {DELIVERY_DAYS.map((day) => {
                        const isSelected = formData.deliveryDays.includes(day)
                        return (
                          <button
                            key={day}
                            onClick={() => toggleDeliveryDay(day)}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                              isSelected
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                          >
                            {day.slice(0, 3)}
                          </button>
                        )
                      })}
                    </div>
                    {validationErrors.deliveryDays && (
                      <p className="text-sm text-rose-600 mt-2 flex items-center gap-1">
                        <AlertCircle className="w-4 h-4" />
                        {validationErrors.deliveryDays}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Additional Information */}
              <div className="pt-6 border-t border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Additional Information
                </h3>
                
                {/* Rating */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Initial Rating
                  </label>
                  <div className="flex items-center gap-2">
                    {[1, 2, 3, 4, 5].map((rating) => (
                      <button
                        key={rating}
                        onClick={() => setFormData({...formData, rating})}
                        className="p-1 hover:scale-110 transition-transform"
                      >
                        <Star
                          className={`w-8 h-8 transition-colors ${
                            rating <= formData.rating
                              ? 'fill-amber-500 text-amber-500'
                              : 'text-gray-300'
                          }`}
                        />
                      </button>
                    ))}
                    <span className="ml-2 text-sm text-gray-600">
                      {formData.rating === 0 ? 'No rating' : `${formData.rating} star${formData.rating !== 1 ? 's' : ''}`}
                    </span>
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Internal Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({...formData, notes: e.target.value})}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-white text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-blue-500 resize-none"
                    placeholder="Add any internal notes about this provider..."
                    rows={3}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
            <div className="flex gap-3">
              <button
                onClick={handleClose}
                className="px-6 py-3 border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="flex-1 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle className="w-5 h-5" />
                Add Provider
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

