import { errorTracking } from './error-tracking'

interface ErrorContext {
  type: 'window_error' | 'unhandled_rejection' | 'resource_error'
  url?: string
  line?: number
  column?: number
  error?: Error
  reason?: any
}

/**
 * Global error handler for uncaught errors and unhandled promise rejections
 * 
 * This module sets up global error listeners to catch and report errors
 * that escape component boundaries.
 */

let isInitialized = false

function logError(context: ErrorContext) {
  if (import.meta.env.DEV) {
    console.error('Global Error Handler:', context)
  }
}

/**
 * Handle window errors (syntax errors, network errors, etc.)
 */
function handleWindowError(event: ErrorEvent) {
  const context: ErrorContext = {
    type: 'window_error',
    url: event.filename,
    line: event.lineno,
    column: event.colno,
    error: event.error,
  }

  logError(context)

  // Report to error tracking (Sentry placeholder)
  if (event.error) {
    errorTracking.captureException(event.error, {
      type: 'window_error',
      url: event.filename,
      line: event.lineno,
      column: event.colno,
    })
  } else {
    errorTracking.captureMessage(event.message, 'error', {
      type: 'window_error',
      url: event.filename,
      line: event.lineno,
      column: event.colno,
    })
  }

  // Don't prevent default error handling
  return false
}

/**
 * Handle unhandled promise rejections
 */
function handleUnhandledRejection(event: PromiseRejectionEvent) {
  const context: ErrorContext = {
    type: 'unhandled_rejection',
    reason: event.reason,
  }

  logError(context)

  // Report to error tracking
  if (event.reason instanceof Error) {
    errorTracking.captureException(event.reason, {
      type: 'unhandled_rejection',
    })
  } else {
    errorTracking.captureMessage(
      `Unhandled Promise Rejection: ${String(event.reason)}`,
      'error',
      {
        type: 'unhandled_rejection',
        reason: event.reason,
      }
    )
  }

  // Prevent default browser console error
  event.preventDefault()
}

/**
 * Handle resource loading errors (images, scripts, etc.)
 */
function handleResourceError(event: Event) {
  const target = event.target as HTMLElement

  // Only handle resource errors, not general errors
  if (!target || (target as unknown) === window) {
    return
  }

  const context: ErrorContext = {
    type: 'resource_error',
    url: (target as any).src || (target as any).href,
  }

  logError(context)

  // Report to error tracking
  errorTracking.captureMessage(
    `Resource failed to load: ${context.url}`,
    'warning',
    {
      type: 'resource_error',
      url: context.url,
      tagName: target.tagName,
    }
  )
}

/**
 * Initialize global error handlers
 * Should be called once at application startup
 */
export function initGlobalErrorHandler() {
  if (isInitialized) {
    console.warn('Global error handler already initialized')
    return
  }

  // Handle uncaught errors
  window.addEventListener('error', handleWindowError)

  // Handle unhandled promise rejections
  window.addEventListener('unhandledrejection', handleUnhandledRejection)

  // Handle resource loading errors (capture phase)
  window.addEventListener('error', handleResourceError, true)

  isInitialized = true

  if (import.meta.env.DEV) {
    console.log('Global error handler initialized')
  }
}

/**
 * Clean up global error handlers
 * Useful for testing or hot module replacement
 */
export function cleanupGlobalErrorHandler() {
  if (!isInitialized) {
    return
  }

  window.removeEventListener('error', handleWindowError)
  window.removeEventListener('unhandledrejection', handleUnhandledRejection)
  window.removeEventListener('error', handleResourceError, true)

  isInitialized = false

  if (import.meta.env.DEV) {
    console.log('Global error handler cleaned up')
  }
}

/**
 * Manually report an error to the global error handler
 * Useful for caught errors that should still be reported
 */
export function reportError(error: Error, context?: Record<string, any>) {
  errorTracking.captureException(error, {
    ...context,
    type: 'manual_report',
  })

  if (import.meta.env.DEV) {
    console.error('Manually reported error:', error, context)
  }
}
