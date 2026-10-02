import type { TourDefinition } from '../tours/registry'

// Steps follow the job, not the screen (ADR 0251 D3). Each element must exist
// on the live page; a step whose element is missing is left out by TourEngine.

export const reportsTip = {
  pageId: 'reports' as const,
  title: 'Reports',
  body: 'Sales, costs, stock and more on one sheet. Search what the engine has already said, or arrange the sheet your way.',
}

export const reportsTour: TourDefinition = {
  pageId: 'reports',
  steps: [
    {
      element: '.rp-sheet',
      title: 'Read the sheet',
      description:
        'Sales, costs, stock and more, each over the window printed under its title. A figure the engine could not work out prints as a dash.',
    },
    {
      element: '[data-tour="reports-ask"]',
      title: 'Ask the book',
      description:
        'Search what the engine has already said from your own rows. It does not answer free-text questions. ⌘K opens it too.',
    },
    {
      element: '[data-tour="reports-arrange"]',
      title: 'Arrange it your way',
      description:
        'Move, resize, swap or take off parts of the sheet, then rule it off to keep it as yours. Put it all back starts again from the default sheet.',
    },
    {
      element: '#rp-exports',
      title: 'Take it with you',
      description:
        'Owners and managers pick a part of the sheet and write it up as a CSV and a page laid out for print.',
    },
  ],
}
