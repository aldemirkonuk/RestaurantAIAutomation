import * as Sentry from '@sentry/react'

/**
 * Error Tracking Library
 *
 * Provides centralized error tracking for the frontend:
 * - Sentry integration
 * - Error boundary support
 * - User context tracking
 * - Performance monitoring
 */

/**
 * What the error tracker is allowed to know about a person.
 *
 * Deliberately only opaque identifiers. `id` and `restaurantId` are UUIDs that
 * mean nothing outside our own database, so a Sentry issue is still routable to
 * an account by support without Sentry ever holding an identity. `email` and
 * `username` used to be here; they were the leak this type now prevents —
 * removing the fields makes a re-introduction a compile error at the call site,
 * which `scrubSentryEvent` alone could not do.
 *
 * Do not widen this type. If a new field is genuinely needed for triage, it has
 * to be an identifier that is meaningless to the processor.
 */
interface SentryUser {
  id: string
  restaurantId?: string
}

interface SentryBreadcrumb {
  category?: string
  message?: string
  level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug'
  data?: Record<string, any>
}

interface ErrorTrackingConfig {
  dsn: string
  environment: string
  release?: string
  tracesSampleRate?: number
}

// PII fields that must never leave the browser inside a Sentry event.
// `id` and custom pseudonymous keys (e.g. restaurantId) are retained so
// errors can still be correlated to an account without identifying a person.
const PII_USER_KEYS = ['email', 'username', 'name', 'ip_address']
const PII_KEYS = new Set([
  'email',
  'name',
  'username',
  'first_name',
  'last_name',
  'phone',
  'phone_number',
  'ip_address',
  'address',
  'password',
  'ssn',
])
// Request headers that carry a credential rather than a description.
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'x-api-key',
  'proxy-authorization',
])

function scrubPiiKeys(obj: Record<string, any> | undefined): void {
  if (!obj || typeof obj !== 'object') return
  for (const key of Object.keys(obj)) {
    if (PII_KEYS.has(key.toLowerCase())) delete obj[key]
  }
}

/**
 * Remove PII from a Sentry event before it is transmitted.
 * - drops credential request headers and cookies
 * - reduces `user` to a pseudonymous id (+ non-PII custom keys like restaurantId)
 * - strips common PII keys from free-form extra/contexts/request payloads
 *
 * The containers covered here are the contract all three runtimes share;
 * scripts/check_sentry_pii_scope.py fails the build if one of them stops
 * covering a container the others do.
 *
 * Exported so the scrubbing contract can be unit-tested.
 */
export function scrubSentryEvent<T extends Sentry.Event>(event: T): T {
  if (event.request) {
    const headers = event.request.headers
    if (headers) {
      for (const key of Object.keys(headers)) {
        if (SENSITIVE_HEADERS.has(key.toLowerCase())) delete headers[key]
      }
    }
    delete event.request.cookies
  }
  if (event.user) {
    for (const key of PII_USER_KEYS) {
      delete (event.user as Record<string, any>)[key]
    }
  }
  scrubPiiKeys(event.extra as Record<string, any>)
  scrubPiiKeys(event.request?.data as Record<string, any>)
  if (event.contexts) {
    for (const ctx of Object.values(event.contexts)) {
      scrubPiiKeys(ctx as Record<string, any>)
    }
  }
  return event
}

class ErrorTrackingService {
  private initialized = false

  /**
   * Initialize error tracking
   */
  init(config: ErrorTrackingConfig): void {
    if (this.initialized) {
      console.warn('Error tracking already initialized')
      return
    }

    if (!config.dsn) {
      console.warn('[ErrorTracking] No DSN provided - error tracking disabled')
      return
    }

    Sentry.init({
      dsn: config.dsn,
      environment: config.environment,
      release: config.release,
      tracesSampleRate: config.tracesSampleRate ?? 0.1,
      // Already the SDK default, stated explicitly because it is a privacy
      // control and a silent default is not a control anyone can audit.
      // Keeps the SDK from attaching request bodies, cookies and client IPs of
      // its own accord. It does NOT cover anything we set ourselves — Sentry's
      // own docs are explicit that `setUser` bypasses it — which is why the
      // SentryUser type above is narrowed as well.
      sendDefaultPii: false,
      integrations: [],
      // Last line of defense: strip PII from every event, whatever set it.
      beforeSend(event) {
        return scrubSentryEvent(event)
      },
    })

    this.initialized = true
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Capture an exception
   */
  captureException(error: Error, context?: Record<string, any>): string | null {
    if (!this.initialized) {
      console.error('[ErrorTracking] Error (not initialized):', error)
      return null
    }

    return Sentry.captureException(error, {
      extra: context,
    })
  }

  /**
   * Capture a message
   */
  captureMessage(
    message: string,
    level: 'info' | 'warning' | 'error' = 'info',
    context?: Record<string, any>,
  ): string | null {
    if (!this.initialized) {
      console.log(`[ErrorTracking] Message (not initialized): ${message}`)
      return null
    }

    return Sentry.captureMessage(message, {
      level: level as Sentry.SeverityLevel,
      extra: context,
    })
  }

  /**
   * Set user context
   */
  setUser(user: SentryUser | null): void {
    if (!this.initialized) return

    if (user) {
      // Minimize: send only a pseudonymous id and the tenant id. Email and
      // name are deliberately NOT forwarded to the error tracker.
      Sentry.setUser({
        id: user.id,
        restaurantId: user.restaurantId,
      })
    } else {
      Sentry.setUser(null)
    }
  }

  /**
   * Set custom context
   */
  setContext(name: string, context: Record<string, any>): void {
    if (!this.initialized) return
    Sentry.setContext(name, context)
  }

  /**
   * Set tag for filtering
   */
  setTag(key: string, value: string): void {
    if (!this.initialized) return
    Sentry.setTag(key, value)
  }

  /**
   * Add breadcrumb for trail
   */
  addBreadcrumb(breadcrumb: SentryBreadcrumb): void {
    if (!this.initialized) return
    Sentry.addBreadcrumb(breadcrumb)
  }
}

// Export singleton instance
export const errorTracking = new ErrorTrackingService()

// Export initialization function
export function initErrorTracking(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN || ''
  const environment = import.meta.env.MODE || 'development'
  const release = import.meta.env.VITE_APP_VERSION || '1.0.0'

  errorTracking.init({
    dsn,
    environment,
    release,
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
  })
}

// Export types
export type { SentryUser, SentryBreadcrumb, ErrorTrackingConfig }
