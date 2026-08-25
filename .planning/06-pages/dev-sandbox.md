---
type: page
route: /dev-sandbox
slug: dev-sandbox
component: apps/web/src/pages/DevSandbox.tsx
audience: dev
tier: core
signals_today: none
rebrand_strings: 5
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]"]
---

# /dev-sandbox

## 1. Purpose
Manual test bench for frontend-only behaviors: fire each toast variant, simulate POS sales and stock changes (live/shadow), trigger threshold alerts, dispatch realtime events (`dispatchInventoryUpdate`, `dispatchCalendarEvent` via `RealtimeContext`, `DevSandbox.tsx:87`), enqueue OneTap actions, and inspect/clear the app's `wineops_*` localStorage keys (`DevSandbox.tsx:440-457`).

## 2. Entry
**No inbound in-app link** — cold URL only, per [PAGE_MAP](../foundation/PAGE_MAP.md) entry-points list and grep (no component links to `/dev-sandbox`).

## 3. Files
- Route binding: `apps/web/src/App.tsx:298` (lazy, `App.tsx:114`, under "Dev/Test Pages")
- `apps/web/src/pages/DevSandbox.tsx` (469 lines)
- Feeds off: `contexts/ToastContext`, `contexts/RealtimeContext`, static `data/wineData` (`DevSandbox.tsx:32-35`)

## 4. Endpoints
**none.** Zero network calls (grep of `DevSandbox.tsx` for fetch/axios/apiClient) — everything is toast/context/localStorage-local. Honest consequence: it exercises the UI's *reaction* to events, never the backend paths that produce them.

## 5. Signals
**none.**

## 6. Tier cut
Dev-only; no `S..` touches it (OD-48). Not to be confused with SimPOS (which does hit the backend) — this page fakes events client-side.

## 7. Rebrand surface
- `DevSandbox.tsx:442-445` — rendered list of localStorage keys `wineops_pending_actions`, `wineops_shadow_stock`, `wineops_orders_history`, `wineops_storage_locations`
- `DevSandbox.tsx:451` — confirm dialog "Clear all local WineOps data? This cannot be undone."
(The keys themselves at `:452-456` are code-facing; renaming them is a data-migration, not a string swap.)

## 8. State & config
- No env vars, no flags. **Ships in production builds** — nothing gates the route or the lazy chunk on `import.meta.env.DEV`.

## 9. Gaps
- Available to any authenticated user in production (`App.tsx:298` inside plain `ProtectedRoute`); its realtime dispatches mutate shared UI state (notifications, OneTap queue) on a real account. Should be dev-gated the way `SimposModule` now is server-side (main `app.module.ts:87`).
- Uses static `wineLibrary` fixture data (`DevSandbox.tsx:34,90`), so its "wines" drift from the tenant's actual inventory.
