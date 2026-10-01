import type { TourDefinition } from '../tours/registry'

// Steps follow the job, not the screen (ADR 0251 D3). Each element must exist
// on the live page; a step whose element is missing is left out by TourEngine.

export const providersTip = {
  pageId: 'providers' as const,
  title: 'Vendors',
  body: 'Start with the vendors who supply your menu, and find new ones when you need them.',
}

export const providersTour: TourDefinition = {
  pageId: 'providers',
  steps: [
    {
      element: '[data-testid="scope-menu"]',
      title: 'Start with your menu',
      description:
        'The vendors behind the wines on your menu: the ones you order from.',
    },
    {
      element: '[data-testid="pv-view-toggle"]',
      title: 'Read a vendor',
      description:
        'The book holds a card for each vendor. The scorecard sets them side by side.',
    },
    {
      element: '[data-testid="scope-find"]',
      title: 'Find someone new',
      description:
        'Search vendors you do not buy from yet, by wine or by country.',
    },
    {
      element: '[data-testid="add-vendor"]',
      title: 'Add a vendor',
      description:
        'Add a vendor you already work with, so you can order from them.',
    },
  ],
}
