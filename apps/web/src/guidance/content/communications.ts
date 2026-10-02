import type { TourDefinition } from '../tours/registry'

// Steps follow the job, not the screen (ADR 0251 D3). Each element must exist
// on the live page; a step whose element is missing is left out by TourEngine.

export const communicationsTip = {
  pageId: 'communications' as const,
  title: 'Communications',
  body: 'Your latest letters with vendors, and the letters drafted for you.',
}

export const communicationsTour: TourDefinition = {
  pageId: 'communications',
  steps: [
    {
      element: 'section[aria-label="Conversation book"]',
      title: 'Read the book',
      description:
        'The latest letters between you and your vendors.',
    },
    {
      element: 'section[aria-label="Drafts waiting"]',
      title: 'Answer what is drafted',
      description:
        'Letters drafted for you. Read one and change it if you need to, then hold to send it, or to ask a manager to send it.',
    },
    {
      element: '[data-tour="comms-write"]',
      title: 'Write a letter',
      description:
        "Write to a vendor from scratch, or start from one of the house's templates.",
    },
    {
      element: 'section[aria-label="Who is writing"]',
      title: 'Know who is writing',
      description:
        'People who wrote to the house. An owner or a manager can trust one, or add them as a vendor.',
    },
  ],
}
