import type { TourDefinition } from '../tours/registry'

export const providersTip = {
  pageId: 'providers' as const,
  title: 'Providers',
  body: 'Add vendors so WineOps can source and communicate for you.',
}

export const providersTour: TourDefinition = {
  pageId: 'providers',
  steps: [
    {
      element: '[data-tour="providers-list"]',
      title: 'Your vendors',
      description: 'Each card is a supplier you order from.',
    },
    {
      element: '[data-tour="providers-add"]',
      title: 'Add a vendor',
      description: 'Search or create your first provider to unlock ordering.',
    },
  ],
}
