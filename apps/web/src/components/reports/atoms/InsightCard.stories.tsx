import type { Meta, StoryObj } from '@storybook/react'
import { InsightCard } from './InsightCard'
import { Target, TrendingUp, DollarSign, AlertTriangle } from 'lucide-react'

const meta: Meta<typeof InsightCard> = {
  title: 'Reports/Atoms/InsightCard',
  component: InsightCard,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '400px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof InsightCard>

export const Opportunity: Story = {
  args: {
    insight: {
      id: 'red-wine',
      type: 'opportunity',
      icon: Target,
      title: 'Red Wine Dominance',
      description: 'Red wines account for 42% of total sales. Consider expanding your red wine selection.',
      action: 'View Red Wines',
      color: 'emerald',
    },
    index: 0,
  },
}

export const Insight: Story = {
  args: {
    insight: {
      id: 'weekend',
      type: 'insight',
      icon: TrendingUp,
      title: 'Weekend Performance',
      description: 'Weekend sales are 55% higher than weekdays. Ensure adequate staffing and stock.',
      action: 'Schedule Staff',
      color: 'blue',
    },
    index: 1,
  },
}

export const Alert: Story = {
  args: {
    insight: {
      id: 'sparkling',
      type: 'alert',
      icon: AlertTriangle,
      title: 'Sparkling Wine Promotion',
      description: 'Sparkling wine sales peak on weekends. Consider special promotions on slower days.',
      action: 'Create Promotion',
      color: 'purple',
    },
    index: 2,
  },
}

export const Upsell: Story = {
  args: {
    insight: {
      id: 'upsell',
      type: 'opportunity',
      icon: DollarSign,
      title: 'Upselling Opportunity',
      description: 'Average order value of $156 suggests opportunity for premium upselling strategies.',
      action: 'View Premium Wines',
      color: 'amber',
    },
    index: 3,
  },
}
