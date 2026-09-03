import type { Meta, StoryObj } from '@storybook/react'
import { Bot } from 'lucide-react'

function FabPreview() {
  return (
    <div className="relative h-64 bg-gray-50 rounded-xl border border-gray-200">
      <button
        type="button"
        aria-label="Wine Agent — inventory & ordering help"
        title="Wine Agent — inventory & ordering help"
        className="absolute right-5 bottom-5 w-12 h-12 rounded-full bg-[#1A5E6B] text-white shadow-lg flex items-center justify-center"
      >
        <Bot className="w-5 h-5" />
      </button>
    </div>
  )
}

const meta: Meta = {
  title: 'Guidance/WineAgentFab',
  component: FabPreview,
}

export default meta
type Story = StoryObj

export const Default: Story = {}
