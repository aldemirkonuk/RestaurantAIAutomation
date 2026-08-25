---
type: page
route: /orders
slug: orders
component: apps/web/src/pages/Orders.tsx
audience: owner
tier: core
signals_today: none
rebrand_strings: 4
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[receiving-door]]", "[[providers]]"]
---

# /orders — Orders

## Surface — buttons → where they go

- **Create Order** → (modal on this page) → API `POST /api/v1/procurement/orders`
- **Approve** → API `POST /api/v1/procurement/orders/:id/approve`
- **Mark as delivered** → API `POST /api/v1/procurement/orders/:id/deliver`
- **Receive at the door** (row menu) → [[receiving-door]] `/receiving/:orderId/door`
- **Go to Providers** (no-vendor guard modal) → [[providers]] `/providers`
- **Export** → (in-page download via ExportMenu)
- **Draft email approval panel** → (panel on this page — approve/send vendor email)

## 1. Purpose

The procurement cockpit: draft, approve, cancel and track purchase orders through
delivery, plus the AI vendor-email layer — one-tap approval of AI-drafted replies,
active conversation threads, deal proposals, and delivered-order booking into
inventory. Sidebar tooltip: "Draft, approve, and track purchase orders through
delivery" (`apps/web/src/components/layout/Sidebar.tsx:75`).

## 2. Entry

In-degree 4 ([PAGE_MAP](../foundation/PAGE_MAP.md):140): from `/`, `/inventory`,
`/providers`, `/receiving`. Sidebar item (`Sidebar.tsx:73`); pending-order count
badge (`Sidebar.tsx:409`). Eagerly loaded (`apps/web/src/App.tsx:73`).

## 3. Files

- Route binding: `apps/web/src/App.tsx:257`.
- `apps/web/src/pages/Orders.tsx` (3,614 lines — largest page in the app).
- Co-located: `pages/orders/{useOrdersPage.ts, OrderSummary.tsx, OrderFilters.tsx, CreateOrderModal.tsx, index.tsx}`.
- Rendered components: `components/orders/{OrderApprovalModal, OrderGuardModal, DraftEmailApprovalPanel, ActiveConversationsPanel, CommsThreadDrawer}.tsx`, `components/insights/ContextualInsights.tsx` (Orders.tsx:5-10).

## 4. Endpoints

Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):389 (`procurement`, 26), :249
(`inventory`), :461 (`providers`), :663 (`wines`), :10 (`analytics` — ⚠ unguarded).

| Method | Path | Call site |
|---|---|---|
| GET | `/procurement/orders` (list) | `useOrders` → `services/api/orders.ts:53` |
| POST | `/procurement/orders` | `pages/Orders.tsx:966` |
| PATCH / DELETE | `/procurement/orders/:id` | `pages/Orders.tsx:583` / `:532,3323` |
| POST | `/procurement/orders/:id/approve` | `pages/Orders.tsx:514,3275` |
| POST | `/procurement/orders/:id/deliver` | `pages/Orders.tsx:651` |
| POST | `/inventory/add-from-order` | raw axios, `pages/Orders.tsx:684` |
| GET/PATCH | `/procurement/orders/:id/draft` | `pages/Orders.tsx:417,1021`; `hooks/queries/useDraftEmailQueries.ts:57,404` |
| POST | `…/approve-draft`, `…/generate-ai-reply`, `…/discard-draft`, `…/manual-reply`, `…/ai-pause`, `…/cancel-scheduled-send` | `useDraftEmailQueries.ts:78,103,128,225,241,255` |
| GET | `…/conversations`, `…/attachments` | `useDraftEmailQueries.ts:186,212` |
| GET/POST | `…/deal-proposal`, `…/confirm-deal`, `…/dismiss-deal` | `useDraftEmailQueries.ts:352,367,388` |
| GET | `/providers` | `useProviders` → `services/api/providers.ts:201` |
| GET/POST | `/analytics/insights/:rid`, `/analytics/recommendations/:rid/action(s)` | `components/insights/ContextualInsights.tsx:118-192` |

## 5. Signals

**None.** No tracking, no `uxSignals` (reporter dark per `lib/uxSignals.ts:15`, zero
page importers), no `data-ux-key` markers in this tree. Guidance tips render here via
`useGuidanceOptional` (Orders.tsx:58) but `trackGuidance` has no sink
(`guidance/analytics.ts:29-39`).

## 6. Tier cut

**Core** — operate. Scenarios: S02 (PO-prefilled delivery flow starts from orders),
S03 (credit chase drafts), S08 (price context via insights), S13 (vendor add → first
order). S02/S03 Core are ✅ ships-today ([TIER-MAP](../03-scenarios/TIER-MAP.md):38-39).

## 7. Rebrand surface

**4 user-visible strings** — the AI-draft disclaimer "Sent via WineOps AI — This
message was generated with AI assistance." shown in email previews and appended to
outbound mail: `pages/Orders.tsx:430,1039,3457,3535`. Plus shared layout chrome
(see dashboard.md §7).

## 8. State & config

- `VITE_API_GATEWAY_URL` (`Orders.tsx:60`) — one call uses raw axios against it (:684).
- Realtime order updates via `useRealtimeDispatch` (`Orders.tsx:49`).
- Table export via `ExportMenu`/`exportTable` (`Orders.tsx:56-57`).
- Draft-email guardrails are server-side; the page only stages one-tap approvals
  (memory: autonomous-email-replies — never auto-send).

## 9. Gaps

- `v3.0-TECH-DEBT.md:495` — UX-catalog claim that `ActiveConversationsPanel` is
  unreachable is **stale**; `Orders.tsx:1512` sets its open state.
- The delivered-order booking path posts to `/inventory/add-from-order` with raw
  axios instead of `apiClient` (`Orders.tsx:684`) — skips the client's auth/refresh
  interceptors; works only because a token header is attached manually.
- 3,614 lines in one file; the co-located `pages/orders/` split is partial.
