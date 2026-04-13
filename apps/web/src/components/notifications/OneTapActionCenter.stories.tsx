import type { Meta, StoryObj } from '@storybook/react'
import { OneTapActionCenter } from './OneTapActionCenter'
import { within, userEvent, expect } from '@storybook/test'

const meta: Meta<typeof OneTapActionCenter> = {
  title: 'Components/OneTapActionCenter',
  component: OneTapActionCenter,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
One-Tap Action Center - The critical component for human-in-the-loop approvals.

Features:
- Low stock alerts with one-tap reordering
- Price change approvals
- Delivery confirmations
- Stock inequality corrections
- Vintage substitution approvals
- Apple Reminders-style UI
- Batch operations
- Priority filtering
        `,
      },
    },
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof OneTapActionCenter>

export const Default: Story = {}

export const WithMultipleActions: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Shows multiple pending actions of different priorities and types.',
      },
    },
  },
}

export const Interactive: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    
    // Wait for actions to load
    const actionItems = await canvas.findAllByRole('checkbox')
    
    // Verify checkboxes are present
    expect(actionItems.length).toBeGreaterThan(0)
    
    // Test selecting an action
    if (actionItems.length > 1) {
      await userEvent.click(actionItems[1])
      
      // Should show batch action UI
      await canvas.findByText(/1 selected/i)
    }
  },
}

export const FilterByPriority: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    
    // Find and click filter button
    const filterButtons = canvas.getAllByRole('button')
    const filterButton = filterButtons.find(btn => 
      btn.textContent?.includes('All Actions')
    )
    
    if (filterButton) {
      await userEvent.click(filterButton)
    }
  },
}

export const FullWidth: Story = {
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <div className="p-6 bg-slate-50 min-h-screen">
        <div className="max-w-5xl mx-auto">
          <Story />
        </div>
      </div>
    ),
  ],
}

export const DarkMode: Story = {
  parameters: {
    backgrounds: { default: 'dark' },
  },
  decorators: [
    (Story) => (
      <div className="dark p-6 bg-slate-900 min-h-screen">
        <div className="max-w-5xl mx-auto">
          <Story />
        </div>
      </div>
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
