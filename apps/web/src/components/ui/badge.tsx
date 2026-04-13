import * as React from 'react'
import { cn } from '../../lib/utils'

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info'
  size?: 'default' | 'sm'
}

function Badge({ className, variant = 'default', size = 'default', ...props }: BadgeProps) {
  const variants = {
    default: 'border-transparent bg-wine-600 text-white',
    secondary: 'border-transparent bg-gray-100 text-gray-900',
    destructive: 'border-transparent bg-rose-100 text-rose-700',
    outline: 'border border-gray-200 text-gray-700 bg-white',
    success: 'border-transparent bg-emerald-100 text-emerald-700',
    warning: 'border-transparent bg-amber-100 text-amber-700',
    info: 'border-transparent bg-blue-100 text-blue-700',
  }

  const sizes = {
    default: 'px-2.5 py-0.5 text-xs',
    sm: 'px-2 py-0.5 text-[10px]',
  }

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full font-medium transition-colors',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  )
}

export { Badge }

