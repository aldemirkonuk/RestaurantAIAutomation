import type { Meta, StoryObj } from '@storybook/react'
import { Header } from './Header'
import { within, userEvent, expect } from '@storybook/test'

const meta: Meta<typeof Header> = {
  title: 'Layout/Header',
  component: Header,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
Application header with search, notifications, theme toggle, and user menu.

Features:
- Global search with keyboard shortcut (⌘K)
- Notification center with unread count
- Restaurant switcher for multi-tenant
- Theme toggle (light/dark/system)
- User profile menu
        `,
      },
    },
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Header>

export const Default: Story = {
  args: {
    title: 'Dashboard',
    subtitle: 'Welcome back to your wine inventory',
  },
}

export const WithoutSubtitle: Story = {
  args: {
    title: 'Inventory',
  },
}

export const LongTitle: Story = {
  args: {
    title: 'Wine Library Management System',
    subtitle: 'Browse and manage your comprehensive wine collection',
  },
}

export const OpenSearch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    
    // Find and click search button
    const searchButton = canvas.getByLabelText(/open search/i)
    await userEvent.click(searchButton)
    
    // Verify search modal opened
    const searchInput = await canvas.findByPlaceholderText(/search wines/i)
    expect(searchInput).toBeInTheDocument()
  },
}

export const OpenNotifications: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    
    // Find and click notifications button
    const notificationsButton = canvas.getByLabelText(/notifications/i)
    await userEvent.click(notificationsButton)
    
    // Verify notifications panel opened
    await canvas.findByText(/notifications/i)
  },
}

export const OpenUserMenu: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    
    // Find and click user menu button
    const userMenuButton = canvas.getByLabelText(/user menu/i)
    await userEvent.click(userMenuButton)
    
    // Verify menu opened
    await canvas.findByText(/log out/i)
  },
}

export const DarkMode: Story = {
  args: {
    title: 'Dashboard',
    subtitle: 'Managing your inventory',
  },
  parameters: {
    backgrounds: { default: 'dark' },
  },
  decorators: [
    (Story) => (
      <div className="dark">
        <Story />
      </div>
    ),
  ],
}

export const MobileView: Story = {
  args: {
    title: 'Orders',
    subtitle: 'Track your procurement',
  },
  parameters: {
    viewport: {
      defaultViewport: 'mobile',
    },
  },
}
