import type { TourDefinition } from '../tours/registry'

// Steps follow the job, not the screen (ADR 0251 D3). Each element must exist
// on the live page; a step whose element is missing is left out by TourEngine.
//
// One text for every role (ADR 0258): staff see counts, never money (DASH-W22);
// whether you may approve is decided per order, not by role (DASH-W21); the
// page counts items, never wines (DASH-W37).

export const dashboardTip = {
  pageId: 'dashboard' as const,
  title: 'Dashboard',
  body: 'The day in one glance: what the cellar holds, what is running low, and what waits on you.',
}

export const dashboardTour: TourDefinition = {
  pageId: 'dashboard',
  steps: [
    {
      element: '[data-tour="dashboard-kpis"]',
      title: 'Read the day',
      description:
        'What the cellar holds, what is running low, what waits on you, and what has come in from vendors. Most figures open their page.',
    },
    {
      element: 'section[aria-label="Waiting on you"]',
      title: 'See what waits for approval',
      description:
        'Orders that need approval land here. Open one; if you may approve it, hold to approve.',
    },
    {
      element: 'section[aria-label="Running low"]',
      title: 'See what is running low',
      description:
        'Items below their minimum, the furthest below first. Inventory opens every item.',
    },
    {
      element: '[data-testid="one-tap-open-sheet"]',
      title: 'Leave yourself a one-tap action',
      description:
        'Write down a piece of work, and it waits here until someone does it.',
    },
  ],
}
