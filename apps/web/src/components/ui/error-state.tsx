import { ReactNode } from 'react'
import { AlertCircle, WifiOff, Lock, Server, FileQuestion, RefreshCw } from 'lucide-react'
import { cn } from '../../lib/utils'

export type ErrorVariant = 'network' | 'notFound' | 'unauthorized' | 'server' | 'generic'

interface ErrorStateProps {
  variant?: ErrorVariant
  title?: string
  description?: string
  icon?: ReactNode
  action?: {
    label: string
    onClick: () => void
  }
  secondaryAction?: {
    label: string
    onClick: () => void
  }
  className?: string
}

const errorConfig: Record<ErrorVariant, { icon: typeof AlertCircle; title: string; description: string; color: string }> = {
  network: {
    icon: WifiOff,
    title: 'Network Connection Error',
    description: 'Unable to connect to the server. Please check your internet connection and try again.',
    color: 'text-orange-600',
  },
  notFound: {
    icon: FileQuestion,
    title: 'Not Found',
    description: 'The page or resource you\'re looking for doesn\'t exist.',
    color: 'text-blue-600',
  },
  unauthorized: {
    icon: Lock,
    title: 'Access Denied',
    description: 'You don\'t have permission to access this resource. Please log in or contact support.',
    color: 'text-rose-600',
  },
  server: {
    icon: Server,
    title: 'Server Error',
    description: 'The server encountered an error processing your request. Our team has been notified.',
    color: 'text-purple-600',
  },
  generic: {
    icon: AlertCircle,
    title: 'Something Went Wrong',
    description: 'An unexpected error occurred. Please try again or contact support if the problem persists.',
    color: 'text-gray-600',
  },
}

export function ErrorState({
  variant = 'generic',
  title: customTitle,
  description: customDescription,
  icon: customIcon,
  action,
  secondaryAction,
  className,
}: ErrorStateProps) {
  const config = errorConfig[variant]
  const Icon = customIcon ? () => <>{customIcon}</> : config.icon
  const title = customTitle || config.title
  const description = customDescription || config.description

  return (
    <div 
      className={cn(
        'flex flex-col items-center justify-center text-center px-6 py-12',
        className
      )}
      role="alert"
      aria-live="polite"
    >
      {/* Icon */}
      <div className={cn(
        'w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4',
        'animate-in fade-in-0 zoom-in-95 duration-300'
      )}>
        <Icon className={cn('w-8 h-8', config.color)} aria-hidden="true" />
      </div>

      {/* Title */}
      <h3 className="text-lg font-semibold text-gray-900 mb-2 animate-in fade-in-0 slide-in-from-bottom-4 duration-300">
        {title}
      </h3>

      {/* Description */}
      <p className="text-sm text-gray-600 max-w-md mb-6 animate-in fade-in-0 slide-in-from-bottom-4 duration-500">
        {description}
      </p>

      {/* Actions */}
      {(action || secondaryAction) && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full max-w-sm animate-in fade-in-0 slide-in-from-bottom-4 duration-700">
          {action && (
            <button
              onClick={action.onClick}
              className="flex-1 px-6 py-2.5 bg-wine-600 text-white font-medium rounded-lg hover:bg-wine-700 transition-colors flex items-center justify-center gap-2"
              aria-label={action.label}
            >
              <RefreshCw className="w-4 h-4" />
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              className="px-6 py-2.5 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300 transition-colors"
              aria-label={secondaryAction.label}
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Convenience components for common error scenarios
export function NetworkError({ 
  onRetry, 
  className 
}: { 
  onRetry?: () => void
  className?: string 
}) {
  return (
    <ErrorState
      variant="network"
      action={onRetry ? { label: 'Try Again', onClick: onRetry } : undefined}
      className={className}
    />
  )
}

export function NotFoundError({ 
  onGoBack,
  onGoHome,
  className 
}: { 
  onGoBack?: () => void
  onGoHome?: () => void
  className?: string 
}) {
  return (
    <ErrorState
      variant="notFound"
      action={onGoHome ? { label: 'Go to Dashboard', onClick: onGoHome } : undefined}
      secondaryAction={onGoBack ? { label: 'Go Back', onClick: onGoBack } : undefined}
      className={className}
    />
  )
}

export function UnauthorizedError({ 
  onLogin,
  className 
}: { 
  onLogin?: () => void
  className?: string 
}) {
  return (
    <ErrorState
      variant="unauthorized"
      action={onLogin ? { label: 'Log In', onClick: onLogin } : undefined}
      className={className}
    />
  )
}

export function ServerError({ 
  onRetry,
  className 
}: { 
  onRetry?: () => void
  className?: string 
}) {
  return (
    <ErrorState
      variant="server"
      action={onRetry ? { label: 'Try Again', onClick: onRetry } : undefined}
      className={className}
    />
  )
}
