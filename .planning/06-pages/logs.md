---
type: page
route: /logs
slug: logs
component: apps/web/src/pages/LogsTimelinePage.tsx
audience: owner
tier: core
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[simpos-order-log]]"]
---

# /logs

## Surface — buttons → where they go

- (no outbound navigation — dead-end page)

## 1. Purpose
Read-only correlated timeline for the active restaurant across six sources: POS checks, agent decisions, stock movements, procurement documents, audit log, and (when filtered) the event store (`LogsTimelinePage.tsx:1-3,14-20`). Filter by correlation id via `?correlationId=` or the search box; clicking any event's correlation id pivots the whole timeline onto that thread (`LogsTimelinePage.tsx:171-179`). This is the "show your working" surface for anything an agent did to inventory.

## 2. Entry
Sidebar "Logs" entry (`Sidebar.tsx:136-141`) — **[PAGE_MAP](../foundation/PAGE_MAP.md) lists `/logs` as having no inbound link; that is stale**, the sidebar link exists. Deep-linkable with `?correlationId=` (the intended cross-page pivot from notifications/documents).

## 3. Files
- Route binding: `apps/web/src/App.tsx:283` (lazy, `App.tsx:98`)
- `apps/web/src/pages/LogsTimelinePage.tsx` (195 lines, self-contained)

## 4. Endpoints
| Method | Path | Where called | Atlas |
|---|---|---|---|
| GET | `/logs/timeline/:restaurantId?correlationId=&limit=100` | `LogsTimelinePage.tsx:53` | ENDPOINTS.md:276 |

## 5. Signals
**none.** (The page *reads* signals; it emits none of its own.)

## 6. Tier cut
Core observability over S04 (POS → inventory depletion) and S09 (webhook drops/desyncs) — it is the page where a desync is *seen*. Also the WineOps-side counterpart of the SimPOS order log (`SimposOrderLogPage.tsx:2-3` names the distinction).

## 7. Rebrand surface
**0** user-visible WineOps strings.

## 8. State & config
- Requires `activeRestaurantId` from auth context — query disabled without it (`LogsTimelinePage.tsx:68`).
- `limit` hard-coded to 100 (`LogsTimelinePage.tsx:54`); no pagination.

## 9. Gaps
- No pagination/infinite scroll — the 101st event is invisible.
- Query error state renders the same as empty ("No events") — `query.isError` is never branched (`LogsTimelinePage.tsx:143-150`), so a 500 looks like a quiet restaurant.
- No links *from* events to their subject pages (document, order, wine) — the timeline is a dead end; you can pivot within it but not out of it.
