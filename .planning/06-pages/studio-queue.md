---
type: page
route: /studio/queue
slug: studio-queue
softwares: [wine-studio]
component: apps/web/src/pages/studio/StudioApprovalQueue.tsx
audience: dev
tier: core
archetype: list+detail # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 1
maturity: broken
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[studio]]", "[[studio-certify]]"]
---

# /studio/queue — override approval queue

> **Part of** [[08-softwares/wine-studio|Wine Studio]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Studio** (header) → [[studio]] `/studio`
- **Certify** (header) → [[studio-certify]] `/studio/certify`
- **Approve / Reject** → API `PATCH /api/v1/studio/queue/:id`

## 1. Purpose
Review-admin surface: approve or reject field overrides submitted by certified
contributors (the D-12/D-14 human gate on catalogue edits). One decision per row,
optional note.

## 1a. Features *(internal review tooling)*
- Approve or reject field overrides submitted by certified contributors, one decision per row
- Optional note per decision; contributor trust progress display

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

---

## 10. Maturity — **broken**

The page cannot load its queue in any environment, but it is the one studio page that
**says so instead of pretending**.

- Both calls are bare relative fetches — `fetch('/api/v1/studio/queue')`
  (`StudioApprovalQueue.tsx:17`) and the PATCH at `:23`. Relative `/api/v1/*` resolves
  to the NestJS gateway (`apps/web/vite.config.ts:24-27` → `localhost:4000`;
  `vercel.json:7-10` → the Railway gateway), which mounts everything under `api/v1`
  (`apps/api-gateway/src/main.ts:77`) and has no studio controller (grep
  `@Controller("studio"` in `apps/api-gateway/src`: zero hits). Both 404.
- Unlike [[studio]]'s `CommandBar` (`CommandBar.tsx:42`, which now prefixes
  `VITE_AGENT_ORCHESTRATOR_URL`), **this page never got the fix.**
- The **server side is complete and correct** — `GET /api/v1/studio/queue` with
  `limit`/`offset` (`api/studio_routes.py:284-289`), `PATCH …/queue/{id}` decision
  handling (`:411`), review_admin/developer enforced by JWT + role lookup
  (`services/override_service.py:34-79`). Nothing needs building behind this page;
  it needs a base URL.
- Honest failure: `isError` renders "Could not load the approval queue." with a Refresh
  action (`StudioApprovalQueue.tsx:77-82`). Compare [[studio-certify]], which renders
  an empty state on the same 404.
- The header badge is the one lie — with `data` undefined, `pending = data?.total ?? 0`
  (`:54`) so the page shows a green **"All clear"** badge (`:65`) above the error text.

## 11. Data flow

**Calls out**

| Method | Path | Auth | Server | Returns / today |
|---|---|---|---|---|
| GET | `/api/v1/studio/queue` (relative, 30 s poll) | Bearer from `localStorage` (`:11-14`); server verifies the Supabase JWT and requires `developer`/`review_admin` (`override_service.py:34-79`) | `api/studio_routes.py:284-289` | `{queue[], total}` of `override_events` with `promotion_status='pending'`, hydrated with submission context (`_hydrate_queue_rows`, `:322`). **404s at the gateway** |
| PATCH | `/api/v1/studio/queue/:id` | Bearer, review_admin/developer | `api/studio_routes.py:411` | `{decision: approved\|rejected, note}` → applies or discards the override, updates contributor trust (`check_and_update_trust`, imported `studio_routes.py:48`). **404s at the gateway** |

**Fed by**

- Rows arrive from **[[studio]]'s override submission**: `POST /api/v1/studio/overrides`
  → `submit_override` (`studio_routes.py:161`). A `certified_contributor` without
  `promotion_policy == 'auto_promote'` produces `promotion_status='pending'`
  (`:212-225`) — that is this queue's only producer.
- A `developer`/`review_admin` override is `auto_promoted` immediately (`:213-214`) and
  never appears here. **So while [[studio]]'s override call 404s (see its §10), this
  queue has no producer at all** — a page whose data has no upstream is a finding, and
  this is one: the queue is empty by construction today, not by good hygiene.
- `TrustProgress.tsx` renders the contributor trust counter that `check_and_update_trust`
  maintains — the D-12 path by which a contributor earns auto-promotion.

**Writes**

- `override_events.promotion_status` → `approved` / `rejected`, with the reviewer's note.
- On approve: `master_wine_library_submissions.field_confidence` is patched
  (`_apply_override_to_submission`) and a library promotion is attempted
  (`_maybe_promote_submission`) — both imported at `studio_routes.py:44-47`.
- Downstream: contributor trust counters, and the `auto_promoted` / `accepted_overrides`
  / `acceptance_rate` figures the [[studio]] metrics strip reads (`studio_routes.py:579`).

## 12. Design intent

**Should be:** the human gate on catalogue edits (D-12/D-14) — one contributor edit per
row, enough context to judge it without leaving the page, approve or reject with a note,
and visible trust accrual so a good contributor eventually stops needing the gate.

| State | Implemented? | Evidence |
|---|---|---|
| Empty | **yes** — "All caught up / No overrides are waiting" (`:83-91`) | |
| Loading | **yes** — three skeleton rows (`:73-76`) | |
| Error | **yes**, with a retry (`:77-82`) — the only studio page that branches on `isError` | |
| Permission-denied | **yes** — route gate renders "Studio Access Required" (`ProtectedRoute.tsx:105-124`) | |

**Where the UI misleads**

1. **The "All clear" badge renders during the error state** (`:54,62-66`) — a green
   success signal sitting directly above "Could not load the approval queue."
2. Success toasts fire from `onSuccess` only (`:43-46`), so those are honest — but note
   the contrast with [[studio-certify]], whose equivalents are not.
3. §9's "no pagination" is half-right and now corrected: **the server takes `limit`/
   `offset`** (`studio_routes.py:285-287`); the client simply never sends them.

## 13. Roadmap

1. **Prefix the two calls with the orchestrator base**, exactly as `CommandBar.tsx:42`
   does. This is the whole fix — the backend is already complete.
2. **Suppress the "All clear" badge unless the query succeeded** (`:54,62-66`).
3. **Restore the producer** — the queue stays empty until [[studio]]'s override POST
   reaches the orchestrator (its §13 item 1). *Blocked on that, not on this page.*
4. Pass `limit`/`offset` and add a "load more" once volume warrants; the server already
   supports it.
5. Surface `citation_snippet` alongside the citation link. The row already renders
   `citation_url` as an outbound link (`queue/QueueRow.tsx:97-99`) and the reason
   (`:90-94`), but `citation_snippet` — collected by the override POST
   (`studio_routes.py:240`) — is absent from the `QueueItem` type (`QueueRow.tsx:8-24`),
   so a reviewer must open the source page to check a claim they could have read inline.
