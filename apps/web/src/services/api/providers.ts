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
  knownPersonnel?: string[]
  statesOrRegionsServed?: string[]
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
}

export interface ProviderContact {
  id: string
  providerId: string
  name: string
  role: string
  email: string
  phone: string
  isPrimary: boolean
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
}

export interface UpdateProviderInput extends Partial<CreateProviderInput> {
  id: string
}

type ApiProviderPayload = {
  name?: string
  companyName?: string
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
  data: Partial<CreateProviderInput>,
  options: { requireName?: boolean } = {}
): ApiProviderPayload => {
  const payload: ApiProviderPayload = {}

  if (data.name) {
    payload.name = data.name
  } else if (options.requireName) {
    payload.name = ''
  }

  if (data.knownPersonnel?.length || data.email || data.phone) {
    payload.primaryContact = {
      name: data.knownPersonnel?.[0],
      email: data.email,
      phone: data.phone,
    }
  }

  if (data.physicalAddress) {
    payload.address = { line1: data.physicalAddress }
  }

  if (data.winePortfolio) {
    payload.specialties = [data.winePortfolio]
  }

  if (data.statesOrRegionsServed?.length) {
    payload.regionsCovered = data.statesOrRegionsServed
  }

  if (data.notes) {
    payload.notes = data.notes
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
