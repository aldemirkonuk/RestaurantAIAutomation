import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'framer-motion'
import { X, Loader2, Building2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { copyVendorsToHouse, type VendorCopyResult } from '../../services/api/vendors'
import type { Provider } from '../../services/api/providers'

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
  // All providers start checked
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isTransferring, setIsTransferring] = useState(false)
  // What the server answered, vendor by vendor (F-586). Shown in place of the
  // list so the owner reads exactly what landed and what did not, and why.
  const [results, setResults] = useState<VendorCopyResult[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  // Reset selection whenever the modal opens with a new set of providers
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set(currentProviders.map((p) => p.id)))
      setResults(null)
      setFailure(null)
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
    setFailure(null)
    try {
      // One call that names the new house; the server checks you own both
      // houses and copies into the new one. It used to post each vendor with
      // a header the server never read, so they landed in this house instead.
      const answer = await copyVendorsToHouse(
        newRestaurantId,
        selectedProviders.map((p) => p.id),
      )
      setResults(answer.results)
    } catch (cause: any) {
      setFailure(
        cause?.response?.data?.message ||
          cause?.message ||
          `No vendors were added to ${newBranchName}. Try again.`,
      )
    } finally {
      setIsTransferring(false)
    }
  }

  const added = results?.filter((r) => r.outcome === 'added') ?? []
  const skipped = results?.filter((r) => r.outcome === 'skipped') ?? []

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
              {results
                ? `Here is what happened at ${newBranchName}.`
                : 'Your current providers are listed below. Select which ones to add to this new location. They stay here too.'}
            </Dialog.Description>

            {results ? (
              <div className="flex-1 overflow-y-auto space-y-4 mb-5" data-testid="vendor-copy-results">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {added.length === 0
                      ? `No vendors were added to ${newBranchName}.`
                      : `${added.length} vendor${added.length !== 1 ? 's' : ''} added to ${newBranchName}.`}
                  </p>
                  {added.length > 0 && (
                    <ul className="mt-1 text-sm text-gray-600 list-disc pl-5">
                      {added.map((r) => (
                        <li key={r.providerId}>{r.name}</li>
                      ))}
                    </ul>
                  )}
                </div>
                {skipped.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {skipped.length} not added
                    </p>
                    <ul className="mt-1 text-sm text-gray-600 space-y-1">
                      {skipped.map((r) => (
                        <li key={r.providerId}>
                          <span className="font-medium">{r.name ?? 'A vendor'}</span> — {r.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
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
            )}

            {failure && (
              <p role="alert" className="mb-4 text-sm text-red-700">
                {failure}
              </p>
            )}

            {/* Footer actions */}
            {results ? (
              <div className="flex items-center justify-end">
                <Button
                  onClick={onClose}
                  className="bg-wine-600 text-white hover:bg-wine-700"
                >
                  Done
                </Button>
              </div>
            ) : (
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
                    Adding…
                  </>
                ) : (
                  `Add ${selectedCount > 0 ? selectedCount : ''} selected`.replace('  ', ' ')
                )}
              </Button>
            </div>
            )}
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
