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

// Notification click event
self.addEventListener("notificationclick", (event) => {
  console.log("Service Worker: Notification clicked", event)

  event.notification.close()

  const action = event.action
  const data = event.notification.data

  let url = "/"

  // Handle different actions
  if (action === "approve" && data.orderId) {
    url = `/api/orders/${data.orderId}/approve`
    // Send API request to approve
    event.waitUntil(
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: true }),
      })
        .then((response) => {
          if (response.ok) {
            // Show success notification
            self.registration.showNotification("✅ Order Approved", {
              body: "The order has been approved successfully",
              icon: "/logo.png",
              tag: "approval-success",
            })
          }
        })
        .catch((error) => {
          console.error("Failed to approve order:", error)
        })
    )
    url = `/orders/${data.orderId}`
  } else if (action === "reorder" && data.wineId) {
    // One-tap reorder: send API request to create procurement order
    event.waitUntil(
      fetch(`/api/procurement/${data.restaurantId || "default"}/quick-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wineId: data.wineId,
          quantity: data.suggestedQuantity || 12,
        }),
      })
        .then((response) => {
          if (response.ok) {
            self.registration.showNotification("Reorder Placed", {
              body: `Reorder for ${data.wineName || "wine"} has been submitted`,
              icon: "/logo.png",
              tag: "reorder-success",
            })
          }
        })
        .catch((error) => {
          console.error("Failed to place reorder:", error)
        })
    )
    url = "/orders"
  } else if (action === "view") {
    if (data.orderId) {
      url = `/orders/${data.orderId}`
    } else if (data.type === "low_stock") {
      url = "/inventory"
    } else if (data.type === "delivery") {
      url = "/orders"
    }
  }

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
