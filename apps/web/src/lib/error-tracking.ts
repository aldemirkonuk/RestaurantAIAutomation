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
// http and fetch breadcrumbs set it beside `http.query`, and a fragment is where
// Supabase puts `#access_token=`. scrubUrl already cuts at `#`; this is the same
// rule for the key that holds the fragment on its own.
const SPAN_DATA_QUERY_KEYS = ['url.query', 'http.query', 'http.fragment'] as const
const SPAN_DATA_URL_KEYS = ['url', 'url.full', 'url.path', 'http.url', 'http.target'] as const

function scrubSpanData(data: Record<string, unknown> | undefined): void {
  if (!data || typeof data !== 'object') return
  for (const key of SPAN_DATA_QUERY_KEYS) {
    delete data[key]
  }
  for (const key of SPAN_DATA_URL_KEYS) {
    if (typeof data[key] === 'string') {
      data[key] = scrubUrl(data[key] as string)
    }
  }
}

/**
 * Remove PII from a Sentry event before it is transmitted.
 * - drops credential request headers and cookies
 * - reduces `request.url` to origin+path, drops `request.query_string`,
 *   redacts a path-borne token, and does the same to breadcrumb URLs
 * - reduces `user` to a pseudonymous id (+ non-PII custom keys like restaurantId)
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
 * Route prefixes whose NEXT path segment is a credential.
 *
 * Stripping the query does not reach these — `/invite/<code>` IS the invite
 * credential. This enumerates ROUTES that bear a secret, which is a fact the
 * repo already maintains, rather than parameter names someone has to remember.
 *
 * It is still an allow-list, and an allow-list fails open — which is the exact
 * property the founder rejected when he chose "strip the query entirely" over
 * redacting known parameter names. So it does not stand alone:
 * `scripts/check_sentry_pii_scope.py` enumerates every `@Public()` gateway route
 * whose path parameter is named like a credential and FAILS THE BUILD if one is
 * not covered here. Adding a token-bearing public route without adding it here
 * is a red build, not a silent leak.
 *
 * The three gateway entries were found by PR #427's own security audit, which
 * blocked the first version of this fix for missing them.
 */
const TOKEN_PATH_PREFIXES = [
  '/invite/', // web invite, and the gateway's /auth/invite/<code>
  '/invites/', // DELETE /restaurants/:id/invites/:code — the SAME
  // organization_invites.code column as /auth/invite/. Found by PR #427's own
  // correctness audit: it leaks exactly when the revoke FAILED, i.e. while the
  // invite is still live and still grants a role on a real tenant.
  '/studio/invite/', // studio invite
  '/devices/', // DELETE /mobile/devices/:token — a push-send capability
  '/calendar/feed/', // @Public() iCal feed — a tenant-wide 64-char bearer
  '/digest/unsubscribe/', // @Public() one-click unsubscribe token
] as const

/**
 * The URL as Sentry may keep it: origin and path, with a path-borne credential
 * replaced and the query gone entirely.
 *
 * Founder ruling 2026-09-21 — strip the query ENTIRELY rather than redact known
 * secret-bearing parameter names, because an allow-list reports health for every
 * parameter nobody remembered to add. That is exactly how the gap this closes
 * arose: the scrubber covered headers, cookies, user, extra, request.data and
 * contexts, and never `request.url`, so a JS error on `/reset-password?token=...`
 * shipped the token to Sentry with a live DSN.
 *
 * What is traded: the query no longer says which page state produced an error.
 *
 * Only the ONE segment after the prefix is replaced, not the whole tail, so
 * `/auth/invite/<code>/accept` keeps `/accept` and an on-call can still tell the
 * routes apart. Over-redaction is the safe direction and is accepted: a path
 * that merely looks like a token route loses one segment.
 *
 * A plain string cut, never `new URL()` — this runs inside `before_send` on an
 * error path, so it must not raise a second failure, and it must work on a
 * relative URL.
 */
export function scrubUrl(raw: string): string {
  const cut = raw.search(/[?#]/)
  const path = cut === -1 ? raw : raw.slice(0, cut)
  for (const prefix of TOKEN_PATH_PREFIXES) {
    const at = path.indexOf(prefix)
    if (at === -1) continue
    const from = at + prefix.length
    const nextSlash = path.indexOf('/', from)
    const tail = nextSlash === -1 ? '' : path.slice(nextSlash)
    return `${path.slice(0, from)}<redacted>${tail}`
  }
  return path
}

/**
 * Free text as Sentry may keep it: scrubUrl's two rules, applied where a URL
 * sits INSIDE a sentence rather than being the whole field — a breadcrumb or
 * log message (`HTTP Request: GET https://…/studio_invites?token=eq.<t>`), an
 * exception's message (`… for url 'https://…?key=<api key>'`).
 *
 * - any query or fragment carrying a `key=value` is removed, wherever it sits.
 *   A bare `?` or `#` is left alone so an ordinary sentence survives.
 * - the one segment after every TOKEN_PATH_PREFIXES occurrence is replaced.
 *
 * Added 2026-09-25 (PR #427 round 3). Over-redaction is the safe direction and
 * is accepted, as for scrubUrl. Never throws: it runs on an error path.
 */
const TEXT_QUERY_RE = /[?#][^\s'"<>`]*=[^\s'"<>`]*/g
const TEXT_TOKEN_SEGMENT_RES = TOKEN_PATH_PREFIXES.map((prefix) => {
  const literal = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [prefix, new RegExp(`${literal}[^/\\s?#'"<>\`]+`, 'g')] as const
})

export function scrubText(raw: string): string {
  let out = raw.replace(TEXT_QUERY_RE, '')
  for (const [prefix, pattern] of TEXT_TOKEN_SEGMENT_RES) {
    out = out.replace(pattern, `${prefix}<redacted>`)
  }
  return out
}

// A navigation breadcrumb keeps its URLs in `from`/`to`; an http/fetch one uses
// the same keys as span data (`url`, `http.query`, `http.fragment`).
const BREADCRUMB_URL_KEYS = ['from', 'to'] as const

/**
 * Breadcrumbs are merged onto the event BEFORE `beforeSend`, so a navigation
 * away from `/reset-password?token=...` leaves the token in the buffer for the
 * next hundred breadcrumbs even though `request.url` is clean. Round 3 (PR #427,
 * 2026-09-25) widened this from `data.from/to/url` to the whole crumb: the
 * `message` (console and logging crumbs), the console crumb's own copy of its
 * `arguments`, and the span-data keys an outgoing http/fetch crumb carries —
 * @sentry/node puts an outgoing request's query in `data['http.query']`, and a
 * PostgREST lookup by token is exactly `?token=eq.<token>`.
 */
function scrubBreadcrumbs(crumbs: unknown): void {
  if (!Array.isArray(crumbs)) return
  for (const crumb of crumbs) {
    if (!crumb || typeof crumb !== 'object') continue
    const c = crumb as { message?: unknown; data?: unknown }
    if (typeof c.message === 'string') c.message = scrubText(c.message)
    if (!c.data || typeof c.data !== 'object') continue
    const data = c.data as Record<string, unknown>
    scrubSpanData(data)
    for (const key of BREADCRUMB_URL_KEYS) {
      if (typeof data[key] === 'string') data[key] = scrubUrl(data[key] as string)
    }
    if (Array.isArray(data.arguments)) {
      data.arguments = data.arguments.map((arg: unknown) =>
        typeof arg === 'string' ? scrubText(arg) : arg,
      )
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
  if (typeof value === 'string') return scrubText(value)
  if (depth > 8 || !value || typeof value !== 'object') return value
  const bag = value as Record<string, unknown>
  for (const key of Object.keys(bag)) {
    bag[key] = scrubStringsDeep(bag[key], depth + 1)
  }
  return value
}

/**
 * An exception's message can quote the URL it failed on, and a frame's file can
 * BE the page URL — an error thrown by index.html's inline script names the
 * document itself, token and all. Only frame paths that are http(s) URLs are
 * touched, so a bundle or filesystem path (and with it source maps and
 * grouping) is left exactly as the SDK produced it.
 */
function scrubExceptions(exception: unknown): void {
  const values = (exception as { values?: unknown } | undefined)?.values
  if (!Array.isArray(values)) return
  for (const ex of values) {
    if (!ex || typeof ex !== 'object') continue
    const e = ex as { value?: unknown; stacktrace?: { frames?: unknown } }
    if (typeof e.value === 'string') e.value = scrubText(e.value)
    const frames = e.stacktrace?.frames
    if (!Array.isArray(frames)) continue
    for (const frame of frames) {
      if (!frame || typeof frame !== 'object') continue
      const f = frame as Record<string, unknown>
      if (f.vars && typeof f.vars === 'object') scrubStringsDeep(f.vars)
      for (const key of ['filename', 'abs_path']) {
        const v = f[key]
        if (typeof v === 'string' && /^https?:\/\//.test(v)) f[key] = scrubUrl(v)
      }
    }
  }
}

/** `captureMessage` text and a log record's template, params and formatted form. */
function scrubLogentry(logentry: unknown): void {
  if (!logentry || typeof logentry !== 'object') return
  const l = logentry as { message?: unknown; formatted?: unknown; params?: unknown }
  if (typeof l.message === 'string') l.message = scrubText(l.message)
  if (typeof l.formatted === 'string') l.formatted = scrubText(l.formatted)
  if (Array.isArray(l.params)) {
    l.params = l.params.map((p: unknown) => (typeof p === 'string' ? scrubText(p) : p))
  }
}

export function scrubSentryEvent<T extends Sentry.Event>(event: T): T {
  if (event.request) {
    const headers = event.request.headers
    if (headers) {
      for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase()
        if (SENSITIVE_HEADERS.has(lower)) {
          delete headers[key]
        } else if (lower === 'referer' && typeof headers[key] === 'string') {
          // The previous page's full URL. The browser SDK copies
          // `document.referrer` here, so a hard navigation off
          // `/invite/<code>` or `/reset-password?token=` carries the credential
          // unless ADR 0158's `no-referrer` header happened to apply to that
          // exact spelling of the path. Scrubbed, not dropped: the origin and
          // path still say where the person came from. PR #427 round 3.
          headers[key] = scrubUrl(headers[key])
        }
      }
    }
    delete event.request.cookies
    if (typeof event.request.url === 'string') {
      event.request.url = scrubUrl(event.request.url)
    }
    // `query_string` is set separately by the SDK's request-data integration and
    // is a sibling of the field above — scrubbing one and not the other is the
    // shape this whole fix exists to remove. The founder's ruling is that the
    // query goes, so it goes here too rather than being redacted key by key.
    delete (event.request as Record<string, unknown>).query_string
    // Dropped whole, never key-scrubbed: the Node SDK attaches a request body as
    // a raw string, which a key-name scrub cannot touch. The browser SDK does not
    // set it today; dropping it here keeps the three runtimes' rule identical so
    // no runtime can start leaking a body by an SDK default. PR #427 round 5.
    delete event.request.data
  }
  scrubBreadcrumbs(event.breadcrumbs)
  // Free text that can quote a URL: the event's own message, a log record, and
  // each exception's message and frames. PR #427 round 3.
  if (typeof event.message === 'string') event.message = scrubText(event.message)
  scrubLogentry(event.logentry)
  scrubExceptions(event.exception)
  if (event.user) {
    for (const key of PII_USER_KEYS) {
      delete (event.user as Record<string, any>)[key]
    }
  }
  scrubPiiKeys(event.extra as Record<string, any>)
  if (event.contexts) {
    for (const ctx of Object.values(event.contexts)) {
      scrubPiiKeys(ctx as Record<string, any>)
    }
  }
  // The transaction/span NAME is built from the raw request path -- a
  // navigation to `/reset-password?token=...` names its own transaction from
  // the path regardless of what request.url says.
  if (typeof event.transaction === 'string') {
    event.transaction = scrubUrl(event.transaction)
  }
  scrubSpanData(event.contexts?.trace?.data)
  if (Array.isArray(event.spans)) {
    for (const span of event.spans) {
      scrubSpanData(span.data)
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
      // Keeps the SDK from attaching cookies and client IPs of its own accord;
      // it is not what withholds a request body — scrubSentryEvent drops
      // `request.data` for that. It does NOT cover anything we set ourselves —
      // Sentry's own docs are explicit that `setUser` bypasses it — which is
      // why the SentryUser type above is narrowed as well.
      sendDefaultPii: false,
      integrations: [],
      // Last line of defense: strip PII from every event, whatever set it.
      // `beforeSend` fires for ERROR events only (@sentry/core gates it on
      // `isErrorEvent`). This runtime emits no transactions today —
      // @sentry/browser's defaults exclude browserTracing, so tracesSampleRate
      // is inert here — but the hook is registered anyway so the three runtimes
      // stay symmetric and enabling tracing later cannot silently reopen the
      // gap it opened on the gateway. Found by PR #427's security re-audit.
      beforeSend(event) {
        return scrubSentryEvent(event)
      },
      beforeSendTransaction(event) {
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
