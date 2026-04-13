/**
 * WineOps AI Service Worker
 * Handles push notifications, background sync, and caching
 */

const CACHE_NAME = "wineops-v1"
const urlsToCache = [
  "/",
  "/logo.png",
  "/badge.png",
]

// Install event - cache assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("Service Worker: Caching files")
      return cache.addAll(urlsToCache)
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
            console.log("Service Worker: Clearing old cache")
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
    title: "WineOps AI",
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

// Fetch event - serve from cache when offline
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request)
    })
  )
})

console.log("Service Worker: Loaded")

