import type { Meta, StoryObj } from '@storybook/react'
import { 
  EmptyState, 
  EmptyInventory, 
  EmptyOrders, 
  EmptyNotifications,
  EmptySearchResults,
  EmptyReports,
  EmptyProviders,
  EmptyScheduledTasks,
  EmptyInbox,
} from './empty-state'
import { Wine, Package, Search, Bell } from 'lucide-react'

const meta: Meta<typeof EmptyState> = {
  title: 'UI/EmptyState',
  component: EmptyState,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Empty state components for displaying when there is no data to show.',
      },
    },
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof EmptyState>

export const Default: Story = {
  args: {
    title: 'No items found',
    description: 'There are no items to display at this time.',
  },
}

export const WithIcon: Story = {
  args: {
    icon: <Wine className="w-full h-full" />,
    title: 'No wines available',
    description: 'Start by adding wines to your collection.',
  },
}

export const WithAction: Story = {
  args: {
    icon: <Package className="w-full h-full" />,
    title: 'Empty inventory',
    description: 'Add items to your inventory to get started.',
    action: {
      label: 'Add Item',
      onClick: () => alert('Add item clicked'),
    },
  },
}

export const SmallSize: Story = {
  args: {
    icon: <Bell className="w-full h-full" />,
    title: 'All caught up',
    description: 'No new notifications.',
    size: 'sm',
  },
}

export const LargeSize: Story = {
  args: {
    icon: <Search className="w-full h-full" />,
    title: 'No results found',
    description: 'Try adjusting your search criteria or filters.',
    size: 'lg',
    action: {
      label: 'Clear Filters',
      onClick: () => alert('Filters cleared'),
    },
  },
}

// Pre-built variants
export const Inventory: Story = {
  render: () => <EmptyInventory onAdd={() => alert('Add wine clicked')} />,
}

export const Orders: Story = {
  render: () => <EmptyOrders onCreateOrder={() => alert('Create order clicked')} />,
}

export const Notifications: Story = {
  render: () => <EmptyNotifications />,
}

export const SearchResults: Story = {
  render: () => <EmptySearchResults query="Cabernet" onClear={() => alert('Clear search')} />,
}

export const Reports: Story = {
  render: () => <EmptyReports onGenerate={() => alert('Generate report')} />,
}

export const Providers: Story = {
  render: () => <EmptyProviders onAdd={() => alert('Add provider')} />,
}

export const ScheduledTasks: Story = {
  render: () => <EmptyScheduledTasks onSchedule={() => alert('Schedule task')} />,
}

export const Inbox: Story = {
  render: () => <EmptyInbox message="Your inbox is empty. Great job!" />,
}
