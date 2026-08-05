import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
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
  Edit,
  MapPin,
  Plus,
} from 'lucide-react'
import type { Provider } from '../../services/api/providers'
import { fetchProviderContacts, getProviderLocations } from '../../services/api/providers'
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

const WINE_LIBRARY: Record<string, string[]> = {
  'Red Varietals': [
    'Cabernet Sauvignon', 'Pinot Noir', 'Merlot', 'Syrah / Shiraz', 'Zinfandel',
    'Malbec', 'Grenache', 'Sangiovese', 'Tempranillo', 'Nebbiolo',
    'Barbera', 'Cabernet Franc', 'Mourvèdre', 'Petit Verdot', 'Gamay',
  ],
  'White Varietals': [
    'Chardonnay', 'Sauvignon Blanc', 'Riesling', 'Pinot Grigio / Pinot Gris',
    'Gewurztraminer', 'Viognier', 'Chenin Blanc', 'Grüner Veltliner',
    'Albariño', 'Moscato', 'Pinot Blanc', 'Roussanne',
  ],
  'French Regions': [
    'Bordeaux', 'Burgundy', 'Champagne', 'Rhône Valley',
    'Alsace', 'Loire Valley', 'Languedoc-Roussillon', 'Provence',
  ],
  'Italian Regions': [
    'Tuscany', 'Piedmont', 'Veneto', 'Sicily', 'Umbria', 'Campania',
  ],
  'Spanish Regions': [
    'Rioja', 'Priorat', 'Ribera del Duero', 'Rías Baixas', 'Cava',
  ],
  'US Regions': [
    'Napa Valley', 'Sonoma', 'Willamette Valley', 'Walla Walla',
    'Santa Barbara', 'Paso Robles', 'Columbia Valley',
  ],
  'Other Regions': [
    'Barossa Valley', 'Marlborough', 'Mendoza', 'Douro Valley', 'Mosel',
  ],
  'Styles & Types': [
    'Red Wines', 'White Wines', 'Sparkling Wines', 'Rosé', 'Dessert Wines',
    'Fortified Wines', 'Orange Wine', 'Natural Wine', 'Biodynamic', 'Organic',
  ],
  'Price Tiers': [
    'Value (Under $20)', 'Mid-Range ($20–50)', 'Premium ($50–100)', 'Luxury ($100+)',
  ],
}

/** Color palette per wine library category — dot · chip background · text */
const CATEGORY_COLORS: Record<string, { dot: string; chip: string; text: string; btn: string; selected: string }> = {
  'Red Varietals':   { dot: 'bg-rose-500',    chip: 'bg-rose-50 border-rose-200',      text: 'text-rose-800',    btn: 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200',     selected: 'bg-rose-600 text-white border-rose-600' },
  'White Varietals': { dot: 'bg-amber-400',   chip: 'bg-amber-50 border-amber-200',    text: 'text-amber-800',   btn: 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200', selected: 'bg-amber-500 text-white border-amber-500' },
  'French Regions':  { dot: 'bg-blue-500',    chip: 'bg-blue-50 border-blue-200',      text: 'text-blue-800',    btn: 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200',     selected: 'bg-blue-600 text-white border-blue-600' },
  'Italian Regions': { dot: 'bg-green-600',   chip: 'bg-green-50 border-green-200',    text: 'text-green-800',   btn: 'bg-green-50 hover:bg-green-100 text-green-700 border-green-200', selected: 'bg-green-600 text-white border-green-600' },
  'Spanish Regions': { dot: 'bg-orange-500',  chip: 'bg-orange-50 border-orange-200',  text: 'text-orange-800',  btn: 'bg-orange-50 hover:bg-orange-100 text-orange-700 border-orange-200', selected: 'bg-orange-500 text-white border-orange-500' },
  'US Regions':      { dot: 'bg-violet-500',  chip: 'bg-violet-50 border-violet-200',  text: 'text-violet-800',  btn: 'bg-violet-50 hover:bg-violet-100 text-violet-700 border-violet-200', selected: 'bg-violet-600 text-white border-violet-600' },
  'Other Regions':   { dot: 'bg-gray-400',    chip: 'bg-gray-50 border-gray-200',      text: 'text-gray-700',    btn: 'bg-gray-50 hover:bg-gray-100 text-gray-600 border-gray-200',     selected: 'bg-gray-500 text-white border-gray-500' },
  'Styles & Types':  { dot: 'bg-teal-500',    chip: 'bg-teal-50 border-teal-200',      text: 'text-teal-800',    btn: 'bg-teal-50 hover:bg-teal-100 text-teal-700 border-teal-200',     selected: 'bg-teal-600 text-white border-teal-600' },
  'Price Tiers':     { dot: 'bg-emerald-500', chip: 'bg-emerald-50 border-emerald-200',text: 'text-emerald-800', btn: 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200', selected: 'bg-emerald-600 text-white border-emerald-600' },
  custom:            { dot: 'bg-slate-400',   chip: 'bg-slate-50 border-slate-200',    text: 'text-slate-700',   btn: 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200', selected: 'bg-slate-500 text-white border-slate-500' },
}

function getSpecialtyCategory(specialty: string): string {
  for (const [category, wines] of Object.entries(WINE_LIBRARY)) {
    if (wines.includes(specialty)) return category
  }
  return 'custom'
}

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
  const navigate = useNavigate()

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
  const [editingLeftField, setEditingLeftField] = useState<string | null>(null)
  const [showWineLibrary, setShowWineLibrary] = useState(false)
  const [wineLibrarySearch, setWineLibrarySearch] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [customSpecialtyInput, setCustomSpecialtyInput] = useState('')

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
        primaryBusinessType: provider.primaryBusinessType || (provider as any).type || 'Distributor',
        specialties: (provider as any).specialties || [],
        paymentTerms: (provider as any).paymentTerms || 'Net 30',
        deliveryDays: (provider as any).regionsCovered || provider.statesOrRegionsServed || [],
        minimumOrder: (provider as any).minimumOrder ?? null,
        notes: provider.notes || '',
        rating: provider.rating || 0,
        contacts: buildInitialContacts(provider),
        locations: buildInitialLocations(provider),
      })
      setActiveTab('details')
      setValidationErrors({})
      setIsEditingName(false)
      setEditingLeftField(null)
      setShowWineLibrary(false)
      setWineLibrarySearch('')
      setShowCustomInput(false)
      setCustomSpecialtyInput('')

      // Fetch real contacts & locations from DB
      let aborted = false
      fetchProviderContacts(provider.id)
        .then(dbContacts => {
          if (aborted || dbContacts.length === 0) return
          setFormData(prev => ({
            ...prev,
            contacts: dbContacts.map(c => {
              const nameIdx = (c.name || '').indexOf(' ')
              return {
                id: c.id,
                firstName: nameIdx > -1 ? c.name.slice(0, nameIdx) : (c.name || ''),
                lastName:  nameIdx > -1 ? c.name.slice(nameIdx + 1) : '',
                role: c.role || 'Sales Rep',
                phone: c.phone || '',
                phoneType: 'main_line',
                email: c.email || '',
                isPrimary: c.isPrimary ?? false,
                tag: '',
              }
            }),
          }))
        })
        .catch((err) => {
          const status = (err as any)?.response?.status
          console.warn(`[EditProviderModal] fetchProviderContacts failed (${status ?? 'network'}) — using derived contacts`)
        })

      getProviderLocations(provider.id)
        .then(dbLocations => {
          if (aborted || dbLocations.length === 0) return
          setFormData(prev => {
            const locs: ProviderLocation[] = dbLocations.map(l => ({
              id: l.id,
              name: l.name,
              type: (l.type as any) || 'office',
              address: l.address || '',
              isPrimary: l.isPrimary ?? false,
            }))
            const primaryLoc = locs.find(l => l.isPrimary) || locs[0]
            return {
              ...prev,
              locations: locs,
              address: primaryLoc && primaryLoc.address ? primaryLoc.address : prev.address,
            }
          })
        })
        .catch((err) => {
          const status = (err as any)?.response?.status
          console.warn(`[EditProviderModal] getProviderLocations failed (${status ?? 'network'}) — using derived locations`)
        })

      return () => { aborted = true }
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
    setFormData(prev => {
      const updatedLocations = prev.locations.map(l => l.id === locationId ? { ...l, ...updates } : l)
      const primaryLoc = updatedLocations.find(l => l.isPrimary)
      return {
        ...prev,
        locations: updatedLocations,
        address: primaryLoc ? primaryLoc.address : prev.address,
      }
    })
  }

  const removeLocation = (locationId: string) => {
    setFormData(prev => {
      const updated = prev.locations.filter(l => l.id !== locationId)
      const removedWasPrimary = prev.locations.find(l => l.id === locationId)?.isPrimary ?? false
      if (removedWasPrimary && updated.length > 0) {
        updated[0] = { ...updated[0], isPrimary: true }
      }
      const primaryLoc = updated.find(l => l.isPrimary)
      return {
        ...prev,
        locations: updated,
        address: primaryLoc ? primaryLoc.address : prev.address,
      }
    })
  }

  const setPrimaryLocation = (locationId: string) => {
    setFormData(prev => {
      const updatedLocations = prev.locations.map(l => ({
        ...l,
        isPrimary: l.id === locationId,
      }))
      const primaryLoc = updatedLocations.find(l => l.isPrimary)
      return {
        ...prev,
        locations: updatedLocations,
        address: primaryLoc ? primaryLoc.address : prev.address,
      }
    })
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

  function LeftField({ fieldKey, label, value, onSave, children }: {
    fieldKey: string
    label: string
    value: string
    onSave: (val: string) => void
    children?: React.ReactNode
  }) {
    const isEditing = editingLeftField === fieldKey
    return (
      <div
        className="flex items-start gap-2 py-1.5 border-b border-gray-100 last:border-0 cursor-pointer group"
        onClick={() => !isEditing && setEditingLeftField(fieldKey)}
      >
        <span className="text-[10px] text-gray-400 w-14 flex-shrink-0 pt-0.5 uppercase tracking-wider">{label}</span>
        {isEditing ? (
          children || (
            <input
              autoFocus
              className="flex-1 text-xs text-gray-900 bg-transparent border-0 border-b border-amber-400 outline-none pb-0.5"
              defaultValue={value}
              onBlur={(e) => { onSave(e.target.value); setEditingLeftField(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') { onSave((e.target as HTMLInputElement).value); setEditingLeftField(null) } }}
            />
          )
        ) : (
          <span className="flex-1 text-xs text-gray-700 truncate group-hover:text-amber-700 transition-colors">
            {value || <span className="text-gray-300 italic">—</span>}
          </span>
        )}
      </div>
    )
  }

  if (!isOpen || !provider) return null

  const tabs = [
    { id: 'details'   as const, label: 'Details',   icon: <Building2 className="w-4 h-4" />, count: undefined },
    { id: 'contacts'  as const, label: 'Contacts',  icon: <User      className="w-4 h-4" />, count: formData.contacts.length },
    { id: 'locations' as const, label: 'Locations', icon: <Truck     className="w-4 h-4" />, count: formData.locations.length },
  ]

  const isActive = (provider as any).isActive !== false

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
          className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
        >
          {/* ── Header bar ─────────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-amber-50 to-orange-50">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-900">Edit Provider</h2>
              <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {isActive ? '● Active' : 'Inactive'}
              </span>
            </div>
            <button
              onClick={handleClose}
              className="w-8 h-8 flex items-center justify-center rounded-xl bg-gray-100 text-gray-400 hover:bg-gray-200 transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* ── Two-panel body ──────────────────────────────────────────── */}
          <div className="flex flex-1 overflow-hidden">

            {/* ── Left identity panel (220 px) ───────────────────────── */}
            <div className="w-56 flex-shrink-0 border-r border-gray-100 bg-gray-50 flex flex-col p-5 gap-4 overflow-y-auto">

              {/* Avatar */}
              <div className="w-[52px] h-[52px] rounded-full bg-amber-100 flex items-center justify-center mx-auto">
                <span className="text-xl font-bold text-amber-700">
                  {formData.name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'}
                </span>
              </div>

              {/* Editable name chip */}
              {isEditingName ? (
                <input
                  autoFocus
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  onBlur={() => setIsEditingName(false)}
                  onKeyDown={e => { if (e.key === 'Enter') setIsEditingName(false) }}
                  className="text-sm font-bold px-3 py-1.5 border-2 border-amber-400 rounded-full focus:outline-none w-full text-center"
                />
              ) : (
                <button
                  onClick={() => setIsEditingName(true)}
                  className="group flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border-2 border-amber-200 rounded-full hover:border-amber-400 transition-all w-full justify-center"
                >
                  <span className="text-sm font-bold text-gray-900 truncate max-w-[130px]">{formData.name || 'Provider Name'}</span>
                  <Edit className="w-3 h-3 text-amber-400 opacity-0 group-hover:opacity-100 flex-shrink-0" />
                </button>
              )}
              {validationErrors.name && (
                <p className="text-xs text-rose-600 flex items-center gap-1 -mt-2">
                  <AlertCircle className="w-3 h-3" />{validationErrors.name}
                </p>
              )}

              {/* Provider info rows */}
              <div className="space-y-0.5">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Provider</p>
                <div className="flex items-center gap-2 py-1 border-b border-gray-100">
                  <span className="text-[11px] text-gray-400 w-16 flex-shrink-0">Rating</span>
                  <span className="text-[12px] text-amber-500">
                    {'★'.repeat(Math.round(formData.rating || 0))}{'☆'.repeat(5 - Math.round(formData.rating || 0))}
                  </span>
                </div>

                {/* Editable Type */}
                <div className="flex items-center gap-2 py-1 border-b border-gray-100 cursor-pointer group" onClick={() => setEditingLeftField(editingLeftField === 'type' ? null : 'type')}>
                  <span className="text-[11px] text-gray-400 w-16 flex-shrink-0">Type</span>
                  {editingLeftField === 'type' ? (
                    <select
                      autoFocus
                      className="flex-1 text-xs text-gray-900 bg-white border border-amber-300 rounded px-1 py-0.5 outline-none"
                      value={formData.primaryBusinessType}
                      onChange={e => { setFormData(prev => ({ ...prev, primaryBusinessType: e.target.value })); setEditingLeftField(null) }}
                      onBlur={() => setEditingLeftField(null)}
                    >
                      {['Distributor', 'Importer', 'Wholesaler'].map(t => <option key={t}>{t}</option>)}
                    </select>
                  ) : (
                    <span className="text-[12px] text-gray-700 truncate group-hover:text-amber-700">{formData.primaryBusinessType || '—'}</span>
                  )}
                </div>

                {/* Editable Terms */}
                <div className="flex items-center gap-2 py-1 border-b border-gray-100 cursor-pointer group" onClick={() => setEditingLeftField(editingLeftField === 'terms' ? null : 'terms')}>
                  <span className="text-[11px] text-gray-400 w-16 flex-shrink-0">Terms</span>
                  {editingLeftField === 'terms' ? (
                    <select
                      autoFocus
                      className="flex-1 text-xs text-gray-900 bg-white border border-amber-300 rounded px-1 py-0.5 outline-none"
                      value={formData.paymentTerms}
                      onChange={e => { setFormData(prev => ({ ...prev, paymentTerms: e.target.value })); setEditingLeftField(null) }}
                      onBlur={() => setEditingLeftField(null)}
                    >
                      {PAYMENT_TERMS.map(t => <option key={t}>{t}</option>)}
                    </select>
                  ) : (
                    <span className="text-[12px] text-gray-700 truncate group-hover:text-amber-700">{formData.paymentTerms || '—'}</span>
                  )}
                </div>

                {/* Editable Min. Order */}
                <div className="flex items-center gap-2 py-1 border-b border-gray-100 last:border-0 cursor-pointer group" onClick={() => setEditingLeftField(editingLeftField === 'minOrder' ? null : 'minOrder')}>
                  <span className="text-[11px] text-gray-400 w-16 flex-shrink-0">Min. Order</span>
                  {editingLeftField === 'minOrder' ? (
                    <input
                      autoFocus
                      type="number"
                      className="flex-1 text-xs text-gray-900 bg-transparent border-0 border-b border-amber-400 outline-none pb-0.5"
                      defaultValue={formData.minimumOrder ?? ''}
                      onBlur={(e) => { setFormData(prev => ({ ...prev, minimumOrder: e.target.value ? parseFloat(e.target.value) : null })); setEditingLeftField(null) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { setFormData(prev => ({ ...prev, minimumOrder: (e.target as HTMLInputElement).value ? parseFloat((e.target as HTMLInputElement).value) : null })); setEditingLeftField(null) } }}
                    />
                  ) : (
                    <span className="text-[12px] text-gray-700 truncate group-hover:text-amber-700">{formData.minimumOrder ? `$${formData.minimumOrder}` : '—'}</span>
                  )}
                </div>
              </div>

              {/* Editable contact identity */}
              <div className="space-y-0">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Contact</p>

                {/* First + Last name - side by side */}
                <div
                  className="flex items-start gap-2 py-1.5 border-b border-gray-100 cursor-pointer group"
                  onClick={() => setEditingLeftField(editingLeftField === 'firstName' ? null : 'firstName')}
                >
                  <span className="text-[10px] text-gray-400 w-14 flex-shrink-0 pt-0.5 uppercase tracking-wider">Name</span>
                  {editingLeftField === 'firstName' || editingLeftField === 'lastName' ? (
                    <div className="flex gap-1 flex-1">
                      <input
                        autoFocus={editingLeftField === 'firstName'}
                        placeholder="First"
                        className="w-1/2 text-xs text-gray-900 bg-transparent border-0 border-b border-amber-400 outline-none pb-0.5"
                        defaultValue={formData.contactFirstName}
                        onBlur={(e) => setFormData(prev => ({ ...prev, contactFirstName: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Escape' && setEditingLeftField(null)}
                      />
                      <input
                        autoFocus={editingLeftField === 'lastName'}
                        placeholder="Last"
                        className="w-1/2 text-xs text-gray-900 bg-transparent border-0 border-b border-amber-400 outline-none pb-0.5"
                        defaultValue={formData.contactLastName}
                        onBlur={(e) => { setFormData(prev => ({ ...prev, contactLastName: e.target.value })); setEditingLeftField(null) }}
                        onKeyDown={(e) => e.key === 'Escape' && setEditingLeftField(null)}
                      />
                    </div>
                  ) : (
                    <span className="flex-1 text-xs text-gray-700 truncate group-hover:text-amber-700 transition-colors">
                      {`${formData.contactFirstName} ${formData.contactLastName}`.trim() || <span className="text-gray-300 italic">—</span>}
                    </span>
                  )}
                </div>

                {/* Phone */}
                <LeftField
                  fieldKey="phone"
                  label="Phone"
                  value={formData.phone}
                  onSave={(val) => setFormData(prev => ({ ...prev, phone: val }))}
                />
              </div>

              {/* Quick actions */}
              <div className="mt-auto space-y-1.5">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Actions</p>
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    navigate(`/orders?provider=${encodeURIComponent(formData.id)}`)
                  }}
                  className="w-full text-left text-xs text-gray-600 hover:text-amber-600 py-1.5 px-2 rounded-lg hover:bg-amber-50 transition-all"
                >
                  View Orders
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (formData.email) {
                      window.location.href = `mailto:${formData.email}`
                    }
                  }}
                  disabled={!formData.email}
                  className="w-full text-left text-xs text-gray-600 hover:text-amber-600 py-1.5 px-2 rounded-lg hover:bg-amber-50 transition-all disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-gray-600"
                >
                  Send Message
                </button>
              </div>
            </div>

            {/* ── Right content panel ─────────────────────────────────── */}
            <div className="flex-1 flex flex-col overflow-hidden">

              {/* Tab bar */}
              <div className="flex border-b border-gray-100 bg-white px-1">
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === tab.id
                        ? 'border-amber-600 text-amber-700'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {tab.icon}
                      {tab.label}
                      {tab.count !== undefined && <span className="text-xs opacity-60">({tab.count})</span>}
                    </div>
                  </button>
                ))}
              </div>

              {/* Scrollable tab content */}
              <div className="flex-1 overflow-y-auto p-6">

                {/* ── Details tab ──────────────────────────────────────── */}
                {activeTab === 'details' && (
                  <div className="space-y-6">
                    {/* Basic Information */}
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                        <Building2 className="w-5 h-5 text-amber-600" />
                        Basic Information
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                            onChange={(val) => {
                              setFormData(prev => {
                                const hasPrimary = prev.locations.some(l => l.isPrimary)
                                const updatedLocs = hasPrimary
                                  ? prev.locations.map(l => l.isPrimary ? { ...l, address: val } : l)
                                  : prev.locations.length > 0
                                    ? prev.locations.map((l, idx) => idx === 0 ? { ...l, address: val, isPrimary: true } : l)
                                    : [{ id: `loc-${Date.now()}`, name: 'Main Office', type: 'office', address: val, isPrimary: true }]
                                return {
                                  ...prev,
                                  address: val,
                                  locations: updatedLocs,
                                }
                              })
                            }}
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
                              setFormData(prev => {
                                const hasPrimary = prev.locations.some(l => l.isPrimary)
                                const updatedLocs = hasPrimary
                                  ? prev.locations.map(l => l.isPrimary ? { ...l, address: full } : l)
                                  : prev.locations.length > 0
                                    ? prev.locations.map((l, idx) => idx === 0 ? { ...l, address: full, isPrimary: true } : l)
                                    : [{ id: `loc-${Date.now()}`, name: 'Main Office', type: 'office', address: full, isPrimary: true }]
                                return {
                                  ...prev,
                                  address: full,
                                  locations: updatedLocs,
                                }
                              })
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

                      {/* Wine Specialties */}
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <label className="block text-sm font-medium text-gray-700">Wine Specialties</label>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setShowWineLibrary(prev => !prev)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-all"
                            >
                              <Package className="w-3.5 h-3.5" />
                              Choose from Wine Library
                            </button>
                            <button
                              onClick={() => setShowCustomInput(true)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 border border-gray-200 rounded-lg hover:bg-gray-200 transition-all"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Add Custom
                            </button>
                          </div>
                        </div>

                        {/* Empty state */}
                        {formData.specialties.length === 0 && !showCustomInput && !showWineLibrary && (
                          <p className="text-xs text-gray-400 italic mb-3">No specialties added yet — use the buttons above to build a profile.</p>
                        )}

                        {/* Selected specialties chips — category-aware color */}
                        {formData.specialties.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-3">
                            {formData.specialties.map(s => {
                              const cat = getSpecialtyCategory(s)
                              const c = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.custom
                              return (
                                <span
                                  key={s}
                                  className={`inline-flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-lg border text-xs font-medium transition-all ${c.chip} ${c.text}`}
                                >
                                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}`} />
                                  {s}
                                  <button
                                    onClick={() => toggleSpecialty(s)}
                                    className={`w-4 h-4 flex items-center justify-center rounded-full opacity-50 hover:opacity-100 hover:bg-black/10 transition-all leading-none text-sm`}
                                    title="Remove"
                                  >
                                    ×
                                  </button>
                                </span>
                              )
                            })}
                          </div>
                        )}

                        {/* Custom input */}
                        {showCustomInput && (
                          <div className="flex gap-2 mb-3">
                            <input
                              autoFocus
                              type="text"
                              placeholder="Type custom specialty (e.g. Grüner Veltliner)"
                              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                              value={customSpecialtyInput}
                              onChange={e => setCustomSpecialtyInput(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && customSpecialtyInput.trim()) {
                                  const val = customSpecialtyInput.trim()
                                  if (!formData.specialties.includes(val)) {
                                    setFormData(prev => ({ ...prev, specialties: [...prev.specialties, val] }))
                                  }
                                  setCustomSpecialtyInput('')
                                  setShowCustomInput(false)
                                }
                                if (e.key === 'Escape') { setShowCustomInput(false); setCustomSpecialtyInput('') }
                              }}
                            />
                            <button
                              onClick={() => {
                                const val = customSpecialtyInput.trim()
                                if (val && !formData.specialties.includes(val)) {
                                  setFormData(prev => ({ ...prev, specialties: [...prev.specialties, val] }))
                                }
                                setCustomSpecialtyInput('')
                                setShowCustomInput(false)
                              }}
                              className="px-3 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium"
                            >
                              Add
                            </button>
                            <button onClick={() => { setShowCustomInput(false); setCustomSpecialtyInput('') }}
                              className="px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                              Cancel
                            </button>
                          </div>
                        )}

                        {/* Wine Library picker — category-colored */}
                        {showWineLibrary && (
                          <div className="border border-gray-200 rounded-xl overflow-hidden mb-3 shadow-sm">
                            <div className="p-3 border-b border-gray-100 bg-gray-50 flex gap-2 items-center">
                              <input
                                autoFocus
                                type="text"
                                placeholder="Search wines, regions, varietals…"
                                className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 bg-white"
                                value={wineLibrarySearch}
                                onChange={e => setWineLibrarySearch(e.target.value)}
                              />
                              <button onClick={() => setShowWineLibrary(false)} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-white bg-gray-50 font-medium">
                                Done
                              </button>
                            </div>
                            <div className="max-h-52 overflow-y-auto p-2 space-y-3">
                              {Object.entries(WINE_LIBRARY).map(([category, wines]) => {
                                const filtered = wines.filter(w =>
                                  !wineLibrarySearch || w.toLowerCase().includes(wineLibrarySearch.toLowerCase())
                                )
                                if (filtered.length === 0) return null
                                const c = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.custom
                                return (
                                  <div key={category}>
                                    <div className="flex items-center gap-1.5 px-1 mb-1.5">
                                      <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{category}</p>
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                      {filtered.map(wine => {
                                        const isSelected = formData.specialties.includes(wine)
                                        return (
                                          <button
                                            key={wine}
                                            onClick={() => toggleSpecialty(wine)}
                                            className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-all ${
                                              isSelected ? c.selected : c.btn
                                            }`}
                                          >
                                            {isSelected ? '✓ ' : ''}{wine}
                                          </button>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
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
                )}

                {/* ── Contacts tab ─────────────────────────────────────── */}
                {activeTab === 'contacts' && (
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
                              {/* Contact header — always visible */}
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

                              {/* Expanded details */}
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
                )}

                {/* ── Locations tab ─────────────────────────────────────── */}
                {activeTab === 'locations' && (
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

              {/* ── Footer ────────────────────────────────────────────── */}
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-white">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-xl transition-all hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="px-6 py-2 text-sm font-semibold bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-all"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
