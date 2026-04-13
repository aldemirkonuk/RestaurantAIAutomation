import type { Meta, StoryObj } from '@storybook/react'
import { PreviewOverlay } from './PreviewOverlay'
import { fn } from '@storybook/test'

const meta: Meta<typeof PreviewOverlay> = {
  title: 'Reports/Preview/PreviewOverlay',
  component: PreviewOverlay,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
  args: {
    onApply: fn(),
    onCancel: fn(),
    onReset: fn(),
    onZoomChange: fn(),
  },
}

export default meta
type Story = StoryObj<typeof PreviewOverlay>

export const Active: Story = {
  args: {
    isActive: true,
    hasChanges: true,
    zoom: 100,
    children: (
      <div className="bg-white p-8 rounded-xl shadow-lg">
        <h2 className="text-2xl font-bold mb-4">Preview Content</h2>
        <p className="text-gray-600">This is what your layout will look like.</p>
        <div className="grid grid-cols-3 gap-4 mt-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-gray-100 p-4 rounded-lg">
              <div className="h-20 bg-gray-200 rounded"></div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
}

export const ZoomedIn: Story = {
  args: {
    isActive: true,
    hasChanges: true,
    zoom: 125,
    children: (
      <div className="bg-white p-8 rounded-xl shadow-lg">
        <h2 className="text-2xl font-bold">Zoomed In (125%)</h2>
        <p className="text-gray-600">Content appears larger</p>
      </div>
    ),
  },
}

export const ZoomedOut: Story = {
  args: {
    isActive: true,
    hasChanges: true,
    zoom: 75,
    children: (
      <div className="bg-white p-8 rounded-xl shadow-lg">
        <h2 className="text-2xl font-bold">Zoomed Out (75%)</h2>
        <p className="text-gray-600">Content appears smaller</p>
      </div>
    ),
  },
}

export const NoChanges: Story = {
  args: {
    isActive: true,
    hasChanges: false,
    zoom: 100,
    children: (
      <div className="bg-white p-8 rounded-xl shadow-lg">
        <h2 className="text-2xl font-bold">No Changes</h2>
        <p className="text-gray-600">Apply button should be disabled</p>
      </div>
    ),
  },
}

export const WithReset: Story = {
  args: {
    isActive: true,
    hasChanges: true,
    zoom: 100,
    onReset: fn(),
    children: (
      <div className="bg-white p-8 rounded-xl shadow-lg">
        <h2 className="text-2xl font-bold">With Reset Button</h2>
        <p className="text-gray-600">Reset option available</p>
      </div>
    ),
  },
}
