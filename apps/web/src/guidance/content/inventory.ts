import type { TourDefinition } from '../tours/registry'

// Steps follow the job, not the screen (ADR 0251 D3). Each element must exist
// on the live page; a step whose element is missing is left out by TourEngine.

export const inventoryTip = {
  pageId: 'inventory' as const,
  title: 'Inventory',
  body: 'What is on hand, what is running low, and what needs a look before service.',
}

export const inventoryTour: TourDefinition = {
  pageId: 'inventory',
  steps: [
    {
      element: '[data-tour="inventory-filters"]',
      title: 'Know what you hold',
      description:
        'How many wines and bottles the house holds right now.',
    },
    {
      element: '[data-tour="inventory-below-par"]',
      title: 'Find what is running low',
      description:
        'Tap Below par to show only the wines under their par, so you can order before service.',
    },
    {
      element: '[data-tour="inventory-attention"]',
      title: 'Clear what needs attention',
      description:
        'Invoices to match and POS lines moving no stock show here when there are any. Each chip after them shows only the wines it names.',
    },
    {
      element: '[data-tour="inventory-actions"]',
      title: 'Count the cellar or add a wine',
      description:
        'Switch between the table and the cellar map, print a count sheet, or add a wine.',
    },
  ],
}
