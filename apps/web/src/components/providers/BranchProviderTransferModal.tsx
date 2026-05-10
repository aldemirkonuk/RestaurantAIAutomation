import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'framer-motion'
import { X, Loader2, Building2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { addProviderFromCatalogue } from '../../services/api/vendors'
import { apiClient } from '../../services/api/client'
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
  const [transferProgress, setTransferProgress] = useState(0)

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
        } catch {
          // Individual provider failure — skip and continue with the rest
        }
        setTransferProgress(succeeded)
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
      onClose()
    } finally {
      setIsTransferring(false)
    }
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
