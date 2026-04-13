/**
 * Browser Push Notification Utilities
 * Supports Safari, Chrome, Firefox, Edge
 */

export type NotificationType = 
  | "order_approval"
  | "low_stock"
  | "delivery"
  | "price_negotiation"
  | "system_alert"
  | "threshold_change"

export interface NotificationPayload {
  type: NotificationType
  title: string
  body: string
  data?: Record<string, any>
  icon?: string
  badge?: string
  tag?: string
  requireInteraction?: boolean
  actions?: NotificationAction[]
}

export interface NotificationAction {
  action: string
  title: string
  icon?: string
}

/**
 * Check if browser supports notifications
 */
export function isNotificationSupported(): boolean {
  return "Notification" in window && "serviceWorker" in navigator
}

/**
 * Get current notification permission status
 */
export function getNotificationPermission(): NotificationPermission {
  if (!isNotificationSupported()) {
    return "denied"
  }
  return Notification.permission
}

/**
 * Request notification permission from user
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) {
    throw new Error("Notifications not supported in this browser")
  }

  if (Notification.permission === "granted") {
    return "granted"
  }

  if (Notification.permission === "denied") {
    return "denied"
  }

  // Request permission
  const permission = await Notification.requestPermission()
  return permission
}

/**
 * Show a browser notification
 */
export async function showNotification(payload: NotificationPayload): Promise<void> {
  const permission = getNotificationPermission()
  
  if (permission !== "granted") {
    console.warn("Notification permission not granted")
    return
  }

  if (!("serviceWorker" in navigator)) {
    // Fallback to basic Notification API
    const notification = new Notification(payload.title, {
      body: payload.body,
      icon: payload.icon || "/logo.png",
      badge: payload.badge || "/badge.png",
      tag: payload.tag || payload.type,
      requireInteraction: payload.requireInteraction || false,
      data: payload.data,
    })

    // Handle click
    notification.onclick = () => {
      window.focus()
      notification.close()
      handleNotificationClick(payload)
    }

    return
  }

  // Use Service Worker for better support
  const registration = await navigator.serviceWorker.ready
  await registration.showNotification(payload.title, {
    body: payload.body,
    icon: payload.icon || "/logo.png",
    badge: payload.badge || "/badge.png",
    tag: payload.tag || payload.type,
    requireInteraction: payload.requireInteraction || false,
    data: payload.data,
    actions: payload.actions || getDefaultActions(payload.type),
    vibrate: [200, 100, 200],
  })
}

/**
 * Get default actions based on notification type
 */
function getDefaultActions(type: NotificationType): NotificationAction[] {
  switch (type) {
    case "order_approval":
      return [
        { action: "approve", title: "Approve" },
        { action: "view", title: "View Details" },
      ]
    case "low_stock":
      return [
        { action: "reorder", title: "Reorder Now" },
        { action: "view", title: "View Inventory" },
      ]
    case "price_negotiation":
      return [
        { action: "accept", title: "Accept Price" },
        { action: "negotiate", title: "Counter Offer" },
      ]
    case "delivery":
      return [
        { action: "confirm", title: "Confirm Receipt" },
        { action: "view", title: "View Order" },
      ]
    default:
      return [{ action: "view", title: "View" }]
  }
}

/**
 * Handle notification click events
 */
function handleNotificationClick(payload: NotificationPayload): void {
  const { type, data } = payload

  // Route to appropriate page based on notification type
  switch (type) {
    case "order_approval":
      if (data?.orderId) {
        window.location.href = `/orders/${data.orderId}`
      }
      break
    case "low_stock":
      window.location.href = "/inventory"
      break
    case "price_negotiation":
      if (data?.orderId) {
        window.location.href = `/procurement/${data.orderId}`
      }
      break
    case "delivery":
      if (data?.orderId) {
        window.location.href = `/orders/${data.orderId}/delivery`
      }
      break
    default:
      window.location.href = "/"
  }
}

/**
 * Clear all notifications
 */
export async function clearAllNotifications(): Promise<void> {
  if (!("serviceWorker" in navigator)) return

  const registration = await navigator.serviceWorker.ready
  const notifications = await registration.getNotifications()
  notifications.forEach((notification) => notification.close())
}

/**
 * Clear notifications by tag
 */
export async function clearNotificationsByTag(tag: string): Promise<void> {
  if (!("serviceWorker" in navigator)) return

  const registration = await navigator.serviceWorker.ready
  const notifications = await registration.getNotifications({ tag })
  notifications.forEach((notification) => notification.close())
}

/**
 * Subscribe to push notifications (for web push API)
 */
export async function subscribeToPush(
  vapidPublicKey: string
): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    console.warn("Push notifications not supported")
    return null
  }

  const permission = await requestNotificationPermission()
  if (permission !== "granted") {
    return null
  }

  const registration = await navigator.serviceWorker.ready
  
  // Check for existing subscription
  let subscription = await registration.pushManager.getSubscription()
  
  if (!subscription) {
    // Create new subscription
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    })
  }

  return subscription
}

/**
 * Unsubscribe from push notifications
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  
  if (subscription) {
    await subscription.unsubscribe()
    return true
  }

  return false
}

/**
 * Helper: Convert VAPID public key to Uint8Array
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }

  return outputArray
}

/**
 * Test notification (for debugging)
 */
export async function sendTestNotification(): Promise<void> {
  await showNotification({
    type: "system_alert",
    title: "🍷 WineOps AI Test",
    body: "Notifications are working! You'll receive alerts here.",
    requireInteraction: false,
  })
}

