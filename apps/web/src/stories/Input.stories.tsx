import type { Meta, StoryObj } from '@storybook/react'
import { Input } from '../components/ui'

const meta: Meta<typeof Input> = {
  title: 'UI/Input',
  component: Input,
  args: {
    placeholder: 'Search wines...',
  },
}

export default meta
type Story = StoryObj<typeof Input>

export const Default: Story = {}

export const WithValue: Story = {
  args: {
    value: 'Caymus Cabernet',
  },
}
