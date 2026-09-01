---
type: page
route: /dev-sandbox
slug: dev-sandbox
softwares: [admin-health-sw]
component: apps/web/src/pages/DevSandbox.tsx
audience: dev
tier: core
archetype: dev # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 5
maturity: complete
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]"]
---

# /dev-sandbox

> **Part of** [[08-softwares/admin-health|Admin & Health]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Toast / POS-sim / inventory / OneTap / calendar-report triggers** → (fire local events on this page)
- **Clear All Local Data** → clears `wineops_*` localStorage keys, then full page reload
- (no outbound navigation — dead-end page)

## 1. Purpose
Manual test bench for frontend-only behaviors: fire each toast variant, simulate POS sales and stock changes (live/shadow), trigger threshold alerts, dispatch realtime events (`dispatchInventoryUpdate`, `dispatchCalendarEvent` via `RealtimeContext`, `DevSandbox.tsx:87`), enqueue OneTap actions, and inspect/clear the app's `wineops_*` localStorage keys (`DevSandbox.tsx:440-457`).

## 1a. Features *(dev test bench — frontend-only, no backend calls)*
- Fire every toast variant to check styling
- Simulate POS sales and stock changes (live and shadow)
- Trigger threshold alerts
- Dispatch realtime events (inventory update, calendar event) into the running UI
- Enqueue One-Tap actions
- Inspect and clear the app's local-storage keys

## 2. Entry
**No inbound in-app link** — cold URL only, per [PAGE_MAP](../foundation/PAGE_MAP.md) entry-points list and grep (no component links to `/dev-sandbox`).

## 3. Files
- Route binding: `apps/web/src/App.tsx:303` (lazy, `App.tsx:114`, under "Dev/Test Pages")
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
- ~~Available to any authenticated user in production~~ — **partly closed.** `App.tsx:303` now carries `requiredRole="owner"` (landed 2026-08-24, `fc340b7d`), so it is owner/manager-only (`ProtectedRoute.tsx:62-65`). It still **ships in production builds** — unlike [[simpos-terminal]], whose route is `import.meta.env.PROD`-gated (`App.tsx:218`), and unlike `SimposModule`, which is `NODE_ENV`-gated server-side (`app.module.ts:89`).
- Its realtime dispatches mutate shared UI state (notifications, OneTap queue) on a real account.
- Uses static `wineLibrary` fixture data (`DevSandbox.tsx:34,90`), so its "wines" drift from the tenant's actual inventory.

---

## 10. Maturity — **complete**, for what it claims to be

Rare in this cluster: the page does exactly what it says, and says exactly what it does.

- It claims to be a **frontend** bench — "A comprehensive testing environment for manually
  triggering: toast notifications, POS/sales simulations, stock changes, inventory
  threshold alerts, reports refresh, OneTap action triggers" (`DevSandbox.tsx:1-11`) — and
  every one of those triggers works, because every one is client-side.
- **Zero network calls.** Grepping `DevSandbox.tsx` for fetch/axios/apiClient returns
  nothing; the imports are `ToastContext`, `RealtimeContext`, static `data/wineData` and
  `addOneTapAction` (`:32-35`). There is no backend to be broken.
- **It discloses its own blast radius** in a banner at the top of the page: *"Development
  Only — This page is for testing purposes. Actions here will affect local data and
  trigger real UI updates."* (`:328-335`). That second clause is true and non-obvious, and
  stating it is what earns the verdict.
- The one real risk is unchanged: it is in the production bundle (`App.tsx:303`, no
  `import.meta.env.PROD` guard, no `DEV`-only lazy import at `App.tsx:114`) and an owner
  or manager can open it on a live account. Its writes then land in keys the real app
  reads — `wineops_shadow_stock` and `wineops_pending_actions` are the OneTap Action
  Center's own storage keys (`components/notifications/OneTapActionCenter.tsx:80-81`).
  That is a **deployment** gap, not a page-behaviour gap, which is why the verdict is
  complete rather than partial.
- Fixture drift is likewise disclosed rather than hidden: the Data Inspector prints
  "Wine Library: {n} wines" from the static fixture (`:438-439`), so the numbers on screen
  visibly are not the tenant's.

## 11. Data flow

**Calls out**

**None.** Zero endpoints — the only page in this batch with a genuinely empty §4, and by
design. Everything is context dispatch or `localStorage`.

**Fed by**

| Source | Where | Note |
|---|---|---|
| `data/wineData` static fixture | imported `:34`, read `:90,174,203,227,267,352-355,438-439` | Never refreshed, never tenant-scoped. `getLowStockWines(wineLibrary)` is the source for every "low stock" simulation |
| `ToastContext` | `:32,86` | The toast variants under test |
| `RealtimeContext` dispatchers | `:33,87` — `dispatchInventoryUpdate` (`:128,153`), `dispatchCalendarEvent` (`:296`) | The same channel the real POS/inventory paths use to notify the UI, which is why the effects are indistinguishable from real ones downstream |
| Existing `localStorage` | read at `:232` before merging shadow stock | So repeated runs accumulate rather than reset |

**Writes**

- `localStorage.wineops_shadow_stock` (`:241`) — **read by `OneTapActionCenter`**
  (`components/notifications/OneTapActionCenter.tsx:81`), i.e. it leaves this page.
- OneTap queue entries via `addOneTapAction` (`:179,206,246,270`) → persisted under
  `wineops_pending_actions` (`OneTapActionCenter.tsx:80`).
- Realtime events consumed by whichever page is mounted — inventory and calendar
  subscribers react as if a real event arrived.
- `window.dispatchEvent(new CustomEvent('reports_refresh_requested'))` (`:315`) — the
  Reports page listens for it.
- **Clear All Local Data** removes five `wineops_*` keys (`:452-456`) then reloads.
- Nothing server-side, nothing in Supabase, no ledger, no notification row.

## 12. Design intent

**Should be:** a developer's fastest path to "what does the UI do when X happens" —
without a POS, a webhook, or a seeded tenant. It is that, and its honest limit is that it
tests the *reaction*, never the path that produces the event.

| State | Implemented? | Evidence |
|---|---|---|
| Empty | **n/a** — the page has no data of its own to be empty of; the Data Inspector always has fixture counts (`:436-440`) |
| Loading | **n/a** — no async work anywhere |
| Error | **n/a** — nothing can fail; every action is a synchronous dispatch |
| Permission-denied | **yes** — `requiredRole="owner"` (`App.tsx:303`) → the shared "Access Denied" card (`ProtectedRoute.tsx:67-101`) |

The four states are honestly *inapplicable* here rather than missing — which is only
defensible because §4 is genuinely empty.

**Where the UI misleads**

Very little, and the banner covers most of it. Two residuals:

1. **"POS Simulation" implies the POS path.** The section (`:345-380`) dispatches a
   realtime inventory event; it does not touch PosHub, `pos_checks`, or a webhook. That
   whole path belongs to [[simpos-terminal]], and nothing on either page says so. A reader
   could reasonably believe they had exercised POS ingestion.
2. **Wine pickers list fixture wines by name** (`:352-355,385-388`) that may not exist in
   the tenant's inventory — the Data Inspector shows the counts but the dropdowns do not
   flag the wines as fictional.

## 13. Roadmap

1. **Gate the route on `import.meta.env.DEV`** the way [[simpos-terminal]] is gated
   (`App.tsx:218`), or drop the lazy import from the production chunk (`App.tsx:114`).
   The single item that matters — an owner clicking through this on a live account
   enqueues real OneTap actions and shadow stock (§11).
2. **Cross-reference [[simpos-terminal]] in the POS section** so the client-side/backend
   distinction is stated on the page, not only in this note.
3. Label the wine pickers as fixture data, or source them from the live catalogue.
4. Rebrand the five user-visible `wineops` strings (§7) if/when the brand migration runs;
   the storage keys at `:452-456` are a data migration, not a string swap, and should be
   sequenced with `OneTapActionCenter.tsx:80-81`.
