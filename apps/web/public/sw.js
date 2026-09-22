/**
 * Mudavym Service Worker
 * Handles push notifications, background sync, and caching
 *
 * Cache strategy:
 * - Navigations / HTML: network-first (never serve a stale index.html after deploy)
 * - Hashed /assets/*: cache-first (immutable content hashes)
 * - Icons / manifest: cache-first with offline fallback
 */

const CACHE_NAME = "wineops-v3"
const PRECACHE_URLS = [
  "/logo.png",
  "/badge.png",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.json",
]

function isNavigationRequest(request) {
  if (request.mode === "navigate") return true
  const accept = request.headers.get("accept") || ""
  return accept.includes("text/html")
}

function isHashedAsset(url) {
  return url.pathname.startsWith("/assets/")
}

function isPrecacheableStatic(url) {
  return PRECACHE_URLS.includes(url.pathname)
}

// Install event - cache static shell assets (not index.html)
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("Service Worker: Caching static files")
      return cache.addAll(PRECACHE_URLS)
    })
  )
  self.skipWaiting()
})

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log("Service Worker: Clearing old cache", cacheName)
            return caches.delete(cacheName)
          }
        })
      )
    })
  )
  return self.clients.claim()
})

// Push event - show notification
self.addEventListener("push", (event) => {
  console.log("Service Worker: Push received", event)

  let data = {
    title: "Mudavym",
    body: "You have a new notification",
    icon: "/logo.png",
    badge: "/badge.png",
  }

  if (event.data) {
    try {
      data = event.data.json()
    } catch (e) {
      data.body = event.data.text()
    }
  }

  // Unique tag per notification type ensures stacking in Safari Notification Center
  const notifTag = data.tag || `wineops-${data.data?.type || "general"}-${Date.now()}`

  const options = {
    body: data.body,
    icon: data.icon || "/logo.png",
    badge: data.badge || "/badge.png",
    vibrate: [200, 100, 200],
    data: data.data || {},
    actions: data.actions || [
      { action: "view", title: "View", icon: "/icons/view.png" },
      { action: "dismiss", title: "Dismiss", icon: "/icons/close.png" },
    ],
    requireInteraction: data.requireInteraction || false,
    tag: notifTag,
    renotify: true, // Safari: replace existing notification with same tag
    silent: false, // Safari: ensure notification sound plays
  }

  event.waitUntil(self.registration.showNotification(data.title, options))
})

/**
 * Resolve a notification click to the app URL it should open.
 *
 * Every action button used to fire its own unauthenticated `fetch` straight
 * from the service worker — no bearer token, no seal, and (for "approve") a
 * path (`/api/orders/:id/approve`) the gateway has never served; the real
 * endpoint is `POST /procurement/orders/:id/approve` and it will not act
 * without the JWT AND a freshly-minted seal (order-seal.ts) that only the
 * page can obtain. Every action now does one thing — open the app at the
 * page that has the real, authenticated, sealed ceremony for it.
 *
 * Two producers feed this handler, and they don't agree on a payload shape:
 * `push_notification_service.py` (Python) sends snake_case keys (`order_id`,
 * `wine_name`, `delivery_id`); the gateway's `sendWebPush`
 * (`notifications.service.ts`) sends camelCase keys (`orderId`, `wineName`)
 * and never adds `type` to the browser-push `data` at all — before this
 * fix, every gateway-originated push button fell through to `url = "/"`,
 * since this handler read only the Python spelling. Reading both
 * conventions here — rather than picking one producer to be "the" schema —
 * means neither has to remember to match the other, and a future third
 * producer that gets only one spelling right still routes.
 *
 * Routing is value-driven, not type-driven: which id is actually present on
 * the payload decides the destination, not `data.type`. The two producers
 * also disagree on `type` strings (Python's "low_stock_alert" /
 * "delivery_confirmation" vs the gateway's "low_stock" / "delivery"), so a
 * type-string branch would need to track both vocabularies forever — an
 * id-presence branch does not care which producer sent it.
 */
function resolveNotificationUrl(action, data) {
  data = data || {}
  const orderId = data.order_id ?? data.orderId
  const deliveryId = data.delivery_id ?? data.deliveryId
  const wineName = data.wine_name ?? data.wineName

  let url = "/"

  if (action === "approve" || action === "reject") {
    if (orderId) url = `/orders/${orderId}`
  } else if (action === "confirm" || action === "issue") {
    // send_delivery_confirmation_request's two actions (notification_agent.py)
    if (orderId) url = `/orders/${orderId}`
  } else if (action === "reorder") {
    url = wineName
      ? `/inventory?wine=${encodeURIComponent(wineName)}&action=reorder`
      : "/inventory"
  } else if (action === "view") {
    if (orderId) {
      url = `/orders/${orderId}`
    } else if (deliveryId) {
      url = `/deliveries/${deliveryId}`
    } else if (wineName) {
      url = `/inventory?wine=${encodeURIComponent(wineName)}`
    }
  }

  // "open" is push_notification_service.py's single collapsed action —
  // send_approval_notification and send_negotiation_complete_notification
  // both moved to it once one-tap approve/reject stopped being a real thing
  // to promise — and this same fallback also covers any action id this
  // table doesn't otherwise recognise: if the payload names an order and
  // nothing above already routed there, that is still the most useful
  // place to land rather than the bare app root.
  if (url === "/" && orderId) {
    url = `/orders/${orderId}`
  }

  return url
}

// Notification click event
self.addEventListener("notificationclick", (event) => {
  console.log("Service Worker: Notification clicked", event)

  event.notification.close()

  const action = event.action
  const data = event.notification.data || {}
  const url = resolveNotificationUrl(action, data)

  // Open or focus the app
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Check if there's already a window open
        for (const client of clientList) {
          if (client.url === url && "focus" in client) {
            return client.focus()
          }
        }
        // Open new window
        if (clients.openWindow) {
          return clients.openWindow(url)
        }
      })
  )
})

// Background sync event
self.addEventListener("sync", (event) => {
  console.log("Service Worker: Background sync", event)

  if (event.tag === "sync-inventory") {
    event.waitUntil(syncInventory())
  }
})

// Helper: Sync inventory in background
async function syncInventory() {
  try {
    const response = await fetch("/api/inventory/sync", {
      method: "POST",
    })
    if (response.ok) {
      console.log("Inventory synced successfully")
    }
  } catch (error) {
    console.error("Failed to sync inventory:", error)
  }
}

async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request)
    return networkResponse
  } catch (error) {
    const cached = await caches.match(request)
    if (cached) return cached
    // Offline SPA fallback: try a previously fetched document shell if present
    if (isNavigationRequest(request)) {
      const offlineShell = await caches.match("/")
      if (offlineShell) return offlineShell
    }
    throw error
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached

  const networkResponse = await fetch(request)
  // Only cache successful same-origin responses
  if (networkResponse.ok && networkResponse.type === "basic") {
    const cache = await caches.open(CACHE_NAME)
    cache.put(request, networkResponse.clone())
  }
  return networkResponse
}

// Fetch event
self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Never intercept API — always hit network
  if (url.pathname.startsWith("/api/")) return

  // HTML / navigations: always prefer network so deploys aren't masked by stale index.html
  if (isNavigationRequest(request) || url.pathname === "/" || url.pathname.endsWith(".html")) {
    event.respondWith(networkFirst(request))
    return
  }

  // Hashed Vite assets + static icons: cache-first
  if (isHashedAsset(url) || isPrecacheableStatic(url)) {
    event.respondWith(cacheFirst(request))
    return
  }

  // Default: network with cache fallback
  event.respondWith(networkFirst(request))
})

console.log("Service Worker: Loaded", CACHE_NAME)
