import { useState, useMemo, useCallback, useEffect, useRef, lazy, Suspense } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Header } from '../components/layout/Header'
import {
  Search,
  Building2,
  MapPin,
  Phone,
  Mail,
  Globe,
  Users,
  X,
  Trash2,
  Truck,
  Compass,
  Plus,
  Star,
  ExternalLink,
  LayoutGrid,
  List,
  StickyNote,
  Clock,
  Heart,
  Edit,
  BookOpen,
} from 'lucide-react'
import { useProviders, useCreateProvider, useUpdateProvider, useDeleteProvider, useOrders } from '../hooks/queries'
import { useAuthStore } from '../stores'
import { useUserPreferences } from '../hooks/useUserPreferences'
import type { Provider } from '../services/api/providers'
import {
  fetchProviderContacts,
  addProviderContact,
  updateProviderContact,
  deleteProviderContact,
} from '../services/api/providers'
import { toast } from 'sonner'
import { AddProviderModal, NewProviderData } from '../components/providers/AddProviderModal'
import { EditProviderModal, EditProviderData } from '../components/providers/EditProviderModal'
import { VendorSearchModal } from '../components/providers/VendorSearchModal'
import { ProviderIntelligencePanel } from '../components/providers/ProviderIntelligencePanel'
import { PageSkeleton, ErrorState } from '../components/ui'
import { ExportMenu } from '../components/ui/ExportMenu'
import { exportTable, type TableExportColumn, type TableExportFormat } from '../lib/tableExport'
import { QuickGmailModal } from '../components/emails/QuickGmailModal'
import { ContextualInsights } from '../components/insights/ContextualInsights'
import { useRealtimeDispatch } from '../contexts/RealtimeContext'

type BusinessTypeFilter = 'All' | 'Distributor' | 'Importer' | 'Wholesaler'
type ViewMode = 'grid' | 'list' | 'compact'

interface ProviderNote {
  note: string
  updatedAt: string
}

// Sketch 008/009 winner A: dot-badge style — more compact and clean than icon badges
function TypeBadge({ type }: { type: string | undefined }) {
  const t = type?.toLowerCase()
  const cfg =
    t === 'distributor' ? { dot: 'bg-blue-500',    bg: 'bg-blue-50',    text: 'text-blue-700',    label: 'Distributor' } :
    t === 'importer'    ? { dot: 'bg-violet-500',  bg: 'bg-violet-50',  text: 'text-violet-700',  label: 'Importer'    } :
    t === 'wholesaler'  ? { dot: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Wholesaler'  } :
                          { dot: 'bg-gray-400',    bg: 'bg-gray-50',    text: 'text-gray-600',    label: type ?? '—'   }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}


function IntelBadge({ dimension }: { dimension: { key: string; label: string; value: string } }) {
  const cfg =
    dimension.key === 'response_speed'   ? { dot: 'bg-green-500', bg: 'bg-green-50', text: 'text-green-700' } :
    dimension.key === 'negotiation_style' ? { dot: 'bg-amber-500', bg: 'bg-amber-50', text: 'text-amber-700' } :
    dimension.key === 'relationship_tier' ? { dot: 'bg-rose-500',  bg: 'bg-rose-50',  text: 'text-rose-700'  } :
                                            { dot: 'bg-gray-400',  bg: 'bg-gray-50',  text: 'text-gray-600'  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      {dimension.label}: {dimension.value}
    </span>
  )
}

function getTopIntelDimensions(profileDynamic: Record<string, any>) {
  const priorityKeys = ['response_speed', 'negotiation_style', 'relationship_tier']
  return priorityKeys
    .filter((k) => profileDynamic[k])
    .map((k) => ({
      key: k,
      label: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      value: String(profileDynamic[k]).slice(0, 20),
    }))
    .slice(0, 3)
}

interface EmptyProvidersStateProps {
  onBrowseCatalogue: () => void
  onAddCustom: () => void
}

function EmptyProvidersState({ onBrowseCatalogue, onAddCustom }: EmptyProvidersStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
      <div className="relative mb-6">
        <div className="w-20 h-20 bg-wine-50 rounded-2xl flex items-center justify-center">
          <BookOpen className="w-10 h-10 text-wine-400" />
        </div>
        <div className="absolute -bottom-2 -right-2 w-9 h-9 bg-emerald-100 rounded-xl flex items-center justify-center border-2 border-white">
          <Truck className="w-4 h-4 text-emerald-600" />
        </div>
      </div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">No vendors yet</h2>
      <p className="text-gray-500 max-w-md mb-8 leading-relaxed">
        Add wine distributors and suppliers to enable ordering and track relationships.
        Start by browsing our curated catalogue of U.S. distributors, importers, and wholesalers.
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={onBrowseCatalogue}
          className="flex items-center gap-2 px-6 py-3 bg-wine-600 text-white font-medium rounded-xl hover:bg-wine-700 shadow-lg shadow-wine-600/25 transition-all"
        >
          <Search className="w-4 h-4" />
          Browse Vendor Catalogue
        </button>
        <button
          onClick={onAddCustom}
          className="flex items-center gap-2 px-6 py-3 bg-white text-gray-700 font-medium rounded-xl border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all"
        >
          <Plus className="w-4 h-4" />
          Add Custom Vendor
        </button>
      </div>
    </div>
  )
}

type ProvidersTab = 'mine' | 'discover'

// Loaded on demand — the map surface pulls in a tile renderer that the roster view
// has no use for, so it should not be in the Providers bundle.
const DistributorMapPage = lazy(
  () => import('./distributors/command/DistributorMapPage'),
)

/**
 * Segmented control between the vendor roster and distributor discovery.
 * Matches the tab pattern already used on Documents & Reports.
 */
function ProvidersTabs({
  tab,
  onChange,
  count,
}: {
  tab: ProvidersTab
  onChange: (t: ProvidersTab) => void
  count: number | null
}) {
  const item = (value: ProvidersTab, label: string, badge?: string) => (
    <button
      key={value}
      type="button"
      onClick={() => onChange(value)}
      aria-current={tab === value ? 'page' : undefined}
      className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 text-sm ${
        tab === value
          ? 'bg-wine-600 text-white shadow-sm'
          : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {value === 'mine' ? (
        <Truck className="w-4 h-4" />
      ) : (
        <Compass className="w-4 h-4" />
      )}
      {label}
      {badge && (
        <span
          className={`px-1.5 py-0.5 text-xs rounded-full ${
            tab === value ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  )

  return (
    <div className="flex bg-white rounded-xl border border-gray-200 p-1 w-fit">
      {item('mine', 'My Providers', count != null ? String(count) : undefined)}
      {item('discover', 'Find Distributors')}
    </div>
  )
}

export function Providers() {
  const restaurantId = useAuthStore(state => state.activeRestaurantId)
  const { preferences, updatePreferences } = useUserPreferences()
  const { data: rawOrders } = useOrders()
  const { dispatchProviderUpdate } = useRealtimeDispatch()
  const lastOrderDates = useMemo(() => {
    const dates: Record<string, string> = {}
    const orders = Array.isArray(rawOrders) ? rawOrders : (rawOrders as any)?.orders || []
    for (const o of orders) {
      const pid = o.providerId ?? o.provider_id
      const date = o.requestedAt ?? o.created_at
      if (pid && date) {
        if (!dates[pid] || new Date(date) > new Date(dates[pid])) dates[pid] = date
      }
    }
    return dates
  }, [rawOrders])

  const navigate = useNavigate()
  // Discovery lives here rather than in the sidebar: "who I buy from" and "who could
  // I buy from" are two views of one subject. Kept in the URL so it is linkable and
  // so the old /distributors route can redirect straight into it.
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: ProvidersTab =
    searchParams.get('tab') === 'discover' ? 'discover' : 'mine'
  const setTab = useCallback(
    (next: ProvidersTab) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          if (next === 'discover') p.set('tab', 'discover')
          else p.delete('tab')
          return p
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )
  const [searchQuery, setSearchQuery]               = useState('')
  const [businessTypeFilter, setBusinessTypeFilter] = useState<BusinessTypeFilter>('All')
  const [viewMode, setViewMode]                     = useState<ViewMode>('grid')
  const [selectedProvider, setSelectedProvider]     = useState<Provider | null>(null)
  const [showAddProviderModal, setShowAddProviderModal] = useState(false)
  const [showVendorSearch, setShowVendorSearch]     = useState(false)
  const [editingProvider, setEditingProvider]       = useState<Provider | null>(null)
  const [showEmailModal, setShowEmailModal]         = useState(false)
  const [emailRecipient, setEmailRecipient]         = useState('')
  const [showFavoritesOnly, setShowFavoritesOnly]   = useState(false)
  // §H additions: list sorting (NEW-313), rating-band filter (NEW-336),
  // right-click menu (NEW-310), `/`-focus search (NEW-326).
  const [sortKey, setSortKey]                       = useState<'default' | 'name' | 'type' | 'rating'>('default')
  const [sortDir, setSortDir]                       = useState<'asc' | 'desc'>('asc')
  const [ratingBand, setRatingBand]                 = useState<'all' | '4' | '3' | 'unrated'>('all')
  const [providerMenu, setProviderMenu]             = useState<{ id: string; x: number; y: number } | null>(null)
  const searchRef                                   = useRef<HTMLInputElement>(null)
  const favorites: string[]                          = preferences.providerFavorites ?? []
  const notes: Record<string, ProviderNote>          = (preferences.providerNotes ?? {}) as Record<string, ProviderNote>

  // Local ratings state — updates immediately for snappy UI. Syncs to remote
  // preferences async. The useEffect seeds from server data on first load /
  // hard refresh but never overwrites in-session changes.
  const [ratings, setLocalRatings] = useState<Record<string, number>>(
    () => (preferences.providerRatings ?? {}) as Record<string, number>,
  )
  useEffect(() => {
    const serverRatings = (preferences.providerRatings ?? {}) as Record<string, number>
    // Only seed local state when it is still empty (fresh mount / hard refresh)
    setLocalRatings(prev => {
      if (Object.keys(prev).length === 0 && Object.keys(serverRatings).length > 0) {
        return serverRatings
      }
      // Merge server ratings in for any provider the local state hasn't touched
      return { ...serverRatings, ...prev }
    })
  }, [preferences.providerRatings])

  const setFavorites = useCallback((updater: (prev: string[]) => string[]) => {
    updatePreferences({ providerFavorites: updater(favorites) })
  }, [favorites, updatePreferences])

  const setNotes = useCallback((updater: (prev: Record<string, ProviderNote>) => Record<string, ProviderNote>) => {
    updatePreferences({ providerNotes: updater(notes) })
  }, [notes, updatePreferences])

  const setRatings = useCallback((updater: (prev: Record<string, number>) => Record<string, number>) => {
    setLocalRatings(prev => {
      const next = updater(prev)
      // Persist async — never block the UI on this
      updatePreferences({ providerRatings: next })
      return next
    })
  }, [updatePreferences])

  const { data: providers = [], isLoading, isFetching, error, refetch } = useProviders(restaurantId || '', {
    search: searchQuery,
    category: businessTypeFilter === 'All' ? undefined : businessTypeFilter,
  })

  const createProvider         = useCreateProvider()
  const updateProvider         = useUpdateProvider()
  const deleteProviderMutation = useDeleteProvider()

  const handleRemoveProvider = async () => {
    if (!selectedProvider) return
    if (!confirm(`Remove provider "${selectedProvider.name}"?`)) return
    try {
      await deleteProviderMutation.mutateAsync(selectedProvider.id)
      setFavorites(prev => prev.filter(id => id !== selectedProvider.id))
      setNotes(prev => { const { [selectedProvider.id]: _r, ...rest } = prev; return rest })
      setRatings(prev => { const { [selectedProvider.id]: _r, ...rest } = prev; return rest })
      await dispatchProviderUpdate({ type: 'removed', providerId: selectedProvider.id, providerName: selectedProvider.name, source: 'providers_page', timestamp: new Date().toISOString() })
      setSelectedProvider(null)
    } catch (err) {
      console.error('Failed to remove provider:', err)
      alert('Failed to remove provider. Please try again.')
    }
  }

  const handleEditProvider = async (data: EditProviderData) => {
    const isFakeContactId = (id: string) =>
      id.startsWith('new-') ||
      id.startsWith('admin-') ||
      id.startsWith('primary-') ||
      id.startsWith('personnel-')

    // ── Step 1: save provider fields ──────────────────────────────────────
    try {
      await updateProvider.mutateAsync({
        id: data.id,
        name: data.name,
        phone: data.phone,
        email: data.email,
        contactFirstName: data.contactFirstName,
        contactLastName: data.contactLastName,
        website: data.website,
        physicalAddress: data.address,
        primaryBusinessType: data.primaryBusinessType as any,
        winePortfolio: data.specialties.join(', '),
        statesOrRegionsServed: data.deliveryDays,
        notes: data.notes,
        rating: data.rating > 0 ? data.rating : undefined,
        knownPersonnel: data.contacts
          .filter(c => !c.isPrimary)
          .map(c => `${c.firstName} ${c.lastName}`.trim())
          .filter(Boolean),
        restaurantId: restaurantId || '',
        paymentTerms: data.paymentTerms,
        minimumOrderValue: data.minimumOrder ?? undefined,
      } as any)
    } catch (err) {
      console.error('Failed to update provider:', err)
      toast.error('Failed to save provider. Please try again.')
      return
    }

    // Provider fields saved — close the modal immediately
    if (data.rating > 0) setRatings(prev => ({ ...prev, [data.id]: data.rating }))
    setEditingProvider(null)

    // ── Step 2: sync provider_contacts (decoupled — never blocks the save) ─
    const providerId = data.id
    try {
      const existingDbContacts = await fetchProviderContacts(providerId)
      const existingDbIds = new Set(existingDbContacts.map(c => c.id))
      const currentRealIds = new Set(
        data.contacts.filter(c => !isFakeContactId(c.id)).map(c => c.id)
      )

      // Delete contacts the user removed (parallel)
      await Promise.all(
        existingDbContacts
          .filter(c => !currentRealIds.has(c.id))
          .map(c => deleteProviderContact(providerId, c.id))
      )

      // Create new contacts or update existing ones (parallel)
      await Promise.all(
        data.contacts.map(contact => {
          const name = `${contact.firstName} ${contact.lastName}`.trim() || 'Contact'
          const payload = {
            name,
            email: contact.email || '',
            phone: contact.phone || '',
            role: contact.role || 'Sales Rep',
            isPrimary: contact.isPrimary,
          }
          if (isFakeContactId(contact.id) || !existingDbIds.has(contact.id)) {
            return addProviderContact(providerId, payload)
          }
          return updateProviderContact(providerId, contact.id, payload)
        })
      )

      if (data.contacts.length > 0) {
        toast.success('Provider and contacts saved')
      } else {
        toast.success('Provider saved')
      }
    } catch (err: any) {
      console.error('Contact sync failed:', err)
      const reason = err?.response?.status === 401
        ? 'Session expired — please refresh the page'
        : err?.response?.status === 404
          ? 'Contact API not available — please redeploy the backend'
          : 'Unknown error'
      toast.warning(`Provider saved, but contacts could not be synced. ${reason}`)
    }
  }

  const handleOpenEmail = (email: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setEmailRecipient(email)
    setShowEmailModal(true)
  }

  const handleAddProvider = async (providerData: NewProviderData) => {
    if (!restaurantId) { alert('Error: No restaurant ID found. Please log in again.'); return }
    try {
      const result = await createProvider.mutateAsync({
        name: providerData.name,
        primaryBusinessType: (providerData.primaryBusinessType as 'Distributor' | 'Importer' | 'Wholesaler') || 'Distributor',
        phone: providerData.phone, email: providerData.email,
        physicalAddress: providerData.address, restaurantId,
        contactPerson: providerData.contactPerson, website: providerData.website,
        accountNumber: providerData.accountNumber,
        winePortfolio: providerData.specialties.join(', '),
        statesOrRegionsServed: providerData.deliveryDays,
        paymentTerms: providerData.paymentTerms,
        minimumOrderValue: providerData.minimumOrder ?? undefined,
        deliverySchedule: providerData.deliveryDays.join(', '),
        notes: `Specialties: ${providerData.specialties.join(', ')}`,
      })
      if (providerData.rating > 0 && result?.id) setRatings(prev => ({ ...prev, [result.id]: providerData.rating }))
      await dispatchProviderUpdate({
        type: 'added', providerId: result?.id ?? '', providerName: providerData.name,
        data: { contactPerson: providerData.contactPerson, email: providerData.email, phone: providerData.phone, businessType: providerData.primaryBusinessType, specialties: providerData.specialties },
        source: 'providers_page', timestamp: new Date().toISOString(),
      })
    } catch (err) {
      console.error('Failed to add provider:', err)
      alert('Failed to add provider. Please try again.')
    }
  }

  const filteredProviders = useMemo(() => {
    let filtered = [...providers]
    if (showFavoritesOnly) filtered = filtered.filter(p => favorites.includes(p.id))
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.winePortfolio.toLowerCase().includes(q) ||
        p.physicalAddress.toLowerCase().includes(q) ||
        p.statesOrRegionsServed?.some(s => s.toLowerCase().includes(q))
      )
    }
    if (businessTypeFilter !== 'All') {
      filtered = filtered.filter(p => p.primaryBusinessType === businessTypeFilter)
    }
    // NEW-336: rating-band filter (4+ / 3+ / unrated).
    if (ratingBand !== 'all') {
      filtered = filtered.filter(p => {
        const r = ratings[p.id] || 0
        if (ratingBand === 'unrated') return r === 0
        return r >= Number(ratingBand)
      })
    }
    // NEW-313: explicit column sort in list view; favorites still float first
    // in the default ordering so the pinned strip stays coherent.
    const dir = sortDir === 'asc' ? 1 : -1
    return filtered.sort((a, b) => {
      if (sortKey === 'name') return dir * a.name.localeCompare(b.name)
      if (sortKey === 'type') return dir * (a.primaryBusinessType || '').localeCompare(b.primaryBusinessType || '')
      if (sortKey === 'rating') return dir * ((ratings[a.id] || 0) - (ratings[b.id] || 0))
      const aFav = favorites.includes(a.id) ? 1 : 0
      const bFav = favorites.includes(b.id) ? 1 : 0
      if (aFav !== bFav) return bFav - aFav
      const aR = ratings[a.id] || 0, bR = ratings[b.id] || 0
      if (aR !== bR) return bR - aR
      return a.name.localeCompare(b.name)
    })
  }, [providers, searchQuery, businessTypeFilter, showFavoritesOnly, favorites, ratings, ratingBand, sortKey, sortDir])

  const favoriteProviders = useMemo(() =>
    providers.filter(p => favorites.includes(p.id)),
    [providers, favorites]
  )

  const toggleFavorite = useCallback((providerId: string) => {
    setFavorites(prev => prev.includes(providerId) ? prev.filter(id => id !== providerId) : [...prev, providerId])
  }, [setFavorites])

  const setProviderRating = useCallback((providerId: string, rating: number) => {
    setRatings(prev => ({ ...prev, [providerId]: rating }))
  }, [setRatings])

  const clearFilters = () => { setSearchQuery(''); setBusinessTypeFilter('All'); setShowFavoritesOnly(false); setRatingBand('all') }

  /** NEW-313: click a list column header to sort; click again to flip direction. */
  const applyProviderSort = useCallback((key: 'name' | 'type' | 'rating') => {
    setSortKey(prev => {
      if (prev === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
      else setSortDir(key === 'rating' ? 'desc' : 'asc')
      return key
    })
  }, [])

  /** NEW-334: export the provider directory (filtered set) in the shared formats. */
  const exportProviders = useCallback(
    async (format: TableExportFormat) => {
      const columns: TableExportColumn<(typeof filteredProviders)[number]>[] = [
        { header: 'Name', value: (p) => p.name },
        { header: 'Type', value: (p) => p.primaryBusinessType ?? '' },
        { header: 'Portfolio', value: (p) => p.winePortfolio ?? '' },
        { header: 'Address', value: (p) => p.physicalAddress ?? '' },
        { header: 'Phone', value: (p) => p.phone ?? '' },
        { header: 'Email', value: (p) => p.email ?? '' },
        { header: 'Website', value: (p) => p.website ?? '' },
        { header: 'Regions', value: (p) => (p.statesOrRegionsServed ?? []).join('; ') },
        { header: 'Rating', value: (p) => ratings[p.id] || '' },
        { header: 'Favorite', value: (p) => (favorites.includes(p.id) ? 'yes' : 'no') },
      ]
      try {
        await exportTable({
          format,
          rows: filteredProviders,
          columns,
          filename: `providers-${new Date().toISOString().slice(0, 10)}`,
          title: 'Providers',
        })
        toast.success(
          format === 'clipboard'
            ? `Copied ${filteredProviders.length} providers`
            : format === 'print'
              ? 'Opening print view'
              : `Exported ${filteredProviders.length} providers`,
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Export failed')
      }
    },
    [filteredProviders, ratings, favorites],
  )

  // ── Keyboard shortcuts (NEW-326) ──────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (selectedProvider || editingProvider || showAddProviderModal || showVendorSearch || showEmailModal) return
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus() }
      else if (e.key === 'n') { e.preventDefault(); setShowAddProviderModal(true) }
      else if (e.key === 'f') setShowFavoritesOnly(s => !s)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedProvider, editingProvider, showAddProviderModal, showVendorSearch, showEmailModal])

  // Close the right-click menu on any outside click.
  useEffect(() => {
    if (!providerMenu) return
    const close = () => setProviderMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [providerMenu])

  // Discovery deliberately sits above the provider-list loading and error gates:
  // having no providers yet — or a roster that failed to load — is exactly when you
  // want to go find some. Making it wait on that data would be backwards.
  if (tab === 'discover') {
    return (
      <div className="min-h-screen">
        <Header
          title="Wine Providers"
          subtitle="Find distributors that can legally supply your restaurant, nearest first"
        />
        <div className="px-6 pt-6">
          <ProvidersTabs
            tab={tab}
            onChange={setTab}
            count={providers.length || null}
          />
        </div>
        {/* The map page keeps its own "Find distributors" heading, which reads as the
            section title under the page title rather than a competing one. Left alone
            deliberately so this tab needs no changes inside the distributor surface. */}
        <Suspense fallback={<div className="px-6 pt-6"><PageSkeleton /></div>}>
          <DistributorMapPage />
        </Suspense>
      </div>
    )
  }

  // Only show full-page skeleton on the very first load (no cached data at all).
  // For re-mounts / SPA navigations with stale cache, placeholderData keeps prior
  // results visible while the background refetch runs, so isLoading stays false.
  if (!restaurantId || isLoading) {
    return (
      <div className="min-h-screen">
        <Header title="Wine Providers" subtitle="Manage your supplier relationships" />
        <div className="p-6"><PageSkeleton /></div>
      </div>
    )
  }

  if (error && !providers.length) {
    return (
      <div className="min-h-screen">
        <Header title="Wine Providers" subtitle="Manage your supplier relationships" />
        <div className="p-6">
          <ErrorState variant="network" title="Unable to load providers"
            description="The backend API is not available. This page will work once the backend is connected."
            action={{ label: 'Retry', onClick: () => refetch() }} />
        </div>
      </div>
    )
  }

  const hasActiveFilters = !!(searchQuery || businessTypeFilter !== 'All' || showFavoritesOnly)

  return (
    <div className="min-h-screen">
      <Header
        title="Wine Providers"
        subtitle={providers.length > 0
          ? `${providers.length} verified U.S.-based distributors, importers, and wholesalers${isFetching ? ' · Refreshing…' : ''}`
          : 'Manage your supplier relationships'}
      />

      <div className="p-6">

        <div className="mb-5">
          <ProvidersTabs
            tab={tab}
            onChange={setTab}
            count={providers.length || null}
          />
        </div>

        {/* ── Empty state ── */}
        {providers.length === 0 && !isLoading && (
          <EmptyProvidersState
            onBrowseCatalogue={() => setShowVendorSearch(true)}
            onAddCustom={() => setShowAddProviderModal(true)}
          />
        )}

        {providers.length > 0 && (
          <>
            {/* engine insights in context (NEW-748) */}
            <ContextualInsights host="providers" defaultOpen={false} className="mb-4" />

            {/* ════════════════════════════════════════
                TOOLBAR  (sketch 008-A: two-row layout)
            ════════════════════════════════════════ */}
            <div className="space-y-2.5 mb-5">

              {/* Row 1: search + CTA */}
              <div className="flex gap-2.5">
                <div className="flex-1 relative" data-tour="providers-search">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <input
                    ref={searchRef}
                    type="text"
                    placeholder="Search providers, portfolios, regions…    ( / )"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-9 py-2.5 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500/20 focus:border-wine-400 outline-none transition-all text-sm placeholder:text-gray-400"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 rounded-md transition-colors"
                    >
                      <X className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                  )}
                </div>
                <button
                  onClick={() => setShowVendorSearch(true)}
                  data-tour="providers-add"
                  className="px-4 py-2.5 bg-wine-600 text-white font-semibold rounded-xl hover:bg-wine-700 active:scale-[0.98] shadow-sm shadow-wine-600/30 transition-all flex items-center gap-1.5 whitespace-nowrap text-sm"
                >
                  <Plus className="w-4 h-4" />
                  Add Vendor
                </button>
              </div>

              {/* Row 2: filter chips + view toggle */}
              <div className="flex items-center justify-between gap-3" data-tour="providers-filters">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(['All', 'Distributor', 'Importer', 'Wholesaler'] as BusinessTypeFilter[]).map(type => (
                    <button
                      key={type}
                      onClick={() => setBusinessTypeFilter(type)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                        businessTypeFilter === type
                          ? 'bg-wine-600 text-white shadow-sm'
                          : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 hover:text-gray-800'
                      }`}
                    >
                      {type}
                    </button>
                  ))}

                  <div className="w-px h-4 bg-gray-200 mx-0.5" />

                  <button
                    onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all flex items-center gap-1 ${
                      showFavoritesOnly
                        ? 'bg-red-50 text-red-700 border border-red-200'
                        : 'bg-white text-gray-600 border border-gray-200 hover:border-red-200 hover:text-red-600'
                    }`}
                  >
                    <Heart className={`w-3 h-3 ${showFavoritesOnly ? 'fill-red-500 text-red-500' : ''}`} />
                    Favorites
                    {favorites.length > 0 && (
                      <span className={`px-1.5 rounded-full font-medium ${showFavoritesOnly ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                        {favorites.length}
                      </span>
                    )}
                  </button>

                  <div className="w-px h-4 bg-gray-200 mx-0.5" />

                  {/* Rating-band filter (NEW-336) */}
                  {([
                    { key: '4' as const, label: '4★+' },
                    { key: '3' as const, label: '3★+' },
                    { key: 'unrated' as const, label: 'Unrated' },
                  ]).map(band => (
                    <button
                      key={band.key}
                      onClick={() => setRatingBand(ratingBand === band.key ? 'all' : band.key)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                        ratingBand === band.key
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'bg-white text-gray-600 border border-gray-200 hover:border-amber-200 hover:text-amber-600'
                      }`}
                    >
                      {band.label}
                    </button>
                  ))}

                  <div className="w-px h-4 bg-gray-200 mx-0.5" />

                  {/* Export directory (NEW-334) */}
                  <ExportMenu
                    variant="ghost"
                    size="sm"
                    label="Export"
                    count={filteredProviders.length}
                    onExport={exportProviders}
                    title="Export the filtered provider directory"
                    triggerClassName="rounded-full px-3 py-1.5 h-auto"
                  />
                </div>

                {/* View mode toggle */}
                <div className="flex bg-gray-100 rounded-lg p-0.5 flex-shrink-0">
                  {([
                    { mode: 'grid' as ViewMode,    Icon: LayoutGrid, title: 'Grid'    },
                    { mode: 'compact' as ViewMode, Icon: Building2,  title: 'Compact' },
                    { mode: 'list' as ViewMode,    Icon: List,       title: 'List'    },
                  ]).map(({ mode, Icon, title }) => (
                    <button
                      key={mode}
                      onClick={() => setViewMode(mode)}
                      title={title}
                      className={`p-1.5 rounded-md transition-all ${
                        viewMode === mode
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-400 hover:text-gray-600'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Results bar ── */}
            <div className="flex items-center justify-between mb-5 h-5">
              <p className="text-sm text-gray-500">
                {hasActiveFilters ? (
                  <><span className="font-medium text-gray-900">{filteredProviders.length}</span>{' of '}<span className="font-medium text-gray-900">{providers.length}</span>{' providers'}</>
                ) : (
                  <><span className="font-medium text-gray-900">{providers.length}</span>{' providers'}</>
                )}
              </p>
              {hasActiveFilters && (
                <button onClick={clearFilters} className="text-xs text-wine-600 hover:text-wine-700 font-medium flex items-center gap-1 transition-colors">
                  <X className="w-3 h-3" />
                  Clear filters
                </button>
              )}
            </div>

            {/* ════════════════════════════════════════
                PINNED STRIP  (sketch 008-A)
                White cards, wine-tinted border — no gradient
            ════════════════════════════════════════ */}
            {favoriteProviders.length > 0 && !showFavoritesOnly && (
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <Heart className="w-3.5 h-3.5 text-red-500 fill-red-500" />
                  <span className="text-sm font-semibold text-gray-700">Pinned</span>
                  <span className="text-xs text-gray-400">— your go-to vendors</span>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
                  {favoriteProviders.map(provider => (
                    <motion.div
                      key={`pin-${provider.id}`}
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex-shrink-0 w-52 bg-white rounded-[14px] border p-3.5 cursor-pointer transition-all hover:-translate-y-0.5"
                      style={{ borderColor: '#f0e0e3', boxShadow: '0 1px 4px rgba(124,29,47,0.06)' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 18px rgba(0,0,0,0.09)'; (e.currentTarget as HTMLElement).style.borderColor = '#e8c8cc' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 4px rgba(124,29,47,0.06)'; (e.currentTarget as HTMLElement).style.borderColor = '#f0e0e3' }}
                      onClick={() => setSelectedProvider(provider)}
                      onContextMenu={e => { e.preventDefault(); setProviderMenu({ id: provider.id, x: e.clientX, y: e.clientY }) }}
                    >
                      <div className="flex items-start justify-between mb-1.5">
                        <h3 className="font-semibold text-gray-900 text-xs leading-snug line-clamp-2 flex-1 mr-2">{provider.name}</h3>
                        <button
                          onClick={e => { e.stopPropagation(); toggleFavorite(provider.id) }}
                          className="p-0.5 flex-shrink-0 hover:scale-110 transition-transform"
                        >
                          <Heart className="w-3.5 h-3.5 text-red-500 fill-red-500" />
                        </button>
                      </div>
                      <div className="mb-2"><TypeBadge type={provider.primaryBusinessType} /></div>
                      {ratings[provider.id] ? (
                        <div className="flex items-center gap-0.5 mb-2.5">
                          {[1, 2, 3, 4, 5].map(star => (
                            <Star key={star} className={`w-3 h-3 ${star <= ratings[provider.id] ? 'text-amber-500 fill-amber-500' : 'text-gray-200'}`} />
                          ))}
                        </div>
                      ) : <div className="mb-2.5" />}
                      <div className="flex items-center gap-1.5">
                        {provider.phone !== 'N/A' && (
                          <a href={`tel:${provider.phone}`} onClick={e => e.stopPropagation()}
                            className="w-7 h-7 flex items-center justify-center bg-gray-50 border border-gray-100 rounded-lg hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 text-gray-500 transition-all"
                            title="Call">
                            <Phone className="w-3 h-3" />
                          </a>
                        )}
                        {provider.email !== 'N/A' && (
                          <button onClick={e => handleOpenEmail(provider.email, e)}
                            className="w-7 h-7 flex items-center justify-center bg-gray-50 border border-gray-100 rounded-lg hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 text-gray-500 transition-all"
                            title="Email">
                            <Mail className="w-3 h-3" />
                          </button>
                        )}
                        <button onClick={e => { e.stopPropagation(); setEditingProvider(provider) }}
                          className="w-7 h-7 flex items-center justify-center bg-gray-50 border border-gray-100 rounded-lg hover:bg-amber-50 hover:border-amber-200 hover:text-amber-700 text-gray-500 transition-all"
                          title="Edit">
                          <Edit className="w-3 h-3" />
                        </button>
                        {provider.website !== 'N/A' && (
                          <a href={provider.website} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                            className="w-7 h-7 flex items-center justify-center bg-gray-50 border border-gray-100 rounded-lg hover:bg-violet-50 hover:border-violet-200 hover:text-violet-700 text-gray-500 transition-all"
                            title="Website">
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                      {lastOrderDates[provider.id] && (
                        <div className="flex items-center gap-1 mt-2.5 text-xs text-gray-400">
                          <Clock className="w-3 h-3" />
                          {new Date(lastOrderDates[provider.id]).toLocaleDateString()}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* ── No results ── */}
            {filteredProviders.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center mb-4">
                  <Search className="w-7 h-7 text-gray-300" />
                </div>
                <h3 className="text-sm font-semibold text-gray-800 mb-1">No providers found</h3>
                <p className="text-sm text-gray-400 mb-4">
                  {searchQuery ? `No matches for "${searchQuery}"` : 'Try adjusting your filters'}
                </p>
                <button onClick={clearFilters} className="text-sm text-wine-600 hover:text-wine-700 font-medium transition-colors">
                  Clear all filters
                </button>
              </div>
            )}

            {/* ════════════════════════════════════════
                GRID VIEW  (sketch 008-A + 009-A)
                Action-first cards, dot badges, red hearts
            ════════════════════════════════════════ */}
            {filteredProviders.length > 0 && viewMode === 'grid' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-tour="providers-list">
                {filteredProviders.map((provider, index) => {
                  const isFav = favorites.includes(provider.id)
                  return (
                    <motion.div
                      key={provider.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03, type: 'spring', stiffness: 320, damping: 26 }}
                      onClick={() => setSelectedProvider(provider)}
                      onContextMenu={e => { e.preventDefault(); setProviderMenu({ id: provider.id, x: e.clientX, y: e.clientY }) }}
                      className="bg-white rounded-[18px] border p-[18px] cursor-pointer transition-all group"
                      style={{
                        borderColor: isFav ? '#f0e0e3' : '#ebebed',
                        boxShadow: isFav ? '0 0 0 1px #f0e0e3' : 'none',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 28px rgba(0,0,0,0.07)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.borderColor = '#e0e2e6' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = isFav ? '0 0 0 1px #f0e0e3' : 'none'; (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLElement).style.borderColor = isFav ? '#f0e0e3' : '#ebebed' }}
                    >
                      {/* Header row */}
                      <div className="flex items-start justify-between mb-2.5">
                        <div className="flex-1 min-w-0 pr-2">
                          <h3 className="font-semibold text-[13.5px] text-gray-900 leading-snug line-clamp-1 tracking-[-0.1px]">{provider.name}</h3>
                          <div className="mt-1.5"><TypeBadge type={provider.primaryBusinessType} /></div>
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); toggleFavorite(provider.id) }}
                          className="p-1 flex-shrink-0 hover:scale-110 active:scale-95 transition-transform"
                        >
                          <Heart className={`w-4 h-4 transition-colors ${isFav ? 'text-red-500 fill-red-500' : 'text-gray-200 group-hover:text-gray-300'}`} />
                        </button>
                      </div>

                      {/* Intel badges — dynamic profile */}
                      {provider.profile_dynamic && Object.keys(provider.profile_dynamic).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1.5 mb-1">
                          {getTopIntelDimensions(provider.profile_dynamic).map((dim) => (
                            <IntelBadge key={dim.key} dimension={dim} />
                          ))}
                        </div>
                      )}

                      {/* Star rating — interactive */}
                      <div className="flex items-center gap-0.5 mb-2.5">
                        {[1, 2, 3, 4, 5].map(star => (
                          <button
                            key={star}
                            onClick={e => { e.stopPropagation(); setProviderRating(provider.id, star) }}
                            className="p-0.5 hover:scale-110 active:scale-95 transition-transform"
                          >
                            <Star className={`w-3.5 h-3.5 ${star <= (ratings[provider.id] || 0) ? 'text-amber-500 fill-amber-500' : 'text-gray-200 hover:text-amber-300'}`} />
                          </button>
                        ))}
                      </div>

                      {/* Portfolio snippet */}
                      <p className="text-xs text-gray-500 mb-3 line-clamp-2 leading-relaxed">{provider.winePortfolio}</p>

                      {/* Action chips — sketch 009-A: always visible, hero of the card */}
                      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                        {provider.phone !== 'N/A' && (
                          <a href={`tel:${provider.phone}`} onClick={e => e.stopPropagation()}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 active:bg-emerald-200 transition-colors text-xs font-semibold">
                            <Phone className="w-3 h-3" /> Call
                          </a>
                        )}
                        {provider.email !== 'N/A' && (
                          <button onClick={e => handleOpenEmail(provider.email, e)}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 active:bg-blue-200 transition-colors text-xs font-semibold">
                            <Mail className="w-3 h-3" /> Email
                          </button>
                        )}
                        {provider.website !== 'N/A' && (
                          <a href={provider.website} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-violet-50 text-violet-700 rounded-lg hover:bg-violet-100 active:bg-violet-200 transition-colors text-xs font-semibold">
                            <Globe className="w-3 h-3" /> Web
                          </a>
                        )}
                      </div>

                      {/* Footer */}
                      <div className="pt-2.5 border-t border-gray-50 flex items-center justify-between">
                        <div className="flex items-center gap-1 min-w-0 text-xs text-gray-400">
                          <MapPin className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{provider.physicalAddress}</span>
                        </div>
                        <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                          {lastOrderDates[provider.id] && (
                            <span className="flex items-center gap-1 text-xs text-emerald-600">
                              <Clock className="w-3 h-3" />
                              {new Date(lastOrderDates[provider.id]).toLocaleDateString()}
                            </span>
                          )}
                          {notes[provider.id]?.note && (
                            <span title={notes[provider.id].note}>
                              <StickyNote className="w-3 h-3 text-amber-400" />
                            </span>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}

            {/* ── Compact view ── */}
            {filteredProviders.length > 0 && viewMode === 'compact' && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2" data-tour="providers-list">
                {filteredProviders.map((provider, index) => {
                  const isFav = favorites.includes(provider.id)
                  return (
                    <motion.div
                      key={provider.id}
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: index * 0.015 }}
                      onClick={() => setSelectedProvider(provider)}
                      onContextMenu={e => { e.preventDefault(); setProviderMenu({ id: provider.id, x: e.clientX, y: e.clientY }) }}
                      className={`bg-white rounded-xl border p-3 hover:shadow-md transition-all cursor-pointer group ${
                        isFav ? 'border-[#f0e0e3]' : 'border-gray-100 hover:border-gray-200'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-1.5">
                        <h3 className="font-medium text-gray-900 text-xs leading-snug line-clamp-2 flex-1 group-hover:text-wine-700 transition-colors">{provider.name}</h3>
                        <button onClick={e => { e.stopPropagation(); toggleFavorite(provider.id) }} className="p-0.5 ml-1 flex-shrink-0">
                          <Heart className={`w-3 h-3 ${isFav ? 'text-red-500 fill-red-500' : 'text-gray-200'}`} />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <TypeBadge type={provider.primaryBusinessType} />
                        {ratings[provider.id] ? (
                          <div className="flex items-center gap-0.5">
                            <Star className="w-2.5 h-2.5 text-amber-500 fill-amber-500" />
                            <span className="text-xs text-gray-500">{ratings[provider.id]}</span>
                          </div>
                        ) : null}
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}

            {/* ── List view ── */}
            {filteredProviders.length > 0 && viewMode === 'list' && (
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden" data-tour="providers-list">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px]">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50/60">
                        {/* NEW-313: sortable columns (name / type / rating) */}
                        {([
                          { key: 'name' as const, label: 'Provider', cls: '' },
                          { key: 'type' as const, label: 'Type', cls: 'w-36' },
                        ]).map(col => (
                          <th key={col.key} className={`px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide ${col.cls}`}>
                            <button
                              onClick={() => applyProviderSort(col.key)}
                              className={`flex items-center gap-1 uppercase tracking-wide ${sortKey === col.key ? 'text-wine-700' : 'text-gray-400 hover:text-gray-600'}`}
                            >
                              {col.label}
                              {sortKey === col.key && <span aria-hidden>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                            </button>
                          </th>
                        ))}
                        <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Portfolio</th>
                        <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide w-32">Contact</th>
                        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide w-28">
                          <button
                            onClick={() => applyProviderSort('rating')}
                            className={`flex items-center gap-1 uppercase tracking-wide ${sortKey === 'rating' ? 'text-wine-700' : 'text-gray-400 hover:text-gray-600'}`}
                          >
                            Rating
                            {sortKey === 'rating' && <span aria-hidden>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filteredProviders.map(provider => {
                        const isFav = favorites.includes(provider.id)
                        return (
                          <tr
                            key={provider.id}
                            onClick={() => setSelectedProvider(provider)}
                      onContextMenu={e => { e.preventDefault(); setProviderMenu({ id: provider.id, x: e.clientX, y: e.clientY }) }}
                            className="hover:bg-gray-50/40 cursor-pointer transition-colors group"
                          >
                            <td className="px-4 py-3 w-56">
                              <div className="flex items-center gap-2">
                                <button onClick={e => { e.stopPropagation(); toggleFavorite(provider.id) }} className="flex-shrink-0">
                                  <Heart className={`w-3.5 h-3.5 ${isFav ? 'text-red-500 fill-red-500' : 'text-gray-200 group-hover:text-gray-300'}`} />
                                </button>
                                <div className="min-w-0">
                                  <p className="font-medium text-gray-900 text-sm group-hover:text-wine-700 transition-colors truncate">{provider.name}</p>
                                  {provider.physicalAddress !== 'N/A' && (
                                    <p className="text-xs text-gray-400 mt-0.5 truncate">{provider.physicalAddress}</p>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <TypeBadge type={provider.primaryBusinessType} />
                            </td>
                            <td className="px-4 py-3 max-w-xs">
                              <p className="text-xs text-gray-500 line-clamp-2">{provider.winePortfolio}</p>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5">
                                {provider.phone !== 'N/A' && (
                                  <a href={`tel:${provider.phone}`} onClick={e => e.stopPropagation()}
                                    className="w-7 h-7 flex items-center justify-center bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors text-emerald-600"
                                    title={provider.phone}>
                                    <Phone className="w-3 h-3" />
                                  </a>
                                )}
                                {provider.email !== 'N/A' && (
                                  <button onClick={e => handleOpenEmail(provider.email, e)}
                                    className="w-7 h-7 flex items-center justify-center bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors text-blue-600"
                                    title={provider.email}>
                                    <Mail className="w-3 h-3" />
                                  </button>
                                )}
                                {provider.website !== 'N/A' && (
                                  <a href={provider.website} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                                    className="w-7 h-7 flex items-center justify-center bg-violet-50 rounded-lg hover:bg-violet-100 transition-colors text-violet-600">
                                    <Globe className="w-3 h-3" />
                                  </a>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-0.5">
                                {[1, 2, 3, 4, 5].map(star => (
                                  <button key={star} onClick={e => { e.stopPropagation(); setProviderRating(provider.id, star) }}
                                    className="p-0.5 hover:scale-110 transition-transform">
                                    <Star className={`w-3 h-3 ${star <= (ratings[provider.id] || 0) ? 'text-amber-500 fill-amber-500' : 'text-gray-200 hover:text-amber-300'}`} />
                                  </button>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ════════════════════════════════════════
                DETAIL MODAL  (sketch 010-A: centered sheet)
                Spring scale-in, prominent green Call CTA in header
            ════════════════════════════════════════ */}
            <AnimatePresence>
              {selectedProvider && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="fixed inset-0 bg-black/40 backdrop-blur-[4px] z-50 flex items-center justify-center p-4"
                  onClick={() => setSelectedProvider(null)}
                >
                  <motion.div
                    initial={{ opacity: 0, scale: 0.96, y: 12 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96, y: 12 }}
                    transition={{ type: 'spring', stiffness: 340, damping: 28 }}
                    onClick={e => e.stopPropagation()}
                    className="bg-white rounded-[28px] shadow-2xl w-full max-w-[640px] max-h-[88vh] overflow-hidden flex flex-col"
                    style={{ boxShadow: '0 24px 60px rgba(0,0,0,0.18)' }}
                  >
                    {/* Modal header — gradient bg, prominent CTAs */}
                    <div
                      className="px-6 pt-5 border-b border-gray-100 flex-shrink-0"
                      style={{ background: 'linear-gradient(to bottom, #f9fafb, #fff)' }}
                    >
                      {/* Name + type + icon actions */}
                      <div className="flex items-start justify-between mb-3.5">
                        <div>
                          <h2 className="text-[18px] font-bold text-gray-900 leading-tight tracking-[-0.3px]">{selectedProvider.name}</h2>
                          <div className="flex items-center gap-2 mt-1.5">
                            <TypeBadge type={selectedProvider.primaryBusinessType} />
                            {ratings[selectedProvider.id] ? (
                              <div className="flex items-center gap-0.5">
                                {[1, 2, 3, 4, 5].map(star => (
                                  <Star key={star} className={`w-3 h-3 ${star <= ratings[selectedProvider.id] ? 'text-amber-500 fill-amber-500' : 'text-gray-200'}`} />
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0 ml-4">
                          <button
                            onClick={() => toggleFavorite(selectedProvider.id)}
                            className={`w-[34px] h-[34px] flex items-center justify-center rounded-[10px] transition-all ${
                              favorites.includes(selectedProvider.id)
                                ? 'bg-red-50 text-red-500'
                                : 'bg-gray-100 text-gray-400 hover:bg-red-50 hover:text-red-400'
                            }`}
                            title="Toggle favourite"
                          >
                            <Heart className={`w-4 h-4 ${favorites.includes(selectedProvider.id) ? 'fill-red-500' : ''}`} />
                          </button>
                          <button
                            onClick={() => { setEditingProvider(selectedProvider); setSelectedProvider(null) }}
                            className="w-[34px] h-[34px] flex items-center justify-center rounded-[10px] bg-gray-100 text-gray-400 hover:bg-amber-50 hover:text-amber-600 transition-all"
                            title="Edit"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={handleRemoveProvider}
                            className="w-[34px] h-[34px] flex items-center justify-center rounded-[10px] bg-gray-100 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-all"
                            title="Remove"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setSelectedProvider(null)}
                            className="w-[34px] h-[34px] flex items-center justify-center rounded-[10px] bg-gray-100 text-gray-400 hover:bg-gray-200 transition-all"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Primary CTA row — sketch 010-A: hero buttons in the header */}
                      <div className="flex items-center gap-2 pb-4 flex-wrap">
                        {selectedProvider.phone !== 'N/A' && (
                          <a
                            href={`tel:${selectedProvider.phone}`}
                            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 hover:-translate-y-px active:translate-y-0 transition-all shadow-sm shadow-emerald-600/30"
                          >
                            <Phone className="w-3.5 h-3.5" />
                            {selectedProvider.phone}
                          </a>
                        )}
                        {selectedProvider.email !== 'N/A' && (
                          <button
                            onClick={() => handleOpenEmail(selectedProvider.email)}
                            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 hover:-translate-y-px active:translate-y-0 transition-all shadow-sm shadow-blue-600/30"
                          >
                            <Mail className="w-3.5 h-3.5" />
                            Email
                          </button>
                        )}
                        {selectedProvider.website !== 'N/A' && (
                          <a
                            href={selectedProvider.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-50 hover:border-gray-300 hover:-translate-y-px active:translate-y-0 transition-all"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Website
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Scrollable body */}
                    <div className="p-6 overflow-y-auto flex-1 space-y-5">

                      {/* Portfolio */}
                      <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em] mb-2">Portfolio</p>
                        <p className="text-sm text-gray-700 leading-relaxed">{selectedProvider.winePortfolio}</p>
                      </div>

                      {/* Address */}
                      {selectedProvider.physicalAddress !== 'N/A' && (
                        <div>
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em] mb-2">Address</p>
                          <div className="flex items-start gap-2 text-sm text-gray-700">
                            <MapPin className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                            {selectedProvider.physicalAddress}
                          </div>
                        </div>
                      )}

                      {/* Contacts */}
                      {selectedProvider.knownPersonnel && selectedProvider.knownPersonnel.length > 0 && selectedProvider.knownPersonnel[0] !== 'N/A' && (
                        <div>
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em] mb-2">Contacts</p>
                          <div className="flex flex-wrap gap-2">
                            {selectedProvider.knownPersonnel.map((person, idx) => (
                              <span key={idx} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 rounded-xl text-sm text-gray-700">
                                <Users className="w-3.5 h-3.5 text-gray-400" />
                                {person}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Regions */}
                      {selectedProvider.statesOrRegionsServed && selectedProvider.statesOrRegionsServed.length > 0 && (
                        <div>
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em] mb-2">Regions Served</p>
                          <div className="flex flex-wrap gap-1.5">
                            {selectedProvider.statesOrRegionsServed.map((region, idx) => (
                              <span key={idx} className="px-2.5 py-1 bg-wine-50 text-wine-700 rounded-lg text-xs font-semibold">{region}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Last order banner */}
                      {lastOrderDates[selectedProvider.id] && (
                        <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 px-4 py-2.5 rounded-xl">
                          <Clock className="w-4 h-4 flex-shrink-0" />
                          Last order placed{' '}
                          <strong>{new Date(lastOrderDates[selectedProvider.id]).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</strong>
                        </div>
                      )}

                      <ProviderIntelligencePanel
                        providerId={selectedProvider.id}
                        providerName={selectedProvider.name}
                      />
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>

      {/* Right-click provider context menu (NEW-310) */}
      {providerMenu && (() => {
        const p = providers.find(x => x.id === providerMenu.id)
        if (!p) return null
        const MItem = ({ icon: Icon, label, disabled, onClick }: { icon: any; label: string; disabled?: boolean; onClick: () => void }) => (
          <button
            onClick={onClick}
            disabled={disabled}
            className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Icon className="w-4 h-4 text-gray-400" /> {label}
          </button>
        )
        return (
          <div
            className="fixed z-[60] w-52 bg-white border border-gray-200 rounded-xl shadow-xl p-1"
            style={{ top: Math.min(providerMenu.y, window.innerHeight - 280), left: Math.min(providerMenu.x, window.innerWidth - 220) }}
            onClick={e => e.stopPropagation()}
          >
            <MItem icon={Phone} label="Call" disabled={!p.phone} onClick={() => { window.location.href = `tel:${p.phone}`; setProviderMenu(null) }} />
            <MItem icon={Mail} label="Email" disabled={!p.email} onClick={() => { setEmailRecipient(p.email || ''); setShowEmailModal(true); setProviderMenu(null) }} />
            <MItem icon={Edit} label="Edit" onClick={() => { setEditingProvider(p); setProviderMenu(null) }} />
            <MItem icon={Heart} label={favorites.includes(p.id) ? 'Unfavorite' : 'Favorite'} onClick={() => { toggleFavorite(p.id); setProviderMenu(null) }} />
            {/* NEW-316: View Orders filters the Orders page to this provider */}
            <MItem icon={Truck} label="View orders" onClick={() => { navigate(`/orders?provider=${encodeURIComponent(p.id)}`); setProviderMenu(null) }} />
            <MItem icon={Globe} label="Open website" disabled={!p.website} onClick={() => { window.open(p.website, '_blank', 'noopener'); setProviderMenu(null) }} />
          </div>
        )
      })()}

      <AddProviderModal isOpen={showAddProviderModal} onClose={() => setShowAddProviderModal(false)} onSave={handleAddProvider} />
      <EditProviderModal
        isOpen={!!editingProvider}
        onClose={() => setEditingProvider(null)}
        onSave={handleEditProvider}
        provider={editingProvider
          ? { ...editingProvider, rating: ratings[editingProvider.id] ?? editingProvider.rating ?? 0 }
          : null
        }
      />
      <VendorSearchModal open={showVendorSearch} onClose={() => setShowVendorSearch(false)} onProviderAdded={() => refetch()} onAddCustom={() => setShowAddProviderModal(true)} />
      {showEmailModal && (
        <QuickGmailModal onClose={() => { setShowEmailModal(false); setEmailRecipient('') }} prefilledRecipient={emailRecipient} />
      )}

    </div>
  )
}

export default Providers
