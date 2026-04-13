import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/node';

/**
 * Sentry Error Tracking Service
 * 
 * Provides centralized error tracking and monitoring:
 * - Automatic error capture
 * - Custom error reporting
 * - User context tracking
 * - Performance monitoring
 */
@Injectable()
export class SentryService implements OnModuleInit {
  private readonly logger = new Logger(SentryService.name);
  private initialized = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.initialize();
  }

  /**
   * Initialize Sentry SDK
   */
  initialize(): void {
    const dsn = this.configService.get<string>('SENTRY_DSN');
    const environment = this.configService.get<string>('NODE_ENV') || 'development';

    if (!dsn) {
      this.logger.warn('Sentry DSN not configured - error tracking disabled');
      return;
    }

    try {
      Sentry.init({
        dsn,
        environment,
        tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
        profilesSampleRate: environment === 'production' ? 0.1 : 1.0,
        integrations: [
          // Add integrations as needed
        ],
        beforeSend(event) {
          // Filter out sensitive data
          if (event.request?.headers) {
            delete event.request.headers['authorization'];
            delete event.request.headers['cookie'];
          }
          return event;
        },
      });

      this.initialized = true;
      this.logger.log(`✅ Sentry initialized (environment: ${environment})`);
    } catch (error) {
      this.logger.error(`Failed to initialize Sentry: ${error.message}`);
    }
  }

  /**
   * Check if Sentry is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Capture an exception
   */
  captureException(error: Error, context?: Record<string, any>): string | null {
    if (!this.initialized) {
      this.logger.error(`Error (Sentry disabled): ${error.message}`, error.stack);
      return null;
    }

    const eventId = Sentry.captureException(error, {
      extra: context,
    });

    this.logger.error(`Error captured: ${error.message} (Event ID: ${eventId})`);
    return eventId;
  }

  /**
   * Capture a message
   */
  captureMessage(message: string, level: Sentry.SeverityLevel = 'info', context?: Record<string, any>): string | null {
    if (!this.initialized) {
      this.logger.log(`Message (Sentry disabled): ${message}`);
      return null;
    }

    const eventId = Sentry.captureMessage(message, {
      level,
      extra: context,
    });

    return eventId;
  }

  /**
   * Set user context for error tracking
   */
  setUser(user: { id: string; email?: string; username?: string; restaurantId?: string }): void {
    if (!this.initialized) return;

    Sentry.setUser({
      id: user.id,
      email: user.email,
      username: user.username,
      // Custom data
      restaurant_id: user.restaurantId,
    });
  }

  /**
   * Clear user context
   */
  clearUser(): void {
    if (!this.initialized) return;
    Sentry.setUser(null);
  }

  /**
   * Set extra context
   */
  setContext(name: string, context: Record<string, any>): void {
    if (!this.initialized) return;
    Sentry.setContext(name, context);
  }

  /**
   * Set tag
   */
  setTag(key: string, value: string): void {
    if (!this.initialized) return;
    Sentry.setTag(key, value);
  }

  /**
   * Add breadcrumb for debugging
   */
  addBreadcrumb(breadcrumb: Sentry.Breadcrumb): void {
    if (!this.initialized) return;
    Sentry.addBreadcrumb(breadcrumb);
  }

  /**
   * Start a transaction for performance monitoring
   */
  startTransaction(name: string, op: string): Sentry.Span | null {
    if (!this.initialized) return null;
    return Sentry.startInactiveSpan({ name, op });
  }

  /**
   * Flush pending events before shutdown
   */
  async flush(timeout: number = 2000): Promise<boolean> {
    if (!this.initialized) return true;
    return Sentry.flush(timeout);
  }
}
