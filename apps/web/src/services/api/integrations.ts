import { apiClient } from './client'

export type IntegrationId = 'google_drive' | 'excel'
export type IntegrationProvider = 'google' | 'microsoft'

export interface ScopeDisclosure {
  scope: string
  label: string
  reason: string
}

export interface IntegrationCatalogEntry {
  id: IntegrationId
  provider: IntegrationProvider
  label: string
  providerLabel: string
  description: string
  scopes: ScopeDisclosure[]
  notRequested: string[]
  available: boolean
  unavailableReason: string | null
}

export interface IntegrationConnection {
  integrationId: IntegrationId
  provider: IntegrationProvider
  connected: boolean
  account: string | null
  scopes: string[]
  connectedAt: string | null
}

export const integrationsApi = {
  /**
   * Scope disclosure comes from the server so the consent screen always shows
   * the scopes that will actually be requested.
   */
  async getCatalog(): Promise<IntegrationCatalogEntry[]> {
    const { data } = await apiClient.get<{
      success: boolean
      integrations: IntegrationCatalogEntry[]
    }>('/integrations/oauth/catalog')
    return data.integrations
  },

  async getConnections(): Promise<IntegrationConnection[]> {
    const { data } = await apiClient.get<{
      success: boolean
      connections: IntegrationConnection[]
    }>('/integrations/oauth/connections')
    return data.connections
  },

  /** Returns the provider consent URL to navigate to. */
  async authorize(id: IntegrationId, returnPath: string): Promise<string> {
    const { data } = await apiClient.post<{
      success: boolean
      authorizationUrl: string
    }>(`/integrations/oauth/${id}/authorize`, null, { params: { returnPath } })
    return data.authorizationUrl
  },

  async disconnect(id: IntegrationId): Promise<void> {
    await apiClient.delete(`/integrations/oauth/${id}`)
  },
}
