import type { TourDefinition } from '../tours/registry'

export const calendarTip = {
  pageId: 'calendar' as const,
  title: 'Calendar',
  body: 'Add events, switch views, filter types, then drag on the grid to reschedule.',
}

export const calendarTour: TourDefinition = {
  pageId: 'calendar',
  steps: [
    {
      element: '[data-tour="calendar-new-event"]',
      title: 'Schedule something',
      description:
        'Create tastings, deliveries, meetings, or reminders without leaving the calendar.',
    },
    {
      element: '[data-tour="calendar-view-switcher"]',
      title: 'Change the view',
      description:
        'Month, week, day, or agenda — pick the scale that matches how you plan the week.',
    },
    {
      element: '[data-tour="calendar-sidebar"]',
      title: 'Navigate & filter',
      description:
        'Jump dates on the mini calendar and toggle event types to focus on what matters now.',
    },
    {
      element: '[data-tour="calendar-grid"]',
      title: 'Main calendar',
      description:
        'Click a day or slot to create an event; drag to move or resize existing ones.',
    },
  ],
}
