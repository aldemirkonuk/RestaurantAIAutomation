import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { Wine, Users, Building2, ArrowRight, ArrowLeft, Check, X, Loader2, AlertCircle, Mail, Lock, User, MapPin, Phone, ChefHat } from 'lucide-react'
import { Button } from '../components/ui'

type Path = 'selector' | 'join' | 'create'
type PathAStep = 1 | 2
type PathBStep = 1 | 2

interface InvitePreview {
  valid: boolean
  organization?: string
  restaurant?: string
  city?: string
  inviter?: string
  role?: string
  reason?: 'not_found' | 'expired' | 'used'
}

export function Register() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { registerRestaurant, joinViaInvite, error: authError } = useAuth()

  const [path, setPath] = useState<Path>('selector')
  const [pathAStep, setPathAStep] = useState<PathAStep>(1)
  const [pathBStep, setPathBStep] = useState<PathBStep>(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Path A state
  const [inviteCode, setInviteCode] = useState('')
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null)
  const [validating, setValidating] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Path A account fields
  const [joinName, setJoinName] = useState('')
  const [joinEmail, setJoinEmail] = useState('')
  const [joinPassword, setJoinPassword] = useState('')
  const [joinConfirm, setJoinConfirm] = useState('')

  // Path B account fields
  const [createName, setCreateName] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [createConfirm, setCreateConfirm] = useState('')

  // Path B restaurant fields
  const [restaurantName, setRestaurantName] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [country, setCountry] = useState('')
  const [stateProvince, setStateProvince] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [phone, setPhone] = useState('')
  const [cuisineType, setCuisineType] = useState('')

  // Auto-route from URL params on mount (D-09):
  // ?invite=CODE  → Path A (join) with code pre-filled
  // ?type=join    → Path A (join), no code pre-filled
  // ?type=new     → Path B (create restaurant), skip selector
  // default       → show path selector
  useEffect(() => {
    const code = searchParams.get('invite')
    const type = searchParams.get('type')
    if (code) {
      setInviteCode(code.toUpperCase())
      setPath('join')
    } else if (type === 'join') {
      setPath('join')
    } else if (type === 'new') {
      setPath('create')
    }
  }, [searchParams])

  // Inline invite validation — debounced 400ms (D-08)
  useEffect(() => {
    if (inviteCode.length !== 8) {
      setInvitePreview(null)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setValidating(true)
      try {
        const resp = await fetch(`/api/v1/auth/invite/${inviteCode.toUpperCase()}`)
        const data: InvitePreview = await resp.json()
        setInvitePreview(data)
      } catch {
        setInvitePreview({ valid: false, reason: 'not_found' })
      } finally {
        setValidating(false)
      }
    }, 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [inviteCode])

  // Step indicator — called as a function, not a component, to avoid unmount on re-render
  const stepIndicator = ({ current, total }: { current: number; total: number }) => (
    <div className="flex items-center gap-2 mb-6">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-colors ${i < current ? 'bg-wine-600' : 'bg-gray-200'}`}
        />
      ))}
      <span className="text-xs text-gray-400 ml-1">
        Step {current} of {total}
      </span>
    </div>
  )

  // Invite validation feedback — called as a function, not a component
  const inviteValidationFeedback = () => {
    if (inviteCode.length !== 8) return null
    if (validating)
      return (
        <div className="flex items-center gap-2 text-gray-500 text-sm mt-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Validating...
        </div>
      )
    if (!invitePreview) return null
    if (invitePreview.valid)
      return (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg"
        >
          <div className="flex items-center gap-2 text-green-700">
            <Check className="w-4 h-4" />
            <span className="text-sm font-medium">Valid invite</span>
          </div>
          <p className="text-sm text-green-600 mt-1">
            You've been invited to join <strong>{invitePreview.restaurant}</strong>
            {invitePreview.city && ` · ${invitePreview.city}`} by{' '}
            <strong>{invitePreview.inviter}</strong>
          </p>
        </motion.div>
      )
    const reasonText =
      {
        expired: 'This invite code has expired. Contact the restaurant owner for a new one.',
        used: 'This invite code has already been used.',
        not_found: 'Code not found. Check for typos — codes are uppercase letters and numbers.',
      }[invitePreview.reason!] || 'Invalid invite code.'
    return (
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg"
      >
        <div className="flex items-center gap-2 text-red-700">
          <X className="w-4 h-4" />
          <span className="text-sm">{reasonText}</span>
        </div>
      </motion.div>
    )
  }

  // PATH SELECTOR — no AnimatePresence here; single AP wrapper in the render handles transitions
  const pathSelector = () => (
      <motion.div
        key="selector"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.25 }}
      >
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Get Started</h2>
        <p className="text-gray-500 mb-8">How do you want to join WineOps?</p>
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setPath('join')}
            className="w-full p-5 border-2 border-gray-200 hover:border-wine-400 rounded-xl text-left transition-all group hover:bg-wine-50"
          >
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-wine-100 group-hover:bg-wine-200 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors">
                <Users className="w-5 h-5 text-wine-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">Join an Existing Restaurant</p>
                <p className="text-sm text-gray-500 mt-0.5">
                  I have an invite code or link from a colleague
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-gray-300 group-hover:text-wine-500 ml-auto mt-1 transition-colors" />
            </div>
          </button>

          <button
            type="button"
            onClick={() => setPath('create')}
            className="w-full p-5 border-2 border-gray-200 hover:border-wine-400 rounded-xl text-left transition-all group hover:bg-wine-50"
          >
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-purple-100 group-hover:bg-purple-200 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors">
                <Building2 className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">Create a New Restaurant</p>
                <p className="text-sm text-gray-500 mt-0.5">
                  Set up WineOps for my restaurant from scratch
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-gray-300 group-hover:text-wine-500 ml-auto mt-1 transition-colors" />
            </div>
          </button>
        </div>
        <p className="text-center text-sm text-gray-500 mt-6">
          Already have an account?{' '}
          <Link to="/login" className="text-wine-600 hover:text-wine-700 font-medium">
            Sign in
          </Link>
        </p>
      </motion.div>
  )

  // PATH A — Step 1: Invite code entry — called as a function
  const pathAStep1 = () => (
      <motion.div
        key="pathA-1"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.25 }}
      >
        <button
          type="button"
          onClick={() => setPath('selector')}
          className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h2 className="text-2xl font-bold text-gray-900 mb-1">Join Your Restaurant</h2>
        <p className="text-gray-500 mb-6">Enter the invite code or paste the full invite URL</p>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Invite Code</label>
          <input
            type="text"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase().slice(0, 8))}
            className="block w-full px-4 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none text-center text-xl font-mono tracking-widest uppercase"
            placeholder="XXXXXXXX"
            maxLength={8}
            autoFocus
          />
          {inviteValidationFeedback()}
        </div>

        <Button
          className="w-full h-12 mt-6"
          disabled={!invitePreview?.valid || loading}
          type="button"
          onClick={() => setPathAStep(2)}
        >
          Continue <ArrowRight className="w-4 h-4 ml-1" />
        </Button>
      </motion.div>
  )

  // PATH A — Step 2: Account fields + submit
  const handleJoinSubmit = async () => {
    if (joinPassword !== joinConfirm) {
      setError('Passwords do not match')
      return
    }
    if (joinPassword.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await joinViaInvite({ code: inviteCode, name: joinName, email: joinEmail, password: joinPassword })
      navigate('/', { replace: true })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to join restaurant')
    } finally {
      setLoading(false)
    }
  }

  const pathAStep2 = () => (
      <motion.div
        key="pathA-2"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.25 }}
      >
        <button
          type="button"
          onClick={() => setPathAStep(1)}
          className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        {invitePreview?.valid && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-xl">
            <p className="text-sm text-green-700 font-medium">
              Joining <strong>{invitePreview.restaurant}</strong>
              {invitePreview.city && ` · ${invitePreview.city}`}
            </p>
            <p className="text-xs text-green-600 mt-0.5">
              Invited by {invitePreview.inviter} · Role: {invitePreview.role}
            </p>
          </div>
        )}
        <h2 className="text-xl font-bold text-gray-900 mb-5">Your Account</h2>
        <div className="space-y-4">
          {(
            [
              { label: 'Full Name', value: joinName, setter: setJoinName, type: 'text', icon: User, placeholder: 'Jane Smith', hint: undefined as string | undefined },
              { label: 'Email', value: joinEmail, setter: setJoinEmail, type: 'email', icon: Mail, placeholder: 'jane@restaurant.com', hint: undefined as string | undefined },
              { label: 'Password', value: joinPassword, setter: setJoinPassword, type: 'password', icon: Lock, placeholder: '••••••••', hint: 'Min. 8 characters' as string | undefined },
              { label: 'Confirm Password', value: joinConfirm, setter: setJoinConfirm, type: 'password', icon: Lock, placeholder: '••••••••', hint: undefined as string | undefined },
            ]
          ).map(({ label, value, setter, type, icon: Icon, placeholder, hint }) => (
            <div key={label}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{label} *</label>
              <div className="relative">
                <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type={type}
                  value={value}
                  onChange={(e) => setter(e.target.value)}
                  placeholder={placeholder}
                  className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none"
                />
              </div>
              {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
            </div>
          ))}
        </div>
        {(error || authError) && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <p className="text-sm text-red-700">{error || authError}</p>
          </div>
        )}
        <Button
          className="w-full h-12 mt-5"
          disabled={loading || !joinName || !joinEmail || !joinPassword || !joinConfirm}
          onClick={handleJoinSubmit}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Joining...
            </>
          ) : (
            'Join Restaurant'
          )}
        </Button>
      </motion.div>
  )

  // PATH B — Step 1: Account fields — called as a function
  const pathBStep1 = () => (
      <motion.div
        key="pathB-1"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.25 }}
      >
        <button
          type="button"
          onClick={() => setPath('selector')}
          className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        {stepIndicator({ current: 1, total: 2 })}
        <h2 className="text-xl font-bold text-gray-900 mb-5">Your Account</h2>
        <div className="space-y-4">
          {(
            [
              { label: 'Full Name', value: createName, setter: setCreateName, type: 'text', icon: User, placeholder: 'John Smith', hint: undefined as string | undefined },
              { label: 'Email', value: createEmail, setter: setCreateEmail, type: 'email', icon: Mail, placeholder: 'john@myrestaurant.com', hint: undefined as string | undefined },
              { label: 'Password', value: createPassword, setter: setCreatePassword, type: 'password', icon: Lock, placeholder: '••••••••', hint: 'Min. 8 characters' as string | undefined },
              { label: 'Confirm Password', value: createConfirm, setter: setCreateConfirm, type: 'password', icon: Lock, placeholder: '••••••••', hint: undefined as string | undefined },
            ]
          ).map(({ label, value, setter, type, icon: Icon, placeholder, hint }) => (
            <div key={label}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{label} *</label>
              <div className="relative">
                <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type={type}
                  value={value}
                  onChange={(e) => setter(e.target.value)}
                  placeholder={placeholder}
                  className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none"
                />
              </div>
              {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
            </div>
          ))}
        </div>
        <Button
          type="button"
          className="w-full h-12 mt-5"
          disabled={!createName || !createEmail || createPassword.length < 8 || createPassword !== createConfirm}
          onClick={() => {
            if (createPassword !== createConfirm) {
              setError('Passwords do not match')
              return
            }
            setError(null)
            setPathBStep(2)
          }}
        >
          Next: Restaurant Details <ArrowRight className="w-4 h-4 ml-1" />
        </Button>
      </motion.div>
  )

  // PATH B — Step 2: Restaurant details + submit

  // Country-aware locale helper — single source of truth for all adaptive labels/placeholders
  const countryLocale = (() => {
    const c = country.toLowerCase()
    const isUS  = c.includes('united states') || c === 'us' || c === 'usa'
    const isUK  = c.includes('united kingdom') || c === 'uk' || c === 'gb'
    const isTR  = c.includes('turkey') || c === 'tr' || c.includes('türkiye')
    const isCA  = c.includes('canada') || c === 'ca'
    const isFR  = c.includes('france') || c === 'fr'
    const isDE  = c.includes('germany') || c === 'de'
    if (isUS) return {
      stateLabel: 'State', statePlaceholder: 'IL',
      postalLabel: 'ZIP Code', postalPlaceholder: '60601',
      areaLabel: 'Neighborhood', areaPlaceholder: 'River North, Wicker Park...',
    }
    if (isUK) return {
      stateLabel: 'County', statePlaceholder: 'Greater London',
      postalLabel: 'Postcode', postalPlaceholder: 'SW1A 1AA',
      areaLabel: 'Borough / Area', areaPlaceholder: 'Mayfair, Shoreditch, Camden...',
    }
    if (isTR) return {
      stateLabel: 'Province (İl)', statePlaceholder: 'Antalya',
      postalLabel: 'Posta Kodu', postalPlaceholder: '07050',
      areaLabel: 'District (İlçe / Mahalle)', areaPlaceholder: 'Konyaaltı, Lara, Muratpaşa...',
    }
    if (isCA) return {
      stateLabel: 'Province', statePlaceholder: 'ON',
      postalLabel: 'Postal Code', postalPlaceholder: 'M5V 2T6',
      areaLabel: 'Neighbourhood', areaPlaceholder: 'Downtown Core, Old Town...',
    }
    if (isFR) return {
      stateLabel: 'Région', statePlaceholder: 'Île-de-France',
      postalLabel: 'Code Postal', postalPlaceholder: '75001',
      areaLabel: 'Quartier', areaPlaceholder: 'Le Marais, Montmartre...',
    }
    if (isDE) return {
      stateLabel: 'Bundesland', statePlaceholder: 'Bayern',
      postalLabel: 'Postleitzahl', postalPlaceholder: '10115',
      areaLabel: 'Stadtteil', areaPlaceholder: 'Mitte, Prenzlauer Berg...',
    }
    return {
      stateLabel: 'State / Province', statePlaceholder: 'e.g. Ontario',
      postalLabel: 'Postal Code', postalPlaceholder: 'e.g. M5V 2T6',
      areaLabel: 'Neighborhood / Area', areaPlaceholder: 'e.g. Downtown',
    }
  })()

  const CUISINE_TYPES = ['Fine Dining', 'Casual', 'Bar & Bistro', 'Hotel', 'Wine Bar', 'Italian', 'French', 'American', 'Other']

  const handleCreateSubmit = async () => {
    if (!restaurantName || !address || !city || !country) {
      setError('Restaurant name, address, city, and country are required')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await registerRestaurant({
        name: createName,
        email: createEmail,
        password: createPassword,
        restaurantName,
        address,
        city,
        country,
        stateProvince: stateProvince || undefined,
        postalCode: postalCode || undefined,
        neighborhood: neighborhood || undefined,
        phone: phone || undefined,
        cuisineType: cuisineType || undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      navigate('/verify-email', { replace: true })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  const pathBStep2 = () => (
      <motion.div
        key="pathB-2"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.25 }}
      >
        <button
          type="button"
          onClick={() => setPathBStep(1)}
          className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        {stepIndicator({ current: 2, total: 2 })}
        <h2 className="text-xl font-bold text-gray-900 mb-5">Your Restaurant</h2>
        <div className="space-y-4">

          {/* Restaurant Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Restaurant Name *</label>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={restaurantName}
                onChange={(e) => setRestaurantName(e.target.value)}
                placeholder="The Oak Room"
                className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Country — full width, first; everything below adapts to this */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Country *</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="United States"
                className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none"
                autoFocus={false}
              />
            </div>
            {country && (
              <p className="text-xs text-gray-400 mt-1">
                Address fields below are labelled for <span className="font-medium text-gray-600">{country}</span>
              </p>
            )}
          </div>

          {/* Street address */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Street Address *</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Wine Street"
              className="block w-full px-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none"
            />
          </div>

          {/* State / Province  +  Postal Code — both labels adapt from countryLocale */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {countryLocale.stateLabel}
              </label>
              <input
                type="text"
                value={stateProvince}
                onChange={(e) => setStateProvince(e.target.value)}
                placeholder={countryLocale.statePlaceholder}
                className="block w-full px-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {countryLocale.postalLabel}
              </label>
              <input
                type="text"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                placeholder={countryLocale.postalPlaceholder}
                className="block w-full px-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none"
              />
            </div>
          </div>

          {/* City  +  Neighborhood — area label adapts from countryLocale */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">City *</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Chicago"
                  className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {countryLocale.areaLabel}
                <span className="text-gray-400 font-normal ml-1 text-xs">(optional)</span>
              </label>
              <input
                type="text"
                value={neighborhood}
                onChange={(e) => setNeighborhood(e.target.value)}
                placeholder={countryLocale.areaPlaceholder}
                className="block w-full px-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
                className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Cuisine Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cuisine Type</label>
            <div className="relative">
              <ChefHat className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <select
                value={cuisineType}
                onChange={(e) => setCuisineType(e.target.value)}
                className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none"
              >
                <option value="">Select cuisine type</option>
                {CUISINE_TYPES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

        </div>
        {(error || authError) && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <p className="text-sm text-red-700">{error || authError}</p>
          </div>
        )}
        <Button
          className="w-full h-12 mt-5"
          disabled={loading || !restaurantName || !address || !city || !country}
          onClick={handleCreateSubmit}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Creating your restaurant...
            </>
          ) : (
            'Create Restaurant'
          )}
        </Button>
      </motion.div>
  )

  // Single step key — AnimatePresence fires ONLY when the user actually navigates between steps
  const stepKey = `${path}-${path === 'join' ? pathAStep : pathBStep}`

  const content = (() => {
    if (path === 'selector') return pathSelector()
    if (path === 'join') return pathAStep === 1 ? pathAStep1() : pathAStep2()
    if (path === 'create') return pathBStep === 1 ? pathBStep1() : pathBStep2()
  })()

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-wine-50/30 to-gray-50 px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-lg"
      >
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, type: 'spring' }}
            className="inline-flex items-center justify-center w-16 h-16 bg-wine-600 rounded-2xl mb-4 shadow-lg"
          >
            <Wine className="w-8 h-8 text-white" />
          </motion.div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Join WineOps AI</h1>
          <p className="text-gray-600">Transform your restaurant's wine operations</p>
        </div>
        <div className="bg-white/60 backdrop-blur-md border border-white/20 rounded-2xl shadow-2xl p-8 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            {/* stepKey changes only on path/step navigation — never on field keystrokes */}
            <div key={stepKey}>
              {content}
            </div>
          </AnimatePresence>
        </div>
        <p className="text-center text-sm text-gray-500 mt-8">© 2026 WineOps AI. All rights reserved.</p>
      </motion.div>
    </div>
  )
}
