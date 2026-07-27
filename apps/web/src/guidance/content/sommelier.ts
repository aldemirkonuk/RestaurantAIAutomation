import type { TourDefinition } from '../tours/registry'

export const sommelierTip = {
  pageId: 'sommelier' as const,
  title: 'Sommelier AI',
  body: 'Pick a persona, resume a chat, try a prompt, then ask anything about live inventory.',
}

export const sommelierTour: TourDefinition = {
  pageId: 'sommelier',
  steps: [
    {
      element: '[data-tour="sommelier-persona"]',
      title: 'Pick your model',
      description:
        'Switch Sommelier model for speed vs depth — each tunes answers for a different job.',
    },
    {
      element: '[data-tour="sommelier-history"]',
      title: 'Past conversations',
      description:
        'Resume a chat from Recent, search older threads, or start fresh with New chat.',
    },
    {
      element: '[data-tour="sommelier-prompts"]',
      title: 'Try a starter question',
      description:
        'Tap a suggested prompt for pairings, lists, margins, or inventory checks.',
    },
    {
      element: '[data-tour="sommelier-input"]',
      title: 'Ask anything',
      description:
        'Type your own question about wine, inventory, or sales — press Enter to send.',
    },
  ],
}
