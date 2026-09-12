import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'framer-motion'
import { Link2, X, Check, PlusCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import { apiClient, getErrorMessage } from '../../services/api/client'

interface StandaloneLocation {
  id: string
  name: string
  city: string | null
}

interface AssignToChainDialogProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  onCreateNew: () => void
  chainId: string
  chainName: string
  standaloneLocations: StandaloneLocation[]
}


export function AssignToChainDialog({
  open,
  onClose,
  onSaved,
  onCreateNew,
  chainId,
  chainName,
  standaloneLocations,
}: AssignToChainDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isSubmitting, setIsSubmitting] = useState(false)

  const toggle = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const handleClose = () => {
    setSelectedIds(new Set())
    onClose()
  }

  const handleSubmit = async () => {
    if (selectedIds.size === 0) return
    setIsSubmitting(true)
    try {
      await Promise.all(
        Array.from(selectedIds).map((locationId) =>
          apiClient.patch(`/organizations/locations/${locationId}`, { chainId }),
        ),
      )
      const n = selectedIds.size
      toast.success(`${n} location${n !== 1 ? 's' : ''} added to "${chainName}"`)
      onSaved()
      handleClose()
    } catch (e) {
      toast.error(`Could not assign locations — ${getErrorMessage(e)}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/20 z-50 backdrop-blur-[1px]" />
        <Dialog.Content asChild>
          <motion.div
            className="fixed left-1/2 top-1/2 z-50 bg-white rounded-2xl shadow-lg w-full max-w-sm border border-gray-100 flex flex-col max-h-[min(90vh,480px)]"
            style={{ x: '-50%', y: '-50%' }}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
          >
            {/* Header */}
            <div className="px-6 pt-6 pb-1 shrink-0">
              <div className="flex items-center justify-between mb-1">
                <Dialog.Title className="text-base font-semibold text-gray-900 flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-wine-500" />
                  Add to {chainName}
                </Dialog.Title>
                <button type="button" onClick={handleClose} className="text-gray-300 hover:text-gray-500 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <Dialog.Description className="text-sm text-gray-400">
                Pick existing locations to move into this chain.
              </Dialog.Description>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1 min-h-0 px-6 py-5 space-y-1.5">
              {standaloneLocations.length === 0 ? (
                <p className="text-sm text-gray-400 italic py-2">No standalone locations available.</p>
              ) : (
                standaloneLocations.map((loc) => {
                  const selected = selectedIds.has(loc.id)
                  return (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => toggle(loc.id)}
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
                })
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 shrink-0 space-y-3">
              <button
                type="button"
                onClick={() => { handleClose(); onCreateNew() }}
                className="flex items-center gap-1.5 text-xs text-wine-500 hover:text-wine-700 font-medium transition-colors"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                Create a brand-new location instead
              </button>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-400">
                  {selectedIds.size > 0
                    ? `${selectedIds.size} selected`
                    : 'None selected'}
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={handleClose} disabled={isSubmitting}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSubmit}
                    disabled={isSubmitting || selectedIds.size === 0}
                    className="bg-wine-600 text-white hover:bg-wine-700 disabled:opacity-40"
                  >
                    {isSubmitting ? 'Saving…' : 'Add to chain'}
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
