import type { Meta, StoryObj } from '@storybook/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ServicesPermissions } from './ServicesPermissions'

const qc = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

const meta: Meta<typeof ServicesPermissions> = {
  title: 'Guidance/ServicesPermissions',
  component: ServicesPermissions,
  decorators: [
    (Story) => (
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <div className="max-w-3xl p-6 bg-white">
            <Story />
          </div>
        </MemoryRouter>
      </QueryClientProvider>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof ServicesPermissions>

export const Default: Story = {}
