import type { Meta, StoryObj } from '@storybook/react'
import { MetricDisplay } from './MetricDisplay'

const meta: Meta<typeof MetricDisplay> = {
  title: 'Reports/Atoms/MetricDisplay',
  component: MetricDisplay,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    format: {
      control: 'select',
      options: ['currency', 'number', 'percentage'],
    },
  },
}

export default meta
type Story = StoryObj<typeof MetricDisplay>

export const Currency: Story = {
  args: {
    value: 50000,
    label: 'Total Revenue',
    format: 'currency',
  },
}

export const Number: Story = {
  args: {
    value: 1234,
    label: 'Total Orders',
    format: 'number',
  },
}

export const Percentage: Story = {
  args: {
    value: 65.5,
    label: 'Profit Margin',
    format: 'percentage',
  },
}

export const StringValue: Story = {
  args: {
    value: '$1,234,567',
    label: 'Custom Format',
  },
}

export const LargeNumber: Story = {
  args: {
    value: 9876543,
    label: 'Bottles Sold',
    format: 'number',
  },
}
