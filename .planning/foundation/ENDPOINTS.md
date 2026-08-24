# API Endpoint Reference — Mudavym

> Generated 2026-08-24 from `apps/api-gateway/src/**/*.controller.ts`.
> **Grep target** — do not read whole (CLAUDE.md §2). Regenerate rather than hand-edit.

**448 endpoints** across **44 modules** · 311 guarded by `JwtAuthGuard` · 137 unguarded.

`Auth` column: ✅ = `JwtAuthGuard` present (class or method). ⚠️ = no guard found — note `TenantGuard` returns `true` for unauthenticated requests (`common/tenant/tenant.guard.ts:38-46`), so ⚠️ means reachable unauthenticated.

### `analytics/analytics` (39) — ⚠️ **39 unguarded** — **classify these**

| Auth | Method | Path |
|---|---|---|
| ⚠️ | `GET` | `/analytics/basket/:restaurantId` |
| ⚠️ | `GET` | `/analytics/cashflow/:restaurantId` |
| ⚠️ | `POST` | `/analytics/consult/:restaurantId` |
| ⚠️ | `GET` | `/analytics/consultants/:restaurantId` |
| ⚠️ | `PUT` | `/analytics/consultants/:restaurantId/toggle` |
| ⚠️ | `GET` | `/analytics/financial/:restaurantId` |
| ⚠️ | `GET` | `/analytics/forecast/:restaurantId` |
| ⚠️ | `GET` | `/analytics/goals/:restaurantId` |
| ⚠️ | `POST` | `/analytics/goals/:restaurantId` |
| ⚠️ | `GET` | `/analytics/goals/:restaurantId/:goalId/progress` |
| ⚠️ | `PUT` | `/analytics/goals/:restaurantId/:goalId/status` |
| ⚠️ | `GET` | `/analytics/health` |
| ⚠️ | `GET` | `/analytics/hot-tables/:restaurantId` |
| ⚠️ | `GET` | `/analytics/insight-catalog` |
| ⚠️ | `GET` | `/analytics/insight-catalog/types` |
| ⚠️ | `GET` | `/analytics/insight-prefs/:restaurantId` |
| ⚠️ | `PUT` | `/analytics/insight-prefs/:restaurantId/:category` |
| ⚠️ | `GET` | `/analytics/insights/:restaurantId` |
| ⚠️ | `GET` | `/analytics/inventory-science/:restaurantId` |
| ⚠️ | `GET` | `/analytics/menu-engineering/:restaurantId` |
| ⚠️ | `GET` | `/analytics/metrics` |
| ⚠️ | `GET` | `/analytics/overview/:restaurantId` |
| ⚠️ | `GET` | `/analytics/recommendations/:restaurantId` |
| ⚠️ | `POST` | `/analytics/recommendations/:restaurantId/action` |
| ⚠️ | `GET` | `/analytics/recommendations/:restaurantId/actions` |
| ⚠️ | `POST` | `/analytics/recommendations/:restaurantId/bulk-action` |
| ⚠️ | `GET` | `/analytics/recommendations/:restaurantId/digest` |
| ⚠️ | `PUT` | `/analytics/recommendations/:restaurantId/digest` |
| ⚠️ | `GET` | `/analytics/recommendations/:restaurantId/history` |
| ⚠️ | `GET` | `/analytics/risk/:restaurantId` |
| ⚠️ | `GET` | `/analytics/seasonality/:restaurantId` |
| ⚠️ | `GET` | `/analytics/table-performance/:restaurantId` |
| ⚠️ | `GET` | `/analytics/tables/:restaurantId` |
| ⚠️ | `POST` | `/analytics/tables/:restaurantId` |
| ⚠️ | `GET` | `/analytics/vendor-scorecard/:restaurantId` |
| ⚠️ | `GET` | `/analytics/venue/:restaurantId` |
| ⚠️ | `PUT` | `/analytics/venue/:restaurantId` |
| ⚠️ | `GET` | `/analytics/waiters/:restaurantId` |
| ⚠️ | `GET` | `/analytics/wine/:restaurantId/:masterWineId` |

### `auth/auth` (28)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/auth/check-email` |
| ✅ | `POST` | `/auth/dev-bypass-login` |
| ✅ | `POST` | `/auth/invite` |
| ✅ | `GET` | `/auth/invite/:code` |
| ✅ | `POST` | `/auth/invite/:code/accept` |
| ✅ | `POST` | `/auth/join` |
| ✅ | `POST` | `/auth/login` |
| ✅ | `POST` | `/auth/logout` |
| ✅ | `DELETE` | `/auth/me` |
| ✅ | `GET` | `/auth/me` |
| ✅ | `PATCH` | `/auth/me` |
| ✅ | `POST` | `/auth/me/leave-restaurant` |
| ✅ | `DELETE` | `/auth/me/link/:provider` |
| ✅ | `POST` | `/auth/me/link/:provider` |
| ✅ | `GET` | `/auth/me/linked-providers` |
| ✅ | `POST` | `/auth/me/password` |
| ✅ | `GET` | `/auth/me/role` |
| ✅ | `POST` | `/auth/oauth/google` |
| ✅ | `POST` | `/auth/oauth/microsoft` |
| ✅ | `POST` | `/auth/refresh` |
| ✅ | `POST` | `/auth/register` |
| ✅ | `POST` | `/auth/register/restaurant` |
| ✅ | `POST` | `/auth/request-password-reset` |
| ✅ | `POST` | `/auth/resend-verification` |
| ✅ | `POST` | `/auth/reset-password` |
| ✅ | `POST` | `/auth/switch-restaurant` |
| ✅ | `GET` | `/auth/verify` |
| ✅ | `POST` | `/auth/verify-email` |

### `calendar/calendar` (19)

| Auth | Method | Path |
|---|---|---|
| ✅ | `POST` | `/calendar/event-types` |
| ✅ | `DELETE` | `/calendar/event-types/:id` |
| ✅ | `PATCH` | `/calendar/event-types/:id` |
| ✅ | `GET` | `/calendar/event-types/:restaurantId` |
| ✅ | `GET` | `/calendar/events` |
| ✅ | `POST` | `/calendar/events` |
| ✅ | `DELETE` | `/calendar/events/:eventId` |
| ✅ | `GET` | `/calendar/events/:eventId` |
| ✅ | `PATCH` | `/calendar/events/:eventId` |
| ✅ | `DELETE` | `/calendar/events/:eventId/recurring` |
| ✅ | `GET` | `/calendar/events/:eventId/recurring` |
| ✅ | `PATCH` | `/calendar/events/:eventId/status` |
| ✅ | `GET` | `/calendar/feed/:token.ics` |
| ✅ | `GET` | `/calendar/ical-token` |
| ✅ | `POST` | `/calendar/ical-token/regenerate` |
| ✅ | `GET` | `/calendar/recurrence/:ruleId` |
| ✅ | `POST` | `/calendar/recurrence/:ruleId/generate` |
| ✅ | `GET` | `/calendar/today` |
| ✅ | `GET` | `/calendar/upcoming` |

### `common/orchestrator/health-proxy` (4)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/health` |
| ✅ | `GET` | `/health/agents` |
| ✅ | `GET` | `/health/agents/:name` |
| ✅ | `GET` | `/health/providers` |

### `common/orchestrator/inbound-email` (1) — ⚠️ **1 unguarded** (webhook module — expected public, must verify signatures instead)

| Auth | Method | Path |
|---|---|---|
| ⚠️ | `POST` | `/webhooks/inbound-email` |

### `common/orchestrator/prospects` (6)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/prospects` |
| ✅ | `GET` | `/prospects/:id/attachments` |
| ✅ | `POST` | `/prospects/:id/dismiss` |
| ✅ | `POST` | `/prospects/:id/promote` |
| ✅ | `POST` | `/prospects/:id/restore` |
| ✅ | `GET` | `/prospects/triage` |

### `common/orchestrator/sender-trust` (2)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/senders/reputation` |
| ✅ | `POST` | `/senders/trust` |

### `communications/communications` (18) — ⚠️ **18 unguarded** — **classify these**

| Auth | Method | Path |
|---|---|---|
| ⚠️ | `POST` | `/communications/alerts/daily-summary` |
| ⚠️ | `POST` | `/communications/alerts/low-stock` |
| ⚠️ | `POST` | `/communications/email` |
| ⚠️ | `POST` | `/communications/sms` |
| ⚠️ | `GET` | `/communications/status` |
| ⚠️ | `POST` | `/communications/test/e2e/step1-trigger-threshold` |
| ⚠️ | `POST` | `/communications/test/e2e/step2-approve-reorder` |
| ⚠️ | `POST` | `/communications/test/e2e/step3-send-vendor-email` |
| ⚠️ | `GET` | `/communications/test/e2e/step4-check-inbound` |
| ⚠️ | `POST` | `/communications/test/e2e/step5-approve-confirmation` |
| ⚠️ | `GET` | `/communications/test/e2e/step6-check-status` |
| ⚠️ | `POST` | `/communications/test/email` |
| ⚠️ | `POST` | `/communications/test/low-stock-alert` |
| ⚠️ | `POST` | `/communications/test/scenario` |
| ⚠️ | `POST` | `/communications/test/send-template` |
| ⚠️ | `POST` | `/communications/webhooks/gmail` |
| ⚠️ | `POST` | `/communications/webhooks/gmail/force-fetch` |
| ⚠️ | `GET` | `/communications/webhooks/gmail/status` |

### `contacts/contacts` (8) — ⚠️ **8 unguarded** — **classify these**

| Auth | Method | Path |
|---|---|---|
| ⚠️ | `GET` | `/contacts` |
| ⚠️ | `POST` | `/contacts` |
| ⚠️ | `DELETE` | `/contacts/:id` |
| ⚠️ | `GET` | `/contacts/:id` |
| ⚠️ | `PATCH` | `/contacts/:id` |
| ⚠️ | `GET` | `/contacts/:id/addresses` |
| ⚠️ | `POST` | `/contacts/:id/addresses` |
| ⚠️ | `DELETE` | `/contacts/addresses/:addressId` |

### `conversations/conversations` (12)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/conversations` |
| ✅ | `GET` | `/conversations/:conversationId` |
| ✅ | `POST` | `/conversations/:conversationId/approve` |
| ✅ | `PUT` | `/conversations/:conversationId/message` |
| ✅ | `POST` | `/conversations/:conversationId/reject` |
| ✅ | `POST` | `/conversations/:conversationId/summarize` |
| ✅ | `GET` | `/conversations/by-order/:orderId` |
| ✅ | `GET` | `/conversations/by-provider/:providerId` |
| ✅ | `GET` | `/conversations/pending/list` |
| ✅ | `GET` | `/conversations/stats/overview` |
| ✅ | `GET` | `/conversations/thread/:threadId` |
| ✅ | `GET` | `/conversations/threads` |

### `dashboard/dashboard` (8) — ⚠️ **8 unguarded** — **classify these**

| Auth | Method | Path |
|---|---|---|
| ⚠️ | `GET` | `/dashboard/activity/:restaurantId` |
| ⚠️ | `GET` | `/dashboard/alerts/:restaurantId` |
| ⚠️ | `GET` | `/dashboard/calendar-revenue/:restaurantId` |
| ⚠️ | `GET` | `/dashboard/health` |
| ⚠️ | `GET` | `/dashboard/inventory-breakdown/:restaurantId` |
| ⚠️ | `GET` | `/dashboard/sales-chart/:restaurantId` |
| ⚠️ | `GET` | `/dashboard/stats/:restaurantId` |
| ⚠️ | `GET` | `/dashboard/summary/:restaurantId` |

### `distributor-discovery/distributor-discovery` (3)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/distributors/:id` |
| ✅ | `GET` | `/distributors/facets` |
| ✅ | `GET` | `/distributors/search` |

### `events/events` (3)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/events` |
| ✅ | `POST` | `/events` |
| ✅ | `GET` | `/events/metrics` |

### `integrations/integrations-oauth` (5)

| Auth | Method | Path |
|---|---|---|
| ✅ | `DELETE` | `/integrations/oauth/:integrationId` |
| ✅ | `POST` | `/integrations/oauth/:integrationId/authorize` |
| ✅ | `GET` | `/integrations/oauth/:provider/callback` |
| ✅ | `GET` | `/integrations/oauth/catalog` |
| ✅ | `GET` | `/integrations/oauth/connections` |

### `inventory-ledger/inventory-ledger` (8)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/inventory-ledger/inventory/:inventoryId/balance` |
| ✅ | `GET` | `/inventory-ledger/inventory/:inventoryId/history` |
| ✅ | `POST` | `/inventory-ledger/inventory/:inventoryId/reconcile` |
| ✅ | `GET` | `/inventory-ledger/summary` |
| ✅ | `GET` | `/inventory-ledger/transactions` |
| ✅ | `POST` | `/inventory-ledger/transactions` |
| ✅ | `GET` | `/inventory-ledger/transactions/:transactionId` |
| ✅ | `POST` | `/inventory-ledger/transactions/bulk` |

### `inventory/inventory` (18)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/inventory/:restaurantId` |
| ✅ | `DELETE` | `/inventory/:restaurantId/item/:itemId` |
| ✅ | `GET` | `/inventory/:restaurantId/item/:itemId` |
| ✅ | `PATCH` | `/inventory/:restaurantId/item/:itemId` |
| ✅ | `GET` | `/inventory/:restaurantId/item/:itemId/activity` |
| ✅ | `POST` | `/inventory/:restaurantId/item/:itemId/count` |
| ✅ | `POST` | `/inventory/:restaurantId/item/:itemId/count-photo-estimate` |
| ✅ | `POST` | `/inventory/:restaurantId/item/:itemId/pour` |
| ✅ | `POST` | `/inventory/:restaurantId/item/:itemId/transfer` |
| ✅ | `POST` | `/inventory/:restaurantId/items` |
| ✅ | `POST` | `/inventory/:restaurantId/items/bulk` |
| ✅ | `GET` | `/inventory/:restaurantId/low-stock` |
| ✅ | `GET` | `/inventory/:restaurantId/summary` |
| ✅ | `GET` | `/inventory/:restaurantId/toast/lookup/:toastItemGuid` |
| ✅ | `POST` | `/inventory/:restaurantId/toast/map` |
| ✅ | `DELETE` | `/inventory/:restaurantId/toast/map/:inventoryId` |
| ✅ | `POST` | `/inventory/:restaurantId/toast/map/bulk` |
| ✅ | `GET` | `/inventory/:restaurantId/toast/unmapped` |

### `logs/logs` (1)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/logs/timeline/:restaurantId` |

### `menus/menus` (8)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/menus/:restaurantId` |
| ✅ | `POST` | `/menus/import` |
| ✅ | `POST` | `/menus/items` |
| ✅ | `PATCH` | `/menus/items/:id` |
| ✅ | `GET` | `/menus/progress` |
| ✅ | `PATCH` | `/menus/progress` |
| ✅ | `PATCH` | `/menus/threshold` |
| ✅ | `GET` | `/menus/vendor-email` |

### `mobile/mobile` (4)

| Auth | Method | Path |
|---|---|---|
| ✅ | `POST` | `/mobile/devices` |
| ✅ | `DELETE` | `/mobile/devices/:token` |
| ✅ | `GET` | `/mobile/feed` |
| ✅ | `GET` | `/mobile/today-pulse` |

### `notifications/notifications` (24) — ⚠️ **24 unguarded** — **classify these**

| Auth | Method | Path |
|---|---|---|
| ⚠️ | `GET` | `/notifications` |
| ⚠️ | `POST` | `/notifications` |
| ⚠️ | `DELETE` | `/notifications/:id` |
| ⚠️ | `PATCH` | `/notifications/:id/archive` |
| ⚠️ | `PATCH` | `/notifications/:id/read` |
| ⚠️ | `PATCH` | `/notifications/:id/unread` |
| ⚠️ | `DELETE` | `/notifications/bulk` |
| ⚠️ | `POST` | `/notifications/delivery` |
| ⚠️ | `GET` | `/notifications/history` |
| ⚠️ | `POST` | `/notifications/low-stock` |
| ⚠️ | `POST` | `/notifications/order-approval` |
| ⚠️ | `GET` | `/notifications/preferences` |
| ⚠️ | `PATCH` | `/notifications/preferences` |
| ⚠️ | `POST` | `/notifications/price-negotiation` |
| ⚠️ | `POST` | `/notifications/push/subscribe` |
| ⚠️ | `POST` | `/notifications/push/unsubscribe` |
| ⚠️ | `DELETE` | `/notifications/read/all` |
| ⚠️ | `PATCH` | `/notifications/read/all` |
| ⚠️ | `PATCH` | `/notifications/read/bulk` |
| ⚠️ | `POST` | `/notifications/send-email` |
| ⚠️ | `POST` | `/notifications/system-alert` |
| ⚠️ | `POST` | `/notifications/test` |
| ⚠️ | `GET` | `/notifications/unread` |
| ⚠️ | `GET` | `/notifications/unread/count` |

### `one-tap-actions/one-tap-actions` (8)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/one-tap-actions` |
| ✅ | `POST` | `/one-tap-actions` |
| ✅ | `DELETE` | `/one-tap-actions/:actionId` |
| ✅ | `GET` | `/one-tap-actions/:actionId` |
| ✅ | `PUT` | `/one-tap-actions/:actionId` |
| ✅ | `POST` | `/one-tap-actions/:actionId/cancel` |
| ✅ | `POST` | `/one-tap-actions/:actionId/execute` |
| ✅ | `GET` | `/one-tap-actions/pending` |

### `organizations/organizations` (8)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/organizations/branches` |
| ✅ | `GET` | `/organizations/chains` |
| ✅ | `POST` | `/organizations/chains` |
| ✅ | `DELETE` | `/organizations/chains/:id` |
| ✅ | `PATCH` | `/organizations/chains/:id` |
| ✅ | `POST` | `/organizations/locations` |
| ✅ | `GET` | `/organizations/locations/:id` |
| ✅ | `PATCH` | `/organizations/locations/:id` |

### `pos-hub/pos-hub` (10) — ⚠️ **10 unguarded** (webhook module — expected public, must verify signatures instead)

| Auth | Method | Path |
|---|---|---|
| ⚠️ | `POST` | `/pos-hub/catalog-match/:restaurantId` |
| ⚠️ | `GET` | `/pos-hub/catalog-match/:restaurantId/proposals` |
| ⚠️ | `POST` | `/pos-hub/catalog-match/:restaurantId/proposals/:proposalId/approve` |
| ⚠️ | `POST` | `/pos-hub/catalog-match/:restaurantId/proposals/:proposalId/reject` |
| ⚠️ | `POST` | `/pos-hub/import/:restaurantId` |
| ⚠️ | `GET` | `/pos-hub/mappings/:restaurantId` |
| ⚠️ | `POST` | `/pos-hub/mappings/:restaurantId` |
| ⚠️ | `GET` | `/pos-hub/providers` |
| ⚠️ | `GET` | `/pos-hub/status/:restaurantId` |
| ⚠️ | `POST` | `/pos-hub/webhook/:provider/:restaurantId` |

### `procurement/documents/credits` (3)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/procurement/credits` |
| ✅ | `POST` | `/procurement/credits/:id/transition` |
| ✅ | `GET` | `/procurement/credits/stats` |

### `procurement/documents/documents` (6)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/procurement/documents` |
| ✅ | `POST` | `/procurement/documents` |
| ✅ | `GET` | `/procurement/documents/:id` |
| ✅ | `POST` | `/procurement/documents/:id/lines/:lineId/link` |
| ✅ | `POST` | `/procurement/documents/:id/match` |
| ✅ | `POST` | `/procurement/documents/:id/verify` |

### `procurement/procurement` (26)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/procurement/conversations/active` |
| ✅ | `GET` | `/procurement/conversations/history` |
| ✅ | `GET` | `/procurement/orders` |
| ✅ | `POST` | `/procurement/orders` |
| ✅ | `DELETE` | `/procurement/orders/:id` |
| ✅ | `GET` | `/procurement/orders/:id` |
| ✅ | `PATCH` | `/procurement/orders/:id` |
| ✅ | `POST` | `/procurement/orders/:id/ai-pause` |
| ✅ | `POST` | `/procurement/orders/:id/approve` |
| ✅ | `POST` | `/procurement/orders/:id/approve-draft` |
| ✅ | `GET` | `/procurement/orders/:id/attachments` |
| ✅ | `POST` | `/procurement/orders/:id/cancel-scheduled-send` |
| ✅ | `POST` | `/procurement/orders/:id/confirm-deal` |
| ✅ | `GET` | `/procurement/orders/:id/conversations` |
| ✅ | `GET` | `/procurement/orders/:id/deal-proposal` |
| ✅ | `POST` | `/procurement/orders/:id/deliver` |
| ✅ | `POST` | `/procurement/orders/:id/discard-draft` |
| ✅ | `POST` | `/procurement/orders/:id/dismiss-deal` |
| ✅ | `GET` | `/procurement/orders/:id/draft` |
| ✅ | `PATCH` | `/procurement/orders/:id/draft` |
| ✅ | `POST` | `/procurement/orders/:id/generate-ai-reply` |
| ✅ | `POST` | `/procurement/orders/:id/manual-reply` |
| ✅ | `POST` | `/procurement/orders/:id/verify-receipt` |
| ✅ | `GET` | `/procurement/orders/history` |
| ✅ | `GET` | `/procurement/orders/pending` |
| ✅ | `GET` | `/procurement/orders/pending/count` |

### `procurement/receiving` (3)

| Auth | Method | Path |
|---|---|---|
| ✅ | `POST` | `/procurement/receiving/orders/:id/door` |
| ✅ | `GET` | `/procurement/receiving/queue` |
| ✅ | `GET` | `/procurement/receiving/unverified` |

### `procurement/recurring-orders` (6) — ⚠️ **6 unguarded** — **classify these**

| Auth | Method | Path |
|---|---|---|
| ⚠️ | `GET` | `/recurring-orders/:restaurantId` |
| ⚠️ | `POST` | `/recurring-orders/:restaurantId` |
| ⚠️ | `DELETE` | `/recurring-orders/:restaurantId/:id` |
| ⚠️ | `GET` | `/recurring-orders/:restaurantId/:id` |
| ⚠️ | `PUT` | `/recurring-orders/:restaurantId/:id` |
| ⚠️ | `POST` | `/recurring-orders/:restaurantId/execute-check` |

### `providers/provider-intelligence` (17)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/providers/:id/conversation-memory` |
| ✅ | `POST` | `/providers/:id/conversation-memory/search` |
| ✅ | `GET` | `/providers/:id/knowledge` |
| ✅ | `PUT` | `/providers/:id/knowledge/:knowledgeId/verify` |
| ✅ | `GET` | `/providers/:id/knowledge/contradictions` |
| ✅ | `POST` | `/providers/:id/onboard` |
| ✅ | `POST` | `/providers/:id/outreach` |
| ✅ | `GET` | `/providers/:id/promotions` |
| ✅ | `GET` | `/providers/:id/sentiment` |
| ✅ | `GET` | `/providers/:id/sessions` |
| ✅ | `GET` | `/providers/:id/sessions/:sessionId/summary` |
| ✅ | `GET` | `/providers/intelligence/compare` |
| ✅ | `GET` | `/providers/intelligence/leverage` |
| ✅ | `GET` | `/providers/promotions/active` |
| ✅ | `GET` | `/providers/promotions/compare` |
| ✅ | `GET` | `/providers/promotions/expiring` |
| ✅ | `GET` | `/providers/promotions/savings` |

### `providers/providers` (29)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/providers` |
| ✅ | `POST` | `/providers` |
| ✅ | `DELETE` | `/providers/:id` |
| ✅ | `GET` | `/providers/:id` |
| ✅ | `GET` | `/providers/:id` |
| ✅ | `PATCH` | `/providers/:id` |
| ✅ | `PATCH` | `/providers/:id/contact-date` |
| ✅ | `GET` | `/providers/:id/contacts` |
| ✅ | `POST` | `/providers/:id/contacts` |
| ✅ | `DELETE` | `/providers/:id/contacts/:contactId` |
| ✅ | `PATCH` | `/providers/:id/contacts/:contactId` |
| ✅ | `GET` | `/providers/:id/intelligence` |
| ✅ | `PATCH` | `/providers/:id/intelligence` |
| ✅ | `GET` | `/providers/:id/intelligence/summary` |
| ✅ | `GET` | `/providers/:id/locations` |
| ✅ | `POST` | `/providers/:id/locations` |
| ✅ | `DELETE` | `/providers/:id/locations/:locationId` |
| ✅ | `PATCH` | `/providers/:id/locations/:locationId` |
| ✅ | `GET` | `/providers/:id/orders` |
| ✅ | `GET` | `/providers/:id/performance` |
| ✅ | `POST` | `/providers/:id/rate` |
| ✅ | `GET` | `/providers/:id/recommendations` |
| ✅ | `POST` | `/providers/:id/retroactive-order` |
| ✅ | `POST` | `/providers/bulk-import` |
| ✅ | `POST` | `/providers/import` |
| ✅ | `GET` | `/providers/match` |
| ✅ | `GET` | `/providers/recommendations` |
| ✅ | `GET` | `/providers/search` |
| ✅ | `GET` | `/providers/search/wine-type` |

### `reports/reports` (7)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/reports` |
| ✅ | `GET` | `/reports/:id` |
| ✅ | `GET` | `/reports/:id/download` |
| ✅ | `POST` | `/reports/generate` |
| ✅ | `POST` | `/reports/schedule` |
| ✅ | `GET` | `/reports/schedules` |
| ✅ | `DELETE` | `/reports/schedules/:id` |

### `restaurant-templates/restaurant-templates` (4)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/restaurants/:restaurantId/templates` |
| ✅ | `POST` | `/restaurants/:restaurantId/templates` |
| ✅ | `DELETE` | `/restaurants/:restaurantId/templates/:templateId` |
| ✅ | `PATCH` | `/restaurants/:restaurantId/templates/:templateId` |

### `restaurants/members` (6)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/restaurants/:restaurantId/invites` |
| ✅ | `DELETE` | `/restaurants/:restaurantId/invites/:code` |
| ✅ | `GET` | `/restaurants/:restaurantId/members` |
| ✅ | `POST` | `/restaurants/:restaurantId/members` |
| ✅ | `DELETE` | `/restaurants/:restaurantId/members/:memberId` |
| ✅ | `PATCH` | `/restaurants/:restaurantId/members/:memberId` |

### `settings/settings` (4)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/settings/feature-flags` |
| ✅ | `PUT` | `/settings/feature-flags` |
| ✅ | `GET` | `/settings/feature-flags/:restaurantId` |
| ✅ | `POST` | `/settings/feature-flags/check` |

### `simpos/simpos` (11) — ⚠️ **11 unguarded** (webhook module — expected public, must verify signatures instead)

| Auth | Method | Path |
|---|---|---|
| ⚠️ | `GET` | `/simpos/:restaurantId/catalog` |
| ⚠️ | `POST` | `/simpos/:restaurantId/catalog` |
| ⚠️ | `DELETE` | `/simpos/:restaurantId/catalog/:catalogId` |
| ⚠️ | `POST` | `/simpos/:restaurantId/catalog/seed` |
| ⚠️ | `GET` | `/simpos/:restaurantId/check` |
| ⚠️ | `GET` | `/simpos/:restaurantId/check/:checkId` |
| ⚠️ | `POST` | `/simpos/:restaurantId/check/:checkId/close` |
| ⚠️ | `POST` | `/simpos/:restaurantId/check/:checkId/lines` |
| ⚠️ | `PATCH` | `/simpos/:restaurantId/lines/:lineId` |
| ⚠️ | `GET` | `/simpos/:restaurantId/orders` |
| ⚠️ | `GET` | `/simpos/:restaurantId/tables` |

### `storage-locations/storage-locations` (8)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/storage-locations/:restaurantId` |
| ✅ | `POST` | `/storage-locations/:restaurantId` |
| ✅ | `DELETE` | `/storage-locations/:restaurantId/:locationId` |
| ✅ | `PATCH` | `/storage-locations/:restaurantId/:locationId` |
| ✅ | `GET` | `/storage-locations/:restaurantId/locations/:locationId/wines` |
| ✅ | `GET` | `/storage-locations/:restaurantId/mappings` |
| ✅ | `POST` | `/storage-locations/:restaurantId/mappings` |
| ✅ | `DELETE` | `/storage-locations/:restaurantId/mappings/:wineId` |

### `team/team` (33)

| Auth | Method | Path |
|---|---|---|
| ✅ | `POST` | `/restaurants/:restaurantId/team/broadcast` |
| ✅ | `GET` | `/restaurants/:restaurantId/team/certifications` |
| ✅ | `POST` | `/restaurants/:restaurantId/team/certifications` |
| ✅ | `DELETE` | `/restaurants/:restaurantId/team/certifications/:certId` |
| ✅ | `PATCH` | `/restaurants/:restaurantId/team/certifications/:certId` |
| ✅ | `GET` | `/restaurants/:restaurantId/team/coverage-templates` |
| ✅ | `POST` | `/restaurants/:restaurantId/team/coverage-templates` |
| ✅ | `DELETE` | `/restaurants/:restaurantId/team/coverage-templates/:id` |
| ✅ | `GET` | `/restaurants/:restaurantId/team/members` |
| ✅ | `POST` | `/restaurants/:restaurantId/team/members` |
| ✅ | `DELETE` | `/restaurants/:restaurantId/team/members/:memberId` |
| ✅ | `PATCH` | `/restaurants/:restaurantId/team/members/:memberId` |
| ✅ | `GET` | `/restaurants/:restaurantId/team/members/:memberId/performance` |
| ✅ | `GET` | `/restaurants/:restaurantId/team/my-week` |
| ✅ | `POST` | `/restaurants/:restaurantId/team/sales` |
| ✅ | `POST` | `/restaurants/:restaurantId/team/sales/batch` |
| ✅ | `POST` | `/restaurants/:restaurantId/team/schedules` |
| ✅ | `POST` | `/restaurants/:restaurantId/team/schedules/:scheduleId/acknowledge` |
| ✅ | `POST` | `/restaurants/:restaurantId/team/schedules/:scheduleId/publish` |
| ✅ | `POST` | `/restaurants/:restaurantId/team/schedules/copy-week` |
| ✅ | `GET` | `/restaurants/:restaurantId/team/settings` |
| ✅ | `PATCH` | `/restaurants/:restaurantId/team/settings` |
| ✅ | `POST` | `/restaurants/:restaurantId/team/shifts` |
| ✅ | `DELETE` | `/restaurants/:restaurantId/team/shifts/:shiftId` |
| ✅ | `PATCH` | `/restaurants/:restaurantId/team/shifts/:shiftId` |
| ✅ | `POST` | `/restaurants/:restaurantId/team/shifts/:shiftId/assign` |
| ✅ | `POST` | `/restaurants/:restaurantId/team/shifts/:shiftId/callout` |
| ✅ | `POST` | `/restaurants/:restaurantId/team/shifts/:shiftId/offer-cover` |
| ✅ | `GET` | `/restaurants/:restaurantId/team/swaps` |
| ✅ | `GET` | `/restaurants/:restaurantId/team/time-off` |
| ✅ | `POST` | `/restaurants/:restaurantId/team/time-off` |
| ✅ | `PATCH` | `/restaurants/:restaurantId/team/time-off/:requestId` |
| ✅ | `GET` | `/restaurants/:restaurantId/team/week` |

### `toast/toast` (10) — ⚠️ **10 unguarded** (webhook module — expected public, must verify signatures instead)

| Auth | Method | Path |
|---|---|---|
| ⚠️ | `POST` | `/toast/cache/refresh` |
| ⚠️ | `GET` | `/toast/health` |
| ⚠️ | `GET` | `/toast/menus` |
| ⚠️ | `GET` | `/toast/menus/:menuId` |
| ⚠️ | `POST` | `/toast/orders` |
| ⚠️ | `GET` | `/toast/orders/:orderId` |
| ⚠️ | `GET` | `/toast/sales` |
| ⚠️ | `GET` | `/toast/statistics` |
| ⚠️ | `POST` | `/toast/webhook` |
| ⚠️ | `GET` | `/toast/webhook/metrics` |

### `user-preferences/user-preferences` (2)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/users/:userId/preferences` |
| ✅ | `PATCH` | `/users/:userId/preferences` |

### `ux-optimizer/ux-optimizer` (8)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/ux/learnings` |
| ✅ | `GET` | `/ux/overrides` |
| ✅ | `GET` | `/ux/proposals` |
| ✅ | `POST` | `/ux/proposals/:id/review` |
| ✅ | `POST` | `/ux/proposals/:id/rollback` |
| ✅ | `POST` | `/ux/proposals/:page` |
| ✅ | `POST` | `/ux/signals` |
| ✅ | `GET` | `/ux/summary/:page` |

### `vendor-catalogue/vendor-catalogue` (4)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/vendor-catalogue/:id` |
| ✅ | `GET` | `/vendor-catalogue/:id` |
| ✅ | `GET` | `/vendor-catalogue/match` |
| ✅ | `GET` | `/vendor-catalogue/search` |

### `vendor-intel/vendor-intel` (4)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/vendor-intel/compare` |
| ✅ | `POST` | `/vendor-intel/observations` |
| ✅ | `POST` | `/vendor-intel/scrape` |
| ✅ | `POST` | `/vendor-intel/sweep` |

### `vendor-portal/vendor-portal` (2) — ⚠️ **2 unguarded** (webhook module — expected public, must verify signatures instead)

| Auth | Method | Path |
|---|---|---|
| ⚠️ | `GET` | `/vendor-portal/:slug` |
| ⚠️ | `GET` | `/vendor-portal/:slug/jsonld` |

### `wines/wines` (10)

| Auth | Method | Path |
|---|---|---|
| ✅ | `GET` | `/wines` |
| ✅ | `GET` | `/wines/:wineId` |
| ✅ | `GET` | `/wines/:wineId/similar` |
| ✅ | `GET` | `/wines/meta/categories` |
| ✅ | `GET` | `/wines/meta/countries` |
| ✅ | `GET` | `/wines/meta/regions` |
| ✅ | `POST` | `/wines/submissions` |
| ✅ | `GET` | `/wines/submissions/list` |
| ✅ | `POST` | `/wines/submissions/process` |
| ✅ | `GET` | `/wines/suggestions` |
