import type { Meta, StoryObj } from '@storybook/react'
import { KPICard } from './KPICard'
import { DollarSign, ShoppingCart, Package, TrendingUp } from 'lucide-react'

const meta: Meta<typeof KPICard> = {
  title: 'Reports/Molecules/KPICard',
  component: KPICard,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '300px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof KPICard>

export const Revenue: Story = {
  args: {
    card: {
      id: 'revenue',
      title: 'Total Revenue',
      key: 'revenue',
      icon: DollarSign,
      visible: true,
    },
    value: {
      value: '$50,000',
      change: 5.5,
      changeType: 'increase',
    },
    isEditMode: false,
  },
}

export const Orders: Story = {
  args: {
    card: {
      id: 'orders',
      title: 'Total Orders',
      key: 'orders',
      icon: ShoppingCart,
      visible: true,
    },
    value: {
      value: 1234,
      change: 8.2,
      changeType: 'increase',
    },
    isEditMode: false,
  },
}

export const Bottles: Story = {
  args: {
    card: {
      id: 'bottles',
      title: 'Bottles Sold',
      key: 'bottles',
      icon: Package,
      visible: true,
    },
    value: {
      value: 5678,
      change: -2.1,
      changeType: 'decrease',
    },
    isEditMode: false,
  },
}

export const EditMode: Story = {
  args: {
    card: {
      id: 'revenue',
      title: 'Total Revenue',
      key: 'revenue',
      icon: DollarSign,
      visible: true,
    },
    value: {
      value: '$50,000',
      change: 5.5,
      changeType: 'increase',
    },
    isEditMode: true,
  },
}

export const Dragging: Story = {
  args: {
    card: {
      id: 'revenue',
      title: 'Total Revenue',
      key: 'revenue',
      icon: DollarSign,
      visible: true,
    },
    value: {
      value: '$50,000',
      change: 5.5,
      changeType: 'increase',
    },
    isEditMode: true,
    isDragging: true,
  },
}
