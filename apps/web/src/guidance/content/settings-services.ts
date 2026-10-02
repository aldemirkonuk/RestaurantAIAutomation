import type { TourDefinition } from '../tours/registry'

// Lives at /connections since the Connections page replaced Settings → Services
// (`/settings?tab=services` redirects to `/connections#grants`).
// Steps follow the job, not the screen (ADR 0251 D3). Each element must exist
// on the live page; a step whose element is missing is left out by TourEngine.

export const settingsServicesTip = {
  pageId: 'settings-services' as const,
  title: 'Connections',
  body: 'What the house has attached, what it pays with, and whose own accounts act inside it.',
}

export const settingsServicesTour: TourDefinition = {
  pageId: 'settings-services',
  steps: [
    {
      element: 'section#attached',
      title: 'What the house has attached',
      description:
        'The till, the payment provider and the other services attached here, each saying whose it is. What belongs to the house stays when the person who connected it leaves.',
    },
    {
      element: 'section#payment',
      title: 'What the house pays with',
      description:
        'The payment details on file for this house, as the provider gave them.',
    },
    {
      element: 'section#grants',
      title: 'Accounts that belong to a person',
      description:
        "A person's own accounts that act inside this house. They are listed here because they act here.",
    },
  ],
}
