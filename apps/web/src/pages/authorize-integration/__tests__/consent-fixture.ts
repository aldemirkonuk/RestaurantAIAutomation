import type { IntegrationCatalogEntry, IntegrationConsentDisclosure, RetentionDisclosure } from '../../../services/api/integrations'

export function consentFixture(integration: IntegrationCatalogEntry, retention: RetentionDisclosure | null = null): IntegrationConsentDisclosure {
  return { version: 1, integration, retention, digest: 'a'.repeat(64), statements: {
    personalAccount: 'You are granting access to your own account.',
    providerNext: `${integration.providerLabel} will ask you to confirm on their own screen next.`,
    tokenStorage: 'Access tokens are encrypted before they are stored.',
    revocation: 'You can revoke this permission from your personal connections in Profile or Settings.',
    retentionCadence: 'The stored retention window is reviewed by the quarterly derivation.',
  } }
}
