import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Building2,
  User,
  Mail,
  Globe,
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
  MapPin,
  Plus,
} from 'lucide-react'
import type { Provider } from '../../services/api/providers'
import { PhoneNumberInput } from '../ui/PhoneNumberInput'
import { PlacesAutocomplete, type PlaceResult } from '../ui/PlacesAutocomplete'
import { useAuth } from '../../contexts/AuthContext'

export interface ProviderLocation {
  id: string
  name: string
  type: 'office' | 'warehouse' | 'store' | 'other'
  address: string
  isPrimary: boolean
}

export interface EditProviderData {
  id: string
  name: string
  contactFirstName: string
  contactLastName: string
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
  locations: ProviderLocation[]
}

export interface ProviderContactEntry {
  id: string
  firstName: string
  lastName: string
  role: string
  phone: string
  phoneType: 'main_line' | 'cell' | 'direct' | 'whatsapp' | 'fax' | 'office'
  email: string
  isPrimary: boolean
  tag: string
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

const PHONE_TYPES = [
  { value: 'main_line', label: 'Main Line', emoji: '📞', color: 'bg-blue-100 text-blue-700' },
  { value: 'cell',      label: 'Cell',      emoji: '📱', color: 'bg-green-100 text-green-700' },
  { value: 'direct',    label: 'Direct',    emoji: '📲', color: 'bg-amber-100 text-amber-700' },
  { value: 'whatsapp',  label: 'WhatsApp',  emoji: '💬', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'fax',       label: 'Fax',       emoji: '📠', color: 'bg-gray-100 text-gray-600' },
  { value: 'office',    label: 'Office',    emoji: '🏢', color: 'bg-purple-100 text-purple-700' },
] as const

const LOCATION_TYPES = [
  { value: 'office',    label: 'Office' },
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'store',     label: 'Store' },
  { value: 'other',     label: 'Other' },
] as const

function toE164(phone: string | undefined | null): string {
  if (!phone) return ''
  if (phone.startsWith('+')) return phone
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}

function buildInitialContacts(provider: Provider | null): ProviderContactEntry[] {
  if (!provider) return []
  const contacts: ProviderContactEntry[] = []

  if (provider.phone || provider.email) {
    const rawName = (provider as any).contactPerson || provider.name
    const nameSpaceIdx = rawName.indexOf(' ')
    contacts.push({
      id: `primary-${provider.id}`,
      firstName: nameSpaceIdx > -1 ? rawName.slice(0, nameSpaceIdx) : rawName,
      lastName: nameSpaceIdx > -1 ? rawName.slice(nameSpaceIdx + 1) : '',
      role: 'Primary Contact',
      phone: toE164(provider.phone),
      phoneType: 'main_line',
      email: provider.email || '',
      isPrimary: true,
      tag: `Main line for ${provider.name}`,
    })
  }

  if (provider.knownPersonnel && provider.knownPersonnel.length > 0) {
    provider.knownPersonnel.forEach((person, idx) => {
      const personSpaceIdx = person.indexOf(' ')
      contacts.push({
        id: `personnel-${idx}-${Date.now()}`,
        firstName: personSpaceIdx > -1 ? person.slice(0, personSpaceIdx) : person,
        lastName: personSpaceIdx > -1 ? person.slice(personSpaceIdx + 1) : '',
        role: 'Sales Rep',
        phone: '',
        phoneType: 'main_line',
        email: '',
        isPrimary: false,
        tag: `${person} at ${provider.name}`,
      })
    })
  }

  return contacts
}

function buildInitialLocations(provider: Provider | null): ProviderLocation[] {
  if (!provider) return []
  const address = provider.physicalAddress || ''
  if (!address) return []
  return [{
    id: `primary-location-${provider.id}`,
    name: 'Main Office',
    type: 'office',
    address,
    isPrimary: true,
  }]
}

export function EditProviderModal({ isOpen, onClose, onSave, provider }: EditProviderModalProps) {
  const { user } = useAuth()

  const [formData, setFormData] = useState<EditProviderData>({
    id: '',
    name: '',
    contactFirstName: '',
    contactLastName: '',
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
    locations: [],
  })

  const [validationErrors, setValidationErrors] = useState<{ [key: string]: string }>({})
  const [activeTab, setActiveTab] = useState<'details' | 'contacts' | 'locations'>('details')
  const [expandedContactId, setExpandedContactId] = useState<string | null>(null)
  const [isEditingName, setIsEditingName] = useState(false)

  // Populate form from provider
  useEffect(() => {
    if (provider && isOpen) {
      const legacyName = (provider as any).primaryContact?.name || ''
      const spaceIdx = legacyName.indexOf(' ')
      const legacyFirst = spaceIdx > -1 ? legacyName.slice(0, spaceIdx) : legacyName
      const legacyLast  = spaceIdx > -1 ? legacyName.slice(spaceIdx + 1) : ''

      setFormData({
        id: provider.id,
        name: provider.name,
        contactFirstName: (provider as any).contactFirstName || legacyFirst,
        contactLastName:  (provider as any).contactLastName  || legacyLast,
        phone: toE164(provider.phone || (provider as any).primaryContact?.phone),
        email: provider.email || (provider as any).primaryContact?.email || '',
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
        locations: buildInitialLocations(provider),
      })
      setActiveTab('details')
      setValidationErrors({})
      setIsEditingName(false)
    }
  }, [provider, isOpen])

  // Auto-populate admin contact when contacts list is empty
  useEffect(() => {
    if (formData.contacts.length === 0 && user && isOpen) {
      const fullName = user.name || user.email.split('@')[0] || ''
      const spaceIdx = fullName.indexOf(' ')
      const adminFirstName = spaceIdx > -1 ? fullName.slice(0, spaceIdx) : fullName
      const adminLastName  = spaceIdx > -1 ? fullName.slice(spaceIdx + 1) : ''
      setFormData(prev => ({
        ...prev,
        contacts: [{
          id: `admin-${user.userId}`,
          firstName: adminFirstName,
          lastName: adminLastName,
          role: 'Primary Contact',
          phone: '',
          phoneType: 'main_line',
          email: user.email,
          isPrimary: true,
          tag: 'Primary restaurant contact',
        }],
      }))
    }
  }, [formData.contacts.length, user, isOpen])

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
      firstName: '',
      lastName: '',
      role: 'Sales Rep',
      phone: '',
      phoneType: 'main_line',
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

  const addLocation = () => {
    const newLocation: ProviderLocation = {
      id: `new-loc-${Date.now()}`,
      name: `Location ${formData.locations.length + 1}`,
      type: 'office',
      address: '',
      isPrimary: formData.locations.length === 0,
    }
    setFormData(prev => ({
      ...prev,
      locations: [...prev.locations, newLocation],
    }))
  }

  const updateLocation = (locationId: string, updates: Partial<ProviderLocation>) => {
    setFormData(prev => ({
      ...prev,
      locations: prev.locations.map(l => l.id === locationId ? { ...l, ...updates } : l),
    }))
  }

  const removeLocation = (locationId: string) => {
    setFormData(prev => {
      const updated = prev.locations.filter(l => l.id !== locationId)
      const removedWasPrimary = prev.locations.find(l => l.id === locationId)?.isPrimary ?? false
      if (removedWasPrimary && updated.length > 0) {
        updated[0] = { ...updated[0], isPrimary: true }
      }
      return { ...prev, locations: updated }
    })
  }

  const setPrimaryLocation = (locationId: string) => {
    setFormData(prev => ({
      ...prev,
      locations: prev.locations.map(l => ({
        ...l,
        isPrimary: l.id === locationId,
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
              <div className="p-2 bg-amber-600 rounded-xl shrink-0">
                <Edit className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Edit Provider</h2>
                <div className="mt-1">
                  {isEditingName ? (
                    <input
                      autoFocus
                      type="text"
                      value={formData.name}
                      onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      onBlur={() => setIsEditingName(false)}
                      onKeyDown={e => { if (e.key === 'Enter') setIsEditingName(false) }}
                      className="text-base font-bold px-4 py-1.5 border-2 border-amber-400 rounded-full focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white"
                    />
                  ) : (
                    <button
                      onClick={() => setIsEditingName(true)}
                      className="group inline-flex items-center gap-2 px-5 py-1.5 bg-amber-50 border-2 border-amber-200 rounded-full hover:border-amber-400 transition-all cursor-pointer"
                    >
                      <span className="text-base font-bold text-gray-900">{formData.name || 'Provider Name'}</span>
                      <Edit className="w-4 h-4 text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  )}
                  {validationErrors.name && (
                    <p className="text-sm text-rose-600 mt-1 flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />{validationErrors.name}
                    </p>
                  )}
                </div>
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
            <button
              onClick={() => setActiveTab('locations')}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'locations'
                  ? 'border-amber-600 text-amber-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                Locations ({formData.locations.length})
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
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                            First Name
                          </label>
                          <input
                            type="text"
                            value={formData.contactFirstName}
                            onChange={e => setFormData(prev => ({ ...prev, contactFirstName: e.target.value }))}
                            placeholder="First"
                            className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-white text-gray-900 focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                            Last Name
                          </label>
                          <input
                            type="text"
                            value={formData.contactLastName}
                            onChange={e => setFormData(prev => ({ ...prev, contactLastName: e.target.value }))}
                            placeholder="Last"
                            className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-white text-gray-900 focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                      <PhoneNumberInput
                        value={formData.phone}
                        onChange={(phone) => setFormData({ ...formData, phone })}
                      />
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
                      <PlacesAutocomplete
                        value={formData.address}
                        onChange={(val) => setFormData({ ...formData, address: val })}
                        onPlaceSelect={(place: PlaceResult) => {
                          const full = [
                            place.streetAddress,
                            place.city,
                            place.stateProvince,
                            place.postalCode,
                            place.country,
                          ]
                            .filter(Boolean)
                            .join(', ')
                          setFormData((prev) => ({ ...prev, address: full }))
                        }}
                        placeholder="Start typing an address…"
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-white text-gray-900 focus:ring-2 focus:ring-amber-500"
                      />
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
            ) : activeTab === 'contacts' ? (
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
                    {formData.contacts.map((contact) => {
                      const phoneTypeItem = PHONE_TYPES.find(t => t.value === contact.phoneType)
                      return (
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
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-gray-900 truncate">
                                  {`${contact.firstName} ${contact.lastName}`.trim() || 'Unnamed Contact'}
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
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                {phoneTypeItem && contact.phone && (
                                  <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 text-xs font-medium rounded-full ${phoneTypeItem.color}`}>
                                    {phoneTypeItem.emoji} {phoneTypeItem.label}
                                  </span>
                                )}
                                <span className="text-sm text-gray-500 truncate">
                                  {contact.tag || `${contact.phone || 'No phone'} | ${contact.email || 'No email'}`}
                                </span>
                              </div>
                            </div>
                            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${
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
                                    <div className="md:col-span-2">
                                      <div className="grid grid-cols-2 gap-3">
                                        <div>
                                          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">First Name</label>
                                          <input
                                            type="text"
                                            value={contact.firstName}
                                            onChange={(e) => updateContact(contact.id, { firstName: e.target.value })}
                                            placeholder="First"
                                            className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-900 focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Last Name</label>
                                          <input
                                            type="text"
                                            value={contact.lastName}
                                            onChange={(e) => updateContact(contact.id, { lastName: e.target.value })}
                                            placeholder="Last"
                                            className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-900 focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                                          />
                                        </div>
                                      </div>
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
                                      <PhoneNumberInput
                                        value={contact.phone}
                                        onChange={(phone) => updateContact(contact.id, { phone })}
                                        className="py-2 text-sm"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-gray-600 mb-1">Phone Type</label>
                                      <select
                                        value={contact.phoneType}
                                        onChange={(e) => updateContact(contact.id, { phoneType: e.target.value as ProviderContactEntry['phoneType'] })}
                                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                                      >
                                        {PHONE_TYPES.map(type => (
                                          <option key={type.value} value={type.value}>
                                            {type.emoji} {type.label}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                    <div className="md:col-span-2">
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
                                        placeholder={`e.g., "Main phone line for ${formData.name}" or "Broker - ${`${contact.firstName} ${contact.lastName}`.trim()}"`}
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
                      )
                    })}
                  </div>
                )}
              </div>
            ) : (
              /* Locations Tab */
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Provider Locations</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Manage multiple locations for this provider — offices, warehouses, and stores.
                    </p>
                  </div>
                  <button
                    onClick={addLocation}
                    className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white font-medium rounded-xl hover:bg-amber-700 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add Location
                  </button>
                </div>

                {formData.locations.length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
                    <MapPin className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 font-medium">No locations added</p>
                    <p className="text-sm text-gray-400 mt-1">Add locations to track multiple offices, warehouses, or stores</p>
                    <button
                      onClick={addLocation}
                      className="mt-4 px-4 py-2 bg-amber-600 text-white font-medium rounded-lg hover:bg-amber-700 transition-colors text-sm"
                    >
                      Add First Location
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {formData.locations.map((location) => (
                      <div
                        key={location.id}
                        className={`border-2 rounded-xl p-4 transition-all ${
                          location.isPrimary ? 'border-amber-300 bg-amber-50/40' : 'border-gray-200 bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <MapPin className={`w-5 h-5 ${location.isPrimary ? 'text-amber-600' : 'text-gray-400'}`} />
                            {location.isPrimary && (
                              <span className="px-2 py-0.5 bg-amber-200 text-amber-800 text-xs font-medium rounded-full">
                                Primary
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {!location.isPrimary && (
                              <button
                                onClick={() => setPrimaryLocation(location.id)}
                                className="text-xs px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 transition-colors font-medium"
                              >
                                Set as Primary
                              </button>
                            )}
                            <button
                              onClick={() => removeLocation(location.id)}
                              disabled={formData.locations.length === 1}
                              className="text-xs px-3 py-1.5 bg-rose-100 text-rose-700 rounded-lg hover:bg-rose-200 transition-colors font-medium flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <Trash2 className="w-3 h-3" />
                              Remove
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Location Name</label>
                            <input
                              type="text"
                              value={location.name}
                              onChange={(e) => updateLocation(location.id, { name: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                              placeholder="Main Office"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                            <select
                              value={location.type}
                              onChange={(e) => updateLocation(location.id, { type: e.target.value as ProviderLocation['type'] })}
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                            >
                              {LOCATION_TYPES.map(type => (
                                <option key={type.value} value={type.value}>{type.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-xs font-medium text-gray-600 mb-1">Address</label>
                            <PlacesAutocomplete
                              value={location.address}
                              onChange={(val) => updateLocation(location.id, { address: val })}
                              onPlaceSelect={(place: PlaceResult) => {
                                const full = [
                                  place.streetAddress,
                                  place.city,
                                  place.stateProvince,
                                  place.postalCode,
                                  place.country,
                                ]
                                  .filter(Boolean)
                                  .join(', ')
                                updateLocation(location.id, { address: full })
                              }}
                              placeholder="Start typing an address…"
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                            />
                          </div>
                        </div>
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
