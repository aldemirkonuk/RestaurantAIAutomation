/**
 * "Carry your vendors to the new location?" — asked once, after a location is
 * created.
 *
 * ── THE HOUSE SHAPE (ADR 0112, census 102) ────────────────────────────────
 * SHAPE: `Panel`. A question about a batch, put once, answered and left. Not a
 * sheet: the operator is not opening an object, they are answering whether the
 * vendors they already have should exist at the new address too. No seal —
 * copying a vendor row to another restaurant is additive and reversible, and
 * ADR 0112 rations the wax to real commitments.
 *
 * Endpoint: `POST /providers` with the new location's `X-Restaurant-Id`
 * (apps/api-gateway/src/providers/providers.controller.ts:188), once per
 * vendor. The controller deliberately preserves its own HTTP semantics — 409
 * for a catalogue vendor the location already has, 404 for a missing one, 400
 * for a bad payload — and the legacy branch threw all of that away:
 *
 *     } catch {
 *       // Individual provider failure — skip and continue with the rest
 *     }
 *
 * …and then said "9 vendors added to Kadıköy (3 skipped)". Three skipped, not
 * named, with no reason, and "skipped" reading like a choice rather than a
 * refusal. That is the absence-reported-as-health fault on a write path: the
 * server said exactly what went wrong and the surface dropped it.
 *
 * The house branch keeps the same loop and the same route, and holds on to
 * every rejection: which vendor, what the server said, and whether it was a
 * refusal (401/403) rather than a fault. A vendor the location already has is
 * told apart from a vendor that failed to copy, because those are different
 * facts and only one of them needs anybody to do anything.
 *
 * The legacy branch below is frozen and renders byte-for-byte as it shipped.
 */
import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'framer-motion'
import { X, Loader2, Building2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { apiClient } from '../../services/api/client'
import type { Provider } from '../../services/api/providers'
import { Panel } from '../mudavym/Sheet'
import { useMudavymShell } from '../../lib/mudavym/shellGround'
import '../locations/locations-mudavym.css'
import '../inventory/inventory-mudavym.css'

interface BranchProviderTransferModalProps {
  open: boolean
  onClose: () => void
  newBranchName: string
  newRestaurantId: string
  currentProviders: Provider[]
}

export function BranchProviderTransferModal({
  open,
  onClose,
  newBranchName,
  newRestaurantId,
  currentProviders,
}: BranchProviderTransferModalProps) {
  const shell = useMudavymShell()
  // All providers start checked
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isTransferring, setIsTransferring] = useState(false)
  const [transferProgress, setTransferProgress] = useState(0)
  /* House-branch state. The legacy render never reads any of it, so the
     flag-off tree is byte-identical. */
  const [outcome, setOutcome] = useState<{
    carried: string[]
    already: { id: string; name: string }[]
    failed: { id: string; name: string; message: string }[]
    denied: boolean
    at: Date
  } | null>(null)

  // Reset selection whenever the modal opens with a new set of providers
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set(currentProviders.map((p) => p.id)))
      setTransferProgress(0)
    }
  }, [open, currentProviders])

  const toggleProvider = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectedProviders = currentProviders.filter((p) => selectedIds.has(p.id))
  const selectedCount = selectedProviders.length

  const handleTransfer = async () => {
    if (selectedCount === 0) {
      toast.error('Select at least one provider to transfer')
      return
    }

    setIsTransferring(true)
    setTransferProgress(0)
    let succeeded = 0
    let attempted = 0
    const carried: string[] = []
    const already: { id: string; name: string }[] = []
    const failed: { id: string; name: string; message: string }[] = []
    let denied = false

    try {
      for (const provider of selectedProviders) {
        try {
          // If the provider was originally added from the catalogue, re-use catalogue mode.
          // Otherwise fall back to custom-provider creation for the new branch.
          if (provider.catalogueVendorId) {
            // Temporarily override the X-Restaurant-Id header for this single call
            await apiClient.post(
              '/providers',
              { catalogue_vendor_id: provider.catalogueVendorId },
              { headers: { 'X-Restaurant-Id': newRestaurantId } },
            )
          } else {
            await apiClient.post(
              '/providers',
              {
                name: provider.name,
                phone: provider.phone ?? undefined,
                email: provider.email ?? undefined,
              },
              { headers: { 'X-Restaurant-Id': newRestaurantId } },
            )
          }
          succeeded++
          carried.push(provider.id)
        } catch (err) {
          /* Individual provider failure — the loop still continues with the
             rest, exactly as it always has. What changed is that the server's
             answer is kept instead of discarded: the controller distinguishes
             409 ("this location already has that catalogue vendor") from a
             real fault, and those are different sentences to an operator. */
          const e = err as {
            response?: { status?: number; data?: { message?: string } }
            message?: string
          }
          const status = e?.response?.status
          if (status === 401 || status === 403) denied = true
          if (status === 409) already.push({ id: provider.id, name: provider.name })
          else
            failed.push({
              id: provider.id,
              name: provider.name,
              message: e?.response?.data?.message || e?.message || 'the request did not complete',
            })
        }
        attempted++
        setTransferProgress(attempted)
      }

      const skipped = selectedCount - succeeded
      if (succeeded > 0) {
        toast.success(
          `${succeeded} vendor${succeeded !== 1 ? 's' : ''} added to ${newBranchName}` +
            (skipped > 0 ? ` (${skipped} skipped)` : ''),
        )
      } else {
        toast.error('No vendors could be transferred. Please try again.')
      }
      /* The house branch stays open and says what landed; the legacy branch
         closes on the spot, as it always did. */
      if (shell.on) {
        setOutcome({ carried, already, failed, denied, at: new Date() })
        return
      }
      onClose()
    } finally {
      setIsTransferring(false)
    }
  }

  /* ── the house shape ───────────────────────────────────────────────────── */
  if (shell.on) {
    const contract = `Carry your vendors to ${newBranchName}?`
    return (
      <Panel
        open={open}
        onClose={() => !isTransferring && onClose()}
        label={`${contract} Carrying adds a vendor record at the new location. Leaving writes nothing, and you can add them later.`}
        eyebrow="The new location"
        title={outcome ? `What ${newBranchName} has now` : contract}
        closeLabel={outcome ? 'Done' : 'Close'}
        zIndex={120}
        footer={
          <span>
            A vendor carried here is a new record at {newBranchName}. Nothing at your current
            location changes.
          </span>
        }
      >
        <div className="mdv-form">
          <p className="mdv-contract">
            {outcome
              ? `This is what ${newBranchName} accepted. Anything it refused is named below and was not carried.`
              : `The vendors you already work with are listed below. Carrying one adds a vendor record at ${newBranchName}; nothing at your current location changes, and leaving writes nothing.`}
          </p>

          {outcome ? (
            <>
              <div className="mdv-panelbox">
                <p className="mdv-alert__head">Carried</p>
                <p className="mdv-record">{outcome.carried.length}</p>
                <span className="mdv-prov">
                  of {selectedCount} chosen ·{' '}
                  {outcome.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              {outcome.already.length > 0 && (
                <div className="mdv-alert" role="status">
                  <p className="mdv-alert__head">Already there</p>
                  <p>
                    {newBranchName} already had {outcome.already.length} of these, so nothing was
                    written for {outcome.already.map((p) => p.name).join(', ')}. There is nothing to
                    do about it.
                  </p>
                </div>
              )}

              {outcome.failed.length > 0 && (
                <div className="mdv-alert" role="alert">
                  <p className="mdv-alert__head">
                    {outcome.denied ? 'Not permitted' : 'Not carried'}
                  </p>
                  <p>
                    {outcome.denied
                      ? `This account is not permitted to add vendors at ${newBranchName}. The vendors below were not carried; your current location is unchanged.`
                      : `${outcome.failed.length} vendor${outcome.failed.length !== 1 ? 's were' : ' was'} not carried. ${outcome.failed.length !== 1 ? 'They do' : 'It does'} not exist at ${newBranchName} — you can add ${outcome.failed.length !== 1 ? 'them' : 'it'} there by hand.`}
                  </p>
                  {outcome.failed.map((f) => (
                    <p key={f.id} className="mdv-hintline">
                      {f.name} — {f.message}
                    </p>
                  ))}
                </div>
              )}
            </>
          ) : currentProviders.length === 0 ? (
            <p className="mdv-quiet">
              You have no vendors at this location, so there is nothing to carry.
            </p>
          ) : (
            <>
              <div>
                <span className="mdv-head">
                  <span>Your vendors</span>
                  <button
                    type="button"
                    className="mdv-link"
                    disabled={isTransferring}
                    onClick={() =>
                      setSelectedIds(
                        selectedCount === currentProviders.length
                          ? new Set()
                          : new Set(currentProviders.map((p) => p.id)),
                      )
                    }
                  >
                    {selectedCount === currentProviders.length ? 'Untick all' : 'Tick all'}
                  </button>
                </span>
                <div className="mdv-picks mdv-scroll">
                  {currentProviders.map((provider) => {
                    const on = selectedIds.has(provider.id)
                    return (
                      <button
                        key={provider.id}
                        type="button"
                        className="mdv-pick"
                        aria-pressed={on}
                        disabled={isTransferring}
                        onClick={() => toggleProvider(provider.id)}
                      >
                        <span style={{ minWidth: 0 }}>
                          <span className="mdv-pick__label">{provider.name}</span>
                          <span className="mdv-pick__sub">
                            {provider.primaryBusinessType ??
                              (provider.catalogueVendorId
                                ? 'from the catalogue'
                                : 'a vendor you added yourself')}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
                <span className="mdv-prov">
                  {currentProviders.length} vendor{currentProviders.length !== 1 ? 's' : ''} on your
                  current location&rsquo;s register
                </span>
              </div>

              {isTransferring && selectedCount > 0 && (
                <p className="mdv-hintline" aria-live="polite">
                  Carrying {transferProgress} of {selectedCount}. Each one is a separate write; the
                  ones already done stay done.
                </p>
              )}

              <div className="mdv-actions">
                <span className="mdv-tally">
                  {selectedCount} of {currentProviders.length} chosen
                </span>
                <button
                  type="button"
                  className="mdv-btn"
                  onClick={onClose}
                  disabled={isTransferring}
                >
                  Not now
                </button>
                <button
                  type="button"
                  className="mdv-btn mdv-btn--seal"
                  onClick={() => void handleTransfer()}
                  disabled={isTransferring || selectedCount === 0}
                >
                  {isTransferring
                    ? 'Carrying…'
                    : `Carry ${selectedCount} vendor${selectedCount !== 1 ? 's' : ''}`}
                </button>
              </div>
            </>
          )}
        </div>
      </Panel>
    )
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !isTransferring && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content asChild>
          <motion.div
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-xl p-6 w-full max-w-md max-h-[80vh] flex flex-col"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
              <Dialog.Title className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-wine-500 shrink-0" />
                <span>Add vendors to {newBranchName}?</span>
              </Dialog.Title>
              <button
                type="button"
                onClick={() => !isTransferring && onClose()}
                disabled={isTransferring}
                className="text-gray-400 hover:text-gray-600 disabled:opacity-40"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <Dialog.Description className="text-sm text-gray-500 mb-5">
              Your current providers are listed below. Select which ones to add to this new location.
            </Dialog.Description>

            {/* Provider list */}
            <div className="flex-1 overflow-y-auto space-y-2 mb-5">
              {currentProviders.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No providers to transfer.</p>
              ) : (
                currentProviders.map((provider) => {
                  const checked = selectedIds.has(provider.id)
                  return (
                    <label
                      key={provider.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        checked
                          ? 'border-wine-300 bg-wine-50'
                          : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleProvider(provider.id)}
                        disabled={isTransferring}
                        className="rounded border-gray-300 text-wine-600 focus:ring-wine-500"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{provider.name}</p>
                        {provider.primaryBusinessType && (
                          <p className="text-xs text-gray-500">{provider.primaryBusinessType}</p>
                        )}
                      </div>
                    </label>
                  )
                })
              )}
            </div>

            {/* Progress indicator */}
            {isTransferring && selectedCount > 0 && (
              <div className="mb-4">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                  <span>Transferring vendors…</span>
                  <span>
                    {transferProgress} / {selectedCount}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div
                    className="bg-wine-600 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${(transferProgress / selectedCount) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Footer actions */}
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="ghost"
                onClick={onClose}
                disabled={isTransferring}
                className="text-gray-600"
              >
                Skip for now
              </Button>
              <Button
                onClick={handleTransfer}
                disabled={isTransferring || selectedCount === 0}
                className="bg-wine-600 text-white hover:bg-wine-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isTransferring ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Transferring…
                  </>
                ) : (
                  `Transfer ${selectedCount > 0 ? selectedCount : ''} Selected`.trim()
                )}
              </Button>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
