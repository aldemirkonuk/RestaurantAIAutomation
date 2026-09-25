import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * The error tracker must never learn who a person is.
 *
 * Two independent controls, tested separately because either one alone is a
 * false sense of safety:
 *
 *   1. `setUser` never forwards identity — the leak stops at the source.
 *   2. `scrubSentryEvent` removes identity that arrived some other way — the
 *      last line of defence, for the paths control 1 does not own (a breadcrumb,
 *      an SDK integration, an `extra` bag assembled elsewhere).
 *
 * The reason for testing 1 at all, rather than trusting the scrubber, is that
 * Sentry's `sendDefaultPii: false` explicitly does NOT apply to data set via
 * `setUser()`. The scrubber is ours and can be edited; the type narrowing is
 * what makes a regression fail to compile.
 */

const setUserMock = vi.fn()
const initMock = vi.fn()

vi.mock('@sentry/react', () => ({
  init: (...args: unknown[]) => initMock(...args),
  setUser: (...args: unknown[]) => setUserMock(...args),
  setContext: vi.fn(),
  setTag: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(() => 'event-id'),
  captureMessage: vi.fn(() => 'event-id'),
}))

async function freshModule() {
  vi.resetModules()
  return import('../../lib/error-tracking')
}

describe('error tracking — what reaches Sentry', () => {
  beforeEach(() => {
    setUserMock.mockClear()
    initMock.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('setUser', () => {
    it('forwards only opaque identifiers', async () => {
      const { errorTracking } = await freshModule()
      errorTracking.init({ dsn: 'https://key@example.test/1', environment: 'test' })

      errorTracking.setUser({
        id: '2f1c6a1e-0000-4000-8000-000000000001',
        restaurantId: '9d3b7c22-0000-4000-8000-000000000002',
      })

      expect(setUserMock).toHaveBeenCalledTimes(1)
      const payload = setUserMock.mock.calls[0][0] as Record<string, unknown>
      expect(payload).toEqual({
        id: '2f1c6a1e-0000-4000-8000-000000000001',
        restaurantId: '9d3b7c22-0000-4000-8000-000000000002',
      })
    })

    it('drops identity fields a caller smuggles past the type', async () => {
      const { errorTracking } = await freshModule()
      errorTracking.init({ dsn: 'https://key@example.test/1', environment: 'test' })

      // TypeScript rejects this shape; JavaScript at runtime does not, and a
      // stale build or a JS caller would sail straight through.
      errorTracking.setUser({
        id: 'user-1',
        email: 'chef@restaurant.example',
        username: 'Ada Chef',
      } as never)

      const payload = setUserMock.mock.calls[0][0] as Record<string, unknown>
      expect(payload).not.toHaveProperty('email')
      expect(payload).not.toHaveProperty('username')
      expect(JSON.stringify(payload)).not.toContain('chef@restaurant.example')
      expect(JSON.stringify(payload)).not.toContain('Ada Chef')
    })

    it('does nothing before init, so a pre-init call cannot leak either', async () => {
      const { errorTracking } = await freshModule()
      errorTracking.setUser({ id: 'user-1' })
      expect(setUserMock).not.toHaveBeenCalled()
    })
  })

  describe('init', () => {
    it('states sendDefaultPii: false and installs a beforeSend scrubber', async () => {
      const { errorTracking } = await freshModule()
      errorTracking.init({ dsn: 'https://key@example.test/1', environment: 'test' })

      const options = initMock.mock.calls[0][0] as Record<string, unknown>
      expect(options.sendDefaultPii).toBe(false)
      expect(typeof options.beforeSend).toBe('function')
    })

    it('the installed beforeSend actually scrubs', async () => {
      const { errorTracking } = await freshModule()
      errorTracking.init({ dsn: 'https://key@example.test/1', environment: 'test' })

      const options = initMock.mock.calls[0][0] as {
        beforeSend: (e: Record<string, any>) => Record<string, any>
      }
      const sent = options.beforeSend({
        user: { id: 'user-1', email: 'chef@restaurant.example' },
      })
      expect(sent.user).toEqual({ id: 'user-1' })
    })
  })

  describe('scrubSentryEvent', () => {
    it('strips identity from the user scope but keeps the opaque ids', async () => {
      const { scrubSentryEvent } = await freshModule()

      const event = scrubSentryEvent({
        user: {
          id: 'user-1',
          email: 'chef@restaurant.example',
          username: 'Ada Chef',
          ip_address: '203.0.113.4',
          restaurantId: 'rest-1',
        },
      } as never) as Record<string, any>

      expect(event.user).toEqual({ id: 'user-1', restaurantId: 'rest-1' })
    })

    it('removes every credential header, in any casing, and the cookies', async () => {
      // A browser event carries a `request` too (Sentry fills url/headers), and
      // the three runtimes are meant to scrub the same containers — the
      // asymmetry between them is what scripts/check_sentry_pii_scope.py now
      // fails the build on.
      const { scrubSentryEvent } = await freshModule()

      const event = scrubSentryEvent({
        request: {
          url: '/orders',
          headers: {
            authorization: 'Bearer secret',
            Cookie: 'session=abc',
            'X-API-Key': 'k-1',
            'proxy-authorization': 'Basic secret',
            'user-agent': 'vitest',
          },
          cookies: { session: 'abc' },
        },
      } as never) as Record<string, any>

      expect(event.request.headers).toEqual({ 'user-agent': 'vitest' })
      expect(event.request).not.toHaveProperty('cookies')
      expect(event.request.url).toBe('/orders')
    })

    it('strips identity from free-form extra, request body and contexts', async () => {
      const { scrubSentryEvent } = await freshModule()

      const event = scrubSentryEvent({
        extra: { email: 'chef@restaurant.example', phone: '555-0100', orderId: 'ord-9' },
        request: { data: { name: 'Ada Chef', password: 'hunter2', note: 'keep' } },
        contexts: {
          order: { total: 42 },
          account: { first_name: 'Ada', last_name: 'Chef', plan: 'pro' },
        },
      } as never) as Record<string, any>

      expect(event.extra).toEqual({ orderId: 'ord-9' })
      expect(event.request.data).toEqual({ note: 'keep' })
      expect(event.contexts.order).toEqual({ total: 42 })
      expect(event.contexts.account).toEqual({ plan: 'pro' })
    })

    it('leaves an event with nothing to scrub untouched', async () => {
      const { scrubSentryEvent } = await freshModule()

      const event = scrubSentryEvent({
        message: 'boom',
        extra: { orderId: 'ord-9' },
      } as never) as Record<string, any>

      expect(event).toEqual({ message: 'boom', extra: { orderId: 'ord-9' } })
    })
  })
})

describe('request.url never carries a credential (founder ruling 2026-09-21)', () => {
  const cases: Array<[string, string]> = [
    // query-borne: the two reset/verify routes
    ['https://mudavym.com/reset-password?token=abc123', 'https://mudavym.com/reset-password'],
    ['https://mudavym.com/verify-email?token=abc123', 'https://mudavym.com/verify-email'],
    // a second parameter must not survive either — the whole query goes
    ['https://mudavym.com/x?a=1&token=abc&b=2', 'https://mudavym.com/x'],
    // fragments too: a token in the hash is still a token
    ['https://mudavym.com/reset-password#token=abc', 'https://mudavym.com/reset-password'],
    // path-borne: stripping the query does NOT reach these
    ['https://mudavym.com/invite/SECRETCODE', 'https://mudavym.com/invite/<redacted>'],
    ['https://mudavym.com/studio/invite/SECRET', 'https://mudavym.com/studio/invite/<redacted>'],
    // the @Public() iCal feed — a tenant-wide, never-expiring bearer. PR #427's
    // security audit BLOCKED the first version of this fix for missing it.
    ['https://gw/api/v1/calendar/feed/9f3c1a.ics', 'https://gw/api/v1/calendar/feed/<redacted>'],
    // the @Public() one-click unsubscribe token
    ['https://gw/api/v1/recommendations/digest/unsubscribe/TOK', 'https://gw/api/v1/recommendations/digest/unsubscribe/<redacted>'],
    // only the ONE segment after the prefix goes, so the route stays legible
    ['https://gw/api/v1/auth/invite/CODE/accept', 'https://gw/api/v1/auth/invite/<redacted>/accept'],
    // the invite-REVOKE route: /invites/ is NOT /invite/, and it carries the SAME
    // organization_invites.code. PR #427's correctness audit found it leaking
    // exactly when the revoke FAILED — while the invite is still live.
    ['/api/v1/restaurants/1111/invites/XK7Q2M', '/api/v1/restaurants/1111/invites/<redacted>'],
    ['/api/v1/mobile/devices/ExponentPushToken', '/api/v1/mobile/devices/<redacted>'],
    // two credentials in one path: the FIRST is redacted, which pins indexOf
    // against lastIndexOf (that mutation survived every suite).
    ['/invite/AAA/invite/BBB', '/invite/<redacted>/invite/BBB'],
    // relative URLs must work — this runs before the SDK normalises anything
    ['/invite/SECRETCODE?x=1', '/invite/<redacted>'],
    // ordinary pages are left alone
    ['https://mudavym.com/orders', 'https://mudavym.com/orders'],
    ['/', '/'],
    ['', ''],
  ]
  it.each(cases)('%s -> %s', async (raw, want) => {
    const { scrubUrl } = await freshModule()
    expect(scrubUrl(raw)).toBe(want)
  })

  it('scrubSentryEvent applies it to a real event', async () => {
    const { scrubSentryEvent } = await freshModule()
    const event: any = { request: { url: 'https://mudavym.com/reset-password?token=SECRET' } }
    scrubSentryEvent(event)
    expect(event.request.url).toBe('https://mudavym.com/reset-password')
    expect(JSON.stringify(event)).not.toContain('SECRET')
  })


  it('drops request.query_string, the sibling field the SDK sets separately', async () => {
    const { scrubSentryEvent } = await freshModule()
    const event: any = { request: { url: 'https://mudavym.com/x', query_string: 'token=SECRET' } }
    scrubSentryEvent(event)
    expect(event.request.query_string).toBeUndefined()
    expect(JSON.stringify(event)).not.toContain('SECRET')
  })

  it('scrubs breadcrumb URLs — they are merged onto the event BEFORE beforeSend', async () => {
    const { scrubSentryEvent } = await freshModule()
    const event: any = {
      breadcrumbs: [
        { category: 'navigation', data: { from: '/reset-password?token=SECRET', to: '/login' } },
        { category: 'fetch', data: { url: '/invite/SECRETCODE' } },
        // `to` is the direction a person navigates TOWARD an invite link, and
        // dropping it from the key list survived every suite before this case.
        { category: 'navigation', data: { from: '/login', to: '/invite/SECRETCODE' } },
        { category: 'ui.click' },
      ],
    }
    scrubSentryEvent(event)
    expect(event.breadcrumbs[0].data.from).toBe('/reset-password')
    expect(event.breadcrumbs[1].data.url).toBe('/invite/<redacted>')
    expect(event.breadcrumbs[2].data.to).toBe('/invite/<redacted>')
    expect(JSON.stringify(event)).not.toContain('SECRET')
  })

  it('does not throw on a malformed URL, because it runs on an error path', async () => {
    const { scrubUrl } = await freshModule()
    expect(() => scrubUrl('http://[::1')).not.toThrow()
    expect(() => scrubUrl('%%%')).not.toThrow()
  })

  it('leaves a non-string url untouched rather than coercing it', async () => {
    const { scrubSentryEvent } = await freshModule()
    const event: any = { request: { url: 42 } }
    scrubSentryEvent(event)
    expect(event.request.url).toBe(42)
  })
})

// PR #427's round-2 audit found request.url/query_string being clean was not
// enough: OpenTelemetry keeps its OWN copy of the URL in `contexts.trace.data`
// and each `event.spans[].data`, and the transaction NAME is the raw path too
// -- none of it reached by scrubPiiKeys's key-name pass over `contexts`. Shapes
// mirror @sentry/core's own type declarations (types-hoist/{event,context,span}.d.ts),
// not a hand-picked literal.
describe("OpenTelemetry's own copy of the URL (PR #427 round 2)", () => {
  it('scrubs contexts.trace.data — the calendar feed token survives request.url being clean', async () => {
    const { scrubSentryEvent } = await freshModule()
    const event: any = {
      request: { url: '/api/v1/calendar/feed/<redacted>' }, // already fixed
      transaction: 'GET /api/v1/calendar/feed/SECRETTOKEN.ics',
      contexts: {
        trace: {
          span_id: 'abc123',
          trace_id: 'def456',
          data: {
            url: 'http://mudavym.com/api/v1/calendar/feed/SECRETTOKEN.ics',
            'http.url': 'http://mudavym.com/api/v1/calendar/feed/SECRETTOKEN.ics',
            'http.target': '/api/v1/calendar/feed/SECRETTOKEN.ics',
          },
        },
      },
    }
    scrubSentryEvent(event)
    expect(event.transaction).toBe('GET /api/v1/calendar/feed/<redacted>')
    expect(event.contexts.trace.data.url).toBe(
      'http://mudavym.com/api/v1/calendar/feed/<redacted>',
    )
    expect(event.contexts.trace.data['http.target']).toBe('/api/v1/calendar/feed/<redacted>')
    expect(JSON.stringify(event)).not.toContain('SECRETTOKEN')
  })

  it("deletes contexts.trace.data['http.query'] — INBOUND_WEBHOOK_SECRET arrives as a query param", async () => {
    const { scrubSentryEvent } = await freshModule()
    const event: any = {
      contexts: {
        trace: {
          span_id: 'abc123',
          trace_id: 'def456',
          data: {
            'http.url': 'http://mudavym.com/api/v1/inbound-email?secret=SECRET',
            'http.query': 'secret=SECRET',
          },
        },
      },
    }
    scrubSentryEvent(event)
    expect(event.contexts.trace.data['http.query']).toBeUndefined()
    expect(event.contexts.trace.data['http.url']).toBe('http://mudavym.com/api/v1/inbound-email')
    expect(JSON.stringify(event)).not.toContain('SECRET')
  })

  it('scrubs every span\'s own data, not just contexts.trace', async () => {
    const { scrubSentryEvent } = await freshModule()
    const event: any = {
      spans: [
        {
          span_id: 's1',
          trace_id: 't1',
          start_timestamp: 0,
          data: { 'http.url': 'https://mudavym.com/invite/SECRETCODE' },
        },
      ],
    }
    scrubSentryEvent(event)
    expect(event.spans[0].data['http.url']).toBe('https://mudavym.com/invite/<redacted>')
    expect(JSON.stringify(event)).not.toContain('SECRETCODE')
  })
})

/**
 * PR #427 round 3 (2026-09-25): every token-bearing route, in every container
 * an event can carry a URL in — not one hand-picked field per test.
 *
 * The token values are shaped like the real ones (a 64-hex feed bearer, an
 * Expo push token, a JWT-shaped verify token, a Google OAuth code), and the
 * assertion is on the WHOLE serialized event: a container this file forgot to
 * name still fails the test if it carries the token.
 */
const REAL_TOKENS = {
  reset: 'pkce_e1f3a5c7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7',
  verify: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2ZXJpZnkifQ.Zk3pQ7rT9vX1bD5fH8jL2nP4sU6wY0aC',
  invite: 'k7Qm2VxP9rTzL4nW',
  studio: '3f9c2a7e-5b1d-4e8f-a6c0-9d2b7e4f1a3c',
  feed: '9f2c4e6a8b0d1f3e5a7c9b1d3f5e7a9c0b2d4f6e8a0c2e4f6a8b0d2f4e6a8c0b',
  unsubscribe: 'u5b1e0c8f2a4d6b9e3c7f1a5d8b2e6c0f',
  device: 'ExponentPushToken[xk8S2LmQ0pZr7Tn4Yv1WcA]',
  oauth: '4/0AanRRrs8Hq2ZtX9pL4mKw7',
  inbound: 'whsec_3JfK8mQ2pL9vX5tR',
}

const TOKEN_ROUTES: Array<[string, string, string]> = [
  ['reset-password (query)', `https://mudavym.com/reset-password?token=${REAL_TOKENS.reset}&type=recovery`, REAL_TOKENS.reset],
  ['verify-email (query)', `https://mudavym.com/verify-email?token=${REAL_TOKENS.verify}`, REAL_TOKENS.verify],
  ['web invite (path)', `https://mudavym.com/invite/${REAL_TOKENS.invite}`, REAL_TOKENS.invite],
  ['studio invite (path)', `https://mudavym.com/studio/invite/${REAL_TOKENS.studio}`, REAL_TOKENS.studio],
  ['gateway invite accept', `https://api.mudavym.com/api/v1/auth/invite/${REAL_TOKENS.invite}/accept`, REAL_TOKENS.invite],
  ['invite revoke', `https://api.mudavym.com/api/v1/restaurants/r1/invites/${REAL_TOKENS.invite}`, REAL_TOKENS.invite],
  ['iCal feed bearer', `https://api.mudavym.com/api/v1/calendar/feed/${REAL_TOKENS.feed}.ics`, REAL_TOKENS.feed],
  ['digest unsubscribe', `https://api.mudavym.com/api/v1/analytics/digest/unsubscribe/${REAL_TOKENS.unsubscribe}`, REAL_TOKENS.unsubscribe],
  ['push device', `https://api.mudavym.com/api/v1/mobile/devices/${REAL_TOKENS.device}`, REAL_TOKENS.device],
  ['OAuth callback code', `https://api.mudavym.com/api/v1/integrations/oauth/google/callback?code=${REAL_TOKENS.oauth}&state=s1`, REAL_TOKENS.oauth],
  ['inbound webhook secret', `https://api.mudavym.com/api/v1/inbound-email?secret=${REAL_TOKENS.inbound}`, REAL_TOKENS.inbound],
]

/** One event carrying `url` in every place the SDKs (or our code) can put one. */
function eventCarrying(url: string, token: string): any {
  const path = url.replace(/^https?:\/\/[^/]+/, '')
  const [bare, query = ''] = url.split('?')
  return {
    message: `failed at ${url}`,
    transaction: `GET ${path}`,
    request: { url, query_string: query, headers: { Referer: url, 'User-Agent': 'ua' } },
    breadcrumbs: [
      { category: 'navigation', data: { from: path, to: '/dashboard' } },
      { category: 'fetch', type: 'http', data: { method: 'GET', url, status_code: 500 } },
      {
        category: 'http',
        type: 'http',
        data: { url: bare, 'http.method': 'GET', 'http.query': `?${query}`, 'http.fragment': `#access_token=${token}` },
      },
      {
        category: 'console',
        level: 'error',
        message: `request to ${url} failed`,
        data: { arguments: [`request to ${url} failed`, 42], logger: 'console' },
      },
    ],
    logentry: { message: 'lookup failed for %s', params: [url], formatted: `lookup failed for ${url}` },
    exception: {
      values: [
        {
          type: 'Error',
          value: `Request failed for url '${url}'`,
          stacktrace: { frames: [{ filename: url, abs_path: url, function: 'inline', lineno: 31 }] },
        },
      ],
    },
    contexts: { trace: { data: { url, 'http.url': url, 'http.target': path } } },
    spans: [{ span_id: 's', trace_id: 't', start_timestamp: 0, data: { 'url.full': url } }],
  }
}

describe('PR #427 round 3 — every token route, every container', () => {
  it.each(TOKEN_ROUTES)('%s: the token reaches no container', async (_label, url, token) => {
    const { scrubSentryEvent } = await freshModule()
    const scrubbed = scrubSentryEvent(eventCarrying(url, token))
    expect(JSON.stringify(scrubbed)).not.toContain(token)
  })

  it('keeps what triage needs: origin, path, route shape, Referer, and ordinary text', async () => {
    const { scrubSentryEvent } = await freshModule()
    const url = `https://mudavym.com/invite/${REAL_TOKENS.invite}`
    const event = scrubSentryEvent(eventCarrying(url, REAL_TOKENS.invite))
    expect(event.request.headers.Referer).toBe('https://mudavym.com/invite/<redacted>')
    expect(event.request.headers['User-Agent']).toBe('ua')
    expect(event.breadcrumbs[0].data.from).toBe('/invite/<redacted>')
    expect(event.breadcrumbs[3].message).toBe('request to https://mudavym.com/invite/<redacted> failed')
    expect(event.breadcrumbs[3].data.arguments[1]).toBe(42)
    expect(event.exception.values[0].value).toBe("Request failed for url 'https://mudavym.com/invite/<redacted>'")
    expect(event.logentry.params).toEqual(['https://mudavym.com/invite/<redacted>'])
  })

  it('scrubText leaves a sentence with no query and no token route untouched', async () => {
    const { scrubText } = await freshModule()
    const plain = "Cannot read properties of undefined (reading 'id') — why? #3 in /orders/42"
    expect(scrubText(plain)).toBe(plain)
  })

  it('leaves a bundle or filesystem frame path alone, so source maps and grouping survive', async () => {
    const { scrubSentryEvent } = await freshModule()
    const event: any = {
      exception: {
        values: [
          {
            value: 'x',
            stacktrace: {
              frames: [
                { filename: 'https://mudavym.com/assets/index-abc123.js', lineno: 1 },
                { filename: '/app/src/mobile/devices/registry.ts', lineno: 2 },
              ],
            },
          },
        ],
      },
    }
    scrubSentryEvent(event)
    expect(event.exception.values[0].stacktrace.frames[0].filename).toBe('https://mudavym.com/assets/index-abc123.js')
    expect(event.exception.values[0].stacktrace.frames[1].filename).toBe('/app/src/mobile/devices/registry.ts')
  })
})
