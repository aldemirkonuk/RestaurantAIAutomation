import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as Sentry from "@sentry/node";

// PII fields that must never reach the error tracker. `id` and custom
// pseudonymous keys (e.g. restaurant_id) are retained so errors can still be
// correlated to an account without identifying a person.
const PII_USER_KEYS = ["email", "username", "name", "ip_address"];
const PII_KEYS = new Set([
  "email",
  "name",
  "username",
  "first_name",
  "last_name",
  "phone",
  "phone_number",
  "ip_address",
  "address",
  "password",
  "ssn",
]);

/**
 * What the error tracker is allowed to know about a person.
 *
 * Deliberately only opaque identifiers. `id` and `restaurantId` are UUIDs that
 * mean nothing outside our own database, so an issue stays routable to an
 * account by support without Sentry ever holding an identity. `email` and
 * `username` used to be accepted here; removing them makes a re-introduction a
 * compile error at the call site, which `scrubSentryEvent` alone cannot do.
 *
 * Do not widen this type. If a new field is genuinely needed for triage, it has
 * to be an identifier that is meaningless to the processor.
 */
export interface SentryUserScope {
  id: string;
  restaurantId?: string;
}

function scrubPiiKeys(obj: Record<string, any> | undefined): void {
  if (!obj || typeof obj !== "object") return;
  for (const key of Object.keys(obj)) {
    if (PII_KEYS.has(key.toLowerCase())) delete obj[key];
  }
}

/**
 * Remove secrets and PII from a Sentry event before transmission.
 * - drops auth/cookie request headers
 * - reduces `user` to a pseudonymous id (+ non-PII custom keys like restaurant_id)
 * - strips common PII keys from free-form extra/contexts/request payloads
 * Exported so the scrubbing contract can be unit-tested.
 */
export function scrubSentryEvent<T extends Sentry.Event>(event: T): T {
  if (event.request?.headers) {
    delete event.request.headers["authorization"];
    delete event.request.headers["Authorization"];
    delete event.request.headers["cookie"];
    delete event.request.headers["Cookie"];
  }
  if (event.user) {
    for (const key of PII_USER_KEYS) {
      delete (event.user as Record<string, any>)[key];
    }
  }
  scrubPiiKeys(event.extra as Record<string, any>);
  scrubPiiKeys(event.request?.data as Record<string, any>);
  if (event.contexts) {
    for (const ctx of Object.values(event.contexts)) {
      scrubPiiKeys(ctx as Record<string, any>);
    }
  }
  return event;
}

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
    const dsn = this.configService.get<string>("SENTRY_DSN");
    const environment =
      this.configService.get<string>("NODE_ENV") || "development";

    if (!dsn) {
      this.logger.warn("Sentry DSN not configured - error tracking disabled");
      return;
    }

    try {
      Sentry.init({
        dsn,
        environment,
        tracesSampleRate: environment === "production" ? 0.1 : 1.0,
        profilesSampleRate: environment === "production" ? 0.1 : 1.0,
        // Already the SDK default, stated explicitly because it is a privacy
        // control and a silent default is not a control anyone can audit.
        // Keeps the SDK from attaching request bodies, cookies and client IPs
        // of its own accord. It does NOT cover anything we set ourselves —
        // Sentry's own docs are explicit that `setUser` bypasses it — which is
        // why SentryUserScope above exists as well.
        sendDefaultPii: false,
        integrations: [
          // Add integrations as needed
        ],
        // Last line of defense: strip secrets and PII from every event.
        beforeSend(event) {
          return scrubSentryEvent(event);
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
      this.logger.error(
        `Error (Sentry disabled): ${error.message}`,
        error.stack,
      );
      return null;
    }

    const eventId = Sentry.captureException(error, {
      extra: context,
    });

    this.logger.error(
      `Error captured: ${error.message} (Event ID: ${eventId})`,
    );
    return eventId;
  }

  /**
   * Capture a message
   */
  captureMessage(
    message: string,
    level: Sentry.SeverityLevel = "info",
    context?: Record<string, any>,
  ): string | null {
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
  setUser(user: SentryUserScope): void {
    if (!this.initialized) return;

    // Minimize: send only a pseudonymous id and the tenant id. Email and
    // name are deliberately NOT forwarded to the error tracker.
    Sentry.setUser({
      id: user.id,
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
