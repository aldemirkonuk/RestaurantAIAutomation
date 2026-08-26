---
type: page
route: /logs
slug: logs
component: apps/web/src/pages/LogsTimelinePage.tsx
audience: owner
tier: core
archetype: list+detail # proposed 2026-08-26 (OD-79)
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[simpos-order-log]]"]
---

# /logs

## Surface — buttons → where they go

- (no outbound navigation — dead-end page)

## 1. Purpose
Read-only correlated timeline for the active restaurant across six sources: POS checks, agent decisions, stock movements, procurement documents, audit log, and (when filtered) the event store (`LogsTimelinePage.tsx:1-3,14-20`). Filter by correlation id via `?correlationId=` or the search box; clicking any event's correlation id pivots the whole timeline onto that thread (`LogsTimelinePage.tsx:171-179`). This is the "show your working" surface for anything an agent did to inventory.

## 1a. Features
- Read-only correlated timeline across six sources: POS checks, agent decisions, stock movements, procurement documents, audit log, event store
- Search or deep-link by correlation id (`?correlationId=`)
- Click any event's correlation id to pivot the whole timeline onto that thread
- 🚧 No pagination (first 100 events only); errors render like an empty timeline

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

## 10. Maturity

**partial.** Everything it renders is real; the failure modes are all invisible.

The endpoint is genuine and JWT-guarded (`apps/api-gateway/src/logs/logs.controller.ts:21-26`)
and the service really does fan out over six tables
(`logs/logs-timeline.service.ts:48-72`). Five are restaurant-scoped; the sixth,
`event_store`, is not restaurant-scoped at all and is therefore returned **only**
when a correlation id is supplied, with the reasoning written down
(`:275-284`) — a deliberate, correct constraint.

Three things are absent, and each one renders as silence rather than as a message:

| Gap | Evidence |
|---|---|
| A per-source failure is invisible | Every fetcher wraps its query in `try/catch`, logs a `warn`, and returns `[]` (e.g. `:96-97`, `:305-307`). If `pos_checks` breaks, the timeline loses POS rows and says nothing. The source-count chips (`LogsTimelinePage.tsx:130-138`) then show `POS 0` — a fabricated zero |
| A whole-request failure is invisible | `query.isError` is never branched (`LogsTimelinePage.tsx:143-150`) — a 500 renders "No events", identical to a quiet restaurant. §9 recorded this; confirmed |
| The 101st event does not exist | `limit: 100` hard-coded (`:54`), server caps at 200 (`logs-timeline.service.ts:51`), and the merge slices *after* concatenating all six sources (`:75`) — so a busy source can crowd the others out of the window entirely |

The dead-end observation in §9 is confirmed: the file contains no `Link`, no
`navigate`, and `useSearchParams` is used only to set `correlationId`
(`LogsTimelinePage.tsx:61,80-81`). You can pivot within the timeline, never out of it.

## 11. Data flow

### Calls out

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `/logs/timeline/:restaurantId?correlationId=&limit=100` | JWT (class, `logs.controller.ts:21`) | `:26` → `logs-timeline.service.ts:40-78` | `{events[], correlationId}` — merged, source-tagged, newest first |

Note the `restaurantId` is taken from the **URL path**, not the JWT
(`LogsTimelinePage.tsx:53`, controller `:26`), unlike `/reports` and `/procurement/*`
which read it from `@CurrentUser()`. Worth a look during the tenancy pass; not
asserted as a hole here.

### Fed by

| Source | Producer | Live? |
|---|---|---|
| `pos_checks` | Toast webhook + SimPOS ingestion (memory: pos-bridge-state — bridge built and proven) | Yes, where a POS is connected |
| `decision_log` | Python agents via `BaseAgent.log_decision` (`services/agent-orchestrator/core/base_agent.py:785-787`) | Yes |
| `inventory_transactions` | `apply_stock_movement` — correlation id lives in `metadata->>'correlation_id'`, not a column (`logs-timeline.service.ts:8-11`) | Yes |
| `procurement_documents` | `@Cron("*/5 * * * *")` intake sweep (`procurement/documents/document-intake.service.ts:581`), which stamps one correlation id **per attachment** precisely so these rows are not NULL (`:626-632`) | Yes |
| `system_audit_log` | Gateway audit writes | Yes |
| `event_store` | RabbitMQ event persistence | Yes, correlation-filtered only |

This page is the only surface in the product that reads any of these six tables.
It is the payoff for the P1 correlation-id instrumentation.

### Writes

| Write | Downstream reaction |
|---|---|
| **none** — read-only by design (`LogsTimelinePage.tsx:1-3`) | — |

## 12. Design intent

**Should be:** "show your working" — the answer to *why did stock change / why did
the agent do that*, reachable in one click from the thing that surprised you.

| State | Handled? | Evidence |
|---|---|---|
| Loading | Yes | `:143-147` |
| Empty | Yes, but overloaded | `:148-150` also stands in for every error |
| Error | **No** | `query.isError` unbranched; per-source failures swallowed upstream |
| Permission-denied | **No** | A 401/403 falls into the same "No events" |

**Where the UI misleads**

1. Source chips render `sources[s] ?? 0` (`:136`) — a source that failed and a source
   with nothing to report are the same `0`.
2. "No events" is the answer to a broken query, an unauthorised query, and a quiet
   Tuesday.
3. No indication that the feed is truncated at 100.

## 13. Roadmap

1. **Distinguish failure from silence** — branch `query.isError`, and have the
   service return per-source status alongside the events instead of `[]`
   (`logs-timeline.service.ts:96,307`). This is the whole point of an observability
   page.
2. **Link out of the timeline**: `procurement_documents` → `/receipts`,
   `inventory_transactions` → `/inventory`, `pos_checks` → `/simpos/order-log`. §9's
   third gap.
3. **Link in**: notifications, receipts and orders should carry
   `?correlationId=` here. `LogsTimelinePage.tsx:25` already calls this the intended
   pivot; nothing produces the link.
4. Cursor pagination, or at minimum a "showing the most recent 100" marker
   (`:54`).
5. Take `restaurantId` from the JWT rather than the path, matching the rest of the
   gateway.
