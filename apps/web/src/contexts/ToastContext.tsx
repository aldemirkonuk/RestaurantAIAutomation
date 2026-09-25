import { createContext, useCallback, useContext, useMemo, useRef, useState, isValidElement, ReactNode } from 'react'
import {
  ToastProvider as RadixToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
  type ToastActionElement,
} from '@wineops/ui'
import { CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react'
import { toast as sonnerToast } from 'sonner'
import { useMudavymDesign } from '../lib/mudavym/useMudavymDesign'

type ToastVariant = 'default' | 'success' | 'error' | 'warning' | 'info'

interface ToastOptions {
  title?: string
  description?: string
  variant?: ToastVariant
  duration?: number
  action?: ToastActionElement
  /**
   * The undo toast (sketch 119, the shared pieces: "Undo or Open · a drain").
   * When given, the toast carries ONE "Undo" control that calls this, and
   * lives UNDO_DURATION unless `duration` says otherwise. Offer it only where
   * the act can really be taken back — the toast promises what this does.
   */
  onUndo?: () => void
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
  /** A toast whose one control takes the act back. See `ToastOptions.onUndo`. */
  undo: (message: string, onUndo: () => void, options?: Omit<ToastOptions, 'onUndo'>) => string
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
/** The undo drain (sketch 119: "an 8 s linear hairline that pauses on hover"). */
export const UNDO_DURATION = 8000

/**
 * ONE toast (sketch 119, "the shared pieces"): `useToast()` keeps this exact
 * public surface for its ~9 existing callers — nothing at a call site
 * changes — but which visual system answers it is gated the same way every
 * other shell chrome piece is (`useMudavymDesign('shell')`, three layers).
 *
 * Off (today, and every legacy page): `useLegacyToastApi` below — the
 * implementation this file always had, its own Radix toasts, independent of
 * `sonner`'s `<Toaster/>` in App.tsx. Two systems, exactly as before.
 *
 * On: `useHouseToastApi` — every call is forwarded to `sonner`'s imperative
 * API instead of rendering its own toasts, so it lands on the SAME surface the
 * ~30 direct `sonner` callers already use (App.tsx's one `<Toaster/>`,
 * restyled to house tokens there). One visual system, not a second one
 * wearing a costume.
 *
 * ONE COMPONENT, ONE TREE SHAPE — ON PURPOSE
 * ------------------------------------------
 * This provider wraps the whole app (App.tsx: WebSocketProvider, Realtime,
 * the Router). It must never return a different COMPONENT for on and off:
 * the house flag answers AFTER the first render (`useMudavymDesign` starts
 * false and fetches), and a provider that swapped `<Legacy…>` for `<House…>`
 * at that moment made React unmount and remount everything beneath it — every
 * page, the socket, the router — once per load, and again on every branch
 * switch. So both APIs are hooks, called every render, and the tree below is
 * the same element types in the same order either way; only the context value
 * and whether the legacy Radix toasts are drawn change.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const shellOn = useMudavymDesign('shell')
  const legacy = useLegacyToastApi()
  const house = useHouseToastApi()
  const value = shellOn ? house : legacy.value

  return (
    <ToastContext.Provider value={value}>
      <RadixToastProvider duration={DEFAULT_DURATION}>
        {children}
        {shellOn ? null : legacy.rendered}
        {shellOn ? null : <ToastViewport />}
      </RadixToastProvider>
    </ToastContext.Provider>
  )
}

/** `sonner`'s own variant calls take the message as a plain string/node, not `{title}`. */
function sonnerVariantFor(variant: ToastVariant) {
  switch (variant) {
    case 'success':
      return sonnerToast.success
    case 'error':
      return sonnerToast.error
    case 'warning':
      return sonnerToast.warning
    case 'info':
      return sonnerToast.info
    default:
      return sonnerToast
  }
}

function useHouseToastApi(): ToastContextValue {
  const toast = useCallback((message: string, options: ToastOptions = {}): string => {
    const id = Math.random().toString(36).substring(7)
    const { title, description, variant = 'default', action, onUndo } = options
    const duration = options.duration ?? (onUndo ? UNDO_DURATION : DEFAULT_DURATION)
    const call = sonnerVariantFor(variant)
    // `action` here is typed for the legacy Radix renderer (a JSX element);
    // sonner wants `{label, onClick}`. No current caller passes one (a repo
    // grep before this change found none). The one control the house toast
    // carries is the undo, and it is sonner's own action button.
    void action
    call(title ?? message, {
      id,
      description: description ?? (title ? message : undefined),
      duration: duration > 0 ? duration : Infinity,
      ...(onUndo ? { action: { label: 'Undo', onClick: () => onUndo() } } : {}),
    })
    return id
  }, [])

  const dismiss = useCallback((id: string) => {
    sonnerToast.dismiss(id)
  }, [])

  const promise = useCallback(
    async <T,>(
      promise: Promise<T>,
      messages: {
        loading: string
        success: string | ((data: T) => string)
        error: string | ((error: Error) => string)
      },
    ): Promise<T> => {
      // sonner's own `promise()` — one call replaces the manual
      // loading-id-then-dismiss-then-fire dance the legacy path still does.
      sonnerToast.promise(promise, {
        loading: messages.loading,
        success: messages.success,
        error: (err: unknown) =>
          typeof messages.error === 'function' ? messages.error(err as Error) : messages.error,
      })
      return promise
    },
    [],
  )

  // No local `toasts` state to keep in sync with sonner's own — nothing in
  // the app reads it (grepped before this change) and sonner is the source
  // of truth for what is visible.
  return useMemo<ToastContextValue>(
    () => ({
      toasts: [],
      toast,
      success: (message, options = {}) => toast(message, { ...options, variant: 'success' }),
      error: (message, options = {}) => toast(message, { ...options, variant: 'error' }),
      warning: (message, options = {}) => toast(message, { ...options, variant: 'warning' }),
      info: (message, options = {}) => toast(message, { ...options, variant: 'info' }),
      undo: (message, onUndo, options = {}) => toast(message, { ...options, onUndo }),
      dismiss,
      promise,
    }),
    [toast, dismiss, promise],
  )
}

function useLegacyToastApi(): { value: ToastContextValue; rendered: ReactNode } {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismissRef = useRef<(id: string) => void>(() => {})

  const toast = useCallback(
    (message: string, options: ToastOptions = {}): string => {
      const id = Math.random().toString(36).substring(7)
      const { title, description, variant = 'default', action, onUndo } = options
      const duration = options.duration ?? (onUndo ? UNDO_DURATION : DEFAULT_DURATION)

      const newToast: ToastItem = {
        id,
        title: title || message,
        description: description || (title ? message : undefined),
        variant,
        duration,
        action: onUndo ? (
          <ToastAction altText="Undo" onClick={() => onUndo()}>
            Undo
          </ToastAction>
        ) : (
          action
        ),
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

  const undo = useCallback(
    (message: string, onUndo: () => void, options: Omit<ToastOptions, 'onUndo'> = {}) => {
      return toast(message, { ...options, onUndo })
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

  const rendered = toasts.map((item) => {
    const Icon = variantIcons[item.variant]
    return (
      <Toast
        key={item.id}
        open={item.open}
        onOpenChange={(open: boolean) => !open && dismiss(item.id)}
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
        {isValidElement(item.action) ? item.action : null}
        <ToastClose />
      </Toast>
    )
  })

  return {
    value: { toasts, toast, success, error, warning, info, undo, dismiss, promise },
    rendered,
  }
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}
