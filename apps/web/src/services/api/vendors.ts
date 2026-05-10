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
