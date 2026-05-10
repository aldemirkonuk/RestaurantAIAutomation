import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'framer-motion'
import { Building2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import type { RestaurantBranch } from '../../contexts/AuthContext'

export interface Chain {
  id: string
  name: string
}

interface EditLocationChainDialogProps {
  branch: RestaurantBranch
  chains: Chain[]
  open: boolean
  onClose: () => void
  onSaved: () => void
}

const INPUT_CLS =
  'block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-wine-500 focus:outline-none'

export function EditLocationChainDialog({
  branch,
  chains,
  open,
  onClose,
  onSaved,
}: EditLocationChainDialogProps) {
  const [selectedChainId, setSelectedChainId] = useState<string>(branch.chain_id ?? '')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Sync selected chain when branch prop changes (e.g. dialog re-opened for different branch)
  useEffect(() => {
    setSelectedChainId(branch.chain_id ?? '')
  }, [branch.id, branch.chain_id])

  const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

  // Derive the display name for the newly selected chain (for the warning message)
  const selectedChain = chains.find((c) => c.id === selectedChainId)

  // Show amber warning when user is switching from one chain to a different chain
  const isSwitchingChain =
    branch.chain_name !== null &&
    selectedChainId !== '' &&
    selectedChainId !== branch.chain_id

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      const token = localStorage.getItem('accessToken')
      const resp = await fetch(`${API_URL}/api/v1/organizations/locations/${branch.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ chainId: selectedChainId || null }),
      })
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        throw new Error((data as { message?: string }).message || 'Failed to update location')
      }
      toast.success(`${branch.name} updated!`)
      onSaved()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update location. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    setSelectedChainId(branch.chain_id ?? '')
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" onClick={handleClose} />
        <Dialog.Content asChild>
          <motion.div
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-wine-500" />
                Edit Chain Assignment
              </Dialog.Title>
              <button type="button" onClick={handleClose} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <Dialog.Description className="text-sm text-gray-500 mb-5">
              Reassign this location to a different chain or make it standalone.
            </Dialog.Description>

            {/* Read-only location header */}
            <div className="mb-4 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100">
              <p className="text-sm font-semibold text-gray-900">{branch.name}</p>
              {branch.city && <p className="text-xs text-gray-400">{branch.city}</p>}
            </div>

            {/* Chain selector */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Chain / Brand
              </label>
              <select
                value={selectedChainId}
                onChange={(e) => setSelectedChainId(e.target.value)}
                className={INPUT_CLS}
              >
                <option value="">Standalone (no chain)</option>
                {chains.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Amber warning when switching chains */}
            {isSwitchingChain && selectedChain && (
              <p className="text-xs text-amber-600 mb-4 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                This will move <strong>{branch.name}</strong> from &ldquo;{branch.chain_name}&rdquo; to &ldquo;{selectedChain.name}&rdquo;.
              </p>
            )}

            <div className="flex items-center justify-end gap-3 mt-6">
              <Button variant="ghost" onClick={handleClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="bg-wine-600 text-white hover:bg-wine-700"
              >
                {isSubmitting ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
