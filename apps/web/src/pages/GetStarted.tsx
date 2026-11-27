import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MapPin, PenLine } from 'lucide-react'
import { AuthSpread } from '../components/brand/AuthSpread'
import { PlacesAutocomplete, warmPlaces, type PlaceResult } from '../components/ui/PlacesAutocomplete'
import { CountryCombobox } from '../components/ui/CountryCombobox'
import { MenuCsvUpload } from '../components/onboarding/MenuCsvUpload'
import { MenuScanUpload } from '../components/onboarding/MenuScanUpload'
import { MenuManualEntry } from '../components/onboarding/MenuManualEntry'
import { useAuth, type User } from '../contexts/AuthContext'
import { HouseBusyNotice } from '../components/HouseBusyNotice'
import { prefetchWhenIdle } from '../lib/stepPrefetch'
import { apiClient, getErrorStatus, isUnconfirmedWrite } from '../services/api/client'
import { importMenu, type MenuImportResult } from '../services/api/menus'
import { CURRENCY_CODES, currencyForCountry, currencyLabel, currencyToRecord } from '../lib/currency'
import { settingsApi } from '../services/api/settings'
import { getBrowserTimezone } from '../lib/browserTimezone'
import { countryCodeFor } from '../lib/countries'
import { zoneForPlace } from '../lib/zoneForPlace'
import { zoneLabel } from '../lib/zoneLabel'
import { writeProof } from '../lib/firstProof'
import { fitPhotoForReading } from '../lib/fitPhoto'
import { readHouseMenuStanding, type HouseMenuStanding } from '../lib/houseMenuStanding'
import { isMapsConfigured } from '../lib/googleMaps'
import { houseNotOpened, HOUSE_OPEN_DETAILS_LATER } from '../lib/houseOpeningWords'
import { clearGetStartedDraft, readGetStartedDraft, writeGetStartedDraft } from '../lib/getStartedDraft'

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
 * staff go to the desk, never owner onboarding; a manager goes to /menu, where
 * a manager reads the house's menu and makes it current (r36 onboarding gap
 * 5: Learn & Help's "Read it now" and the guide links land here, and the desk
 * was a dead end; the banner already sends a manager to /menu); an owner (or
 * no role) resumes at the menu step; no house starts at the first step.
 */
type Entry = 'sign-in' | 'verify' | 'desk' | 'house-menu' | 'menu' | 'restaurant'

function entryFor(user: Pick<User, 'restaurantId' | 'role' | 'emailVerified'> | null): Entry {
  if (!user) return 'sign-in'
  // An address not yet verified cannot open a house (the gateway answers 403,
  // auth.service.ts createFirstHouse): sending it to the form first let a
  // person fill every field and then be told only "We could not create the
  // house." Only an explicit `false` counts, as on /choose-house.
  if (user.emailVerified === false) return 'verify'
  if (user.restaurantId) {
    if (user.role === 'staff') return 'desk'
    return user.role === 'manager' ? 'house-menu' : 'menu'
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

/** The one open book (AuthSpread) with this flow's step on the folio. */
function ArrivalShell({
  step,
  eyebrow = 'Opening your house',
  title,
  voice,
  holdHeading,
  onSignOut,
  children,
}: {
  /** Null while the entry rule has not decided yet: no step is named. */
  step: Step | null
  eyebrow?: string
  /** Omitted while the entry rule or the menu read has not decided: no heading yet. */
  title?: string
  voice?: React.ReactNode
  /** Hold the heading's room, unseen, while a read decides whether to show it. */
  holdHeading?: boolean
  /** The way out for a signed-in person on the wrong account; absent before entry. */
  onSignOut?: () => void
  children?: React.ReactNode
}) {
  const folio = step ? { restaurant: '01 · Your restaurant', menu: '02 · Your menu' }[step] : undefined
  return (
    <AuthSpread
      eyebrow={eyebrow}
      houseLine="The first page is yours."
      tag="A place and a menu, then the book opens."
      folio={folio}
      pageKey={step ?? 'entering'}
      title={title}
      voice={voice}
      holdHeading={holdHeading}
      footer={
        onSignOut ? (
          <button type="button" onClick={onSignOut} className="mdv-spread-textlink">
            Sign out
          </button>
        ) : undefined
      }
    >
      <div aria-busy={step === null} className="mdv-spread-stack">
        {step && (
          <div
            className="mdv-spread-progress"
            role="progressbar"
            aria-label="Set-up progress"
            aria-valuemin={1}
            aria-valuemax={2}
            aria-valuenow={step === 'menu' ? 2 : 1}
            aria-valuetext={step === 'menu' ? 'Step 2 of 2' : 'Step 1 of 2'}
          >
            <span
              data-testid="gs-progress-fill"
              className="mdv-spread-progress__fill"
              style={{ width: step === 'menu' ? '100%' : '50%' }}
            />
          </div>
        )}
        {children}
      </div>
    </AuthSpread>
  )
}

/** Height of the menu step the standing read gives way to (r102 walk, 375 px). */
const MENU_STEP_MIN_HEIGHT_PX = 378

export default function GetStarted() {
  const navigate = useNavigate()
  const { user, loading, meBusy, createFirstHouse, signInWithSession, logout } = useAuth()
  // No step shows until the entry rule decides, so Welcome never flashes.
  const [step, setStep] = useState<Step>('restaurant')
  const [entered, setEntered] = useState(false)
  const entryDecided = useRef(false)
  const [name, setName] = useState(user?.name ?? '')
  const nameTouched = useRef(false)
  const [rerouting, setRerouting] = useState(false)
  const [houseNotLoaded, setHouseNotLoaded] = useState(false)
  const [changingName, setChangingName] = useState(false)
  // What was typed before a reload comes back before the first paint, so
  // restoring replays nothing and moves nothing (r107 g4).
  const [draft] = useState(() => readGetStartedDraft(user?.userId))
  const draftDone = useRef(false)
  const [restaurantName, setRestaurantName] = useState(draft?.restaurantName ?? '')
  const [address, setAddress] = useState(draft?.address ?? '')
  const [city, setCity] = useState(draft?.city ?? '')
  const [country, setCountry] = useState(draft?.country ?? '')
  const [stateProvince, setStateProvince] = useState(draft?.stateProvince ?? '')
  const [postalCode, setPostalCode] = useState(draft?.postalCode ?? '')
  const [restaurantPhone, setRestaurantPhone] = useState(draft?.restaurantPhone ?? '')
  // The owner's money and clock picks are kept with the text (r107): a reload
  // must not swap a deliberate USD, or "Not set yet", for the country's default.
  const [pickedZone, setPickedZone] = useState(draft?.pickedZone ?? '')
  const [currencyChoice, setCurrencyChoice] = useState<string | null>(draft?.currencyChoice ?? null)
  const typed = { restaurantName, address, city, country, stateProvince, postalCode, restaurantPhone }
  const draftNow = { ...typed, currencyChoice, pickedZone }
  const typedRef = useRef(typed)
  typedRef.current = typed
  const draftRef = useRef(draftNow)
  draftRef.current = draftNow
  const userIdRef = useRef(user?.userId)
  userIdRef.current = user?.userId
  // On a hard reload the session is read after the first paint, so `user` is
  // not there when the state above is made. When the person's id arrives, the
  // draft is put back, but only into fields still empty: nothing typed is
  // overwritten. Until then nothing is written, so the stored draft stays.
  const restoredFor = useRef<string | null>(draft ? (user?.userId ?? null) : null)
  useLayoutEffect(() => {
    const id = user?.userId
    if (!id || restoredFor.current === id) return
    restoredFor.current = id
    const late = readGetStartedDraft(id)
    if (!late || Object.values(typedRef.current).some((v) => v.trim() !== '')) return
    setRestaurantName(late.restaurantName)
    setAddress(late.address)
    setCity(late.city)
    setCountry(late.country)
    setStateProvince(late.stateProvince)
    setPostalCode(late.postalCode)
    setRestaurantPhone(late.restaurantPhone)
    setCurrencyChoice(late.currencyChoice)
    setPickedZone(late.pickedZone)
  }, [user?.userId])
  const typedKey = JSON.stringify(draftNow)
  useEffect(() => {
    const t = setTimeout(() => {
      if (!draftDone.current) writeGetStartedDraft(userIdRef.current, draftRef.current)
    }, 400)
    return () => clearTimeout(t)
  }, [typedKey, user?.userId])
  useEffect(() => {
    const flush = () => {
      if (!draftDone.current) writeGetStartedDraft(userIdRef.current, draftRef.current)
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])
  // What the picked place said about itself (OB-7): its country code and its
  // UTC offset now. Cleared when the address is typed over, or when the
  // country is changed to another one (fix round, #1055): the clock then
  // follows the country the page shows, never the earlier place's.
  const [placeCountryCode, setPlaceCountryCode] = useState<string | null>(null)
  const [placeOffset, setPlaceOffset] = useState<number | null>(null)
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
  // The refusal sits under the plate (it must not move the plate), which on a
  // short screen or a phone is below the fold: bring it into view when it comes,
  // or the press seems to do nothing (r63 walk).
  const refusalRef = useRef<HTMLParagraphElement | null>(null)
  useEffect(() => {
    if (error) refusalRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [error])
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

  // Warm the Maps library once the person is past the door, so the restaurant
  // step's first suggestion does not wait on the script (r105 onboarding g3).
  useEffect(() => {
    if (step === 'restaurant') warmPlaces()
  }, [step])

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
    else if (entry === 'house-menu') navigate('/menu', { replace: true })
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

  // On the menu step the next pages are the house and its menu: warm them.
  useEffect(() => {
    if (step !== 'menu') return
    return prefetchWhenIdle(['house', 'house-menu'])
  }, [step])

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
    else if (entry === 'house-menu') navigate('/menu', { replace: true })
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
      draftDone.current = true
      clearGetStartedDraft()
      setNotice(opened.detailsLoaded ? null : HOUSE_OPEN_DETAILS_LATER)
      setStep('menu')
    } catch (cause) {
      if (getErrorStatus(cause) === 409) {
        draftDone.current = true
        clearGetStartedDraft()
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
   * Opens one way in (photo, file, typed lines) or closes it. A word left by
   * another way (a photo the reader refused, a file the box refused) is
   * cleared with it, so the page never shows two ways' errors at once
   * (r33 walk w1 F7). A file box opened afresh holds no dropped file.
   */
  const chooseMethod = (method: MenuMethod) => {
    setError(null)
    setDroppedFiles(null)
    setMenuMethod(method)
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
      // The photo is read here, so a file box left open by an earlier drop
      // closes with its refusal ("not a spreadsheet…"): that word was left
      // standing beside this photo's own (r33 walk w1 F7).
      if (menuMethod === 'file') chooseMethod(null)
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

  if (!entered) {
    return (
      <ArrivalShell step={null}>
        {loading && meBusy ? <HouseBusyNotice busy={meBusy} /> : null}
      </ArrivalShell>
    )
  }

  if (step === 'restaurant') {
    return (
      <ArrivalShell
        step={step}
        onSignOut={signOut}
        title="Your restaurant"
        voice={
          <>
            Welcome, {name.trim().split(/\s+/)[0] || 'there'}.
            {!changingName && name.trim() && (
              <button
                type="button"
                onClick={() => setChangingName(true)}
                className="mdv-spread-textlink ml-3"
              >
                Change your name
              </button>
            )}
          </>
        }
      >
        {(changingName || !name.trim()) && (
          <label className="block">
            <span className="mdv-label">Your name · required</span>
            <input
              aria-label="Your name"
              autoComplete="name" enterKeyHint="next"
              onKeyDown={submitOnEnter(() => void createHouse())}
              value={name}
              onChange={(event) => {
                nameTouched.current = true
                setName(event.target.value)
              }}
            />
          </label>
        )}
        <p>
          {mapsOn
            ? "Find the exact place. Its address sets the house's clock and suggests its money."
            : "Its country sets the house's clock and suggests its money."}
        </p>
        {!mapsOn && (
          <p role="status">
            Search is off here; type the address.
          </p>
        )}
        <div className="mdv-spread-stack">
          {/* Maps off (walk 2026-11-11): the find box was still drawn, bound to
              the same address as the field below, and "Use my location" only
              centres a search that does not exist; its failure line then said
              "Search by name or address instead". Both are drawn only when the
              search runs; the typed fields are the whole form otherwise. */}
          {mapsOn && (
          <>
          <label htmlFor="arrival-place" className="block">
            <span className="mdv-label">Find your restaurant</span>
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
          <button type="button" onClick={useMyLocation} className="mdv-spread-textlink">
            <MapPin className="h-4 w-4" /> Use my location
          </button>
          {locationStatus && <p role="status">{locationStatus}</p>}
          </>
          )}
          <div className="mdv-spread-stack">
            <label className="block">
              <span className="mdv-label">Restaurant name · required</span>
              <input aria-label="Restaurant name" autoComplete="section-house organization" enterKeyHint="next" onKeyDown={submitOnEnter(() => void createHouse())} value={restaurantName} onChange={(e) => setRestaurantName(e.target.value)} />
            </label>
            <label className="block">
              <span className="mdv-label">Address · required</span>
              <input aria-label="Address" autoComplete="section-house address-line1" enterKeyHint="next" onKeyDown={submitOnEnter(() => void createHouse())} value={address} onChange={(e) => { setAddress(e.target.value); setPlacePoint(null) }} />
            </label>
            <label className="block">
              <span className="mdv-label">Restaurant phone · optional</span>
              <input aria-label="Restaurant phone" autoComplete="off" inputMode="tel" enterKeyHint="next" onKeyDown={submitOnEnter(() => void createHouse())} value={restaurantPhone} onChange={(e) => setRestaurantPhone(e.target.value)} />
            </label>
            <label className="block">
              <span className="mdv-label">City · required</span>
              <input aria-label="City" autoComplete="section-house address-level2" enterKeyHint="next" onKeyDown={submitOnEnter(() => void createHouse())} value={city} onChange={(e) => setCity(e.target.value)} />
            </label>
            <div>
              <label htmlFor="arrival-country" className="mdv-label">Country · required</label>
              <CountryCombobox id="arrival-country" value={country} onChange={changeCountry} />
            </div>
          </div>
          <div className="mdv-spread-facts-line">
            {zone.source === 'pick' ? (
              <label className="mr-6 inline-flex flex-wrap items-center gap-2">
                <span>Clock · this browser&apos;s clock is not the place&apos;s. Choose:</span>
                <select
                  aria-label="The house's clock"
                  value={pickStands ? pickedZone : ''}
                  onChange={(event) => setPickedZone(event.target.value)}
                >
                  <option value="">Choose…</option>
                  {zone.choices.map((choice) => (
                    <option key={choice} value={choice}>{zoneLabel(choice)}</option>
                  ))}
                </select>
              </label>
            ) : zone.source === 'none' ? (
              <span className="mr-6">Clock · Not detected. Set it in Settings › Time zone once the house is open.</span>
            ) : (
              <span className="mr-6">
                Clock · {timezone ? zoneLabel(timezone) : 'Not detected'}
                {timezone && (zone.source === 'country' ? ' (from the country)' : ' (from this browser)')}
              </span>
            )}
            <label className="inline-flex flex-wrap items-center gap-2">
              <span>Currency ·</span>
              <select
                aria-label="The house's money"
                value={currency ?? ''}
                onChange={(event) => setCurrencyChoice(event.target.value)}
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
              {/* r36 onboarding gap 6: an unset money withholds the money of
                  an invoice that names none and comes with no order
                  (invoice-currency.ts), so the first paper puts no cost on.
                  Said where the choice is made. */}
              {!currency && country.trim() && (
                <span data-testid="money-unset-cost">
                  Until it is set, an invoice that names no money waits for it before its costs go on.
                </span>
              )}
            </label>
          </div>
        </div>
        <button type="button" onClick={createHouse} disabled={saving} className="mdv-btn mdv-btn--seal">
          {saving ? 'Opening the house…' : 'This is us'}
        </button>
        {error && <p ref={refusalRef} role="alert" className="mdv-alert">{error}</p>}
        {needsVerify && (
          <Link to="/verify-email" replace className="mdv-spread-textlink">
            Verify your email
          </Link>
        )}
        {houseNotLoaded && (
          <Link to="/choose-house" replace className="mdv-spread-textlink">
            Choose your house
          </Link>
        )}
      </ArrivalShell>
    )
  }

  // r41 onboarding gap 9: an owner who comes back here (a guide link, the
  // rail) saw the whole menu step (the drop zone and three ways in) paint
  // and then vanish when the house's menu turned out to be current. The step
  // waits for that one read. A house opened on this visit is not read, so it
  // never waits; a read that fails ('unread') shows the step as before.
  if (step === 'menu' && !openedHere.current && menuStanding === null) {
    return (
      <ArrivalShell
        step={step}
        onSignOut={signOut}
        eyebrow="Next"
        title="Your menu"
        voice="A photo, a file, or a few typed lines. Mudavym sets it out as the house's own list, and you check it on the next page."
        holdHeading
      >
        {/* r103: the menu step it gives way to stands 378 px tall and opens
            under its own heading; holding both keeps the page still when the
            read lands (CLS 0.30 at 375 px under reduced motion, r102 check 5;
            0.10 after the height alone, r103 walk: the heading arrived 124 px
            higher than the line it replaced). The heading and its upload line
            are held unseen and aria-hidden: a current menu is moved on to
            /house, and must not be told to upload one (r41 gap 9). */}
        <p
          role="status"
          data-testid="menu-standing-reading"
          style={{ minHeight: MENU_STEP_MIN_HEIGHT_PX }}
        >
          Looking at your house’s menu…
        </p>
      </ArrivalShell>
    )
  }

  if (step === 'menu') {
    return (
      <ArrivalShell
        step={step}
        onSignOut={signOut}
        eyebrow="Next"
        title="Your menu"
        voice="A photo, a file, or a few typed lines. Mudavym sets it out as the house's own list, and you check it on the next page."
      >
        {/* r36 onboarding gap 11: "One last step" was followed by the proof,
            the plan, a vendor, an invite and the next steps. */}
        {notice && <p role="status">{notice}</p>}
        {menuStanding === 'draft' && (
          <p role="status">
            A menu read earlier is kept as a draft. Choose it on{' '}
            <Link to="/menu" className="mdv-spread-textlink">Menu</Link>
            , or read another here.
          </p>
        )}
        <button
          type="button"
          onClick={() => chooseMethod(menuMethod === 'photo' ? null : 'photo')}
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
          className="mdv-spread-drop"
          data-dropping={dropping ? '' : undefined}
        >
          <span className="mdv-spread-drop-title">Drop the menu here</span>
          <span className="mdv-spread-drop-sub">
            {saving ? 'Reading…' : 'A photo, a PDF or a spreadsheet. Or click to photograph.'}
          </span>
        </button>
        {error && <p ref={refusalRef} role="alert" className="mdv-alert">{error}</p>}
        <div className="mdv-spread-links">
          <button
            type="button"
            onClick={() => chooseMethod(menuMethod === 'file' ? null : 'file')}
            className="mdv-spread-textlink"
          >
            Send a file
          </button>
          <button type="button" onClick={() => chooseMethod(menuMethod === 'typed' ? null : 'typed')} className="mdv-spread-textlink">
            <PenLine className="h-3.5 w-3.5" /> Type a few lines
          </button>
        </div>
        <div>
          {menuMethod === 'photo' && (
            <MenuScanUpload onSuccess={menuRead} onGoOn={() => navigate('/house', { replace: true })} />
          )}
          {menuMethod === 'file' && <MenuCsvUpload onSuccess={menuRead} droppedFiles={droppedFiles} />}
          {menuMethod === 'typed' && <MenuManualEntry onSuccess={menuRead} currency={menuCurrency} />}
        </div>
        <div>
          <button type="button" onClick={() => navigate('/house', { replace: true })} className="mdv-spread-textlink">
            Skip for now — open the house
          </button>
        </div>
      </ArrivalShell>
    )
  }

  // Unreachable: every step returns above.
  return null
}
