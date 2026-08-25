---
type: page
route: /
slug: dashboard
component: apps/web/src/pages/Dashboard.tsx
audience: owner
tier: core
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[reports]]", "[[inventory]]", "[[orders]]", "[[calendar]]", "[[wines]]"]
---

# / — Dashboard

## Surface — buttons → where they go

- **KPI card: Revenue** → [[reports]] `/reports` (its modal's "Full report" → `/reports?focus=revenue`)
- **KPI card: Inventory** → [[inventory]] `/inventory`
- **KPI card: Orders** → [[orders]] `/orders`
- **KPI card: Low stock** → [[inventory]] `/inventory?filter=low`
- **Reorder / Reorder selected** → [[orders]] `/orders?draft=new&…`
- **Low-stock row** → [[inventory]] `/inventory?highlight=…`
- **Calendar strip day / Add Event / important date** → [[calendar]] `/calendar?date=…` / `?openModal=true`
- **Recent order row / View all** → [[orders]] `/orders?orderId=…`
- **Top wine row** → [[wines]] `/wines?search=…` or `?wineId=…`
- **Reports View all** → [[reports]] `/reports`
- **Quick Actions panel** → user-configured shortcuts (any internal route or external URL)

## 1. Purpose

The owner/manager landing page: today's KPIs (revenue, stock, orders, alerts), a
reminders list, a calendar strip with important dates, recent activity, and the
One-Tap Action Center for approvals and low-stock reorders. Sidebar tooltip says it
plainly: "Today's KPIs, alerts, and the actions worth doing first"
(`apps/web/src/components/layout/Sidebar.tsx:63`).

## 2. Entry

Most-linked page after `/login` — in-degree 5 ([PAGE_MAP](../foundation/PAGE_MAP.md):139):
from `/admin`, `/get-started`, `/invite/:code`, `/onboarding`, `/register`. Also:

- Sidebar "Dashboard" (`apps/web/src/components/layout/Sidebar.tsx:60-64`).
- Catch-all `*` redirects here (`apps/web/src/App.tsx:302`), so every bad URL lands on it.
- One of four eagerly-loaded pages — not lazy (`apps/web/src/App.tsx:63`).

## 3. Files

- Route binding: `apps/web/src/App.tsx:254`.
- `apps/web/src/pages/Dashboard.tsx` (1,849 lines) — view.
- `apps/web/src/pages/dashboard/useDashboardPage.ts` + `index.tsx` — page hook (data shaping, calendar revenue).
- Key co-located renders: `components/notifications/OneTapActionCenter.tsx` (Dashboard.tsx:477),
  `components/dashboard/QuickActionsPanel.tsx` (:482), `components/dashboard/AddImportantDateModal.tsx` (:1838),
  `components/ui/ContextMenu.tsx` (six mounts, :1570-1802).
- Data hooks: `hooks/useDashboardData.ts`, `hooks/useInventoryData.ts`, `hooks/useOrdersMetrics.ts`,
  `data/manualImportantDates.ts` (Dashboard.tsx:41-56).

## 4. Endpoints

All via `apiClient` (base `${VITE_API_GATEWAY_URL}/api/v1`, `services/api/client.ts:51`)
unless noted. Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):197 (`dashboard`, 8 —
atlas's **⚠ all unguarded** is stale; guarded at class level since 2026-08-25 (#60),
`apps/api-gateway/src/dashboard/dashboard.controller.ts:51`),
:87 (`calendar`), :249 (`inventory`), :389 (`procurement`), :663 (`wines`).

| Method | Path | Call site |
|---|---|---|
| GET | `/dashboard/stats/:id`, `/dashboard/activity/:id`, `/dashboard/alerts/:id` | `hooks/useDashboardData.ts:74-79` → `services/api/dashboard.ts:23,70,87` |
| GET | `/dashboard/sales-chart/:id` | `hooks/useDashboardData.ts:205` → `services/api/dashboard.ts:109` |
| GET | `/dashboard/calendar-revenue/:id` | `pages/dashboard/useDashboardPage.ts:227` → `services/api/dashboard.ts:227` |
| GET | `/calendar/events` | `useCalendarEvents` (useDashboardPage.ts:7) → `services/api/calendar.ts:221` |
| GET | `/wines` | `useWines` → `services/api/wines.ts:30` |
| GET | `/inventory/:id` + `/low-stock` + `/summary` | `hooks/useInventoryData.ts:15` → `services/api/inventory.ts:66,118,129` |
| GET | `/procurement/orders/pending` (+ list) | OneTapActionCenter.tsx:45 → `services/api/orders.ts:206,217` |
| GET | `/api/v1/calendar/ical-token` | **relative `fetch`**, `pages/Dashboard.tsx:267` — see §9 |

## 5. Signals

**None.** No `uxSignals` import anywhere in the tree; the client reporter ships dark
(`VITE_UX_OPTIMIZER` gate, `apps/web/src/lib/uxSignals.ts:15`) and its only consumer,
`hooks/useUxOverrides.ts`, is imported by no page. Guidance's `trackGuidance` pushes
to a `window.dataLayer` that is never bootstrapped (`guidance/analytics.ts:29-39`; no
GTM in `index.html`) — dev-console only.

## 6. Tier cut

**Core** — operate ([TIER-MAP](../03-scenarios/TIER-MAP.md):10). Scenario surface:
S10 (low-stock alerts land here as one-tap reorders) and S15 (the in-app digest panel
is the owner's landing experience). Both are ✅-Core rows in the matrix (TIER-MAP:46,51).

## 7. Rebrand surface

Page tree: **0** user-visible strings. Reachable-but-shared:

- One-tap email modal shows "WineOps AI" branding in preview/sent HTML —
  `components/emails/QuickGmailModal.tsx:129,145,153,189,200` (opened from OneTapActionCenter).
- Layout chrome on every DashboardLayout page: "WineOps AI" wordmark
  (`components/layout/Sidebar.tsx:484`), aria-label (`:469`), BrandMark alt (`components/brand/BrandMark.tsx:17`).
- Not visible: localStorage keys `wineops_*` (`OneTapActionCenter.tsx:80-83`).

## 8. State & config

- `VITE_API_GATEWAY_URL` for all API calls; `VITE_UX_OPTIMIZER` (dark, §5).
- One-tap actions, shadow stock, order history, snoozes persist in localStorage
  (`OneTapActionCenter.tsx:80-83`).
- Realtime: `useRealtimeDispatch` calendar-event payloads (`Dashboard.tsx:46`).
- Restaurant switching via `useAuthStore`/`useRestaurantSettingsStore` (`Dashboard.tsx:50`).

## 9. Gaps

- `pages/Dashboard.tsx:267` fetches `'/api/v1/calendar/ical-token'` **relative to the SPA
  origin**, bypassing `VITE_API_GATEWAY_URL` — works only where the web host proxies the
  gateway; every other page uses the absolute base (e.g. `pages/Settings.tsx:159`).
- All 8 `dashboard` endpoints are guarded since 2026-08-25 (#60) — `@UseGuards(JwtAuthGuard)`
  at class level (`apps/api-gateway/src/dashboard/dashboard.controller.ts:51`); the atlas
  row ([ENDPOINTS](../foundation/ENDPOINTS.md):197) still reads "unguarded" and is stale.
- `v3.0-TECH-DEBT.md:502` — dashboard profile card dead-click claim (L102) is *unverified,
  not confirmed*; the one-tap auth hole it fed is closed (`v3.0-TECH-DEBT.md:409`).
