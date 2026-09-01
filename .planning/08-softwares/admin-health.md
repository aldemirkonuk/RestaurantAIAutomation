---
type: software
slug: admin-health
name: Admin & Health
division: platform-admin
status: partial
tier: internal
routes: ["/admin", "/admin/health", "/dev-sandbox"]
pages: [admin, admin-health, dev-sandbox]
api_modules: [health, database, logs]
agents: [state_invariant_enforcer]
owner_unit: observability-telemetry-plumbing
updated: 2026-09-01
links: ["[[admin]]", "[[admin-health]]", "[[dev-sandbox]]", "[[observability-telemetry-plumbing-charter]]", "[[state-integrity-invariants-charter]]", "[[auth-onboarding]]", "[[SOFTWARE-MAP]]"]
---

# Admin & Health

## §0 What it is

The operator's view of the machine rather than the restaurant. Is the agent fleet running,
are the outside providers answering, and — on a separate bench — what does the interface do
when something fires? Nobody buys this; an owner opens it when something feels wrong, and a
developer opens it to make something fire on purpose. It is the only software here whose
audience is us.

## §1 Features today

- Fire every toast variant to check its styling
- Simulate POS sales, stock changes and threshold alerts against the running UI
- Dispatch realtime events and enqueue One-Tap actions; inspect and clear local storage
- Filter the agent fleet to healthy or unhealthy; refresh with `r`, close with `Esc`
- See every orchestrator agent as a live health card — status, version, capabilities —
  polled every 30 seconds
- Drill into one agent and read its raw health payload
- See infra-provider health for Supabase, Gemini and Claude — **RabbitMQ and Redis rows
  are decoration** (`admin.md` §1a)
- Tune restaurant knobs — buffer window, default threshold, three toggles — **dark**: they
  save to this device only, there is no server endpoint
- Restart an agent — **dark**: the button re-checks health; the endpoint does not exist,
  and [[admin-health]]'s drill-down sheet says so out loud (`AdminHealth.tsx:251`)

## §2 Screens

- [[admin-health]] — the board that got the health proxy right first.
  `apps/web/src/App.tsx:323`, `ProtectedRoute requiredRole="owner"`. 259 lines.
- [[admin]] — four tabs, the broader operator panel. `apps/web/src/App.tsx:322`, same role
  gate. 871 lines; it was later fixed to match [[admin-health]]'s proxy call.
- [[dev-sandbox]] — a frontend-only test bench. `apps/web/src/App.tsx:335`, same role gate.
  469 lines, **zero network calls**.

All three are owner-gated at the route, which was not always true — the route comment
records the fix: *"the sidebar link is owner-only, but the URL was not"*
(`App.tsx:320-321`).

## §3 Backend

The naming here is a trap and worth stating first: **the `health/` module is not the module
these pages call.**

| Module | Endpoints | Controller |
|---|---|---|
| `health/` | 1 | `@Controller("health")` `health/liveness.controller.ts:46`, `@Get("live")` `:48` |
| `logs/` | 1 | `@Controller("logs")` `logs/logs.controller.ts:22`, `@Get("timeline/:restaurantId")` `:26` |
| `database/` | **0** | no controller — `DatabaseService` is the Supabase client provider (`database/database.service.ts:5-30`) |

`health/liveness.controller.ts` is a deploy probe, unauthenticated by design and touching
nothing: its 45-line header records that `deploy.yml` had polled a URL that never existed,
so *"the check has never actually run"*, and fixes the rule narrowly — *"this handler
touches nothing"* (`liveness.controller.ts:4-45`).

The pages' actual backend is **`common/orchestrator/health-proxy.controller.ts`**, a
different module: `@Controller("health")` at `:18` with `@Get("agents")` `:27`,
`@Get("agents/:name")` `:32`, `@Get("providers")` `:41`, plus `@Controller("metrics")` at
`:85`. It adds `X-Admin-Key` server-side so the secret never reaches browser JS
(`orchestrator.service.ts:78-79`). Two `@Controller("health")` classes in one tree, one of
them not in the `health/` directory, is the single most confusing seam in this division.

`logs/` has the opposite problem: its one endpoint's user surface is `/logs`
(`App.tsx:315`), which is **not one of this software's pages**. The module is listed here
because its owner and its subject matter are here; the screen belongs elsewhere.

## §4 Automation

**`state_invariant_enforcer`** — `services/agent-orchestrator/agents/state_invariant_enforcer.py`.
Registered in the orchestrator class map (`core/orchestrator.py:183`) with a real spec
(`core/agent_registry.py:68-72`, tier `CORE`, depends on `inventory_engine`, described as
*"Global guardrails"*) and runtime config at `core/orchestrator.py:404-409`.

It subscribes to **eight** routing keys, all wildcards — `pos.events`, `stock.events`,
`procurement.events`, `notification.events`, `report.events`, `menu.events`,
`system.control`, `broadcast` (`:65-74`) — which makes it the broadest listener in the
fleet. It checks four invariants: sync loops (repeated identical events in a window),
double writes (duplicate event ids), **tenant leakage** (multiple restaurant ids in one
event), and Opus outputs awaiting review (`:20-28`). Findings are written to
`system_audit_log` as `actor_type: "agent"` rows (`:240-253`).

Note the shape: this is a **detector with no surface**. Nothing in [[admin]] or
[[admin-health]] reads `system_audit_log`. The agent that would notice cross-tenant leakage
reports into a table no operator screen renders.

## §5 Data

- `system_audit_log` — written by `state_invariant_enforcer` (`:240`)
- From `logs/`: `decision_log`, `event_store`, `inventory_transactions`, `pos_checks`,
  `procurement_documents`, `system_audit_log` — the correlated timeline reads six tables it
  owns none of

`health/` and `database/` touch no table of their own; `database/` **is** the client every
other module's tables are reached through.

## §6 Owner

[[observability-telemetry-plumbing-charter]] — team `observability-telemetry-plumbing`,
department `reliability-sre`, division Platform
(`01-org/platform/reliability-sre/teams/observability-telemetry-plumbing/`). This is the
cleanest owner match in the division: the charter's boundaries claim the exact artifacts —
*"`apps/api-gateway/src/logs/` (1 route), `apps/web/src/pages/LogsTimelinePage.tsx`,
`AdminHealth.tsx`, `common/orchestrator/health-proxy.controller.ts` (4 routes),
`scripts/health-check.sh`"* (`observability-telemetry-plumbing-charter.md:40-43`).

Its mandate line also sets the limit of that ownership precisely: *"Own whether a signal
exists at all… This team owns whether the number exists, **never** what the number says"*
(`:18-21`).

The agent has a different owner. [[state-integrity-invariants-charter]] (same department)
owns *"Detect silent corruption. Distributed-state invariants, schema drift, tenant
leakage, POS↔inventory divergence"* (`state-integrity-invariants-charter.md:16-18`) — which
is `state_invariant_enforcer`'s job description almost word for word. Two teams, one
software, and the seam between them is exactly the surface gap named in §4.

## §7 Maturity & seams

**partial** — rolled up from `partial` ([[admin]]), `partial` ([[admin-health]]), and
`complete` ([[dev-sandbox]], *for what it claims to be*).

What works is real and was hard-won. [[admin-health]] calls `GET /api/v1/health/agents`
with the user's JWT through `HealthProxyController`, which adds the admin key server-side;
30-second poll, healthy/unhealthy filter, per-agent drill-down, keyboard shortcuts
(`admin-health.md` §10). [[admin]]'s Agents tab had **never once rendered live health** —
wrong path, a secret that could not legally reach the browser, and four fields that exist
on no payload — and was fixed on 2026-08-25 by routing through the same proxy
(`admin.md` §10).

Seams:

1. **Two `@Controller("health")` classes**, one of which is not in `health/`. See §3.
2. **An error is rendered as an empty fleet.** [[admin-health]]'s `fetchHealth` catches,
   toasts and returns, so `agents` is never set and the page shows *"No agents running"* —
   a 401, a 404, a dead gateway and a genuinely idle orchestrator render identically
   (`AdminHealth.tsx:56-60,163-169`). [[admin]] distinguishes them by status code
   (`AdminPanel.tsx:353-360`) and keeps a distinct empty-case message. The better page has
   the worse error handling.
3. **The toast repeats every 30 seconds** while a failure persists — an unreachable
   orchestrator produces a toast every half minute.
4. **The detector has no display.** §4.
5. **The dev bench ships to production.** [[dev-sandbox]] is in the production bundle with
   no `import.meta.env.PROD` guard, and its writes land in `wineops_shadow_stock` /
   `wineops_pending_actions` — the One-Tap Action Center's own storage keys
   (`components/notifications/OneTapActionCenter.tsx:80-81`). A **deployment** gap rather
   than a page defect, which is why the page's own verdict stays `complete`.
6. **Two dark controls** that look live: the restart button and the device-local knobs (§1).

## §8 Where it's going

- ADR 0049 §3a puts `health` and `logs` under **Platform/Admin**, phase **E0**
  (`.planning/04-specs/ECOSYSTEM-PLAN.md:59`). The `admin(-health)` pages are named in that
  row.
- [[observability-telemetry-plumbing-charter]] calls itself *"the hard prerequisite for
  L4"* — NF-A cannot be emitted by departments with no emission path (`:23-26`). This
  software is where that path becomes visible or does not.
- The cheapest real improvement is #2: distinguish an error from an empty fleet, the way
  [[admin]] already does.
- The `state_invariant_enforcer` → `system_audit_log` → *nothing* chain (§4, #4) is a
  detector whose findings nobody can see. Either give it a surface here or stop calling it
  a guardrail.
