import type { NotificationPayload } from "./notifications"

/**
 * Notification templates for different event types
 */

export function createOrderApprovalNotification(data: {
  orderId: string
  wineName: string
  quantity: number
  providerName: string
  price?: number
}): NotificationPayload {
  return {
    type: "order_approval",
    title: "🍷 New Order Awaiting Approval",
    body: `${data.quantity} bottles of ${data.wineName} from ${data.providerName}${
      data.price ? ` ($${data.price.toFixed(2)}/bottle)` : ""
    }`,
    data: {
      orderId: data.orderId,
      wineName: data.wineName,
      quantity: data.quantity,
      providerName: data.providerName,
      price: data.price,
    },
    requireInteraction: true,
    actions: [
      { action: "approve", title: "✅ Approve" },
      { action: "view", title: "👁️ View Details" },
    ],
    tag: `order-approval-${data.orderId}`,
  }
}

export function createLowStockNotification(data: {
  wineId: string
  wineName: string
  currentStock: number
  threshold: number
  restaurantId: string
}): NotificationPayload {
  const severity =
    data.currentStock <= data.threshold * 0.5 ? "Critical" : "Low Stock"
  const emoji = data.currentStock <= data.threshold * 0.5 ? "🚨" : "⚠️"

  return {
    type: "low_stock",
    title: `${emoji} ${severity}: ${data.wineName}`,
    body: `Only ${data.currentStock} bottles remaining (threshold: ${data.threshold})`,
    data: {
      wineId: data.wineId,
      wineName: data.wineName,
      currentStock: data.currentStock,
      threshold: data.threshold,
      restaurantId: data.restaurantId,
    },
    requireInteraction: data.currentStock <= data.threshold * 0.5,
    actions: [
      { action: "reorder", title: "🛒 Reorder Now" },
      { action: "view", title: "📊 View Inventory" },
    ],
    tag: `low-stock-${data.wineId}`,
  }
}

export function createDeliveryNotification(data: {
  orderId: string
  wineName: string
  quantity: number
  providerName: string
}): NotificationPayload {
  return {
    type: "delivery",
    title: "📦 Delivery Arrived",
    body: `${data.quantity} bottles of ${data.wineName} from ${data.providerName}`,
    data: {
      orderId: data.orderId,
      wineName: data.wineName,
      quantity: data.quantity,
      providerName: data.providerName,
    },
    requireInteraction: true,
    actions: [
      { action: "confirm", title: "✅ Confirm Receipt" },
      { action: "view", title: "👁️ View Order" },
    ],
    tag: `delivery-${data.orderId}`,
  }
}

export function createPriceNegotiationNotification(data: {
  orderId: string
  wineName: string
  currentPrice: number
  proposedPrice: number
  providerName: string
}): NotificationPayload {
  const priceDiff = data.currentPrice - data.proposedPrice
  const percentage = ((priceDiff / data.currentPrice) * 100).toFixed(1)
  const direction = priceDiff > 0 ? "lower" : "higher"

  return {
    type: "price_negotiation",
    title: "💰 New Price Offer",
    body: `${data.providerName} offered $${data.proposedPrice.toFixed(2)}/bottle for ${
      data.wineName
    } (${Math.abs(Number(percentage))}% ${direction})`,
    data: {
      orderId: data.orderId,
      wineName: data.wineName,
      currentPrice: data.currentPrice,
      proposedPrice: data.proposedPrice,
      providerName: data.providerName,
    },
    requireInteraction: true,
    actions: [
      { action: "accept", title: "✅ Accept" },
      { action: "negotiate", title: "↔️ Counter" },
    ],
    tag: `negotiation-${data.orderId}`,
  }
}

export function createThresholdChangeNotification(data: {
  wineId: string
  wineName: string
  oldThreshold: number
  newThreshold: number
  restaurantId: string
}): NotificationPayload {
  return {
    type: "threshold_change",
    title: "📊 Threshold Updated",
    body: `${data.wineName}: ${data.oldThreshold} → ${data.newThreshold} bottles`,
    data: {
      wineId: data.wineId,
      wineName: data.wineName,
      oldThreshold: data.oldThreshold,
      newThreshold: data.newThreshold,
      restaurantId: data.restaurantId,
    },
    requireInteraction: false,
    actions: [{ action: "view", title: "👁️ View Settings" }],
    tag: `threshold-${data.wineId}`,
  }
}

export function createSystemAlertNotification(data: {
  title: string
  message: string
  severity: "info" | "warning" | "error"
}): NotificationPayload {
  const emoji = {
    info: "ℹ️",
    warning: "⚠️",
    error: "🚨",
  }[data.severity]

  return {
    type: "system_alert",
    title: `${emoji} ${data.title}`,
    body: data.message,
    data: {
      severity: data.severity,
    },
    requireInteraction: data.severity === "error",
    actions: [{ action: "view", title: "👁️ View Details" }],
    tag: `system-alert-${Date.now()}`,
  }
}

export function createInventoryMismatchNotification(data: {
  wineId: string
  wineName: string
  expectedStock: number
  actualStock: number
  discrepancy: number
}): NotificationPayload {
  return {
    type: "system_alert",
    title: "⚠️ Inventory Mismatch Detected",
    body: `${data.wineName}: Expected ${data.expectedStock}, found ${data.actualStock} (Δ ${data.discrepancy})`,
    data: {
      wineId: data.wineId,
      wineName: data.wineName,
      expectedStock: data.expectedStock,
      actualStock: data.actualStock,
      discrepancy: data.discrepancy,
    },
    requireInteraction: true,
    actions: [
      { action: "correct", title: "✏️ Correct" },
      { action: "view", title: "👁️ View Details" },
    ],
    tag: `mismatch-${data.wineId}`,
  }
}

/**
 * Helper: Send notification with retry logic
 */
export async function sendNotificationWithRetry(
  payload: NotificationPayload,
  sendFn: (payload: NotificationPayload) => Promise<void>,
  maxRetries: number = 3
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await sendFn(payload)
      return true
    } catch (error) {
      console.error(`Notification send attempt ${i + 1} failed:`, error)
      if (i === maxRetries - 1) {
        return false
      }
      // Wait before retry (exponential backoff)
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, i)))
    }
  }
  return false
}

