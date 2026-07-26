import type { TourDefinition } from '../tours/registry'

export const sommelierTip = {
  pageId: 'sommelier' as const,
  title: 'Sommelier AI',
  body: 'Ask about pairings, margins, or low stock — it knows your live inventory.',
}

export const sommelierTour: TourDefinition = {
  pageId: 'sommelier',
  steps: [
    {
      element: '[data-tour="sommelier-prompts"]',
      title: 'Try a suggested prompt',
      description: 'Pairing, sales analysis, customer insights, or inventory checks — pick one to see it in action.',
    },
    {
      element: '[data-tour="sommelier-persona"]',
      title: 'Switch persona',
      description: 'Sommelier, Buyer, or Floor training — each tunes answers for a different job.',
    },
    {
      element: '[data-tour="sommelier-input"]',
      title: 'Ask anything',
      description: 'Type your own question about wine, inventory, or sales — press Enter to send.',
    },
  ],
}
