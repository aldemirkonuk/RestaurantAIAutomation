import { useState, useMemo, useCallback } from 'react'
import { motion } from 'framer-motion'
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
  Package,
  Download,
  Plus,
  Star,
  ExternalLink,
  LayoutGrid,
  List,
  StickyNote,
  Clock,
  Heart,
  Edit,
} from 'lucide-react'
import { useProviders, useCreateProvider, useUpdateProvider, useDeleteProvider, useOrders } from '../hooks/queries'
import { useAuthStore } from '../stores'
import { useUserPreferences } from '../hooks/useUserPreferences'
import type { Provider } from '../services/api/providers'
import { AddProviderModal, NewProviderData } from '../components/providers/AddProviderModal'
import { EditProviderModal, EditProviderData } from '../components/providers/EditProviderModal'
import { ProviderIntelligencePanel } from '../components/providers/ProviderIntelligencePanel'
import { PageSkeleton, ErrorState } from '../components/ui'
import { QuickGmailModal } from '../components/emails/QuickGmailModal'
import { useRealtimeDispatch } from '../contexts/RealtimeContext'

type BusinessTypeFilter = 'All' | 'Distributor' | 'Importer' | 'Wholesaler'
type ViewMode = 'grid' | 'list' | 'compact'

function getBusinessTypeColor(type: string | undefined): string {
  switch (type?.toLowerCase()) {
    case 'distributor':
      return 'bg-blue-100 text-blue-700'
    case 'importer':
      return 'bg-purple-100 text-purple-700'
    case 'wholesaler':
      return 'bg-emerald-100 text-emerald-700'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

function getBusinessTypeIcon(type: string | undefined) {
  switch (type?.toLowerCase()) {
    case 'distributor':
      return <Truck className="w-4 h-4" />
    case 'importer':
      return <Globe className="w-4 h-4" />
    case 'wholesaler':
      return <Package className="w-4 h-4" />
    default:
      return <Building2 className="w-4 h-4" />
  }
}

interface ProviderNote {
  note: string
  updatedAt: string
}

export function Providers() {
  const restaurantId = useAuthStore(state => state.activeRestaurantId)
  const { preferences, updatePreferences } = useUserPreferences()
  const { data: rawOrders } = useOrders()

  const lastOrderDates = useMemo(() => {
    const dates: Record<string, string> = {}
    const orders = Array.isArray(rawOrders) ? rawOrders : (rawOrders as any)?.orders || []
    for (const o of orders) {
      const pid = o.providerId ?? o.provider_id
      const date = o.requestedAt ?? o.created_at
      if (pid && date) {
        if (!dates[pid] || new Date(date) > new Date(dates[pid])) {
          dates[pid] = date
        }
      }
    }
    return dates
  }, [rawOrders])
  const [searchQuery, setSearchQuery] = useState('')
  const [businessTypeFilter, setBusinessTypeFilter] = useState<BusinessTypeFilter>('All')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null)
  const [showAddProviderModal, setShowAddProviderModal] = useState(false)
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailRecipient, setEmailRecipient] = useState('')
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const [_editingNote] = useState<string | null>(null)
  const [_noteText] = useState('')
  const [_expandedCards] = useState<Set<string>>(new Set())

  const favorites: string[] = preferences.providerFavorites ?? []
  const notes: Record<string, ProviderNote> = (preferences.providerNotes ?? {}) as Record<string, ProviderNote>
  const ratings: Record<string, number> = (preferences.providerRatings ?? {}) as Record<string, number>

  const setFavorites = useCallback((updater: (prev: string[]) => string[]) => {
    const next = updater(favorites)
    updatePreferences({ providerFavorites: next })
  }, [favorites, updatePreferences])

  const setNotes = useCallback((updater: (prev: Record<string, ProviderNote>) => Record<string, ProviderNote>) => {
    const next = updater(notes)
    updatePreferences({ providerNotes: next })
  }, [notes, updatePreferences])

  const setRatings = useCallback((updater: (prev: Record<string, number>) => Record<string, number>) => {
    const next = updater(ratings)
    updatePreferences({ providerRatings: next })
  }, [ratings, updatePreferences])

  // Fetch providers from API
  const { data: providers = [], isLoading, error, refetch } = useProviders(restaurantId || '', {
    search: searchQuery,
    category: businessTypeFilter === 'All' ? undefined : businessTypeFilter,
  })
  
  const createProvider = useCreateProvider()
  const updateProvider = useUpdateProvider()
  const deleteProviderMutation = useDeleteProvider()

  const handleRemoveProvider = async () => {
    if (!selectedProvider) return
    if (!confirm(`Remove provider "${selectedProvider.name}"?`)) return

    try {
      await deleteProviderMutation.mutateAsync(selectedProvider.id)

      setFavorites(prev => prev.filter(id => id !== selectedProvider.id))
      setNotes(prev => {
        const { [selectedProvider.id]: _removed, ...rest } = prev
        return rest
      })
      setRatings(prev => {
        const { [selectedProvider.id]: _removed, ...rest } = prev
        return rest
      })

      await dispatchProviderUpdate({
        type: 'removed',
        providerId: selectedProvider.id,
        providerName: selectedProvider.name,
      })

      setSelectedProvider(null)
    } catch (error) {
      console.error('Failed to remove provider:', error)
      alert('Failed to remove provider. Please try again.')
    }
  }

  const handleEditProvider = async (data: EditProviderData) => {
    try {
      await updateProvider.mutateAsync({
        id: data.id,
        name: data.name,
        phone: data.phone,
        email: data.email,
        website: data.website,
        physicalAddress: data.address,
        primaryBusinessType: data.primaryBusinessType as any,
        notes: data.notes,
        knownPersonnel: data.contacts.map(c => c.name).filter(Boolean),
        restaurantId: restaurantId || '',
      })

      if (data.rating > 0) {
        setRatings(prev => ({ ...prev, [data.id]: data.rating }))
      }

      setEditingProvider(null)
    } catch (error) {
      console.error('Failed to update provider:', error)
      alert('Failed to update provider. Please try again.')
    }
  }

  const handleOpenEmail = (email: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setEmailRecipient(email)
    setShowEmailModal(true)
  }

  const filteredProviders = useMemo(() => {
    let filtered = [...providers]

    // Favorites filter
    if (showFavoritesOnly) {
      filtered = filtered.filter(p => favorites.includes(p.id))
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(query) ||
        p.winePortfolio.toLowerCase().includes(query) ||
        p.physicalAddress.toLowerCase().includes(query) ||
        p.statesOrRegionsServed?.some(s => s.toLowerCase().includes(query))
      )
    }

    // Business type filter
    if (businessTypeFilter !== 'All') {
      filtered = filtered.filter(p => p.primaryBusinessType === businessTypeFilter)
    }

    // Sort: favorites first, then by rating, then by name
    return filtered.sort((a, b) => {
      const aFav = favorites.includes(a.id) ? 1 : 0
      const bFav = favorites.includes(b.id) ? 1 : 0
      if (aFav !== bFav) return bFav - aFav
      
      const aRating = ratings[a.id] || 0
      const bRating = ratings[b.id] || 0
      if (aRating !== bRating) return bRating - aRating
      
      return a.name.localeCompare(b.name)
    })
  }, [providers, searchQuery, businessTypeFilter, showFavoritesOnly, favorites, ratings])

  // Favorite providers for the top section
  const favoriteProviders = useMemo(() => 
    providers.filter(p => favorites.includes(p.id)),
    [providers, favorites]
  )

  const toggleFavorite = useCallback((providerId: string) => {
    setFavorites(prev => 
      prev.includes(providerId) 
        ? prev.filter(id => id !== providerId)
        : [...prev, providerId]
    )
  }, [setFavorites])

  const setProviderRating = useCallback((providerId: string, rating: number) => {
    setRatings(prev => ({ ...prev, [providerId]: rating }))
  }, [setRatings])

  // Show loading state (only on initial load)
  if (isLoading && !providers.length) {
    return (
      <div className="min-h-screen">
        <Header title="Wine Providers" subtitle="Manage your supplier relationships" />
        <div className="p-6">
          <PageSkeleton />
        </div>
      </div>
    )
  }
  
  // Show error state only if no cached data
  if (error && !providers.length) {
    return (
      <div className="min-h-screen">
        <Header title="Wine Providers" subtitle="Manage your supplier relationships" />
        <div className="p-6">
          <ErrorState
            variant="network"
            title="Unable to load providers"
            description="The backend API is not available. This page will work once the backend is connected."
            action={{ label: 'Retry', onClick: () => refetch() }}
          />
        </div>
      </div>
    )
  }

  // Get dispatch function for cross-page sync
  const { dispatchProviderUpdate } = useRealtimeDispatch()

  const handleAddProvider = async (providerData: NewProviderData) => {
    if (!restaurantId) {
      alert('Error: No restaurant ID found. Please log in again.')
      return
    }

    try {
      const result = await createProvider.mutateAsync({
        name: providerData.name,
        primaryBusinessType: providerData.primaryBusinessType,
        phone: providerData.phone,
        email: providerData.email,
        physicalAddress: providerData.address,
        restaurantId: restaurantId,
        contactPerson: providerData.contactPerson,
        website: providerData.website,
        accountNumber: providerData.accountNumber,
        winePortfolio: providerData.specialties.join(', '),
        statesOrRegionsServed: providerData.deliveryDays,
        paymentTerms: providerData.paymentTerms,
        minimumOrderValue: providerData.minimumOrder,
        deliverySchedule: providerData.deliveryDays.join(', '),
        notes: `Specialties: ${providerData.specialties.join(', ')}`,
      })

      if (providerData.rating > 0 && result?.id) {
        setRatings(prev => ({ ...prev, [result.id]: providerData.rating }))
      }

      await dispatchProviderUpdate({
        type: 'added',
        providerId: result?.id ?? '',
        providerName: providerData.name,
        data: {
          contactPerson: providerData.contactPerson,
          email: providerData.email,
          phone: providerData.phone,
          businessType: providerData.primaryBusinessType,
          specialties: providerData.specialties,
        },
        source: 'providers_page',
        timestamp: new Date().toISOString(),
      })
    } catch (error) {
      console.error('Failed to add provider:', error)
      alert('Failed to add provider. Please try again.')
    }
  }

  return (
    <div className="min-h-screen">
      <Header 
        title="Wine Providers" 
        subtitle={`${providers.length} verified U.S.-based distributors, importers, and wholesalers`} 
      />

      <div className="p-6">
        {/* Toolbar */}
        <div className="flex flex-col lg:flex-row gap-4 mb-6">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search providers, portfolios, regions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent outline-none transition-all"
            />

            {/* Add Provider Button */}
          </div>

          <button
            onClick={() => setShowAddProviderModal(true)}
            className="px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-600/30 transition-all flex items-center gap-2 whitespace-nowrap"
          >
            <Plus className="w-5 h-5" />
            Add Provider
          </button>

          {/* Business Type Filter */}
          <div className="flex items-center gap-2">
            {(['All', 'Distributor', 'Importer', 'Wholesaler'] as BusinessTypeFilter[]).map((type) => (
              <button
                key={type}
                onClick={() => setBusinessTypeFilter(type)}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                  businessTypeFilter === type
                    ? 'bg-wine-600 text-white shadow-lg shadow-wine-600/30'
                    : 'bg-white text-gray-600 border border-gray-200 hover:border-wine-300 hover:text-wine-600'
                }`}
              >
                {type}
              </button>
            ))}
          </div>

          {/* Favorites Toggle */}
          <button
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all flex items-center gap-2 ${
              showFavoritesOnly
                ? 'bg-amber-100 text-amber-700 border border-amber-200'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-amber-300'
            }`}
              style={{ color: '#1f2937', WebkitTextFillColor: '#1f2937' }}
          >
            <Heart className={`w-4 h-4 ${showFavoritesOnly ? 'fill-amber-500' : ''}`} />
            Favorites
            {favorites.length > 0 && (
              <span className="px-1.5 py-0.5 bg-amber-200 text-amber-800 text-xs rounded-full">
                {favorites.length}
              </span>
            )}
          </button>

          {/* View Toggle */}
          <div className="flex bg-white border border-gray-200 rounded-xl p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-lg transition-all ${
                viewMode === 'grid' ? 'bg-gray-100 text-gray-900' : 'text-gray-400 hover:text-gray-600'
              }`}
              title="Grid View"
            >
              <LayoutGrid className="w-5 h-5" />
            </button>
            <button
              onClick={() => setViewMode('compact')}
              className={`p-2 rounded-lg transition-all ${
                viewMode === 'compact' ? 'bg-gray-100 text-gray-900' : 'text-gray-400 hover:text-gray-600'
              }`}
              title="Compact View"
            >
              <Building2 className="w-5 h-5" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-lg transition-all ${
                viewMode === 'list' ? 'bg-gray-100 text-gray-900' : 'text-gray-400 hover:text-gray-600'
              }`}
              title="List View"
            >
              <List className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Results Count */}
        <div className="mb-6">
          <p className="text-sm text-gray-500">
            Showing <span className="font-medium text-gray-900">{filteredProviders.length}</span> of{' '}
            <span className="font-medium text-gray-900">{providers.length}</span> providers
          </p>
        </div>

        {/* Favorite Providers Section */}
        {favoriteProviders.length > 0 && !showFavoritesOnly && (
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-amber-100 rounded-lg">
                <Heart className="w-5 h-5 text-amber-600 fill-amber-500" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Favorite Providers</h2>
                <p className="text-sm text-gray-500">Your go-to suppliers</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {favoriteProviders.map(provider => (
                <motion.div
                  key={`fav-${provider.id}`}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border border-amber-200 p-4 hover:shadow-lg transition-all cursor-pointer"
                  onClick={() => setSelectedProvider(provider)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-gray-900 text-sm">{provider.name}</h3>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(provider.id); }}
                      className="p-1 hover:bg-amber-200 rounded transition-colors"
                    >
                      <Heart className="w-4 h-4 text-amber-600 fill-amber-500" />
                    </button>
                  </div>
                  {ratings[provider.id] && (
                    <div className="flex items-center gap-1 mb-2">
                      {[1, 2, 3, 4, 5].map(star => (
                        <Star
                          key={star}
                          className={`w-3 h-3 ${star <= ratings[provider.id] ? 'text-amber-500 fill-amber-500' : 'text-gray-300'}`}
                        />
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    {provider.phone !== 'N/A' && (
                      <a
                        href={`tel:${provider.phone}`}
                        onClick={(e) => e.stopPropagation()}
                        className="p-1.5 bg-white rounded-lg hover:bg-emerald-100 transition-colors"
                        title="Call"
                      >
                        <Phone className="w-3.5 h-3.5 text-emerald-600" />
                      </a>
                    )}
                    {provider.email !== 'N/A' && (
                      <button
                        onClick={(e) => handleOpenEmail(provider.email, e)}
                        className="p-1.5 bg-white rounded-lg hover:bg-blue-100 transition-colors"
                        title="Email"
                      >
                        <Mail className="w-3.5 h-3.5 text-blue-600" />
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingProvider(provider); }}
                      className="p-1.5 bg-white rounded-lg hover:bg-amber-100 transition-colors"
                      title="Edit"
                    >
                      <Edit className="w-3.5 h-3.5 text-amber-600" />
                    </button>
                    {provider.website !== 'N/A' && (
                      <a
                        href={provider.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1.5 bg-white rounded-lg hover:bg-purple-100 transition-colors"
                        title="Website"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-purple-600" />
                      </a>
                    )}
                  </div>
                  {lastOrderDates[provider.id] && (
                    <div className="flex items-center gap-1 mt-2 text-xs text-gray-500">
                      <Clock className="w-3 h-3" />
                      <span>Last order: {new Date(lastOrderDates[provider.id]).toLocaleDateString()}</span>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Provider Directory - Organized by Business Type */}
        <div className="mb-8 space-y-8">
          {/* Wholesalers Section */}
          <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-2xl border border-emerald-100 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-emerald-100 rounded-xl">
                <Package className="w-6 h-6 text-emerald-700" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Wholesalers</h2>
                <p className="text-sm text-gray-600">Major wine and spirits wholesalers serving on-premise accounts nationwide</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {providers
                .filter(p => p.primaryBusinessType === 'Wholesaler')
                .map((provider) => (
                  <div
                    key={provider.id}
                    onClick={() => setSelectedProvider(provider)}
                    className="bg-white rounded-xl p-4 border border-emerald-100 hover:border-emerald-300 hover:shadow-lg transition-all cursor-pointer group"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-semibold text-gray-900 group-hover:text-emerald-700 transition-colors">{provider.name}</h3>
                      <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-md text-xs font-medium whitespace-nowrap ml-2">
                        Wholesaler
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 line-clamp-2 mb-3">{provider.winePortfolio}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <MapPin className="w-3.5 h-3.5" />
                      <span className="truncate">{provider.physicalAddress}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Importers Section */}
          <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-2xl border border-purple-100 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-purple-100 rounded-xl">
                <Download className="w-6 h-6 text-purple-700" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Importers</h2>
                <p className="text-sm text-gray-600">Specialized importers bringing international wines to U.S. markets</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {providers
                .filter(p => p.primaryBusinessType === 'Importer')
                .map((provider) => (
                  <div
                    key={provider.id}
                    onClick={() => setSelectedProvider(provider)}
                    className="bg-white rounded-xl p-4 border border-purple-100 hover:border-purple-300 hover:shadow-lg transition-all cursor-pointer group"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-semibold text-gray-900 group-hover:text-purple-700 transition-colors">{provider.name}</h3>
                      <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded-md text-xs font-medium whitespace-nowrap ml-2">
                        Importer
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 line-clamp-2 mb-3">{provider.winePortfolio}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <MapPin className="w-3.5 h-3.5" />
                      <span className="truncate">{provider.physicalAddress}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Distributors Section */}
          <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-2xl border border-blue-100 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-blue-100 rounded-xl">
                <Truck className="w-6 h-6 text-blue-700" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Distributors</h2>
                <p className="text-sm text-gray-600">Regional and specialty distributors focused on restaurant partnerships</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {providers
                .filter(p => p.primaryBusinessType === 'Distributor')
                .map((provider) => (
                  <div
                    key={provider.id}
                    onClick={() => setSelectedProvider(provider)}
                    className="bg-white rounded-xl p-4 border border-blue-100 hover:border-blue-300 hover:shadow-lg transition-all cursor-pointer group"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">{provider.name}</h3>
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-md text-xs font-medium whitespace-nowrap ml-2">
                        Distributor
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 line-clamp-2 mb-3">{provider.winePortfolio}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <MapPin className="w-3.5 h-3.5" />
                      <span className="truncate">{provider.physicalAddress}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Providers Grid/Compact/List View */}
        {viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProviders.map((provider, index) => (
              <motion.div
                key={provider.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03, type: 'spring', stiffness: 300, damping: 25 }}
                whileHover={{ y: -4, transition: { duration: 0.2 } }}
                onClick={() => setSelectedProvider(provider)}
                className={`bg-white rounded-2xl border p-6 hover:shadow-xl transition-all cursor-pointer ${
                  favorites.includes(provider.id) ? 'border-amber-200 ring-1 ring-amber-100' : 'border-gray-100 hover:border-wine-200'
                }`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-gray-900 line-clamp-1">{provider.name}</h3>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(provider.id); }}
                        className="p-1 hover:bg-amber-100 rounded transition-colors"
                      >
                        <Heart className={`w-4 h-4 ${favorites.includes(provider.id) ? 'text-amber-500 fill-amber-500' : 'text-gray-300 hover:text-amber-400'}`} />
                      </button>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${getBusinessTypeColor(provider.primaryBusinessType)}`}>
                      {getBusinessTypeIcon(provider.primaryBusinessType)}
                      {provider.primaryBusinessType}
                    </span>
                  </div>
                </div>

                {/* Rating */}
                <div className="flex items-center gap-1 mb-3">
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      key={star}
                      onClick={(e) => { e.stopPropagation(); setProviderRating(provider.id, star); }}
                      className="p-0.5 hover:scale-110 transition-transform"
                    >
                      <Star
                        className={`w-4 h-4 ${star <= (ratings[provider.id] || 0) ? 'text-amber-500 fill-amber-500' : 'text-gray-300 hover:text-amber-300'}`}
                      />
                    </button>
                  ))}
                </div>

                <p className="text-sm text-gray-600 mb-4 line-clamp-2">{provider.winePortfolio}</p>

                {/* Quick Contact Buttons */}
                <div className="flex items-center gap-2 mb-4">
                  {provider.phone !== 'N/A' && (
                    <a
                      href={`tel:${provider.phone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 transition-colors text-xs font-medium"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      Call
                    </a>
                  )}
                  {provider.email !== 'N/A' && (
                    <button
                      onClick={(e) => handleOpenEmail(provider.email, e)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors text-xs font-medium"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      Email
                    </button>
                  )}
                  {provider.website !== 'N/A' && (
                      <a 
                        href={provider.website} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 transition-colors text-xs font-medium"
                      >
                      <Globe className="w-3.5 h-3.5" />
                      Web
                      </a>
                  )}
                </div>

                <div className="space-y-2 text-xs text-gray-500">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5" />
                    <span className="truncate">{provider.physicalAddress}</span>
                  </div>
                  {lastOrderDates[provider.id] && (
                    <div className="flex items-center gap-2 text-emerald-600">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Last order: {new Date(lastOrderDates[provider.id]).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Users className="w-3.5 h-3.5" />
                    <span>{(provider.statesOrRegionsServed?.length || 0)} region{(provider.statesOrRegionsServed?.length || 0) > 1 ? 's' : ''}</span>
                  </div>
                  
                  {/* Notes indicator */}
                  {notes[provider.id]?.note && (
                    <div className="flex items-center gap-1 text-xs text-amber-600" title={notes[provider.id].note}>
                      <StickyNote className="w-3.5 h-3.5" />
                      <span>Has notes</span>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        ) : viewMode === 'compact' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {filteredProviders.map((provider, index) => (
              <motion.div
                key={provider.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.02 }}
                onClick={() => setSelectedProvider(provider)}
                className={`bg-white rounded-xl border p-3 hover:shadow-md transition-all cursor-pointer ${
                  favorites.includes(provider.id) ? 'border-amber-200' : 'border-gray-100'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-gray-900 text-sm truncate flex-1">{provider.name}</h3>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(provider.id); }}
                    className="p-1"
                  >
                    <Heart className={`w-3.5 h-3.5 ${favorites.includes(provider.id) ? 'text-amber-500 fill-amber-500' : 'text-gray-300'}`} />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${getBusinessTypeColor(provider.primaryBusinessType)}`}>
                    {provider.primaryBusinessType}
                  </span>
                  {ratings[provider.id] && (
                    <div className="flex items-center gap-0.5">
                      <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                      <span className="text-xs text-gray-600">{ratings[provider.id]}</span>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px]">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-4 text-left w-[250px] text-sm font-semibold text-gray-900">Provider</th>
                    <th className="px-4 py-4 text-left w-[200px] text-sm font-semibold text-gray-900">Type</th>
                    <th className="px-4 py-4 text-left flex-1 text-sm font-semibold text-gray-900">Portfolio</th>
                    <th className="px-4 py-4 text-left w-[200px] text-sm font-semibold text-gray-900">Contact</th>
                    <th className="px-4 py-4 text-left w-[150px] text-sm font-semibold text-gray-900">Regions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredProviders.map((provider) => (
                    <tr
                      key={provider.id}
                      onClick={() => setSelectedProvider(provider)}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 w-[250px]">
                        <p className="font-medium text-gray-900">{provider.name}</p>
                        {provider.physicalAddress !== 'N/A' && (
                          <p className="text-xs text-gray-500 mt-1 truncate">{provider.physicalAddress}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 w-[200px]">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${getBusinessTypeColor(provider.primaryBusinessType)}`}>
                          {getBusinessTypeIcon(provider.primaryBusinessType)}
                          {provider.primaryBusinessType}
                        </span>
                      </td>
                      <td className="px-4 py-3 flex-1">
                        <p className="text-sm text-gray-700 line-clamp-2">{provider.winePortfolio}</p>
                      </td>
                      <td className="px-4 py-3 w-[200px]">
                        <div className="space-y-1 text-xs text-gray-500">
                          {provider.phone !== 'N/A' && (
                            <div className="flex items-center gap-1">
                              <Phone className="w-3 h-3" />
                              <span className="truncate">{provider.phone}</span>
                            </div>
                          )}
                          {provider.email !== 'N/A' && (
                            <div className="flex items-center gap-1">
                              <Mail className="w-3 h-3" />
                              <span className="truncate">{provider.email}</span>
                            </div>
                          )}
                          {provider.website !== 'N/A' && (
                            <a 
                              href={provider.website} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-wine-600 hover:text-wine-700"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Globe className="w-3 h-3" />
                              <span>Website</span>
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 w-[150px]">
                        <p className="text-xs text-gray-500">
                          {provider.statesOrRegionsServed && provider.statesOrRegionsServed.length > 0 
                            ? provider.statesOrRegionsServed.slice(0, 3).join(', ')
                            : 'N/A'}
                          {provider.statesOrRegionsServed && provider.statesOrRegionsServed.length > 3 && (
                            <span className="text-gray-400"> +{provider.statesOrRegionsServed.length - 3} more</span>
                          )}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Provider Detail Modal */}
        {selectedProvider && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedProvider(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-wine-50 to-rose-50 flex-shrink-0">
                  <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${getBusinessTypeColor(selectedProvider.primaryBusinessType)}`}>
                    {getBusinessTypeIcon(selectedProvider.primaryBusinessType)}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{selectedProvider.name}</h2>
                    <p className="text-sm text-gray-500">{selectedProvider.primaryBusinessType}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setEditingProvider(selectedProvider); setSelectedProvider(null); }}
                    className="px-3 py-2 text-sm font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <Edit className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    onClick={handleRemoveProvider}
                    className="px-3 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Remove
                  </button>
                  <button
                    onClick={() => setSelectedProvider(null)}
                    className="p-2 hover:bg-white/50 rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>
              </div>

              {/* Content - Scrollable */}
              <div className="p-6 overflow-y-auto flex-1">
                <div className="space-y-6">
                  {/* Wine Portfolio */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">Wine Portfolio / Represented Producers</h3>
                    <p className="text-sm text-gray-600 leading-relaxed">{selectedProvider.winePortfolio}</p>
                  </div>

                  {/* Contact Information */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Contact Information</h3>
                    <div className="space-y-2">
                      {selectedProvider.phone !== 'N/A' && (
                        <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                          <Phone className="w-5 h-5 text-gray-400" />
                          <div>
                            <p className="text-xs text-gray-500">Phone</p>
                            <p className="text-sm font-medium text-gray-900">{selectedProvider.phone}</p>
                          </div>
                        </div>
                      )}
                      {selectedProvider.email !== 'N/A' && (
                        <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                          <Mail className="w-5 h-5 text-gray-400" />
                          <div>
                            <p className="text-xs text-gray-500">Email</p>
                            <p className="text-sm font-medium text-gray-900">{selectedProvider.email}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Physical Address */}
                  {selectedProvider.physicalAddress !== 'N/A' && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">Physical Address</h3>
                      <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                        <MapPin className="w-5 h-5 text-gray-400 mt-0.5" />
                        <p className="text-sm text-gray-900">{selectedProvider.physicalAddress}</p>
                      </div>
                    </div>
                  )}

                  {/* Website */}
                  {selectedProvider.website !== 'N/A' && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">Website</h3>
                      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                        <Globe className="w-5 h-5 text-gray-400" />
                        <a
                          href={selectedProvider.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-wine-600 hover:text-wine-700"
                        >
                          {selectedProvider.website}
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Known Personnel */}
                  {selectedProvider.knownPersonnel && selectedProvider.knownPersonnel.length > 0 && selectedProvider.knownPersonnel[0] !== 'N/A' && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">Known Personnel</h3>
                      <div className="space-y-2">
                        {selectedProvider.knownPersonnel.map((person, index) => (
                          <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                            <Users className="w-5 h-5 text-gray-400" />
                            <p className="text-sm text-gray-900">{person}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* States or Regions Served */}
                  {selectedProvider.statesOrRegionsServed && selectedProvider.statesOrRegionsServed.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">States or Regions Served</h3>
                      <div className="flex flex-wrap gap-2">
                        {selectedProvider.statesOrRegionsServed.map((region, index) => (
                          <span
                            key={index}
                            className="px-3 py-1.5 bg-wine-50 text-wine-700 rounded-lg text-xs font-medium"
                          >
                            {region}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Provider Intelligence Panel */}
                  <ProviderIntelligencePanel
                    providerId={selectedProvider.id}
                    providerName={selectedProvider.name}
                  />
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </div>
      {/* Add Provider Modal */}
      <AddProviderModal
        isOpen={showAddProviderModal}
        onClose={() => setShowAddProviderModal(false)}
        onSave={handleAddProvider}
      />

      {/* Edit Provider Modal */}
      <EditProviderModal
        isOpen={!!editingProvider}
        onClose={() => setEditingProvider(null)}
        onSave={handleEditProvider}
        provider={editingProvider}
      />

      {/* In-House Email Modal */}
      {showEmailModal && (
        <QuickGmailModal
          onClose={() => { setShowEmailModal(false); setEmailRecipient(''); }}
          prefilledRecipient={emailRecipient}
        />
      )}
    </div>
  )
}

export default Providers
