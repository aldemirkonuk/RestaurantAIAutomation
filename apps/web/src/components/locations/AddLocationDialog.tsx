import { useState, useEffect, type RefObject } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion, AnimatePresence } from 'framer-motion'
import { Building2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { useAnchoredDialogPosition } from '../../hooks/useAnchoredDialogPosition'
import { PlacesAutocomplete, type PlaceResult } from '../ui/PlacesAutocomplete'
import { CountryCombobox } from '../ui/CountryCombobox'

interface AddLocationDialogProps {
  open: boolean
  onClose: () => void
  onLocationAdded?: (location: { id: string; name: string }) => void
  anchorRef?: RefObject<HTMLElement | null>
}

interface Chain {
  id: string
  name: string
  cuisine_type: string | null
}

const INPUT_CLS =
  'block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-wine-500 focus:outline-none'

export function AddLocationDialog({ open, onClose, onLocationAdded, anchorRef }: AddLocationDialogProps) {
  const anchorPos = useAnchoredDialogPosition(open, anchorRef)

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [country, setCountry] = useState('')
  const [stateProvince, setStateProvince] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [phone, setPhone] = useState('')
  const [cuisineType, setCuisineType] = useState('')
  const [chainId, setChainId] = useState('')
  const [chains, setChains] = useState<Chain[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

  useEffect(() => {
    if (!open) return
    const token = localStorage.getItem('accessToken')
    fetch(`${API_URL}/api/v1/organizations/chains`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => setChains(Array.isArray(data) ? data : []))
      .catch(() => setChains([]))
  }, [open, API_URL])

  const handlePlaceSelect = (place: PlaceResult) => {
    setAddress(place.streetAddress)
    if (place.city) setCity(place.city)
    if (place.stateProvince) setStateProvince(place.stateProvince)
    if (place.postalCode) setPostalCode(place.postalCode)
    if (place.country) setCountry(place.country)
  }

  const handleSubmit = async () => {
    if (!name.trim() || !country.trim()) {
      toast.error('Location name and country are required')
      return
    }
    if (!address.trim() || !city.trim()) {
      toast.error('Street address and city are required')
      return
    }
    setIsSubmitting(true)
    try {
      const token = localStorage.getItem('accessToken')
      const resp = await fetch(`${API_URL}/api/v1/organizations/locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: name.trim(),
          address: address.trim(),
          city: city.trim(),
          country: country.trim() || undefined,
          stateProvince: stateProvince.trim() || undefined,
          postalCode: postalCode.trim() || undefined,
          phone: phone.trim() || undefined,
          cuisineType: cuisineType.trim() || undefined,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          chainId: chainId || undefined,
        }),
      })
      if (!resp.ok) {
        const data = await resp.json()
        throw new Error(data.message || 'Failed to add location')
      }
      const location = await resp.json()
      toast.success(`${name} added successfully!`)
      onLocationAdded?.(location)
      handleClose()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to add location. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    setName(''); setAddress(''); setCity(''); setCountry('')
    setStateProvince(''); setPostalCode(''); setPhone('')
    setCuisineType(''); setChainId('')
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" onClick={handleClose} />
        <Dialog.Content asChild>
          <motion.div
            className={
              anchorPos
                ? 'fixed z-50 bg-white rounded-2xl shadow-xl p-6 w-full max-w-md max-h-[min(90vh,calc(100vh-5rem))] overflow-y-auto'
                : 'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-xl p-6 w-full max-w-md max-h-[min(90vh,calc(100vh-5rem))] overflow-y-auto'
            }
            style={anchorPos ? { top: anchorPos.top, left: anchorPos.left } : undefined}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-wine-500" />
                Add New Location
              </Dialog.Title>
              <button type="button" onClick={handleClose} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <Dialog.Description className="text-sm text-gray-500 mb-5">
              Add a new restaurant location to your organization.
            </Dialog.Description>

            <div className="space-y-3">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Location name <span className="text-wine-600">*</span>
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Joe's Pizza — Uptown"
                  autoFocus
                  className={INPUT_CLS}
                />
              </div>

              {/* Chain */}
              {chains.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Chain / Brand <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <select
                    value={chainId}
                    onChange={(e) => setChainId(e.target.value)}
                    className={INPUT_CLS}
                  >
                    <option value="">Standalone — no chain</option>
                    {chains.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">Groups this location under an existing brand in the branch switcher.</p>
                </div>
              )}

              {/* Country — FIRST so autocomplete can bias results */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Country <span className="text-wine-600">*</span></label>
                <CountryCombobox value={country} onChange={setCountry} />
                {!country && (
                  <p className="text-xs text-gray-400 mt-1">Select a country to enable address search</p>
                )}
              </div>

              {/* Address fields — revealed after country selected */}
              <AnimatePresence>
                {country.trim().length >= 2 && (
                  <motion.div
                    key="address-fields"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                    className="space-y-3"
                  >
                    {/* Street Address — Google Places Autocomplete */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Street Address <span className="text-wine-600">*</span>
                      </label>
                      <PlacesAutocomplete
                        country={country}
                        value={address}
                        onChange={setAddress}
                        onPlaceSelect={handlePlaceSelect}
                        placeholder="Start typing your street address…"
                        className="py-2 border-gray-300 bg-white"
                      />
                    </div>

                    {/* City + State */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">City <span className="text-wine-600">*</span></label>
                        <input
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                          placeholder="Chicago"
                          className={INPUT_CLS}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">State / Province</label>
                        <input
                          value={stateProvince}
                          onChange={(e) => setStateProvince(e.target.value)}
                          placeholder="IL"
                          className={INPUT_CLS}
                        />
                      </div>
                    </div>

                    {/* Postal + Phone */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">ZIP / Postal</label>
                        <input
                          value={postalCode}
                          onChange={(e) => setPostalCode(e.target.value)}
                          placeholder="60601"
                          className={INPUT_CLS}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                        <input
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="+1 (555) 000-0000"
                          className={INPUT_CLS}
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <Button variant="ghost" onClick={handleClose}>Cancel</Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || !name.trim() || !country.trim() || !address.trim() || !city.trim()}
                className="bg-wine-600 text-white hover:bg-wine-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Adding…' : 'Add Location'}
              </Button>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
