import * as Sentry from '@sentry/react'
import { BrowserTracing } from '@sentry/tracing'

/**
 * Error Tracking Library
 *
 * Provides centralized error tracking for the frontend:
 * - Sentry integration
 * - Error boundary support
 * - User context tracking
 * - Performance monitoring
 */

interface SentryUser {
  id: string
  email?: string
  username?: string
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

class ErrorTrackingService {
  private initialized = false
  private config: ErrorTrackingConfig | null = null

  /**
   * Initialize error tracking
   */
  init(config: ErrorTrackingConfig): void {
    if (this.initialized) {
      console.warn('Error tracking already initialized')
      return
    }

    this.config = config

    if (!config.dsn) {
      console.warn('[ErrorTracking] No DSN provided - error tracking disabled')
      return
    }

    Sentry.init({
      dsn: config.dsn,
      environment: config.environment,
      release: config.release,
      tracesSampleRate: config.tracesSampleRate ?? 0.1,
      integrations: [new BrowserTracing()],
      beforeSend(event) {
        // Placeholder for any filtering rules
        return event
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
      Sentry.setUser({
        id: user.id,
        email: user.email,
        username: user.username,
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
