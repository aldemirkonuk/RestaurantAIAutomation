import type { Meta, StoryObj } from '@storybook/react'

function TipStripPreview() {
  return (
    <div
      role="region"
      aria-label="Page tip"
      className="mx-4 mt-4 mb-2 rounded-xl border border-[#9E4249]/20 bg-[#9E4249]/[0.04] px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 pr-2">
        <p className="text-sm font-semibold text-gray-900">Inventory Command</p>
        <p className="text-sm text-gray-600 mt-0.5">
          See stock, alerts, and reorder points — the main surface for cellar ops.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
        <button
          type="button"
          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-[#9E4249] text-white"
        >
          Take tour
        </button>
        <button
          type="button"
          className="px-3 py-1.5 text-sm font-medium rounded-lg text-gray-600 hover:bg-gray-100"
        >
          Later
        </button>
        <button
          type="button"
          className="px-3 py-1.5 text-sm font-medium rounded-lg text-gray-500 hover:bg-gray-100"
        >
          Don&apos;t show again
        </button>
      </div>
    </div>
  )
}

// Router comes from the global decorator in .storybook/preview.tsx.
const meta: Meta = {
  title: 'Guidance/PageTipStrip',
  component: TipStripPreview,
  decorators: [
    (Story) => (
      <div className="min-h-[200px] bg-gray-50 p-4">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj

export const Default: Story = {}
