import type { TourDefinition } from '../tours/registry'

// Rewritten 2026-10-01 (walk-through COMMS-W6): the old copy described the
// legacy page's four workspaces and template builder, deleted 2026-09-28, and
// every step pointed at an anchor no page rendered, so "Take tour" could only
// say the tour was unavailable.
export const communicationsTip = {
  pageId: 'communications' as const,
  title: 'Communications',
  body: 'What waits on you sits at the top. Below it is every letter to and from your vendors, newest first.',
}

export const communicationsTour: TourDefinition = {
  pageId: 'communications',
  steps: [
    {
      element: '[data-tour="communications-waiting"]',
      title: 'Waiting on you',
      description:
        'Letters your staff asked you to send, replies the house drafted on orders, and letters the house drafted for you. Nothing here has been sent.',
    },
    {
      element: '[data-tour="communications-book"]',
      title: 'The conversation book',
      description:
        'Every letter to and from your vendors, newest first. Open a row to read it and to see whether it was sent.',
    },
    {
      element: '[data-tour="communications-write"]',
      title: 'Write to a vendor',
      description: "Write a letter from a blank page, or start from one of the house's templates.",
    },
    {
      element: '[data-tour="communications-senders"]',
      title: 'Who is writing',
      description:
        'The vendor addresses you trust, and mail from senders who are not your vendors yet.',
    },
  ],
}
