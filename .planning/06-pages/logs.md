---
type: page
route: /logs
slug: logs
softwares: [reports-analytics]
component: apps/web/src/pages/LogsTimelinePage.tsx
audience: owner
tier: core
archetype: list+detail # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-09-03
links: ["[[PAGE-CONTRACT]]", "[[simpos-order-log]]", "[[0086-a-count-confesses-what-it-could-not-count]]"]
---

# /logs

> **Part of** [[08-softwares/reports-analytics|Reports & Analytics]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- (no outbound navigation — dead-end page)

## 1. Purpose
Read-only correlated timeline for the active restaurant across six sources: POS checks, agent decisions, stock movements, procurement documents, audit log, and (when filtered) the event store (`LogsTimelinePage.tsx:1-35,45-51`). Filter by correlation id via `?correlationId=` or the search box; clicking any event's correlation id pivots the whole timeline onto that thread (`LogsTimelinePage.tsx:363-376`). This is the "show your working" surface for anything an agent did to inventory.

## 1a. Features
- Read-only correlated timeline across six sources: POS checks, agent decisions, stock movements, procurement documents, audit log, event store
- Search or deep-link by correlation id (`?correlationId=`)
- Click any event's correlation id to pivot the whole timeline onto that thread
- Names, in words, any source the gateway could not read — and shows `—` rather than a count for it (ADR 0086)
- States which registers were read at all, so a deliberate skip (`event_store` without a correlation id) is stated rather than inferred
- Renders an undated event as `—`, never as "Invalid Date"
- 🚧 No pagination (first 100 events only)

## 2. Entry
Sidebar "Logs" entry (`Sidebar.tsx:136-141`) — **[PAGE_MAP](../foundation/PAGE_MAP.md) lists `/logs` as having no inbound link; that is stale**, the sidebar link exists. Deep-linkable with `?correlationId=` (the intended cross-page pivot from notifications/documents).

## 3. Files
- Route binding: `apps/web/src/App.tsx:283` (lazy, `App.tsx:98`)
- `apps/web/src/pages/LogsTimelinePage.tsx` (390 lines, self-contained)
- `apps/web/src/pages/LogsTimelinePage.test.tsx` — the honesty contracts of
  §10: a failed source is named and shows `—`, a skipped source says so, an
  undated row renders `—`, a source this file has not mirrored still shows a
  label and is counted by the same list the chips come from, and a gateway that
  reports neither field makes the page claim nothing. Six of the seven fail
  against their own pre-fix page; the seventh passes on both by design, because
  it pins what the page must *not* start saying

## 4. Endpoints
| Method | Path | Where called | Atlas |
|---|---|---|---|
| GET | `/logs/timeline/:restaurantId?correlationId=&limit=100` | `LogsTimelinePage.tsx:144-145` | ENDPOINTS.md:276 |

## 5. Signals
**none.** (The page *reads* signals; it emits none of its own.)

## 6. Tier cut
Core observability over S04 (POS → inventory depletion) and S09 (webhook drops/desyncs) — it is the page where a desync is *seen*. Also the WineOps-side counterpart of the SimPOS order log (`SimposOrderLogPage.tsx:2-3` names the distinction).

## 7. Rebrand surface
**0** user-visible WineOps strings.

## 8. State & config
- Requires `activeRestaurantId` from auth context — query disabled without it (`LogsTimelinePage.tsx:159`).
- `limit` hard-coded to 100 (`LogsTimelinePage.tsx:145`); no pagination.
- `TimelineEvent` / `TimelineResponse` are **restated** on the page
  (`LogsTimelinePage.tsx:45-72`), not imported: the web app has no import path
  into the gateway. They mirror
  `apps/api-gateway/src/logs/logs-timeline.service.ts` and have to be kept in
  step by hand — the only thing that notices drift today is
  `LogsTimelinePage.test.tsx`.
- Drift is made **visible rather than silent**: a source the gateway names and
  this file has not mirrored gets a chip, a count and an event badge carrying
  its raw key (`:112-127`), because a label lookup that returns `undefined`
  renders an **empty badge** — an unknown printed as nothing, one field below
  the fault this page exists to fix. The chip row and the register tally are
  driven by the same `displaySources` list (`:190-193,288,322`), so they cannot
  disagree about how many registers there are.

## 9. Gaps
- No pagination/infinite scroll — the 101st event is invisible, and nothing on
  the page says the feed is a window.
- No links *from* events to their subject pages (document, order, wine) — the
  timeline is a dead end; you can pivot within it but not out of it.
- `/logs` is **not** a `PAGES` entry in `scripts/check_windowed_figures.py`, so
  it is **outside that guard's declared scope** — not unguarded by oversight.
  The distinction matters and the guard's own header states it: a page absent
  from `PAGES` is not checked and the guard makes *no claim* about it. The risk
  is therefore not a silent hole but a misread — someone taking a green run as
  covering the whole app. Nothing mechanical holds this page's "every count
  below is a floor" sentence, the `| null` on `occurredAt`, or the optionality
  of `failedSources`; `LogsTimelinePage.test.tsx` is the only thing standing on
  them. Tracked as an executable claim rather than prose:
  `CLAIMS.jsonl` carries an `open` entry for `ADR-0086` whose verify greps
  `name="/logs"` in the guard — so the day anyone registers the page, the claims
  guard goes red and forces this bullet to be struck in that same change.
  That inversion only works because the closing has a **predictable and unique
  signature**; the floor-marker half below has neither, and is deliberately left
  as prose.

**Closed on `main`** (ADR 0086, `LogsTimelinePage.test.tsx`): a whole-request
failure no longer renders as "No events", an undated row renders `—` instead of
"Invalid Date", and a failed source is named rather than counted as zero. All
three merged in **PR #262** (`4d0f6c50`, 2026-09-02) alongside the gateway
change that makes the third reportable. PR #253 carried this work first and was
**closed unmerged**; #262 rebased and carried it, so a reference to #253
anywhere is a reference to a branch that will never land.

- **Intelligence lens 2026-09-03 (`v3.0-TECH-DEBT.md`, customer + intelligence lens):** the Stock register reads 56 against 55 `wine_consumption_log` rows — one row unexplained, not chased.

## 10. Maturity

> **On `main` since `4d0f6c50` (PR #262, 2026-09-02).** Both halves — ADR 0086's
> `sourcesQueried` / `failedSources` on the endpoint
> (`logs-timeline.service.ts:66-69,123-128`) and this page reading them
> (`LogsTimelinePage.tsx:172-201`) — merged together. This section was written on
> the branch and said "nothing here is on `main` yet"; it was left saying so
> through the merge, which is the DOC-STALE shape §9's executable claim exists to
> avoid. The page is still written to survive meeting an **old** gateway — see
> the closing note of this section. That is a deploy-skew property, not a
> merge-order one, and it outlives the merge.

**partial.** Everything it renders is real, and as of 2026-09-02 the failure
modes are said in words rather than rendered as a smaller number. What remains
partial is the window: the feed is still capped at 100 with nothing on the page
admitting it.

The endpoint is genuine and JWT-guarded (`apps/api-gateway/src/logs/logs.controller.ts:21,26`)
and the service really does fan out over six tables
(`logs/logs-timeline.service.ts:103-115`). Five are restaurant-scoped; the sixth,
`event_store`, is not restaurant-scoped at all and is therefore returned **only**
when a correlation id is supplied, with the reasoning written down
(`:109-114,323-328`) — a deliberate, correct constraint. Since ADR 0086 that skip
is reported as a skip: the slot resolves to `null` rather than to an empty result,
so `sourcesQueried` can tell "read and found nothing" from "not read".

Three things used to be absent, each rendering as silence rather than as a
message. Two are now said out loud; the third is not:

| Gap | State | Evidence |
|---|---|---|
| A per-source failure is invisible | **Fixed** (PR #262) | Every fetch now goes through one `guard()` that names the failure instead of swallowing it (`logs-timeline.service.ts:131-145`), and the response carries `sourcesQueried` / `failedSources` (`:123-128`). The page names the failed registers in a banner, renders their chips as `—` rather than a fabricated `0`, and states how many were read at all (`LogsTimelinePage.tsx:172-201,267-326`) |
| A whole-request failure is invisible | **Fixed** (PR #262) | `query.isError` is branched: a red banner says the timeline could not be read, and the feed reads "The timeline is unavailable" rather than "No events" (`LogsTimelinePage.tsx:200,253-265,334-337`). Page-side only — it needs no gateway change |
| The 101st event does not exist | **Open** | `limit: 100` hard-coded (`:145`), server caps at 200 (`logs-timeline.service.ts:99`), and the merge slices *after* concatenating every source it read (`:118-121`) — so a busy source can crowd the others out of the window entirely. Nothing on the page marks the feed as a window |

**What the fix does not do, stated plainly:** `failedSources` and
`sourcesQueried` are typed **optional** on the page (matching
`useSortingOfficeData.ts:83-84`), because a gateway that does not send them has
told it nothing — and nothing is not "all six were fine". Against such a gateway
the page renders exactly as it did before: counts, no banner, no register line.
This is not merge-order caution, which the rebase settled; it is **deploy skew**.
The SPA and the gateway ship separately, so a new page meets an old gateway during
any rolling deploy, and writing `failedSources ?? []` there would turn "the
gateway did not say" into "nothing failed" — this ADR's own fault, one layer up.
The honesty here is therefore only ever as good as the gateway behind it, and the
page is built to say so by staying quiet rather than by guessing.

The dead-end observation in §9 is confirmed: the file contains no `Link`, no
`navigate`, and `useSearchParams` is used only to set `correlationId`
(`LogsTimelinePage.tsx:152,205-206,244,370`). You can pivot within the timeline, never out of it.

- **Intelligence lens 2026-09-03 (`v3.0-TECH-DEBT.md`, customer + intelligence lens):** the one surface that states what it did not read on the page itself ("Read 5 of 6 registers · not read: the event store"); POS 44 = `pos_checks` exactly, Agent 0 correct with the orchestrator down.

## 11. Data flow

### Calls out

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `/logs/timeline/:restaurantId?correlationId=&limit=100` | JWT (class, `logs.controller.ts:21`) | `:26` → `logs-timeline.service.ts:95-129` | `{events[], correlationId, sourcesQueried[], failedSources[]}` — merged, source-tagged, newest first with undated rows last, by the `newestFirst` comparator at `:82-87` (ADR 0086) |

(That four-field response landed with PR #262; see the note at the head of §10.)

`occurredAt` is `string | null` on both sides: `procurement_documents.created_at`
and `system_audit_log.created_at` are nullable in the baseline, so an undated
event is a real row, not a bug. The gateway returns it and sorts it last; the
page renders it as `—` (`LogsTimelinePage.tsx:129-134,361`).

Note the `restaurantId` is taken from the **URL path**, not the JWT
(`LogsTimelinePage.tsx:144`, controller `:26`), unlike `/reports` and `/procurement/*`
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
| Loading | Yes | `:330-333` |
| Empty | Yes, and no longer overloaded | `:338-343` — and it says "No events from the registers that could be read" when some register failed |
| Error (whole request) | Yes | `:253-265` banner + `:334-337` feed body |
| Error (one source) | Yes (PR #262, both halves) | `:267-284` banner naming the sources, `:286-316` chips as `—`, `:318-326` the register tally |
| Permission-denied | **Partially** | A 401/403 now reaches the whole-request banner rather than "No events", but the banner says the timeline could not be read — it does not say *why*, so a permissions problem still reads as an outage |

**Where the UI misleads**

1. ~~Source chips render `sources[s] ?? 0` — a source that failed and a source with
   nothing to report are the same `0`.~~ **Fixed** — a failed source renders `—`
   and is named in the banner; a source that was not queried renders `—` too
   (`:286-316`). Against an **older** gateway that reports neither field the
   chips still read `0`, deliberately, because the page has not been told
   otherwise — see the closing note of §10.
2. ~~"No events" is the answer to a broken query, an unauthorised query, and a
   quiet Tuesday.~~ **Fixed** for the broken query; an unauthorised one is now
   an outage message rather than a silence, which is better and still not right.
3. **Still true:** no indication that the feed is truncated at 100. Every other
   count on the page can now say it is a floor; the feed itself cannot.

## 13. Roadmap

1. ~~**Distinguish failure from silence**~~ — **done 2026-09-02** (ADR 0086),
   both halves: the service returns
   `sourcesQueried` / `failedSources` instead of catching to `[]` in silence, and
   the page branches `query.isError`, names the failed registers, and renders an
   undated row as `—`. **Merged to `main` in PR #262** (`4d0f6c50`); PR #253,
   which carried it first, was closed unmerged.
2. **Mark the window.** `limit: 100` with no `≥` anywhere is now the page's last
   unlabelled number, and the one gap in §9 that a guard could hold: add `/logs`
   as a `PAGES` entry in `scripts/check_windowed_figures.py` at the same time,
   so the floor mark and the `| null` on `occurredAt` stop resting on one test
   file.
3. **Link out of the timeline**: `procurement_documents` → `/receipts`,
   `inventory_transactions` → `/inventory`, `pos_checks` → `/simpos/order-log`. §9's
   third gap.
4. **Link in**: notifications, receipts and orders should carry
   `?correlationId=` here. §2 already calls this the intended pivot; nothing
   produces the link.
5. Cursor pagination (`:145`) — the real fix behind item 2's marker.
6. Take `restaurantId` from the JWT rather than the path, matching the rest of the
   gateway.
7. Share the response type rather than restating it (§8). Until then the page and
   `logs-timeline.service.ts` drift silently apart.
