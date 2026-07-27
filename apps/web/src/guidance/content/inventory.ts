import type { TourDefinition } from '../tours/registry'

export const inventoryTip = {
  pageId: 'inventory' as const,
  title: 'Inventory Command',
  body: 'Read cellar health, clear the attention queue, then act from the toolbar.',
}

export const inventoryTour: TourDefinition = {
  pageId: 'inventory',
  steps: [
    {
      element: '[data-tour="inventory-filters"]',
      title: 'Inventory overview',
      description:
        'See total wines and bottles on hand before you dig into filters or the table.',
    },
    {
      element: '[data-tour="inventory-low-stock"]',
      title: 'Health signals',
      description:
        'Tap Below par or Runway alerts to spotlight stockouts before service.',
    },
    {
      element: '[data-tour="inventory-attention"]',
      title: 'Needs attention',
      description:
        'Match invoices and jump filters for reconcile / low / critical work without leaving the page.',
    },
    {
      element: '[data-tour="inventory-actions"]',
      title: 'Take action',
      description:
        'Switch Table vs Cellar Map, export count sheets, manage locations, or add a wine.',
    },
  ],
}
