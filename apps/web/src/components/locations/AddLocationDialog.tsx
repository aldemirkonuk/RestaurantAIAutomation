import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'framer-motion'
import { Building2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'

interface Chain {
  id: string
  name: string
  cuisine_type: string | null
}

interface AddLocationDialogProps {
  open: boolean
  onClose: () => void
  onLocationAdded?: (location: { id: string; name: string }) => void
}

export function AddLocationDialog({ open, onClose, onLocationAdded }: AddLocationDialogProps) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [phone, setPhone] = useState('')
  const [cuisineType, setCuisineType] = useState('')
  const [chainId, setChainId] = useState<string>('')
  const [chains, setChains] = useState<Chain[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

  // Fetch available chains for the dropdown
  useEffect(() => {
    if (!open) return
    const token = localStorage.getItem('accessToken')
    fetch(`${API_URL}/api/v1/organizations/chains`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => setChains(Array.isArray(data) ? data : []))
      .catch(() => setChains([]))
  }, [open, API_URL])

  const handleSubmit = async () => {
    if (!name.trim() || !address.trim() || !city.trim()) {
      toast.error('Name, address, and city are required')
      return
    }
    setIsSubmitting(true)
    try {
      const token = localStorage.getItem('accessToken')
      const resp = await fetch(`${API_URL}/api/v1/organizations/locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: name.trim(),
          address: address.trim(),
          city: city.trim(),
          phone: phone.trim() || undefined,
          cuisineType: cuisineType.trim() || undefined,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          chainId: chainId || undefined,
        }),
      })
      if (!resp.ok) {
        const data = await resp.json()
        throw new Error(data.message || 'Failed to add location')
      }
      const location = await resp.json()
      toast.success(`${name} added successfully!`)
      onLocationAdded?.(location)
      handleClose()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add location. Please try again.'
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    setName('')
    setAddress('')
    setCity('')
    setPhone('')
    setCuisineType('')
    setChainId('')
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" onClick={handleClose} />
        <Dialog.Content asChild>
          <motion.div
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-xl p-6 w-full max-w-md"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-wine-500" />
                Add New Location
              </Dialog.Title>
              <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <Dialog.Description className="text-sm text-gray-500 mb-5">
              Add a new restaurant location to your organization. You can optionally assign it to an existing chain.
            </Dialog.Description>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Restaurant name *</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Joe's Pizza — Uptown"
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-wine-500 focus:outline-none"
                />
              </div>

              {chains.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Chain / Brand (optional)</label>
                  <select
                    value={chainId}
                    onChange={(e) => setChainId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-wine-500 focus:outline-none"
                  >
                    <option value="">Standalone — no chain</option>
                    {chains.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">
                    Groups this location under an existing brand in the branch switcher.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address *</label>
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="123 Main St"
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-wine-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City *</label>
                  <input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="New York"
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-wine-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 (555) 000-0000"
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-wine-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="bg-wine-600 text-white hover:bg-wine-700"
              >
                {isSubmitting ? 'Adding...' : 'Add Location'}
              </Button>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
