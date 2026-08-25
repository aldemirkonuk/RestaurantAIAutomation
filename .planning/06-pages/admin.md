---
type: page
route: /admin
slug: admin
component: apps/web/src/pages/AdminPanel.tsx
audience: owner
tier: core
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]", "[[admin-health]]"]
---

# /admin

## 1. Purpose
"Admin Settings" — four tabs (General / Agents / Notifications / Integrations, `AdminPanel.tsx:299-304`). General shows infra-provider health (Supabase, Gemini, Claude, plus hard-coded RabbitMQ/Redis rows, `AdminPanel.tsx:184-188`) and restaurant knobs (buffer window, default threshold, three feature toggles). Agents shows orchestrator metrics per agent. Two honesty fixes are load-bearing here: **Save persists to localStorage only** and the toast says so — there is no admin-config endpoint (NEW-544, `AdminPanel.tsx:249-268`); **Restart isn't wired** — the button re-checks live health and says restart needs an orchestrator control endpoint that doesn't exist (NEW-545, `AdminPanel.tsx:270-297`).

## 2. Entry
Sidebar "Admin Panel" under an Admin section rendered only for `user?.role === 'owner'` (`Sidebar.tsx:584-597`). The route itself is *not* role-gated (see §9). Not in PAGE_MAP's no-inbound list — the sidebar edge is the inbound link.

## 3. Files
- Route binding: `apps/web/src/App.tsx:288` (lazy, `App.tsx:89`)
- `apps/web/src/pages/AdminPanel.tsx` (739 lines)

## 4. Endpoints
| Method | Path | Where called | Atlas |
|---|---|---|---|
| GET | `/api/v1/health/providers` | `AdminPanel.tsx:173` (General tab) | ENDPOINTS.md:118 |
| GET | `${VITE_AGENT_ORCHESTRATOR_URL}/health/agents` | `AdminPanel.tsx:215` — **direct to orchestrator, bypasses the gateway, no auth header** | not a gateway route |
| GET | `/api/v1/health/agents/:name` | `AdminPanel.tsx:282` (restart-button health re-check) | ENDPOINTS.md:117 |

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
- **Route is reachable by any authenticated user** — `App.tsx:288` sits inside the plain `ProtectedRoute` wrapper with no `requiredRole` (`App.tsx:247-252`); only the sidebar *link* is owner-gated. A hidden route is not access control (the codebase says this itself at `App.tsx:265-267` about `/vendor-prices`).
- The orchestrator call at `AdminPanel.tsx:215` goes direct with no bearer token; in deployments where the orchestrator isn't publicly reachable this tab always shows the graceful error (`AdminPanel.tsx:236`).
- RabbitMQ/Redis rows are hard-coded "Active/Running" (`AdminPanel.tsx:186-187`) — decorative, not measured.
- NEW-544/NEW-545 remain open in spirit: the page is honest about the missing endpoints, but the endpoints are still missing.
