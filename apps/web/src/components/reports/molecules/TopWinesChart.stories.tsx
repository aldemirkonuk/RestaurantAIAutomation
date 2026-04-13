import type { Meta, StoryObj } from '@storybook/react'
import { TopWinesChart } from './TopWinesChart'
import { fn } from '@storybook/test'

const meta: Meta<typeof TopWinesChart> = {
  title: 'Reports/Molecules/TopWinesChart',
  component: TopWinesChart,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  args: {
    onEdit: fn(),
  },
}

export default meta
type Story = StoryObj<typeof TopWinesChart>

export const Default: Story = {
  args: {
    wines: [
      { name: 'Caymus Special Selection 2019', value: 28500, orders: 68, red: 68, white: 0, sparkling: 0, rose: 0, dessert: 0 },
      { name: 'Dom Pérignon 2012', value: 42300, orders: 52, red: 0, white: 0, sparkling: 52, rose: 0, dessert: 0 },
      { name: 'Opus One 2018', value: 35800, orders: 45, red: 45, white: 0, sparkling: 0, rose: 0, dessert: 0 },
      { name: 'Cloudy Bay Sauvignon 2022', value: 12400, orders: 89, red: 0, white: 89, sparkling: 0, rose: 0, dessert: 0 },
      { name: 'Whispering Angel Rosé 2023', value: 8900, orders: 76, red: 0, white: 0, sparkling: 0, rose: 76, dessert: 0 },
    ],
    isEditMode: false,
  },
}

export const EditMode: Story = {
  args: {
    wines: [
      { name: 'Caymus Special Selection 2019', value: 28500, orders: 68, red: 68, white: 0, sparkling: 0, rose: 0, dessert: 0 },
      { name: 'Dom Pérignon 2012', value: 42300, orders: 52, red: 0, white: 0, sparkling: 52, rose: 0, dessert: 0 },
      { name: 'Opus One 2018', value: 35800, orders: 45, red: 45, white: 0, sparkling: 0, rose: 0, dessert: 0 },
    ],
    isEditMode: true,
  },
}

export const TopThree: Story = {
  args: {
    wines: [
      { name: 'Caymus Special Selection 2019', value: 28500, orders: 68, red: 68, white: 0, sparkling: 0, rose: 0, dessert: 0 },
      { name: 'Dom Pérignon 2012', value: 42300, orders: 52, red: 0, white: 0, sparkling: 52, rose: 0, dessert: 0 },
      { name: 'Opus One 2018', value: 35800, orders: 45, red: 45, white: 0, sparkling: 0, rose: 0, dessert: 0 },
    ],
    isEditMode: false,
  },
}
