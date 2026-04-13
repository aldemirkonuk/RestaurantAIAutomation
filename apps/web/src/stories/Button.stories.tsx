import type { Meta, StoryObj } from '@storybook/react'
import { Button } from '../components/ui'

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  args: {
    children: 'Primary Action',
  },
}

export default meta
type Story = StoryObj<typeof Button>

export const Default: Story = {}

export const Outline: Story = {
  args: {
    variant: 'outline',
    children: 'Outline Action',
  },
}

export const Glass: Story = {
  args: {
    variant: 'glass',
    children: 'Glass Action',
  },
}
