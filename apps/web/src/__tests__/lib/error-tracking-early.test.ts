import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The error tracker's SDK loads after the first paint (r19 bundle walk,
 * 2026-11-13) instead of in the entry chunk. What is said before it loads
 * is kept, in order, and replayed into it; an error brings the load forward.
 */

const sdk = vi.hoisted(() => ({
  loads: 0,
  calls: [] as string[],
  init: vi.fn(),
  setUser: vi.fn(),
  setTag: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(() => 'msg-id'),
}))

vi.mock('@sentry/react', () => {
  sdk.loads++
  const log =
    (name: string, fn: (...a: unknown[]) => unknown) =>
    (...a: unknown[]) => {
      sdk.calls.push(name)
      return fn(...a)
    }
  return {
    init: log('init', sdk.init),
    setUser: log('setUser', sdk.setUser),
    setContext: vi.fn(),
    setTag: log('setTag', sdk.setTag),
    addBreadcrumb: log('addBreadcrumb', sdk.addBreadcrumb),
    captureException: log('captureException', sdk.captureException),
    captureMessage: log('captureMessage', sdk.captureMessage),
  }
})

async function fresh() {
  vi.resetModules()
  return (await import('../../lib/error-tracking')).errorTracking
}

const DSN = { dsn: 'https://key@example.test/1', environment: 'test' }

// The page is still loading, so nothing but an explicit trigger loads the SDK.
Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' })

beforeEach(() => {
  sdk.loads = 0
  sdk.calls.length = 0
  vi.clearAllMocks()
})

describe('the SDK loads after the first paint', () => {
  it('loading the module does not load the SDK', async () => {
    await fresh()
    expect(sdk.loads).toBe(0)
  })

  it('with no DSN the SDK never loads', async () => {
    const t = await fresh()
    t.init({ dsn: '', environment: 'test' })
    t.captureException(new Error('x'))
    await t.loadNow()
    expect(sdk.loads).toBe(0)
  })

  it('init alone waits for the page to finish loading, then loads it', async () => {
    const t = await fresh()
    t.init(DSN)
    await new Promise((r) => setTimeout(r, 30))
    expect(sdk.init).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('load'))
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1))
  })
})

describe('what is said before it loads is kept', () => {
  it('replays early calls in order, after init, and sends the exception under the id it returned', async () => {
    const t = await fresh()
    t.init(DSN)
    t.setUser({ id: 'u1', restaurantId: 'h1' })
    t.setTag('route', '/login')
    const id = t.captureException(new Error('early'), { where: 'boot' })
    expect(sdk.calls).toEqual([])
    expect(id).toMatch(/^[0-9a-f]{32}$/)

    await t.loadNow()

    expect(sdk.calls).toEqual(['init', 'setUser', 'setTag', 'captureException'])
    expect(sdk.setUser).toHaveBeenCalledWith({ id: 'u1', restaurantId: 'h1' })
    expect(sdk.captureException).toHaveBeenCalledWith(expect.any(Error), {
      event_id: id,
      captureContext: { extra: { where: 'boot' } },
    })
  })

  it('an exception brings the load forward, without waiting for the page to load', async () => {
    const t = await fresh()
    t.init(DSN)
    t.captureException(new Error('now'))
    await vi.waitFor(() => expect(sdk.captureException).toHaveBeenCalledTimes(1))
  })

  it('keeps at most the last 100 early calls', async () => {
    const t = await fresh()
    t.init(DSN)
    for (let i = 0; i < 150; i++) t.addBreadcrumb({ message: `b${i}` })
    await t.loadNow()
    expect(sdk.addBreadcrumb).toHaveBeenCalledTimes(100)
    expect(sdk.addBreadcrumb.mock.calls[0][0]).toEqual({ message: 'b50' })
    expect(sdk.addBreadcrumb.mock.calls[99][0]).toEqual({ message: 'b149' })
  })

  it('after it loads, calls go straight through', async () => {
    const t = await fresh()
    t.init(DSN)
    await t.loadNow()
    t.setTag('k', 'v')
    expect(sdk.setTag).toHaveBeenCalledWith('k', 'v')
  })
})

describe('if the SDK cannot load', () => {
  it('drops what it kept, stops keeping more, and throws nothing', async () => {
    vi.resetModules()
    vi.doMock('@sentry/react', () => {
      throw new Error('blocked')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { errorTracking: t } = await import('../../lib/error-tracking')
      t.init(DSN)
      t.setTag('a', 'b')
      await t.loadNow()
      expect(warn).toHaveBeenCalled()
      expect(t.captureException(new Error('after'))).toBeNull()
      t.addBreadcrumb({ message: 'after' })
      expect((t as unknown as { early: unknown[] }).early).toHaveLength(0)
    } finally {
      warn.mockRestore()
      vi.doUnmock('@sentry/react')
    }
  })
})
