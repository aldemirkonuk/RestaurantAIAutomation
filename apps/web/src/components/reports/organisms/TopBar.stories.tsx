import type { Meta, StoryObj } from '@storybook/react'
import { TopBar } from './TopBar'
import { fn } from '@storybook/test'

const meta: Meta<typeof TopBar> = {
  title: 'Reports/Organisms/TopBar',
  component: TopBar,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  args: {
    onTimeRangeChange: fn(),
    onEditToggle: fn(),
    onExport: fn(),
  },
}

export default meta
type Story = StoryObj<typeof TopBar>

export const Default: Story = {
  args: {
    timeRange: '30d',
    isEditMode: false,
    exportSuccess: null,
  },
}

export const EditMode: Story = {
  args: {
    timeRange: '30d',
    isEditMode: true,
    exportSuccess: null,
  },
}

export const SevenDays: Story = {
  args: {
    timeRange: '7d',
    isEditMode: false,
    exportSuccess: null,
  },
}

export const NinetyDays: Story = {
  args: {
    timeRange: '90d',
    isEditMode: false,
    exportSuccess: null,
  },
}

export const ExportSuccess: Story = {
  args: {
    timeRange: '30d',
    isEditMode: false,
    exportSuccess: 'csv',
  },
}
