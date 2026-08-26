---
type: page
route: /receiving/:orderId/door
slug: receiving-door
component: apps/web/src/pages/receiving/DoorReceipt.tsx
audience: staff
tier: core
archetype: focused # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[orders]]"]
---

# /receiving/:orderId/door — Door receipt

## Surface — buttons → where they go

- **Done** → API `POST /api/v1/procurement/receiving/orders/:orderId/door` (offline-queued via doorOutbox)
- **Finish** (success panel) → [[orders]] `/orders`
- **Back** (header) → browser history back

## 1. Purpose

"What happens when the truck arrives" (`DoorReceipt.tsx:1-20`): a full-screen,
one-handed flow asking exactly three things — a photo of the paper the driver handed
over, how many boxes, was anything obviously broken. **No prices anywhere** and no
"does this match the order?" — the count and four-way match happen later at a desk.
Designed for a porter on a sidewalk with a phone at 12% and no signal in the walk-in.

## 1a. Features
- Full-screen, one-handed door flow asking exactly three things: photo of the paper the driver handed over, how many boxes, was anything obviously broken
- Works offline — submissions queue in an outbox and sync later, nothing is lost in the walk-in
- No prices anywhere by design; the count and match happen later at a desk

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

## 10. Maturity

**partial.** The flow itself is the most carefully built write path in the app; it is
partial only because **nothing can reach it** — its sole parent is broken.

| Evidence | `path:line` |
|---|---|
| **The write is real, idempotent and self-correcting.** A door receipt inserts `procurement_receipt_events` (`stage: 'case_count'`), then books only the *difference* against `quantity_received`, so a door count following `markDelivered` corrects rather than doubles. | `receiving.service.ts:96-185` |
| **Retries are handled at the database, not the client.** `23505` on the idempotency index returns `{ alreadyRecorded: true }` — the correct answer to a retry, not an error. Combined with the client outbox this makes a lost cellar signal safe. | `receiving.service.ts:142-148`; `lib/doorOutbox.ts:58,103` |
| **Cost is deliberately omitted** — no `p_unit_cost`, so the lot lands `cost_provenance='estimated'` and `verifyReceipt` corrects it to landed cost later. A guessed cost is explicitly refused. | `receiving.service.ts:174-178` |
| A previous silent-zero defect here is **already fixed and documented in place**: `receipt`/`receiving` were not valid enum values, the RPC threw on the cast, and every door receipt booked zero stock while reporting success. Now `purchase`/`order`. | `receiving.service.ts:164-171` |
| **Photo upload is proposal-only, and says so** — nothing is written to stock, cost or the order. | `services/api/receiving.ts:79-84`; `documents.controller.ts:46` |
| **Unreachable.** The only inbound edge is [[receiving]]'s staff list, which returns 400 and renders as empty (see [[receiving]] §10). `/receiving` itself has no inbound link. In practice this screen can only be reached by typing a URL that contains an order UUID. | `App.tsx:199-206`; [[receiving]] §2, §10 |

## 11. Data flow

### Calls out

| Method · Path | Auth | Gateway controller | Returns |
|---|---|---|---|
| POST `/procurement/receiving/orders/:orderId/door` | JWT (class) | `receiving.controller.ts:119` → `receiving.service.ts:96` | `{ alreadyRecorded, eventId, countedQtyBottles, stockDelta }` |
| POST `/procurement/documents` | JWT (class) | `documents/documents.controller.ts:46` | `{ documentId, duplicate, document }` — a classification *proposal*; content-addressed on `sha256` |

Both go through `apiClient`, so both carry the bearer token — unlike the analytics
surfaces on [[orders]] and [[inventory]].

### Fed by

| Producer | Mechanism | `path:line` |
|---|---|---|
| The order being received | POs from [[orders]] / the recurring cron | `recurring-orders.service.ts:225,271` |
| `packSize` fallback | the order line's `unit_type`/`bottles_total` | `receiving.service.ts:110` |
| Nothing else | this page is an *origin* of data, not a consumer of it | — |

**This page is a producer, not a consumer** — it is one of the few screens in the repo
that creates ground truth rather than displaying someone else's.

### Writes

| Write | Lands in | Downstream reacts |
|---|---|---|
| Door receipt | `procurement_receipt_events` + `apply_stock_movement` (live, delta-corrected) | [[inventory]] live stock; [[receiving]]'s "counted by case, not by bottle" unverified strip and its ageing severity tiers; ultimately the four-way match and `procurement_credits` |
| Document photo | `procurement_documents` (sha256-deduped) | the invoice match on [[inventory]]'s `ReceivingWorkspace`; the same table the 5-min email sweep writes into (`document-intake.service.ts:581`) |

## 12. Design intent

**Should be:** thirty seconds, one hand, no prices — a photo, a box count, and whether
anything was obviously broken. Everything harder happens at a desk at 2pm.

| State | Handled? | Evidence |
|---|---|---|
| loading | ✅ | `DoorReceipt.tsx` |
| empty | n/a | the page is a form, not a list |
| error | ✅ **properly** — a failed submit queues in the outbox instead of losing the receipt | `lib/doorOutbox.ts:58,103` |
| permission-denied | ⚠️ implicit — the page renders outside `DashboardLayout` and shows no cost, so there is nothing to deny; it does not check that the caller may receive this order (the server does) | `App.tsx:193-198` |

**Where the UI misleads: nowhere found.** This is the reference example in the repo for
the opposite habit — it declines to display a cost it has not verified, refuses to ask a
question the receiver cannot answer, and its "unverified" state is derived from a query
rather than faked into a column (`receiving.service.ts:36-42`).

## 13. Roadmap

1. **Unblock the entrance.** Nothing here needs building; [[receiving]] §13.1 needs
   fixing. Until then this screen ships and is unusable. *Blocker: [[receiving]]'s staff
   query.*
2. **Turn on the uxSignals reporter for the six markers already placed here** —
   `door:cancel`, `door:photo`, `door:skip-photo`, `door:submit`, `door:finish` plus the
   container (`DoorReceipt.tsx:152,191,210,275,303,364`). This is the single screen used
   under real physical friction and the only one where drop-off data would change a
   design decision. *Blocker: `lib/uxSignals.ts:15` ships dark behind `VITE_UX_OPTIMIZER`
   and its hook has zero importers.*
3. Add a deep link from a low-stock or delivery notification straight to
   `/receiving/:orderId/door`, so the porter's path is one tap from a push, not two pages.
4. Show the outbox depth somewhere on the page — a receiver on dead signal currently gets
   the same success screen as one who is online.
