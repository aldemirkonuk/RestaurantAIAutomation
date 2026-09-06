/**
 * Create a chain, and optionally sweep standalone locations into it.
 *
 * SHAPE: `Sheet`. It is a form that authors ONE OBJECT (the chain) and names
 * it; the location checklist is a field on that object, not a separate ask.
 * ADR 0112: right slide-in, 440px, motion `tuck`.
 *
 * Not a `Panel`, even though it is the shorter of the two creation forms: the
 * shape encodes what the overlay is FOR, not how tall it happens to be, and
 * "in the middle" is reserved for a question the operator answers and leaves.
 *
 * The legacy Radix branch is frozen — see EditLocationChainDialog's header.
 * Nothing here deletes: creating a chain and PATCHing `chainId` onto locations
 * are both additive, so there is no hold-to-approve seal.
 */

import { useState, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'framer-motion'
import { Link2, X, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import { apiClient, getErrorMessage } from '../../services/api/client'
import { Sheet } from '../mudavym/Sheet'
import { useMudavymShell } from '../../lib/mudavym/shellGround'
import './locations-mudavym.css'

interface StandaloneLocation {
  id: string
  name: string
  city: string | null
}

interface CreateChainDialogProps {
  open: boolean
  onClose: () => void
  onCreated: (chain: { id: string; name: string }) => void
  standaloneLocations: StandaloneLocation[]
}


export function CreateChainDialog({
  open,
  onClose,
  onCreated,
  standaloneLocations,
}: CreateChainDialogProps) {
  const [name, setName] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isSubmitting, setIsSubmitting] = useState(false)
  /* The failure in words, on the surface that caused it — see the note in
     EditLocationChainDialog. The toast still fires; behaviour is unchanged. */
  const [failure, setFailure] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const shell = useMudavymShell()

  const toggleLocation = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleClose = () => {
    setName('')
    setSelectedIds(new Set())
    setFailure(null)
    onClose()
  }

  const handleSubmit = async () => {
    if (!name.trim()) return
    setIsSubmitting(true)
    setFailure(null)
    try {
      // Create the chain
      const { data: created } = await apiClient.post<{ id: string; name: string }>(
        '/organizations/chains',
        { name: name.trim() },
      )

      // Assign selected locations
      const ids = Array.from(selectedIds)
      await Promise.all(
        ids.map((locationId) =>
          apiClient.patch(`/organizations/locations/${locationId}`, {
            chainId: created.id,
          }),
        ),
      )

      toast.success(
        ids.length > 0
          ? `"${name.trim()}" created with ${ids.length} location${ids.length !== 1 ? 's' : ''}`
          : `"${name.trim()}" created`,
      )
      onCreated({ id: created.id, name: created.name })
      handleClose()
    } catch (e) {
      setFailure(`Could not create chain — ${getErrorMessage(e)}`)
      toast.error(`Could not create chain — ${getErrorMessage(e)}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  /* ── the house shape ─────────────────────────────────────────────────────
     Copy is the legacy dialog's, word for word. Only the surface changes. */
  if (shell.on) {
    const tally =
      selectedIds.size > 0
        ? `${selectedIds.size} location${selectedIds.size !== 1 ? 's' : ''} selected`
        : standaloneLocations.length > 0
          ? 'No locations selected'
          : ''

    return (
      <Sheet
        open={open}
        onClose={handleClose}
        label="New chain"
        eyebrow="The locations"
        title="New chain"
        initialFocusRef={nameRef}
        bodyClassName="mdv-ovl__body--flush"
        footer={<span>Group locations under a shared brand.</span>}
      >
        <div className="mdv-form">
          {failure ? (
            <div className="mdv-alert" role="alert">
              <p className="mdv-alert__head">Not created</p>
              <p>{failure}</p>
            </div>
          ) : null}

          <div>
            <label className="mdv-label" htmlFor="mdv-chain-name">
              Chain name
            </label>
            <input
              id="mdv-chain-name"
              ref={nameRef}
              className="mdv-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isSubmitting && name.trim() && handleSubmit()}
              placeholder="e.g. The Grill Co."
            />
          </div>

          {standaloneLocations.length > 0 && (
            <div>
              <span className="mdv-label">
                Add locations to this chain <span style={{ textTransform: 'none' }}>(optional)</span>
              </span>
              <div className="mdv-picks">
                {standaloneLocations.map((loc) => {
                  const selected = selectedIds.has(loc.id)
                  return (
                    <button
                      key={loc.id}
                      type="button"
                      aria-pressed={selected}
                      className="mdv-pick"
                      onClick={() => toggleLocation(loc.id)}
                    >
                      <span>
                        <span className="mdv-pick__label">{loc.name}</span>
                        {loc.city && <span className="mdv-pick__sub">{loc.city}</span>}
                      </span>
                      {selected ? (
                        <Check size={14} className="mdv-pick__mark" aria-hidden />
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="mdv-actions">
            <span className="mdv-tally">{tally}</span>
            <button type="button" className="mdv-btn" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button
              type="button"
              className="mdv-btn mdv-btn--seal"
              onClick={handleSubmit}
              disabled={isSubmitting || !name.trim()}
            >
              {isSubmitting ? 'Creating…' : 'Create chain'}
            </button>
          </div>
        </div>
      </Sheet>
    )
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/20 z-50 backdrop-blur-[1px]" />
        <Dialog.Content asChild>
          <motion.div
            className="fixed left-1/2 top-1/2 z-50 bg-white rounded-2xl shadow-lg w-full max-w-sm border border-gray-100 flex flex-col max-h-[min(90vh,520px)]"
            style={{ x: '-50%', y: '-50%' }}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
          >
            {/* Fixed header */}
            <div className="px-6 pt-6 pb-1 shrink-0">
              <div className="flex items-center justify-between mb-1">
                <Dialog.Title className="text-base font-semibold text-gray-900 flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-wine-500" />
                  New chain
                </Dialog.Title>
                <button type="button" onClick={handleClose} className="text-gray-300 hover:text-gray-500 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <Dialog.Description className="text-sm text-gray-400">
                Group locations under a shared brand.
              </Dialog.Description>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1 min-h-0 px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">
                  Chain name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !isSubmitting && name.trim() && handleSubmit()}
                  placeholder="e.g. The Grill Co."
                  autoFocus
                  className="block w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-wine-500 focus:border-transparent outline-none transition-all"
                />
              </div>

              {standaloneLocations.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                    Add locations to this chain
                    <span className="ml-1.5 normal-case font-normal text-gray-400">(optional)</span>
                  </label>
                  <div className="space-y-1.5">
                    {standaloneLocations.map((loc) => {
                      const selected = selectedIds.has(loc.id)
                      return (
                        <button
                          key={loc.id}
                          type="button"
                          onClick={() => toggleLocation(loc.id)}
                          className={cn(
                            'w-full text-left px-3 py-2.5 rounded-xl border transition-all duration-150 flex items-center justify-between',
                            selected
                              ? 'border-wine-400 bg-wine-50'
                              : 'border-gray-100 bg-gray-50 hover:border-gray-200 hover:bg-gray-100',
                          )}
                        >
                          <div>
                            <p className={cn('text-sm font-medium', selected ? 'text-wine-800' : 'text-gray-800')}>
                              {loc.name}
                            </p>
                            {loc.city && (
                              <p className={cn('text-xs mt-0.5', selected ? 'text-wine-500' : 'text-gray-400')}>
                                {loc.city}
                              </p>
                            )}
                          </div>
                          {selected && <Check className="w-4 h-4 text-wine-500 shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Fixed footer */}
            <div className="px-6 py-4 border-t border-gray-100 shrink-0 flex items-center justify-between gap-2">
              <span className="text-xs text-gray-400">
                {selectedIds.size > 0
                  ? `${selectedIds.size} location${selectedIds.size !== 1 ? 's' : ''} selected`
                  : standaloneLocations.length > 0
                  ? 'No locations selected'
                  : ''}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={handleClose} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={isSubmitting || !name.trim()}
                  className="bg-wine-600 text-white hover:bg-wine-700"
                >
                  {isSubmitting ? 'Creating…' : 'Create chain'}
                </Button>
              </div>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
