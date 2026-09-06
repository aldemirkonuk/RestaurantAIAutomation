---
type: page
route: /receiving/:orderId/door
slug: receiving-door
softwares: [receiving]
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

> **Part of** [[08-softwares/receiving|Receiving]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

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

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_receiving_door`)

> **Chrome (2026-09-04): none, and that is the decision.** The house header
> built this wave (`apps/web/src/components/mudavym/HouseHeader.tsx`, mounted by
> `PageGate`) deliberately does NOT render here. The door is routed outside
> `DashboardLayout` because it is "full-screen and one-handed, used at a loading
> dock by someone who is not navigating the app" (App.tsx:227-240), and it forces
> the charcoal ground (`DoorNext.tsx:380`). The exclusion is a named constant —
> `NO_CHROME` in `lib/mudavym/pageNames.ts` — rather than a route that happens
> not to render a header, so it cannot be lost by accident.

Canonical source with curves: `apps/web/src/pages/receiving/next/MOTIONS-door.md` —
this list is the note-side index (ADR 0044 §2).

| id | name | fires |
|---|---|---|
| `head-settle` | Header entrance | the chrome bar, once on mount — 6px, quiet |
| `count-tally` | The boxes figure ticks | a stepper tap or the paper's pre-fill; tabular, overdamped, never on first paint |
| `match-ink` | The match line restates itself | "14 of 16 — two short" changing words; the delta is said, colour only underlines |
| `rows-settle` | Rows open and close | refusal reasons, the drafted credit card, the broken count collapsing under refusal |
| `seal-pour` | Hold-to-seal fill | `DoorSeal` — linear, the operator times it against their own thumb |
| `seal-forgive` | The thumb seals even lifted early | release at ≥60% of the pour completes (sig-a lineage — mercy for a gloved hand) |
| `seal-tuck` | Early release retreat | release below 60% — "Released at N% — nothing saved." |
| `seal-stamp` | The seal lands | the pressed Seal on completion; the page's only overshoot, wired to the real submission |
| `ink-micro` | Micro-states | outcome/reason chips, offline chip — nothing moves more than 2px |

Deliberate non-motions: no spinner theatre around the offline queue (queued is
SAVED, and says so), no shake on refusal, no first-paint tick, no celebration on
done — the pressed seal at rest is the done state.

### Overlays decided (2026-09-06)

> The census draws **no overlay** here and the verdict holds: the door is six points on one page,
> and its sealed step is a page-local `Panel` (`pages/receiving/next/DoorNext.tsx:697`), not a
> portal. What the door is owed is not a new shape but three surfaces the ceremonies decided and
> nothing draws.

| Owed surface | Shape | Contract sentence | Four states, denied included | Ceremony | Phone form | Status |
|---|---|---|---|---|---|---|
| **"We did not accept it"** — the door cannot refuse a delivery | a fourth question on the door itself, in place | "Say the delivery was refused. Sealing writes nothing into the book and tells the vendor it was turned away. Leaving records nothing." | *error* "The refusal was not recorded. The book still shows this delivery as expected and the vendor has not been told." · *denied* names who may refuse a delivery | **sealed.** It is a ledger consequence and a send in one — the mechanical rule's first clause | the bottom sheet's full detent | owed to **packet 4** — finder B's highest-consequence omission in the census, and there is no act for it anywhere in the 120 rows |
| The ten-minute correction after a door count | an in-place form on the door's own record, with the deadline printed and counting | "Correct the count you sealed. The book keeps both figures." | *denied* names who may correct a sealed count | plain — undo-after is on F10's closed list and a door count within ten minutes is on it | in place | owed to **packet 4** |
| Permission-denied on the seal | the shared `Denied` block, inside the surface the act lives in | "You can see this, but only a manager may seal a door count. Ask {name} to grant it." | — | — | in place | primitive **built** (packet 0); wiring owed to **packet 4** |

## 1c. Motions decided (2026-09-06)

> This is the one page with a gesture rule of its own, and it is the right one. `Today` is measured
> on `feat/mudavym-design-p4`.

| Act | Today (`file:line`) | Decided | Rejected, and why it loses | Status |
|---|---|---|---|---|
| Header entrance | `settle` 320 (`door.head.settle`) | keep | — | no change |
| The boxes figure retargets | `tally` 840, never on first paint | keep | (a) instant — loses that a stepper tap moved it; (b) `tuck` — a count is not an object under a finger | no change |
| The match line restates | `ink` 160 crossfade; the delta is carried in **words** | keep | (a) a number tween 14 to 15 — the delta is a fact, not a journey; (b) colour only — the words carry it | no change |
| Rows open and close | `settle` 320 | keep | — | no change |
| **Hold to seal** | `pour` 620 with **`forgiveAt = 0.6`** — past 60 % the remaining fill runs out on `settle` and it commits — `pages/receiving/next/DoorSeal.tsx:54` | keep, **and promote `forgiveAt` into `HoldToApprove` as an opt-in prop, default off, conditioned on the act and never on the viewport** | (a) no forgiveness, which is the shell control's behaviour — a gloved hand at 12 % battery loses the write; (b) forgiveness everywhere — an owner approving EUR 1,860 must not be forgiven a slip; (c) "on at any phone width, off for money", which was the recommendation — the two collide the moment an owner approves EUR 1,860 **on a phone**, which is the normal case for an owner | owed to **packet 5** |
| The offline queue is waiting | no spinner; the copy says "saved on this phone, will send when you're back inside" | keep the copy, and **the queue's breath is a bounded state change, not a loop.** It states its deadline, its ceiling and who carries the risk | (a) the demo's 2.2 s opacity loop for as long as a write is queued — unbounded moving content in parallel with other content, and the operator *can* interact during it, so SC **2.2.2 (Level A)** has no preload exception here; (b) nothing at all — then queued and sent look identical, which is absence reported as health; (c) a spinner — promises a duration nobody can honour | owed to **packet 5** |
| Refusal | stated in place, no shake | keep | (a) a shake — the field never shakes at a person holding plates; (b) a toast — missable at a dock | no change |
| Reduced motion | hook, four call sites | keep | — | no change |

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

**~~The credit-note draft cannot name the vendor it is addressed to~~ — CLOSED
2026-09-05, batch 40.** `GET /procurement/orders/:id` now selects
`provider:provider_id(name)` in the same statement as the order and
`OrderResponseDto.providerName` carries it, so the letter opens
`To Vinifera Imports:` instead of `To the vendor:`. When the join answers nothing the
draft says so in words — `VENDOR_NOT_NAMED`, exported from `DoorModel.ts` so the test
asserts the sentence rather than a paraphrase — because this letter LEAVES THE BUILDING
and an unaddressed one has to admit it is unaddressed. `composeDoorNotes` already
budgeted 60 characters for a vendor name (`VENDOR_MAX`), so the 500-character `notes`
cap holds WITH the distributor's name in it; the "longest real names" case now asserts
both "Château Pichon" and "Southern Glazer" and still measures under `NOTES_MAX`.

The original measurement, kept: `normalizeDoorOrder` read `providerName` off the shared
`Order` type; `OrderResponseDto` carried `providerId` and no name, so the letter had
always begun "To the vendor: order ORD-…". Two `DoorModel.test.ts` cases had asserted
the vendor's name from a FIXTURE that supplied one, so the suite proved a sentence the
wire could not produce; those two were flipped to pin the ABSENCE on 2026-09-05 and are
flipped again here to pin the NAME. `.planning/v3.0-TECH-DEBT.md`, "The orders wire",
item 1. ~~*Blocker: founder.*~~ **Decided and built.**

**The shared `Order` type's widening cast is gone.** `normalizeDoorOrder` used
`raw as Order & { unitType?: unknown; bottlesTotal?: unknown }` because the shared type
predated both fields. It now declares them (it is exactly `OrderResponseDto` since
2026-09-05, guarded by `scripts/check_web_reads_gateway_dto_keys.py`), so the cast is
deleted and both reads are type-checked.

- Inherits `/receiving`'s reachability problem (receiving.md §9): the only path to
  this URL is a page nothing links to.
- ~~One recorded against this page in `v3.0-TECH-DEBT.md` since 2026-09-05: "The orders
  wire", item 1 — the vendor name the credit-note draft cannot print.~~ **Closed the
  same day (batch 40); item 1 is struck through in the register.** (The line here read
  "none recorded" before that entry, then named it; it names none against this page
  again.)

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

### Motions and overlays — the rows this pass owes (2026-09-06)

From the decisions in §1c. Owner packets: **packet 3** the motion pass, **packet 4** the
states owed, **packet 5** the gestures; a *page pass* is this page's own next opening.
The reasoning is in §1c and in [ADR 0133](../decisions/0133-one-motion-per-act-across-every-page.md);
these are the rows.

1. `pages/receiving/next/DoorNext.tsx` — **"We did not accept it"**, a sealed fourth question at the door. Nothing enters the book and the vendor is told. The highest-consequence door act has no surface anywhere in the 120 census rows. **packet 4**
2. `pages/receiving/next/DoorNext.tsx` — the ten-minute correction after a sealed count, in place, deadline printed and counting (F10). **packet 4**
3. `components/mudavym/HoldToApprove.tsx` — promote `forgiveAt` (from `pages/receiving/next/DoorSeal.tsx:54`, 0.6) as an opt-in prop, default off, **conditioned on the act, never on the viewport**. **packet 5**
4. `pages/receiving/next/DoorNext.tsx:470` — the `Loader2` spinner goes; a label change and a sentence replace it (the anti-spinner rule). *page pass*
5. The offline queue's breath becomes a bounded state change, not an unbounded 2.2 s loop (SC 2.2.2), and states its deadline, its ceiling and who carries the risk. **packet 5**
6. No test asserts `DoorSeal`'s tokens or its 0.6 forgiveness threshold; the door shares its parent's two test files with no door-specific assertions. *page pass*

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
