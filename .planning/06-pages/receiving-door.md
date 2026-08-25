---
type: page
route: /receiving/:orderId/door
slug: receiving-door
component: apps/web/src/pages/receiving/DoorReceipt.tsx
audience: staff
tier: core
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]"]
---

# /receiving/:orderId/door — Door receipt

## 1. Purpose

"What happens when the truck arrives" (`DoorReceipt.tsx:1-20`): a full-screen,
one-handed flow asking exactly three things — a photo of the paper the driver handed
over, how many boxes, was anything obviously broken. **No prices anywhere** and no
"does this match the order?" — the count and four-way match happen later at a desk.
Designed for a porter on a sidewalk with a phone at 12% and no signal in the walk-in.

## 2. Entry

From `/receiving` (staff view rows) — the only inbound edge
([PAGE_MAP](../foundation/PAGE_MAP.md):87). Deliberately **outside DashboardLayout**:
"Sidebar, tips and the agent FAB would all be taps in the way of a driver waiting"
(`apps/web/src/App.tsx:193-198`). PAGE_MAP:159 lists the component as unresolved in
its graph — the binding is `App.tsx:199-206`.

## 3. Files

- Route binding: `apps/web/src/App.tsx:199-206` (lazy import :78).
- `apps/web/src/pages/receiving/DoorReceipt.tsx` (414 lines).
- Offline queue: `apps/web/src/lib/doorOutbox.ts` (imported DoorReceipt.tsx:10);
  upload helpers `lib/uploadAccept.ts` (:12).

## 4. Endpoints

Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):420 (`procurement/receiving`),
:378 (`procurement/documents`).

| Method | Path | Call site |
|---|---|---|
| POST | `/procurement/receiving/orders/:orderId/door` | via outbox — `lib/doorOutbox.ts:58,103` → `services/api/receiving.ts:63` (idempotent on `idempotencyKey`) |
| POST | `/procurement/documents` | photo upload, `DoorReceipt.tsx:98` → `services/api/receiving.ts:98` (proposal only — "Nothing is written to stock, cost or the order", receiving.ts:84-88) |

## 5. Signals

**None emitted.** Six `data-ux-key` markers — `door:cancel`, `door:photo`,
`door:skip-photo`, `door:submit`, `door:finish`, plus a container key
(`DoorReceipt.tsx:152,191,210,275,303,364`) — but the uxSignals reporter is dark
(`lib/uxSignals.ts:15`) with no consumer. This page is the strongest argument for
turning the reporter on: it is the one screen used under real physical friction.

## 6. Tier cut

**Core** — operate. The S02 "one-tap accept/short/damaged" and S03 damage-photo rows
ship through this screen ([TIER-MAP](../03-scenarios/TIER-MAP.md):38-39).

## 7. Rebrand surface

**0 user-visible strings** (no `wineops` hits). No layout chrome either — the page
renders outside DashboardLayout, so it carries no WineOps wordmark at all.

## 8. State & config

- Submissions queue through `doorOutbox` so a dead cellar signal cannot lose the
  receipt (`lib/doorOutbox.ts:58,103`); idempotency is client-generated
  (`services/api/receiving.ts:59-62`).
- Camera/file intake constrained by `SCAN_ACCEPT` mime resolution
  (`DoorReceipt.tsx:12`).
- No feature flags or env gates beyond the shared `VITE_API_GATEWAY_URL`.

## 9. Gaps

- Inherits `/receiving`'s reachability problem (receiving.md §9): the only path to
  this URL is a page nothing links to.
- None recorded against this page in `v3.0-TECH-DEBT.md` (checked "receiving" and
  "door" — no hits).
