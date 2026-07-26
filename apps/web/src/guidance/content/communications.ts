import type { TourDefinition } from '../tours/registry'

export const communicationsTip = {
  pageId: 'communications' as const,
  title: 'Communications',
  body: 'Templates, send history, and scheduled reports — all in one place.',
}

export const communicationsTour: TourDefinition = {
  pageId: 'communications',
  steps: [
    {
      element: '[data-tour="communications-tabs"]',
      title: 'Four views',
      description: 'Templates, send history, scheduled reports, and procurement emails each get their own tab.',
    },
    {
      element: '[data-tour="communications-new-template"]',
      title: 'Build a template',
      description: 'Create reusable email or SMS templates with a drag-and-drop canvas.',
    },
  ],
}
