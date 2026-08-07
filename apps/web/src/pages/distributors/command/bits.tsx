/**
 * Presentational primitives for the Distributor Discovery page.
 * Chip styling follows the inline-span convention from
 * pages/inventory/command/bits.tsx rather than introducing a shared chip.
 */
import {
  BadgeCheck,
  Building2,
  FileCheck2,
  Globe2,
  MapPin,
  ShieldCheck,
  Warehouse,
} from 'lucide-react'
import { cn } from '../../../lib/utils'
import type { Distributor, DistributorType } from '../../../services/api/distributors'

export const TYPE_LABEL: Record<string, string> = {
  distributor: 'Distributor',
  importer: 'Importer',
  wholesaler: 'Wholesaler',
  winery_direct: 'Winery direct',
  broker: 'Broker',
  other: 'Other',
}

const TYPE_TONE: Record<string, string> = {
  distributor: 'bg-blue-50 text-blue-700',
  importer: 'bg-violet-50 text-violet-700',
  wholesaler: 'bg-amber-50 text-amber-700',
  winery_direct: 'bg-emerald-50 text-emerald-700',
  broker: 'bg-slate-100 text-slate-600',
  other: 'bg-gray-100 text-gray-600',
}

export function TypeChip({ type }: { type: DistributorType | string | null }) {
  if (!type) return null
  return (
    <span
      className={cn(
        'rounded-full px-2 py-px text-[10px] font-semibold tracking-wide',
        TYPE_TONE[type] ?? TYPE_TONE.other,
      )}
    >
      {TYPE_LABEL[type] ?? type}
    </span>
  )
}

/**
 * Why this vendor is allowed to sell to you. Distinguishing a nationwide licence
 * from a specific state one is the difference between "licensed everywhere" and
 * "licensed here", which is exactly what a buyer needs to know.
 */
export function TerritoryBadge({ servesVia, mayServe }: { servesVia: string | null; mayServe: boolean }) {
  if (!mayServe) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-px text-[10px] font-semibold text-gray-500">
        Cannot serve you
      </span>
    )
  }
  const nationwide = servesVia === 'nationwide'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-px text-[10px] font-semibold',
        nationwide ? 'bg-emerald-50 text-emerald-700' : 'bg-wine-50 text-wine-600',
      )}
      title={nationwide ? 'Licensed nationwide' : `Licensed in ${servesVia}`}
    >
      {nationwide ? <Globe2 className="h-2.5 w-2.5" /> : <ShieldCheck className="h-2.5 w-2.5" />}
      {nationwide ? 'Nationwide' : servesVia}
    </span>
  )
}

export function formatDistance(m: number | null): string {
  if (m == null) return '—'
  const km = m / 1000
  if (km < 1) return `${Math.round(m)} m`
  if (km < 10) return `${km.toFixed(1)} km`
  return `${Math.round(km).toLocaleString()} km`
}

/**
 * Distance, plus the caveat when it is measured from a head office.
 * A national distributor's HQ can be thousands of km from the warehouse that
 * actually ships to you, so an unqualified number would mislead.
 */
export function DistanceLabel({ d }: { d: Distributor }) {
  if (d.distance_m == null) {
    return <span className="font-mono text-[11px] text-gray-400">no mapped address</span>
  }
  const kind = d.nearest_location_kind
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-[11px] font-semibold text-gray-900">
        {formatDistance(d.distance_m)}
      </span>
      {d.distance_is_hq ? (
        <span
          className="inline-flex items-center gap-0.5 text-[10px] text-gray-400"
          title="Measured from the registered head office — no local warehouse on file"
        >
          <Building2 className="h-2.5 w-2.5" />
          HQ
        </span>
      ) : (
        <span
          className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600"
          title={`Measured from the nearest ${kind ?? 'location'}`}
        >
          <Warehouse className="h-2.5 w-2.5" />
          {kind ?? 'local'}
        </span>
      )}
    </span>
  )
}

/**
 * Verification tier, shown rather than hidden.
 *
 * Curated rows are human-vetted; registry rows come straight from an official
 * permit database and may be stale, may be a holding company, or may not sell
 * wine at all. Labelling that is what lets unverified data be useful — silently
 * mixing it with vetted data would make the whole list less trustworthy.
 */
export function TierBadge({ tier }: { tier: string }) {
  if (tier === 'curated') {
    return (
      <span
        className="inline-flex items-center gap-0.5 rounded-full bg-blue-50 px-1.5 py-px text-[10px] font-semibold text-blue-700"
        title="Details checked by hand"
      >
        <BadgeCheck className="h-2.5 w-2.5" />
        Verified
      </span>
    )
  }
  if (tier === 'custom') {
    return (
      <span
        className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-px text-[10px] font-semibold text-amber-700"
        title="Custom provider added by you"
      >
        <ShieldCheck className="h-2.5 w-2.5" />
        My Provider
      </span>
    )
  }
  if (tier === 'registry') {
    return (
      <span
        className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 px-1.5 py-px text-[10px] font-semibold text-gray-500"
        title="From an official permit registry — holds a licence, but details are unverified"
      >
        <FileCheck2 className="h-2.5 w-2.5" />
        Licensed
      </span>
    )
  }
  return null
}

export function DistributorCard({
  d,
  active,
  onHover,
  onOpen,
}: {
  d: Distributor
  active: boolean
  onHover: (id: string | null) => void
  onOpen: (id: string) => void
}) {
  return (
    <button
      type="button"
      data-distributor-id={d.id}
      onMouseEnter={() => onHover(d.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(d.id)}
      onBlur={() => onHover(null)}
      onClick={() => onOpen(d.id)}
      className={cn(
        'w-full rounded-xl border p-3 text-left transition',
        active
          ? 'border-wine-300 bg-wine-50/40 shadow-sm'
          : 'border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm',
        !d.may_serve && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-gray-900">{d.name}</span>
            <TypeChip type={d.type} />
            <TierBadge tier={d.listing_tier} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <TerritoryBadge servesVia={d.serves_via} mayServe={d.may_serve} />
            <DistanceLabel d={d} />
          </div>
        </div>
      </div>

      {(d.city || d.state) && (
        <div className="mt-1.5 flex items-center gap-1 text-[11px] text-gray-500">
          <MapPin className="h-3 w-3 flex-shrink-0" />
          <span className="truncate">{[d.city, d.state].filter(Boolean).join(', ')}</span>
        </div>
      )}

      {d.wine_specialties && (
        <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-gray-500">
          {d.wine_specialties}
        </p>
      )}
    </button>
  )
}

export function FacetChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count?: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition',
        active
          ? 'border-wine-600 bg-wine-600 text-white'
          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50',
      )}
    >
      {label}
      {count != null && (
        <span className={cn('font-mono text-[10px]', active ? 'text-white/80' : 'text-gray-400')}>
          {count}
        </span>
      )}
    </button>
  )
}
