import type { Meta, StoryObj } from '@storybook/react'
import { WineTypeBar } from './WineTypeBar'

const meta: Meta<typeof WineTypeBar> = {
  title: 'Reports/Atoms/WineTypeBar',
  component: WineTypeBar,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  argTypes: {
    height: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
    showLabels: {
      control: 'boolean',
    },
  },
}

export default meta
type Story = StoryObj<typeof WineTypeBar>

export const Balanced: Story = {
  args: {
    data: {
      red: 40,
      white: 30,
      sparkling: 15,
      rose: 10,
      dessert: 5,
    },
    showLabels: false,
    height: 'md',
  },
}

export const WithLabels: Story = {
  args: {
    data: {
      red: 45,
      white: 25,
      sparkling: 18,
      rose: 8,
      dessert: 4,
    },
    showLabels: true,
    height: 'md',
  },
}

export const RedDominant: Story = {
  args: {
    data: {
      red: 70,
      white: 15,
      sparkling: 8,
      rose: 5,
      dessert: 2,
    },
    showLabels: true,
    height: 'md',
  },
}

export const SmallHeight: Story = {
  args: {
    data: {
      red: 40,
      white: 30,
      sparkling: 15,
      rose: 10,
      dessert: 5,
    },
    height: 'sm',
  },
}

export const LargeHeight: Story = {
  args: {
    data: {
      red: 40,
      white: 30,
      sparkling: 15,
      rose: 10,
      dessert: 5,
    },
    showLabels: true,
    height: 'lg',
  },
}

export const SparklingFocus: Story = {
  args: {
    data: {
      red: 20,
      white: 15,
      sparkling: 50,
      rose: 10,
      dessert: 5,
    },
    showLabels: true,
    height: 'md',
  },
}
