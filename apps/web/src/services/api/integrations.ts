import { apiClient } from './client'

/**
 * Kept in step with `integrations-oauth.constants.ts` on the gateway, which is
 * the one source of truth. Nothing in the UI may VALIDATE against this list —
 * see the note on `AuthorizeIntegration.tsx`: a hard-coded copy of the
 * catalogue is how `gmail_send` shipped on 2026-09-04 with a Connect button
 * that led to "unknown integration".
 */
export type IntegrationId = 'google_drive' | 'excel' | 'gmail_send' | 'gmail_read'
export type IntegrationProvider = 'google' | 'microsoft'

export interface ScopeDisclosure {
  scope: string
  label: string
  reason: string
}

/**
 * What happens to what the grant fetches — the three questions a scope list
 * cannot answer. Served by the gateway rather than written into the page, so a
 * privacy sentence cannot drift from what the server actually does.
 *
 * Optional on the client only: a gateway deployed before 2026-09-04 does not
 * send it, and the page renders nothing rather than inventing a reassurance.
 */
export interface DataHandlingDisclosure {
  reads: string
  doesNotRead: string
  landsIn: string
  visibleTo: string
}

export interface IntegrationCatalogEntry {
  id: IntegrationId
  provider: IntegrationProvider
  label: string
  providerLabel: string
  description: string
  scopes: ScopeDisclosure[]
  notRequested: string[]
  dataHandling?: DataHandlingDisclosure
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
