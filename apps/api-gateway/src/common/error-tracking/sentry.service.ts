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

// OpenTelemetry attaches its own copy of the request URL here, independent of
// `event.request`: `contexts.trace.data` and each span's own `data` carry
// `url`/`http.url`/`http.target`/`http.query` (and similar) regardless of what
// `event.request.url` says. `scrubPiiKeys`'s key-name pass over `contexts`
// never reaches these because `data` is not a PII key name -- confirmed live
// by PR #427's own round-2 audit, which found the calendar feed token and the
// inbound-webhook secret both survived here after `request.url` was already
// fixed. Query-only keys are dropped entirely, matching the founder's ruling
// already applied to `request.query_string`; URL/path keys go through
// scrubUrl, which redacts a path-borne token and drops any query it still has.
// `http.fragment` joined 2026-09-25 (PR #427 round 3): @sentry/node's outgoing
// http and fetch breadcrumbs set it beside `http.query`. scrubUrl already cuts at
// `#`; this is the same rule for the key that holds the fragment on its own.
const SPAN_DATA_QUERY_KEYS = [
  "url.query",
  "http.query",
  "http.fragment",
] as const;
const SPAN_DATA_URL_KEYS = [
  "url",
  "url.full",
  "url.path",
  "http.url",
  "http.target",
] as const;

function scrubSpanData(data: Record<string, unknown> | undefined): void {
  if (!data || typeof data !== "object") return;
  for (const key of SPAN_DATA_QUERY_KEYS) {
    delete data[key];
  }
  for (const key of SPAN_DATA_URL_KEYS) {
    if (typeof data[key] === "string") {
      data[key] = scrubUrl(data[key] as string);
    }
  }
}

/**
 * Remove secrets and PII from a Sentry event before transmission.
 * - drops credential request headers and cookies
 * - reduces `request.url` to origin+path, drops `request.query_string`,
 *   redacts a path-borne token, and scrubs the interceptor's `extra.url`
 * - reduces `user` to a pseudonymous id (+ non-PII custom keys like restaurant_id)
 * - strips common PII keys from free-form extra/contexts, and drops the
 *   request body (`request.data`) whole
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
  "/invite/", // web invite, and the gateway"s /auth/invite/<code>
  "/invites/", // DELETE /restaurants/:id/invites/:code — the SAME
  // organization_invites.code column as /auth/invite/. Found by PR #427"s own
  // correctness audit: it leaks exactly when the revoke FAILED, i.e. while the
  // invite is still live and still grants a role on a real tenant.
  "/studio/invite/", // studio invite
  "/devices/", // DELETE /mobile/devices/:token — a push-send capability
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

/**
 * Free text as Sentry may keep it: scrubUrl's two rules, applied where a URL
 * sits INSIDE a sentence rather than being the whole field — a breadcrumb or
 * log message, an exception's message. Any query or fragment carrying a
 * `key=value` is removed wherever it sits (a bare `?`/`#` is left alone), and
 * the one segment after every TOKEN_PATH_PREFIXES occurrence is replaced.
 * PR #427 round 3 (2026-09-25). Kept identical in all three runtimes.
 */
const TEXT_QUERY_RE = /[?#][^\s'"<>`]*=[^\s'"<>`]*/g;
const TEXT_TOKEN_SEGMENT_RES = TOKEN_PATH_PREFIXES.map((prefix) => {
  const literal = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [prefix, new RegExp(`${literal}[^/\\s?#'"<>\`]+`, "g")] as const;
});

export function scrubText(raw: string): string {
  let out = raw.replace(TEXT_QUERY_RE, "");
  for (const [prefix, pattern] of TEXT_TOKEN_SEGMENT_RES) {
    out = out.replace(pattern, `${prefix}<redacted>`);
  }
  return out;
}

// A navigation breadcrumb keeps its URLs in `from`/`to`; an http/fetch one uses
// the same keys as span data (`url`, `http.query`, `http.fragment`).
const BREADCRUMB_URL_KEYS = ["from", "to"] as const;

/**
 * Breadcrumbs are merged onto the event BEFORE `beforeSend`. On this runtime
 * the load-bearing ones are @sentry/node's outgoing http and fetch crumbs:
 * `data['http.query']` is the outgoing request's raw query, and a PostgREST
 * lookup by token is exactly `?token=eq.<token>` — so an error after the
 * calendar-feed lookup carried the feed bearer in a crumb even though every
 * other container was clean. Console crumbs keep their text in `message` and
 * `data.arguments`. The web runtime scrubbed breadcrumbs and this one did not
 * until PR #427 round 3 (2026-09-25).
 */
function scrubBreadcrumbs(crumbs: unknown): void {
  if (!Array.isArray(crumbs)) return;
  for (const crumb of crumbs) {
    if (!crumb || typeof crumb !== "object") continue;
    const c = crumb as { message?: unknown; data?: unknown };
    if (typeof c.message === "string") c.message = scrubText(c.message);
    if (!c.data || typeof c.data !== "object") continue;
    const data = c.data as Record<string, unknown>;
    scrubSpanData(data);
    for (const key of BREADCRUMB_URL_KEYS) {
      if (typeof data[key] === "string") {
        data[key] = scrubUrl(data[key] as string);
      }
    }
    if (Array.isArray(data.arguments)) {
      data.arguments = data.arguments.map((arg: unknown) =>
        typeof arg === "string" ? scrubText(arg) : arg,
      );
    }
  }
}

/**
 * Every string inside a frame's local variables, however deeply nested. The
 * Python SDK attaches locals by default (`include_local_variables`), and PR
 * #427's round-3 wire test found an httpx `Request` repr and an error message
 * — both quoting the token-bearing URL — in `frames[].vars`. Depth-capped: it
 * runs on an error path and must not recurse without bound. Kept identical in
 * all three runtimes although only Python populates `vars` today.
 */
function scrubStringsDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubText(value);
  if (depth > 8 || !value || typeof value !== "object") return value;
  const bag = value as Record<string, unknown>;
  for (const key of Object.keys(bag)) {
    bag[key] = scrubStringsDeep(bag[key], depth + 1);
  }
  return value;
}

/**
 * An exception's message can quote the URL it failed on. Frame paths are only
 * touched when they are http(s) URLs, so a filesystem path — and with it
 * source maps and issue grouping — is left exactly as the SDK produced it.
 */
function scrubExceptions(exception: unknown): void {
  const values = (exception as { values?: unknown } | undefined)?.values;
  if (!Array.isArray(values)) return;
  for (const ex of values) {
    if (!ex || typeof ex !== "object") continue;
    const e = ex as { value?: unknown; stacktrace?: { frames?: unknown } };
    if (typeof e.value === "string") e.value = scrubText(e.value);
    const frames = e.stacktrace?.frames;
    if (!Array.isArray(frames)) continue;
    for (const frame of frames) {
      if (!frame || typeof frame !== "object") continue;
      const f = frame as Record<string, unknown>;
      if (f.vars && typeof f.vars === "object") scrubStringsDeep(f.vars);
      for (const key of ["filename", "abs_path"]) {
        const v = f[key];
        if (typeof v === "string" && /^https?:\/\//.test(v)) {
          f[key] = scrubUrl(v);
        }
      }
    }
  }
}

/** `captureMessage` text and a log record's template, params and formatted form. */
function scrubLogentry(logentry: unknown): void {
  if (!logentry || typeof logentry !== "object") return;
  const l = logentry as {
    message?: unknown;
    formatted?: unknown;
    params?: unknown;
  };
  if (typeof l.message === "string") l.message = scrubText(l.message);
  if (typeof l.formatted === "string") l.formatted = scrubText(l.formatted);
  if (Array.isArray(l.params)) {
    l.params = l.params.map((p: unknown) =>
      typeof p === "string" ? scrubText(p) : p,
    );
  }
}

export function scrubSentryEvent<T extends Sentry.Event>(event: T): T {
  if (event.request) {
    const headers = event.request.headers;
    if (headers) {
      for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (SENSITIVE_HEADERS.has(lower)) {
          delete headers[key];
        } else if (lower === "referer" && typeof headers[key] === "string") {
          // The calling page's full URL. A browser on `/invite/<code>` or
          // `/reset-password?token=` sends it with every API call it makes,
          // unless ADR 0158's `no-referrer` header applied to that exact
          // spelling of the path. Scrubbed, not dropped. PR #427 round 3.
          headers[key] = scrubUrl(headers[key]);
        }
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
    // The request BODY, dropped whole -- never key-scrubbed. @sentry/node-core's
    // httpServerIntegration (a default, `maxIncomingRequestBodySize` 'medium')
    // copies every incoming body into `request.data` as a raw utf-8 STRING of
    // up to 10 KB, and requestDataIntegration attaches it whatever
    // sendDefaultPii says. scrubPiiKeys returns early on a string, so
    // `POST /auth/reset-password` carried its token and new password to Sentry
    // on a 5xx or a sampled transaction; `/auth/refresh` its refreshToken,
    // the OAuth sign-in routes the provider token. ADR 0040 was decided on
    // the premise that "the SDK defaults already withheld bodies"; this makes
    // it true.
    // Proven on the wire (sentry-wire.spec.ts) and against a live http server
    // (PR #427 round 5).
    delete event.request.data;
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
  if (event.contexts) {
    for (const ctx of Object.values(event.contexts)) {
      scrubPiiKeys(ctx as Record<string, any>);
    }
  }
  // The transaction/span NAME is built from the raw request path -- a
  // `GET /calendar/feed/<token>.ics` request names its own transaction
  // `<token>.ics` regardless of what request.url says.
  if (typeof event.transaction === "string") {
    event.transaction = scrubUrl(event.transaction);
  }
  scrubSpanData(event.contexts?.trace?.data);
  if (Array.isArray(event.spans)) {
    for (const span of event.spans) {
      scrubSpanData(span.data);
    }
  }
  scrubBreadcrumbs(event.breadcrumbs);
  // Free text that can quote a URL: the event's own message, a log record, and
  // each exception's message and frames. PR #427 round 3.
  if (typeof event.message === "string") {
    event.message = scrubText(event.message);
  }
  scrubLogentry(event.logentry);
  scrubExceptions(event.exception);
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
        // Keeps the SDK from attaching cookies and client IPs of its own
        // accord. It does NOT withhold request bodies on @sentry/node 10
        // (requestDataIntegration's `data: true` default ignores it) — that is
        // why scrubSentryEvent drops `request.data` — and it does not cover
        // anything we set ourselves (`setUser` bypasses it), which is why
        // SentryUserScope above exists as well.
        sendDefaultPii: false,
        // Already the SDK default: @sentry/node-core's localVariablesIntegration
        // is in the default set but its setup() returns early unless this is
        // truthy (local-variables-async.js:108, local-variables-sync.js:275).
        // Stated so the Node side of ADR 0040's "stop sending locals" is a line
        // a guard can read rather than an absence. PR #427 round 5.
        includeLocalVariables: false,
        integrations: [
          // Add integrations as needed
        ],
        // Last line of defense: strip secrets and PII from every event.
        // Sentry calls `beforeSend` for ERROR events ONLY — @sentry/core gates it
        // on `isErrorEvent(processedEvent) && beforeSend`. With tracesSampleRate
        // set, a SUCCESSFUL request is sampled into a transaction event that
        // carries request.url, query_string, headers and cookies straight from
        // requestDataIntegration — so without this hook the @Public()
        // /calendar/feed/<token>.ics bearer shipped in the clear on 1 in 10
        // successful reads, a larger volume than the 5xx path. Found by PR
        // #427's own security re-audit. scrubSentryEvent is type-agnostic and
        // never returns null, so it cannot drop a transaction.
        beforeSend(event) {
          return scrubSentryEvent(event);
        },
        beforeSendTransaction(event) {
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
