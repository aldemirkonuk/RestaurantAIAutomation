import type { Meta, StoryObj } from '@storybook/react'
import { Sidebar } from './Sidebar'
import { BrowserRouter } from 'react-router-dom'
import { within, userEvent } from '@storybook/test'

const meta: Meta<typeof Sidebar> = {
  title: 'Layout/Sidebar',
  component: Sidebar,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
Application sidebar navigation with collapsible state.

Features:
- Collapsible/expandable sidebar
- Active route highlighting
- Badge notifications
- Grouped navigation (Main, Secondary, AI, Bottom)
- Tooltip on hover when collapsed
- Smooth animations
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <BrowserRouter>
        <div className="flex min-h-screen bg-slate-50">
          <Story />
          <div className="flex-1 p-6">
            <div className="bg-white rounded-2xl p-8 shadow-sm">
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Main Content Area</h1>
              <p className="text-gray-600">
                This is the main content area. The sidebar is on the left.
                Try hovering over navigation items and clicking the collapse button.
              </p>
            </div>
          </div>
        </div>
      </BrowserRouter>
    ),
  ],
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Sidebar>

export const Expanded: Story = {}

export const WithHover: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    
    // Find a navigation link
    const dashboardLink = canvas.getByLabelText(/dashboard/i)
    
    // Hover over it
    await userEvent.hover(dashboardLink)
  },
}

export const DarkMode: Story = {
  parameters: {
    backgrounds: { default: 'dark' },
  },
  decorators: [
    (Story) => (
      <BrowserRouter>
        <div className="dark flex min-h-screen bg-slate-900">
          <Story />
          <div className="flex-1 p-6">
            <div className="bg-slate-800 rounded-2xl p-8 shadow-sm">
              <h1 className="text-2xl font-bold text-white mb-2">Main Content Area</h1>
              <p className="text-gray-300">
                Sidebar in dark mode with all navigation items visible.
              </p>
            </div>
          </div>
        </div>
      </BrowserRouter>
    ),
  ],
}

export const MobileView: Story = {
  parameters: {
    viewport: {
      defaultViewport: 'mobile',
    },
  },
}

export const WithBadges: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Shows notification badges on navigation items (Inventory: 3, Orders: 5, Notifications: 12).',
      },
    },
  },
}
