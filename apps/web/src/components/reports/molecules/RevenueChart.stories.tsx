import type { Meta, StoryObj } from '@storybook/react'
import { RevenueChart } from './RevenueChart'

const meta: Meta<typeof RevenueChart> = {
  title: 'Reports/Molecules/RevenueChart',
  component: RevenueChart,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof RevenueChart>

const generateMockData = (days: number) => {
  return Array.from({ length: days }, (_, i) => ({
    date: new Date(Date.now() - (days - i - 1) * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    revenue: Math.round(4000 + Math.random() * 2000),
  }))
}

export const SevenDays: Story = {
  args: {
    data: generateMockData(7),
    timeRange: '7d',
    revenueChange: 5.5,
    isEditMode: false,
  },
}

export const ThirtyDays: Story = {
  args: {
    data: generateMockData(30),
    timeRange: '30d',
    revenueChange: 8.2,
    isEditMode: false,
  },
}

export const NinetyDays: Story = {
  args: {
    data: generateMockData(90),
    timeRange: '90d',
    revenueChange: -2.1,
    isEditMode: false,
  },
}

export const EditMode: Story = {
  args: {
    data: generateMockData(30),
    timeRange: '30d',
    revenueChange: 5.5,
    isEditMode: true,
  },
}

export const NegativeTrend: Story = {
  args: {
    data: generateMockData(30),
    timeRange: '30d',
    revenueChange: -5.3,
    isEditMode: false,
  },
}
