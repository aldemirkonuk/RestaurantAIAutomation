import type { TourDefinition } from '../tours/registry'

export const calendarTip = {
  pageId: 'calendar' as const,
  title: 'Calendar',
  body: 'Track deliveries, tastings, and reminders — and subscribe from your phone.',
}

export const calendarTour: TourDefinition = {
  pageId: 'calendar',
  steps: [
    {
      element: '[data-tour="calendar-new-event"]',
      title: 'Add an event',
      description: 'Deliveries, tastings, meetings, or reminders — click a day or use New Event.',
    },
    {
      element: '[data-tour="calendar-sidebar"]',
      title: 'Filter by type',
      description: 'Toggle event types on or off to focus on what matters right now.',
    },
    {
      element: '[data-tour="calendar-view-switcher"]',
      title: 'Change your view',
      description: 'Month, week, day, or agenda — switch to whatever fits your shift.',
    },
  ],
}
