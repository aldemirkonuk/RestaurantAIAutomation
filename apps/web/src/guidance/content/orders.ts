import type { TourDefinition } from '../tours/registry'

export const ordersTip = {
  pageId: 'orders' as const,
  title: 'Orders',
  body: 'Filter by pipeline stage, find a PO, then create or follow it through delivery.',
}

export const ordersTour: TourDefinition = {
  pageId: 'orders',
  steps: [
    {
      element: '[data-tour="orders-status"]',
      title: 'Pipeline at a glance',
      description:
        'Click a stage card (Pending, Approved, Ordered, Delivered) to filter the list to that status.',
    },
    {
      element: '[data-tour="orders-toolbar"]',
      title: 'Find and switch views',
      description:
        'Search by wine or vendor (/), toggle Unified vs Split, or export the current list.',
    },
    {
      element: '[data-tour="orders-list"]',
      title: 'Work the order table',
      description:
        'Open a row for details, select rows for bulk approve/order/deliver, or jump into a vendor thread.',
    },
    {
      element: '[data-tour="orders-create"]',
      title: 'Start an order',
      description:
        'Open the PO builder when inventory flags low stock (⌘N). You will pick wines, quantities, and a vendor next.',
    },
  ],
}
