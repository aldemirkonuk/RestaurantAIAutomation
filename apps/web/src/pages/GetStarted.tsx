import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Camera, MapPin, PenLine } from 'lucide-react'
import { BrandMark } from '../components/brand/BrandMark'
import { PlacesAutocomplete, type PlaceResult } from '../components/ui/PlacesAutocomplete'
import { CountryCombobox } from '../components/ui/CountryCombobox'
import { MenuCsvUpload } from '../components/onboarding/MenuCsvUpload'
import { MenuScanUpload } from '../components/onboarding/MenuScanUpload'
import { MenuManualEntry } from '../components/onboarding/MenuManualEntry'
import { CurrencyStep } from '../components/onboarding/CurrencyStep'
import { ThresholdStep } from '../components/onboarding/ThresholdStep'
import { useAuth, type JobRole } from '../contexts/AuthContext'
import { apiClient } from '../services/api/client'
import { getOnboardingProgress, importMenu, type MenuImportResult } from '../services/api/menus'
import { currencyForCountry, currencyToRecord } from '../lib/currency'
import { getBrowserTimezone } from '../lib/browserTimezone'
import { toE164ForCountry } from '../lib/phone'
import { writeProof } from '../lib/firstProof'
import { isMapsConfigured } from '../lib/googleMaps'
import { houseNotOpened, HOUSE_OPEN_DETAILS_LATER } from '../lib/houseOpeningWords'
import { READ_WITHOUT_ANSWER, readWithoutAnswer } from '../lib/menuReadWithoutAnswer'
import { SCAN_ACCEPT, isImageFile, isScannable, isTabular, resetFileInput } from '../lib/uploadAccept'

type Step = 'you' | 'restaurant' | 'menu' | 'reading' | 'threshold'
type Role = 'Owner' | 'General manager' | 'Beverage lead' | 'Chef'
type MenuMethod = 'photo' | 'file' | 'typed' | null

const roles: Role[] = ['Owner', 'General manager', 'Beverage lead', 'Chef']

/** Each chip as the gateway keeps it on the new house (F-899, ADR 0213 row 9). */
const JOB_ROLE: Record<Role, JobRole> = {
  Owner: 'owner',
  'General manager': 'general_manager',
  'Beverage lead': 'beverage_lead',
  Chef: 'chef',
}

/**
 * How long a read with no answer may still be running on the gateway: the
 * model read alone may take 180 s, so five minutes covers it with room (F-803).
 */
const UNANSWERED_READ_WINDOW_MS = 5 * 60 * 1000

/** The same cap the account route and PATCH /auth/me keep on a name (F-243). */
const NAME_MAX = 100

/**
 * A half-finished arrival, kept in this browser so a reload or a return picks
 * up where the person stopped (F-007). One record, owned by one account: it is
 * read back only for the account that wrote it, and dropped once the house is
 * open and its menu step is behind them.
 */
const ARRIVAL_DRAFT_KEY = 'mudavym:arrival-draft'
type ArrivalDraft = {
  userId: string
  role: Role | null
  restaurantName: string
  address: string
  city: string
  country: string
  stateProvince: string
  postalCode: string
  restaurantPhone: string
  placePoint: { latitude: number; longitude: number; googlePlaceId?: string } | null
  /** The currency picked on step 02, kept so a reload does not fall back to the country's (F-983). */
  currencyChoice?: string | null
  /** Step 01's mobile, kept until the house's country can read it (F-1212). */
  mobile?: string
}

/**
 * The role tapped on step 01, kept for this tab only and under the account
 * that tapped it: a shared laptop's next account starts with none selected
 * (F-984, ADR 0213 row 9).
 */
/** The house opened, but step 01's mobile was not kept (F-1212). */
const MOBILE_NOT_KEPT = 'Your mobile number was not saved; you can add it on your profile.'

const arrivalRoleKey = (userId: string) => `mudavym:arrival-role:${userId}`

function readArrivalDraft(userId: string): ArrivalDraft | null {
  try {
    const raw = localStorage.getItem(ARRIVAL_DRAFT_KEY)
    if (!raw) return null
    const draft = JSON.parse(raw) as ArrivalDraft
    return draft?.userId === userId ? draft : null
  } catch {
    return null
  }
}

function writeArrivalDraft(draft: ArrivalDraft) {
  try {
    localStorage.setItem(ARRIVAL_DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // A browser that keeps nothing still finishes the arrival; it just cannot resume it.
  }
}

function dropArrivalDraft() {
  try {
    localStorage.removeItem(ARRIVAL_DRAFT_KEY)
  } catch {
    // Nothing kept, nothing to drop.
  }
}

function ArrivalShell({
  step,
  children,
}: {
  step: Step
  children: React.ReactNode
}) {
  const label = {
    you: '01 · You',
    restaurant: '02 · Your restaurant',
    menu: '03 · Your menu',
    reading: '04 · Reading',
    threshold: 'Low stock',
  }[step]
  return (
    <div className="min-h-screen bg-[#fbfaf7] text-[#211f1b]">
      <header className="h-14 border-b border-[#211f1b]/15 px-5 flex items-center justify-between bg-white">
        <BrandMark size={24} alt="Mudavym" />
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#6d685f]">
          {label}
        </span>
      </header>
      <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:py-16">{children}</main>
    </div>
  )
}

/**
 * Opening a house needs a signed-in, verified person: every step saves to
 * their account. Without this gate a signed-out visitor filled in step 01 and
 * was told "Unauthorized" (F-439). The steps mount only once the person is
 * known, so step 01 starts from their name rather than an empty field.
 */
export default function GetStarted() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login?redirect=/get-started" replace />
  if (user.emailVerified === false) return <Navigate to="/verify-email" replace />
  return <GetStartedSteps />
}

function GetStartedSteps() {
  const navigate = useNavigate()
  const { user, createFirstHouse, activeRestaurantId } = useAuth()
  // A person whose house is already open comes here only to read a menu
  // (/house/menu's "Read a menu"): steps 01-02 would end in "This account
  // already has a house" (F-893, F-239). They start on the menu step.
  // The "Finish setup" nudge sends an open house that has not set its
  // low-stock threshold here with ?step=threshold (F-985, F-239). The number
  // is the whole house's, so only an owner or a manager is asked it; anyone
  // else starts on the menu step as before (F-1060).
  const [searchParams] = useSearchParams()
  const setsHouseNumbers = user?.role === 'owner' || user?.role === 'manager'
  const askedThreshold =
    Boolean(user?.restaurantId) && setsHouseNumbers && searchParams.get('step') === 'threshold'
  const [step, setStep] = useState<Step>(() =>
    askedThreshold ? 'threshold' : user?.restaurantId ? 'menu' : 'you',
  )
  const [name, setName] = useState(user?.name ?? '')
  const [mobile, setMobile] = useState('')
  const [role, setRole] = useState<Role | null>(() => {
    if (!user?.userId) return null
    try {
      const kept = sessionStorage.getItem(arrivalRoleKey(user.userId))
      return roles.includes(kept as Role) ? (kept as Role) : null
    } catch {
      return null
    }
  })
  const [restaurantName, setRestaurantName] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [country, setCountry] = useState('')
  const [stateProvince, setStateProvince] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [restaurantPhone, setRestaurantPhone] = useState('')
  const [placePoint, setPlacePoint] = useState<{
    latitude: number
    longitude: number
    googlePlaceId?: string
  } | null>(null)
  const [locationBias, setLocationBias] = useState<{
    latitude: number
    longitude: number
  } | null>(null)
  const [locationStatus, setLocationStatus] = useState<string | null>(null)
  const [menuMethod, setMenuMethod] = useState<MenuMethod>(null)
  const [pendingResult, setPendingResult] = useState<MenuImportResult | null>(null)
  const [sourceImage, setSourceImage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dropping, setDropping] = useState(false)
  const menuPickerRef = useRef<HTMLInputElement>(null)
  // The file whose read went out with no answer back, and when. The gateway
  // may still be reading and keeping it, so the same file dropped again inside
  // that window is not sent a second time (F-803).
  const unansweredRead = useRef<{ key: string; at: number } | null>(null)

  // The house is asked its currency, defaulted from the address (ADR 0117
  // Q25): `null` while the stated default stands, '' for "not yet" (F-900).
  const [currencyChoice, setCurrencyChoice] = useState<string | null>(null)
  const currency = useMemo(
    () => currencyToRecord(currencyChoice, currencyForCountry(country)),
    [country, currencyChoice],
  )
  // The browser's own zone, or undefined if it will not say (item 62,
  // 2026-09-27) — never a made-up default. `createHouse` sends exactly this;
  // omitted, the gateway stores NULL rather than inventing a clock.
  const timezone = useMemo(() => getBrowserTimezone(), [])

  // F-007: resume a half-finished arrival once we know whose it is. Step 01's
  // answers are already saved on the account; the restaurant's details and the
  // step are what a reload used to lose. The step comes from the account, not
  // the draft: the menu step when the account really has its house, else the
  // restaurant step with what was typed — nothing claims a house that is not open.
  const resumed = useRef(false)
  const userId = user?.userId
  const hasHouse = Boolean(user?.restaurantId)
  useEffect(() => {
    if (resumed.current || !userId) return
    resumed.current = true
    const draft = readArrivalDraft(userId)
    if (!draft) return
    setRole(draft.role)
    setRestaurantName(draft.restaurantName)
    setAddress(draft.address)
    setCity(draft.city)
    setCountry(draft.country)
    setStateProvince(draft.stateProvince)
    setPostalCode(draft.postalCode)
    setRestaurantPhone(draft.restaurantPhone)
    setPlacePoint(draft.placePoint)
    setCurrencyChoice(draft.currencyChoice ?? null)
    if (draft.mobile) setMobile(draft.mobile)
    setStep(hasHouse ? (askedThreshold ? 'threshold' : 'menu') : 'restaurant')
  }, [askedThreshold, hasHouse, userId])

  useEffect(() => {
    if (!userId || (step !== 'restaurant' && step !== 'menu')) return
    writeArrivalDraft({
      userId,
      role,
      restaurantName,
      address,
      city,
      country,
      stateProvince,
      postalCode,
      restaurantPhone,
      placePoint,
      currencyChoice,
      mobile,
    })
  }, [address, city, country, currencyChoice, mobile, placePoint, postalCode, restaurantName, restaurantPhone, role, stateProvince, step, userId])

  useEffect(() => {
    if (step !== 'reading' || !pendingResult) return
    const timer = window.setTimeout(() => {
      dropArrivalDraft()
      // Kept with the house it was read for, so another house never shows it.
      writeProof(pendingResult, sourceImage, activeRestaurantId)
      navigate('/house/menu', { replace: true })
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [activeRestaurantId, navigate, pendingResult, sourceImage, step])

  const saveYou = async () => {
    setSaving(true)
    setError(null)
    try {
      // The mobile waits for the house's country (F-1212): "0532 123 45 67"
      // is only a number once we know it is Turkish. createHouse keeps it.
      await apiClient.patch('/auth/me', { name: name.trim() })
      if (role && userId) {
        try {
          sessionStorage.setItem(arrivalRoleKey(userId), role)
        } catch {
          // A tab that keeps nothing still carries the role in this sitting.
        }
      }
      setStep('restaurant')
    } catch (cause: any) {
      setError(cause?.response?.data?.message || cause?.message || 'We could not save this yet.')
    } finally {
      setSaving(false)
    }
  }

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus('Location is not available in this browser.')
      return
    }
    setLocationStatus('Finding your location…')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocationBias({ latitude: coords.latitude, longitude: coords.longitude })
        setLocationStatus('Restaurant search is now centred near you.')
      },
      () => setLocationStatus('We could not use your location. Search by name or address instead.'),
      { enableHighAccuracy: false, timeout: 8000 },
    )
  }

  const selectPlace = (place: PlaceResult) => {
    if (place.placeName) setRestaurantName(place.placeName)
    setAddress(place.streetAddress)
    setCity(place.city)
    setCountry(place.country)
    setStateProvince(place.stateProvince)
    setPostalCode(place.postalCode)
    if (place.latitude != null && place.longitude != null) {
      setPlacePoint({
        latitude: place.latitude,
        longitude: place.longitude,
        googlePlaceId: place.googlePlaceId ?? undefined,
      })
    }
  }

  /** Step 01's mobile, read in the house's country now it is known (F-1212). */
  const keepMobile = async (houseCountry: string) => {
    try {
      await apiClient.patch('/auth/me', { phone: toE164ForCountry(mobile, houseCountry) })
      return true
    } catch {
      return false
    }
  }

  const createHouse = async () => {
    if (!restaurantName.trim() || !address.trim() || !city.trim() || !country.trim()) {
      setError('Restaurant name and full address are required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const opened = await createFirstHouse({
        restaurantName: restaurantName.trim(),
        address: address.trim(),
        city: city.trim(),
        country: country.trim(),
        stateProvince: stateProvince.trim() || undefined,
        postalCode: postalCode.trim() || undefined,
        restaurantPhone: restaurantPhone.trim() || undefined,
        timezone,
        currency: currency ?? undefined,
        latitude: placePoint?.latitude,
        longitude: placePoint?.longitude,
        googlePlaceId: placePoint?.googlePlaceId,
        jobRole: role ? JOB_ROLE[role] : undefined,
      })
      const mobileKept = mobile.trim() ? await keepMobile(country) : true
      const said = [
        opened.detailsLoaded ? null : HOUSE_OPEN_DETAILS_LATER,
        mobileKept ? null : MOBILE_NOT_KEPT,
      ].filter(Boolean)
      setNotice(said.length ? said.join(' ') : null)
      setStep('menu')
    } catch (cause) {
      // Said from the status alone (F-006). A 409 means an earlier press
      // opened the house; going on into it from here is F-006 OPEN-2.
      setError(houseNotOpened(cause, 'arrival'))
    } finally {
      setSaving(false)
    }
  }

  const menuRead = (result: MenuImportResult, source?: { image?: string | null }) => {
    setPendingResult(result)
    setSourceImage(source?.image ?? null)
    setStep('reading')
  }

  /**
   * One menu read from the drop zone, dropped or picked (F-010, F-012).
   *
   * A read is one photo or one PDF: each becomes its own menu version, and
   * the first proof shows one. So several files are not read one and lost
   * after it, as before, when only the first was taken and the rest dropped
   * in silence. They are refused with the way through: one page at a time,
   * or the whole menu as one PDF, every page of which is read. A PDF is read
   * here too rather than bounced to another panel to be picked again; a
   * spreadsheet goes to "Send a file", which shows its columns before it is
   * read, and the owner is told so.
   */
  const ingestMenuFiles = async (files: FileList | File[] | null | undefined) => {
    const picked = Array.from(files ?? [])
    if (picked.length === 0) return
    setNotice(null)
    if (picked.length > 1) {
      setError(
        `That was ${picked.length} files, and none of them was read. Here a menu is read one photo at a time — drop one page, or send the whole menu as one PDF, where every page is read.`,
      )
      return
    }
    const [file] = picked
    if (!isScannable(file)) {
      if (isTabular(file)) {
        setError(null)
        setMenuMethod('file')
        setNotice(`"${file.name}" is a spreadsheet. Choose it under Send a file below, to see its columns before it is read.`)
      } else {
        setError(`"${file.name}" is not a photo, a PDF or a spreadsheet, so it was not read.`)
      }
      return
    }
    const key = `${file.name}|${file.size}|${file.lastModified}`
    const pending = unansweredRead.current
    if (pending && pending.key === key && Date.now() - pending.at < UNANSWERED_READ_WINDOW_MS) {
      setError(READ_WITHOUT_ANSWER)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error(`We could not open "${file.name}".`))
        reader.readAsDataURL(file)
      })
      // The gateway reads the file's own bytes; a "data:…;base64," prefix
      // left on them is not a photo it can read.
      const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl
      const result = await importMenu('scan', { imageBase64: base64 })
      menuRead(result, { image: isImageFile(file) ? dataUrl : null })
    } catch (cause: any) {
      if (readWithoutAnswer(cause)) {
        unansweredRead.current = { key, at: Date.now() }
        setError(READ_WITHOUT_ANSWER)
        return
      }
      setError(cause?.response?.data?.message || cause?.message || 'We could not read that menu.')
    } finally {
      setSaving(false)
    }
  }

  if (step === 'threshold') {
    return <ThresholdArrival onMenu={() => setStep('menu')} />
  }

  if (step === 'you') {
    return (
      <ArrivalShell step={step}>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#1a5e6b]">Welcome</p>
        <h1 className="mt-3 font-serif text-4xl sm:text-5xl leading-tight">
          Welcome, {name.trim().split(/\s+/)[0] || 'there'}. Let&apos;s set up your restaurant.
        </h1>
        <div className="mt-10 space-y-7">
          <label className="block border-b border-[#211f1b]/25 pb-2">
            <span className="text-xs uppercase tracking-wider">Your name · required</span>
            <input
              aria-label="Your name"
              maxLength={NAME_MAX}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-2 block w-full bg-transparent font-serif text-2xl outline-none"
            />
          </label>
          <label className="block border-b border-[#211f1b]/25 pb-2">
            <span className="text-xs uppercase tracking-wider">Mobile · optional</span>
            <input
              aria-label="Mobile"
              value={mobile}
              onChange={(event) => setMobile(event.target.value)}
              placeholder="Your own number"
              className="mt-2 block w-full bg-transparent text-base outline-none"
            />
          </label>
          {mobile.trim() && (
            <p className="text-sm text-[#6d685f]">
              Kept on your profile. We send no texts unless you turn them on in Settings.
              Optional — the account does not depend on it.
            </p>
          )}
          <fieldset>
            <legend className="text-xs uppercase tracking-wider">Role · optional</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {roles.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setRole(item)}
                  className={`border px-3 py-2 text-sm ${role === item ? 'border-[#1a5e6b] bg-[#1a5e6b] text-white' : 'border-[#211f1b]/20 bg-white'}`}
                >
                  {item}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        {error && <p role="alert" className="mt-5 text-sm text-red-700">{error}</p>}
        <button
          type="button"
          disabled={!name.trim() || saving}
          onClick={saveYou}
          className="mt-9 bg-[#1a5e6b] px-6 py-3 text-white disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Continue'}
        </button>
      </ArrivalShell>
    )
  }

  if (step === 'restaurant') {
    return (
      <ArrivalShell step={step}>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#1a5e6b]">The house</p>
        <h1 className="mt-3 font-serif text-4xl sm:text-5xl">Your restaurant</h1>
        <p className="mt-3 max-w-xl text-[#6d685f]">
          Find the exact place. Its country suggests the currency the house keeps its money in; change it below if that is wrong.
        </p>
        <p className="mt-2 max-w-xl text-sm text-[#6d685f]">
          {isMapsConfigured()
            ? 'New, or not on Google yet? Type the name and address in the boxes below — the search is only a shortcut.'
            : 'Search is not available right now. Type the name and address in the boxes below.'}
        </p>
        <div className="mt-9 space-y-5">
          <label htmlFor="arrival-place" className="block">
            <span className="text-xs uppercase tracking-wider">Find your restaurant</span>
            <PlacesAutocomplete
              id="arrival-place"
              value={address}
              onChange={(value) => {
                setAddress(value)
                setPlacePoint(null)
              }}
              onPlaceSelect={selectPlace}
              locationBias={locationBias}
              placeholder="Restaurant name or address"
              className="mt-2 rounded-none border-x-0 border-t-0 bg-transparent"
            />
          </label>
          <button type="button" onClick={useMyLocation} className="flex items-center gap-2 text-sm text-[#1a5e6b]">
            <MapPin className="h-4 w-4" /> Use my location
          </button>
          {locationStatus && <p role="status" className="text-xs text-[#6d685f]">{locationStatus}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="border-b border-[#211f1b]/25 pb-2">
              <span className="text-xs uppercase tracking-wider">Restaurant name · required</span>
              <input aria-label="Restaurant name" value={restaurantName} onChange={(e) => setRestaurantName(e.target.value)} className="mt-2 w-full bg-transparent text-lg outline-none" />
            </label>
            <label className="border-b border-[#211f1b]/25 pb-2">
              <span className="text-xs uppercase tracking-wider">Address · required</span>
              <input aria-label="Address" value={address} onChange={(e) => { setAddress(e.target.value); setPlacePoint(null) }} className="mt-2 w-full bg-transparent text-lg outline-none" />
            </label>
            <label className="border-b border-[#211f1b]/25 pb-2">
              <span className="text-xs uppercase tracking-wider">Restaurant phone · optional</span>
              <input aria-label="Restaurant phone" value={restaurantPhone} onChange={(e) => setRestaurantPhone(e.target.value)} className="mt-2 w-full bg-transparent text-lg outline-none" />
            </label>
            <label className="border-b border-[#211f1b]/25 pb-2">
              <span className="text-xs uppercase tracking-wider">City · required</span>
              <input aria-label="City" value={city} onChange={(e) => setCity(e.target.value)} className="mt-2 w-full bg-transparent text-lg outline-none" />
            </label>
            <div>
              <span className="text-xs uppercase tracking-wider">Country · required</span>
              <CountryCombobox id="arrival-country" value={country} onChange={setCountry} />
            </div>
          </div>
          <div className="border-y border-[#211f1b]/15 py-4 text-sm">
            <span>Timezone · {timezone ?? 'Not detected'}</span>
            <p className="mt-2 text-xs text-[#6d685f]">
              {timezone
                ? "The timezone is this device's clock, not the address's. If the restaurant keeps another, change it in Settings once the house is open."
                : "This device did not give a timezone. Set the restaurant's in Settings once the house is open."}
            </p>
          </div>
          <CurrencyStep country={country} choice={currencyChoice} onChange={setCurrencyChoice} />
        </div>
        {error && <p role="alert" className="mt-5 text-sm text-red-700">{error}</p>}
        <button type="button" onClick={createHouse} disabled={saving} className="mt-8 bg-[#1a5e6b] px-6 py-3 text-white disabled:opacity-40">
          {saving ? 'Opening the house…' : 'This is us'}
        </button>
      </ArrivalShell>
    )
  }

  if (step === 'menu') {
    return (
      <ArrivalShell step={step}>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#1a5e6b]">The first inscription</p>
        <h1 className="mt-3 font-serif text-4xl sm:text-5xl">Your menu</h1>
        <p className="mt-3 text-[#6d685f]">Drop the menu here. Mudavym will set it as the house&apos;s own list.</p>
        {notice && <p role="status" className="mt-3 text-sm text-[#6d685f]">{notice}</p>}
        <input
          ref={menuPickerRef}
          type="file"
          accept={SCAN_ACCEPT}
          multiple
          aria-label="Choose the menu"
          className="hidden"
          onChange={(event) => {
            const input = event.target
            const files = Array.from(input.files ?? [])
            resetFileInput(input)
            void ingestMenuFiles(files)
          }}
        />
        <button
          type="button"
          disabled={saving}
          onClick={() => menuPickerRef.current?.click()}
          onDragEnter={() => setDropping(true)}
          onDragOver={(event) => {
            event.preventDefault()
            setDropping(true)
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDropping(false)
            if (saving) return
            void ingestMenuFiles(event.dataTransfer.files)
          }}
          className={`mt-10 flex min-h-[220px] w-full flex-col items-center justify-center border border-dashed px-6 text-center ${
            dropping ? 'border-[#1a5e6b] bg-white' : 'border-[#211f1b]/25 bg-[#fbfaf7]'
          }`}
        >
          <span className="font-serif text-3xl">Drop the menu here</span>
          <span className="mt-3 text-sm text-[#6d685f]">
            {saving ? 'Reading…' : 'A photo of a page, or a PDF of the whole menu. Drop it, or click to choose it.'}
          </span>
        </button>
        {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <button type="button" onClick={() => setMenuMethod(menuMethod === 'photo' ? null : 'photo')} className="flex items-center gap-1 text-[#1a5e6b] underline underline-offset-4">
            <Camera className="h-3.5 w-3.5" /> Use the camera
          </button>
          <button type="button" onClick={() => setMenuMethod(menuMethod === 'file' ? null : 'file')} className="text-[#1a5e6b] underline underline-offset-4">
            Send a file
          </button>
          <button type="button" onClick={() => setMenuMethod(menuMethod === 'typed' ? null : 'typed')} className="flex items-center gap-1 text-[#1a5e6b] underline underline-offset-4">
            <PenLine className="h-3.5 w-3.5" /> Type a few lines
          </button>
        </div>
        <div className="mt-6">
          {menuMethod === 'photo' && <MenuScanUpload onSuccess={menuRead} />}
          {menuMethod === 'file' && <MenuCsvUpload onSuccess={menuRead} />}
          {menuMethod === 'typed' && <MenuManualEntry onSuccess={menuRead} />}
        </div>
        <div className="mt-8 border border-dashed border-[#211f1b]/20 px-4 py-3 text-sm text-[#b7b2a8]">
          <p className="text-[11px] uppercase tracking-[0.12em]">Later</p>
          <p>Your last invoice — read the same way, set beside the menu. Not a step now.</p>
        </div>
        <div className="mt-6 border-t border-[#211f1b]/15 pt-5">
          <button
            type="button"
            onClick={() => {
              dropArrivalDraft()
              navigate('/house', { replace: true })
            }}
            className="text-sm text-[#6d685f] underline underline-offset-4"
          >
            Skip for now — open the house
          </button>
        </div>
      </ArrivalShell>
    )
  }

  return (
    <ArrivalShell step="reading">
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#1a5e6b]">Reading</p>
      <h1 className="mt-3 font-serif text-4xl sm:text-5xl">The facts are settling.</h1>
      <div className="mt-12 space-y-4 border-y border-[#211f1b]/20 py-7 font-serif text-2xl">
        <p>Lines named.</p>
        <p>Prices placed.</p>
        <p>Sections taking shape.</p>
      </div>
      <p role="status" className="mt-6 text-sm text-[#6d685f]">Opening the first proof…</p>
    </ArrivalShell>
  )
}


/**
 * The low-stock threshold, the half of "Finish setup" no page used to ask
 * (F-985, F-239). Saved or skipped, the house's progress is read again so the
 * nudge clears once both halves are done; a house with no menu yet goes on to
 * the menu step, one with a menu goes back to the house.
 */
function ThresholdArrival({ onMenu }: { onMenu: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ['onboarding-progress'] })
    const progress = await queryClient
      .fetchQuery({ queryKey: ['onboarding-progress'], queryFn: getOnboardingProgress })
      .catch(() => null)
    if (progress && !progress.menu_uploaded) onMenu()
    else navigate('/house', { replace: true })
  }
  return (
    <ArrivalShell step="threshold">
      <ThresholdStep onDone={() => void done()} />
    </ArrivalShell>
  )
}
