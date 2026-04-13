import type { Meta, StoryObj } from '@storybook/react'
import {
  ErrorState,
  NetworkError,
  NotFoundError,
  UnauthorizedError,
  ServerError,
} from './error-state'
import { AlertCircle } from 'lucide-react'

const meta: Meta<typeof ErrorState> = {
  title: 'UI/ErrorState',
  component: ErrorState,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Error state components for displaying error scenarios with recovery actions.',
      },
    },
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof ErrorState>

export const Generic: Story = {
  args: {
    variant: 'generic',
  },
}

export const Network: Story = {
  args: {
    variant: 'network',
    action: {
      label: 'Try Again',
      onClick: () => alert('Retry clicked'),
    },
  },
}

export const NotFound: Story = {
  args: {
    variant: 'notFound',
    action: {
      label: 'Go Home',
      onClick: () => alert('Home clicked'),
    },
  },
}

export const Unauthorized: Story = {
  args: {
    variant: 'unauthorized',
    action: {
      label: 'Log In',
      onClick: () => alert('Login clicked'),
    },
  },
}

export const Server: Story = {
  args: {
    variant: 'server',
    action: {
      label: 'Retry',
      onClick: () => alert('Retry clicked'),
    },
  },
}

export const CustomError: Story = {
  args: {
    title: 'Unable to Load Inventory',
    description: 'We encountered an error while loading your wine inventory. This might be a temporary issue.',
    icon: <AlertCircle className="w-full h-full" />,
    action: {
      label: 'Refresh',
      onClick: () => alert('Refresh clicked'),
    },
    secondaryAction: {
      label: 'Contact Support',
      onClick: () => alert('Support clicked'),
    },
  },
}

export const WithSecondaryAction: Story = {
  args: {
    variant: 'network',
    action: {
      label: 'Retry',
      onClick: () => alert('Retry'),
    },
    secondaryAction: {
      label: 'Go Back',
      onClick: () => alert('Go back'),
    },
  },
}

// Convenience components
export const NetworkErrorComponent: Story = {
  render: () => <NetworkError onRetry={() => alert('Retry')} />,
}

export const NotFoundErrorComponent: Story = {
  render: () => (
    <NotFoundError
      onGoHome={() => alert('Go home')}
      onGoBack={() => alert('Go back')}
    />
  ),
}

export const UnauthorizedErrorComponent: Story = {
  render: () => <UnauthorizedError onLogin={() => alert('Login')} />,
}

export const ServerErrorComponent: Story = {
  render: () => <ServerError onRetry={() => alert('Retry')} />,
}

// Dark mode variant
export const DarkMode: Story = {
  args: {
    variant: 'network',
    action: {
      label: 'Try Again',
      onClick: () => alert('Retry'),
    },
  },
  parameters: {
    backgrounds: { default: 'dark' },
  },
}
