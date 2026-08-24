import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  X,
  Globe,
  Mail,
  Phone,
  MapPin,
  Plus,
  Loader2,
  ShieldCheck,
  Warehouse,
  Info,
} from 'lucide-react'
import { useDistributorDetail } from '../../../hooks/queries/useDistributorQueries'
import { addProviderFromCatalogue } from '../../../services/api/vendors'
import { queryKeys } from '../../../lib/query-keys'
import { TYPE_LABEL } from './bits'
import { providerToVendorDetail, unwrapCustomId } from './customProvider'
import type { DistributorLocation } from '../../../services/api/distributors'

interface Props {
  distributorId: string | null
  onClose: () => void
  customProviders?: any[]
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-gray-100 px-5 py-4">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{title}</h3>
      {children}
    </div>
  )
}

function Row({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1 text-sm text-gray-700">
      <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  )
}

export function DistributorDrawer({ distributorId, onClose, customProviders = [] }: Props) {
  const isOpen = !!distributorId
  const isCustom = !!distributorId?.startsWith('custom-')
  const actualId =
    distributorId && isCustom ? unwrapCustomId(distributorId) : distributorId
  const { data, isLoading } = useDistributorDetail(isCustom ? null : actualId)
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)

  const customProvider = isCustom
    ? customProviders.find((p) => p.id === actualId)
    : null

  // Built from the SAME adapter the map and card list use, so a custom vendor
  // cannot render one set of fields here and another there. Previously this
  // block read business_type / contact.phone / address.street — none of which
  // exist on Provider — and the drawer silently showed blanks.
  const vendor = isCustom && customProvider
    ? providerToVendorDetail(customProvider)
    : data?.vendor

  const territories = data?.territories ?? []

  // Provider stores one flat address string, so there is a single location and
  // no city/state/zip breakdown. Shaped to match DistributorLocation rather
  // than inventing a parallel type, so downstream rendering narrows cleanly.
  const locations: DistributorLocation[] =
    isCustom && customProvider?.physicalAddress
      ? [
          {
            id: customProvider.id,
            kind: 'Headquarters',
            name: customProvider.name,
            address: customProvider.physicalAddress,
            city: null,
            admin_area_code: null,
            postal_code: null,
            country: null,
            latitude: customProvider.latitude ?? null,
            longitude: customProvider.longitude ?? null,
            is_primary: true,
          },
        ]
      : (data?.locations ?? [])
  const facetGroups = Object.entries(data?.facets ?? {})

  const nationwide = territories.filter((t) => t.admin_area_code === null)
  const specific = territories.filter((t) => t.admin_area_code !== null)

  async function handleAdd() {
    if (!actualId || isCustom) return
    setAdding(true)
    try {
      await addProviderFromCatalogue(actualId)
      // Reuse the existing catalogue -> provider path so discovery ends in a
      // real relationship rather than a dead end.
      await queryClient.invalidateQueries({ queryKey: queryKeys.providers.all })
      toast.success(`${vendor?.name ?? 'Distributor'} added to your providers`)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not add this provider'
      toast.error(msg)
    } finally {
      setAdding(false)
    }
  }

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="distributor-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="distributor-drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 z-50 flex h-full w-[440px] max-w-[92vw] flex-col border-l border-gray-200 bg-white shadow-2xl"
            role="dialog"
            aria-label="Distributor detail"
          >
            <div className="flex items-start justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-gray-900">
                  {vendor?.name ?? (isLoading ? 'Loading…' : 'Distributor')}
                </h2>
                {vendor?.type != null && (
                  <p className="mt-0.5 text-xs text-gray-500">
                    {TYPE_LABEL[String(vendor.type)] ?? String(vendor.type)}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {isLoading && (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
                </div>
              )}

              {vendor && (
                <>
                  <Section title="Contact">
                    {vendor.phone && (
                      <Row icon={Phone}>
                        <a href={`tel:${vendor.phone}`} className="hover:text-wine-600">
                          {vendor.phone}
                        </a>
                      </Row>
                    )}
                    {vendor.email && (
                      <Row icon={Mail}>
                        <a href={`mailto:${vendor.email}`} className="hover:text-wine-600">
                          {vendor.email}
                        </a>
                      </Row>
                    )}
                    {vendor.website && (
                      <Row icon={Globe}>
                        <a
                          href={vendor.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all hover:text-wine-600"
                        >
                          {vendor.website}
                        </a>
                      </Row>
                    )}
                    {vendor.address && <Row icon={MapPin}>{vendor.address}</Row>}
                    {!vendor.phone && !vendor.email && !vendor.website && !vendor.address && (
                      <p className="text-sm text-gray-400">No contact details on file.</p>
                    )}
                  </Section>

                  <Section title="Where they can sell">
                    {vendor?.listing_tier === 'curated' && (
                      <span className="mb-3 inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-medium tracking-wide text-blue-700 uppercase" title="Details verified by WineOps AI">
                        <ShieldCheck className="h-3 w-3" />
                        Verified
                      </span>
                    )}
                    {vendor?.listing_tier === 'custom' && (
                      <span className="mb-3 inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-medium tracking-wide text-amber-700 uppercase" title="Custom provider added by you">
                        <ShieldCheck className="h-3 w-3" />
                        My Provider
                      </span>
                    )}
                    {territories.length === 0 && (
                      <p className="text-sm text-gray-400">No licence territory recorded.</p>
                    )}
                    {nationwide.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {nationwide.map((t) => (
                          <span
                            key={t.country}
                            className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"
                          >
                            <ShieldCheck className="h-3 w-3" />
                            {t.country} — nationwide
                          </span>
                        ))}
                      </div>
                    )}
                    {specific.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {specific.map((t) => (
                          <span
                            key={`${t.country}-${t.admin_area_code}`}
                            className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-gray-600"
                          >
                            {t.admin_area_code}
                          </span>
                        ))}
                      </div>
                    )}
                  </Section>

                  {locations.length > 0 && (
                    <Section title="Locations">
                      {locations.map((l) => (
                        <Row key={l.id} icon={Warehouse}>
                          <span className="capitalize">{l.kind}</span>
                          {(l.city || l.admin_area_code || l.address) && (
                            <span className="text-gray-500">
                              {' — '}
                              {l.city || l.admin_area_code
                                ? [l.city, l.admin_area_code].filter(Boolean).join(', ')
                                : l.address}
                            </span>
                          )}
                        </Row>
                      ))}
                    </Section>
                  )}

                  <Section title="Portfolio">
                    {facetGroups.length === 0 && vendor.wine_specialties && (
                      <p className="text-sm leading-relaxed text-gray-600">{vendor.wine_specialties}</p>
                    )}
                    {facetGroups.length === 0 && !vendor.wine_specialties && (
                      <p className="text-sm text-gray-400">No portfolio detail yet.</p>
                    )}
                    {facetGroups.map(([kind, options]) => (
                      <div key={kind} className="mb-2">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                          {kind.replace('_', ' ')}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {options.map((o) => (
                            <span
                              key={o.slug}
                              className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600"
                            >
                              {o.value}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </Section>

                  {(vendor.notes || vendor.data_confidence != null) && (
                    <Section title="Data quality">
                      {vendor.data_confidence != null && (
                        <Row icon={Info}>
                          Confidence {Math.round(Number(vendor.data_confidence) * 100)}%
                          {vendor.geocode_provider && (
                            <span className="text-gray-400"> · located via {vendor.geocode_provider}</span>
                          )}
                        </Row>
                      )}
                      {vendor.notes && (
                        <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{vendor.notes}</p>
                      )}
                    </Section>
                  )}
                </>
              )}
            </div>

            {vendor && !isCustom && (
              <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={adding}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-wine-600 py-3 text-sm font-semibold text-white transition hover:bg-wine-700 focus:outline-none focus:ring-2 focus:ring-wine-500 focus:ring-offset-2 disabled:opacity-70"
                >
                  {adding ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      Add to my providers
                    </>
                  )}
                </button>
                <p className="mt-3 text-center text-[11px] text-gray-500">
                  Adding a distributor creates a local copy for your team to annotate with account numbers and reps.
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
