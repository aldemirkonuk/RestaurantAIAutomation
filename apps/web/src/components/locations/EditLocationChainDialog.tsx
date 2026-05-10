import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'framer-motion'
import { MapPin, X, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import type { RestaurantBranch } from '../../contexts/AuthContext'

export interface Chain {
  id: string
  name: string
  locationCount?: number
}

interface EditLocationChainDialogProps {
  branch: RestaurantBranch
  chains: Chain[]
  open: boolean
  onClose: () => void
  onSaved: () => void
}

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

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

  useEffect(() => {
    setSelectedChainId(branch.chain_id ?? '')
    setLocationName(branch.name)
    setCity(branch.city ?? '')
  }, [branch.id, branch.chain_id, branch.name, branch.city])

  const isDirty =
    selectedChainId !== (branch.chain_id ?? '') ||
    locationName.trim() !== branch.name ||
    city.trim() !== (branch.city ?? '')

  const isSwitchingChain =
    branch.chain_name !== null &&
    selectedChainId !== '' &&
    selectedChainId !== branch.chain_id

  const isRemovingFromChain = branch.chain_id !== null && selectedChainId === ''

  const selectedChain = chains.find((c) => c.id === selectedChainId)

  const handleSubmit = async () => {
    if (!locationName.trim()) {
      toast.error('Location name cannot be empty')
      return
    }
    setIsSubmitting(true)
    try {
      const token = localStorage.getItem('accessToken')
      const resp = await fetch(`${API_URL}/api/v1/organizations/locations/${branch.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          chainId: selectedChainId || null,
          name: locationName.trim() !== branch.name ? locationName.trim() : undefined,
          city: city.trim() !== (branch.city ?? '') ? (city.trim() || null) : undefined,
        }),
      })
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        throw new Error((data as { message?: string }).message || 'Failed to update location')
      }
      toast.success(`${locationName.trim()} updated`)
      onSaved()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update — please try again')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    setSelectedChainId(branch.chain_id ?? '')
    setLocationName(branch.name)
    setCity(branch.city ?? '')
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
