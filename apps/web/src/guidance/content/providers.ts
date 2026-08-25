import type { TourDefinition } from '../tours/registry'

export const providersTip = {
  pageId: 'providers' as const,
  title: 'Providers',
  body: 'Search, filter, and open vendor cards — or add a new supplier to unlock ordering.',
}

export const providersTour: TourDefinition = {
  pageId: 'providers',
  steps: [
    {
      element: '[data-tour="providers-search"]',
      title: 'Search providers',
      description:
        'Find vendors by name, portfolio, or region. Press / to focus the search field.',
    },
    {
      element: '[data-tour="providers-filters"]',
      title: 'Filter the directory',
      description:
        'Slice by distributor type, favorites, or rating, then switch Grid / Compact / List.',
    },
    {
      element: '[data-tour="providers-list"]',
      title: 'Your vendor cards',
      description:
        'Open a card for contacts and ratings. Use Call / Email chips for quick outreach.',
    },
    {
      element: '[data-tour="providers-add"]',
      title: 'Add a vendor',
      description:
        'Browse the catalogue or add a custom supplier so WineOps can source and message for you.',
    },
  ],
}
