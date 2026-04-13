import type { Meta, StoryObj } from '@storybook/react'
import {
  Skeleton,
  TextSkeleton,
  StatCardSkeleton,
  CardSkeleton,
  TableSkeleton,
  ListItemSkeleton,
  DashboardSkeleton,
  InventorySkeleton,
  OrdersSkeleton,
  PageSkeleton,
} from './loading-skeleton'

const meta: Meta<typeof Skeleton> = {
  title: 'UI/LoadingSkeleton',
  component: Skeleton,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'Skeleton loading components with shimmer animation for better loading UX.',
      },
    },
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Skeleton>

export const BasicSkeleton: Story = {
  args: {
    className: 'h-4 w-48',
  },
}

export const WithShimmer: Story = {
  args: {
    className: 'h-4 w-64',
    shimmer: true,
  },
}

export const WithoutShimmer: Story = {
  args: {
    className: 'h-4 w-64',
    shimmer: false,
  },
}

export const TextLines: Story = {
  render: () => <TextSkeleton lines={3} />,
}

export const StatCard: Story = {
  render: () => (
    <div className="w-64">
      <StatCardSkeleton />
    </div>
  ),
}

export const Card: Story = {
  render: () => (
    <div className="w-80">
      <CardSkeleton />
    </div>
  ),
}

export const Table: Story = {
  render: () => (
    <div className="w-full max-w-4xl">
      <TableSkeleton rows={5} columns={4} />
    </div>
  ),
}

export const LargeTable: Story = {
  render: () => (
    <div className="w-full max-w-6xl">
      <TableSkeleton rows={10} columns={8} />
    </div>
  ),
}

export const ListItem: Story = {
  render: () => (
    <div className="w-96">
      <div className="space-y-3">
        <ListItemSkeleton />
        <ListItemSkeleton />
        <ListItemSkeleton />
      </div>
    </div>
  ),
}

export const DashboardPage: Story = {
  render: () => (
    <div className="w-full min-h-screen bg-slate-50">
      <DashboardSkeleton />
    </div>
  ),
  parameters: {
    layout: 'fullscreen',
  },
}

export const InventoryPage: Story = {
  render: () => (
    <div className="w-full min-h-screen bg-slate-50">
      <InventorySkeleton />
    </div>
  ),
  parameters: {
    layout: 'fullscreen',
  },
}

export const OrdersPage: Story = {
  render: () => (
    <div className="w-full min-h-screen bg-slate-50">
      <OrdersSkeleton />
    </div>
  ),
  parameters: {
    layout: 'fullscreen',
  },
}

export const GenericPage: Story = {
  render: () => (
    <div className="w-full min-h-screen bg-slate-50">
      <PageSkeleton />
    </div>
  ),
  parameters: {
    layout: 'fullscreen',
  },
}

// Multiple stat cards
export const StatCardGrid: Story = {
  render: () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 p-6">
      <StatCardSkeleton />
      <StatCardSkeleton />
      <StatCardSkeleton />
      <StatCardSkeleton />
    </div>
  ),
  parameters: {
    layout: 'fullscreen',
  },
}
