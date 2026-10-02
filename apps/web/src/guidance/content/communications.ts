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
      // COMMS-W38 (founder: "#571's order, step 2 widened"): the whole waiting
      // region, which is always drawn; "Drafts waiting" is drawn only while a
      // drafted reply waits, and letters staff asked a manager to send sit
      // beside it.
      element: 'section[aria-label="Waiting on you"]',
      title: 'Answer what waits',
      description:
        'Letters your staff asked you to send and replies drafted for you. Read one, change it if you need to, then hold to send it, or to ask a manager to send it.',
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
