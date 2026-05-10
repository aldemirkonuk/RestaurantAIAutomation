import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'framer-motion'
import { Link2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'

interface CreateChainDialogProps {
  open: boolean
  onClose: () => void
  onCreated: (chain: { id: string; name: string }) => void
  currentLocationId?: string | null
  currentLocationName?: string | null
  currentLocationHasChain?: boolean
}

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

export function CreateChainDialog({
  open,
  onClose,
  onCreated,
  currentLocationId,
  currentLocationName,
  currentLocationHasChain,
}: CreateChainDialogProps) {
  const [name, setName] = useState('')
  const [assign, setAssign] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleClose = () => {
    setName('')
    setAssign(false)
    onClose()
  }

  const handleSubmit = async () => {
    if (!name.trim()) return
    setIsSubmitting(true)
    try {
      const token = localStorage.getItem('accessToken')
      const body: Record<string, unknown> = { name: name.trim() }
      if (assign && currentLocationId) body.restaurantId = currentLocationId
      const resp = await fetch(`${API_URL}/api/v1/organizations/chains`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      if (!resp.ok) throw new Error('Failed to create chain')
      const created = await resp.json()
      toast.success(`"${name.trim()}" created`)
      onCreated({ id: created.id, name: created.name })
      handleClose()
    } catch {
      toast.error('Could not create chain — try again')
    } finally {
      setIsSubmitting(false)
    }
  }

  const canAssign = !!currentLocationId && !currentLocationHasChain

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/20 z-50 backdrop-blur-[1px]" />
        <Dialog.Content asChild>
          <motion.div
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-lg p-6 w-full max-w-sm border border-gray-100"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className="flex items-center justify-between mb-1">
              <Dialog.Title className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <Link2 className="w-4 h-4 text-wine-500" />
                New chain
              </Dialog.Title>
              <button type="button" onClick={handleClose} className="text-gray-300 hover:text-gray-500 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <Dialog.Description className="text-sm text-gray-400 mb-5">
              Group locations under a shared brand.
            </Dialog.Description>

            <div className="space-y-4">
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

              {canAssign && (
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={assign}
                    onChange={(e) => setAssign(e.target.checked)}
                    className="mt-0.5 rounded border-gray-300 text-wine-600 focus:ring-wine-500"
                  />
                  <span className="text-sm text-gray-600 group-hover:text-gray-800 transition-colors">
                    Add <span className="font-medium text-gray-800">{currentLocationName}</span> to this chain
                  </span>
                </label>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 mt-6">
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
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
