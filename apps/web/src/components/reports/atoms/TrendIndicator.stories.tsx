import type { Meta, StoryObj } from '@storybook/react'
import { TrendIndicator } from './TrendIndicator'

const meta: Meta<typeof TrendIndicator> = {
  title: 'Reports/Atoms/TrendIndicator',
  component: TrendIndicator,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    changeType: {
      control: 'select',
      options: ['increase', 'decrease', undefined],
    },
  },
}

export default meta
type Story = StoryObj<typeof TrendIndicator>

export const Increase: Story = {
  args: {
    change: 5.5,
    changeType: 'increase',
  },
}

export const Decrease: Story = {
  args: {
    change: -3.2,
    changeType: 'decrease',
  },
}

export const AutoDetectIncrease: Story = {
  args: {
    change: 8.0,
  },
}

export const AutoDetectDecrease: Story = {
  args: {
    change: -2.5,
  },
}

export const LargeIncrease: Story = {
  args: {
    change: 45.8,
    changeType: 'increase',
  },
}

export const SmallDecrease: Story = {
  args: {
    change: -0.5,
    changeType: 'decrease',
  },
}
