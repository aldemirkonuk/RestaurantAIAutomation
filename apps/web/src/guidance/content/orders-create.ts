import type { TourDefinition } from '../tours/registry'

// This tour is not route-resolved (the create-order flow is a modal on
// /orders, not a distinct page). It's started manually from Orders.tsx the
// first time a manager opens the modal — see `resolveGuidancePageId` in
// ../types.ts for the pages that ARE route-resolved.
export const ordersCreateTip = {
  pageId: 'orders-create' as const,
  title: 'Build an order',
  body: 'Pick wines, set quantities, and route them to the right vendor.',
}

export const ordersCreateTour: TourDefinition = {
  pageId: 'orders-create',
  steps: [
    {
      element: '[data-tour="orders-create-wines"]',
      title: 'Pick wines',
      description: 'Click any wine to add it to the order — low-stock wines are worth checking first.',
    },
    {
      element: '[data-tour="orders-create-summary"]',
      title: 'Review the order',
      description: 'Adjust quantities and see providers plus delivery estimates for each wine.',
    },
    {
      element: '[data-tour="orders-create-recurring"]',
      title: 'Make it recurring',
      description: 'Toggle this on to auto-reorder on a schedule instead of doing it manually every time.',
    },
    {
      element: '[data-tour="orders-create-submit"]',
      title: 'Send it',
      description: 'Contact providers to send the order — you can track status from the Orders list after.',
    },
  ],
}
