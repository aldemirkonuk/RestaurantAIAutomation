import type { Meta, StoryObj } from '@storybook/react'
import { WineDistributionChart } from './WineDistributionChart'
import { fn } from '@storybook/test'

const meta: Meta<typeof WineDistributionChart> = {
  title: 'Reports/Molecules/WineDistributionChart',
  component: WineDistributionChart,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  args: {
    onEdit: fn(),
  },
}

export default meta
type Story = StoryObj<typeof WineDistributionChart>

export const Balanced: Story = {
  args: {
    data: [
      { name: 'Red', value: 42, color: '#be123c' },
      { name: 'White', value: 28, color: '#fbbf24' },
      { name: 'Sparkling', value: 15, color: '#facc15' },
      { name: 'Rosé', value: 10, color: '#f472b6' },
      { name: 'Dessert', value: 5, color: '#a855f7' },
    ],
    isEditMode: false,
  },
}

export const RedDominant: Story = {
  args: {
    data: [
      { name: 'Red', value: 65, color: '#be123c' },
      { name: 'White', value: 20, color: '#fbbf24' },
      { name: 'Sparkling', value: 8, color: '#facc15' },
      { name: 'Rosé', value: 5, color: '#f472b6' },
      { name: 'Dessert', value: 2, color: '#a855f7' },
    ],
    isEditMode: false,
  },
}

export const EditMode: Story = {
  args: {
    data: [
      { name: 'Red', value: 42, color: '#be123c' },
      { name: 'White', value: 28, color: '#fbbf24' },
      { name: 'Sparkling', value: 15, color: '#facc15' },
      { name: 'Rosé', value: 10, color: '#f472b6' },
      { name: 'Dessert', value: 5, color: '#a855f7' },
    ],
    isEditMode: true,
  },
}
