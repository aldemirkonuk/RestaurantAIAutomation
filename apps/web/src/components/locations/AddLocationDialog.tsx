/**
 * Add a new restaurant location.
 *
 * SHAPE: `Sheet`. It authors ONE OBJECT with nine fields — the longest form of
 * the four — which is exactly the Sheet's brief in ADR 0112 (right slide-in,
 * 440px, motion `tuck`). The 440px column also gives the progressive address
 * reveal room to grow downward without moving anything already on screen.
 *
 * The `anchorRef` prop is DELIBERATELY IGNORED in the house branch, and this is
 * the honest version of that: the legacy dialog hangs under the Add button
 * (`useAnchoredDialogPosition`), and the house Sheet does not. ADR 0112's
 * exception for an anchored form (`InviteTeamDialog` takes `Popover modal`) was
 * granted to one dialog on the grounds that a second would turn the third shape
 * into a spectrum. This one is a nine-field form with a conditional reveal —
 * far past what an anchored surface can hold below a button — so it takes the
 * shape its content asks for. The legacy branch still anchors, unchanged.
 *
 * WHAT STAYS LEGACY INSIDE THE HOUSE SHAPE, named rather than hidden: three
 * shared controls — `ui/PlacesAutocomplete`, `ui/CountryCombobox`,
 * `ui/PhoneNumberInput` — hardcode their chrome in Tailwind utilities and are
 * mounted by legacy pages too, so they cannot be rewritten from here. They are
 * wrapped in `.mdv-adopt` (locations-mudavym.css), which repaints the COLOUR
 * utilities they emit and nothing else. Their geometry — radii, paddings, the
 * dropdown's shadow — is still theirs. Re-authoring the three is its own task.
 *
 * The legacy Radix branch is frozen; `locationDialogs.test.tsx` pins its class
 * strings against `git show origin/main:<path>`. Nothing here deletes.
 */

import { useState, useEffect, useRef, type RefObject } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion, AnimatePresence } from 'framer-motion'
import { Building2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { useAnchoredDialogPosition } from '../../hooks/useAnchoredDialogPosition'
import { PlacesAutocomplete, type PlaceResult } from '../ui/PlacesAutocomplete'
import { CountryCombobox } from '../ui/CountryCombobox'
import { PhoneNumberInput } from '../ui/PhoneNumberInput'
import { countryToPhoneDefault, isValidPhone, toE164 } from '../../lib/phone'
import { useAuth } from '../../contexts/AuthContext'
import { useProviders } from '../../hooks/queries'
import { BranchProviderTransferModal } from '../providers/BranchProviderTransferModal'
import { apiClient } from '../../services/api/client'
import { Sheet } from '../mudavym/Sheet'
import { useMudavymShell } from '../../lib/mudavym/shellGround'
import './locations-mudavym.css'

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

interface TransferModalState {
  open: boolean
  newBranchName: string
  newRestaurantId: string
}

export function AddLocationDialog({ open, onClose, onLocationAdded, anchorRef }: AddLocationDialogProps) {
  const anchorPos = useAnchoredDialogPosition(open, anchorRef)
  const { user } = useAuth()

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
  /* The failure in words — see the note in EditLocationChainDialog. */
  const [failure, setFailure] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const shell = useMudavymShell()
  const [transferModal, setTransferModal] = useState<TransferModalState>({
    open: false,
    newBranchName: '',
    newRestaurantId: '',
  })

  // Fetch current restaurant's providers so we can offer to transfer them to a new branch
  const { data: currentProviders = [] } = useProviders(user?.restaurantId || '')

  useEffect(() => {
    if (!open) return
    apiClient.get<Chain[]>('/organizations/chains')
      .then((r) => setChains(Array.isArray(r.data) ? r.data : []))
      .catch(() => setChains([]))
  }, [open])

  const handlePlaceSelect = (place: PlaceResult) => {
    setAddress(place.streetAddress)
    if (place.city) setCity(place.city)
    if (place.stateProvince) setStateProvince(place.stateProvince)
    if (place.postalCode) setPostalCode(place.postalCode)
    if (place.country) setCountry(place.country)
  }

  const handleSubmit = async () => {
    if (!name.trim() || !country.trim()) {
      setFailure('Location name and country are required')
      toast.error('Location name and country are required')
      return
    }
    if (!address.trim() || !city.trim()) {
      setFailure('Street address and city are required')
      toast.error('Street address and city are required')
      return
    }
    setIsSubmitting(true)
    setFailure(null)
    try {
      const { data: location } = await apiClient.post('/organizations/locations', {
        name: name.trim(),
        address: address.trim(),
        city: city.trim(),
        country: country.trim() || undefined,
        stateProvince: stateProvince.trim() || undefined,
        postalCode: postalCode.trim() || undefined,
        phone: phone.trim() ? toE164(phone, countryToPhoneDefault(country)) : undefined,
        cuisineType: cuisineType.trim() || undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        chainId: chainId || undefined,
      })
      toast.success(`${name} added successfully!`)
      onLocationAdded?.(location)
      // If the current restaurant already has providers, offer to transfer them to the new branch
      if (currentProviders.length > 0 && location?.id) {
        setTransferModal({ open: true, newBranchName: name.trim(), newRestaurantId: location.id })
        // Close the location form but keep the transfer modal open — reset form fields now
        resetFormFields()
      } else {
        handleClose()
      }
    } catch (err: unknown) {
      setFailure(err instanceof Error ? err.message : 'Failed to add location. Please try again.')
      toast.error(err instanceof Error ? err.message : 'Failed to add location. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetFormFields = () => {
    setName(''); setAddress(''); setCity(''); setCountry('')
    setStateProvince(''); setPostalCode(''); setPhone('')
    setCuisineType(''); setChainId('')
  }

  const handleClose = () => {
    resetFormFields()
    setFailure(null)
    onClose()
  }

  return (
    <>
    <BranchProviderTransferModal
      open={transferModal.open}
      onClose={() => {
        setTransferModal((s) => ({ ...s, open: false }))
        onClose()
      }}
      newBranchName={transferModal.newBranchName}
      newRestaurantId={transferModal.newRestaurantId}
      currentProviders={currentProviders}
    />
    {shell.on ? (
    /* ── the house shape ───────────────────────────────────────────────────
       Copy is the legacy dialog's, word for word. Only the surface changes. */
    <Sheet
      open={open}
      onClose={handleClose}
      label="Add New Location"
      eyebrow="The locations"
      title="Add New Location"
      initialFocusRef={nameRef}
      bodyClassName="mdv-ovl__body--flush"
      footer={<span>Add a new restaurant location to your organization.</span>}
    >
      <div className="mdv-form">
        {failure ? (
          <div className="mdv-alert" role="alert">
            <p className="mdv-alert__head">Not added</p>
            <p>{failure}</p>
          </div>
        ) : null}

        <div>
          <label className="mdv-label" htmlFor="mdv-newloc-name">
            Location name <span aria-hidden style={{ color: 'var(--seal)' }}>*</span>
          </label>
          <input
            id="mdv-newloc-name"
            ref={nameRef}
            className="mdv-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Joe's Pizza — Uptown"
          />
        </div>

        {chains.length > 0 && (
          <div>
            <label className="mdv-label" htmlFor="mdv-newloc-chain">
              Chain / Brand <span style={{ textTransform: 'none' }}>(optional)</span>
            </label>
            <select
              id="mdv-newloc-chain"
              className="mdv-select"
              value={chainId}
              onChange={(e) => setChainId(e.target.value)}
            >
              <option value="">Standalone — no chain</option>
              {chains.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <p className="mdv-hintline">
              Groups this location under an existing brand in the branch switcher.
            </p>
          </div>
        )}

        <div>
          <span className="mdv-label">
            Country <span aria-hidden style={{ color: 'var(--seal)' }}>*</span>
          </span>
          {/* `.mdv-adopt`: a shared legacy control, repainted not rewritten —
              see the honest limit in this file's header. */}
          <div className="mdv-adopt">
            <CountryCombobox value={country} onChange={setCountry} />
          </div>
          {!country && (
            <p className="mdv-hintline">Select a country to enable address search</p>
          )}
        </div>

        {country.trim().length >= 2 && (
          <>
            <div>
              <span className="mdv-label">
                Street Address <span aria-hidden style={{ color: 'var(--seal)' }}>*</span>
              </span>
              <div className="mdv-adopt">
                <PlacesAutocomplete
                  country={country}
                  value={address}
                  onChange={setAddress}
                  onPlaceSelect={handlePlaceSelect}
                  placeholder="Start typing your street address…"
                />
              </div>
            </div>

            <div className="mdv-pair">
              <div>
                <label className="mdv-label" htmlFor="mdv-newloc-city">
                  City <span aria-hidden style={{ color: 'var(--seal)' }}>*</span>
                </label>
                <input
                  id="mdv-newloc-city"
                  className="mdv-input"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Chicago"
                />
              </div>
              <div>
                <label className="mdv-label" htmlFor="mdv-newloc-state">
                  State / Province
                </label>
                <input
                  id="mdv-newloc-state"
                  className="mdv-input"
                  value={stateProvince}
                  onChange={(e) => setStateProvince(e.target.value)}
                  placeholder="IL"
                />
              </div>
            </div>

            <div className="mdv-pair">
              <div>
                <label className="mdv-label" htmlFor="mdv-newloc-zip">
                  ZIP / Postal
                </label>
                <input
                  id="mdv-newloc-zip"
                  className="mdv-input"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  placeholder="60601"
                />
              </div>
              <div>
                <span className="mdv-label">Phone</span>
                <div className="mdv-adopt">
                  <PhoneNumberInput
                    value={phone}
                    onChange={setPhone}
                    countryHint={country}
                    invalid={Boolean(phone.trim() && !isValidPhone(phone))}
                  />
                </div>
              </div>
            </div>
          </>
        )}

        <div className="mdv-actions">
          <button type="button" className="mdv-btn" onClick={handleClose}>
            Cancel
          </button>
          <button
            type="button"
            className="mdv-btn mdv-btn--seal"
            onClick={handleSubmit}
            disabled={isSubmitting || !name.trim() || !country.trim() || !address.trim() || !city.trim()}
          >
            {isSubmitting ? 'Adding…' : 'Add Location'}
          </button>
        </div>
      </div>
    </Sheet>
    ) : (
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
                        <PhoneNumberInput
                          value={phone}
                          onChange={setPhone}
                          countryHint={country}
                          invalid={Boolean(phone.trim() && !isValidPhone(phone))}
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
    )}
    </>
  )
}
