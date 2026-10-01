import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The founder's storage ruling, 2026-09-29: keep unsent work, ask the browser
 * to keep the device's storage where asking is silent, and say when work has
 * waited too long. jsdom has no `navigator.storage`, so each case installs the
 * one it needs; the queue is the real module on its localStorage fallback.
 */

import {
  UNSENT_NUDGE_AFTER_MS,
  ensurePersisted,
  readStorageHealth,
  requestPersistence,
  resetPersistRequestForTests,
  unsentWaitedTooLong,
} from './deviceStorage'
import { offlineStorage } from './offline-storage'

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
const FIREFOX_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'
const FXIOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/130.0 Mobile/15E148 Safari/605.1.15'

function installStorage(opts: {
  persisted?: boolean
  estimate?: { usage?: number; quota?: number } | 'throws'
}) {
  const persist = vi.fn(async () => true)
  const persisted = vi.fn(async () => opts.persisted ?? false)
  const estimate = vi.fn(async () => {
    if (opts.estimate === 'throws') throw new Error('nope')
    return opts.estimate ?? {}
  })
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { persist, persisted, estimate },
  })
  return { persist, persisted, estimate }
}

function setUA(ua: string) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
}

beforeEach(() => {
  resetPersistRequestForTests()
  window.localStorage.clear()
  setUA(CHROME_UA)
})
afterEach(() => {
  vi.restoreAllMocks()
  // Back to jsdom's own shape: no storage manager at all.
  delete (navigator as unknown as { storage?: unknown }).storage
  window.localStorage.clear()
})

describe('ensurePersisted: asks once, only where asking is silent', () => {
  it('does not call persist() when storage is already persistent', async () => {
    const s = installStorage({ persisted: true })
    expect(await ensurePersisted()).toBe('already')
    expect(s.persist).not.toHaveBeenCalled()
  })

  it('calls persist() once per page load, however often sign-in runs', async () => {
    const s = installStorage({ persisted: false })
    expect(await ensurePersisted()).toBe('asked')
    expect(await ensurePersisted()).toBe('asked-before')
    await ensurePersisted()
    expect(s.persist).toHaveBeenCalledTimes(1)
  })

  it('never calls persist() on its own in Firefox, where it shows a prompt', async () => {
    setUA(FIREFOX_UA)
    const s = installStorage({ persisted: false })
    expect(await ensurePersisted()).toBe('needs-a-tap')
    expect(s.persist).not.toHaveBeenCalled()
    // The explicit button is the only way in.
    expect(await requestPersistence()).toBe(true)
    expect(s.persist).toHaveBeenCalledTimes(1)
  })

  it('Firefox for iOS runs WebKit (silent): it is asked like Safari', async () => {
    setUA(FXIOS_UA)
    const s = installStorage({ persisted: false })
    expect(await ensurePersisted()).toBe('asked')
    expect(s.persist).toHaveBeenCalledTimes(1)
  })

  it('a browser with no storage manager is "unsupported", not an error', async () => {
    expect(await ensurePersisted()).toBe('unsupported')
    expect(await requestPersistence()).toBeNull()
  })
})

describe('readStorageHealth: unknown is null, never 0 or fine', () => {
  it('returns null for every browser API this browser does not have', async () => {
    const h = await readStorageHealth()
    expect(h.persisted).toBeNull()
    expect(h.usage).toBeNull()
    expect(h.quota).toBeNull()
  })

  it('an estimate() that throws reads as unknown, not as 0 bytes', async () => {
    installStorage({ persisted: false, estimate: 'throws' })
    const h = await readStorageHealth()
    expect(h.persisted).toBe(false)
    expect(h.usage).toBeNull()
    expect(h.quota).toBeNull()
  })

  it('reports usage and quota when the browser gives them', async () => {
    installStorage({ persisted: true, estimate: { usage: 1024, quota: 10_000 } })
    const h = await readStorageHealth()
    expect(h).toMatchObject({ persisted: true, usage: 1024, quota: 10_000 })
  })

  it('a queue that cannot be read is unknown (null), not an empty queue', async () => {
    vi.spyOn(offlineStorage, 'getPendingMutations').mockRejectedValue(new Error('io'))
    const h = await readStorageHealth()
    expect(h.pending).toBeNull()
    expect(h.parked).toBeNull()
    expect(h.oldestUnsentAt).toBeNull()
  })

  it('oldest-unsent is the oldest waiting OR parked change, and counts split', async () => {
    const old = new Date(Date.now() - 2 * UNSENT_NUDGE_AFTER_MS)
    const recent = new Date(Date.now() - 1000)
    vi.spyOn(offlineStorage, 'getPendingMutations').mockResolvedValue([
      { id: 'a', type: 't', data: {}, timestamp: recent, retryCount: 0 },
      {
        id: 'b',
        type: 't',
        data: {},
        timestamp: old,
        retryCount: 3,
        parked: { reason: 'refused', status: 422, at: recent.toISOString() },
      },
    ])
    const h = await readStorageHealth()
    expect(h.pending).toBe(1)
    expect(h.parked).toBe(1)
    expect(h.oldestUnsentAt?.getTime()).toBe(old.getTime())
    expect(unsentWaitedTooLong(h)).toBe(true)
  })

  it('an empty queue has no oldest change and nothing waited too long', async () => {
    const h = await readStorageHealth()
    expect(h.pending).toBe(0)
    expect(h.parked).toBe(0)
    expect(h.oldestUnsentAt).toBeNull()
    expect(unsentWaitedTooLong(h)).toBe(false)
  })

  it('the nudge threshold is 24 hours (after Square offline mode; confirmed by the founder 2026-09-29)', () => {
    expect(UNSENT_NUDGE_AFTER_MS).toBe(24 * 60 * 60 * 1000)
  })
})
