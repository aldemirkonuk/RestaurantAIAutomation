/**
 * `apps/web/public/sw.js`'s `notificationclick` routing table, exercised
 * for real (the shipped file's actual source, run in a `vm` sandbox — not a
 * reimplementation that could drift from it).
 *
 * This file had "no test of any kind" before this pass, which is why three
 * defects (L1, L2, L3) below were invisible to every green check in the
 * repo:
 *
 * - L1: `push_notification_service.py` sends snake_case data keys
 *   (`order_id`, `wine_name`); the gateway's `sendWebPush`
 *   (`notifications.service.ts`) sends camelCase (`orderId`, `wineName`)
 *   and never adds `type` at all. Before this fix, `sw.js` read only the
 *   Python spelling, so every gateway-originated push button opened `/`.
 * - L2: the fix pass collapsed `send_approval_notification`'s three push
 *   buttons to one with action id `"open"`, but `sw.js` had no `open`
 *   branch, so the one remaining button also opened `/`.
 * - L3: `send_negotiation_complete_notification` still sent three buttons
 *   ("Approve"/"Reject"/"View Details") that, under `sw.js`'s
 *   id-based routing, all resolved to the identical `/orders/<id>` — fixed
 *   separately in `notification_agent.py` (see
 *   `test_notification_agent_links.py::TestNegotiationCompleteLinks`).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

const SW_PATH = join(__dirname, '../../public/sw.js')
const SW_SOURCE = readFileSync(SW_PATH, 'utf8')

/**
 * Runs the actual `sw.js` source in an isolated sandbox that stubs just
 * enough of the ServiceWorkerGlobalScope for module-level registration to
 * succeed (nothing is invoked at load time except `addEventListener`
 * calls), then fires a `notificationclick` event and reports the URL the
 * handler asked `clients.openWindow` (or an already-open `client.focus`) to
 * navigate to.
 */
async function resolveClickedUrl(
  action: string,
  data: Record<string, unknown> | undefined,
): Promise<string> {
  return (await click(action, data)).opened ?? ''
}

interface FakeTab {
  url: string
  focused?: boolean
  navigatedTo?: string
}

/** The click itself, with `tabs` standing for the windows already open. */
async function click(
  action: string,
  data: Record<string, unknown> | undefined,
  tabs: FakeTab[] = [],
): Promise<{ opened?: string }> {
  const listeners: Record<string, (event: unknown) => void> = {}
  let openedUrl: string | undefined
  const windowClients = tabs.map((tab) => ({
    get url() {
      return tab.url
    },
    focus: async function (this: unknown) {
      tab.focused = true
      return this
    },
    navigate: async function (this: unknown, to: string) {
      tab.navigatedTo = to
      tab.url = to
      return this
    },
  }))

  const sandbox: Record<string, unknown> = {
    console,
    caches: {
      open: async () => ({ addAll: async () => undefined }),
      keys: async () => [],
      match: async () => undefined,
      delete: async () => true,
    },
    clients: {
      matchAll: async () => windowClients,
      openWindow: async (url: string) => {
        openedUrl = url
        return null
      },
    },
    fetch: async () => ({ ok: true }),
    URL,
  }
  sandbox.self = sandbox
  ;(sandbox.self as Record<string, unknown>).addEventListener = (
    type: string,
    cb: (event: unknown) => void,
  ) => {
    listeners[type] = cb
  }
  ;(sandbox.self as Record<string, unknown>).skipWaiting = () => undefined
  ;(sandbox.self as Record<string, unknown>).registration = {
    showNotification: async () => undefined,
  }
  ;(sandbox.self as Record<string, unknown>).clients = sandbox.clients
  ;(sandbox.self as Record<string, unknown>).location = {
    origin: 'https://mudavym.com',
  }

  vm.createContext(sandbox)
  vm.runInContext(SW_SOURCE, sandbox, { filename: 'sw.js' })

  expect(
    listeners.notificationclick,
    'sw.js must register a notificationclick listener',
  ).toBeTypeOf('function')

  let capturedPromise: Promise<unknown> | undefined
  const event = {
    action,
    notification: { close: () => undefined, data },
    waitUntil: (p: Promise<unknown>) => {
      capturedPromise = p
    },
  }

  listeners.notificationclick(event)
  await capturedPromise

  return { opened: openedUrl }
}

describe('sw.js notificationclick routing (both producers)', () => {
  describe('gateway camelCase payloads (notifications.service.ts)', () => {
    it('order-approval "approve" opens the order', async () => {
      const url = await resolveClickedUrl('approve', {
        orderId: 'ord-9',
        wineName: 'Barolo',
        quantity: 6,
        providerName: 'Anadolu',
      })
      expect(url).toBe('/orders/ord-9')
    })

    it('order-approval "view" opens the order', async () => {
      const url = await resolveClickedUrl('view', { orderId: 'ord-9' })
      expect(url).toBe('/orders/ord-9')
    })

    it('delivery "confirm" opens the order', async () => {
      const url = await resolveClickedUrl('confirm', { orderId: 'ord-9' })
      expect(url).toBe('/orders/ord-9')
    })

    it('low-stock "reorder" opens inventory prefilled with the wine', async () => {
      const url = await resolveClickedUrl('reorder', {
        wineId: 'wine-1',
        wineName: 'Chianti',
      })
      expect(url).toBe('/inventory?wine=Chianti&action=reorder')
    })

    it('low-stock "view" (no order, no delivery) opens inventory prefilled with the wine', async () => {
      const url = await resolveClickedUrl('view', { wineName: 'Chianti' })
      expect(url).toBe('/inventory?wine=Chianti')
    })
  })

  describe('Python snake_case payloads (push_notification_service.py)', () => {
    it('order-approval "approve"/"reject" both open the order', async () => {
      expect(await resolveClickedUrl('approve', { order_id: 'ord-9' })).toBe(
        '/orders/ord-9',
      )
      expect(await resolveClickedUrl('reject', { order_id: 'ord-9' })).toBe(
        '/orders/ord-9',
      )
    })

    it('the collapsed "open" action opens the order (L2 regression)', async () => {
      const url = await resolveClickedUrl('open', {
        type: 'order_approval',
        order_id: 'ord-9',
      })
      expect(url).toBe('/orders/ord-9')
    })

    it('the collapsed "open" action opens the order for negotiation-complete too (L3)', async () => {
      const url = await resolveClickedUrl('open', {
        order_id: 'ord-9',
        type: 'negotiation_complete',
      })
      expect(url).toBe('/orders/ord-9')
    })

    it('delivery "confirm"/"issue" open the order', async () => {
      expect(await resolveClickedUrl('confirm', { order_id: 'ord-9' })).toBe(
        '/orders/ord-9',
      )
      expect(await resolveClickedUrl('issue', { order_id: 'ord-9' })).toBe(
        '/orders/ord-9',
      )
    })

    it('"view" with only a delivery id opens the delivery', async () => {
      const url = await resolveClickedUrl('view', {
        delivery_id: 'del-4',
        type: 'delivery_confirmation',
      })
      expect(url).toBe('/deliveries/del-4')
    })

    it('"view" with only a wine name opens inventory prefilled with the wine', async () => {
      const url = await resolveClickedUrl('view', {
        wine_name: 'Barolo',
        type: 'low_stock_alert',
      })
      expect(url).toBe('/inventory?wine=Barolo')
    })
  })

  describe('fallback behaviour', () => {
    it('an unrecognised action with an order id still opens the order', async () => {
      const url = await resolveClickedUrl('snooze', { order_id: 'ord-9' })
      expect(url).toBe('/orders/ord-9')
    })

    it('"dismiss" with no usable id opens the app root', async () => {
      const url = await resolveClickedUrl('dismiss', {})
      expect(url).toBe('/')
    })

    it('no data at all opens the app root, not an error', async () => {
      const url = await resolveClickedUrl('view', undefined)
      expect(url).toBe('/')
    })
  })
})

describe('sw.js notificationclick reuses an open app tab (F-222)', () => {
  // A client reports an absolute url; the routing table returns a path. The
  // old `client.url === url` never matched, so every click opened a window.
  it('focuses the tab already on that page, opening nothing', async () => {
    const tab: FakeTab = { url: 'https://mudavym.com/orders/ord-9' }
    const r = await click('view', { orderId: 'ord-9' }, [tab])
    expect(tab.focused).toBe(true)
    expect(tab.navigatedTo).toBeUndefined()
    expect(r.opened).toBeUndefined()
  })

  // F-815: navigating another app tab would throw away unsaved work in it
  // (a half-written report draft lives only in React state).
  it('never navigates an app tab on another page away; opens a new window', async () => {
    const tab: FakeTab = { url: 'https://mudavym.com/reports' }
    const r = await click('view', { orderId: 'ord-9' }, [tab])
    expect(tab.focused).toBeUndefined()
    expect(tab.navigatedTo).toBeUndefined()
    expect(r.opened).toBe('/orders/ord-9')
  })

  it('picks the tab on that page even when another app tab comes first', async () => {
    const other: FakeTab = { url: 'https://mudavym.com/reports' }
    const tab: FakeTab = { url: 'https://mudavym.com/orders/ord-9' }
    const r = await click('view', { orderId: 'ord-9' }, [other, tab])
    expect(tab.focused).toBe(true)
    expect(other.focused).toBeUndefined()
    expect(other.navigatedTo).toBeUndefined()
    expect(r.opened).toBeUndefined()
  })

  it('never takes over a tab on another site', async () => {
    const tab: FakeTab = { url: 'https://example.com/orders/ord-9' }
    const r = await click('view', { orderId: 'ord-9' }, [tab])
    expect(tab.focused).toBeUndefined()
    expect(tab.navigatedTo).toBeUndefined()
    expect(r.opened).toBe('/orders/ord-9')
  })
})
