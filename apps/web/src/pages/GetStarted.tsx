import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MapPin, PenLine } from 'lucide-react'
import { BrandMark } from '../components/brand/BrandMark'
import { PlacesAutocomplete, type PlaceResult } from '../components/ui/PlacesAutocomplete'
import { CountryCombobox } from '../components/ui/CountryCombobox'
import { MenuCsvUpload } from '../components/onboarding/MenuCsvUpload'
import { MenuScanUpload } from '../components/onboarding/MenuScanUpload'
import { MenuManualEntry } from '../components/onboarding/MenuManualEntry'
import { useAuth, type User } from '../contexts/AuthContext'
import { apiClient, getErrorStatus, isUnconfirmedWrite } from '../services/api/client'
import { importMenu, type MenuImportResult } from '../services/api/menus'
import { CURRENCY_CODES, currencyForCountry, currencyLabel, currencyToRecord } from '../lib/currency'
import { settingsApi } from '../services/api/settings'
import { getBrowserTimezone } from '../lib/browserTimezone'
import { countryCodeFor } from '../lib/countries'
import { zoneForPlace } from '../lib/zoneForPlace'
import { writeProof } from '../lib/firstProof'
import { fitPhotoForReading } from '../lib/fitPhoto'
import { readHouseMenuStanding, type HouseMenuStanding } from '../lib/houseMenuStanding'
import { isMapsConfigured } from '../lib/googleMaps'
import { houseNotOpened, HOUSE_OPEN_DETAILS_LATER } from '../lib/houseOpeningWords'

/**
 * Two steps (OB-7, proposal F6, the session's call under the 2026-11-07
 * /goal): the old "You" step only re-showed the name sign-up already took and
 * asked a role nothing read, so the welcome moved into the restaurant step.
 */
type Step = 'restaurant' | 'menu'
type MenuMethod = 'photo' | 'file' | 'typed' | null

/** Where a signed-out visitor is sent, and brought back here after. */
const SIGN_IN_THEN_GET_STARTED = '/login?redirect=%2Fget-started'

/**
 * The entry rule (BL-1, B-12; fork F8), from the session's house and role:
 * staff and managers go to the desk, never owner onboarding; an owner (or no
 * role) resumes at the menu step; no house starts at the first step.
 */
type Entry = 'sign-in' | 'verify' | 'desk' | 'menu' | 'restaurant'

function entryFor(user: Pick<User, 'restaurantId' | 'role' | 'emailVerified'> | null): Entry {
  if (!user) return 'sign-in'
  // An address not yet verified cannot open a house (the gateway answers 403,
  // auth.service.ts createFirstHouse): sending it to the form first let a
  // person fill every field and then be told only "We could not create the
  // house." Only an explicit `false` counts, as on /choose-house.
  if (user.emailVerified === false) return 'verify'
  if (user.restaurantId) {
    return user.role === 'staff' || user.role === 'manager' ? 'desk' : 'menu'
  }
  return 'restaurant'
}

/** Said when the account has a house but this page could not load it. */
const HOUSE_NOT_LOADED =
  'This account already has a house, but it did not load here just now. Choose it to go on.'

/** The two other ways in, named wherever a photo is not read (walk 2026-11-12, r21). */
const OTHER_WAYS = 'or send a file or type a few lines below instead.'

/**
 * What the menu step says when a dropped photo is not read, from the status
 * alone. Every sentence names a way on: a 503 is also what a house hears
 * while the photo reader is switched off, and "try again in a moment" alone
 * then sent the person round the same drop zone for good.
 */
/** The reader's own sentence on a refused read, when it is one sentence a person can read. */
function readerSaid(cause: unknown): string | null {
  const m = (cause as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  if (typeof m !== 'string') return null
  const t = m.trim()
  return t.length > 0 && t.length <= 300 ? t : null
}

function photoNotRead(cause: unknown): string {
  const status = getErrorStatus(cause)
  if (status === 413) return 'That photo is too large to send. Try a smaller one, or send a file.'
  if (status === 429) return 'Too many tries in a short time. Wait a minute, then try again.'
  if (isUnconfirmedWrite(cause)) return `We could not read that photo just now. Try again in a moment, ${OTHER_WAYS}`
  // A read that ended `failed` comes back as a 422 carrying the reader's own
  // sentence (services/api/menus.ts, MenuReadFailed): "The menu reader is not
  // switched on here…", "No line could be read from this file…". Those say
  // why; a fixed "could not find a menu in that photo" blamed the photo when
  // the reader was off (r21 production-build walk).
  const said = status === 422 ? readerSaid(cause) : null
  if (said) return `${said} You can also send a file or type a few lines below.`
  if (status === 400 || status === 422)
    return 'We could not find a menu in that photo. Try a clearer photo, or send a file.'
  return `We could not read that photo. Try again, ${OTHER_WAYS}`
}

/** "the restaurant name, the city and the country" — what is still empty, by name. */
function missingSentence(missing: string[]): string {
  const named = missing.map((field) => `the ${field}`)
  const list =
    named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`
  return `Add ${list} to open the house.`
}

/** Enter in a typed field opens the house, as a form would (not the pickers: their Enter chooses). */
function submitOnEnter(submit: () => void) {
  return (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    submit()
  }
}

function ArrivalShell({
  step,
  onSignOut,
  children,
}: {
  /** Null while the entry rule has not decided yet: no step is named. */
  step: Step | null
  /** The way out for a signed-in person on the wrong account; absent before entry. */
  onSignOut?: () => void
  children?: React.ReactNode
}) {
  const label = step
    ? {
        restaurant: '01 · Your restaurant',
        menu: '02 · Your menu',
      }[step]
    : null
  return (
    <div className="min-h-screen bg-[#fbfaf7] text-[#211f1b]">
      <header className="h-14 border-b border-[#211f1b]/15 px-5 flex items-center justify-between bg-white">
        <BrandMark size={24} alt="Mudavym" />
        <div className="flex items-center gap-5">
          {label && (
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#6d685f]">
              {label}
            </span>
          )}
          {onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              className="text-xs text-[#6d685f] underline underline-offset-4"
            >
              Sign out
            </button>
          )}
        </div>
      </header>
      <main aria-busy={step === null} className="mx-auto w-full max-w-3xl px-5 py-10 sm:py-16">
        {children}
      </main>
    </div>
  )
}

export default function GetStarted() {
  const navigate = useNavigate()
  const { user, loading, createFirstHouse, signInWithSession, logout } = useAuth()
  // No step shows until the entry rule decides, so Welcome never flashes.
  const [step, setStep] = useState<Step>('restaurant')
  const [entered, setEntered] = useState(false)
  const entryDecided = useRef(false)
  const [name, setName] = useState(user?.name ?? '')
  const nameTouched = useRef(false)
  const [rerouting, setRerouting] = useState(false)
  const [houseNotLoaded, setHouseNotLoaded] = useState(false)
  const [changingName, setChangingName] = useState(false)
  const [restaurantName, setRestaurantName] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [country, setCountry] = useState('')
  const [stateProvince, setStateProvince] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [restaurantPhone, setRestaurantPhone] = useState('')
  // What the picked place said about itself (OB-7): its country code and its
  // UTC offset now. Cleared when the address is typed over, or when the
  // country is changed to another one (fix round, #1055): the clock then
  // follows the country the page shows, never the earlier place's.
  const [placeCountryCode, setPlaceCountryCode] = useState<string | null>(null)
  const [placeOffset, setPlaceOffset] = useState<number | null>(null)
  const [pickedZone, setPickedZone] = useState('')
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
  const [error, setError] = useState<string | null>(null)
  // A 403 from opening the house means the address is not verified yet.
  const [needsVerify, setNeedsVerify] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dropping, setDropping] = useState(false)
  // What was dropped that the photo reader does not take at once (a PDF, a
  // spreadsheet, several files): staged in the file box, never thrown away.
  const [droppedFiles, setDroppedFiles] = useState<File[] | null>(null)

  // The house's money (r28 onboarding gap 4, ADR 0117 Q25: "ask each house in
  // onboarding, set a default from location"). The country offers a default;
  // the owner can change it or leave it unset, and a pick is undone when the
  // country changes, as the clock's is. `null` follows the country.
  const [currencyChoice, setCurrencyChoice] = useState<string | null>(null)
  const countryCurrency = useMemo(() => currencyForCountry(country), [country])
  const currency = currencyToRecord(currencyChoice, countryCurrency)
  // An owner sent back to the menu step (/house, the setup strip, the
  // checklist) enters with no country on this page, so the money is read from
  // the house itself (r28 gap 9): the typed-line price boxes keep "(TRY)".
  const [keptCurrency, setKeptCurrency] = useState<string | null>(null)
  // Where the house's menu stands, read when an owner comes back to the menu
  // step (r28 gap 14). A house opened on this visit has no menu to read.
  const openedHere = useRef(false)
  const [menuStanding, setMenuStanding] = useState<HouseMenuStanding | null>(null)
  const menuCurrency = country.trim() ? currency : keptCurrency
  const mapsOn = isMapsConfigured()
  // The house's clock comes from the place, not the browser (OB-7, F7): a
  // one-zone country names it; else the browser zone when its offset matches
  // the place; else the person picks. Never a made-up default (item 62):
  // with no answer `createHouse` omits it and the gateway stores NULL.
  const browserZone = useMemo(() => getBrowserTimezone(), [])
  const zone = useMemo(
    () =>
      zoneForPlace({
        countryCode: placeCountryCode ?? countryCodeFor(country),
        utcOffsetMinutes: placeOffset,
        browserZone,
      }),
    [browserZone, country, placeCountryCode, placeOffset],
  )
  // A pick made for an earlier place or country is not this one's.
  const pickStands = zone.source === 'pick' && zone.choices.includes(pickedZone)
  const timezone = zone.source === 'pick' ? (pickStands ? pickedZone : undefined) : zone.zone

  const changeCountry = (next: string) => {
    setCountry(next)
    setCurrencyChoice(null)
    const nextCode = countryCodeFor(next)?.toUpperCase() ?? null
    if (placeCountryCode && nextCode !== placeCountryCode.toUpperCase()) {
      setPlaceCountryCode(null)
      setPlaceOffset(null)
    }
    setPickedZone('')
  }

  // Decided once: later step changes are the person's own.
  useEffect(() => {
    if (loading || entryDecided.current) return
    entryDecided.current = true
    const entry = entryFor(user)
    if (entry === 'sign-in') navigate(SIGN_IN_THEN_GET_STARTED, { replace: true })
    else if (entry === 'verify') navigate('/verify-email', { replace: true })
    else if (entry === 'desk') navigate('/', { replace: true })
    else {
      if (entry === 'menu') setStep('menu')
      setEntered(true)
    }
  }, [loading, navigate, user])

  // Read once per entry to the menu step, only when this visit did not open
  // the house (and so holds no country). A read that fails leaves the boxes
  // without a currency, as before: never a guessed one.
  useEffect(() => {
    if (step !== 'menu' || country.trim()) return
    let live = true
    settingsApi
      .houseCurrency()
      .then((read) => {
        if (live && read?.readable && read.code) setKeptCurrency(read.code)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [step, country])

  // A house whose menu is already current is not offered "One last step"
  // again (r28 gap 14): the help links to the guide all land here, and a read
  // here made one more draft beside the current menu. It goes to /house,
  // which says what the house holds. A kept draft is named, with the way to
  // choose it. A read that fails leaves the menu step as it was.
  useEffect(() => {
    if (step !== 'menu' || openedHere.current) return
    let live = true
    void readHouseMenuStanding().then((standing) => {
      if (!live) return
      if (standing === 'current') navigate('/house', { replace: true })
      else setMenuStanding(standing)
    })
    return () => {
      live = false
    }
  }, [step, navigate])

  // B-14: `user` can arrive late; its name fills unless the person typed.
  useEffect(() => {
    if (!nameTouched.current && user?.name) setName(user.name)
  }, [user?.name])

  // After a 409 the re-read session is routed by the same rule; no house in
  // it means the house is one to choose (F8).
  useEffect(() => {
    if (!rerouting) return
    setRerouting(false)
    const entry = entryFor(user)
    if (entry === 'menu') {
      setError(null)
      setNotice(null)
      setStep('menu')
    } else if (entry === 'desk') navigate('/', { replace: true })
    else if (entry === 'sign-in') navigate(SIGN_IN_THEN_GET_STARTED, { replace: true })
    else if (entry === 'verify') navigate('/verify-email', { replace: true })
    else navigate('/choose-house', { replace: true })
  }, [navigate, rerouting, user])

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
    // The place's own phone fills the field (OB-7); the person can still edit it.
    if (place.phone) setRestaurantPhone(place.phone)
    setPlaceCountryCode(place.countryCode ?? null)
    setPlaceOffset(place.utcOffsetMinutes ?? null)
    setPickedZone('')
    if (place.latitude != null && place.longitude != null) {
      setPlacePoint({
        latitude: place.latitude,
        longitude: place.longitude,
        googlePlaceId: place.googlePlaceId ?? undefined,
      })
    }
  }

  const createHouse = async () => {
    if (!name.trim()) {
      setError('Your name is needed: it is how the house signs your work.')
      setChangingName(true)
      return
    }
    // Name what is empty (walk r21): "Restaurant name and full address are
    // required." made a person who had picked a place hunt for the one field
    // the place did not fill.
    const missing = [
      !restaurantName.trim() && 'restaurant name',
      !address.trim() && 'address',
      !city.trim() && 'city',
      !country.trim() && 'country',
    ].filter((field): field is string => Boolean(field))
    if (missing.length > 0) {
      setError(missingSentence(missing))
      return
    }
    if (zone.source === 'pick' && !pickStands) {
      setError("Choose the house's clock: this browser's clock is not the place's.")
      return
    }
    setSaving(true)
    setError(null)
    setHouseNotLoaded(false)
    setNeedsVerify(false)
    try {
      // The name is saved only when it was changed here (it came from sign-up).
      if (name.trim() !== (user?.name ?? '').trim()) {
        try {
          await apiClient.patch('/auth/me', { name: name.trim() })
        } catch {
          setError('Your name was not saved, so the house was not opened. Try again.')
          return
        }
      }
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
      })
      openedHere.current = true
      setNotice(opened.detailsLoaded ? null : HOUSE_OPEN_DETAILS_LATER)
      setStep('menu')
    } catch (cause) {
      if (getErrorStatus(cause) === 409) {
        // An earlier press (or another tab) opened it: re-read the session
        // and route by the entry rule (F8, ADR 0265 OPEN-2).
        await stepIntoTheHouse()
        return
      }
      // Said from the status alone (F-006). The one 403 here is an address
      // not verified yet: say it, and give the way to verify it.
      if (getErrorStatus(cause) === 403) setNeedsVerify(true)
      setError(houseNotOpened(cause, 'arrival'))
    } finally {
      setSaving(false)
    }
  }

  const stepIntoTheHouse = async () => {
    setHouseNotLoaded(false)
    let accessToken: string | null = null
    let refreshToken: string | null = null
    try {
      accessToken = localStorage.getItem('accessToken')
      refreshToken = localStorage.getItem('refreshToken')
    } catch {
      /* storage blocked: said below */
    }
    if (!accessToken || !refreshToken) {
      setHouseNotLoaded(true)
      setError(HOUSE_NOT_LOADED)
      return
    }
    try {
      await signInWithSession({ accessToken, refreshToken })
      setRerouting(true)
    } catch (cause) {
      console.warn('get-started: the house exists but the session did not reload', cause)
      setHouseNotLoaded(true)
      setError(HOUSE_NOT_LOADED)
    }
  }

  // The first proof opens at once, with no staged pause.
  const menuRead = (result: MenuImportResult, source?: { image?: string | null }) => {
    writeProof(result, source?.image ?? null)
    navigate('/house/menu', { replace: true })
  }

  /**
   * One dropped photo is read at once. Anything else dropped (a PDF, a
   * spreadsheet, a CSV, several files) used to open the file box with the
   * file thrown away and not a word said (r28 onboarding gap 11); it is now
   * staged there, named, with "Import the menu", as if picked.
   */
  const ingestDrop = (files: File[]) => {
    if (files.length === 0) return
    if (files.length === 1 && files[0].type.startsWith('image/')) {
      void ingestDroppedImage(files[0])
      return
    }
    setError(null)
    setDroppedFiles(files)
    setMenuMethod('file')
  }

  const ingestDroppedImage = async (file: File) => {
    setSaving(true)
    setError(null)
    try {
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Could not read that photo.'))
        reader.readAsDataURL(file)
      })
      // Sent as bare base64, fitted for the reader (r28 gap 12): the data URL
      // FileReader gives was sent whole, prefix and all, and a phone photo
      // went up at full size.
      const photo = await fitPhotoForReading(image)
      const result = await importMenu('scan', { imageBase64: photo.base64 })
      menuRead(result, { image: photo.dataUrl })
    } catch (cause) {
      setError(photoNotRead(cause))
    } finally {
      setSaving(false)
    }
  }

  const signOut = () =>
    void logout().then((out) => {
      // `false`: the person kept their unsent changes and stayed signed in.
      if (out) navigate('/login', { replace: true })
    })

  if (!entered) return <ArrivalShell step={null} />

  if (step === 'restaurant') {
    return (
      <ArrivalShell step={step} onSignOut={signOut}>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#1a5e6b]">
          Welcome, {name.trim().split(/\s+/)[0] || 'there'}.
          {!changingName && name.trim() && (
            <button
              type="button"
              onClick={() => setChangingName(true)}
              className="ml-3 normal-case tracking-normal text-[#6d685f] underline underline-offset-4"
            >
              Change your name
            </button>
          )}
        </p>
        <h1 className="mt-3 font-serif text-4xl sm:text-5xl">Your restaurant</h1>
        {(changingName || !name.trim()) && (
          <label className="mt-6 block max-w-md border-b border-[#211f1b]/25 pb-2">
            <span className="text-xs uppercase tracking-wider">Your name · required</span>
            <input
              aria-label="Your name"
              onKeyDown={submitOnEnter(() => void createHouse())}
              value={name}
              onChange={(event) => {
                nameTouched.current = true
                setName(event.target.value)
              }}
              className="mt-2 block w-full bg-transparent font-serif text-2xl outline-none"
            />
          </label>
        )}
        <p className="mt-3 max-w-xl text-[#6d685f]">
          {mapsOn
            ? "Find the exact place. Its address sets the house's clock and reporting currency."
            : "Its country sets the house's clock and reporting currency."}
        </p>
        {!mapsOn && (
          <p role="status" className="mt-4 text-sm text-[#6d685f]">
            Search is off here; type the address.
          </p>
        )}
        <div className="mt-9 space-y-5">
          {/* Maps off (walk 2026-11-11): the find box was still drawn, bound to
              the same address as the field below, and "Use my location" only
              centres a search that does not exist; its failure line then said
              "Search by name or address instead". Both are drawn only when the
              search runs; the typed fields are the whole form otherwise. */}
          {mapsOn && (
          <>
          <label htmlFor="arrival-place" className="block">
            <span className="text-xs uppercase tracking-wider">Find your restaurant</span>
            <PlacesAutocomplete
              id="arrival-place"
              value={address}
              onChange={(value) => {
                setAddress(value)
                setPlacePoint(null)
                setPlaceOffset(null)
                setPlaceCountryCode(null)
              }}
              onPlaceSelect={selectPlace}
              locationBias={locationBias}
              withContact
              placeholder="Restaurant name or address"
              className="mt-2 rounded-none border-x-0 border-t-0 bg-transparent"
            />
          </label>
          <button type="button" onClick={useMyLocation} className="flex items-center gap-2 text-sm text-[#1a5e6b]">
            <MapPin className="h-4 w-4" /> Use my location
          </button>
          {locationStatus && <p role="status" className="text-xs text-[#6d685f]">{locationStatus}</p>}
          </>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="border-b border-[#211f1b]/25 pb-2">
              <span className="text-xs uppercase tracking-wider">Restaurant name · required</span>
              <input aria-label="Restaurant name" onKeyDown={submitOnEnter(() => void createHouse())} value={restaurantName} onChange={(e) => setRestaurantName(e.target.value)} className="mt-2 w-full bg-transparent text-lg outline-none" />
            </label>
            <label className="border-b border-[#211f1b]/25 pb-2">
              <span className="text-xs uppercase tracking-wider">Address · required</span>
              <input aria-label="Address" onKeyDown={submitOnEnter(() => void createHouse())} value={address} onChange={(e) => { setAddress(e.target.value); setPlacePoint(null) }} className="mt-2 w-full bg-transparent text-lg outline-none" />
            </label>
            <label className="border-b border-[#211f1b]/25 pb-2">
              <span className="text-xs uppercase tracking-wider">Restaurant phone · optional</span>
              <input aria-label="Restaurant phone" onKeyDown={submitOnEnter(() => void createHouse())} value={restaurantPhone} onChange={(e) => setRestaurantPhone(e.target.value)} className="mt-2 w-full bg-transparent text-lg outline-none" />
            </label>
            <label className="border-b border-[#211f1b]/25 pb-2">
              <span className="text-xs uppercase tracking-wider">City · required</span>
              <input aria-label="City" onKeyDown={submitOnEnter(() => void createHouse())} value={city} onChange={(e) => setCity(e.target.value)} className="mt-2 w-full bg-transparent text-lg outline-none" />
            </label>
            <div>
              <label htmlFor="arrival-country" className="text-xs uppercase tracking-wider">Country · required</label>
              <CountryCombobox id="arrival-country" value={country} onChange={changeCountry} />
            </div>
          </div>
          <div className="border-y border-[#211f1b]/15 py-4 text-sm">
            {zone.source === 'pick' ? (
              <label className="mr-6 inline-flex flex-wrap items-center gap-2">
                <span>Clock · this browser&apos;s clock is not the place&apos;s. Choose:</span>
                <select
                  aria-label="The house's clock"
                  value={pickStands ? pickedZone : ''}
                  onChange={(event) => setPickedZone(event.target.value)}
                  className="border-b border-[#211f1b]/25 bg-transparent"
                >
                  <option value="">Choose…</option>
                  {zone.choices.map((choice) => (
                    <option key={choice} value={choice}>{choice}</option>
                  ))}
                </select>
              </label>
            ) : zone.source === 'none' ? (
              <span className="mr-6">Clock · Not detected. Set it in Settings › Time zone once the house is open.</span>
            ) : (
              <span className="mr-6">
                Clock · {timezone ?? 'Not detected'}
                {timezone && (zone.source === 'country' ? ' (from the country)' : ' (from this browser)')}
              </span>
            )}
            <label className="inline-flex flex-wrap items-center gap-2">
              <span>Currency ·</span>
              <select
                aria-label="The house's money"
                value={currency ?? ''}
                onChange={(event) => setCurrencyChoice(event.target.value)}
                className="border-b border-[#211f1b]/25 bg-transparent"
              >
                <option value="">{countryCurrency ? 'Not set yet' : 'Choose…'}</option>
                {CURRENCY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {currencyLabel(code)}
                  </option>
                ))}
              </select>
              {currency && currencyChoice === null && <span>(from the country)</span>}
              {!currency && country.trim() && !countryCurrency && (
                <span>Not known from the country: choose it, or set it later in Settings › Currency.</span>
              )}
            </label>
          </div>
        </div>
        {error && <p role="alert" className="mt-5 text-sm text-red-700">{error}</p>}
        {needsVerify && (
          <Link to="/verify-email" replace className="mt-3 inline-block text-sm text-[#1a5e6b] underline underline-offset-4">
            Verify your email
          </Link>
        )}
        {houseNotLoaded && (
          <Link to="/choose-house" replace className="mt-3 inline-block text-sm text-[#1a5e6b] underline underline-offset-4">
            Choose your house
          </Link>
        )}
        <button type="button" onClick={createHouse} disabled={saving} className="mt-8 bg-[#1a5e6b] px-6 py-3 text-white disabled:opacity-40">
          {saving ? 'Opening the house…' : 'This is us'}
        </button>
      </ArrivalShell>
    )
  }

  if (step === 'menu') {
    return (
      <ArrivalShell step={step} onSignOut={signOut}>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#1a5e6b]">One last step</p>
        <h1 className="mt-3 font-serif text-4xl sm:text-5xl">Your menu</h1>
        <p className="mt-3 text-[#6d685f]">
          A photo, a file, or a few typed lines. Mudavym sets it out as the house&apos;s own list, and you check it on the next page.
        </p>
        {notice && <p role="status" className="mt-3 text-sm text-[#6d685f]">{notice}</p>}
        {menuStanding === 'draft' && (
          <p role="status" className="mt-3 text-sm text-[#6d685f]">
            A menu read earlier is kept as a draft. Choose it on{' '}
            <Link to="/menu" className="text-[#1a5e6b] underline underline-offset-4">Menu</Link>
            , or read another here.
          </p>
        )}
        <button
          type="button"
          onClick={() => setMenuMethod(menuMethod === 'photo' ? null : 'photo')}
          onDragEnter={() => setDropping(true)}
          onDragOver={(event) => {
            event.preventDefault()
            setDropping(true)
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDropping(false)
            ingestDrop(Array.from(event.dataTransfer.files ?? []))
          }}
          className={`mt-10 flex min-h-[220px] w-full flex-col items-center justify-center border border-dashed px-6 text-center ${
            dropping ? 'border-[#1a5e6b] bg-white' : 'border-[#211f1b]/25 bg-[#fbfaf7]'
          }`}
        >
          <span className="font-serif text-3xl">Drop the menu here</span>
          <span className="mt-3 text-sm text-[#6d685f]">
            {saving ? 'Reading…' : 'A photo, a PDF or a spreadsheet. Or click to photograph.'}
          </span>
        </button>
        {error && <p role="alert" className="mt-5 text-sm text-red-700">{error}</p>}
        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <button
            type="button"
            onClick={() => {
              setDroppedFiles(null)
              setMenuMethod(menuMethod === 'file' ? null : 'file')
            }}
            className="text-[#1a5e6b] underline underline-offset-4"
          >
            Send a file
          </button>
          <button type="button" onClick={() => setMenuMethod(menuMethod === 'typed' ? null : 'typed')} className="flex items-center gap-1 text-[#1a5e6b] underline underline-offset-4">
            <PenLine className="h-3.5 w-3.5" /> Type a few lines
          </button>
        </div>
        <div className="mt-6">
          {menuMethod === 'photo' && <MenuScanUpload onSuccess={menuRead} />}
          {menuMethod === 'file' && <MenuCsvUpload onSuccess={menuRead} droppedFiles={droppedFiles} />}
          {menuMethod === 'typed' && <MenuManualEntry onSuccess={menuRead} currency={menuCurrency} />}
        </div>
        <div className="mt-6 border-t border-[#211f1b]/15 pt-5">
          <button type="button" onClick={() => navigate('/house', { replace: true })} className="text-sm text-[#6d685f] underline underline-offset-4">
            Skip for now — open the house
          </button>
        </div>
      </ArrivalShell>
    )
  }

  // Unreachable: every step returns above.
  return null
}
