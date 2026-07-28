/**
 * Distributor Discovery API
 *
 * Territory-gated distributor search backing the /distributors map.
 * The restaurant is taken from the JWT server-side, so it is never sent here.
 */

import { apiClient } from './client'

export type DistributorType =
  | 'distributor'
  | 'importer'
  | 'wholesaler'
  | 'winery_direct'
  | 'broker'
  | 'other'

export interface Distributor {
  id: string
  name: string
  type: DistributorType | null
  city: string | null
  state: string | null
  country: string | null
  website: string | null
  wine_specialties: string | null
  latitude: number | null
  longitude: number | null
  /** Metres to the nearest serving location; null when the vendor has no coordinates. */
  distance_m: number | null
  /** True when distance came from the head office because no local site is on file. */
  distance_is_hq: boolean
  nearest_location_kind: string | null
  may_serve: boolean
  /** Admin area whose licence permits service, or 'nationwide'. */
  serves_via: string | null
  /** curated = human-vetted; registry = unverified permit-database row. */
  listing_tier: ListingTier
  data_confidence: number | null
  verified_at: string | null
}

export type ListingTier = 'curated' | 'registry' | 'user_submitted'

export interface DistributorSearchResponse {
  data: Distributor[]
  total: number
  limit: number
  offset: number
  /** The restaurant's own coordinates; null when it has not been geocoded. */
  origin: { lat: number; lng: number; label: string } | null
}

export interface FacetOption {
  slug: string
  value: string
  vendors: number
}

export type FacetGroups = Record<string, FacetOption[]>

export interface DistributorLocation {
  id: string
  kind: string
  name: string | null
  address: string | null
  city: string | null
  admin_area_code: string | null
  postal_code: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
  is_primary: boolean
}

export interface DistributorTerritory {
  country: string
  admin_area_code: string | null
  license_type: string | null
  license_id: string | null
  valid_until: string | null
}

export interface DistributorDetail {
  vendor: Record<string, unknown> & {
    id: string
    name: string
    phone?: string | null
    email?: string | null
    website?: string | null
    address?: string | null
    wine_specialties?: string | null
    notes?: string | null
    data_confidence?: number | null
    geocode_provider?: string | null
  }
  locations: DistributorLocation[]
  territories: DistributorTerritory[]
  facets: FacetGroups
}

export interface DistributorSearchParams {
  q?: string
  territoryOnly?: boolean
  lat?: number
  lng?: number
  radiusM?: number
  minLng?: number
  minLat?: number
  maxLng?: number
  maxLat?: number
  type?: DistributorType[]
  /** Verification tiers to include; omit for all. */
  tier?: ListingTier[]
  /** `kind:slug` pairs, e.g. `region:burgundy`. */
  facet?: string[]
  sort?: 'distance' | 'name'
  limit?: number
  offset?: number
}

function toQuery(params: DistributorSearchParams): string {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    // Repeated params for arrays — the DTO expects `type=a&type=b`.
    if (Array.isArray(value)) value.forEach((v) => sp.append(key, String(v)))
    else sp.append(key, String(value))
  }
  return sp.toString()
}

export async function searchDistributors(
  params: DistributorSearchParams = {},
): Promise<DistributorSearchResponse> {
  const res = await apiClient.get<DistributorSearchResponse>(
    `/distributors/search?${toQuery(params)}`,
  )
  return res.data
}

export async function getDistributorFacets(params: {
  territoryOnly?: boolean
  type?: DistributorType[]
} = {}): Promise<FacetGroups> {
  const res = await apiClient.get<FacetGroups>(`/distributors/facets?${toQuery(params)}`)
  return res.data
}

export async function getDistributor(id: string): Promise<DistributorDetail> {
  const res = await apiClient.get<DistributorDetail>(`/distributors/${id}`)
  return res.data
}
