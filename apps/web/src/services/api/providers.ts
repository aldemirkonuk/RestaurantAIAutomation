import { apiClient } from './client'
import type { ProviderFilters } from '../../lib/query-keys'

export interface Provider {
  id: string
  name: string
  primaryBusinessType: 'Distributor' | 'Importer' | 'Wholesaler'
  winePortfolio: string
  phone: string
  email: string
  physicalAddress: string
  website: string
  /** Split contact name — prefer these over primaryContact.name for salutations */
  contactFirstName?: string
  contactLastName?: string
  knownPersonnel?: string[]
  statesOrRegionsServed?: string[]
  /** Canonical name from backend — same data as statesOrRegionsServed, use this */
  regionsCovered?: string[]
  rating?: number
  notes?: string
  lastContactDate?: string
  restaurantId: string
  createdAt?: string
  updatedAt?: string
  /** UUID of the linked vendor_catalogue entry, null for custom vendors */
  catalogueVendorId?: string | null
  /** True if this provider was manually created; false if sourced from catalogue */
  isCustom?: boolean
  profile_foundational?: Record<string, any>
  profile_dynamic?: Record<string, any>
  primaryContact?: Record<string, any>
  /** Payment terms returned from backend (Net 30, COD, etc.) */
  paymentTerms?: string
  /** Minimum order value in dollars */
  minimumOrder?: number
  /** Lead time in days */
  leadTimeDays?: number
  /**
   * Coordinates of this provider's geocoded location, attached by
   * listProviders from provider_locations. Absent when no site has been
   * geocoded — such a provider cannot be plotted, which is a real state.
   */
  latitude?: number | null
  longitude?: number | null
  /** Wine specialties array (mirrors winePortfolio but as array) */
  specialties?: string[]
}

export interface ProviderContact {
  id: string
  providerId: string
  name: string
  role: string
  email: string
  phone: string
  isPrimary: boolean
  /**
   * What kind of line this is, as the book holds it. `null` means nobody has
   * said — which is now a different row from one recorded as a main line
   * (ADR 0121 P0 item 2).
   */
  phoneType?: string | null
  /** Only `mobile` can be texted. The server decides this, never the sheet. */
  reach?: 'mobile' | 'landline' | 'unstated'
  /** False for `main_line` too: it is also the column's own default. */
  phoneTypeStated?: boolean
  /** The server's sentence about this number. Shown verbatim. */
  reachSays?: string
}

export interface ProviderOrder {
  id: string
  providerId: string
  orderNumber: string
  orderDate: string
  deliveryDate?: string
  status: 'pending' | 'confirmed' | 'delivered' | 'cancelled'
  totalAmount: number
  items: number
}

export interface CreateProviderInput {
  name: string
  primaryBusinessType: 'Distributor' | 'Importer' | 'Wholesaler'
  winePortfolio?: string
  phone: string
  email: string
  physicalAddress: string
  website?: string
  knownPersonnel?: string[]
  statesOrRegionsServed?: string[]
  notes?: string
  restaurantId: string
  contactFirstName?: string
  contactLastName?: string
  accountNumber?: string
  paymentTerms?: string
  minimumOrderValue?: number
  deliverySchedule?: string
}

export interface UpdateProviderInput extends Partial<CreateProviderInput> {
  id: string
}

type ApiProviderPayload = {
  name?: string
  companyName?: string
  phone?: string
  email?: string
  contactFirstName?: string
  contactLastName?: string
  website?: string
  physicalAddress?: string
  rating?: number
  primaryContact?: Record<string, unknown>
  alternativeContacts?: Record<string, unknown>[]
  address?: Record<string, unknown>
  specialties?: string[]
  regionsCovered?: string[]
  minimumOrder?: number
  leadTimeDays?: number
  tier?: string
  notes?: string
  isActive?: boolean
}

const mapProviderToApiPayload = (
  data: Partial<CreateProviderInput & {
    contactFirstName?: string
    contactLastName?: string
    website?: string
    rating?: number
    paymentTerms?: string
    minimumOrderValue?: number
  }>,
  options: { requireName?: boolean } = {}
): ApiProviderPayload => {
  const payload: ApiProviderPayload = {}

  if (data.name) {
    payload.name = data.name
  } else if (options.requireName) {
    payload.name = ''
  }

  // Send phone/email as flat dedicated columns (backend writes contact_phone/contact_email).
  // Also keep primaryContact JSONB for backward compatibility with old list queries.
  if (data.phone !== undefined) payload.phone = data.phone
  if (data.email !== undefined) payload.email = data.email
  if (data.contactFirstName !== undefined) payload.contactFirstName = data.contactFirstName
  if (data.contactLastName  !== undefined) payload.contactLastName  = data.contactLastName
  if (data.website          !== undefined) payload.website          = data.website
  if (data.rating           !== undefined) payload.rating           = data.rating

  if (data.knownPersonnel?.length || data.email || data.phone) {
    payload.primaryContact = {
      name: data.knownPersonnel?.[0],
      email: data.email,
      phone: data.phone,
    }
  }

  if (data.physicalAddress) {
    payload.physicalAddress = data.physicalAddress
    payload.address = { line1: data.physicalAddress }
  }

  if (data.winePortfolio) {
    payload.specialties = [data.winePortfolio]
  }

  if (data.statesOrRegionsServed !== undefined) {
    payload.regionsCovered = data.statesOrRegionsServed
  }

  if (data.notes) {
    payload.notes = data.notes
  }

  if (data.paymentTerms !== undefined) {
    (payload as any).paymentTerms = data.paymentTerms
  }

  if (data.minimumOrderValue !== undefined) {
    payload.minimumOrder = data.minimumOrderValue
  }

  return payload
}

/**
 * Fetch all providers for a restaurant
 */
export async function fetchProviders(
  restaurantId: string,
  filters?: ProviderFilters
): Promise<Provider[]> {
  const params = new URLSearchParams()
  params.append('restaurantId', restaurantId)
  
  if (filters?.search) {
    params.append('search', filters.search)
  }
  if (filters?.category) {
    params.append('category', filters.category)
  }
  if (filters?.rating) {
    params.append('rating', filters.rating.toString())
  }
  
  const response = await apiClient.get<Provider[]>(`/providers?${params.toString()}`)
  return response.data
}

/**
 * Fetch a single provider by ID
 */
export async function fetchProviderById(id: string): Promise<Provider> {
  const response = await apiClient.get<Provider>(`/providers/${id}`)
  return response.data
}

/**
 * Create a new provider
 */
export async function createProvider(data: CreateProviderInput): Promise<Provider> {
  const payload = mapProviderToApiPayload(data, { requireName: true })
  const response = await apiClient.post<Provider>('/providers', payload)
  return response.data
}

/**
 * Update an existing provider
 */
export async function updateProvider(data: UpdateProviderInput): Promise<Provider> {
  const { id, ...updateData } = data
  const payload = mapProviderToApiPayload(updateData)
  const response = await apiClient.patch<Provider>(`/providers/${id}`, payload)
  return response.data
}

/**
 * Delete a provider
 */
export async function deleteProvider(id: string): Promise<void> {
  await apiClient.delete(`/providers/${id}`)
}

/**
 * Fetch contacts for a provider
 */
export async function fetchProviderContacts(providerId: string): Promise<ProviderContact[]> {
  const response = await apiClient.get<ProviderContact[]>(`/providers/${providerId}/contacts`)
  return response.data
}

/**
 * Add a contact to a provider
 */
export async function addProviderContact(
  providerId: string,
  contact: Omit<ProviderContact, 'id' | 'providerId'>
): Promise<ProviderContact> {
  const response = await apiClient.post<ProviderContact>(
    `/providers/${providerId}/contacts`,
    contact
  )
  return response.data
}

/**
 * Update a provider contact
 */
export async function updateProviderContact(
  providerId: string,
  contactId: string,
  data: Partial<Omit<ProviderContact, 'id' | 'providerId'>>
): Promise<ProviderContact> {
  const response = await apiClient.patch<ProviderContact>(
    `/providers/${providerId}/contacts/${contactId}`,
    data
  )
  return response.data
}

/**
 * Delete a provider contact
 */
export async function deleteProviderContact(
  providerId: string,
  contactId: string
): Promise<void> {
  await apiClient.delete(`/providers/${providerId}/contacts/${contactId}`)
}

/**
 * Fetch orders from a provider
 */
export async function fetchProviderOrders(providerId: string): Promise<ProviderOrder[]> {
  const response = await apiClient.get<ProviderOrder[]>(`/providers/${providerId}/orders`)
  return response.data
}

/**
 * Search providers by wine type
 */
export async function searchProvidersByWineType(
  restaurantId: string,
  wineType: string
): Promise<Provider[]> {
  const response = await apiClient.get<Provider[]>(
    `/providers/search/wine-type?restaurantId=${restaurantId}&wineType=${wineType}`
  )
  return response.data
}

/**
 * Get recommended providers for a wine
 */
export async function getRecommendedProviders(
  restaurantId: string,
  wineId: string
): Promise<{ primary: Provider; alternatives: Provider[] }> {
  const response = await apiClient.get<{ primary: Provider; alternatives: Provider[] }>(
    `/providers/recommendations?restaurantId=${restaurantId}&wineId=${wineId}`
  )
  return response.data
}

/**
 * Create providers for a new branch by copying a list of providers from the current restaurant.
 * Uses catalogue mode (Mode A) when the source provider has a catalogueVendorId,
 * or custom mode (Mode B) otherwise. The X-Restaurant-Id header is overridden per call
 * so each provider is created in the new branch's restaurant scope.
 *
 * Returns the number of successfully transferred providers.
 */
export async function bulkCreateProvidersForBranch(
  providers: Provider[],
  newRestaurantId: string,
): Promise<number> {
  let succeeded = 0
  for (const provider of providers) {
    try {
      if (provider.catalogueVendorId) {
        await apiClient.post(
          '/providers',
          { catalogue_vendor_id: provider.catalogueVendorId },
          { headers: { 'X-Restaurant-Id': newRestaurantId } },
        )
      } else {
        await apiClient.post(
          '/providers',
          {
            name: provider.name,
            phone: provider.phone ?? undefined,
            email: provider.email ?? undefined,
          },
          { headers: { 'X-Restaurant-Id': newRestaurantId } },
        )
      }
      succeeded++
    } catch {
      // Individual provider failure — skip and continue
    }
  }
  return succeeded
}

/**
 * Update last contact date for a provider
 */
export async function updateLastContactDate(
  providerId: string,
  date: string
): Promise<Provider> {
  const response = await apiClient.patch<Provider>(`/providers/${providerId}/contact-date`, {
    lastContactDate: date,
  })
  return response.data
}

/**
 * Bulk import providers
 */
export async function bulkImportProviders(
  restaurantId: string,
  providers: CreateProviderInput[]
): Promise<{ imported: number; failed: number; errors: string[] }> {
  const response = await apiClient.post<{ imported: number; failed: number; errors: string[] }>(
    '/providers/bulk-import',
    { restaurantId, providers }
  )
  return response.data
}

// --- Provider Locations API ---

export interface ProviderLocation {
  id: string
  name: string
  type: string
  address: string | null
  isPrimary: boolean
  /**
   * Resolved by Places autocomplete when the address was selected. Null means
   * "not geocoded" — never 0, which is a real point off West Africa. Callers
   * must filter on null rather than falsy, or every ungeocoded location lands
   * in the Gulf of Guinea.
   */
  latitude?: number | null
  longitude?: number | null
  geocodedAt?: string | null
  geocodeSource?: 'google_places' | 'manual' | 'import' | null
  createdAt?: string
}

/**
 * A provider already in this restaurant's list that looks like a duplicate of
 * the name/address being typed. The local counterpart to
 * VendorMatchCandidate (which covers the shared curated catalogue).
 */
export interface ProviderMatchCandidate {
  id: string
  name: string
  address: string | null
  phone: string | null
  email: string | null
  website: string | null
  catalogue_vendor_id: string | null
  is_custom: boolean
  name_similarity: number
  address_similarity: number | null
}

/**
 * Duplicate candidates within the restaurant's own providers.
 *
 * `excludeId` is required for the edit screen: without it the provider being
 * renamed matches itself at 1.0 and every edit reports a duplicate.
 *
 * Resolves to [] on failure — this is advisory UI attached to a working form
 * and must never be what stops someone saving.
 */
export async function matchRestaurantProviders(
  name: string,
  address?: string,
  excludeId?: string,
): Promise<ProviderMatchCandidate[]> {
  const params = new URLSearchParams()
  if (name) params.append('name', name)
  if (address) params.append('address', address)
  if (excludeId) params.append('excludeId', excludeId)

  try {
    const response = await apiClient.get<ProviderMatchCandidate[]>(
      `/providers/match?${params.toString()}`,
    )
    return response.data
  } catch {
    return []
  }
}

export async function getProviderLocations(providerId: string): Promise<ProviderLocation[]> {
  const response = await apiClient.get<ProviderLocation[]>(`/providers/${providerId}/locations`)
  return response.data
}

export async function createProviderLocation(
  providerId: string,
  data: {
    name: string
    type?: string
    address?: string
    isPrimary?: boolean
    latitude?: number
    longitude?: number
  }
): Promise<ProviderLocation> {
  const response = await apiClient.post<ProviderLocation>(`/providers/${providerId}/locations`, data)
  return response.data
}

export async function updateProviderLocation(
  providerId: string,
  locationId: string,
  data: Partial<{
    name: string
    type: string
    address: string
    isPrimary: boolean
    latitude: number
    longitude: number
  }>
): Promise<ProviderLocation> {
  const response = await apiClient.patch<ProviderLocation>(
    `/providers/${providerId}/locations/${locationId}`,
    data
  )
  return response.data
}

export async function deleteProviderLocation(
  providerId: string,
  locationId: string
): Promise<void> {
  await apiClient.delete(`/providers/${providerId}/locations/${locationId}`)
}
