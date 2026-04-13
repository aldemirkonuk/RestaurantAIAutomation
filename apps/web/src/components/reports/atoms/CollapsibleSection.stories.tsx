import type { Meta, StoryObj } from '@storybook/react'
import { CollapsibleSection } from './CollapsibleSection'
import { BarChart3, ShoppingCart, Camera } from 'lucide-react'
import { fn } from '@storybook/test'

const meta: Meta<typeof CollapsibleSection> = {
  title: 'Reports/Atoms/CollapsibleSection',
  component: CollapsibleSection,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  args: {
    onToggle: fn(),
  },
}

export default meta
type Story = StoryObj<typeof CollapsibleSection>

export const Open: Story = {
  args: {
    title: 'Daily Breakdown',
    subtitle: 'Detailed daily sales data',
    icon: BarChart3,
    isOpen: true,
    children: (
      <div className="p-6">
        <p className="text-gray-600">This is the content inside the collapsible section.</p>
        <div className="mt-4 space-y-2">
          <div className="bg-gray-100 p-3 rounded">Row 1</div>
          <div className="bg-gray-100 p-3 rounded">Row 2</div>
          <div className="bg-gray-100 p-3 rounded">Row 3</div>
        </div>
      </div>
    ),
  },
}

export const Closed: Story = {
  args: {
    title: 'Daily Breakdown',
    subtitle: 'Detailed daily sales data',
    icon: BarChart3,
    isOpen: false,
    children: (
      <div className="p-6">
        <p className="text-gray-600">This content is hidden when closed.</p>
      </div>
    ),
  },
}

export const WithBadge: Story = {
  args: {
    title: 'Purchased Wines',
    subtitle: 'Track procurement spending',
    icon: ShoppingCart,
    badge: (
      <span className="px-3 py-1 bg-wine-100 text-wine-700 text-sm font-semibold rounded-full">
        8 orders
      </span>
    ),
    isOpen: true,
    children: (
      <div className="p-6">
        <p className="text-gray-600">Purchase history content</p>
      </div>
    ),
  },
}

export const CheckScanner: Story = {
  args: {
    title: 'Digital Check Scanner',
    subtitle: 'Upload receipts to analyze wine sales',
    icon: Camera,
    isOpen: true,
    children: (
      <div className="p-6">
        <button className="px-4 py-2 bg-wine-600 text-white rounded-lg">
          Scan Check
        </button>
      </div>
    ),
  },
}
