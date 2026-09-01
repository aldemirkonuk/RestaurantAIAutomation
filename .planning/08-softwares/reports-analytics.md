---
type: software
slug: reports-analytics
name: Reports & Analytics
division: intelligence-analytics
status: partial
tier: plus
routes: ["/reports", "/logs"]
pages: [reports, logs]
api_modules: [analytics, reports, logs]
agents: [reporting_agent, drift_agent]
owner_unit: ""
gap_reason: "Four charters own four pieces and each disclaims the others; `reports` is claimed by no charter at all"
updated: 2026-09-01
links: ["[[reports]]", "[[logs]]", "[[recommendations]]", "[[dashboard-home]]", "[[analytics-engine-charter]]", "[[observability-telemetry-plumbing-charter]]", "[[SOFTWARE-MAP]]"]
---

# Reports & Analytics

## §0 What it is

The understand layer. One screen arranges the numbers you care about into blocks you can
drag around and keep — spend, stock, seating, month-on-month comparisons — alongside
plain-language findings the system computed from your own data rather than guessed. A
second screen is the receipt for all of it: a single time-ordered trail of what happened
and what the system did about it, so any surprising number can be traced back to the
events behind it. Acting on those findings happens next door in [[recommendations]].

## §1 Features today

- Search or deep-link a correlation id, and pivot the whole trail onto one thread
- Read a time-ordered trail across six sources — POS checks, agent decisions, stock
  movements, procurement documents, audit log, event store
- Compare two periods; see a monthly reconciliation
- See KPI spotlight tiles and a headline findings bar
- See seating density and table performance
- Read engine findings in plain sentences, with act / hide / pin and goals
- Search those findings from a ⌘K palette
- Export the data tables
- Drag, resize and configure dashboard blocks; the layout is saved per user
- Browse a catalogue of report templates — *broken* (nothing generates a file; see §7)

## §2 Screens

- [[reports]] — the canvas; route `/reports` at `apps/web/src/App.tsx:290`, **not** behind
  `PageGate`. `apps/web/src/pages/Reports.tsx` (1,122 lines) plus
  `components/reports/organisms/{TopBar, HeadlineInsightsBar, EngineInsightsPanel,
  SeatingDensityPanel, DataTablesSection, AICommandPalette, MonthlyReconciliation}.tsx`
  and the `DashboardCanvas` / `EditToolbar` / `dashboardMeta` canvas layer.
- [[logs]] — the trail; route `/logs` at `App.tsx:315`, no gate.
  `apps/web/src/pages/LogsTimelinePage.tsx` (195 lines, self-contained).

The two do not link to each other. `/logs` has no outbound navigation at all.

## §3 Backend

Three modules, in three different divisions.

**`apps/api-gateway/src/analytics/`** — `@Controller("analytics")` at
`analytics.controller.ts:46`, **40 endpoints**, class-level `JwtAuthGuard` since #31.
**10,647 non-spec lines** across 39 files — the largest module in the gateway, and it
carries its own computation library:

- `engine/` — 11 non-spec modules (`finance`, `statistics`, `forecasting`, `risk`,
  `regression`, `linalg`, `association`, `comparisons`, `cost-basis`,
  `inventory-science`, `pricing-agility`, `vendor-price-consensus`) plus `index.ts`,
  each with a paired `.spec.ts`. Pure and DB-free by design.
- `insights/` — `insight-catalog.ts` (the `DIMENSION × MEASURE × COMPARATOR` candidate
  space, `INSIGHT_CANDIDATES` at `:547`), `insight-generator.service.ts`,
  `insight-verbalizer.ts`, `insight-scheduler.service.ts`.
- Services: `analytics`, `advanced-analytics`, `consultants`, `goals`, `table-analytics`,
  `recommendations`, `recommendation-actions`, `metric-registry.ts`.

Endpoints used by this software: `/metrics` (`:65`), `/financial/:rid` (`:92`),
`/inventory-science/:rid` (`:122`), `/risk/:rid` (`:157`), `/forecast/:rid` (`:175`),
`/insights/:rid` (`:243`), `/insight-prefs/:rid` (`:287,294`), `/table-performance/:rid`
(`:376`), `/goals/:rid` (`:435,447,467,487`), `/pos-revenue/:rid` (`:622`),
`/overview/:rid` (`:672`). The seven `/recommendations/*` routes (`:682-856`) belong to
[[recommendations]].

**`apps/api-gateway/src/reports/`** — `@Controller("reports")` at
`reports.controller.ts:29`, **10 endpoints** (`POST /generate` `:34`, `GET /` `:51`,
`GET /schedules` `:73`, `GET /:id` `:89`, `GET /:id/cross-file` `:106`, `PATCH /:id`
`:129`, `GET /:id/download` `:152`, `POST /schedule` `:181`, `DELETE /schedules/:id`
`:198`, `DELETE /:id` `:217`). **The `/reports` page calls none of them** — see §7.

**`apps/api-gateway/src/logs/`** — `@Controller("logs")` at `logs.controller.ts:22`,
**1 endpoint**: `GET /logs/timeline/:restaurantId` (`:26`), called at
`LogsTimelinePage.tsx:53`. `logs-timeline.service.ts` fans out over six tables (`:48-72`).

## §4 Automation

- **`insight-scheduler.service.ts:42`** — `@Cron(CronExpression.EVERY_HOUR)`, the
  manager-preference refresh across 10 categories. Live, in NestJS.
- **`drift_agent`** — live, but on a different track.
  `services/agent-orchestrator/agents/drift_agent.py` (708 lines) runs from Celery Beat as
  `drift.scan_sim_catalogs` (`jobs/celery_app.py:166`) and *also* subscribes to
  `system.schedule.drift_check` / `pos.catalog.changed` (`drift_agent.py:77-81`) — neither
  of which has a publisher. The Beat entry says so plainly: it runs *"independently of the
  RabbitMQ message bus so the scheduled scan still fires when the orchestrator is down"*
  (`jobs/drift_tasks.py:1-8`). Scope is SimPOS test restaurants only.
- **`reporting_agent`** — **dormant**. 935 lines, registered
  (`core/orchestrator.py:188`), subscribed to `reporting.generate_scheduled_report`,
  `reporting.generate_event_report`, `reporting.generate_on_demand_report`
  (`reporting_agent.py:126-131`). **All three routing keys have zero publishers** in
  `apps/` and `services/`. It is the missing half of the generation gap in §7: the worker
  exists, nothing dispatches to it.

## §5 Data

- `analytics` reads `pos_checks`, `procurement_orders`, `restaurant_inventory`,
  `inventory_lot_rollup`, `restaurant_tables`, `restaurant_venue_profiles`, `restaurants`,
  `wine_consumption_log`; writes `analytics_insights`, `analytics_insight_prefs`,
  `analytics_goals`.
- `reports` reads and writes `generated_reports`, `scheduled_reports`; reads
  `procurement_documents`, `system_audit_log`.
- `logs` reads only: `pos_checks`, `decision_log`, `inventory_transactions`,
  `procurement_documents`, `system_audit_log`, `event_store`. It owns nothing by
  construction — a trail over other people's rows.

Owned outright: `analytics_insights`, `analytics_insight_prefs`, `analytics_goals`,
`generated_reports`, `scheduled_reports`.

## §6 Owner

**`unowned — gap`.** Not for want of candidates — for want of one. Four charters own four
pieces and every one of them disclaims the others.

| Piece | Team | Charter evidence |
|---|---|---|
| `analytics/engine/` + the candidate space | [[analytics-engine-charter]] | Owns *"`apps/api-gateway/src/analytics/engine/` — 12 modules, 3,679 non-spec lines"* and `insight-catalog.ts` (`:33-40`). Its question is *"is the arithmetic right?"* (`:19`). Names *"how a chart renders"* as **not ours** (`:57`) |
| Steps 4–5 of the insight pipeline, the sentences | [[insight-narrative-generation-charter]] | Owns VERBALIZE and RANK, `insight-verbalizer.ts`, `insight-scheduler.service.ts` (`:34-41`) |
| Whether a shipped number matches its definition | [[metric-contract-truth-assurance-charter]] | Owns `metric-registry.ts` (33 metric keys) and *"the CI assertion layer for counts and definitions"* (`:28-36`) |
| `logs/` + `LogsTimelinePage.tsx` | [[observability-telemetry-plumbing-charter]] | Owns *"human-visible surfaces of the above — `apps/api-gateway/src/logs/` (1 route), `apps/web/src/pages/LogsTimelinePage.tsx`"* (`:40-42`) — and names *"product analytics and guest-facing dashboards"* as **not ours** (`:56`) |

The department charter [[analytics-bi-charter]] does claim
`apps/api-gateway/src/analytics/` outright — *"39 TypeScript files, 11,748 lines"*
(`analytics-bi-charter.md:37`) — but a department is not a team slug, and it does not
reach `reports` or `logs`.

**`apps/api-gateway/src/reports/` is claimed by no charter at all.** Grepping all 100 for
`src/reports`, `generated_reports` or `scheduled_reports` returns two hits, both about the
AI palette on `Reports.tsx` and neither an ownership claim. Ten endpoints, two tables, and
no owner.

## §7 Maturity & seams

**partial** — and the roll-up from the page notes needs three corrections.

[[reports]] §10 reads **`hollow`**, *"the worst finding in the communication/config
cluster"*, on two findings: an AI command palette that answered questions with
`generateMockAnswer` — invented numbers with real-sounding specificity — and a report
generator whose handler was a `console.log`. **Both were addressed in commit `58113e26`,
the same commit that wrote the dossier**, and the dossier was never revised. Verified
against this working tree:

| Was | Now |
|---|---|
| `generateMockAnswer` fabricated analysis | Deleted. `AICommandPalette.tsx:1-26` documents why and what replaced it: the palette now *searches* the real insight feed through `useEngineInsights` and says plainly that free-text answers are not available. Its own note names the risk it removed — *"An owner could have repriced a menu off those figures"* (`:11`) |
| `onGenerate` was a `console.log` | The button is gone rather than faked. `Reports.tsx:911-915` and `components/reports/ReportGenerator.tsx:1-16` state that `POST /reports/generate` only inserts a `status: "pending"` row with NULL `pdf_url`/`excel_url`/`csv_url` and nothing ever fills them, so wiring it *"would fill the archive with rows that can never be opened"* |
| Raw `fetch`, no bearer token | `EngineInsightsPanel.tsx:26` uses `apiClient`; the panel's comment records that a raw `fetch` *"401s into a silently empty panel"* |

[[logs]] §10 reads **`partial`** and still holds exactly as written.

So the honest verdict is `partial`, not `hollow` — but the underlying hole did not move,
it was relabelled: **report generation does not exist.** Ten endpoints, a
`generated_reports` table, a scheduler UI, a 935-line `reporting_agent`, and no code path
anywhere that renders a file. The product is now honest about it, which is the correct
interim state and not the same thing as working.

Seams:

1. **Analytics is split three ways with overlapping metrics.** `analytics` (10,647 lines,
   its own stats/forecasting/risk engine), `reports` (10 endpoints, its own
   `generated_reports` pipeline) and `dashboard` (8 aggregation endpoints) all compute
   spend, stock and order figures from `procurement_orders` and `restaurant_inventory`
   with no shared definition between them. `metric-registry.ts` is the nearest thing to
   one and only 33 keys wide; the team whose job is to prove they agree
   ([[metric-contract-truth-assurance-charter]]) records its claim register as *"does not
   exist yet"*.
2. **The `/reports` page mostly bypasses the analytics module.** Its KPI tiles, daily
   breakdown and export tables come from `useInventoryData` and `useOrdersMetrics`
   (`Reports.tsx:11-12,198-199`) — hooks over `/inventory/:rid` and `/procurement/orders`
   — not from `/analytics`. Only `EngineInsightsPanel`, `SeatingDensityPanel` and
   `getPosRevenue` (`Reports.tsx:46`) reach `analytics`. So the page's headline numbers and
   the engine's numbers are computed by two different code paths over the same rows. The
   page states the consequence itself: those figures are **purchase spend, not sales
   revenue**, and *"sales revenue lives in `pos_checks` and is not read anywhere on this
   page"* (`Reports.tsx:66-71`).
3. **Taxonomy split — a real one, recorded rather than resolved.** ADR 0049 §3a places the
   pages `reports` and `recommendations(-catalog)` under **Intelligence/Analytics**
   (`.planning/04-specs/ECOSYSTEM-PLAN.md:58`) while listing the `reports` **module** under
   **Restaurant** (`:54`), and `logs` under **Platform/Admin** (`:59`). This software
   therefore straddles three of the eight divisions: its page layer is Intelligence, one of
   its three modules is Restaurant, another is Platform/Admin. Under the plan's own
   tie-break rule — *"an ambiguous module is assigned to its primary consumer"* (`:49`) —
   the `reports` module has **no** primary consumer, which is why the assignment reads
   oddly. Flagged, not overridden.
4. **Failures render as silence on `/logs`.** Every per-source fetcher catches, warns and
   returns `[]` (`logs-timeline.service.ts:96-97,305-307`), so a broken `pos_checks` query
   shows as a chip reading `POS 0` — a fabricated zero. `query.isError` is never branched
   (`LogsTimelinePage.tsx:143-150`): a 500 renders "No events". `limit: 100` is hard-coded
   (`:54`) and the merge slices after concatenating all six sources
   (`logs-timeline.service.ts:75`), so one busy source can crowd the others out entirely.
5. **A dormant worker behind a live gap.** `reporting_agent` is the only thing in the repo
   that could render a report, and nothing can reach it.

## §8 Where it's going

- ADR 0049 §3a puts this under **Intelligence/Analytics**, phase **E2** — the
  573/375/~19 reconciliation, the feedback loop, and the Ask AI merge
  (`.planning/04-specs/ECOSYSTEM-PLAN.md:58`).
- Report generation is one decision, not a build: publish `reporting.generate_*` and let
  the agent render, or delete the module and its two tables. The current state pays for
  both.
- The three-way metric overlap is the highest-value structural fix and the one with a
  named owner-in-waiting: [[metric-contract-truth-assurance-charter]]'s claim register.
- `analytics.satisfiable_candidate_share` is the honest reach number and it is low —
  38/573 on consumption-only data (`analytics-engine-charter.md`, measured 2026-08-24).
  Coverage, not code, is the ceiling here.
- The ownership gap in §6 belongs in [[SOFTWARE-MAP]]'s gap table.
