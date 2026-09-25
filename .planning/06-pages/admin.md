---
type: page
route: /admin
slug: admin
softwares: [admin-health-sw]
component: apps/web/src/pages/AdminPanel.tsx
audience: owner
tier: core
archetype: form # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-09-17
links: ["[[PAGE-CONTRACT]]", "[[admin-health]]"]
---

# /admin

> **Part of** [[08-softwares/admin-health|Admin & Health]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

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

> **Next build.** `AdminDesk.tsx` (`apps/web/src/pages/admin/next/`) replaces this page
> and `[[admin-health]]` under one flag, `mudavym_design_admin` — see "The next build" below
> for what it keeps, drops and adds. This section still describes the legacy component
> named in the frontmatter, which is what renders while the flag is off.

## 2. Entry
Sidebar "Admin Panel" under an Admin section rendered only for `user?.role === 'owner'` (`Sidebar.tsx:648-657`). The route is *also* role-gated now — `requiredRole="owner"` at `App.tsx:401` (see §9). Not in PAGE_MAP's no-inbound list — the sidebar edge is the inbound link. Behind `mudavym_design_admin`, `/admin` renders `AdminDesk` instead and `/admin/health` redirects to `/admin` (`App.tsx:401-402`) — see "The next build".

## 3. Files
- Route binding: `apps/web/src/App.tsx:401` (lazy, `App.tsx:109`)
- `apps/web/src/pages/AdminPanel.tsx` (739 lines)

## 4. Endpoints
| Method | Path | Where called | Atlas |
|---|---|---|---|
| GET | `/api/v1/health/providers` | `AdminPanel.tsx:244` (General tab) | ENDPOINTS.md:118 |
| GET | `/api/v1/health/agents` | `AdminPanel.tsx:309` (Agents tab) — **through the gateway with the user's JWT since the 2026-08-25 fix; see §10** | ENDPOINTS.md:116 |
| GET | `/api/v1/health/agents/:name` | `AdminPanel.tsx:327-330` (per-agent counters) and `:406` (restart-button health re-check) | ENDPOINTS.md:117 |

The next build adds `GET /health/access`, `POST /health/agent-operations/:name/:action`
and `GET /health/agent-operations` (all owner-or-platform-operator gated) — see "The next
build" §Endpoints below.

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
- ~~**Route is reachable by any authenticated user**~~ — **closed.** `App.tsx:401` now carries `requiredRole="owner"`, landed 2026-08-24 (`git log -L288,292:apps/web/src/App.tsx` → `fc340b7d`). Note the effective gate is owner **or manager**: `ProtectedRoute.tsx:62-65` treats the two as interchangeable.
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
| Permission-denied | **yes** — route-level "Access Denied" card (`ProtectedRoute.tsx:67-101`) via `requiredRole="owner"` (`App.tsx:401`) |

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
3. ~~**Expose an orchestrator control endpoint** (restart / drain a named agent)~~ —
   **done in the next build**, decided by ADR 0143 §2 and ADR 0149 row 10, not by this
   legacy page: restart/stop is owners-**never**, platform-operators-only
   (`POST /health/agent-operations/:name/:action`, `PlatformOperatorGuard`), which this
   roadmap item had not anticipated. This legacy button stays unwired — see "The next
   build" §Endpoints.
4. ~~**Poll the Agents tab**~~ — **done in the next build** (30 s, pauses when the tab is
   hidden). This legacy page's Agents tab still only fetches on activation.
5. ~~**Merge with [[admin-health]]**~~ — **done**, behind `mudavym_design_admin`: with the
   flag on, `/admin/health` redirects to `/admin` and both render `AdminDesk`. See "The
   next build" below. This legacy page and [[admin-health]] are what render with the flag
   off, and are unchanged by the merge.
6. Probe rather than infer provider readiness — a cheap models-list call beats an env-var
   truthiness check. **Still open** — the next build's `/health/providers` also reports
   "configured", not probed.


## The next build — /admin (Mudavym desk)

`apps/web/src/pages/admin/next/AdminDesk.tsx` replaces this page and [[admin-health]]
under one flag, `mudavym_design_admin` (`App.tsx:401-402`: `/admin` renders `AdminDesk`,
`/admin/health` redirects to `/admin`). The flag defaults false
(`supabase/migrations/20260922210200_mudavym_design_flag_admin.sql`) and is not yet in
`scripts/flip_mudavym_design_flags.py`'s `PAGES` tuple's rollout history — it was added
to that tuple 2026-09-17, so the desk can now be flipped per house like every other
Mudavym page. Per ADR 0149 row 10 the desk keeps ADR 0143 §2's three defaults: the five
former localStorage-only knobs are removed, House settings / Connections / the Activity
ledger are linked out rather than duplicated on the desk, and the health read is for
house owners and platform operators only — not managers, not staff — enforced server-side
by `OwnerOrPlatformOperatorGuard` on `GET /health/agents`, `GET /health/agents/:name` and
`GET /health/providers` (`health-proxy.controller.ts`), not only by the page's own
`user?.role === 'owner'` check.

**Platform authority (ADR 0143).** An operator needs BOTH an enabled, unrevoked
`platform_operator_grants` row AND an unrevoked Studio `developer` role
(`platform-operator.service.ts` `isOperator`), read fresh on every request — a house role,
a cached JWT claim or Studio membership alone confers nothing. The grant table is
SQL-only: `REVOKE ALL` (including `service_role`) then `GRANT SELECT` only to
`service_role`, self-checked by a `DO` block in the same migration
(`supabase/migrations/20260922210100_platform_operator_controls.sql`); no migration ever
inserts a row, so no operator is seeded. `platform_agent_operations` (the restart/stop
receipt ledger) is likewise `service_role`-only, with `actor_id ON DELETE RESTRICT` so
deleting a user who ran an operation is refused rather than silently orphaning the
receipt. Four `CLAIMS.jsonl` rows re-check these facts on every CI run
(`ADR-0143-NO-SEEDED-OPERATOR`, `-GRANTS-SQL-ONLY`, `-RECEIPTS-SERVICE-ROLE-ONLY`,
`-OPERATOR-IS-GRANT-AND-ROLE`).

**Restart/stop receipts.** `POST /health/agent-operations/:name/:action` (restart or stop
only) writes a durable request receipt before dispatch; a request id cannot be replayed
(unique constraint → 409). `agent-operations.controller.ts`'s `verdictFromError` maps a
definite orchestrator refusal to a specific `failed` outcome rather than `unknown` — 404
`agent_not_running`, 409 `operation_in_progress`, 503 `orchestrator_not_running` /
`orchestrator_unconfigured`, 401/403 `orchestrator_rejected_credentials` — and reserves
`unknown` for the cases that truly are: no response, a timeout, or a server error where
whether the agent acted cannot be told. `check_platform_operator_routes.cjs` now also
walks every controller's call graph (not only routes already in the reviewed registry)
for a reach to `operateAgent`/`getSystemMetrics` outside `PlatformOperatorGuard`, and
exits 2 (not 1) when the check itself cannot run — proven against a restored negative
fixture during this session.

**Health reads keep the legacy pages working while the flag is off.** `/health/agents`
and `/health/agents/:name` still return the counters `AdminPanel.tsx:327-331` and
`AdminHealth.tsx`'s drill-down read (name, version, status, `healthy`, and the
`publicAgentDetail` counters/timing/circuit-breaker block — never `last_error`,
`last_activity` or `subscriptions`, which can carry another house's text).
`/health/providers` keeps `healthy` as the same boolean `AdminPanel.tsx:638,649` has
always painted its dot and badge from (`Boolean(<key present>)`); only `status`'s text
changed, to "Configured · not probed", which legacy only displays and never branches on.
An earlier pass on this lane sent `healthy: null` for providers, which reads falsy in
that page's ternaries and painted a correctly configured provider amber before anyone
decided legacy may degrade — reverted.

**Legacy 401/403 messaging now names the actual cause.** A manager who types either
legacy URL directly (the sidebar link is owner-only, so this needs a typed URL) hits
`OwnerOrPlatformOperatorGuard`'s 403 — this lane's own guard, added for the new health
routes. `AdminPanel.tsx` previously folded 401 and 403 into one "Sign in again" message,
which is false for a role refusal; `AdminHealth.tsx` did not branch on status at all, so
the same generic connection toast repeated every 30s regardless of cause. Both now read
`error.response?.status`: 403 reads "This page needs a house owner, or a platform
operator grant — ask an owner to add you"; a real 401 (an actually rejected session)
still says to sign in again.

**The desk itself:** a 30s poll that pauses while the tab is hidden; a failed re-read
keeps the last good reading on screen with a "re-read failed, showing the last reading"
label rather than replacing it with nothing; a per-agent drill-down (`Sheet`, counters
only, no error text) opened by selecting a row; house type throughout
(`fonts.ts` → `ensureFraunces()`, DM Sans / JetBrains Mono from `index.html`, no Inter, no
IBM Plex Mono), `--ink-*` / `--paper-*` / `--seal*` tokens only (no raw hex), and an
`ink`-token hover transition on controls, links and rows that `admin-desk.css`'s closing
`@media (prefers-reduced-motion: reduce)` block turns off (`MOTIONS.md`). Two more of
[[admin-health]]'s features are now carried over rather than dropped: a healthy / needs
attention / all filter above the register (`admin-desk.css`'s `.admin-desk__filter`, tokens
only), and the `r` keyboard shortcut to read again — disabled while a confirmation or
drill-down sheet is open, since `Sheet` already owns `Escape` for whichever overlay is
topmost, so a second handler here would only race it.

**The stale label now covers every reading, not only agents and readiness.** A first
pass left three gaps, each measured against the index by the wave-4 confirmer: a failed
`/health/providers` re-read and a failed `/health/agent-operations` re-read kept the old
list on screen with no stale note at all (`AdminDesk.tsx` now carries the same "re-read
failed, showing the last reading" caption for both); and a failed `/health/access`
re-read for an already-established operator silently skipped re-reading agents,
providers and receipts for that whole cycle, with the permission notice itself hidden
because the kept `access.value` made the "could not be verified" alert's guard false.
The effect now falls back to the last confirmed grant to decide whether to keep reading
(the server's own guards remain the real enforcement on every route regardless), and
shows a distinct "could not be re-verified this time" notice when that fallback is in
use. Two more fixes from the same pass: `openDetail` now discards a read that lands after
its sheet was already closed (or after a different agent was opened), instead of
reopening a closed sheet with the counters that arrive late; and the confirmation and
detail sheets' inner content now carries the same 16px inset every other sheet's content
supplies for itself (`TwinSheet.tsx:84`'s pattern) — `.mdv-ovl__body` deliberately
supplies none.

**Read-repair names a gone record plainly (ADR 0149 row 42).** A receipt's remote
reconciliation can come back `absent` — most often because the orchestrator restarted and
its in-memory record of the request is gone. The desk now shows that receipt its own
caption saying so, rather than leaving it sitting in `unknown` with no explanation; the
founder's ruling was to keep read-repair rather than drop it, on the condition that this
case reads plainly.

**Measured this session** (clean run, this worktree, `origin/main` `60ed83a7` + the
staged lane): `python3 -m pytest tests/test_agent_lifecycle.py tests/test_health_routes.py`
→ 52 passed (33 lifecycle, up from 26 — five added for `NotificationAgent` and
`CalendarAgent`'s background loops and Redis client, one for the suspend-monitor fix, one
for the forgotten-drain-handle fix; 19 health-route, up from 12 — one for the non-ASCII
admin-key fix, six for the agent-operation record read/write/eviction). Full
`services/agent-orchestrator/tests/` → 1395 passed, 54 skipped (was 1381 before this
session). `black --check` and `ruff check` on every touched `.py` file → clean. Gateway jest
(`agent-operations.controller.spec.ts`, `platform-operator.service.spec.ts`,
`orchestrator.service.spec.ts`, `platform-operator.routes.spec.ts`) → 94 passed, 4 suites,
including a real Nest HTTP-seam test module (`platform-operator.routes.spec.ts`) proving
an owner gets 403 on the operator-only routes and a manager/staff member gets 403 on the
health-read routes, not a mock of `isOperator`. Web vitest `AdminDesk.test.tsx` → 17
passed (12 from the first pass, plus five added closing the wave-4 confirmer's stale-label
and drill-down gaps: a stale providers reading, a stale receipts reading, a receipt whose
remote record is gone, a failed permission re-check that still re-reads agents for an
established operator, and a closed drill-down that does not reopen when its read lands
late). Twelve from the first pass: a manager is refused same as staff; a failed re-read
keeps the prior reading with the stale label; the drill-down renders counters and never
`last_error`; the 30s poll fires only while the tab is visible; `r` reads again but not
while a sheet is open; the health filter narrows the register without folding an unknown
reading into either bucket).
`node scripts/check_platform_operator_routes.cjs` → 3 routes match the registry, 73
controllers scanned for an unguarded reach to an operate path. Gateway and web
`tsc --noEmit` clean; eslint clean on every touched file;
`bash scripts/check_decision_claims.sh` → 345 checked, 345 holding (five new rows this
pass: the migration's idempotency, the stale-label completeness, the permission-re-read
fallback, the drill-down not reopening, and the absent-receipt caption).

**Agent lifecycle (`services/agent-orchestrator/core`, `agents/notification_agent.py`,
`agents/calendar_agent.py`).** `BaseAgent.stop()` never cancels a background task, it
only waits for the loop to notice `_shutdown_event` and exit on its own — so an agent
without a `cleanup()` override that drains its own task leaked it across `stop()` and
`restart()`. `NotificationAgent._batch_processor` was a bare `while True: sleep(...)`
with no `cleanup()` at all: measured before this session's fix, `stop()` left it running
and `restart()`'s `initialize()` opened a second Redis client on top of the first,
neither ever closed. `CalendarAgent._daily_check_loop` already watched the shutdown
event correctly but had no `cleanup()` to wait for it, so `stop()` could report STOPPED
before the loop had actually exited. Both now have a `cleanup()` that drains its task via
`_drain_tasks` (the same pattern `buffer_manager.py`, `provider_conversation_agent.py`
and `recurring_order_agent.py` already used), and `NotificationAgent.cleanup()` also
closes `_redis`. `test_agent_lifecycle.py`'s `background_fixture` now covers
`"notification"` and `"calendar"` in the same parametrized stop/restart/timeout matrix as
the other three agents, plus one dedicated test asserting exactly one Redis client is
open per start and it closes on every stop.

**Two more measured fixes, both minor, both re-checked against the pre-fix tree.**
`agent_registry.py`'s auto-suspend `_monitor` had no `try`/`except` around
`proxy.suspend()`; one agent's `pause()` refusing (an ERROR-status agent, say) let the
exception end the loop's `while True` for good, silently stopping auto-suspend for
every on-demand agent for the rest of the process, and `stop_suspend_monitor()` then
re-raised that same stored exception rather than the `CancelledError` it expected.
Fixed with a per-agent `try`/`except` that logs and continues, and a broadened catch on
the stop path; `test_one_agents_refused_suspend_does_not_end_auto_suspend_for_every_other`
reproduces the failure against the pre-fix code (confirmed by temporarily reverting) and
passes against the fix. `health_routes.py`'s `verify_admin_key` compared the raw `str`
`X-Admin-Key` header with `hmac.compare_digest`, which raises `TypeError` for a
non-ASCII string — HTTP headers are latin-1 at the wire, so a header byte above 0x7F
turned a wrong-key request into an uncaught 500 instead of 401. Fixed by encoding both
sides to bytes first; `test_health_agents_non_ascii_key_returns_401_not_500` (sending
the raw latin-1 bytes, since httpx's own `str` header encoder refuses non-ASCII before
the request is even built) reproduces the 500 against the pre-fix code and gets 401
against the fix.

**Receipt reconciliation now reads a real record, not a 404 that only looked like
one.** `GET /health/agent-operations` read-repairs a pending receipt from
`GET /health/agent-operations/{request_id}` (`agent-operations.controller.ts:332-375`,
`orchestrator.service.ts` `getAgentOperation`) — but that Python route did not exist
until this closing pass: every reconciliation attempt 404'd on the *path*, which the
gateway happened to read as `remote: "absent"` for the wrong reason, and three places
(this doc, the migration's table comment, and `verdictFromAnswer`'s own JSDoc) asserted
it settles receipts when nothing on the Python side had ever written one.
`api/health_routes.py` now records each completed operation (`_record_operation`, keyed
by request id, bounded to 24h/500 entries) as `operate_agent` finishes, and serves it
back from a new `GET /api/v1/health/agent-operations/{request_id}` — so a 404 today
means what the gateway's comment already claimed: no record — most often because the
operation has not finished yet (the record is written only on completion), but also
because it was never received, this process restarted, or the entry aged out.
`operate_agent` is still fully synchronous (no wait budget, no `202`/`running` path); the
JSDoc that implied one was corrected rather than the behaviour invented. **[CORRECTED
2026-09-19, wave-5 IJ confirm R1: the "most often because the operation has not finished
yet" clause above held for one day and no longer does — see the dated paragraph below.
The record is no longer written only on completion.]** Six new `test_health_routes.py`
cases cover the write, the read, a failure recorded as `failed`, the 404 case, the
admin-key gate, and both eviction rules. Per ADR 0149 row 42 (founder, 2026-09-18):
read-repair stays rather than being dropped, and the desk now says so plainly rather than
leaving a receipt sitting in `unknown` with no explanation — a receipt whose remote
reconciliation comes back `absent` (its record gone, most often a restart) carries its
own caption naming that (`AdminDesk.tsx`).

**A "running" record is now written before dispatch, not only on completion
(2026-09-19, wave-5 IJ confirm R1).** The paragraph above closed out `operate_agent`'s
own docstring claim that "there is no in-progress running state to poll for today" —
true the day it was written, but it left a gap the same confirm pass's own reconcile()
JSDoc had already anticipated (`agent-operations.controller.ts`'s `RemoteCheck` doc,
`running` — "the orchestrator is still working on it"): between a gateway timeout and
the operation's actual completion, `GET /health/agent-operations/{request_id}` 404'd
exactly like a genuinely lost request, because nothing was written until the end. Both
triggers were real: `AdminDesk.tsx`'s `operate()` re-reads immediately in its `finally`
clause, and the 30s poll re-reads throughout a slow drain — either could land in that
window and tell the reader a receipt was gone and would not settle, while the
orchestrator was still working on it. `operate_agent` now calls
`_record_operation(..., "running")` the moment it acquires its per-agent lock, before
calling `restart_agent`/`stop_agent`, and updates the same request id to
`"succeeded"`/`"failed"` on completion (re-inserted, not mutated in place, so the 24h
sweep's order-tracks-recency assumption still holds). The gateway's own `reconcile()`
needed no change — its `state === "running"` branch (`agent-operations.controller.ts`,
inside `reconcile`) already existed and was simply never fed. **[CORRECTED 2026-09-19,
wave-5 IJ verify pass: this understated it. The branch named above
(`agent-operations.controller.ts:356-357`) is a no-op that only matches a receipt
already stored as `running` — it cannot fire on the transition this fix creates,
because the row is still `requested`/`unknown` at that point. What actually persists
`running` is the conditional update a few lines below it
(`agent-operations.controller.ts:360-374`, inside the same `reconcile`): a `requested`
or `unknown` receipt whose orchestrator record now reads `running` is written to
`status: 'running', completed_at: null, error_code: null`. That is new, exercised
behaviour, not a previously-idle branch finally getting fed.]** `operate_agent`'s POST
response itself is unchanged: still fully synchronous, no wait budget, no `202` path.

**Wave-5 IJ confirm-fix pass, 2026-09-19 — five more items, all measured.** Besides the
running-record fix above (R1), this pass: (R2) replaced the P2 fallback test with one
run as `mocks.role = 'manager'` — the one case where `knownOperator`'s own correctness,
not `settle()`'s stale-value carry-over or the owner role's blanket access, decides
whether the cycle reads `/health/agent-operations` at all; mutating the fallback used to
leave all 17 prior `AdminDesk.test.tsx` cases green, now it fails one. (R3) corrected
`AGENT_OPERATION_TIMEOUT_MS`'s comment: 30s + 30s = 60s exactly, not "exceeded", matching
this doc's own "at, not safely past" line above. (R4) re-anchored every citation this
pass's edits moved. (R5) `AdminPanel.tsx`'s provider read now reports "Permission
needed" rather than "Unknown" on a 403, and `AdminHealth.tsx`'s poll toasts once per
distinct failure reason instead of every 30s while a cause persists — both now covered by
new tests (`AdminPanel.test.tsx`, `AdminHealth.test.tsx`; neither page had a test file
before this pass). (R6) corrected `admin-health.md`'s Consolidation section, which
asserted the page's code was unchanged while its own next sentence, and now this pass,
both changed `fetchHealth`. Measured this session (clean run, this worktree, synced onto
`origin/main` `cb756083e`): `python3 -m pytest tests/test_agent_lifecycle.py
tests/test_health_routes.py` → 54 passed (up from 52: one new running-while-in-flight
case, mutation-tested against a reverted fix; one new sweep-reinsertion case, mutation-
tested against a reverted fix); `black --check` and `ruff check` on every touched `.py`
file → clean. `cd apps/web && npx tsc --noEmit` → clean; targeted `npx vitest run` on
`AdminDesk.test.tsx` + the two new page test files → 22 passed (17 + 3 + 2). `cd
apps/api-gateway && npx tsc -p tsconfig.json --noEmit` and `-p tsconfig.spec.json` → both
clean; targeted `npx jest --runInBand --forceExit` on `agent-operations.controller.spec.ts`
+ `platform-operator.service.spec.ts` + `platform-operator.routes.spec.ts` → 82 passed.
Not run: the full `services/agent-orchestrator/tests/` suite and web/gateway ESLint —
out of scope for a targeted lane pass (heavy-suite and lint-workaround runs are reserved
for the merge train); web ESLint additionally still needs the `eslint-plugin-jsx-a11y`
scratch-dir workaround this repo's tooling notes describe, unchanged by this pass.

**OD-03 core-line diet — resolved, 2026-09-18 (ADR 0149 row 41).** The founder ruled that
ADR 0039's Track A "no `core/` extension while A1 runs" clause (`ADR 0039:37`) does not
bind this product lane, and accepted the growth as it stands: `core/*.py` measured
6817→7048 lines against `origin/main` (+231 — the earlier +199 plus 11 lines for the
`agent_registry.py` suspend-monitor fix plus 21 lines for the `_drain_tasks`
forgotten-handle fix, both above), every agent now holding a full local queue's broker
deliveries unacknowledged rather than dropping the oldest one (`drop_oldest_on_overflow`,
`base_agent.py:221`, now unread), and `MessageBus` gaining a public `stop_consuming()`.
Recorded as a dated addendum to
[[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms|ADR 0143]] rather than
re-argued here. The two smaller items that rode on the same question stand as built and
are unchanged by this ruling: an operator's stop still lasts only until the next deploy
or process restart, not past one, and the gateway's operate-call timeout stays at 60s
(`AGENT_OPERATION_TIMEOUT_MS`, `orchestrator.service.ts`) — at, not safely past, the
~60s worst case (30s drain + up to 30s subclass `cleanup()`), so a slow restart can still
read "unknown" on a bad day; raising it further remains a smaller, separately-decidable
follow-up, not reopened by this ruling. Whether the legacy `/admin` and `/admin/health`
pages may degrade on merge while the flag is off is answered above (no — reverted).
