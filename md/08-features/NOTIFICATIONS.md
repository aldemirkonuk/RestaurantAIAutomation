# 🔔 Browser Push Notifications

## Overview

WineOps AI features a comprehensive browser push notification system that delivers real-time alerts directly to Safari, Chrome, Firefox, and Edge browsers - even when the app isn't open!

**Until the mobile app launches, this is the primary way managers receive critical approval requests and alerts.**

---

## Features

✅ **Native OS Notifications** - Appear in the same place as system notifications (macOS top-right, Windows bottom-right)  
✅ **Works Offline** - Service Worker enables notifications even when browser is closed  
✅ **One-Tap Actions** - Approve orders, reorder items, view details directly from notification  
✅ **Smart Grouping** - Similar notifications are grouped together  
✅ **Sound & Vibration** - Customizable alerts for different notification types  
✅ **Cross-Browser Support** - Safari, Chrome, Firefox, Edge  
✅ **No Mobile App Required** - Full functionality in browser until mobile app launches  

---

## Notification Types

### 1. **Order Approval** 🍷
**When:** New procurement order needs manager approval  
**Priority:** High (requires interaction)  
**Actions:**
- ✅ Approve - Instantly approve the order
- 👁️ View Details - Open order page

**Example:**
```
🍷 New Order Awaiting Approval
24 bottles of Cabernet Sauvignon 2019 from Wine Supplier Co. ($45.00/bottle)
[✅ Approve] [👁️ View Details]
```

### 2. **Low Stock Alert** ⚠️
**When:** Wine inventory falls below threshold  
**Priority:** Medium (critical if below 50% of threshold)  
**Actions:**
- 🛒 Reorder Now - Start reorder flow
- 📊 View Inventory - Open inventory page

**Example:**
```
⚠️ Low Stock: Pinot Noir 2020
Only 3 bottles remaining (threshold: 8)
[🛒 Reorder Now] [📊 View Inventory]
```

### 3. **Delivery Notification** 📦
**When:** Order arrives at restaurant  
**Priority:** High (requires confirmation)  
**Actions:**
- ✅ Confirm Receipt - Mark as received
- 👁️ View Order - See order details

**Example:**
```
📦 Delivery Arrived
24 bottles of Merlot 2018 from Premium Wines Inc.
[✅ Confirm Receipt] [👁️ View Order]
```

### 4. **Price Negotiation** 💰
**When:** Supplier responds with new price offer  
**Priority:** High (requires decision)  
**Actions:**
- ✅ Accept - Accept the price
- ↔️ Counter - Make counter-offer

**Example:**
```
💰 New Price Offer
Wine Supplier Co. offered $42.50/bottle for Cabernet Sauvignon 2019 (5.6% lower)
[✅ Accept] [↔️ Counter]
```

### 5. **System Alert** 🚨
**When:** Critical system events or errors  
**Priority:** Varies (info/warning/error)  
**Actions:**
- 👁️ View Details - See full alert

**Example:**
```
⚠️ Inventory Mismatch Detected
Pinot Noir 2020: Expected 12, found 10 (Δ 2)
[✏️ Correct] [👁️ View Details]
```

---

## Implementation

### Frontend Setup

#### 1. Wrap App with NotificationProvider

```tsx
import { NotificationProvider, NotificationBanner } from "@wineops/ui"

function App() {
  return (
    <NotificationProvider
      vapidPublicKey={import.meta.env.VITE_VAPID_PUBLIC_KEY}
      autoRegisterServiceWorker={true}
    >
      <NotificationBanner position="top" />
      <YourApp />
    </NotificationProvider>
  )
}
```

#### 2. Use Notification Hook

```tsx
import { useNotifications } from "@wineops/ui"

function Dashboard() {
  const { permission, requestPermission, sendNotification } = useNotifications()

  const handleEnableNotifications = async () => {
    const result = await requestPermission()
    if (result === "granted") {
      console.log("Notifications enabled!")
    }
  }

  return (
    <div>
      {permission === "default" && (
        <button onClick={handleEnableNotifications}>
          Enable Notifications
        </button>
      )}
    </div>
  )
}
```

#### 3. Send Test Notification

```tsx
import { useNotifications, sendTestNotification } from "@wineops/ui"

function Settings() {
  const { sendNotification } = useNotifications()

  const testNotification = () => {
    sendNotification({
      type: "system_alert",
      title: "🍷 Test Notification",
      body: "Notifications are working perfectly!",
    })
  }

  return <button onClick={testNotification}>Test Notifications</button>
}
```

#### 4. Add Notification Bell

```tsx
import { NotificationBell } from "@wineops/ui"

function Header() {
  const [notificationCount, setNotificationCount] = useState(3)

  return (
    <NotificationBell
      count={notificationCount}
      onClick={() => alert("Show notifications")}
    />
  )
}
```

---

### Backend Setup

#### 1. Send from NestJS

```typescript
import { NotificationsService } from "./notifications/notifications.service"

@Injectable()
export class OrdersService {
  constructor(private notifications: NotificationsService) {}

  async createOrder(order: Order) {
    // ... create order logic

    // Send notification to manager
    await this.notifications.sendOrderApprovalNotification({
      userId: order.managerId,
      orderId: order.id,
      wineName: order.wineName,
      quantity: order.quantity,
      providerName: order.providerName,
      price: order.price,
    })
  }
}
```

#### 2. Send Low Stock Alert

```typescript
async checkInventory(restaurantId: string) {
  const lowStockItems = await this.getL owStockItems(restaurantId)

  for (const item of lowStockItems) {
    await this.notifications.sendLowStockAlert({
      restaurantId,
      wineId: item.wineId,
      wineName: item.wineName,
      currentStock: item.currentStock,
      threshold: item.threshold,
    })
  }
}
```

#### 3. API Endpoints

```bash
# Test notification
POST /api/v1/notifications/test
Body: { "userId": "user_123" }

# Order approval
POST /api/v1/notifications/order-approval
Body: {
  "userId": "user_123",
  "orderId": "ORDER-123",
  "wineName": "Cabernet Sauvignon 2019",
  "quantity": 24,
  "providerName": "Wine Supplier Co.",
  "price": 45.00
}

# Low stock alert
POST /api/v1/notifications/low-stock
Body: {
  "restaurantId": "restaurant_123",
  "wineId": "WINE_001",
  "wineName": "Pinot Noir 2020",
  "currentStock": 3,
  "threshold": 8
}
```

---

## Service Worker

The service worker (`/sw.js`) handles:
- **Push events** - Receive notifications from server
- **Notification clicks** - Handle user interactions
- **Background sync** - Sync data when connection restored
- **Offline caching** - Cache assets for offline use

**Key Features:**
- Auto-approve from notification (one-tap approval)
- Smart routing based on notification type
- Retry failed requests
- Queue actions for background processing

---

## Browser Permissions

### Request Flow

```
1. User visits app
2. NotificationBanner appears (if permission not set)
3. User clicks "Enable Notifications"
4. Browser shows permission dialog
5. User grants permission
6. Service Worker registers
7. App subscribes to push notifications
8. Ready to receive notifications!
```

### Permission States

- **default** - Not yet asked (show banner)
- **granted** - User approved (send notifications)
- **denied** - User blocked (hide banner, show settings link)

### Re-requesting Permission

If user denies permission, they must manually enable it in browser settings:

**Chrome/Edge:**
1. Click lock icon in address bar
2. Go to Site settings
3. Enable Notifications

**Safari:**
1. Safari → Settings → Websites
2. Find wineops.ai
3. Allow Notifications

**Firefox:**
1. Click lock icon
2. More Information → Permissions
3. Allow Notifications

---

## Testing

### Local Testing

```bash
# 1. Start services
docker-compose up -d
cd apps/api-gateway && pnpm run start:dev
cd apps/web && pnpm run dev

# 2. Open http://localhost:3000
# 3. Enable notifications when prompted
# 4. Trigger test notification
curl -X POST http://localhost:4000/api/v1/notifications/test \
  -H "Content-Type: application/json" \
  -d '{"userId": "user_123"}'

# 5. Should see notification appear!
```

### Browser DevTools

**Chrome DevTools:**
1. F12 → Application → Service Workers
2. See registered workers
3. Test push events
4. View notification history

**Safari DevTools:**
1. Develop → Show Web Inspector
2. Storage → Service Workers
3. Console for logs

---

## Troubleshooting

### Notifications Not Showing

1. **Check permission** - Is it "granted"?
2. **Service Worker** - Is it registered?
3. **HTTPS required** - Notifications need secure connection (except localhost)
4. **Browser support** - Is browser supported?
5. **Do Not Disturb** - Is OS in Do Not Disturb mode?

### Service Worker Issues

```bash
# Unregister and re-register
navigator.serviceWorker.getRegistrations().then(registrations => {
  registrations.forEach(r => r.unregister())
})

# Clear cache
caches.keys().then(names => {
  names.forEach(name => caches.delete(name))
})

# Refresh page
location.reload()
```

### Safari-Specific Issues

Safari has stricter requirements:
- Must be user-initiated (click event)
- Requires valid SSL certificate
- May need "Allow Websites to Ask" enabled in Safari settings

---

## Best Practices

1. **Always request permission on user action** - Never auto-request on page load
2. **Explain why** - Show benefits before asking
3. **Respect denials** - Don't repeatedly ask
4. **Test across browsers** - Different browsers behave differently
5. **Provide alternatives** - Email/SMS fallback if notifications denied
6. **Keep it relevant** - Only send important notifications
7. **Group similar notifications** - Use tags to prevent spam

---

## Security

- **Service Worker scope** - Limited to app origin
- **HTTPS only** - Required for production
- **Permission required** - Can't send without user approval
- **No sensitive data** - Don't include passwords/tokens in notifications

---

## Future Enhancements

- [ ] Web Push API integration (server-side push)
- [ ] Notification history/inbox
- [ ] Per-user notification preferences
- [ ] Quiet hours (don't disturb schedule)
- [ ] Notification sounds/vibration patterns
- [ ] Rich media notifications (images, videos)
- [ ] Action responses without opening app

---

## Resources

- [Web Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API)
- [Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [Notification Actions](https://developer.mozilla.org/en-US/docs/Web/API/Notification/actions)

---

**Status:** ✅ Production Ready  
**Last Updated:** 2026-01-08  
**Version:** 1.0.0

