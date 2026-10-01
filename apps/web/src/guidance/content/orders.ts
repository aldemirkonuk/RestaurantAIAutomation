import type { TourDefinition } from '../tours/registry'

// Steps follow the job, not the screen (ADR 0251 D3). Each element must exist
// on the live page; a step whose element is missing is left out by TourEngine.

export const ordersTip = {
  pageId: 'orders' as const,
  title: 'Orders',
  body: 'Write an order, approve it, follow it, and check it in when it arrives.',
}

export const ordersTour: TourDefinition = {
  pageId: 'orders',
  steps: [
    {
      element: '[data-testid="write-order"]',
      title: 'Write an order',
      description:
        'Choose a vendor and the wines. The order waits as a draft until it is approved.',
    },
    {
      element: '[data-tour="orders-stage-pending"]',
      title: 'Approve it',
      description:
        'Drafts wait here. Open one and hold to approve it.',
    },
    {
      element: '[data-tour="orders-stage-ordered"]',
      title: 'Follow it',
      description:
        'Sent orders wait here until they arrive. Open one and mark it delivered.',
    },
    {
      element: '[data-tour="orders-stage-delivered"]',
      title: 'Check what arrived',
      description:
        'Orders that arrived, each with what came and its receipt.',
    },
  ],
}
