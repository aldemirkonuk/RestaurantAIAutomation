import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ShoppingBag, ArrowRight, X } from 'lucide-react'
import { Button } from '../ui/button'

interface OrderGuardModalProps {
  open: boolean
  onClose: () => void
}

/**
 * Shown when a user attempts to create an order but has no vendors configured.
 * Provides a direct link to /providers and a "Back to Order" dismiss button.
 */
export function OrderGuardModal({ open, onClose }: OrderGuardModalProps) {
  const navigate = useNavigate()

  const handleGoToProviders = () => {
    onClose()
    navigate('/providers')
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content asChild>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              className="relative bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            >
              <button
                type="button"
                onClick={onClose}
                className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex justify-center mb-4">
                <div className="p-3 rounded-full bg-wine-50 border border-wine-200">
                  <ShoppingBag className="w-8 h-8 text-wine-600" />
                </div>
              </div>

              <Dialog.Title className="text-lg font-semibold text-gray-900 text-center mb-2">
                Add a vendor to place orders
              </Dialog.Title>

              <Dialog.Description className="text-sm text-gray-500 text-center mb-6">
                You don't have any wine vendors set up yet. Before you can place orders, add at least
                one distributor or supplier to your Providers list.
              </Dialog.Description>

              <div className="flex flex-col gap-2">
                <Button
                  onClick={handleGoToProviders}
                  className="w-full bg-wine-600 text-white hover:bg-wine-700 flex items-center justify-center gap-2"
                >
                  Go to Providers
                  <ArrowRight className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  onClick={onClose}
                  className="w-full text-gray-600"
                >
                  Back to Order
                </Button>
              </div>
            </motion.div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
