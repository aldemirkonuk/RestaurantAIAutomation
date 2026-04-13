import type { Meta, StoryObj } from '@storybook/react'
import { useToast } from '../../contexts/ToastContext'
import { Button } from '@wineops/ui'

// Wrapper component to demonstrate toast functionality
function ToastDemo() {
  const toast = useToast()

  return (
    <div className="space-y-4 p-6">
      <h2 className="text-xl font-bold mb-4">Toast Notifications</h2>
      
      <div className="space-y-2">
        <Button
          onClick={() => toast.success('Wine added to inventory successfully!')}
          className="w-full"
        >
          Show Success Toast
        </Button>

        <Button
          onClick={() => toast.error('Failed to connect to server')}
          className="w-full"
          variant="secondary"
        >
          Show Error Toast
        </Button>

        <Button
          onClick={() => toast.warning('Low stock alert: Only 2 bottles remaining')}
          className="w-full"
          variant="secondary"
        >
          Show Warning Toast
        </Button>

        <Button
          onClick={() => toast.info('New report is ready to view')}
          className="w-full"
          variant="secondary"
        >
          Show Info Toast
        </Button>

        <Button
          onClick={() =>
            toast.success('Order approved', {
              description: 'The order has been sent to the supplier.',
              duration: 7000,
            })
          }
          className="w-full"
          variant="secondary"
        >
          Show Toast with Description
        </Button>

        <Button
          onClick={() =>
            toast.promise(
              new Promise((resolve) => setTimeout(resolve, 2000)),
              {
                loading: 'Saving changes...',
                success: 'Changes saved successfully!',
                error: 'Failed to save changes',
              }
            )
          }
          className="w-full"
          variant="secondary"
        >
          Show Promise Toast
        </Button>

        <Button
          onClick={() => {
            toast.success('First notification')
            setTimeout(() => toast.warning('Second notification'), 500)
            setTimeout(() => toast.error('Third notification'), 1000)
            setTimeout(() => toast.info('Fourth notification (queued)'), 1500)
          }}
          className="w-full"
          variant="secondary"
        >
          Show Multiple Toasts (Queue Test)
        </Button>
      </div>

      <p className="text-sm text-gray-500 mt-6">
        Toasts appear in the top-right corner and auto-dismiss after 5 seconds.
        Maximum 3 toasts visible at once.
      </p>
    </div>
  )
}

const meta2: Meta<typeof ToastDemo> = {
  title: 'UI/Toast',
  component: ToastDemo,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Toast notification system with queue management and auto-dismiss.',
      },
    },
  },
  tags: ['autodocs'],
}

export default meta2
type ToastStory = StoryObj<typeof ToastDemo>

export const Interactive: ToastStory = {}

export const DarkMode: ToastStory = {
  parameters: {
    backgrounds: { default: 'dark' },
  },
}
