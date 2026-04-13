# WineOps AI - API Reference

**Version**: 2.6.0  
**Base URL**: `http://localhost:4000/api/v1`  
**Last Updated**: January 2026

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Dashboard](#2-dashboard)
3. [Inventory](#3-inventory)
4. [Procurement](#4-procurement)
5. [Reports](#5-reports)
6. [Toast POS](#6-toast-pos)
7. [Events](#7-events)
8. [Calendar](#8-calendar)
9. [Inventory Ledger](#9-inventory-ledger)
10. [Providers](#10-providers)
11. [Conversations](#11-conversations)
12. [Communications](#12-communications)
13. [Notifications](#13-notifications)
14. [One-Tap Actions](#14-one-tap-actions)

---

## Authentication

All protected endpoints require `Authorization: Bearer <token>` header.

### Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/login` | No | Email/password login |
| POST | `/auth/register` | No | User registration |
| POST | `/auth/oauth/google` | No | Google OAuth login |
| POST | `/auth/oauth/microsoft` | No | Microsoft OAuth login |
| POST | `/auth/refresh` | No | Refresh access token |
| POST | `/auth/logout` | Yes | Logout and blacklist token |
| GET | `/auth/me` | Yes | Get current user profile |
| GET | `/auth/verify` | Yes | Verify token validity |

### Request/Response Examples

#### POST /auth/login
```json
// Request
{
  "email": "user@restaurant.com",
  "password": "securePassword123"
}

// Response 200
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid",
    "email": "user@restaurant.com",
    "name": "John Doe",
    "role": "manager",
    "restaurantId": "uuid"
  }
}
```

#### POST /auth/register
```json
// Request
{
  "email": "user@restaurant.com",
  "password": "securePassword123",
  "name": "John Doe",
  "restaurantId": "uuid",
  "role": "staff"
}

// Response 201
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": { ... }
}
```

---

## 2. Dashboard

Base path: `/dashboard`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/summary/:restaurantId` | Yes | Get aggregated dashboard data |
| GET | `/health` | No | Health check |

### GET /dashboard/summary/:restaurantId

Returns aggregated data from multiple services (API Bus pattern).

```json
// Response 200
{
  "inventory": {
    "totalItems": 342,
    "totalValue": 125000,
    "lowStockCount": 12
  },
  "orders": {
    "pending": 5,
    "inTransit": 3,
    "deliveredThisWeek": 8
  },
  "notifications": [
    {
      "id": "uuid",
      "type": "low_stock",
      "message": "Chateau Margaux 2018 low stock",
      "createdAt": "2026-01-20T10:30:00Z"
    }
  ],
  "reports": {
    "lastGenerated": "2026-01-19T08:00:00Z",
    "scheduled": 3
  }
}
```

---

## 3. Inventory

Base path: `/inventory`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/:restaurantId` | Yes | Get all inventory items |
| GET | `/:restaurantId/low-stock` | Yes | Get low stock items |
| GET | `/:restaurantId/item/:itemId` | Yes | Get single item |
| GET | `/:restaurantId/summary` | Yes | Get inventory summary stats |
| PATCH | `/:restaurantId/item/:itemId` | Yes | Update inventory item |
| GET | `/:restaurantId/toast/unmapped` | Yes | Get unmapped Toast items |
| GET | `/:restaurantId/toast/lookup/:guid` | Yes | Find by Toast GUID |
| POST | `/:restaurantId/toast/map` | Yes | Map Toast item to inventory |
| POST | `/:restaurantId/toast/map/bulk` | Yes | Bulk map Toast items |
| DELETE | `/:restaurantId/toast/map/:id` | Yes | Remove Toast mapping |

### GET /inventory/:restaurantId

```json
// Query params: ?search=margaux&category=red&lowStock=true&page=1&limit=20

// Response 200
{
  "items": [
    {
      "id": "uuid",
      "masterWineId": "uuid",
      "name": "Chateau Margaux 2018",
      "producer": "Chateau Margaux",
      "region": "Bordeaux",
      "vintage": 2018,
      "grapeVariety": "Cabernet Sauvignon blend",
      "wineType": "Red",
      "stockLive": 6,
      "thresholdMin": 12,
      "costPerUnit": 450.00,
      "sellPrice": 850.00,
      "status": "low_stock"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 342,
    "totalPages": 18
  }
}
```

### PATCH /inventory/:restaurantId/item/:itemId

```json
// Request
{
  "stockLive": 24,
  "thresholdMin": 12,
  "costPerUnit": 455.00,
  "sellPrice": 875.00
}

// Response 200
{
  "id": "uuid",
  "stockLive": 24,
  "updatedAt": "2026-01-20T10:30:00Z"
}
```

---

## 4. Procurement

Base path: `/api/v1/procurement`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/orders` | Yes | Create procurement order |
| GET | `/orders` | Yes | List orders (paginated) |
| GET | `/orders/pending` | Yes | Get pending orders |
| GET | `/orders/history` | Yes | Get order history |
| GET | `/orders/:id` | Yes | Get order details |
| PATCH | `/orders/:id` | Yes | Update order |
| DELETE | `/orders/:id` | Yes | Cancel order |
| POST | `/orders/:id/approve` | Yes | Approve order |
| POST | `/orders/:id/deliver` | Yes | Mark order delivered |

### POST /procurement/orders

```json
// Request
{
  "providerId": "uuid",
  "items": [
    {
      "inventoryId": "uuid",
      "quantity": 24,
      "unitPrice": 45.00
    }
  ],
  "notes": "Urgent delivery needed",
  "requestedDeliveryDate": "2026-01-25"
}

// Response 201
{
  "id": "uuid",
  "status": "pending_approval",
  "totalAmount": 1080.00,
  "createdAt": "2026-01-20T10:30:00Z"
}
```

### POST /procurement/orders/:id/approve

```json
// Request
{
  "approverId": "uuid",
  "notes": "Approved for immediate order"
}

// Response 200
{
  "id": "uuid",
  "status": "approved",
  "approvedBy": "uuid",
  "approvedAt": "2026-01-20T11:00:00Z"
}
```

---

## 5. Reports

Base path: `/api/v1/reports`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/generate` | Yes | Generate report |
| GET | `/` | Yes | List generated reports |
| GET | `/:id` | Yes | Get report details |
| GET | `/:id/download` | Yes | Download report file |
| POST | `/schedule` | Yes | Schedule recurring report |
| GET | `/schedules` | Yes | List scheduled reports |
| DELETE | `/schedules/:id` | Yes | Delete scheduled report |

### POST /reports/generate

```json
// Request
{
  "type": "inventory_valuation",
  "format": "pdf",
  "dateRange": {
    "start": "2026-01-01",
    "end": "2026-01-20"
  },
  "options": {
    "includeCharts": true,
    "groupBy": "category"
  }
}

// Response 202
{
  "id": "uuid",
  "status": "generating",
  "estimatedCompletionTime": "2026-01-20T10:35:00Z"
}
```

### POST /reports/schedule

```json
// Request
{
  "type": "weekly_summary",
  "format": "pdf",
  "frequency": "weekly",
  "dayOfWeek": "monday",
  "time": "08:00",
  "recipients": ["manager@restaurant.com"]
}

// Response 201
{
  "id": "uuid",
  "nextRun": "2026-01-27T08:00:00Z"
}
```

---

## 6. Toast POS

Base path: `/toast`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/webhook` | HMAC | Receive Toast webhooks |
| GET | `/webhook/metrics` | Yes | Webhook processing metrics |
| GET | `/menus` | Yes | Get all Toast menus |
| GET | `/menus/:menuId` | Yes | Get single menu |
| POST | `/cache/refresh` | Yes | Refresh menu cache |
| POST | `/orders` | Yes | Create Toast order |
| GET | `/orders/:orderId` | Yes | Get Toast order |
| GET | `/sales` | Yes | Get sales data |
| GET | `/statistics` | Yes | Get API statistics |
| GET | `/health` | No | Health check |

### POST /toast/webhook

Receives Toast POS webhooks. Requires HMAC signature verification.

```json
// Headers
{
  "Toast-Signature": "sha256=abc123..."
}

// Request body (from Toast)
{
  "type": "MENU_PUBLISHED",
  "restaurantGuid": "toast-restaurant-guid",
  "payload": { ... }
}

// Response 200
{
  "received": true
}
```

### GET /toast/sales

```json
// Query params: ?startDate=2026-01-01&endDate=2026-01-20

// Response 200
{
  "sales": [
    {
      "date": "2026-01-20",
      "itemGuid": "toast-item-guid",
      "itemName": "Chateau Margaux 2018",
      "quantity": 3,
      "revenue": 2550.00
    }
  ],
  "summary": {
    "totalRevenue": 45000.00,
    "totalItems": 156
  }
}
```

---

## 7. Events

Base path: `/events`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/` | Yes | Ingest new event |
| GET | `/` | Yes | List events with filters |
| GET | `/metrics` | No | Event ingestion metrics |

### POST /events

Idempotent event ingestion with automatic deduplication.

```json
// Request
{
  "eventType": "inventory_change",
  "sourcePage": "inventory",
  "payload": {
    "wineId": "uuid",
    "quantity": 5,
    "changeType": "add",
    "reason": "Delivery received"
  },
  "idempotencyKey": "inv-change-123-1706123456"
}

// Response 201 (new event)
{
  "id": "uuid",
  "eventType": "inventory_change",
  "createdAt": "2026-01-20T10:30:00Z",
  "deduped": false
}

// Response 200 (duplicate)
{
  "id": "uuid",
  "eventType": "inventory_change",
  "createdAt": "2026-01-20T10:28:00Z",
  "deduped": true
}
```

### GET /events

```json
// Query params: ?eventType=inventory_change&sourcePage=inventory&limit=50

// Response 200
{
  "events": [
    {
      "id": "uuid",
      "eventType": "inventory_change",
      "sourcePage": "inventory",
      "payload": { ... },
      "createdAt": "2026-01-20T10:30:00Z"
    }
  ],
  "pagination": {
    "cursor": "cursor-token",
    "hasMore": true
  }
}
```

---

## 8. Calendar

Base path: `/calendar`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/events` | Yes | Create calendar event |
| GET | `/events` | Yes | List events with filters |
| GET | `/events/:eventId` | Yes | Get specific event |
| PATCH | `/events/:eventId` | Yes | Update event |
| DELETE | `/events/:eventId` | Yes | Delete event |
| POST | `/recurrence/:ruleId/generate` | Yes | Generate occurrences |
| GET | `/recurrence/:ruleId` | Yes | Get recurrence rule |
| GET | `/upcoming` | Yes | Get upcoming events (30 days) |
| GET | `/today` | Yes | Get today's events |

### POST /calendar/events

```json
// Request
{
  "title": "Wine Tasting - New Releases",
  "eventType": "tasting",
  "startTime": "2026-01-25T15:00:00Z",
  "endTime": "2026-01-25T17:00:00Z",
  "description": "Tasting new Burgundy releases",
  "location": "Private Dining Room",
  "attendees": ["john@restaurant.com"],
  "recurring": {
    "frequency": "monthly",
    "interval": 1,
    "until": "2026-12-31"
  }
}

// Response 201
{
  "id": "uuid",
  "recurrenceRuleId": "uuid",
  "createdAt": "2026-01-20T10:30:00Z"
}
```

### DELETE /calendar/events/:eventId

```json
// Query params: ?scope=this|all|future

// Response 200
{
  "deleted": true,
  "scope": "this",
  "affectedCount": 1
}
```

---

## 9. Inventory Ledger

Base path: `/inventory-ledger`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/transactions` | Yes | Record transaction |
| POST | `/transactions/bulk` | Yes | Bulk transactions |
| GET | `/transactions` | Yes | List transactions |
| GET | `/transactions/:id` | Yes | Get transaction |
| GET | `/inventory/:id/balance` | Yes | Get balance at point in time |
| GET | `/inventory/:id/history` | Yes | Get transaction history |
| GET | `/summary` | Yes | Transaction summary |
| POST | `/inventory/:id/reconcile` | Yes | Reconcile inventory |

### POST /inventory-ledger/transactions

```json
// Request
{
  "inventoryId": "uuid",
  "transactionType": "sale",
  "quantity": -2,
  "source": "toast_pos",
  "reference": "toast-order-123",
  "notes": "Table 5 order"
}

// Response 201
{
  "id": "uuid",
  "balanceAfter": 22,
  "createdAt": "2026-01-20T10:30:00Z"
}
```

### POST /inventory-ledger/inventory/:id/reconcile

```json
// Request
{
  "actualCount": 20,
  "countedBy": "uuid",
  "notes": "Monthly count - 2 bottles discrepancy"
}

// Response 200
{
  "previousBalance": 22,
  "newBalance": 20,
  "adjustment": -2,
  "adjustmentTransaction": {
    "id": "uuid",
    "transactionType": "adjustment"
  }
}
```

---

## 10. Providers

Base path: `/api/v1/providers`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/` | Yes | Create provider |
| GET | `/` | Yes | List providers |
| GET | `/:id` | Yes | Get provider details |
| PATCH | `/:id` | Yes | Update provider |
| DELETE | `/:id` | Yes | Soft delete provider |
| GET | `/:id/orders` | Yes | Provider order history |
| GET | `/:id/performance` | Yes | Provider metrics |
| POST | `/:id/rate` | Yes | Rate provider |

### POST /providers

```json
// Request
{
  "name": "Southern Glazer's Wine & Spirits",
  "contactEmail": "orders@southernglazers.com",
  "contactPhone": "+1-555-0123",
  "address": "123 Wine District, Napa, CA",
  "deliverySchedule": {
    "days": ["tuesday", "friday"],
    "cutoffTime": "14:00"
  },
  "paymentTerms": "net30",
  "minimumOrder": 500.00
}

// Response 201
{
  "id": "uuid",
  "createdAt": "2026-01-20T10:30:00Z"
}
```

### GET /providers/:id/performance

```json
// Response 200
{
  "providerId": "uuid",
  "metrics": {
    "totalOrders": 45,
    "onTimeDeliveryRate": 0.94,
    "averageLeadTime": 3.2,
    "fillRate": 0.98,
    "averageRating": 4.5,
    "totalSpend": 125000.00
  },
  "period": {
    "start": "2025-01-01",
    "end": "2026-01-20"
  }
}
```

---

## 11. Conversations

Base path: `/api/v1/conversations`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/:conversationId` | Yes | Get conversation by ID |
| GET | `/pending` | Yes | Get all pending conversations |
| POST | `/:conversationId/approve` | Yes | Approve AI conversation |
| PUT | `/:conversationId/message` | Yes | Edit AI message |
| POST | `/:conversationId/reject` | Yes | Reject conversation |

### POST /conversations/:conversationId/approve

```json
// Request
{
  "approverId": "uuid",
  "notes": "Approved with minor edits"
}

// Response 200
{
  "id": "uuid",
  "status": "approved",
  "approvedAt": "2026-01-20T10:30:00Z",
  "executed": true
}
```

---

## 12. Communications

Base path: `/communications`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/status` | Yes | Get service status |
| POST | `/email` | Yes | Send email via Gmail API |
| POST | `/sms` | Yes | Send SMS via Plivo |
| POST | `/alerts/low-stock` | Yes | Send low stock alert |
| POST | `/alerts/daily-summary` | Yes | Send daily summary |
| POST | `/test/low-stock-alert` | Yes | Test low stock alert |
| POST | `/test/email` | Yes | Test email sending |

### POST /communications/email

```json
// Request
{
  "to": ["provider@example.com"],
  "subject": "Order Confirmation #12345",
  "templateId": "order_confirmation",
  "variables": {
    "orderNumber": "12345",
    "items": [...],
    "total": 1500.00
  },
  "attachments": [
    {
      "filename": "order.pdf",
      "content": "base64-content"
    }
  ]
}

// Response 200
{
  "messageId": "gmail-message-id",
  "sent": true
}
```

### POST /communications/sms

```json
// Request
{
  "to": "+1-555-0123",
  "message": "Your delivery from Southern Glazer's has arrived.",
  "templateId": "delivery_notification"
}

// Response 200
{
  "messageId": "plivo-message-id",
  "sent": true
}
```

---

## 13. Notifications

Base path: `/api/v1/notifications`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/test` | Yes | Send test notification |
| POST | `/order-approval` | Yes | Order approval notification |
| POST | `/low-stock` | Yes | Low stock alert |
| POST | `/delivery` | Yes | Delivery notification |
| POST | `/price-negotiation` | Yes | Price negotiation alert |
| POST | `/system-alert` | Yes | System alert |
| POST | `/send-email` | Yes | Send email notification |

### POST /notifications/low-stock

```json
// Request
{
  "restaurantId": "uuid",
  "items": [
    {
      "inventoryId": "uuid",
      "name": "Chateau Margaux 2018",
      "currentStock": 3,
      "threshold": 12
    }
  ],
  "channels": ["email", "sms", "push"]
}

// Response 200
{
  "notificationId": "uuid",
  "channels": {
    "email": { "sent": true },
    "sms": { "sent": true },
    "push": { "sent": true }
  }
}
```

---

## 14. One-Tap Actions

Base path: `/one-tap-actions`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/:restaurantId` | Yes | Get all actions |
| GET | `/:restaurantId/pending` | Yes | Get pending actions |
| GET | `/action/:actionId` | Yes | Get single action |
| POST | `/:restaurantId` | Yes | Create new action |
| PUT | `/action/:actionId` | Yes | Update action |
| POST | `/action/:actionId/execute` | Yes | Execute action |
| POST | `/action/:actionId/cancel` | Yes | Cancel action |
| DELETE | `/action/:actionId` | Yes | Delete action |

### POST /one-tap-actions/:restaurantId

```json
// Request
{
  "type": "reorder",
  "title": "Reorder Chateau Margaux",
  "description": "Stock below threshold, reorder 24 bottles",
  "priority": "high",
  "payload": {
    "inventoryId": "uuid",
    "quantity": 24,
    "providerId": "uuid"
  },
  "expiresAt": "2026-01-25T23:59:59Z"
}

// Response 201
{
  "id": "uuid",
  "status": "pending",
  "createdAt": "2026-01-20T10:30:00Z"
}
```

### POST /one-tap-actions/action/:actionId/execute

```json
// Request
{
  "executedBy": "uuid",
  "notes": "Approved and executed"
}

// Response 200
{
  "id": "uuid",
  "status": "executed",
  "executedAt": "2026-01-20T10:35:00Z",
  "result": {
    "orderId": "uuid",
    "success": true
  }
}
```

---

## Error Responses

All endpoints return consistent error responses:

```json
// 400 Bad Request
{
  "statusCode": 400,
  "message": ["email must be an email"],
  "error": "Bad Request"
}

// 401 Unauthorized
{
  "statusCode": 401,
  "message": "Invalid or expired token",
  "error": "Unauthorized"
}

// 403 Forbidden
{
  "statusCode": 403,
  "message": "Insufficient permissions",
  "error": "Forbidden"
}

// 404 Not Found
{
  "statusCode": 404,
  "message": "Resource not found",
  "error": "Not Found"
}

// 429 Too Many Requests
{
  "statusCode": 429,
  "message": "Rate limit exceeded",
  "error": "Too Many Requests",
  "retryAfter": 60
}

// 500 Internal Server Error
{
  "statusCode": 500,
  "message": "Internal server error",
  "error": "Internal Server Error",
  "traceId": "uuid"
}
```

---

## Rate Limits

| Endpoint Type | Limit | Window |
|---------------|-------|--------|
| Default | 100 | 1 minute |
| Auth | 10 | 1 minute |
| Upload | 10 | 5 minutes |
| AI | 20 | 1 minute |
| Webhook | 1000 | 1 minute |

---

**Document Version**: 1.0  
**Created**: January 2026  
**OpenAPI Spec**: `/api/docs` (Swagger UI)
