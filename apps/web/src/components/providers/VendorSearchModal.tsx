import { useState, useEffect, useRef, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, X, Wine } from 'lucide-react'
import { toast } from 'sonner'
import { VendorCatalogueCard } from './VendorCatalogueCard'
import {
  searchVendorCatalogue,
  addProviderFromCatalogue,
  type VendorCatalogueEntry,
} from '../../services/api/vendors'

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export interface VendorSearchModalProps {
  open: boolean
  onClose: () => void
  onProviderAdded: () => void
  onAddCustom: () => void
}

// ──────────────────────────────────────────────────────────────
// Skeleton
// ──────────────────────────────────────────────────────────────

function VendorCardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-5 bg-gray-200 rounded w-48" />
            <div className="h-5 bg-gray-200 rounded w-20" />
          </div>
          <div className="h-3.5 bg-gray-100 rounded w-32" />
          <div className="h-3 bg-gray-100 rounded w-56" />
        </div>
        <div className="h-8 w-32 bg-gray-200 rounded-lg flex-shrink-0" />
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────

export function VendorSearchModal({
  open,
  onClose,
  onProviderAdded,
  onAddCustom,
}: VendorSearchModalProps) {
  const [query, setQuery] = useState('')
  const [country, setCountry] = useState('US')
  const [results, setResults] = useState<VendorCatalogueEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Debounced search ──────────────────────────────────────
  const runSearch = useCallback(
    async (q: string, c: string) => {
      setLoading(true)
      setHasSearched(true)
      try {
        const data = await searchVendorCatalogue(q, c || undefined)
        setResults(data)
      } catch {
        toast.error('Failed to search vendors', { description: 'Please try again.' })
        setResults([])
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!query && !country) {
      setResults([])
      setHasSearched(false)
      return
    }

    debounceRef.current = setTimeout(() => {
      runSearch(query, country)
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, country, runSearch])

  // ── Focus input when modal opens ─────────────────────────
  useEffect(() => {
    if (open) {
      // Tiny delay so Radix can finish positioning
      const t = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(t)
    } else {
      // Reset state on close
      setQuery('')
      setCountry('US')
      setResults([])
      setHasSearched(false)
      setLoading(false)
    }
  }, [open])

  // ── Add vendor ────────────────────────────────────────────
  const handleAdd = async (vendor: VendorCatalogueEntry) => {
    try {
      await addProviderFromCatalogue(vendor.id)
      toast.success(`Added ${vendor.name} to your providers`)
      onProviderAdded()
      onClose()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add vendor'
      toast.error(`Could not add ${vendor.name}`, { description: message })
    }
  }

  // ── Add custom (close modal, open AddProviderModal) ───────
  const handleAddCustom = () => {
    onClose()
    onAddCustom()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
          />
        </Dialog.Overlay>

        <Dialog.Content asChild>
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="fixed inset-0 z-50 flex items-start justify-center pt-[5vh] px-4 pb-4 pointer-events-none"
          >
            <div className="pointer-events-auto w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[88vh] overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-wine-50 rounded-xl">
                    <Wine className="w-5 h-5 text-wine-600" />
                  </div>
                  <div>
                    <Dialog.Title className="text-lg font-bold text-gray-900">
                      Find a Wine Vendor
                    </Dialog.Title>
                    <p className="text-xs text-gray-500">
                      Search our curated catalogue of US wine distributors and importers
                    </p>
                  </div>
                </div>
                <Dialog.Close asChild>
                  <button
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </Dialog.Close>
              </div>

              {/* Search bar */}
              <div className="px-6 py-4 border-b border-gray-100 flex-shrink-0">
                <div className="flex gap-3">
                  {/* Search input */}
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      ref={inputRef}
                      type="text"
                      placeholder="Search vendors by name or specialty..."
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-wine-500 focus:border-transparent outline-none transition-all"
                    />
                  </div>

                  {/* Country filter */}
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-wine-500 outline-none transition-all bg-white text-gray-700"
                  >
                    <option value="US">United States</option>
                    <option value="">All Countries</option>
                    <option value="FR">France</option>
                    <option value="IT">Italy</option>
                    <option value="ES">Spain</option>
                    <option value="DE">Germany</option>
                    <option value="AU">Australia</option>
                    <option value="NZ">New Zealand</option>
                    <option value="AR">Argentina</option>
                    <option value="CL">Chile</option>
                  </select>
                </div>
              </div>

              {/* Results list */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                <AnimatePresence mode="wait">
                  {loading ? (
                    <motion.div
                      key="skeleton"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-3"
                    >
                      <VendorCardSkeleton />
                      <VendorCardSkeleton />
                      <VendorCardSkeleton />
                    </motion.div>
                  ) : !hasSearched ? (
                    <motion.div
                      key="idle"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex flex-col items-center justify-center py-12 text-center"
                    >
                      <Search className="w-10 h-10 text-gray-300 mb-3" />
                      <p className="text-gray-500 text-sm">
                        Search for a vendor by name or specialty
                      </p>
                    </motion.div>
                  ) : results.length === 0 ? (
                    <motion.div
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex flex-col items-center justify-center py-12 text-center"
                    >
                      <Wine className="w-10 h-10 text-gray-300 mb-3" />
                      <p className="text-gray-700 font-medium mb-1">No vendors found</p>
                      <p className="text-gray-500 text-sm">
                        Try a different search or{' '}
                        <button
                          onClick={handleAddCustom}
                          className="text-wine-600 hover:text-wine-700 underline"
                        >
                          add a custom vendor instead
                        </button>
                        .
                      </p>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="results"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-3"
                    >
                      {results.map((vendor) => (
                        <VendorCatalogueCard
                          key={vendor.id}
                          vendor={vendor}
                          onAdd={handleAdd}
                        />
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-gray-100 flex-shrink-0 flex items-center justify-between">
                <p className="text-sm text-gray-500">
                  Can't find your vendor?
                </p>
                <button
                  onClick={handleAddCustom}
                  className="text-sm text-wine-600 hover:text-wine-700 font-medium flex items-center gap-1 transition-colors"
                >
                  Add Custom Vendor Instead
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
