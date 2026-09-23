import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapPin, PenLine } from 'lucide-react'
import { BrandMark } from '../components/brand/BrandMark'
import { PlacesAutocomplete, type PlaceResult } from '../components/ui/PlacesAutocomplete'
import { CountryCombobox } from '../components/ui/CountryCombobox'
import { MenuCsvUpload } from '../components/onboarding/MenuCsvUpload'
import { MenuScanUpload } from '../components/onboarding/MenuScanUpload'
import { MenuManualEntry } from '../components/onboarding/MenuManualEntry'
import { useAuth } from '../contexts/AuthContext'
import { apiClient } from '../services/api/client'
import { importMenu, type MenuImportResult } from '../services/api/menus'
import { currencyForCountry } from '../lib/currency'
import { writeProof } from '../lib/firstProof'
import { isMapsConfigured } from '../lib/googleMaps'

type Step = 'you' | 'restaurant' | 'menu' | 'reading'
type Role = 'Owner' | 'General manager' | 'Beverage lead' | 'Chef'
type MenuMethod = 'photo' | 'file' | 'typed' | null

const roles: Role[] = ['Owner', 'General manager', 'Beverage lead', 'Chef']

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

export default function GetStarted() {
  const navigate = useNavigate()
  const { user, createFirstHouse } = useAuth()
  const [step, setStep] = useState<Step>('you')
  const [name, setName] = useState(user?.name ?? '')
  const [mobile, setMobile] = useState('')
  const [role, setRole] = useState<Role | null>(null)
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
  const [saving, setSaving] = useState(false)
  const [dropping, setDropping] = useState(false)

  const currency = useMemo(() => currencyForCountry(country), [country])
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  useEffect(() => {
    if (step !== 'reading' || !pendingResult) return
    const timer = window.setTimeout(() => {
      writeProof(pendingResult, sourceImage)
      navigate('/house/menu', { replace: true })
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [navigate, pendingResult, sourceImage, step])

  const saveYou = async () => {
    setSaving(true)
    setError(null)
    try {
      await apiClient.patch('/auth/me', {
        name: name.trim(),
        phone: mobile.trim() || undefined,
      })
      if (role) sessionStorage.setItem('mudavym:arrival-role', role)
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

  const createHouse = async () => {
    if (!restaurantName.trim() || !address.trim() || !city.trim() || !country.trim()) {
      setError('Restaurant name and full address are required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await createFirstHouse({
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
      setStep('menu')
    } catch (cause: any) {
      setError(cause?.response?.data?.message || cause?.message || 'We could not create the house.')
    } finally {
      setSaving(false)
    }
  }

  const menuRead = (result: MenuImportResult, source?: { image?: string | null }) => {
    setPendingResult(result)
    setSourceImage(source?.image ?? null)
    setStep('reading')
  }

  const ingestDroppedImage = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setMenuMethod('file')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Could not read that photo.'))
        reader.readAsDataURL(file)
      })
      const result = await importMenu('scan', { imageBase64: image })
      menuRead(result, { image })
    } catch (cause: any) {
      setError(cause?.response?.data?.message || cause?.message || 'We could not read that photo.')
    } finally {
      setSaving(false)
    }
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
              placeholder="For urgent stock alerts. Never marketing."
              className="mt-2 block w-full bg-transparent text-base outline-none"
            />
          </label>
          {mobile.trim() && (
            <p className="text-sm text-[#6d685f]">
              If you give a number, we may text urgent stock alerts only. Never marketing.
              Reply <strong>STOP</strong> anytime. Optional — the account does not depend on it.
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
          Find the exact place. Its address sets the house&apos;s timezone and reporting currency.
        </p>
        {!isMapsConfigured() && (
          <p role="status" className="mt-4 text-sm text-[#6d685f]">
            Places search needs <code>VITE_GOOGLE_MAPS_API_KEY</code>. Type the address by hand until it is set.
          </p>
        )}
        <div className="mt-9 space-y-5">
          <label className="block">
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
            <span className="mr-6">Timezone · {timezone}</span>
            <span>Currency · {currency ?? 'Not inferred yet'}</span>
          </div>
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
            const file = event.dataTransfer.files?.[0]
            if (file) void ingestDroppedImage(file)
          }}
          className={`mt-10 flex min-h-[220px] w-full flex-col items-center justify-center border border-dashed px-6 text-center ${
            dropping ? 'border-[#1a5e6b] bg-white' : 'border-[#211f1b]/25 bg-[#fbfaf7]'
          }`}
        >
          <span className="font-serif text-3xl">Drop the menu here</span>
          <span className="mt-3 text-sm text-[#6d685f]">
            {saving ? 'Reading…' : 'A photo, or click to photograph.'}
          </span>
        </button>
        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
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
          <button type="button" onClick={() => navigate('/house', { replace: true })} className="text-sm text-[#6d685f] underline underline-offset-4">
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

