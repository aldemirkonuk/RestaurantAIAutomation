---
type: page
route: /admin/health
slug: admin-health
component: apps/web/src/pages/AdminHealth.tsx
audience: dev
tier: core
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]", "[[admin]]"]
---

# /admin/health

## 1. Purpose
Live agent-health board: card grid of orchestrator agents (status, version, capabilities), polled every 30s (`AdminHealth.tsx:63-67`), with a healthy/unhealthy filter (NEW-549) and a per-agent drill-down sheet showing the raw JSON health payload (NEW-548 — "GET /health/agents/:name already existed but nothing called it", `AdminHealth.tsx:69`). Keyboard: `r` refreshes, `Esc` closes the sheet (NEW-553, `AdminHealth.tsx:84-95`). The sheet states plainly that restart control is not exposed (`AdminHealth.tsx:252`).

## 2. Entry
**No inbound in-app link** — cold URL only, confirmed by [PAGE_MAP](../foundation/PAGE_MAP.md) entry-points list. Not linked even from `/admin`'s Agents tab.

## 3. Files
- Route binding: `apps/web/src/App.tsx:289` (lazy, `App.tsx:90`)
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
- Same access-control gap as `/admin`: no `requiredRole` on the route (`App.tsx:289` inside the plain `ProtectedRoute`) — any authenticated staff member can watch agent internals.
- Duplicates `/admin`'s Agents tab at a different fidelity via a different path (gateway vs direct orchestrator) — two half-views of the same data; candidates for merging.
