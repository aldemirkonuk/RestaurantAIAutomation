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
  /**
   * How long what is fetched is kept, and what a disconnect does to it
   * (ADR 0118, retention). Optional on the client only, for the same reason the
   * block itself is: a gateway deployed before 2026-09-05 does not send it, and
   * the page renders nothing rather than inventing a reassurance about
   * deletion.
   */
  keptFor?: string
}

/** One statute, with the URL it was read from and the date it was read. */
export interface StatuteCitation {
  statute: string
  says: string
  url: string
  fetchedOn: string
}

/**
 * `GET /communications/retention/disclosure` — the per-house half of the
 * retention disclosure (ADR 0118).
 *
 * The gateway route lives under `communications` because retention of mirrored
 * mail is a fact about the reading, not about the integration record; it is
 * called from here because the consent screen is the one page that needs it.
 * Nothing on the page may compose these sentences or this figure itself.
 */
export interface RetentionDisclosure {
  restaurantId: string
  figureDays: number
  figureFrom: 'stored_derivation' | 'measured_now'
  storedAt: string | null
  wouldBeDays: number | null
  basis: string
  jurisdiction: {
    code: string
    label: string
    factsFloorYears: number
    bindsCorrespondence: boolean
    why: string
    defaultedBecause: string | null
    citations: StatuteCitation[]
  }
  storageLimitation: StatuteCitation[]
  split: string
  revocation: string
  windowIntro: string
  /**
   * The house's own archive of the mail (ADR 0118 D16). Optional because a
   * gateway deployed before 2026-09-05 does not send it, and NULLABLE because
   * the gateway itself sends null when the archive service is absent — the page
   * prints that state rather than omitting the section, since a section that
   * vanishes on a failed read is the silence this ADR ended.
   */
  archive?: ArchiveDisclosure | null
  /** Which grants this disclosure covers. Never hard-code an id against it. */
  appliesTo: string[]
}

/**
 * What the consent screen prints about keeping the mail past the window. Every
 * sentence is the SERVER's; nothing on the page composes one (ADR 0118 D16).
 */
export interface ArchiveDisclosure {
  mode: 'own_cloud' | 'mudavym_archive' | 'none'
  /** FALSE means nobody has been asked, which is not a recorded `none`. */
  chosen: boolean
  armed: boolean
  says: string
  intro: string
  options: { ownCloud: string; mudavym: string; none: string }
  /** Non-null while OD-23 is open, which is every deployment today. */
  paidTierRefusal: string | null
  /** Set only where the statute reaches the correspondence itself. */
  jurisdictionNote: string | null
  layout: string
  /** Why the archive could not be described, when it could not be. */
  unavailableBecause: string | null
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
  /**
   * Whether consenting puts a copy of the person's mail into the house's book,
   * and therefore whether the per-house retention disclosure applies (ADR
   * 0118). Optional on the client only: a gateway deployed before 2026-09-05
   * does not send it, and on such a deployment there is no retention rule to
   * describe, so absent reads as false rather than as unknown.
   */
  mirrorsMail?: boolean
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

  /**
   * How long this house keeps mirrored mail, and what revoking does to it.
   *
   * Separate from `getCatalog` on purpose: the catalogue is the same for every
   * house on the deployment and this is not — the figure is derived from THIS
   * restaurant's own disputes and the floor from THIS restaurant's country. A
   * single call would have made a per-house number look like a constant.
   */
  async getRetentionDisclosure(): Promise<RetentionDisclosure> {
    const { data } = await apiClient.get<{
      success: boolean
      retention: RetentionDisclosure
    }>('/communications/retention/disclosure')
    return data.retention
  },
}
