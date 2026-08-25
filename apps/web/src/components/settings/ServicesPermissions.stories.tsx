import type { Meta, StoryObj } from '@storybook/react'
import { ServicesPermissions } from './ServicesPermissions'

// Router and QueryClient come from the global decorator in .storybook/preview.tsx.
const meta: Meta<typeof ServicesPermissions> = {
  title: 'Guidance/ServicesPermissions',
  component: ServicesPermissions,
  decorators: [
    (Story) => (
      <div className="max-w-3xl p-6 bg-white">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof ServicesPermissions>

export const Default: Story = {}
