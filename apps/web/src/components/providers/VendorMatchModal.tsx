import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldCheck,
  Users,
  MapPin,
  Phone,
  Mail,
  Globe,
  Loader2,
  ArrowRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { addProviderFromCatalogue } from '../../services/api/vendors'
import type { DuplicateMatch } from '../../hooks/useDuplicateVendorCheck'

/**
 * Interrupts provider entry when what's being typed looks like a supplier the
 * restaurant already has — either as a verified catalogue vendor or as one of
 * its own existing providers.
 *
 * Why this exists: the add-provider flow has two doors — search the catalogue
 * first, or type a custom vendor directly (also reachable via the 'n'
 * shortcut, no detour through search). Nothing stopped the second door from
 * creating a duplicate, which is exactly how Breakthru Beverage Group ended up
 * added twice. The same gap existed on rename.
 *
 * Deliberately never a hard block. The best match can be wrong — a same-named
 * vendor in a different market, a franchise, a coincidence — so every variant
 * offers a way to carry on. It interrupts once per distinct match; dismissing
 * it does not re-prompt for that same candidate.
 *
 * WHAT THIS DOES NOT DO: merge two existing provider records. Orders,
 * invoices, and conversations all reference provider_id, so silently
 * repointing them is destructive in a way a duplicate warning is not. When
 * the match is an existing provider the modal reports it and lets the user
 * decide; it never rewrites their data.
 */
export interface VendorMatchModalProps {
  open: boolean
  match: DuplicateMatch | null
  /**
   * Context this is shown from. 'add' can offer to add the catalogue vendor
   * outright; 'edit' cannot — the record already exists, so the only honest
   * options are to warn and step aside.
   */
  context: 'add' | 'edit'
  /** Called after a catalogue vendor was added and the form should close. */
  onUseCatalogue?: () => void
  /** Dismiss and let the user carry on with what they were doing. */
  onDismiss: () => void
}

export function VendorMatchModal({
  open,
  match,
  context,
  onUseCatalogue,
  onDismiss,
}: VendorMatchModalProps) {
  const [adding, setAdding] = useState(false)

  if (!match) return null

  const isCatalogue = match.kind === 'catalogue'
  const record = isCatalogue ? match.vendor : match.provider
  const confidencePct = Math.round(match.confidence * 100)

  const handleUseCatalogue = async () => {
    if (adding || match.kind !== 'catalogue') return
    setAdding(true)
    try {
      await addProviderFromCatalogue(match.vendor.id)
      toast.success(`Added ${match.vendor.name} — the verified vendor already on file`)
      onUseCatalogue?.()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add vendor'
      toast.error(`Could not add ${match.vendor.name}`, { description: message })
    } finally {
      setAdding(false)
    }
  }

  const heading = isCatalogue
    ? 'This looks like a vendor we already have verified'
    : 'You already have this provider'

  const subheading = isCatalogue
    ? `${confidencePct}% match · adding your own copy would duplicate it`
    : `${confidencePct}% match · saving this would give you two of the same supplier`

  const address = isCatalogue
    ? match.vendor.address || [match.vendor.city, match.vendor.state].filter(Boolean).join(', ')
    : match.provider.address

  // 'edit' never offers to add anything: the record being edited already
  // exists, so "use this vendor" would create a THIRD row rather than resolve
  // the duplicate it is warning about.
  const canAddCatalogue = isCatalogue && context === 'add'

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={onDismiss}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Possible duplicate provider"
            className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <div className="border-b border-amber-100 bg-amber-50 px-5 py-4">
              <div className="flex items-start gap-2.5">
                {isCatalogue ? (
                  <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
                ) : (
                  <Users className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
                )}
                <div>
                  <h2 className="text-sm font-bold text-gray-900">{heading}</h2>
                  <p className="mt-0.5 text-xs text-gray-500">{subheading}</p>
                </div>
              </div>
            </div>

            <div className="px-5 py-4">
              <div className="flex flex-wrap items-start gap-2">
                <h3 className="text-base font-semibold text-gray-900">{record.name}</h3>
                {isCatalogue ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                    <ShieldCheck className="h-3 w-3" />
                    Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
                    In your providers
                  </span>
                )}
              </div>

              <div className="mt-3 space-y-1.5 text-sm text-gray-700">
                {address && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                    <span>{address}</span>
                  </div>
                )}
                {record.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                    <span>{record.phone}</span>
                  </div>
                )}
                {record.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                    <span className="truncate">{record.email}</span>
                  </div>
                )}
                {record.website && (
                  <div className="flex items-center gap-2">
                    <Globe className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                    <span className="truncate">{record.website}</span>
                  </div>
                )}
              </div>

              {isCatalogue && match.vendor.wine_specialties && (
                <p className="mt-3 rounded-lg bg-gray-50 p-2.5 text-xs leading-relaxed text-gray-600">
                  {match.vendor.wine_specialties}
                </p>
              )}

              {!isCatalogue && (
                <p className="mt-3 rounded-lg bg-gray-50 p-2.5 text-xs leading-relaxed text-gray-500">
                  Existing records aren&rsquo;t merged automatically &mdash; orders and messages
                  are tied to a specific provider. Edit the one you already have, or continue if
                  these really are two different suppliers.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-5 py-3.5">
              <button
                type="button"
                onClick={onDismiss}
                className="text-xs font-medium text-gray-500 transition-colors hover:text-gray-700"
              >
                {canAddCatalogue
                  ? 'No, this is a different vendor — continue as custom'
                  : 'This is a different supplier — continue'}
              </button>
              {canAddCatalogue && (
                <button
                  type="button"
                  onClick={handleUseCatalogue}
                  disabled={adding}
                  className="flex flex-shrink-0 items-center gap-1.5 rounded-xl bg-wine-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-wine-600/30 transition-all hover:bg-wine-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {adding ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )}
                  {adding ? 'Adding…' : 'Use this vendor'}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
