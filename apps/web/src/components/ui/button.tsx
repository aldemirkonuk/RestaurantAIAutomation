import * as React from 'react'
import { cn } from '../../lib/utils'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
  size?: 'default' | 'sm' | 'lg' | 'icon'
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    const baseStyles =
      'inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wine-600/40 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]'

    const variants = {
      default:
        'bg-wine-600 text-white hover:bg-wine-700 shadow-[0_10px_28px_-10px_rgba(26,94,107,0.55)]',
      destructive: 'bg-rose-600 text-white hover:bg-rose-700',
      outline: 'border border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300',
      secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200',
      ghost: 'hover:bg-gray-100 hover:text-gray-900',
      link: 'text-wine-600 underline-offset-4 hover:underline',
    }

    const sizes = {
      default: 'h-10 px-4 py-2',
      sm: 'h-9 rounded-lg px-3',
      lg: 'h-11 rounded-xl px-8',
      icon: 'h-10 w-10',
    }

    return (
      <button
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button }

