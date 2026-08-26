---
type: page
route: /admin/health
slug: admin-health
component: apps/web/src/pages/AdminHealth.tsx
audience: dev
tier: core
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[admin]]"]
---

# /admin/health

## Surface — buttons → where they go

- **Refresh (button / `r`)** → API `GET /api/v1/health/agents`
- **Agent card** → (drill-down sheet on this page) → API `GET /api/v1/health/agents/:name`
- **Healthy / unhealthy filter** → (filters the card grid on this page)
- (no outbound navigation — dead-end page)

## 1. Purpose
Live agent-health board: card grid of orchestrator agents (status, version, capabilities), polled every 30s (`AdminHealth.tsx:63-67`), with a healthy/unhealthy filter (NEW-549) and a per-agent drill-down sheet showing the raw JSON health payload (NEW-548 — "GET /health/agents/:name already existed but nothing called it", `AdminHealth.tsx:69`). Keyboard: `r` refreshes, `Esc` closes the sheet (NEW-553, `AdminHealth.tsx:84-95`). The sheet states plainly that restart control is not exposed (`AdminHealth.tsx:252`).

## 2. Entry
**No inbound in-app link** — cold URL only, confirmed by [PAGE_MAP](../foundation/PAGE_MAP.md) entry-points list. Not linked even from `/admin`'s Agents tab.

## 3. Files
- Route binding: `apps/web/src/App.tsx:291` (lazy, `App.tsx:90`)
- `apps/web/src/pages/AdminHealth.tsx` (259 lines, self-contained)

## 4. Endpoints
| Method | Path | Where called | Atlas |
|---|---|---|---|
| GET | `/api/v1/health/agents` | `AdminHealth.tsx:51` (30s poll) | ENDPOINTS.md:116 |
| GET | `/api/v1/health/agents/:name` | `AdminHealth.tsx:74` (drill-down) | ENDPOINTS.md:117 |

Both send `Authorization: Bearer` read from localStorage directly (`AdminHealth.tsx:50,73`) — raw axios, not the shared client, so no token auto-refresh.

## 5. Signals
**none.**

## 6. Tier cut
Internal ops/dev surface; no `S..` touches it (OD-48). Adjacent to S09's connector-reliability concerns but agent-level, not connector-level.

## 7. Rebrand surface
**0.** No WineOps strings; empty state mentions "Railway" as the deploy target (`AdminHealth.tsx:168`) — infra naming, not brand.

## 8. State & config
- `VITE_API_GATEWAY_URL` (`AdminHealth.tsx:7`). No flags, no role gate in-page.

## 9. Gaps
- ~~Same access-control gap as `/admin`~~ — **closed.** `App.tsx:291` now carries `requiredRole="owner"` (landed 2026-08-24, `fc340b7d`). Effective gate is owner **or manager** (`ProtectedRoute.tsx:62-65`).
- Duplicates `/admin`'s Agents tab — and since `/admin`'s 2026-08-25 fix (see [[admin]] §10) **both now take the same gateway-proxy path**, so this is straightforward duplication rather than two half-views. Candidates for merging.

---

## 10. Maturity — **partial**

The board works — it was the surface that got the health proxy *right* first, and
[[admin]] was later fixed to match it. Two things keep it from complete: a failed fetch
is indistinguishable from an empty orchestrator, and the page has no inbound link.

- **Working:** `GET /api/v1/health/agents` with the user's JWT (`AdminHealth.tsx:50-53`)
  through `HealthProxyController` (`apps/api-gateway/src/common/orchestrator/health-proxy.controller.ts:27-30`)
  → `OrchestratorService.getAgentHealthAll` (`orchestrator.service.ts:82-87`), which adds
  `X-Admin-Key` server-side (`:78-79`). 30-second poll (`:63-67`), healthy/unhealthy
  filter (`:97-99`, NEW-549), per-agent drill-down sheet over
  `GET /api/v1/health/agents/:name` (`:70-82`, NEW-548), `r`/`Esc` keys (`:84-95`,
  NEW-553). The sheet states plainly that restart control is not exposed (`:251`).
- **Error is rendered as empty.** `fetchHealth` catches, fires a toast and returns
  (`:56-60`) — `agents` is never set, so the page falls through to
  *"No agents running — The orchestrator has no active agents. Check that the
  agent-orchestrator service is running on Railway."* (`:163-169`). A 401, a 404, a dead
  gateway and a genuinely idle orchestrator all render identically. Compare [[admin]],
  which distinguishes them by status code (`AdminPanel.tsx:353-360`) and keeps a distinct
  `NO_AGENTS_MESSAGE` (`:71`) for the real empty case.
- **The toast repeats every 30 seconds** while the failure persists (`:57` inside the
  polled `fetchHealth`, `:65`) — an unreachable orchestrator produces a toast every half
  minute for as long as the tab is open.
- **Stale-on-error:** a failure leaves the previous `agents` array in place (`:54` is
  never reached), so the header keeps reporting "n/n healthy" (`:109-113`) from data that
  may be minutes old, with only `lastUpdated` (`:138-142`) hinting at it.
- **No inbound link anywhere.** Cold URL only (§2) — including from `/admin`'s Agents tab,
  which shows a worse version of the same thing.
- Raw axios with a `localStorage` token (`:50,73`), not the shared client — no automatic
  token refresh, so a long-lived tab starts 401-ing and reports "no agents running".

## 11. Data flow

**Calls out**

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `{VITE_API_GATEWAY_URL}/api/v1/health/agents` (30 s poll) | Bearer from `localStorage` (`:50-52`) | `common/orchestrator/health-proxy.controller.ts:27-30` → `orchestrator.service.ts:82-87` | `{agents:[{agent_name, version, status, healthy, capabilities}]}` — `core/base_agent.py:990-1004` via `api/health_routes.py:244-258` |
| GET | `…/api/v1/health/agents/:name` (drill-down, 8 s timeout) | Bearer (`:73-76`) | `health-proxy.controller.ts:32-35` → `orchestrator.service.ts:89-97` | `get_detailed_health` (`core/base_agent.py:1006-1025`), rendered as raw JSON (`:246-248`) |

The gateway is the only place `ADMIN_API_KEY` lives; the orchestrator refuses both routes
without a matching `X-Admin-Key` (`api/health_routes.py:230-241`).

**Fed by**

- The running Python agents. Each `BaseAgent` subclass maintains its own `AgentMetrics`;
  `health_routes.py:244` enumerates whatever the orchestrator registry has started
  (`core/orchestrator.py:188`). There is no cache and no sweep — the numbers are read
  live off the process, which is why the page is honest when it works.
- Nothing else writes to this. No cron, no webhook, no DB table.

**Writes**

- **Nothing.** Two GETs, zero mutations. The drill-down sheet's own footer says restart
  control is not exposed (`:251`), and there is no other action on the page.
- Consequently nothing downstream reacts to anything here — it is pure observation.

## 12. Design intent

**Should be:** the fastest answer to "which agent is stuck" — liveness at a glance,
one click to the evidence, and one click to act on it. Two of those three exist.

| State | Implemented? | Evidence |
|---|---|---|
| Empty | **yes**, but overloaded — the same card serves "no agents" and "fetch failed" (`:163-169`) |
| Loading | **yes** — spinner + "Loading agent health…" (`:156-162`); sheet has its own "Fetching live health…" (`:244`) |
| Error | **no.** Toast only (`:57`), then the empty state. The drill-down *does* have one — `{ error: 'Could not reach this agent.' }` (`:80`) — so the pattern exists on the page and was not applied to the list |
| Permission-denied | **yes** — route-level "Access Denied" (`ProtectedRoute.tsx:67-101`) via `requiredRole="owner"` (`App.tsx:291`) |

**Where the UI misleads**

1. **"The orchestrator has no active agents"** when the orchestrator was never reached
   (`:56-60` → `:163-169`). It even names a likely cause ("running on Railway") for a
   condition it has not established.
2. **"n/n healthy" persists through failures** (`:109-113`) because `agents` is not
   cleared on error — a green count computed from stale data.
3. The **filter chips and the healthy count vanish when `agents.length === 0`**
   (`:109,117`), so the page silently loses its own controls in exactly the state where a
   user is trying to work out what is wrong.

## 13. Roadmap

1. **Split error from empty** — hold an `error` state, render it instead of "No agents
   running", and clear `agents` on failure. Three lines; removes the page's only real
   dishonesty. The drill-down already models the pattern (`:80`).
2. **Stop the 30-second toast loop** — toast once per transition into failure, not once
   per poll (`:57`).
3. **Link it from `/admin`'s Agents tab** so it stops being a cold URL, or merge the two
   (see [[admin]] §13.5). They now use the identical transport, so merging is a
   consolidation, not a rewrite.
4. **Use the shared API client** instead of raw axios (`:50,73`) so a long-lived tab
   refreshes its token rather than degrading into a fake empty state.
5. **Add restart/drain once the orchestrator exposes control** — the sheet already
   reserves the space and explains its absence (`:251`). *Blocked: same missing
   orchestrator control endpoint as [[admin]] §13.3.*
