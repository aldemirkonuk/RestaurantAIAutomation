import type { TourDefinition } from '../tours/registry'

export const ordersTip = {
  pageId: 'orders' as const,
  title: 'Orders',
  body: 'Create and track vendor orders from low-stock to delivery.',
}

export const ordersTour: TourDefinition = {
  pageId: 'orders',
  steps: [
    {
      element: '[data-tour="orders-list"]',
      title: 'Order pipeline',
      description: 'See pending, sent, and received orders in one place.',
    },
    {
      element: '[data-tour="orders-create"]',
      title: 'Start an order',
      description: 'Build a PO when inventory flags low stock.',
    },
  ],
}
