import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The read cache's lifetime (the founder's storage ruling, 2026-09-29).
 *
 * Before: an expired `entity_cache` row was deleted only when that same key
 * was read again, and nothing emptied the cache at sign-out, so the previous
 * person's cached notifications stayed on a shared device. Now:
 * `pruneExpiredCache` sweeps expired rows at boot and `clearEntityCache` empties
 * the cache at sign-out — both in IndexedDB AND in the localStorage fallback
 * copies, and neither ever touches the pending-mutation queue (unsent work,
 * ADR 0241).
 *
 * jsdom has no IndexedDB. The first block installs a small in-memory one so the
 * IndexedDB path is exercised; the second leaves it absent, which is the
 * localStorage fallback the module takes on a device without IndexedDB.
 */

type Row = Record<string, unknown>

/** A minimal IndexedDB: open / objectStore get, getAll, put, delete. */
function installFakeIndexedDB() {
  const stores = new Map<string, { keyPath: string; rows: Map<string, Row> }>()
  const req = <T>(fn: () => T) => {
    const r: { result?: T; error?: unknown; onsuccess?: () => void; onerror?: () => void } = {}
    queueMicrotask(() => {
      r.result = fn()
      r.onsuccess?.()
    })
    return r
  }
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
  const db = {
    objectStoreNames: { contains: (n: string) => stores.has(n) },
    createObjectStore: (name: string, o: { keyPath: string }) => {
      stores.set(name, { keyPath: o.keyPath, rows: new Map() })
      return { createIndex: () => undefined }
    },
    transaction: (name: string) => ({
      objectStore: () => {
        const s = stores.get(name)!
        return {
          get: (k: string) => req(() => (s.rows.has(k) ? clone(s.rows.get(k)) : undefined)),
          getAll: () => req(() => [...s.rows.values()].map(clone)),
          put: (v: Row) => req(() => void s.rows.set(String(v[s.keyPath]), clone(v))),
          delete: (k: string) => req(() => void s.rows.delete(k)),
        }
      },
    }),
  }
  const fake = {
    open: () => {
      const r: {
        result?: unknown
        error?: unknown
        onsuccess?: () => void
        onerror?: () => void
        onupgradeneeded?: (e: { target: unknown }) => void
      } = {}
      queueMicrotask(() => {
        r.result = db
        if (stores.size === 0) r.onupgradeneeded?.({ target: r })
        r.onsuccess?.()
      })
      return r
    },
  }
  vi.stubGlobal('indexedDB', fake)
  return stores
}

const past = () => new Date(Date.now() - 60_000)
const future = () => new Date(Date.now() + 60_000)

async function freshModule() {
  vi.resetModules()
  return (await import('./offline-storage')).offlineStorage
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('pruneExpiredCache: IndexedDB rows and their localStorage copies, cache only', () => {
  it('removes only expired cache rows from IndexedDB, never pending mutations', async () => {
    const stores = installFakeIndexedDB()
    const storage = await freshModule()
    await storage.cacheEntity('notifications:old', { n: 1 }, 1)
    await storage.cacheEntity('notifications:fresh', { n: 2 }, 60_000)
    await storage.cacheEntity('forever', { n: 3 })
    const id = await storage.addPendingMutation({
      type: 'receiving.door',
      data: { orderId: 'o-1' },
      timestamp: new Date(Date.now() - 10 * 24 * 3600_000),
    })

    const removed = await storage.pruneExpiredCache(new Date(Date.now() + 1000))

    expect(removed).toBe(1)
    const cacheKeys = [...stores.get('entity_cache')!.rows.keys()].sort()
    expect(cacheKeys).toEqual(['forever', 'notifications:fresh'])
    // The ten-day-old unsent change is still there: age is never a reason.
    expect([...stores.get('pending_mutations')!.rows.keys()]).toEqual([id])
  })

  it('also removes an expired localStorage fallback copy left beside IndexedDB', async () => {
    installFakeIndexedDB()
    const storage = await freshModule()
    const stale = { key: 'calendar:x', data: 1, timestamp: past(), expiresAt: past() }
    const live = { key: 'calendar:y', data: 2, timestamp: past(), expiresAt: future() }
    const queued = { id: 'mutation_1', type: 't', data: {}, timestamp: past(), retryCount: 0 }
    localStorage.setItem('entity_cache_calendar:x', JSON.stringify(stale))
    localStorage.setItem('entity_cache_calendar:y', JSON.stringify(live))
    localStorage.setItem('entity_cache_all', JSON.stringify([stale, live]))
    localStorage.setItem('pending_mutations_mutation_1', JSON.stringify(queued))
    localStorage.setItem('pending_mutations_all', JSON.stringify([queued]))

    await storage.pruneExpiredCache()

    expect(localStorage.getItem('entity_cache_calendar:x')).toBeNull()
    expect(localStorage.getItem('entity_cache_calendar:y')).not.toBeNull()
    expect(JSON.parse(localStorage.getItem('entity_cache_all')!)).toHaveLength(1)
    expect(localStorage.getItem('pending_mutations_mutation_1')).not.toBeNull()
    expect(JSON.parse(localStorage.getItem('pending_mutations_all')!)).toHaveLength(1)
  })

  it('finds a stray expired copy the collection lost, by scanning the keys', async () => {
    // A browser-shaped Storage (key/length), which the suite's shared mock lacks.
    const map = new Map<string, string>()
    const real = window.localStorage
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, String(v)),
        removeItem: (k: string) => void map.delete(k),
        clear: () => map.clear(),
        key: (i: number) => [...map.keys()][i] ?? null,
        get length() {
          return map.size
        },
      },
    })
    try {
      installFakeIndexedDB()
      const storage = await freshModule()
      const stale = { key: 'orphan', data: 1, timestamp: past(), expiresAt: past() }
      map.set('entity_cache_orphan', JSON.stringify(stale))
      map.set('pending_mutations_m', JSON.stringify({ id: 'm', expiresAt: past() }))

      expect(await storage.pruneExpiredCache()).toBe(1)
      expect(map.has('entity_cache_orphan')).toBe(false)
      expect(map.has('pending_mutations_m')).toBe(true)
    } finally {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: real })
    }
  })

  it('on a device without IndexedDB (fallback only): expired rows go, the queue stays', async () => {
    const storage = await freshModule()
    await storage.cacheEntity('providers:list', [1], 1)
    await storage.cacheEntity('providers:one', [2], 60_000)
    await storage.addPendingMutation({ type: 't', data: {}, timestamp: past() })

    await storage.pruneExpiredCache(new Date(Date.now() + 1000))

    expect(localStorage.getItem('entity_cache_providers:list')).toBeNull()
    expect(localStorage.getItem('entity_cache_providers:one')).not.toBeNull()
    const all = JSON.parse(localStorage.getItem('entity_cache_all')!) as { key: string }[]
    expect(all.map((r) => r.key)).toEqual(['providers:one'])
    expect(await storage.getAllPendingMutationsOnDevice()).toHaveLength(1)
  })
})

describe('clearEntityCache: sign-out empties the read cache and nothing else', () => {
  it('empties the IndexedDB cache store and keeps every pending mutation', async () => {
    const stores = installFakeIndexedDB()
    const storage = await freshModule()
    await storage.cacheEntity('notifications:list', [{ title: 'for the last person' }], 60_000)
    await storage.cacheEntity('forever', 1)
    await storage.addPendingMutation({ type: 't', data: {}, timestamp: past() })

    await storage.clearEntityCache()

    expect(stores.get('entity_cache')!.rows.size).toBe(0)
    expect(stores.get('pending_mutations')!.rows.size).toBe(1)
    expect(await storage.getCachedEntity('notifications:list')).toBeNull()
  })

  it('with IndexedDB working, also removes a fallback copy left in localStorage', async () => {
    installFakeIndexedDB()
    const storage = await freshModule()
    const row = { key: 'notifications:list', data: [1], timestamp: past(), expiresAt: future() }
    localStorage.setItem('entity_cache_notifications:list', JSON.stringify(row))
    localStorage.setItem('entity_cache_all', JSON.stringify([row]))
    const queued = { id: 'mutation_1', type: 't', data: {}, timestamp: past(), retryCount: 0 }
    localStorage.setItem('pending_mutations_all', JSON.stringify([queued]))

    await storage.clearEntityCache()

    expect(localStorage.getItem('entity_cache_notifications:list')).toBeNull()
    expect(JSON.parse(localStorage.getItem('entity_cache_all') ?? '[]')).toEqual([])
    expect(JSON.parse(localStorage.getItem('pending_mutations_all')!)).toHaveLength(1)
  })

  it('removes the localStorage fallback copies too, and leaves the queue copies', async () => {
    const storage = await freshModule()
    await storage.cacheEntity('notifications:list', [1], 60_000)
    await storage.addPendingMutation({ type: 't', data: {}, timestamp: past() })

    await storage.clearEntityCache()

    expect(localStorage.getItem('entity_cache_notifications:list')).toBeNull()
    expect(JSON.parse(localStorage.getItem('entity_cache_all') ?? '[]')).toEqual([])
    expect(JSON.parse(localStorage.getItem('pending_mutations_all')!)).toHaveLength(1)
    expect(await storage.getAllPendingMutationsOnDevice()).toHaveLength(1)
  })
})
