---
type: page
route: /studio/queue
slug: studio-queue
component: apps/web/src/pages/studio/StudioApprovalQueue.tsx
audience: dev
tier: core
signals_today: none
rebrand_strings: 1
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[studio]]", "[[studio-certify]]"]
---

# /studio/queue — override approval queue

## Surface — buttons → where they go

- **Studio** (header) → [[studio]] `/studio`
- **Certify** (header) → [[studio-certify]] `/studio/certify`
- **Approve / Reject** → API `PATCH /api/v1/studio/queue/:id`

## 1. Purpose
Review-admin surface: approve or reject field overrides submitted by certified
contributors (the D-12/D-14 human gate on catalogue edits). One decision per row,
optional note.

## 2. Entry
No inbound in-app link (`PAGE_MAP.md` entry-point list) except the studio header's
"Queue" link, which only renders for review_admin/developer
(`StudioLayout.tsx:46-57`). Route gate: `requiredStudioRole={['developer','review_admin']}`
(`App.tsx:176-183`).

## 3. Files
- Route: `apps/web/src/App.tsx:176-183` → `pages/studio/StudioApprovalQueue.tsx` (98 lines)
- `pages/studio/queue/QueueTable.tsx` (37), `QueueRow.tsx` (174), `TrustProgress.tsx` (23)
- Shell: `pages/studio/StudioLayout.tsx`

## 4. Endpoints
- `GET /api/v1/studio/queue` — 30s poll (`StudioApprovalQueue.tsx:17,34-38`)
- `PATCH /api/v1/studio/queue/:id` — `{decision: approved|rejected, note}`
  (`StudioApprovalQueue.tsx:22-30`)
Server: orchestrator `studio_routes.py:284` (GET) and the PATCH listed at
`studio_routes.py:11`; review_admin-only server-side. Not in the gateway atlas —
subject to the same routing gap as [[studio]] §9.

## 5. Signals
none.

## 6. Tier cut
Outside the tier axis — internal review tooling feeding S06/S17 data quality.

## 7. Rebrand surface
1 — shared "WineOps Studio" header (`StudioLayout.tsx:33`).

## 8. State & config
Studio role gate (§2); Bearer token read from localStorage
(`StudioApprovalQueue.tsx:11-14`). 30-second refetch interval.

## 9. Gaps
- Same **/api routing gap** as [[studio]] §9: both calls route to the NestJS gateway
  (dev proxy `vite.config.ts:24-28`, prod rewrite `vercel.json`), which has no
  `/studio` module — as configured they 404.
- No pagination on the queue fetch; fine at current volume, unbounded by contract.
