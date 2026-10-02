import type { TourDefinition } from '../tours/registry'

// Steps follow the job, not the screen (ADR 0251 D3). Each element must exist
// on the live page; a step whose element is missing is left out by TourEngine.

export const ordersTip = {
  pageId: 'orders' as const,
  title: 'Orders',
  body: 'Write an order, approve it, follow it, and mark it delivered when it arrives.',
}

export const ordersTour: TourDefinition = {
  pageId: 'orders',
  steps: [
    {
      element: '[data-testid="write-order"]',
      title: 'Write an order',
      description:
        'Add what you need from the shelf and name a vendor for each line. Each line becomes a pending order waiting for approval; nothing is sent to a vendor yet.',
    },
    {
      element: '[data-tour="orders-stage-pending"]',
      title: 'Approve it',
      description:
        'Orders waiting for approval. Open one and hold to approve it. If it needs a manager or an owner, the hold stays shut and says who it is waiting on.',
    },
    {
      element: '[data-tour="orders-stage-ordered"]',
      title: 'Follow it',
      description:
        'Orders placed with the vendor stay here until they arrive. When one is at the door, open it and mark it delivered.',
    },
    {
      element: '[data-tour="orders-stage-delivered"]',
      title: 'Check what arrived',
      description:
        'Orders that arrived. Open one to see its receipt; if none has been attached yet, it says so.',
    },
  ],
}
