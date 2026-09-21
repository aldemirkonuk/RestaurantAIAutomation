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
// Request headers that carry a credential rather than a description. Matched
// case-insensitively: Node lower-cases incoming header names, but an event can
// also be assembled by hand, and a case-sensitive delete is the classic way a
// scrubber silently stops scrubbing.
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "x-api-key",
  "proxy-authorization",
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
 * - drops credential request headers and cookies
 * - reduces `request.url` to origin+path, drops `request.query_string`,
 *   redacts a path-borne token, and scrubs the interceptor's `extra.url`
 * - reduces `user` to a pseudonymous id (+ non-PII custom keys like restaurant_id)
 * - strips common PII keys from free-form extra/contexts/request payloads
 *
 * The containers covered here are the contract all three runtimes share;
 * scripts/check_sentry_pii_scope.py fails the build if one of them stops
 * covering a container the others do.
 *
 * Exported so the scrubbing contract can be unit-tested.
 */
/**
 * Route prefixes whose NEXT path segment is a credential. Enumerates ROUTES
 * that bear a secret, not parameter names. It is still an allow-list, so it
 * does not stand alone: `scripts/check_sentry_pii_scope.py` enumerates every
 * `@Public()` route here whose path parameter is named like a credential and
 * FAILS THE BUILD if one is not covered. The three gateway entries were found
 * by PR #427's own security audit, which blocked the first version of this fix.
 */
const TOKEN_PATH_PREFIXES = [
  "/invite/", // web invite, and this service's /auth/invite/<code>
  "/studio/invite/",
  "/calendar/feed/", // @Public() iCal feed — a tenant-wide 64-char bearer
  "/digest/unsubscribe/", // @Public() one-click unsubscribe token
] as const;

/**
 * The URL as Sentry may keep it: origin and path, with a path-borne credential
 * replaced and the query gone entirely. Founder ruling 2026-09-21.
 *
 * Only the ONE segment after the prefix is replaced, so `/auth/invite/<code>/accept`
 * keeps `/accept`. Over-redaction is the safe direction.
 *
 * A plain string cut, never `new URL()`: this runs on an error path and must not
 * raise a second failure. Kept identical in all three runtimes.
 */
export function scrubUrl(raw: string): string {
  const cut = raw.search(/[?#]/);
  const path = cut === -1 ? raw : raw.slice(0, cut);
  for (const prefix of TOKEN_PATH_PREFIXES) {
    const at = path.indexOf(prefix);
    if (at === -1) continue;
    const from = at + prefix.length;
    const nextSlash = path.indexOf("/", from);
    const tail = nextSlash === -1 ? "" : path.slice(nextSlash);
    return `${path.slice(0, from)}<redacted>${tail}`;
  }
  return path;
}

export function scrubSentryEvent<T extends Sentry.Event>(event: T): T {
  if (event.request) {
    const headers = event.request.headers;
    if (headers) {
      for (const key of Object.keys(headers)) {
        if (SENSITIVE_HEADERS.has(key.toLowerCase())) delete headers[key];
      }
    }
    delete event.request.cookies;
    if (typeof event.request.url === "string") {
      event.request.url = scrubUrl(event.request.url);
    }
    // Set separately by @sentry/node's requestDataIntegration. `/inbound-email`
    // takes INBOUND_WEBHOOK_SECRET as @Query("secret") and the OAuth callback
    // takes @Query("code"), so this field carries real credentials on a 5xx.
    delete (event.request as Record<string, unknown>).query_string;
  }
  // The interceptor puts its own copy of the URL in `extra.url`, and
  // `scrubPiiKeys` never touches it because PII_KEYS has no `url`.
  const extra = event.extra as Record<string, unknown> | undefined;
  if (extra && typeof extra.url === "string") {
    extra.url = scrubUrl(extra.url);
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
