import type { TourDefinition } from '../tours/registry'

export const settingsServicesTip = {
  pageId: 'settings-services' as const,
  title: 'Services & permissions',
  body: 'Everything here is opt-in — email, web apps, and privacy toggles stay under your control.',
}

export const settingsServicesTour: TourDefinition = {
  pageId: 'settings-services',
  steps: [
    {
      element: '[data-tour="services-intro"]',
      title: 'What this page controls',
      description:
        'Optional access for email, web, and privacy — separate from product tours and Wine Agent.',
    },
    {
      element: '[data-tour="services-email"]',
      title: 'Email access',
      description:
        'Allow operational email (invites, digests) from your connected sender. Does not open a mailbox for Wine Agent.',
    },
    {
      element: '[data-tour="services-web"]',
      title: 'Web & connected apps',
      description:
        'Manage calendar feeds and vendor link permissions. Revoke anytime.',
    },
    {
      element: '[data-tour="services-privacy"]',
      title: 'Privacy choices',
      description:
        'Turn product analytics on or off. Partner data sharing stays off until you connect a partner.',
    },
  ],
}
