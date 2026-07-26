import type { TourDefinition } from '../tours/registry'

export const inventoryTip = {
  pageId: 'inventory' as const,
  title: 'Inventory Command',
  body: 'See stock, alerts, and reorder points — the main surface for cellar ops.',
}

export const inventoryTour: TourDefinition = {
  pageId: 'inventory',
  steps: [
    {
      element: '[data-tour="inventory-filters"]',
      title: 'Find bottles fast',
      description: 'Filter by style, location, or low stock before service.',
    },
    {
      element: '[data-tour="inventory-low-stock"]',
      title: 'Low-stock signals',
      description: 'Items under reorder point appear here so nothing runs dry mid-shift.',
    },
    {
      element: '[data-tour="inventory-actions"]',
      title: 'Take action',
      description: 'Adjust counts or start an order without leaving the page.',
    },
  ],
}
