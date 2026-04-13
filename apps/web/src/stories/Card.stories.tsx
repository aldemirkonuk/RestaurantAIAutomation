import type { Meta, StoryObj } from '@storybook/react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui'

const meta: Meta<typeof Card> = {
  title: 'UI/Card',
  component: Card,
  args: {
    variant: 'glass',
    padding: 'md',
  },
}

export default meta
type Story = StoryObj<typeof Card>

export const Default: Story = {
  render: (args) => (
    <Card {...args} className="w-[360px]">
      <CardHeader>
        <CardTitle>Wine Inventory</CardTitle>
        <CardDescription>Current stock snapshot</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-sm text-gray-600">
          128 bottles · 14 low-stock alerts
        </div>
      </CardContent>
    </Card>
  ),
}
