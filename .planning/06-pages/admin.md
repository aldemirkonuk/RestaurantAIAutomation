---
type: page
route: /admin
slug: admin
component: apps/web/src/pages/AdminPanel.tsx
audience: owner
tier: core
archetype: form # proposed 2026-08-26 (OD-79)
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[admin-health]]"]
---

# /admin

## Surface — buttons → where they go

- **General / Agents / Notifications / Integrations tabs** → (on this page)
- **Save Settings** → localStorage only (no admin-config endpoint; the toast says so)
- **Save Notification Settings** → localStorage only (same handler)
- **Restart Agent** → API `GET /api/v1/health/agents/:name` (live re-check; restart itself is not wired, `AdminPanel.tsx:400-420`)
- (no outbound navigation — dead-end page)

## 1. Purpose
"Admin Settings" — four tabs (General / Agents / Notifications / Integrations, `AdminPanel.tsx:423-428`). General shows infra-provider health (Supabase, Gemini, Claude, plus hard-coded RabbitMQ/Redis rows, `AdminPanel.tsx:255-259`) and restaurant knobs (buffer window, default threshold, three feature toggles). Agents shows orchestrator metrics per agent. Two honesty fixes are load-bearing here: **Save persists to localStorage only** and the toast says so — there is no admin-config endpoint (NEW-544, `AdminPanel.tsx:373-388`); **Restart isn't wired** — the button re-checks live health and says restart needs an orchestrator control endpoint that doesn't exist (NEW-545, `AdminPanel.tsx:392-420`).

## 1a. Features
- Four tabs: General / Agents / Notifications / Integrations
- See infra-provider health (Supabase, Gemini, Claude; RabbitMQ/Redis rows are decorative)
- Tune restaurant knobs: buffer window, default threshold, three feature toggles (🚧 saves to this device only — no server endpoint)
- See per-agent orchestrator metrics
- 🚧 Restart button re-checks health only; real restart endpoint doesn't exist

## 2. Entry
Sidebar "Admin Panel" under an Admin section rendered only for `user?.role === 'owner'` (`Sidebar.tsx:582-597`). The route is *also* role-gated now — `requiredRole="owner"` at `App.tsx:290` (see §9). Not in PAGE_MAP's no-inbound list — the sidebar edge is the inbound link.

## 3. Files
- Route binding: `apps/web/src/App.tsx:290` (lazy, `App.tsx:89`)
- `apps/web/src/pages/AdminPanel.tsx` (739 lines)

## 4. Endpoints
| Method | Path | Where called | Atlas |
|---|---|---|---|
| GET | `/api/v1/health/providers` | `AdminPanel.tsx:244` (General tab) | ENDPOINTS.md:118 |
| GET | `/api/v1/health/agents` | `AdminPanel.tsx:309` (Agents tab) — **through the gateway with the user's JWT since the 2026-08-25 fix; see §10** | ENDPOINTS.md:116 |
| GET | `/api/v1/health/agents/:name` | `AdminPanel.tsx:327-330` (per-agent counters) and `:406` (restart-button health re-check) | ENDPOINTS.md:117 |

## 5. Signals
**none.**

## 6. Tier cut
Internal ops surface — not a sellable capability; no `S..` touches it (OD-48). Loosely serves S09/S15 observability needs but is not named by them.

## 7. Rebrand surface
**0 user-visible strings.** The localStorage key `wineops.admin.settings` (`AdminPanel.tsx:24`) is machine-facing; `BrandMark` is rendered with `alt=""` (`AdminPanel.tsx:320`).

## 8. State & config
- `VITE_API_GATEWAY_URL`, `VITE_AGENT_ORCHESTRATOR_URL` (defaults `localhost:4000` / `localhost:8000`, `AdminPanel.tsx:171,214`).
- Settings themselves (`buffer_window_minutes`, `default_threshold_min`, `enable_auto_procurement`, `enable_visual_verification`, `enable_predictive_analytics`) live per-device in localStorage (`AdminPanel.tsx:150-165`) — they configure nothing server-side.

## 9. Gaps
- ~~**Route is reachable by any authenticated user**~~ — **closed.** `App.tsx:290` now carries `requiredRole="owner"`, landed 2026-08-24 (`git log -L288,292:apps/web/src/App.tsx` → `fc340b7d`). Note the effective gate is owner **or manager**: `ProtectedRoute.tsx:62-65` treats the two as interchangeable.
- ~~The orchestrator call goes direct with no bearer token~~ — **closed 2026-08-25.** See §10.
- RabbitMQ/Redis rows are hard-coded "Active/Running" (`AdminPanel.tsx:257-258`) — decorative, not measured.
- NEW-544/NEW-545 remain open in spirit: the page is honest about the missing endpoints, but the endpoints are still missing.

---

## 10. Maturity — **partial**

The confirmed live defect is fixed and verified; two knobs on the page still configure
nothing, and one row of the health grid is decoration.

**The defect, and the fix.** The Agents tab called
`${VITE_AGENT_ORCHESTRATOR_URL}/health/agents` with a bare unauthenticated axios GET and
then read `state` / `messages_processed` / `avg_processing_time_ms` / `error_rate` off the
response. It was wrong three ways at once, so the tab **had never once rendered live
health**:

1. the real orchestrator route is `/api/v1/health/agents`
   (`services/agent-orchestrator/api/health_routes.py:244`, mounted with no prefix at
   `main.py:154`) — the old path 404'd;
2. that route requires an `X-Admin-Key` matching `ADMIN_API_KEY`
   (`health_routes.py:230-241`) — a secret that must never reach browser JS, so the call
   could not have succeeded even at the right path;
3. the payload is a **list** under `agents`, each entry being `get_health()`
   (`core/base_agent.py:990-1004`) — `agent_name` / `status` / `healthy` only. Not one of
   the four fields the UI parsed exists on any payload.

Fixed on 2026-08-25 by routing through the authenticated gateway proxy:
`AdminPanel.tsx:296-371` now calls `${VITE_API_GATEWAY_URL}/api/v1/health/agents` with the
user's JWT → `HealthProxyController` (`apps/api-gateway/src/common/orchestrator/health-proxy.controller.ts:18-35`,
`@UseGuards(JwtAuthGuard)` + `@TenantBypass()`) → `OrchestratorService.getAgentHealthAll`
(`orchestrator.service.ts:82-87`), which injects `X-Admin-Key` server-side
(`:78-79`). `ADMIN_API_KEY` never leaves the gateway (the file says so at its `:10`).
Counters now come from the per-agent detail route (`AdminPanel.tsx:323-336` →
`get_detailed_health`, `core/base_agent.py:1006-1025`), one failure does not blank the
others (`:332-334`), and a missing metric renders `'—'` (`METRIC_UNAVAILABLE`,
`AdminPanel.tsx:64`) rather than a fabricated `0`. Failures are typed: 401/403, 404
("the api-gateway has no proxy — it may be running an older build") and a generic
orchestrator-unreachable message naming `AGENT_ORCHESTRATOR_URL` and `ADMIN_API_KEY`
(`:353-360`).

**What remains**

- **Save Settings writes to `localStorage` only** (`AdminPanel.tsx:373-388`). The toast
  says so (NEW-544) — honest, but five restaurant knobs on an admin page configure
  nothing server-side.
- **Restart is not wired** (`:392-420`, NEW-545). The button re-checks live health and
  reports that restarting needs an orchestrator control endpoint that does not exist.
- **RabbitMQ and Redis are hard-coded** `Active` / `Running`, `healthy: true`
  (`:257-258`) and appended to whatever the real provider probe returns. Two of the five
  rows in an infrastructure-health grid are unmeasured claims. The gateway's
  `/health/providers` returns only supabase / gemini / claude
  (`health-proxy.controller.ts:56-81`) and never asserts these.
- The Agents tab still only fetches on tab activation (`:297`) with no refresh — unlike
  [[admin-health]]'s 30-second poll.

## 11. Data flow

**Calls out**

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `/api/v1/health/providers` | Bearer from `localStorage` (`:243-246`) | `common/orchestrator/health-proxy.controller.ts:41-82` | `{providers:[supabase, gemini, claude]}` — `status` + `healthy` derived purely from **whether the key/URL env var is set**, never from a live probe (`:43-54`). Never returns secret values |
| GET | `/api/v1/health/agents` | Bearer (`:305-306`) | `health-proxy.controller.ts:27-30` → `orchestrator.service.ts:82-87` (adds `X-Admin-Key`) | `{agents:[{agent_name,status,healthy}]}` from `core/base_agent.py:990-1004` |
| GET | `/api/v1/health/agents/:name` | Bearer | `health-proxy.controller.ts:32-35` → `orchestrator.service.ts:89-97` | `{metrics:{…}}` from `get_detailed_health` (`core/base_agent.py:1006-1025`) |

On timeouts: 5 s for providers (`:246`), 8 s for agents (`:311,329,408`).

**Fed by**

- Agent health is produced by the **running Python agents themselves** — each subclass of
  `core/base_agent.py` maintains its own `AgentMetrics`; the orchestrator registry
  (`core/orchestrator.py:188`) is what `health_routes.py:244` enumerates. If the
  orchestrator process is down, the proxy surfaces the failure rather than inventing rows.
- Provider health is **configuration, not measurement** — `ConfigService` /
  `process.env` reads of `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY`, `GOOGLE_API_KEY` /
  `GEMINI_API_KEY`, `SUPABASE_URL` (`health-proxy.controller.ts:43-54`). "Ready" means
  "a key is present", not "a call would succeed".
- The Claude row is labelled `purpose: "studio"` (`:78`) — this grid is the only place
  [[studio]]'s extraction dependency is visible anywhere in the product.
- The five settings are fed by nothing: they initialise from `localStorage` or defaults
  (`AdminPanel.tsx:229-236`).

**Writes**

- `localStorage.wineops.admin.settings` (`:383`) — per-device, per-browser. Nothing reads
  it outside this page.
- **No server-side writes at all.** Every route the page touches is a `GET`. Nothing
  downstream reacts to anything done here.

## 12. Design intent

**Should be:** the owner's answer to "is the machinery running, and what can I change
about it" — a truthful infrastructure board, per-agent liveness with a way to act on a
stuck agent, and restaurant-wide defaults that actually take effect.

| State | Implemented? | Evidence |
|---|---|---|
| Empty | **yes** — "The orchestrator responded but reports no running agents" is distinguished from an error (`NO_AGENTS_MESSAGE`, `:71,348,677-681`). Rare and correct: an empty list and a failed call say different things |
| Loading | **yes** — `agentStatusLoading` (`:663-669`); providers render `'…'` placeholders (`:609-618`) |
| Error | **yes**, and typed by status code (`:353-360`, rendered `:670-683`). Providers degrade to an all-`Unknown` grid (`:261-273`) rather than lying |
| Permission-denied | **yes** — route-level "Access Denied" card (`ProtectedRoute.tsx:67-101`) via `requiredRole="owner"` (`App.tsx:290`) |

Four honest states — the best-covered page in this cluster.

**Where the UI misleads**

1. **RabbitMQ "Active" and Redis "Running"** (`:257-258`) sit in the same grid as three
   measured rows, in the same green treatment. Nothing is checked.
2. **"AI Engine — Ready"** means a Gemini key is configured, not that Gemini answers
   (`health-proxy.controller.ts:48-52,66-71`). A revoked key reads as Ready.
3. Five settings controls with a Save button that persists to one browser
   (`:373-388`) — the toast is honest, the control affordance is not.
4. A **Restart** button that never restarts (`:392-420`). Honest in its toast, and still
   a labelled control that does not do its label.

## 13. Roadmap

1. **Measure RabbitMQ and Redis or delete the rows** (`:257-258`). Both have live
   connections in the gateway; adding two probes to `health-proxy.controller.ts:56-81`
   makes the whole grid mean one thing.
2. **Give the settings somewhere to land.** A restaurant-settings write for
   `buffer_window_minutes` / `default_threshold_min` and the three toggles — the
   `SettingsModule` (`app.module.ts:105`) already owns feature flags, so this is an
   extension, not a new module. Closes NEW-544.
3. **Expose an orchestrator control endpoint** (restart / drain a named agent) behind the
   same `X-Admin-Key` proxy pattern, then wire the button. Closes NEW-545.
   *Blocked: needs a decision on whether restart is exposed to owners at all, or is
   dev-only like [[admin-health]] implies.*
4. **Poll the Agents tab** the way [[admin-health]] polls (30 s), or link to it — see #5.
5. **Merge with [[admin-health]].** Two pages read the same two endpoints at different
   fidelity, and neither links to the other (`/admin/health` has no inbound link at all).
   One board, one poll, one drill-down.
6. Probe rather than infer provider readiness — a cheap models-list call beats an env-var
   truthiness check.
