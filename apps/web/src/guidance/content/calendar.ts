import type { TourDefinition } from '../tours/registry'

// Steps follow the job, not the screen (ADR 0251 D3). Each element must exist
// on the live page; a step whose element is missing is left out by TourEngine.

export const calendarTip = {
  pageId: 'calendar' as const,
  title: 'Calendar',
  body: 'Deliveries, tastings and meetings, by day. Put something in the book, or see it on your own phone.',
}

export const calendarTour: TourDefinition = {
  pageId: 'calendar',
  steps: [
    {
      element: 'header.cn-head button[data-primary="true"]',
      title: 'Put something in the book',
      description:
        'A delivery, a tasting or a meeting, on the day it happens.',
    },
    {
      element: '[role="grid"][aria-label^="Month ledger"]',
      title: 'Read the month',
      description:
        'Each day shows what is booked. Pick a day to see it in full.',
    },
    {
      element: '[aria-label="Search the entries in this period"]',
      title: 'Find an entry',
      description:
        'Search everything booked in the period you are looking at.',
    },
    {
      element: '[data-tour="calendar-connect"]',
      title: 'See it on your own calendar',
      description:
        'Get your own link, and the entries show up in the calendar app on your phone.',
    },
  ],
}
