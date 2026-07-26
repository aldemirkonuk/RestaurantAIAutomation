import type { TourDefinition } from '../tours/registry'

export const settingsServicesTip = {
  pageId: 'settings-services' as const,
  title: 'Services & permissions',
  body: 'Control what WineOps can access — email, web, and privacy are all optional.',
}

export const settingsServicesTour: TourDefinition = {
  pageId: 'settings-services',
  steps: [
    {
      element: '[data-guidance="services-permissions"]',
      title: 'Nothing is on by default',
      description: 'Each service below is opt-in. Turning one off never removes data you already have.',
    },
  ],
}
