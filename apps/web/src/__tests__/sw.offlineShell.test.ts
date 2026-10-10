/**
 * `apps/web/public/sw.js`'s navigation fallback, run for real in a `vm`
 * sandbox (same approach as `sw.notificationclick.test.ts`).
 *
 * F-1081: `networkFirst` fell back to `caches.match("/")` offline, but no
 * code path ever put a document in the cache, so an offline reload (the one
 * a missing route chunk triggers at the door) landed on the browser's "No
 * internet" page. The last good shell is now kept under "/".
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

const SW_SOURCE = readFileSync(join(__dirname, '../../public/sw.js'), 'utf8')
const ORIGIN = 'https://mudavym.com'

interface FakeResponse {
  ok: boolean
  type: string
  redirected: boolean
  headers: { get: (name: string) => string | null }
  body: string
  clone: () => FakeResponse
}

function response(body: string, init: Partial<Pick<FakeResponse, 'ok' | 'type' | 'redirected'>> & { contentType?: string } = {}): FakeResponse {
  const r: FakeResponse = {
    ok: init.ok ?? true,
    type: init.type ?? 'basic',
    redirected: init.redirected ?? false,
    headers: { get: (n) => (n.toLowerCase() === 'content-type' ? init.contentType ?? 'text/html; charset=utf-8' : null) },
    body,
    clone: () => r,
  }
  return r
}

function navigation(path: string) {
  return {
    method: 'GET',
    mode: 'navigate',
    url: `${ORIGIN}${path}`,
    headers: { get: (n: string) => (n.toLowerCase() === 'accept' ? 'text/html' : null) },
  }
}

/** Loads sw.js with an in-memory cache and a switchable network. */
function loadWorker() {
  const store = new Map<string, FakeResponse>()
  const keyOf = (req: unknown) => (typeof req === 'string' ? req : new URL((req as { url: string }).url).pathname)
  const net: { online: boolean; next: FakeResponse } = { online: true, next: response('<html>shell</html>') }
  const listeners: Record<string, (event: unknown) => void> = {}
  const cache = {
    addAll: async () => undefined,
    put: async (req: unknown, res: FakeResponse) => {
      store.set(keyOf(req), res)
    },
  }
  const sandbox: Record<string, unknown> = {
    console: { log: () => undefined, error: () => undefined },
    caches: {
      open: async () => cache,
      keys: async () => [],
      match: async (req: unknown) => store.get(keyOf(req)),
      delete: async () => true,
    },
    fetch: async () => {
      if (!net.online) throw new TypeError('Failed to fetch')
      return net.next
    },
    URL,
  }
  sandbox.self = sandbox
  Object.assign(sandbox, {
    addEventListener: (type: string, cb: (event: unknown) => void) => {
      listeners[type] = cb
    },
    skipWaiting: () => undefined,
    clients: { claim: () => undefined },
    location: { origin: ORIGIN },
  })
  vm.createContext(sandbox)
  vm.runInContext(SW_SOURCE, sandbox, { filename: 'sw.js' })

  async function navigate(path: string): Promise<FakeResponse> {
    let answer: Promise<FakeResponse> | undefined
    listeners.fetch({
      request: navigation(path),
      respondWith: (p: Promise<FakeResponse>) => {
        answer = p
      },
    })
    if (!answer) throw new Error('sw.js did not answer the navigation')
    return answer
  }
  return { navigate, net, store }
}

describe('sw.js offline app shell (F-1081)', () => {
  it('an offline reload of a route the device never opened still gets the app shell', async () => {
    const sw = loadWorker()
    const online = await sw.navigate('/receiving')
    expect(online.body).toBe('<html>shell</html>')

    sw.net.online = false
    const offline = await sw.navigate('/receiving/del-1/door')
    expect(offline.body).toBe('<html>shell</html>')
  })

  it('with signal, the network answer is served, not the kept shell', async () => {
    const sw = loadWorker()
    await sw.navigate('/receiving')
    sw.net.next = response('<html>new deploy</html>')
    expect((await sw.navigate('/receiving')).body).toBe('<html>new deploy</html>')
    expect(sw.store.get('/')?.body).toBe('<html>new deploy</html>')
  })

  it('an error page, a redirect or a non-HTML answer is never kept as the shell', async () => {
    const sw = loadWorker()
    sw.net.next = response('oops', { ok: false })
    await sw.navigate('/receiving')
    sw.net.next = response('<html>login</html>', { redirected: true })
    await sw.navigate('/receiving')
    sw.net.next = response('{}', { contentType: 'application/json' })
    await sw.navigate('/receiving')
    expect(sw.store.has('/')).toBe(false)

    sw.net.online = false
    await expect(sw.navigate('/receiving')).rejects.toThrow('Failed to fetch')
  })
})
