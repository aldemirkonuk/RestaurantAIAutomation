/**
 * Edit one location: its name, its city, the chain it belongs to — and, on the
 * house surface, for an owner, the state and country it is in (ADR 0289).
 *
 * SHAPE: `Sheet`. ADR 0112's rule is "what is the overlay FOR" — this one edits
 * ONE OBJECT that already exists, which is the Sheet's definition (right
 * slide-in, 440px, motion `tuck`). The three chain radio cards do not make it a
 * picker: the picking is a field on the record, not the point of the overlay.
 *
 * THE LEGACY BRANCH IS FROZEN. With `useMudavymShell().on` false this file
 * renders the Radix dialog byte for byte as `origin/main` has it, and
 * `locationDialogs.test.tsx` pins the literal class strings against
 * `git show origin/main:<path>` so a drift is loud rather than silent.
 *
 * WHAT THIS DIALOG DOES NOT DO: it never deletes. Clearing the chain writes
 * `chainId: null` on the location row — the location stays, the chain stays.
 * That is why there is no hold-to-approve seal here; the seal is reserved for
 * an irreversible act and this one is a PATCH you can undo by re-selecting.
 *
 * THE STATE AND COUNTRY (ADR 0289, founder 2026-10-04: "Add it to the editor
 * (Recommended)"). Until then nothing a person could reach wrote either column
 * on a house that already existed, while the market index told a United States
 * house with no state to "Set the state in Settings". The pair scopes the
 * market index, the commodity and distributor panels and mail retention, so:
 *   - only an owner of THIS house may change it — the gateway refuses anyone
 *     else whole, and this sheet shows a manager the values read-only, saying
 *     why, rather than a control that would only be refused;
 *   - the pair is read from `GET /organizations/locations/:id` when the sheet
 *     opens; a read that fails says so and offers no control, because a field
 *     seeded with a guess would write the guess back;
 *   - it is sent only when it moved, always as a pair (the state is checked
 *     against the country), and the gateway's receipt is shown in the sheet:
 *     whether the settings log recorded the change, and if not, why.
 * Only the house branch has it. The legacy branch stays byte-frozen and never
 * reads the pair.
 */

import { useState, useEffect, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'framer-motion'
import { MapPin, X, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import type { RestaurantBranch } from '../../contexts/AuthContext'
import { apiClient, getErrorMessage } from '../../services/api/client'
import { countryByName } from '../../lib/countries'
import { CountryCombobox } from '../ui/CountryCombobox'
import { Sheet } from '../mudavym/Sheet'
import { useMudavymShell } from '../../lib/mudavym/shellGround'
import './locations-mudavym.css'

export interface Chain {
  id: string
  name: string
  locationCount?: number
}

/** Where the house is, as `GET /organizations/locations/:id` answered it. */
type PlaceRead =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'unreadable' }
  | { status: 'read'; country: string; state: string; callerRole: string | null }

/** The words for `PATCH /organizations/locations/:id`'s receipt (ADR 0289). */
function placeReceipt(data: unknown): { head: string; body: string } {
  const r = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  if (r.stateAndCountry === 'unchanged') {
    return {
      head: 'Nothing to change',
      body: 'The state and country were already these, so nothing moved and nothing was recorded.',
    }
  }
  if (r.stateAndCountry === 'changed' && r.audited === true) {
    return {
      head: 'Saved',
      body: 'The state and country are changed, and the settings log records the change under your name.',
    }
  }
  if (r.stateAndCountry === 'changed') {
    const why = typeof r.auditReason === 'string' && r.auditReason.trim() ? r.auditReason : 'no reason was given'
    return {
      head: 'Saved, not recorded',
      body: `The state and country are changed, but the settings log did not record who changed them: ${why}.`,
    }
  }
  // An answer without a receipt is not a recorded change (ADR 0020).
  return {
    head: 'Saved, unconfirmed',
    body: 'The answer did not say whether the state and country changed or were recorded. Reopen this location to see what it holds.',
  }
}

/** The rule the gateway applies to the state, said before it is applied. */
function stateHint(countryCode: string | undefined): string {
  if (countryCode === 'US') return 'Required for a United States house: the two-letter code or the full name, CA or California.'
  if (countryCode === 'GB') return 'England, Scotland, Wales or Northern Ireland — or blank for the whole country.'
  if (countryCode === 'TR') return 'One of the 81 provinces — or blank for the whole country.'
  return 'Optional. Kept as you write it.'
}

interface EditLocationChainDialogProps {
  branch: RestaurantBranch
  chains: Chain[]
  open: boolean
  onClose: () => void
  onSaved: () => void
}


export function EditLocationChainDialog({
  branch,
  chains,
  open,
  onClose,
  onSaved,
}: EditLocationChainDialogProps) {
  const [selectedChainId, setSelectedChainId] = useState<string>(branch.chain_id ?? '')
  const [locationName, setLocationName] = useState(branch.name)
  const [city, setCity] = useState(branch.city ?? '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  /* The failure, in words, on the surface that caused it. The toast still
     fires (behaviour unchanged); a toast that has already faded is not a
     record, and an overlay that shows nothing after a failed save is the
     absence-reported-as-health shape (ADR 0020). House branch only. */
  const [failure, setFailure] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const shell = useMudavymShell()
  /* The state and country — house branch only (ADR 0289). */
  const [place, setPlace] = useState<PlaceRead>({ status: 'idle' })
  const [country, setCountry] = useState('')
  const [stateProvince, setStateProvince] = useState('')
  const [receipt, setReceipt] = useState<{ head: string; body: string } | null>(null)

  useEffect(() => {
    if (!shell.on || !open) return
    let live = true
    setPlace({ status: 'pending' })
    apiClient
      .get(`/organizations/locations/${branch.id}`)
      .then(({ data }) => {
        if (!live) return
        const row = data as Record<string, unknown> | null
        // A row without the two keys is not a house with no state: it is a
        // read this sheet cannot use, and seeding the fields from it would
        // write blanks back over what the house records.
        if (!row || typeof row !== 'object' || Array.isArray(row) || !('country' in row) || !('stateProvince' in row)) {
          setPlace({ status: 'unreadable' })
          return
        }
        const storedCountry = typeof row.country === 'string' ? row.country : ''
        const shownCountry = countryByName(storedCountry)?.name ?? storedCountry
        const storedState = typeof row.stateProvince === 'string' ? row.stateProvince : ''
        const callerRole = typeof row.callerRole === 'string' ? row.callerRole : null
        setPlace({ status: 'read', country: shownCountry, state: storedState, callerRole })
        setCountry(shownCountry)
        setStateProvince(storedState)
      })
      .catch(() => {
        if (live) setPlace({ status: 'unreadable' })
      })
    return () => {
      live = false
    }
  }, [shell.on, open, branch.id])

  useEffect(() => {
    setSelectedChainId(branch.chain_id ?? '')
    setLocationName(branch.name)
    setCity(branch.city ?? '')
  }, [branch.id, branch.chain_id, branch.name, branch.city])

  const isOwner = place.status === 'read' && place.callerRole === 'owner'
  const placeDirty =
    isOwner &&
    place.status === 'read' &&
    (country.trim() !== place.country || stateProvince.trim() !== place.state)
  const countryCode = countryByName(country)?.code

  const isDirty =
    selectedChainId !== (branch.chain_id ?? '') ||
    locationName.trim() !== branch.name ||
    city.trim() !== (branch.city ?? '') ||
    placeDirty

  const isSwitchingChain =
    branch.chain_name !== null &&
    selectedChainId !== '' &&
    selectedChainId !== branch.chain_id

  const isRemovingFromChain = branch.chain_id !== null && selectedChainId === ''

  const selectedChain = chains.find((c) => c.id === selectedChainId)

  const handleSubmit = async () => {
    if (!locationName.trim()) {
      setFailure('Location name cannot be empty')
      toast.error('Location name cannot be empty')
      return
    }
    // Said here before the gateway says it, so a half-filled pair costs no
    // round trip. The gateway still checks both (ADR 0289 R3).
    if (placeDirty && !country.trim()) {
      setFailure('Choose the country this house is in. A house’s country cannot be cleared.')
      return
    }
    if (placeDirty && countryCode === 'US' && !stateProvince.trim()) {
      setFailure('A United States house needs its state — write it as CA or California.')
      return
    }
    setIsSubmitting(true)
    setFailure(null)
    try {
      const res = await apiClient.patch(`/organizations/locations/${branch.id}`, {
        chainId: selectedChainId || null,
        name: locationName.trim() !== branch.name ? locationName.trim() : undefined,
        city: city.trim() !== (branch.city ?? '') ? (city.trim() || null) : undefined,
        // The pair travels together or not at all: the gateway reads the
        // state against the country it is sent with.
        ...(placeDirty ? { country: country.trim(), stateProvince: stateProvince.trim() || null } : {}),
      })
      toast.success(`${locationName.trim()} updated`)
      if (placeDirty) {
        // The receipt stays on the sheet until it is read; a toast that has
        // faded is not a record of whether the log took the change.
        setReceipt(placeReceipt(res?.data))
        return
      }
      onSaved()
    } catch (err: unknown) {
      setFailure(getErrorMessage(err))
      toast.error(getErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    setSelectedChainId(branch.chain_id ?? '')
    setLocationName(branch.name)
    setCity(branch.city ?? '')
    setFailure(null)
    if (place.status === 'read') {
      setCountry(place.country)
      setStateProvince(place.state)
    }
    if (receipt) {
      // A save already happened; the list behind the sheet must re-read it.
      setReceipt(null)
      onSaved()
      return
    }
    onClose()
  }

  const chainOptions: Array<{ id: string; label: string; sub: string }> = [
    { id: '', label: 'Standalone', sub: 'No chain grouping' },
    ...chains.map((c) => ({
      id: c.id,
      label: c.name,
      sub: c.locationCount !== undefined
        ? `${c.locationCount} location${c.locationCount !== 1 ? 's' : ''}`
        : 'Chain',
    })),
  ]

  /* ── the state and country, by what the read said (ADR 0289) ─────────── */
  const placeBlock = (() => {
    if (place.status === 'idle' || place.status === 'pending') {
      return (
        <p className="mdv-hintline" role="status">
          Reading the state and country…
        </p>
      )
    }
    if (place.status === 'unreadable') {
      return (
        <div className="mdv-alert" role="status">
          <p className="mdv-alert__head">State and country</p>
          <p>
            The state and country could not be read, so they cannot be changed here right now. Close
            and reopen this location to try again.
          </p>
        </div>
      )
    }
    if (!isOwner) {
      return (
        <div>
          <span className="mdv-label">State and country</span>
          <p className="mdv-consequence">
            <strong>{place.state || 'No state recorded'}</strong>
            {' · '}
            <strong>{place.country || 'No country recorded'}</strong>
          </p>
          <p className="mdv-hintline" role="status">
            {place.callerRole === null
              ? 'Your role in this house could not be confirmed, so the state and country cannot be changed here.'
              : 'Only an owner can change the state and country.'}
          </p>
        </div>
      )
    }
    return (
      <>
        <div>
          <label className="mdv-label" htmlFor="mdv-loc-country">
            Country
          </label>
          {/* `.mdv-adopt`: a shared legacy control, repainted not rewritten
              (locations-mudavym.css). */}
          <div className="mdv-adopt">
            <CountryCombobox id="mdv-loc-country" value={country} onChange={setCountry} />
          </div>
        </div>
        <div>
          <label className="mdv-label" htmlFor="mdv-loc-state">
            State or province
          </label>
          <input
            id="mdv-loc-state"
            className="mdv-input"
            value={stateProvince}
            onChange={(e) => setStateProvince(e.target.value)}
            placeholder={countryCode === 'US' ? 'CA or California' : 'Optional'}
          />
          <p className="mdv-hintline">{stateHint(countryCode)}</p>
        </div>
        {placeDirty ? (
          <p className="mdv-consequence">
            This re-scopes the market index, the commodity and distributor panels and how long
            vendor mail is kept, and the settings log records who changed it.
          </p>
        ) : null}
      </>
    )
  })()

  /* ── the house shape ─────────────────────────────────────────────────────
     Copy is the legacy dialog's, word for word, except the state and country
     (ADR 0289), which only this branch has. Only the surface changes. */
  if (shell.on) {
    return (
      <Sheet
        open={open}
        onClose={handleClose}
        label="Edit location"
        eyebrow="The locations"
        title="Edit location"
        initialFocusRef={nameRef}
        bodyClassName="mdv-ovl__body--flush"
        footer={<span>Update name, city, chain assignment, or — as an owner — the state and country.</span>}
      >
        {receipt ? (
          <div className="mdv-form">
            <div className="mdv-alert" role="status">
              <p className="mdv-alert__head">{receipt.head}</p>
              <p>{receipt.body}</p>
            </div>
            <div className="mdv-actions">
              <button type="button" className="mdv-btn mdv-btn--seal" onClick={handleClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
        <div className="mdv-form">
          {failure ? (
            <div className="mdv-alert" role="alert">
              <p className="mdv-alert__head">Not saved</p>
              <p>{failure}</p>
            </div>
          ) : null}

          <div>
            <label className="mdv-label" htmlFor="mdv-loc-name">
              Name
            </label>
            <input
              id="mdv-loc-name"
              ref={nameRef}
              className="mdv-input"
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
            />
          </div>

          <div>
            <label className="mdv-label" htmlFor="mdv-loc-city">
              City
            </label>
            <input
              id="mdv-loc-city"
              className="mdv-input"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div>
            <span className="mdv-label">Chain</span>
            {/* `radiogroup` + `aria-checked`: one of these is true at a time,
                which `aria-pressed` (independent toggles) would misreport. */}
            <div className="mdv-picks" role="radiogroup" aria-label="Chain">
              {chainOptions.map((opt) => {
                const selected = selectedChainId === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className="mdv-pick"
                    onClick={() => setSelectedChainId(opt.id)}
                  >
                    <span>
                      <span className="mdv-pick__label">{opt.label}</span>
                      <span className="mdv-pick__sub">{opt.sub}</span>
                    </span>
                    {selected ? (
                      <Check size={14} className="mdv-pick__mark" aria-hidden />
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>

          {placeBlock}

          {isSwitchingChain && selectedChain && (
            <p className="mdv-consequence">
              Moving from <strong>{branch.chain_name}</strong> →{' '}
              <strong>{selectedChain.name}</strong>
            </p>
          )}
          {isRemovingFromChain && (
            <p className="mdv-consequence">
              This will remove <strong>{branch.name}</strong> from{' '}
              <strong>{branch.chain_name}</strong>.
            </p>
          )}

          <div className="mdv-actions">
            <button type="button" className="mdv-btn" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button
              type="button"
              className="mdv-btn mdv-btn--seal"
              onClick={handleSubmit}
              disabled={isSubmitting || !isDirty}
            >
              {isSubmitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        )}
      </Sheet>
    )
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/20 z-50 backdrop-blur-[1px]" />
        <Dialog.Content asChild>
          <motion.div
            className="fixed left-1/2 top-1/2 z-50 bg-white rounded-2xl shadow-lg w-full max-w-sm border border-gray-100 flex flex-col max-h-[min(90vh,560px)]"
            style={{ x: '-50%', y: '-50%' }}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
          >
            {/* ── Fixed header ── */}
            <div className="px-6 pt-6 pb-1 shrink-0">
              <div className="flex items-center justify-between mb-1">
                <Dialog.Title className="text-base font-semibold text-gray-900 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-wine-500" />
                  Edit location
                </Dialog.Title>
                <button type="button" onClick={handleClose} className="text-gray-300 hover:text-gray-500 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <Dialog.Description className="text-sm text-gray-400">
                Update name, city, or chain assignment.
              </Dialog.Description>
            </div>

            {/* ── Scrollable body ── */}
            <div className="overflow-y-auto flex-1 min-h-0 px-6 py-5 space-y-4">
              {/* Name + City */}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Name</label>
                  <input
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                    className="block w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-wine-500 focus:border-transparent outline-none transition-all"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">City</label>
                  <input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Optional"
                    className="block w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-wine-500 focus:border-transparent outline-none transition-all"
                  />
                </div>
              </div>

              {/* Chain radio cards */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Chain</label>
                <div className="space-y-1.5">
                  {chainOptions.map((opt) => {
                    const selected = selectedChainId === opt.id
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setSelectedChainId(opt.id)}
                        className={cn(
                          'w-full text-left px-3 py-2.5 rounded-xl border transition-all duration-150 flex items-center justify-between',
                          selected
                            ? 'border-wine-400 bg-wine-50 text-wine-900'
                            : 'border-gray-100 bg-gray-50 text-gray-700 hover:border-gray-200 hover:bg-gray-100',
                        )}
                      >
                        <div>
                          <p className={cn('text-sm font-medium', selected ? 'text-wine-800' : 'text-gray-800')}>
                            {opt.label}
                          </p>
                          <p className={cn('text-xs mt-0.5', selected ? 'text-wine-500' : 'text-gray-400')}>
                            {opt.sub}
                          </p>
                        </div>
                        {selected && <Check className="w-4 h-4 text-wine-500 shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Contextual warnings */}
              {isSwitchingChain && selectedChain && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  Moving from <strong>{branch.chain_name}</strong> → <strong>{selectedChain.name}</strong>
                </p>
              )}
              {isRemovingFromChain && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  This will remove <strong>{branch.name}</strong> from <strong>{branch.chain_name}</strong>.
                </p>
              )}
            </div>

            {/* ── Fixed footer ── */}
            <div className="px-6 py-4 border-t border-gray-100 shrink-0 flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={handleClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={isSubmitting || !isDirty}
                className="bg-wine-600 text-white hover:bg-wine-700 disabled:opacity-40"
              >
                {isSubmitting ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
