import type { TourDefinition } from '../tours/registry'

// Steps follow the job, not the screen (ADR 0251 D3). Each element must exist
// on the live page; a step whose element is missing is left out by TourEngine.

export const reportsTip = {
  pageId: 'reports' as const,
  title: 'Reports',
  body: 'Sales, costs and stock on one sheet. Ask it a question, or arrange it your way.',
}

export const reportsTour: TourDefinition = {
  pageId: 'reports',
  steps: [
    {
      element: '.rp-sheet',
      title: 'Read the sheet',
      description:
        'Sales, costs and stock for the period. A figure that could not be worked out says so; it is never shown as 0.',
    },
    {
      element: '[data-tour="reports-ask"]',
      title: 'Ask the book',
      description:
        'Ask a question in plain words. ⌘K opens it too.',
    },
    {
      element: '[data-tour="reports-arrange"]',
      title: 'Arrange it your way',
      description:
        'Move and hide parts of the sheet, then rule it off. Put it all back undoes it.',
    },
    {
      element: '#rp-exports',
      title: 'Take it with you',
      description:
        'Write the sheet up as a CSV, or as a page laid out for print.',
    },
  ],
}
