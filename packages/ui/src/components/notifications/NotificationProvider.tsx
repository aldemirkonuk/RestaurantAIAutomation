import * as React from "react"
import {
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  showNotification,
  subscribeToPush,
  unsubscribeFromPush,
  type NotificationPayload,
} from "../../lib/notifications"

interface NotificationContextType {
  permission: NotificationPermission
  isSupported: boolean
  requestPermission: () => Promise<NotificationPermission>
  sendNotification: (payload: NotificationPayload) => Promise<void>
  subscribe: (vapidKey: string) => Promise<PushSubscription | null>
  unsubscribe: () => Promise<boolean>
}

const NotificationContext = React.createContext<NotificationContextType | undefined>(
  undefined
)

export interface NotificationProviderProps {
  children: React.ReactNode
  vapidPublicKey?: string
  autoRegisterServiceWorker?: boolean
  serviceWorkerPath?: string
}

export function NotificationProvider({
  children,
  vapidPublicKey,
  autoRegisterServiceWorker = true,
  serviceWorkerPath = "/sw.js",
}: NotificationProviderProps) {
  const [permission, setPermission] = React.useState<NotificationPermission>(
    getNotificationPermission()
  )
  const [isSupported] = React.useState(isNotificationSupported())
  const [serviceWorkerRegistered, setServiceWorkerRegistered] = React.useState(false)

  // Register service worker on mount
  React.useEffect(() => {
    if (
      autoRegisterServiceWorker &&
      isSupported &&
      "serviceWorker" in navigator &&
      !serviceWorkerRegistered
    ) {
      registerServiceWorker()
    }
  }, [autoRegisterServiceWorker, isSupported, serviceWorkerRegistered])

  // Listen for permission changes
  React.useEffect(() => {
    if (!isSupported) return

    const interval = setInterval(() => {
      const currentPermission = getNotificationPermission()
      if (currentPermission !== permission) {
        setPermission(currentPermission)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [permission, isSupported])

  const registerServiceWorker = async () => {
    try {
      const registration = await navigator.serviceWorker.register(serviceWorkerPath)
      console.log("Service Worker registered:", registration)
      setServiceWorkerRegistered(true)

      // Auto-subscribe if VAPID key is provided and permission is granted
      if (vapidPublicKey && permission === "granted") {
        await subscribeToPush(vapidPublicKey)
      }
    } catch (error) {
      console.error("Service Worker registration failed:", error)
    }
  }

  const handleRequestPermission = async (): Promise<NotificationPermission> => {
    const newPermission = await requestNotificationPermission()
    setPermission(newPermission)

    // Subscribe to push if permission granted
    if (newPermission === "granted" && vapidPublicKey) {
      await subscribeToPush(vapidPublicKey)
    }

    return newPermission
  }

  const handleSendNotification = async (payload: NotificationPayload) => {
    if (permission !== "granted") {
      console.warn("Cannot send notification: permission not granted")
      return
    }
    await showNotification(payload)
  }

  const handleSubscribe = async (vapidKey: string) => {
    return await subscribeToPush(vapidKey)
  }

  const handleUnsubscribe = async () => {
    return await unsubscribeFromPush()
  }

  const value: NotificationContextType = {
    permission,
    isSupported,
    requestPermission: handleRequestPermission,
    sendNotification: handleSendNotification,
    subscribe: handleSubscribe,
    unsubscribe: handleUnsubscribe,
  }

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  )
}

/**
 * Hook to use notifications
 */
export function useNotifications() {
  const context = React.useContext(NotificationContext)
  if (context === undefined) {
    throw new Error("useNotifications must be used within NotificationProvider")
  }
  return context
}

