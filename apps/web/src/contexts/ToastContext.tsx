import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react'
import {
  ToastProvider as RadixToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  type ToastActionElement,
} from '@wineops/ui'
import { CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react'

type ToastVariant = 'default' | 'success' | 'error' | 'warning' | 'info'

interface ToastOptions {
  title?: string
  description?: string
  variant?: ToastVariant
  duration?: number
  action?: ToastActionElement
}

interface ToastItem {
  id: string
  title?: string
  description?: string
  variant: ToastVariant
  duration: number
  action?: ToastActionElement
  open: boolean
}

interface ToastContextValue {
  toasts: ToastItem[]
  toast: (message: string, options?: ToastOptions) => string
  success: (message: string, options?: Omit<ToastOptions, 'variant'>) => string
  error: (message: string, options?: Omit<ToastOptions, 'variant'>) => string
  warning: (message: string, options?: Omit<ToastOptions, 'variant'>) => string
  info: (message: string, options?: Omit<ToastOptions, 'variant'>) => string
  dismiss: (id: string) => void
  promise: <T,>(
    promise: Promise<T>,
    messages: {
      loading: string
      success: string | ((data: T) => string)
      error: string | ((error: Error) => string)
    }
  ) => Promise<T>
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

const MAX_VISIBLE_TOASTS = 3
const DEFAULT_DURATION = 5000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismissRef = useRef<(id: string) => void>(() => {})

  const toast = useCallback(
    (message: string, options: ToastOptions = {}): string => {
      const id = Math.random().toString(36).substring(7)
      const { title, description, variant = 'default', duration = DEFAULT_DURATION, action } = options

      const newToast: ToastItem = {
        id,
        title: title || message,
        description: description || (title ? message : undefined),
        variant,
        duration,
        action,
        open: true,
      }

      setToasts((prev) => {
        const updated = [...prev, newToast]
        if (updated.length > MAX_VISIBLE_TOASTS) {
          return updated.slice(-MAX_VISIBLE_TOASTS)
        }
        return updated
      })

      if (duration > 0) {
        setTimeout(() => {
          dismissRef.current(id)
        }, duration)
      }

      return id
    },
    []
  )

  const dismiss = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, open: false } : t))
    )
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 300)
  }, [])
  dismissRef.current = dismiss

  const success = useCallback(
    (message: string, options: Omit<ToastOptions, 'variant'> = {}) => {
      return toast(message, { ...options, variant: 'success' })
    },
    [toast]
  )

  const error = useCallback(
    (message: string, options: Omit<ToastOptions, 'variant'> = {}) => {
      return toast(message, { ...options, variant: 'error' })
    },
    [toast]
  )

  const warning = useCallback(
    (message: string, options: Omit<ToastOptions, 'variant'> = {}) => {
      return toast(message, { ...options, variant: 'warning' })
    },
    [toast]
  )

  const info = useCallback(
    (message: string, options: Omit<ToastOptions, 'variant'> = {}) => {
      return toast(message, { ...options, variant: 'info' })
    },
    [toast]
  )

  const promise = useCallback(
    async <T,>(
      promise: Promise<T>,
      messages: {
        loading: string
        success: string | ((data: T) => string)
        error: string | ((error: Error) => string)
      }
    ): Promise<T> => {
      const loadingId = toast(messages.loading, { duration: 0 })

      try {
        const data = await promise
        dismiss(loadingId)
        const successMessage =
          typeof messages.success === 'function'
            ? messages.success(data)
            : messages.success
        success(successMessage)
        return data
      } catch (err) {
        dismiss(loadingId)
        const errorMessage =
          typeof messages.error === 'function'
            ? messages.error(err as Error)
            : messages.error
        error(errorMessage)
        throw err
      }
    },
    [toast, dismiss, success, error]
  )

  const variantIcons = {
    default: null,
    success: <CheckCircle className="w-5 h-5" />,
    error: <AlertCircle className="w-5 h-5" />,
    warning: <AlertTriangle className="w-5 h-5" />,
    info: <Info className="w-5 h-5" />,
  }

  const variantClasses = {
    default: 'border-gray-200 bg-white text-gray-900',
    success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
    error: 'border-rose-300 bg-rose-50 text-rose-900',
    warning: 'border-amber-300 bg-amber-50 text-amber-900',
    info: 'border-blue-300 bg-blue-50 text-blue-900',
  }

  return (
    <ToastContext.Provider
      value={{ toasts, toast, success, error, warning, info, dismiss, promise }}
    >
      <RadixToastProvider duration={DEFAULT_DURATION}>
        {children}
        {toasts.map((item) => {
          const Icon = variantIcons[item.variant]
          return (
            <Toast
              key={item.id}
              open={item.open}
              onOpenChange={(open) => !open && dismiss(item.id)}
              duration={item.duration}
              className={variantClasses[item.variant]}
            >
              <div className="flex items-start gap-3">
                {Icon && <div className="flex-shrink-0 mt-0.5">{Icon}</div>}
                <div className="flex-1">
                  {item.title && <ToastTitle>{item.title}</ToastTitle>}
                  {item.description && (
                    <ToastDescription>{item.description}</ToastDescription>
                  )}
                </div>
              </div>
              {item.action}
              <ToastClose />
            </Toast>
          )
        })}
        <ToastViewport />
      </RadixToastProvider>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}
