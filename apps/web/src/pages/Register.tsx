import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { Wine, Users, Building2, ArrowRight, ArrowLeft, Check, X, Loader2, AlertCircle, Mail, Lock, User, ChevronRight } from 'lucide-react'
import { BrandMark } from '../components/brand/BrandMark'
import { PhoneNumberInput } from '../components/ui/PhoneNumberInput'
import { countryToPhoneDefault, isValidPhone, toE164 } from '../lib/phone'
import { currencyForCountry, currencyToRecord } from '../lib/currency'
import { CurrencyStep } from '../components/onboarding/CurrencyStep'
import { Button } from '../components/ui'
import { PlacesAutocomplete, type PlaceResult } from '../components/ui/PlacesAutocomplete'
import { CountryCombobox } from '../components/ui/CountryCombobox'
import { CuisinePicker } from '../components/ui/CuisinePicker'
import { apiClient } from '../services/api/client'

// Email availability check result
type EmailAvailability = {
  checking: boolean
  available: boolean | null
  error: string | null
}

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

  /**
   * The money this house reports in — asked, never assumed.
   *
   * `restaurants.currency` carried `DEFAULT 'USD'` and this form never named the
   * column, so all fourteen production houses asserted dollars: two in Turkiye,
   * one in London, none of them ever asked (ADR 0117 Q25, founder 2026-09-05).
   * The default is dropped and the question is asked here.
   *
   * Three states, and they are deliberately distinct:
   *   - `null`  the manager has not touched it, so the STATED DEFAULT below
   *             stands and is what gets sent. The screen says so in words
   *             before it is recorded (ADR 0083).
   *   - a code  the manager confirmed or changed it.
   *   - `''`    the manager explicitly chose "not now". NOTHING is sent, the row
   *             stores NULL, and every screen says "currency not recorded"
   *             rather than printing a dollar sign.
   */
  const [currencyChoice, setCurrencyChoice] = useState<string | null>(null)

  /**
   * The point the house asserted, taken from the Google Places selection.
   *
   * `restaurants.latitude` / `.longitude` have existed since
   * `supabase/migrations/20260807001252_distributor_geo_foundation.sql:50-51`
   * and were NULL on all 14 production rows, because this form resolved the
   * coordinate as part of the same `fetchFields` call that fills in the city and
   * postcode (PlacesAutocomplete.tsx:248-260) and then dropped it. Nothing that
   * needs a location — the calendar's weather overlay first — can exist without
   * it (ADR 0111 slice 1).
   *
   * It is null until a place is CHOSEN from the list, and it is cleared the
   * moment the address is edited by hand: a coordinate that no longer matches
   * the address on screen is worse than none, because nothing downstream can
   * tell the two apart.
   */
  const [placePoint, setPlacePoint] = useState<{
    latitude: number
    longitude: number
    googlePlaceId: string | null
  } | null>(null)

  // Restaurant form section (left-rail sub-navigation within pathBStep 2)
  const [restaurantSection, setRestaurantSection] = useState<1 | 2 | 3>(1)

  // Email availability checking state
  const [joinEmailCheck, setJoinEmailCheck] = useState<EmailAvailability>({ checking: false, available: null, error: null })
  const [createEmailCheck, setCreateEmailCheck] = useState<EmailAvailability>({ checking: false, available: null, error: null })
  const emailDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Email availability check — returns true=available, false=taken, null=error/unknown
  const checkEmailAvailability = useCallback(async (
    email: string,
    setEmailCheck: (check: EmailAvailability) => void,
  ): Promise<boolean | null> => {
    if (!email || !email.includes('@')) {
      setEmailCheck({ checking: false, available: null, error: null })
      return null
    }

    setEmailCheck({ checking: true, available: null, error: null })

    try {
      const { data } = await apiClient.get<{ available: boolean; email: string }>(
        `/auth/check-email?email=${encodeURIComponent(email)}`,
      )
      setEmailCheck({
        checking: false,
        available: data.available,
        error: data.available ? null : 'This email is already registered. Please sign in instead.',
      })
      return data.available
    } catch {
      // Network / server error — don't block registration, let the backend validate
      setEmailCheck({ checking: false, available: null, error: null })
      return null
    }
  }, [])

  // Debounced email check for Path A (join)
  const debouncedCheckJoinEmail = useCallback((email: string) => {
    if (emailDebounceRef.current) clearTimeout(emailDebounceRef.current)
    emailDebounceRef.current = setTimeout(() => {
      checkEmailAvailability(email, setJoinEmailCheck)
    }, 400)
  }, [checkEmailAvailability])

  // Debounced email check for Path B (create)
  const debouncedCheckCreateEmail = useCallback((email: string) => {
    if (emailDebounceRef.current) clearTimeout(emailDebounceRef.current)
    emailDebounceRef.current = setTimeout(() => {
      checkEmailAvailability(email, setCreateEmailCheck)
    }, 400)
  }, [checkEmailAvailability])

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
        const { data } = await apiClient.get<InvitePreview>(
          `/auth/invite/${inviteCode.toUpperCase()}`,
        )
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

  // PATH SELECTOR — Desktop: 2-col feature cards | Mobile: bold stacked
  const pathSelector = () => (
    <motion.div
      key="selector"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.25 }}
    >
      {/* ── DESKTOP: Feature Cards (≥641px) ── */}
      <div className="hidden sm:grid grid-cols-2 gap-4">
        {/* Join card */}
        <button
          type="button"
          onClick={() => setPath('join')}
          className="bg-white border border-gray-200 rounded-2xl p-7 text-left hover:-translate-y-0.5 transition-all hover:shadow-card-hover hover:border-gray-300"
        >
          <div className="w-[50px] h-[50px] rounded-[13px] bg-wine-100 flex items-center justify-center mb-[18px]">
            <Users className="w-[22px] h-[22px] text-wine-600" />
          </div>
          <p className="font-bold text-gray-900 text-[1.1rem] leading-tight mb-2">Join Your Team</p>
          <p className="text-[0.8rem] text-gray-500 leading-[1.55] mb-5">
            Your manager sent you an invite. Enter the 8-character code to join their restaurant.
          </p>
          <ul className="space-y-[7px] mb-6">
            {['Instant dashboard access', 'Role assigned by owner', 'No email verification needed'].map((item) => (
              <li key={item} className="flex items-center gap-[7px] text-[0.8rem] text-gray-500">
                <Check className="w-[11px] h-[11px] text-wine-600 flex-shrink-0" />
                {item}
              </li>
            ))}
          </ul>
          <div className="w-full py-[11px] px-[18px] rounded-[9px] bg-wine-600 text-white text-[0.9rem] font-bold text-center">
            Enter Invite Code →
          </div>
        </button>

        {/* Create card */}
        <button
          type="button"
          onClick={() => setPath('create')}
          className="bg-wine-600 rounded-2xl p-7 text-left hover:-translate-y-0.5 transition-all hover:bg-wine-700"
          style={{ boxShadow: '0 8px 24px rgba(26,94,107,0.3)' }}
        >
          <div className="w-[50px] h-[50px] rounded-[13px] bg-white/20 flex items-center justify-center mb-[18px]">
            <Wine className="w-[22px] h-[22px] text-white" />
          </div>
          <p className="font-bold text-white text-[1.1rem] leading-tight mb-2">Open a Restaurant</p>
          <p className="text-[0.8rem] text-white/75 leading-[1.55] mb-5">
            Register your restaurant and start managing wine inventory with AI in minutes.
          </p>
          <ul className="space-y-[7px] mb-6">
            {['AI inventory agents', 'POS + supplier sync', 'Multi-location ready'].map((item) => (
              <li key={item} className="flex items-center gap-[7px] text-[0.8rem] text-white/85">
                <Check className="w-[11px] h-[11px] text-white/90 flex-shrink-0" />
                {item}
              </li>
            ))}
          </ul>
          <div className="w-full py-[11px] px-[18px] rounded-[9px] bg-white/20 text-white text-[0.9rem] font-bold text-center hover:bg-white/30 transition-colors">
            Get Started Free →
          </div>
        </button>
      </div>

      {/* ── MOBILE: Bold primary stacked (<641px) ── */}
      <div className="sm:hidden flex flex-col gap-[14px]">
        {/* Create — primary */}
        <button
          type="button"
          onClick={() => setPath('create')}
          className="relative bg-wine-600 rounded-[20px] p-[26px] text-left overflow-hidden hover:-translate-y-0.5 transition-all"
          style={{ boxShadow: '0 8px 24px rgba(26,94,107,0.3)' }}
        >
          <span
            className="inline-flex items-center gap-[5px] bg-white/20 text-white text-[0.65rem] font-bold tracking-widest uppercase px-[9px] py-[3px] rounded-full mb-3"
          >
            Most Popular
          </span>
          <p className="font-bold text-white text-[1.2rem] mb-[5px]">Create a New Restaurant</p>
          <p className="text-[0.8125rem] text-white/80">Set up your restaurant in under 3 minutes</p>
          <div className="absolute right-[22px] top-1/2 -translate-y-1/2 w-[34px] h-[34px] rounded-full bg-white/20 flex items-center justify-center">
            <ArrowRight className="w-[14px] h-[14px] text-white" />
          </div>
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 text-gray-400 text-[0.75rem]">
          <div className="flex-1 h-px bg-gray-200" />
          or
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* Join — secondary glassmorphism */}
        <button
          type="button"
          onClick={() => setPath('join')}
          className="bg-white/70 backdrop-blur border border-gray-200 rounded-[18px] px-[22px] py-[20px] flex items-center gap-[14px] hover:border-wine-400 hover:-translate-y-0.5 transition-all"
        >
          <div className="w-[40px] h-[40px] rounded-[11px] bg-wine-100 flex items-center justify-center flex-shrink-0">
            <Users className="w-[18px] h-[18px] text-wine-600" />
          </div>
          <div className="text-left">
            <p className="font-bold text-gray-900 text-[0.9375rem] mb-[2px]">Join an Existing Restaurant</p>
            <p className="text-[0.78rem] text-gray-500">I have an invite code from my manager</p>
          </div>
          <ChevronRight className="w-[14px] h-[14px] text-gray-400 ml-auto" />
        </button>
      </div>

      {/* Trust row — desktop only */}
      <div className="hidden sm:flex items-center justify-center gap-[18px] mt-4">
        {['No credit card', '3-minute setup', 'Cancel anytime'].map((item) => (
          <span key={item} className="flex items-center gap-[5px] text-xs text-gray-400">
            <Check className="w-[11px] h-[11px] text-green-600 flex-shrink-0" />
            {item}
          </span>
        ))}
      </div>

      <p className="text-center text-sm text-gray-500 mt-6">
        Already have an account?{' '}
        <Link to="/login" className="text-wine-600 hover:text-wine-700 font-medium">
          Sign in
        </Link>
      </p>
    </motion.div>
  )

  // PATH A — Step 1: Invite code entry
  const pathAStep1 = () => (
    <motion.div
      key="pathA-1"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.25 }}
    >
      {/* Back */}
      <button
        type="button"
        onClick={() => setPath('selector')}
        className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      {/* Step indicator: two dots connected by a line */}
      <div className="flex items-start mb-7">
        {/* Step 1 — active */}
        <div className="flex flex-col items-center gap-1">
          <div className="w-7 h-7 rounded-full bg-wine-600 text-white text-[0.7rem] font-bold flex items-center justify-center shadow-[0_2px_8px_rgba(26,94,107,0.3)]">
            1
          </div>
          <span className="text-[0.68rem] font-semibold text-wine-600">Code</span>
        </div>
        {/* Connector line */}
        <div className="flex-1 h-[2px] bg-gray-200 mt-[13px] mx-1" />
        {/* Step 2 — pending */}
        <div className="flex flex-col items-center gap-1">
          <div className="w-7 h-7 rounded-full bg-gray-100 border-2 border-gray-200 text-gray-400 text-[0.7rem] font-bold flex items-center justify-center">
            2
          </div>
          <span className="text-[0.68rem] font-semibold text-gray-400">Account</span>
        </div>
      </div>

      {/* Heading */}
      <div className="mb-[22px]">
        <h2 className="font-display text-[1.4rem] font-extrabold text-gray-900 tracking-tight mb-[5px]">
          Enter your invite code
        </h2>
        <p className="text-[0.875rem] text-gray-500">8-character code — check your email or Slack</p>
      </div>

      {/* Code input */}
      <div className="mb-[14px]">
        <div className="flex justify-between items-center text-[0.8rem] font-semibold text-gray-900 mb-[7px]">
          Invite Code
          <span className="font-normal text-gray-400 text-[0.74rem]">Auto-validates when complete</span>
        </div>
        <div className="relative">
          <input
            id="invite-code"
            type="text"
            aria-label="Invite Code"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase().slice(0, 8))}
            className={[
              'block w-full py-4 px-[18px] pr-[50px]',
              'font-mono text-2xl font-bold tracking-[0.2em] uppercase text-center',
              'border-2 rounded-xl outline-none transition-all',
              invitePreview?.valid === true
                ? 'border-green-500 focus:border-green-500 shadow-[0_0_0_3px_rgba(5,150,105,0.08)]'
                : invitePreview?.valid === false
                  ? 'border-red-400 focus:border-red-400 shadow-[0_0_0_3px_rgba(220,38,38,0.08)]'
                  : 'border-gray-200 focus:border-wine-600 focus:shadow-[0_0_0_3px_rgba(26,94,107,0.08)]',
            ].join(' ')}
            placeholder="········"
            maxLength={8}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
          {/* Status icon */}
          {validating && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2">
              <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
            </div>
          )}
          {!validating && invitePreview?.valid === true && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
              <Check className="w-[10px] h-[10px] text-white stroke-[3]" />
            </div>
          )}
          {!validating && invitePreview?.valid === false && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-red-500 flex items-center justify-center">
              <X className="w-[10px] h-[10px] text-white stroke-[3]" />
            </div>
          )}
        </div>
      </div>

      {/* Trust card (valid) */}
      <AnimatePresence>
        {invitePreview?.valid === true && (
          <motion.div
            key="trust-card"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="mb-4 border border-green-200 rounded-xl overflow-hidden"
          >
            {/* Green top */}
            <div className="bg-green-50 px-4 py-[14px] flex items-center gap-[10px]">
              <div className="w-[38px] h-[38px] rounded-[10px] bg-white border border-green-200 flex items-center justify-center flex-shrink-0">
                <Wine className="w-[18px] h-[18px] text-green-600" />
              </div>
              <div>
                <p className="font-display font-bold text-green-900 text-[0.9375rem]">
                  {invitePreview.restaurant}
                  {invitePreview.city && ` — ${invitePreview.city}`}
                </p>
              </div>
              <div className="ml-auto w-[22px] h-[22px] rounded-full bg-green-500 flex items-center justify-center">
                <Check className="w-[11px] h-[11px] text-white stroke-[3]" />
              </div>
            </div>
            {/* White bottom */}
            <div className="bg-white px-4 py-[10px] flex justify-between">
              <div className="flex flex-col gap-[2px]">
                <span className="text-[0.67rem] uppercase tracking-[0.07em] text-gray-400 font-semibold">Invited by</span>
                <span className="text-[0.8rem] font-bold text-gray-900">{invitePreview.inviter}</span>
              </div>
              <div className="w-px bg-gray-100" />
              <div className="flex flex-col gap-[2px]">
                <span className="text-[0.67rem] uppercase tracking-[0.07em] text-gray-400 font-semibold">Your Role</span>
                <span className="text-[0.8rem] font-bold text-wine-600">{invitePreview.role}</span>
              </div>
              <div className="w-px bg-gray-100" />
              <div className="flex flex-col gap-[2px]">
                <span className="text-[0.67rem] uppercase tracking-[0.07em] text-gray-400 font-semibold">Expires</span>
                <span className="text-[0.8rem] font-bold text-gray-900">7 days</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Invalid card */}
      <AnimatePresence>
        {invitePreview?.valid === false && (
          <motion.div
            key="invalid-card"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="mb-4 flex items-center gap-[9px] bg-red-50 border border-red-200 rounded-lg px-[14px] py-[11px]"
          >
            <X className="w-[15px] h-[15px] text-red-600 flex-shrink-0" />
            <span className="text-[0.8125rem] text-red-600 font-medium">
              {invitePreview.reason === 'expired'
                ? 'This invite code has expired. Contact the restaurant owner for a new one.'
                : invitePreview.reason === 'used'
                  ? 'This invite code has already been used.'
                  : 'Code not found, expired, or already used'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <Button
        className="w-full h-12"
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
        {/* Full Name */}
        <div>
          <label htmlFor="join-name" className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              id="join-name"
              type="text"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              placeholder="Jane Smith"
              className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Email with availability check */}
        <div>
          <label htmlFor="join-email" className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              id="join-email"
              type="email"
              value={joinEmail}
              onChange={(e) => {
                setJoinEmail(e.target.value)
                debouncedCheckJoinEmail(e.target.value)
              }}
              placeholder="jane@restaurant.com"
              className={[
                'block w-full pl-10 pr-10 py-3 border rounded-lg bg-white/80 focus:ring-2 focus:outline-none transition-all',
                joinEmailCheck.available === false
                  ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
                  : joinEmailCheck.available === true
                    ? 'border-green-400 focus:border-green-500 focus:ring-green-500/20'
                    : 'border-gray-300 focus:border-wine-500 focus:ring-wine-500/20'
              ].join(' ')}
            />
            {/* Status icon */}
            {joinEmailCheck.checking && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
              </div>
            )}
            {!joinEmailCheck.checking && joinEmailCheck.available === true && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                <Check className="w-3 h-3 text-white stroke-[3]" />
              </div>
            )}
            {!joinEmailCheck.checking && joinEmailCheck.available === false && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center">
                <X className="w-3 h-3 text-white stroke-[3]" />
              </div>
            )}
          </div>
          {/* Availability message */}
          <AnimatePresence mode="wait">
            {joinEmailCheck.available === false && joinEmailCheck.error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="mt-2 flex items-center gap-2 text-sm text-red-600"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{joinEmailCheck.error}</span>
                <Link to="/login" className="text-wine-600 hover:text-wine-700 font-medium underline">
                  Sign in
                </Link>
              </motion.div>
            )}
            {joinEmailCheck.available === true && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="mt-1 text-xs text-green-600"
              >
                Email is available
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Password */}
        <div>
          <label htmlFor="join-password" className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              id="join-password"
              type="password"
              value={joinPassword}
              onChange={(e) => setJoinPassword(e.target.value)}
              placeholder="••••••••"
              className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none"
            />
          </div>
          <p className="text-xs text-gray-400 mt-1">Min. 8 characters</p>
        </div>

        {/* Confirm Password */}
        <div>
          <label htmlFor="join-confirm-password" className="block text-sm font-medium text-gray-700 mb-1">Confirm Password *</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              id="join-confirm-password"
              type="password"
              value={joinConfirm}
              onChange={(e) => setJoinConfirm(e.target.value)}
              placeholder="••••••••"
              className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none"
            />
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
        disabled={loading || joinEmailCheck.checking || !joinName || !joinEmail || !joinPassword || !joinConfirm || joinEmailCheck.available === false}
        onClick={async () => {
          // If debounced check hasn't settled, run immediately before submitting
          let available = joinEmailCheck.available
          if (available === null && joinEmail && joinEmail.includes('@')) {
            available = await checkEmailAvailability(joinEmail, setJoinEmailCheck)
          }
          if (available === false) {
            setError('This email is already registered. Please sign in instead.')
            return
          }
          handleJoinSubmit()
        }}
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Joining...
          </>
        ) : joinEmailCheck.checking ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Checking email…
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
      {/* Step indicator (simple bar for Path B step 1) */}
      <div className="flex items-center gap-2 mb-6">
        <div className="h-1.5 flex-1 rounded-full bg-wine-600" />
        <div className="h-1.5 flex-1 rounded-full bg-gray-200" />
        <span className="text-xs text-gray-400 ml-1">Step 1 of 2</span>
      </div>
      <h2 className="text-xl font-bold text-gray-900 mb-5">Your Account</h2>
      <div className="space-y-4">
        {/* Full Name */}
        <div>
          <label htmlFor="create-name" className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              id="create-name"
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="John Smith"
              className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Email with availability check */}
        <div>
          <label htmlFor="create-email" className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              id="create-email"
              type="email"
              value={createEmail}
              onChange={(e) => {
                setCreateEmail(e.target.value)
                debouncedCheckCreateEmail(e.target.value)
              }}
              placeholder="john@myrestaurant.com"
              className={[
                'block w-full pl-10 pr-10 py-3 border rounded-lg bg-white/80 focus:ring-2 focus:outline-none transition-all',
                createEmailCheck.available === false
                  ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
                  : createEmailCheck.available === true
                    ? 'border-green-400 focus:border-green-500 focus:ring-green-500/20'
                    : 'border-gray-300 focus:border-wine-500 focus:ring-wine-500/20'
              ].join(' ')}
            />
            {/* Status icon */}
            {createEmailCheck.checking && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
              </div>
            )}
            {!createEmailCheck.checking && createEmailCheck.available === true && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                <Check className="w-3 h-3 text-white stroke-[3]" />
              </div>
            )}
            {!createEmailCheck.checking && createEmailCheck.available === false && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center">
                <X className="w-3 h-3 text-white stroke-[3]" />
              </div>
            )}
          </div>
          {/* Availability message */}
          <AnimatePresence mode="wait">
            {createEmailCheck.available === false && createEmailCheck.error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="mt-2 flex items-center gap-2 text-sm text-red-600"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{createEmailCheck.error}</span>
                <Link to="/login" className="text-wine-600 hover:text-wine-700 font-medium underline">
                  Sign in
                </Link>
              </motion.div>
            )}
            {createEmailCheck.available === true && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="mt-1 text-xs text-green-600"
              >
                Email is available
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Password */}
        <div>
          <label htmlFor="create-password" className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              id="create-password"
              type="password"
              value={createPassword}
              onChange={(e) => setCreatePassword(e.target.value)}
              placeholder="••••••••"
              className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none"
            />
          </div>
          <p className="text-xs text-gray-400 mt-1">Min. 8 characters</p>
        </div>

        {/* Confirm Password */}
        <div>
          <label htmlFor="create-confirm-password" className="block text-sm font-medium text-gray-700 mb-1">Confirm Password *</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              id="create-confirm-password"
              type="password"
              value={createConfirm}
              onChange={(e) => setCreateConfirm(e.target.value)}
              placeholder="••••••••"
              className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none"
            />
          </div>
        </div>
      </div>
      <Button
        type="button"
        className="w-full h-12 mt-5"
        disabled={
          !createName ||
          !createEmail ||
          createPassword.length < 8 ||
          createPassword !== createConfirm ||
          createEmailCheck.available === false ||
          createEmailCheck.checking
        }
        onClick={async () => {
          if (createPassword !== createConfirm) {
            setError('Passwords do not match')
            return
          }

          // If the debounced check hasn't settled, run it immediately now
          let available = createEmailCheck.available
          if (available === null && createEmail && createEmail.includes('@')) {
            available = await checkEmailAvailability(createEmail, setCreateEmailCheck)
          }

          if (available === false) {
            setError('This email is already registered. Please sign in instead.')
            return
          }

          setError(null)
          setPathBStep(2)
        }}
      >
        {createEmailCheck.checking ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Checking email…
          </>
        ) : (
          <>Next: Restaurant Details <ArrowRight className="w-4 h-4 ml-1" /></>
        )}
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

  const handleCreateSubmit = async () => {
    if (!restaurantName || !address || !city || !country) {
      setError('Restaurant name, address, city, and country are required')
      return
    }
    if (phone.trim() && !isValidPhone(phone)) {
      setError('Please enter a valid phone number for the selected country')
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
        phone: phone ? toE164(phone, countryToPhoneDefault(country)) : undefined,
        cuisineType: cuisineType || undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        // Sent only when the currency step produced an answer — the stated
        // default the manager left standing, or the code they picked. Omitted
        // when they chose "not now", and the gateway then writes NULL rather
        // than USD (ADR 0117 Q25). Never `|| 'USD'`: that fallback is exactly
        // what put dollars on a restaurant in Fethiye.
        currency: willRecordCurrency ?? undefined,
        // Sent only when a place was chosen from the list. A hand-typed address
        // carries no point, and the gateway stores NULL rather than a guess.
        latitude: placePoint?.latitude,
        longitude: placePoint?.longitude,
        googlePlaceId: placePoint?.googlePlaceId ?? undefined,
      })
      navigate('/verify-email', { replace: true })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  // Country entered enough to trigger the rest of the form
  const countryReady = country.trim().length >= 2

  // The default worked out from the address's country, or null when this table
  // has no row for it. `null` is shown as a question, never filled with USD.
  const currencyDefault = currencyForCountry(country)
  // What will actually be recorded: the manager's answer if they gave one, the
  // stated default otherwise, and nothing at all if they chose "not now".
  const willRecordCurrency = currencyToRecord(currencyChoice, currencyDefault)

  // Left-rail section labels
  const railSections = [
    { num: 1 as const, label: 'Identity', sub: 'Name, cuisine' },
    { num: 2 as const, label: 'Location', sub: 'Address, city, ZIP' },
    { num: 3 as const, label: 'Contact', sub: 'Phone (optional)' },
  ]

  const pathBStep2 = () => (
    <motion.div
      key="pathB-2"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.25 }}
    >
      {/* Left-rail layout on desktop */}
      <div className="sm:grid sm:grid-cols-[200px_1fr] sm:gap-6">

        {/* Left Rail — hidden on mobile */}
        <div className="hidden sm:block bg-white/50 backdrop-blur border border-white/40 rounded-2xl p-5 h-fit sticky top-6">
          <p className="text-xs uppercase tracking-wider text-gray-400 font-bold mb-4">Step 2 of 2</p>
          <div className="space-y-0">
            {railSections.map(({ num, label, sub }) => {
              const isDone = num < restaurantSection
              const isActive = num === restaurantSection
              return (
                <div key={num} className="relative">
                  {/* Connector line between items */}
                  {num > 1 && (
                    <div className="absolute left-[9px] top-0 w-[2px] h-[7px] bg-gray-200" />
                  )}
                  <div className="flex items-start gap-[9px] py-[7px]">
                    <div
                      className={[
                        'w-5 h-5 rounded-full flex items-center justify-center text-[0.62rem] font-bold flex-shrink-0 transition-all',
                        isDone ? 'bg-green-500 text-white' : '',
                        isActive ? 'bg-wine-600 text-white shadow-[0_2px_6px_rgba(26,94,107,0.35)]' : '',
                        !isDone && !isActive ? 'bg-gray-100 text-gray-400 border border-gray-200' : '',
                      ].join(' ')}
                    >
                      {isDone ? <Check className="w-[9px] h-[9px] stroke-[3]" /> : num}
                    </div>
                    <div>
                      <p
                        className={[
                          'text-[0.8rem] font-semibold',
                          isDone ? 'text-gray-500' : '',
                          isActive ? 'text-wine-600' : '',
                          !isDone && !isActive ? 'text-gray-400' : '',
                        ].join(' ')}
                      >
                        {label}
                      </p>
                      <p className="text-[0.68rem] text-gray-400">{sub}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {/* Progress bar */}
          <div className="mt-[18px] pt-[14px] border-t border-gray-200">
            <div className="h-[5px] bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-wine-600 rounded-full transition-all duration-300"
                style={{ width: `${(restaurantSection / 3) * 100}%` }}
              />
            </div>
            <p className="text-[0.75rem] text-gray-500 mt-1">Section {restaurantSection} of 3</p>
          </div>
        </div>

        {/* Main panel */}
        <div>
          {/* Panel 1: Identity */}
          {restaurantSection === 1 && (
            <div className="bg-white/60 backdrop-blur-md border border-white/20 rounded-2xl shadow-xl p-7">
              <span className="inline-flex items-center bg-wine-100 text-wine-600 text-[0.68rem] font-bold uppercase tracking-[0.07em] px-[9px] py-[3px] rounded-full mb-[10px]">
                Section 1 of 3
              </span>
              <h2 className="font-display text-[1.2rem] font-extrabold text-gray-900 tracking-tight mb-[3px]">
                Restaurant Identity
              </h2>
              <p className="text-[0.84rem] text-gray-500 mb-[22px]">
                What's the name and type of your restaurant?
              </p>

              {/* Restaurant Name */}
              <div className="mb-[18px]">
                <label htmlFor="restaurant-name" className="block text-sm font-medium text-gray-700 mb-1">
                  Restaurant Name <span className="text-wine-600">*</span>
                </label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    id="restaurant-name"
                    type="text"
                    value={restaurantName}
                    onChange={(e) => setRestaurantName(e.target.value)}
                    placeholder="The Oak Room"
                    className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none"
                    autoFocus
                  />
                </div>
              </div>

              {/* Cuisine Type */}
              <div className="mb-0" role="group" aria-labelledby="restaurant-cuisine-label">
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control --
                    group label for the CuisinePicker composite: associated via the
                    wrapper's role="group" + aria-labelledby, which the rule cannot see.
                    An htmlFor at the trigger would overwrite its accessible name. */}
                <label id="restaurant-cuisine-label" className="block text-sm font-medium text-gray-700 mb-1">
                  Cuisine Type <span className="text-gray-400 font-normal text-xs">(optional)</span>
                </label>
                <CuisinePicker value={cuisineType} onChange={setCuisineType} />
              </div>

              {/* Nav */}
              <div className="flex gap-[10px] mt-5">
                <button
                  type="button"
                  onClick={() => { setPathBStep(1); setError(null) }}
                  className="flex-1 py-3 border border-gray-200 rounded-[10px] bg-white text-gray-700 text-[0.9rem] font-bold hover:border-gray-300 transition-colors"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={() => setRestaurantSection(2)}
                  className="flex-[2] py-3 border-none rounded-[10px] bg-wine-600 text-white text-[0.9rem] font-bold hover:bg-wine-700 transition-colors flex items-center justify-center gap-[7px]"
                >
                  Next: Location
                  <ArrowRight className="w-[13px] h-[13px]" />
                </button>
              </div>
            </div>
          )}

          {/* Panel 2: Location */}
          {restaurantSection === 2 && (
            <div className="bg-white/60 backdrop-blur-md border border-white/20 rounded-2xl shadow-xl p-7">
              <span className="inline-flex items-center bg-wine-100 text-wine-600 text-[0.68rem] font-bold uppercase tracking-[0.07em] px-[9px] py-[3px] rounded-full mb-[10px]">
                Section 2 of 3
              </span>
              <h2 className="font-display text-[1.2rem] font-extrabold text-gray-900 tracking-tight mb-[3px]">
                Location
              </h2>
              <p className="text-[0.84rem] text-gray-500 mb-[22px]">
                Where is your restaurant located?
              </p>

              {/* Country */}
              <div className="mb-[18px]">
                <label htmlFor="restaurant-country" className="block text-sm font-medium text-gray-700 mb-1">Country <span className="text-wine-600">*</span></label>
                <CountryCombobox id="restaurant-country" value={country} onChange={setCountry} />
                {!countryReady && (
                  <p className="text-xs text-gray-400 mt-1">Enter your country to continue filling in the address</p>
                )}
              </div>

              {/* Street Address — Google Places Autocomplete */}
              <div className="mb-[18px]">
                <label htmlFor="restaurant-address" className="block text-sm font-medium text-gray-700 mb-1">
                  Street Address <span className="text-wine-600">*</span>
                </label>
                <PlacesAutocomplete
                  id="restaurant-address"
                  country={country}
                  value={address}
                  onChange={(next) => {
                    setAddress(next)
                    // Typed by hand: whatever point was captured belongs to a
                    // different address now.
                    setPlacePoint(null)
                  }}
                  onPlaceSelect={(place: PlaceResult) => {
                    setAddress(place.streetAddress)
                    if (place.city) setCity(place.city)
                    if (place.stateProvince) setStateProvince(place.stateProvince)
                    if (place.postalCode) setPostalCode(place.postalCode)
                    if (place.country) setCountry(place.country)
                    if (place.neighborhood) setNeighborhood(place.neighborhood)
                    // Google declines a location for some predictions; that is a
                    // real "no coordinate", never 0,0.
                    setPlacePoint(
                      typeof place.latitude === 'number' && typeof place.longitude === 'number'
                        ? {
                            latitude: place.latitude,
                            longitude: place.longitude,
                            googlePlaceId: place.googlePlaceId,
                          }
                        : null,
                    )
                  }}
                  placeholder="Start typing your street address…"
                  className="py-3 border-gray-300 bg-white/80 focus:ring-2 focus:ring-wine-500"
                />
              </div>

              {/* City + State */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label htmlFor="restaurant-city" className="block text-sm font-medium text-gray-700 mb-1">City <span className="text-wine-600">*</span></label>
                  <input
                    id="restaurant-city"
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Chicago"
                    className="block w-full px-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="restaurant-state" className="block text-sm font-medium text-gray-700 mb-1">{countryLocale.stateLabel}</label>
                  <input
                    id="restaurant-state"
                    type="text"
                    value={stateProvince}
                    onChange={(e) => setStateProvince(e.target.value)}
                    placeholder={countryLocale.statePlaceholder}
                    className="block w-full px-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* ZIP + Neighborhood */}
              <div className="grid grid-cols-2 gap-3 mb-0">
                <div>
                  <label htmlFor="restaurant-postal-code" className="block text-sm font-medium text-gray-700 mb-1">{countryLocale.postalLabel}</label>
                  <input
                    id="restaurant-postal-code"
                    type="text"
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                    placeholder={countryLocale.postalPlaceholder}
                    className="block w-full px-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="restaurant-neighborhood" className="block text-sm font-medium text-gray-700 mb-1">
                    {countryLocale.areaLabel}
                    <span className="text-gray-400 font-normal ml-1 text-xs">(optional)</span>
                  </label>
                  <input
                    id="restaurant-neighborhood"
                    type="text"
                    value={neighborhood}
                    onChange={(e) => setNeighborhood(e.target.value)}
                    placeholder={countryLocale.areaPlaceholder}
                    className="block w-full px-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none"
                  />
                </div>
              </div>

              {/*
                The currency step, extracted so the decision can be rendered and
                asserted on its own (`components/onboarding/CurrencyStep.tsx`).
                It sits under the address because it is DERIVED from it: the
                default comes from the country above and moves when that moves.
              */}
              <CurrencyStep
                country={country}
                choice={currencyChoice}
                onChange={setCurrencyChoice}
              />

              {/* Nav */}
              <div className="flex gap-[10px] mt-5">
                <button
                  type="button"
                  onClick={() => setRestaurantSection(1)}
                  className="flex-1 py-3 border border-gray-200 rounded-[10px] bg-white text-gray-700 text-[0.9rem] font-bold hover:border-gray-300 transition-colors"
                >
                  ← Identity
                </button>
                <button
                  type="button"
                  onClick={() => setRestaurantSection(3)}
                  className="flex-[2] py-3 border-none rounded-[10px] bg-wine-600 text-white text-[0.9rem] font-bold hover:bg-wine-700 transition-colors flex items-center justify-center gap-[7px]"
                >
                  Next: Contact
                  <ArrowRight className="w-[13px] h-[13px]" />
                </button>
              </div>
            </div>
          )}

          {/* Panel 3: Contact */}
          {restaurantSection === 3 && (
            <div className="bg-white/60 backdrop-blur-md border border-white/20 rounded-2xl shadow-xl p-7">
              <span className="inline-flex items-center bg-wine-100 text-wine-600 text-[0.68rem] font-bold uppercase tracking-[0.07em] px-[9px] py-[3px] rounded-full mb-[10px]">
                Section 3 of 3
              </span>
              <h2 className="font-display text-[1.2rem] font-extrabold text-gray-900 tracking-tight mb-[3px]">
                Contact Details
              </h2>
              <p className="text-[0.84rem] text-gray-500 mb-[22px]">
                Optional. Helps with reservations.
              </p>

              {/* Phone */}
              <div className="mb-0">
                <label htmlFor="restaurant-phone" className="block text-sm font-medium text-gray-700 mb-1">
                  Phone Number <span className="text-gray-400 font-normal text-xs">(optional)</span>
                </label>
                <PhoneNumberInput
                  id="restaurant-phone"
                  value={phone}
                  onChange={setPhone}
                  countryHint={country}
                  className="bg-white/80 py-3"
                  invalid={Boolean(phone.trim() && !isValidPhone(phone))}
                />
                {phone.trim() && !isValidPhone(phone) && (
                  <p className="text-xs text-rose-600 mt-1">Enter a valid phone number for the selected country.</p>
                )}
                <p className="text-xs text-gray-400 mt-1">You can add this any time from Settings.</p>
              </div>

              {/* Error banner */}
              <AnimatePresence>
                {(error || authError) && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2"
                  >
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-700 flex-1">{error || authError}</p>
                    <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-1">
                      <X className="w-4 h-4" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Nav */}
              <div className="flex gap-[10px] mt-5">
                <button
                  type="button"
                  onClick={() => setRestaurantSection(2)}
                  className="flex-1 py-3 border border-gray-200 rounded-[10px] bg-white text-gray-700 text-[0.9rem] font-bold hover:border-gray-300 transition-colors"
                >
                  ← Location
                </button>
                <button
                  type="button"
                  onClick={handleCreateSubmit}
                  disabled={loading || !restaurantName || !address || !city || !country}
                  className="flex-[2] py-3 border-none rounded-[10px] bg-wine-600 text-white text-[0.9rem] font-bold hover:bg-wine-700 transition-colors flex items-center justify-center gap-[7px] disabled:opacity-45 disabled:cursor-not-allowed disabled:transform-none"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating your restaurant…
                    </>
                  ) : (
                    'Create Restaurant →'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )

  // Single step key — AnimatePresence fires ONLY when the user actually navigates between steps
  const stepKey = `${path}-${path === 'join' ? pathAStep : pathBStep}`

  const content = (() => {
    if (path === 'selector') return pathSelector()
    if (path === 'join') return pathAStep === 1 ? pathAStep1() : pathAStep2()
    if (path === 'create') return pathBStep === 1 ? pathBStep1() : pathBStep2()
  })()

  // For the restaurant form (path B step 2), render outside the card to support the wider rail layout
  const isRestaurantForm = path === 'create' && pathBStep === 2

  return (
    <div className="relative min-h-screen flex items-start justify-center px-4 py-12 overflow-hidden bg-[#FAF7F5]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(26,94,107,0.10),transparent_50%),radial-gradient(ellipse_at_100%_100%,rgba(26,94,107,0.07),transparent_45%)]"
      />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className={isRestaurantForm ? 'relative w-full max-w-4xl' : 'relative w-full max-w-2xl'}
      >
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, type: 'spring' }}
            className="inline-flex mb-5"
          >
            <BrandMark size={34} />
          </motion.div>
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900 mb-2">Join Mudavym</h1>
          <p className="text-[15px] text-gray-500">Transform your restaurant&apos;s wine operations</p>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {isRestaurantForm ? (
            /* Restaurant form: no card wrapper — the rail layout manages its own panels */
            <div key={stepKey}>
              {content}
            </div>
          ) : (
            /* All other steps: standard glass card */
            <div
              key={stepKey}
              className="rounded-2xl border border-wine-100/80 bg-white/80 backdrop-blur-md p-8 overflow-hidden shadow-[0_24px_64px_-24px_rgba(26,94,107,0.18),0_8px_24px_-12px_rgba(15,23,42,0.08)]"
            >
              {content}
            </div>
          )}
        </AnimatePresence>

        <p className="text-center text-xs text-gray-400 mt-8">© 2026 Mudavym. All rights reserved.</p>
      </motion.div>
    </div>
  )
}
