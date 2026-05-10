import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  MapPin,
  Phone,
  Globe,
  Truck,
  Download,
  Package,
  Building2,
  Wine,
  Plus,
  Loader2,
} from 'lucide-react'
import type { VendorCatalogueEntry } from '../../services/api/vendors'

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function getTypeColor(type: VendorCatalogueEntry['type']): string {
  switch (type) {
    case 'distributor':
      return 'bg-blue-100 text-blue-700'
    case 'importer':
      return 'bg-purple-100 text-purple-700'
    case 'wholesaler':
      return 'bg-emerald-100 text-emerald-700'
    case 'winery_direct':
      return 'bg-rose-100 text-rose-700'
    case 'broker':
      return 'bg-amber-100 text-amber-700'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

function getTypeIcon(type: VendorCatalogueEntry['type']) {
  switch (type) {
    case 'distributor':
      return <Truck className="w-3.5 h-3.5" />
    case 'importer':
      return <Download className="w-3.5 h-3.5" />
    case 'wholesaler':
      return <Package className="w-3.5 h-3.5" />
    case 'winery_direct':
      return <Wine className="w-3.5 h-3.5" />
    default:
      return <Building2 className="w-3.5 h-3.5" />
  }
}

function formatTypeLabel(type: VendorCatalogueEntry['type']): string {
  switch (type) {
    case 'distributor':
      return 'Distributor'
    case 'importer':
      return 'Importer'
    case 'wholesaler':
      return 'Wholesaler'
    case 'winery_direct':
      return 'Winery Direct'
    case 'broker':
      return 'Broker'
    default:
      return 'Other'
  }
}

function buildLocation(vendor: VendorCatalogueEntry): string {
  const parts: string[] = []
  if (vendor.city) parts.push(vendor.city)
  if (vendor.state) parts.push(vendor.state)
  if (vendor.country && vendor.country !== 'US') parts.push(vendor.country)
  return parts.join(', ')
}

// ──────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────

export interface VendorCatalogueCardProps {
  vendor: VendorCatalogueEntry
  onAdd: (vendor: VendorCatalogueEntry) => Promise<void>
}

export function VendorCatalogueCard({ vendor, onAdd }: VendorCatalogueCardProps) {
  const [adding, setAdding] = useState(false)

  const handleAdd = async () => {
    if (adding) return
    setAdding(true)
    try {
      await onAdd(vendor)
    } finally {
      setAdding(false)
    }
  }

  const location = buildLocation(vendor)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md hover:border-wine-200 transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left: info */}
        <div className="flex-1 min-w-0">
          {/* Name + type badge */}
          <div className="flex items-start gap-2 mb-1.5 flex-wrap">
            <h3 className="font-semibold text-gray-900 text-base leading-snug">{vendor.name}</h3>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${getTypeColor(vendor.type)}`}
            >
              {getTypeIcon(vendor.type)}
              {formatTypeLabel(vendor.type)}
            </span>
          </div>

          {/* Location */}
          {location && (
            <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1.5">
              <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{location}</span>
            </div>
          )}

          {/* Wine specialties */}
          {vendor.wine_specialties && (
            <p className="text-xs text-gray-500 line-clamp-2 mb-2">{vendor.wine_specialties}</p>
          )}

          {/* Quick-contact icons */}
          <div className="flex items-center gap-2">
            {vendor.phone && (
              <a
                href={`tel:${vendor.phone}`}
                onClick={(e) => e.stopPropagation()}
                className="p-1.5 rounded-lg bg-gray-50 hover:bg-emerald-50 transition-colors"
                title={vendor.phone}
              >
                <Phone className="w-3.5 h-3.5 text-gray-400 hover:text-emerald-600" />
              </a>
            )}
            {vendor.website && (
              <a
                href={vendor.website}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="p-1.5 rounded-lg bg-gray-50 hover:bg-purple-50 transition-colors"
                title={vendor.website}
              >
                <Globe className="w-3.5 h-3.5 text-gray-400 hover:text-purple-600" />
              </a>
            )}
          </div>
        </div>

        {/* Right: Add button */}
        <button
          onClick={handleAdd}
          disabled={adding}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-wine-600 text-white text-xs font-medium rounded-lg hover:bg-wine-700 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-sm shadow-wine-600/20"
        >
          {adding ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Plus className="w-3.5 h-3.5" />
          )}
          {adding ? 'Adding…' : 'Add to My Providers'}
        </button>
      </div>
    </motion.div>
  )
}
