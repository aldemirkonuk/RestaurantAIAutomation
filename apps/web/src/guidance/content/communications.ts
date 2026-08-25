import type { TourDefinition } from '../tours/registry'

export const communicationsTip = {
  pageId: 'communications' as const,
  title: 'Communications',
  body: 'Pick a workspace, filter by channel, then build or reuse a template.',
}

export const communicationsTour: TourDefinition = {
  pageId: 'communications',
  steps: [
    {
      element: '[data-tour="communications-tabs"]',
      title: 'Four workspaces',
      description:
        'Switch between Templates, Send History, Scheduled Reports, and Procurement Emails.',
    },
    {
      element: '[data-tour="communications-channels"]',
      title: 'Filter by channel',
      description:
        'Show all templates or only Email or SMS before you create or edit one.',
    },
    {
      element: '[data-tour="communications-new-template"]',
      title: 'Create a template',
      description:
        'Start an email canvas or SMS template with preview — reusable for the next send.',
    },
    {
      element: '[data-tour="communications-template-library"]',
      title: 'Saved templates',
      description:
        'Edit, duplicate, or send from templates you already built.',
    },
  ],
}
