/**
 * Vendor Catalogue API Service
 *
 * All network calls for the vendor catalogue search and provider creation from catalogue.
 */

import { apiClient } from './client'
import type { Provider } from './providers'

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export interface VendorCatalogueEntry {
  id: string
  name: string
  type: 'distributor' | 'importer' | 'wholesaler' | 'winery_direct' | 'broker' | 'other'
  country: string | null
  state: string | null
  city: string | null
  address: string | null
  phone: string | null
  email: string | null
  website: string | null
  wine_specialties: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface VendorSearchResponse {
  data: VendorCatalogueEntry[]
  total: number
  limit: number
  offset: number
}

export interface VendorMatchCandidate extends VendorCatalogueEntry {
  /** Trigram similarity 0..1 on name. Always present. */
  name_similarity: number
  /** Trigram similarity 0..1 on address, or null when either side has none to compare. */
  address_similarity: number | null
}

export interface CustomProviderData {
  name: string
  type?: string
  phone?: string
  email?: string
  website?: string
  contactName?: string
}

// ──────────────────────────────────────────────────────────────
// API functions
// ──────────────────────────────────────────────────────────────

/**
 * Search the global vendor catalogue by name or specialty.
 */
export async function searchVendorCatalogue(
  q: string,
  country?: string,
  limit = 20,
  offset = 0,
): Promise<VendorCatalogueEntry[]> {
  const params = new URLSearchParams()
  if (q) params.append('q', q)
  if (country) params.append('country', country)
  params.append('limit', String(limit))
  params.append('offset', String(offset))

  const response = await apiClient.get<VendorSearchResponse>(
    `/vendor-catalogue/search?${params.toString()}`,
  )
  return response.data.data
}

/**
 * Duplicate-detection candidates for the add-provider form: curated
 * catalogue vendors whose name or address plausibly matches what the user
 * has typed so far. See match_vendor_catalogue in
 * supabase/migrations/20260811010000_vendor_catalogue_match.sql for the
 * trigram-similarity scoring — this is a nicety on top of a working form, so
 * a failure here resolves to an empty array rather than throwing.
 */
export async function matchVendorCatalogue(
  name: string,
  address?: string,
  country?: string,
): Promise<VendorMatchCandidate[]> {
  const params = new URLSearchParams()
  if (name) params.append('name', name)
  if (address) params.append('address', address)
  if (country) params.append('country', country)

  try {
    const response = await apiClient.get<VendorMatchCandidate[]>(
      `/vendor-catalogue/match?${params.toString()}`,
    )
    return response.data
  } catch {
    return []
  }
}

/**
 * Fetch a single vendor catalogue entry by ID.
 */
export async function getVendorCatalogueEntry(id: string): Promise<VendorCatalogueEntry> {
  const response = await apiClient.get<VendorCatalogueEntry>(`/vendor-catalogue/${id}`)
  return response.data
}

/**
 * Create a provider in the restaurant's providers list from a catalogue entry.
 * The backend (Mode A) copies name, phone, email, address, type, website, specialties.
 */
export async function addProviderFromCatalogue(catalogueVendorId: string): Promise<Provider> {
  const response = await apiClient.post<Provider>('/providers', {
    catalogue_vendor_id: catalogueVendorId,
  })
  return response.data
}

/**
 * Create a fully custom provider (not linked to the catalogue).
 */
export async function addCustomProvider(data: CustomProviderData): Promise<Provider> {
  const response = await apiClient.post<Provider>('/providers', {
    name: data.name,
    type: data.type,
    phone: data.phone,
    email: data.email,
    website: data.website,
    contactName: data.contactName,
  })
  return response.data
}
