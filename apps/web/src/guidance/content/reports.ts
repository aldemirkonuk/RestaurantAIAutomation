import type { TourDefinition } from '../tours/registry'

export const reportsTip = {
  pageId: 'reports' as const,
  title: 'Reports',
  body: 'Set the time window, arrange charts, read the canvas, then search the insights behind the numbers.',
}

export const reportsTour: TourDefinition = {
  pageId: 'reports',
  steps: [
    {
      element: '[data-tour="reports-topbar"]',
      title: 'Time range & export',
      description:
        'Switch 7D / 30D / 90D, compare periods, or export the data behind the current view.',
    },
    {
      element: '[data-tour="reports-edit-layout"]',
      title: 'Customize the dashboard',
      description:
        'Turn on Edit Layout to add blocks, apply a preset, or reset the canvas to a clean default.',
    },
    {
      element: '[data-tour="reports-canvas"]',
      title: 'Your analytics canvas',
      description:
        'Drag and resize charts in edit mode. Click a KPI tile for a deeper spotlight panel.',
    },
    {
      element: '[data-tour="reports-ai-pill"]',
      title: 'Search your insights',
      description:
        'Open the palette (⌘K) to filter the insights the analytics engine computed from your data. It does not answer free-text questions yet.',
    },
  ],
}
