import type { Meta, StoryObj } from '@storybook/react'
import { Badge } from '../components/ui'

const meta: Meta<typeof Badge> = {
  title: 'UI/Badge',
  component: Badge,
  args: {
    children: 'Low Stock',
  },
}

export default meta
type Story = StoryObj<typeof Badge>

export const Default: Story = {}

export const Success: Story = {
  args: {
    variant: 'success',
    children: 'Healthy',
  },
}

export const Destructive: Story = {
  args: {
    variant: 'destructive',
    children: 'Critical',
  },
}
