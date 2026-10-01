import type { TourDefinition } from '../tours/registry'

// Steps follow the job, not the screen (ADR 0251 D3). Each element must exist
// on the live page; a step whose element is missing is left out by TourEngine.

export const communicationsTip = {
  pageId: 'communications' as const,
  title: 'Communications',
  body: 'Every letter with your vendors in one book, and the replies drafted for you.',
}

export const communicationsTour: TourDefinition = {
  pageId: 'communications',
  steps: [
    {
      element: 'section[aria-label="Conversation book"]',
      title: 'Read the book',
      description:
        'Every conversation with your vendors, in one place.',
    },
    {
      element: 'section[aria-label="Drafts waiting"]',
      title: 'Answer what is drafted',
      description:
        'Replies drafted for you. Read one, change it if you need to, and send it.',
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
        'People who wrote to the house. Trust one, or add them as a vendor.',
    },
  ],
}
