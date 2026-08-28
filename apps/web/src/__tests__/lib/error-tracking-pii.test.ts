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
