import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Building2,
  User,
  Phone,
  Mail,
  Globe,
  MapPin,
  DollarSign,
  FileText,
  Star,
  AlertCircle,
  Trash2,
  Truck,
  Download,
  Package,
  ChevronDown,
  Tag,
  UserPlus,
  Save,
  Edit,
} from 'lucide-react'
import type { Provider } from '../../services/api/providers'

export interface EditProviderData {
  id: string
  name: string
  contactPerson: string
  phone: string
  email: string
  website: string
  address: string
  primaryBusinessType: string
  specialties: string[]
  paymentTerms: string
  deliveryDays: string[]
  minimumOrder: number | null
  notes: string
  rating: number
  contacts: ProviderContactEntry[]
}

export interface ProviderContactEntry {
  id: string
  name: string
  role: string
  phone: string
  email: string
  isPrimary: boolean
  tag: string // e.g. "Main phone line for X provider"
}

interface EditProviderModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (provider: EditProviderData) => void
  provider: Provider | null
}

const WINE_SPECIALTIES = [
  'Red Wines', 'White Wines', 'Sparkling Wines', 'Rose Wines', 'Dessert Wines',
  'French Wines', 'Italian Wines', 'Spanish Wines', 'California Wines',
  'Oregon Wines', 'Washington Wines', 'Organic/Biodynamic', 'Premium/Luxury', 'Value Wines',
]

const DELIVERY_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const PAYMENT_TERMS = ['Net 15', 'Net 30', 'Net 45', 'Net 60', 'Net 90', 'COD (Cash on Delivery)', '2/10 Net 30', 'Custom']

const CONTACT_ROLES = ['Primary Contact', 'Sales Rep', 'Broker', 'Account Manager', 'Owner', 'Billing', 'Delivery Coordinator', 'Other']

function buildInitialContacts(provider: Provider | null): ProviderContactEntry[] {
  if (!provider) return []
  const contacts: ProviderContactEntry[] = []

  // Add the primary contact from the provider itself
  if (provider.phone || provider.email) {
    contacts.push({
      id: `primary-${provider.id}`,
      name: (provider as any).contactPerson || provider.name,
      role: 'Primary Contact',
      phone: provider.phone || '',
      email: provider.email || '',
      isPrimary: true,
      tag: `Main line for ${provider.name}`,
    })
  }

  // Add known personnel as additional contacts
  if (provider.knownPersonnel && provider.knownPersonnel.length > 0) {
    provider.knownPersonnel.forEach((person, idx) => {
      contacts.push({
        id: `personnel-${idx}-${Date.now()}`,
        name: person,
        role: 'Sales Rep',
        phone: '',
        email: '',
        isPrimary: false,
        tag: `${person} at ${provider.name}`,
      })
    })
  }

  return contacts
}

export function EditProviderModal({ isOpen, onClose, onSave, provider }: EditProviderModalProps) {
  const [formData, setFormData] = useState<EditProviderData>({
    id: '',
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
    contacts: [],
  })

  const [validationErrors, setValidationErrors] = useState<{ [key: string]: string }>({})
  const [activeTab, setActiveTab] = useState<'details' | 'contacts'>('details')
  const [expandedContactId, setExpandedContactId] = useState<string | null>(null)

  // Populate form from provider
  useEffect(() => {
    if (provider && isOpen) {
      setFormData({
        id: provider.id,
        name: provider.name,
        contactPerson: (provider as any).contactPerson || '',
        phone: provider.phone || '',
        email: provider.email || '',
        website: provider.website || '',
        address: provider.physicalAddress || '',
        primaryBusinessType: provider.primaryBusinessType || 'Distributor',
        specialties: (provider as any).specialties || [],
        paymentTerms: (provider as any).paymentTerms || 'Net 30',
        deliveryDays: (provider as any).deliveryDays || [],
        minimumOrder: (provider as any).minimumOrderValue || null,
        notes: provider.notes || '',
        rating: provider.rating || 0,
        contacts: buildInitialContacts(provider),
      })
      setActiveTab('details')
      setValidationErrors({})
    }
  }, [provider, isOpen])

  const handleClose = () => {
    setValidationErrors({})
    onClose()
  }

  const validate = (): boolean => {
    const errors: { [key: string]: string } = {}
    if (!formData.name.trim()) errors.name = 'Provider name is required'
    if (!formData.email.trim()) {
      errors.email = 'Email is required'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Invalid email format'
    }
    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSave = () => {
    if (!validate()) return
    onSave(formData)
    handleClose()
  }

  const addContact = () => {
    const newContact: ProviderContactEntry = {
      id: `new-${Date.now()}`,
      name: '',
      role: 'Sales Rep',
      phone: '',
      email: '',
      isPrimary: false,
      tag: '',
    }
    setFormData(prev => ({
      ...prev,
      contacts: [...prev.contacts, newContact],
    }))
    setExpandedContactId(newContact.id)
  }

  const updateContact = (contactId: string, updates: Partial<ProviderContactEntry>) => {
    setFormData(prev => ({
      ...prev,
      contacts: prev.contacts.map(c => c.id === contactId ? { ...c, ...updates } : c),
    }))
  }

  const removeContact = (contactId: string) => {
    setFormData(prev => ({
      ...prev,
      contacts: prev.contacts.filter(c => c.id !== contactId),
    }))
  }

  const setPrimaryContact = (contactId: string) => {
    setFormData(prev => ({
      ...prev,
      contacts: prev.contacts.map(c => ({
        ...c,
        isPrimary: c.id === contactId,
      })),
    }))
  }

  const toggleSpecialty = (specialty: string) => {
    setFormData(prev => ({
      ...prev,
      specialties: prev.specialties.includes(specialty)
        ? prev.specialties.filter(s => s !== specialty)
        : [...prev.specialties, specialty],
    }))
  }

  const toggleDeliveryDay = (day: string) => {
    setFormData(prev => ({
      ...prev,
      deliveryDays: prev.deliveryDays.includes(day)
        ? prev.deliveryDays.filter(d => d !== day)
        : [...prev.deliveryDays, day],
    }))
  }

  if (!isOpen || !provider) return null

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
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-amber-50 to-orange-50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-600 rounded-xl">
                <Edit className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Edit Provider</h2>
                <p className="text-sm text-gray-500">{provider.name}</p>
              </div>
            </div>
            <button onClick={handleClose} className="p-2 hover:bg-white/50 rounded-lg transition-colors">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-200 px-6">
            <button
              onClick={() => setActiveTab('details')}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'details'
                  ? 'border-amber-600 text-amber-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                Details
              </div>
            </button>
            <button
              onClick={() => setActiveTab('contacts')}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'contacts'
                  ? 'border-amber-600 text-amber-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <User className="w-4 h-4" />
                Contacts ({formData.contacts.length})
              </div>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'details' ? (
              <div className="space-y-6">
                {/* Basic Information */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-amber-600" />
                    Basic Information
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Provider Name <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className={`w-full px-4 py-3 border rounded-xl bg-white text-gray-900 focus:ring-2 focus:ring-amber-500 ${validationErrors.name ? 'border-rose-500' : 'border-gray-200'}`}
                      />
                      {validationErrors.name && (
                        <p className="text-sm text-rose-600 mt-1 flex items-center gap-1">
                          <AlertCircle className="w-4 h-4" />{validationErrors.name}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                          type="tel"
                          value={formData.phone}
                          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                          className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl bg-white text-gray-900 focus:ring-2 focus:ring-amber-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Email <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                          type="email"
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          className={`w-full pl-10 pr-4 py-3 border rounded-xl bg-white text-gray-900 focus:ring-2 focus:ring-amber-500 ${validationErrors.email ? 'border-rose-500' : 'border-gray-200'}`}
                        />
                      </div>
                      {validationErrors.email && (
                        <p className="text-sm text-rose-600 mt-1 flex items-center gap-1">
                          <AlertCircle className="w-4 h-4" />{validationErrors.email}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Website</label>
                      <div className="relative">
                        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                          type="url"
                          value={formData.website}
                          onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                          className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl bg-white text-gray-900 focus:ring-2 focus:ring-amber-500"
                        />
                      </div>
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Address</label>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                        <textarea
                          value={formData.address}
                          onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                          className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl bg-white text-gray-900 focus:ring-2 focus:ring-amber-500 resize-none"
                          rows={2}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Business Type */}
                <div className="pt-6 border-t border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <Tag className="w-5 h-5 text-amber-600" />
                    Business Type & Tags
                  </h3>
                  <div className="flex flex-wrap gap-3 mb-4">
                    {['Distributor', 'Importer', 'Wholesaler'].map(type => {
                      const isSelected = formData.primaryBusinessType === type
                      const Icon = type === 'Distributor' ? Truck : type === 'Importer' ? Download : Package
                      return (
                        <button
                          key={type}
                          onClick={() => setFormData({ ...formData, primaryBusinessType: type })}
                          className={`px-4 py-3 rounded-xl border-2 transition-all flex items-center gap-2 ${
                            isSelected ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-amber-300'
                          }`}
                        >
                          <Icon className={`w-5 h-5 ${isSelected ? 'text-amber-600' : 'text-gray-400'}`} />
                          <span className={`text-sm font-medium ${isSelected ? 'text-amber-900' : 'text-gray-700'}`}>{type}</span>
                        </button>
                      )
                    })}
                  </div>

                  {/* Specialties */}
                  <label className="block text-sm font-medium text-gray-700 mb-2">Wine Specialties</label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {WINE_SPECIALTIES.map(specialty => {
                      const isSelected = formData.specialties.includes(specialty)
                      return (
                        <button
                          key={specialty}
                          onClick={() => toggleSpecialty(specialty)}
                          className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                            isSelected ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {specialty}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Terms & Logistics */}
                <div className="pt-6 border-t border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-amber-600" />
                    Terms & Logistics
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Payment Terms</label>
                      <select
                        value={formData.paymentTerms}
                        onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-white text-gray-900 focus:ring-2 focus:ring-amber-500"
                      >
                        {PAYMENT_TERMS.map(term => (
                          <option key={term} value={term}>{term}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Minimum Order</label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                          type="number"
                          value={formData.minimumOrder || ''}
                          onChange={(e) => setFormData({ ...formData, minimumOrder: e.target.value ? parseFloat(e.target.value) : null })}
                          className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl bg-white text-gray-900 focus:ring-2 focus:ring-amber-500"
                          placeholder="0.00"
                          min={0}
                          step={0.01}
                        />
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Delivery Days</label>
                      <div className="flex flex-wrap gap-2">
                        {DELIVERY_DAYS.map(day => {
                          const isSelected = formData.deliveryDays.includes(day)
                          return (
                            <button
                              key={day}
                              onClick={() => toggleDeliveryDay(day)}
                              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                                isSelected ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                              }`}
                            >
                              {day.slice(0, 3)}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Rating & Notes */}
                <div className="pt-6 border-t border-gray-200">
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Rating</label>
                    <div className="flex items-center gap-2">
                      {[1, 2, 3, 4, 5].map(rating => (
                        <button
                          key={rating}
                          onClick={() => setFormData({ ...formData, rating })}
                          className="p-1 hover:scale-110 transition-transform"
                        >
                          <Star className={`w-7 h-7 transition-colors ${
                            rating <= formData.rating ? 'fill-amber-500 text-amber-500' : 'text-gray-300'
                          }`} />
                        </button>
                      ))}
                      <span className="ml-2 text-sm text-gray-600">
                        {formData.rating === 0 ? 'No rating' : `${formData.rating} star${formData.rating !== 1 ? 's' : ''}`}
                      </span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
                    <textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-white text-gray-900 focus:ring-2 focus:ring-amber-500 resize-none"
                      rows={3}
                    />
                  </div>
                </div>
              </div>
            ) : (
              /* Contacts Tab */
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Provider Contacts</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Manage multiple contacts for this provider. Each contact has a tag for easy identification.
                    </p>
                  </div>
                  <button
                    onClick={addContact}
                    className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white font-medium rounded-xl hover:bg-amber-700 transition-colors"
                  >
                    <UserPlus className="w-4 h-4" />
                    Add Contact
                  </button>
                </div>

                {formData.contacts.length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
                    <User className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 font-medium">No contacts yet</p>
                    <p className="text-sm text-gray-400 mt-1">Add contacts to manage multiple phone numbers and emails</p>
                    <button
                      onClick={addContact}
                      className="mt-4 px-4 py-2 bg-amber-600 text-white font-medium rounded-lg hover:bg-amber-700 transition-colors text-sm"
                    >
                      Add First Contact
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {formData.contacts.map((contact) => (
                      <div
                        key={contact.id}
                        className={`border rounded-xl overflow-hidden transition-all ${
                          contact.isPrimary ? 'border-amber-300 bg-amber-50/50' : 'border-gray-200 bg-white'
                        }`}
                      >
                        {/* Contact Header - always visible */}
                        <div
                          className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50/50 transition-colors"
                          onClick={() => setExpandedContactId(expandedContactId === contact.id ? null : contact.id)}
                        >
                          <div className={`p-2 rounded-lg ${contact.isPrimary ? 'bg-amber-200' : 'bg-gray-100'}`}>
                            <User className={`w-4 h-4 ${contact.isPrimary ? 'text-amber-700' : 'text-gray-500'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-gray-900 truncate">
                                {contact.name || 'Unnamed Contact'}
                              </span>
                              {contact.isPrimary && (
                                <span className="px-2 py-0.5 bg-amber-200 text-amber-800 text-xs font-medium rounded-full">
                                  Primary
                                </span>
                              )}
                              <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-full">
                                {contact.role}
                              </span>
                            </div>
                            <p className="text-sm text-gray-500 truncate mt-0.5">
                              {contact.tag || `${contact.phone || 'No phone'} | ${contact.email || 'No email'}`}
                            </p>
                          </div>
                          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${
                            expandedContactId === contact.id ? 'rotate-180' : ''
                          }`} />
                        </div>

                        {/* Expanded Details */}
                        <AnimatePresence>
                          {expandedContactId === contact.id && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                                    <input
                                      type="text"
                                      value={contact.name}
                                      onChange={(e) => updateContact(contact.id, { name: e.target.value })}
                                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                                      placeholder="John Smith"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                                    <select
                                      value={contact.role}
                                      onChange={(e) => updateContact(contact.id, { role: e.target.value })}
                                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                                    >
                                      {CONTACT_ROLES.map(role => (
                                        <option key={role} value={role}>{role}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                                    <div className="relative">
                                      <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                      <input
                                        type="tel"
                                        value={contact.phone}
                                        onChange={(e) => updateContact(contact.id, { phone: e.target.value })}
                                        className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                                        placeholder="(555) 123-4567"
                                      />
                                    </div>
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                                    <div className="relative">
                                      <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                      <input
                                        type="email"
                                        value={contact.email}
                                        onChange={(e) => updateContact(contact.id, { email: e.target.value })}
                                        className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                                        placeholder="contact@example.com"
                                      />
                                    </div>
                                  </div>
                                  <div className="md:col-span-2">
                                    <label className="block text-xs font-medium text-gray-600 mb-1">
                                      Tag <span className="text-gray-400">(display label)</span>
                                    </label>
                                    <input
                                      type="text"
                                      value={contact.tag}
                                      onChange={(e) => updateContact(contact.id, { tag: e.target.value })}
                                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                                      placeholder={`e.g., "Main phone line for ${formData.name}" or "Broker - ${contact.name}"`}
                                    />
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 pt-2">
                                  {!contact.isPrimary && (
                                    <button
                                      onClick={() => setPrimaryContact(contact.id)}
                                      className="text-xs px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 transition-colors font-medium"
                                    >
                                      Set as Primary
                                    </button>
                                  )}
                                  <button
                                    onClick={() => removeContact(contact.id)}
                                    className="text-xs px-3 py-1.5 bg-rose-100 text-rose-700 rounded-lg hover:bg-rose-200 transition-colors font-medium flex items-center gap-1"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    Remove
                                  </button>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
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
                className="flex-1 py-3 bg-amber-600 text-white font-semibold rounded-xl hover:bg-amber-700 shadow-lg shadow-amber-600/30 transition-all flex items-center justify-center gap-2"
              >
                <Save className="w-5 h-5" />
                Save Changes
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
