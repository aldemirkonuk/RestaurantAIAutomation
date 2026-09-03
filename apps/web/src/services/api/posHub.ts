import { apiClient, getActiveRestaurantId } from './client'

export type ProviderTier =
  | 'cloud'
  | 'enterprise'
  | 'partner_gated'
  | 'regional_tr'
  | 'universal'

export type AdapterStatus = 'available' | 'partial' | 'scaffolded' | 'planned'

export interface PosProviderMeta {
  key: string
  name: string
  tier: ProviderTier
  status: AdapterStatus
  region: 'global' | 'us' | 'eu' | 'tr'
  apiStyle: 'rest' | 'webhook' | 'partner' | 'file'
  authModel: 'oauth2' | 'api_key' | 'partner_agreement' | 'none'
  docsUrl?: string
  notes?: string
  capabilities: {
    checks: boolean
    items: boolean
    tables: boolean
    employees: boolean
    webhooks: boolean
  }
}

export interface PosProvidersResponse {
  summary: {
    total: number
    byTier: Record<string, number>
    byStatus: Record<string, number>
  }
  providers: PosProviderMeta[]
}

export interface PosStatusResponse {
  /**
   * True when the `pos_checks` read FAILED. `sources` is then null, not an
   * empty array — a dead read and a quiet integration are different answers
   * and must not render the same. ADR 0067.
   */
  unavailable?: boolean
  totalChecks?: number | null
  sources?: Array<{
    source: string
    checks?: number
    open?: number
    latest?: string | null
    providerName?: string
  }> | null
  [key: string]: unknown
}

export async function getPosProviders(): Promise<PosProvidersResponse> {
  const { data } = await apiClient.get<PosProvidersResponse>('/pos-hub/providers')
  return data
}

export async function getPosStatus(restaurantId?: string): Promise<PosStatusResponse> {
  const id = restaurantId || getActiveRestaurantId()
  if (!id) throw new Error('No restaurant ID available')
  const { data } = await apiClient.get<PosStatusResponse>(`/pos-hub/status/${id}`)
  return data
}
