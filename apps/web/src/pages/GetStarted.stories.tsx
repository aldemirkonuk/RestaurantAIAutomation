import type { Meta, StoryObj } from '@storybook/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  Package,
  ShoppingCart,
  Bot,
  Shield,
  ArrowRight,
} from 'lucide-react'

/** Static preview of the Use the app tab (no auth / API). */
function GetStartedUsePreview() {
  const cards = [
    {
      title: 'Check inventory & alerts',
      description: 'See stock levels, low-stock signals, and cellar locations.',
      icon: Package,
    },
    {
      title: 'Wine Agent',
      description:
        'After setup, a small Wine Agent button appears bottom-right. It does not access your email.',
      icon: Bot,
    },
    {
      title: 'Services & permissions',
      description: 'Control email, web, and privacy access — optional.',
      icon: Shield,
    },
    {
      title: 'Create & track orders',
      description: 'Turn low stock into vendor orders.',
      icon: ShoppingCart,
    },
  ]

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-3">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">How to use WineOps</h1>
        <p className="text-sm text-gray-500 mt-1">Activate + Use guide preview</p>
      </div>
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <div
            key={card.title}
            className="flex items-center gap-4 p-4 rounded-xl border border-gray-200"
          >
            <div className="w-10 h-10 rounded-xl bg-[#722F37]/10 flex items-center justify-center">
              <Icon className="w-5 h-5 text-[#722F37]" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-gray-900">{card.title}</p>
              <p className="text-sm text-gray-500">{card.description}</p>
            </div>
            <span className="text-sm text-[#722F37] font-medium inline-flex items-center gap-1">
              Open <ArrowRight className="w-4 h-4" />
            </span>
          </div>
        )
      })}
    </div>
  )
}

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

const meta: Meta = {
  title: 'Guidance/GetStartedUse',
  component: GetStartedUsePreview,
  decorators: [
    (Story) => (
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Story />
        </MemoryRouter>
      </QueryClientProvider>
    ),
  ],
}

export default meta
type Story = StoryObj

export const UseTheApp: Story = {}
