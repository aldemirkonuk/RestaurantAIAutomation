import type { TourDefinition } from '../tours/registry'

export const reportsTip = {
  pageId: 'reports' as const,
  title: 'Reports',
  body: 'A customizable dashboard of your revenue, orders, and inventory trends.',
}

export const reportsTour: TourDefinition = {
  pageId: 'reports',
  steps: [
    {
      element: '[data-tour="reports-topbar"]',
      title: 'Time range & export',
      description: 'Switch time windows, compare periods, or export the current view.',
    },
    {
      element: '[data-tour="reports-canvas"]',
      title: 'Drag-and-drop dashboard',
      description: 'Rearrange, resize, or add chart blocks — your layout is saved automatically.',
    },
    {
      element: '[data-tour="reports-ai-pill"]',
      title: 'Ask about your data',
      description: 'Open the AI command palette (⌘K) to ask questions about revenue, orders, or trends in plain English.',
    },
  ],
}
