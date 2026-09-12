# 0140 — The door outbox keeps the receipt and claims nothing it cannot prove

- **Status:** Locked 2026-09-12 — the founder's instruction was "make it bulletproof… if simplifying the door is best, you decide"; the simplification is the decision, and it is recorded here rather than left in a diff
- **Date:** 2026-09-12
- **Decider:** Aldemir (founder), who set the bar and delegated the shape
- **Keywords:** door outbox, receiving, offline queue, stranded, drop record, idempotency, localStorage, IndexedDB, absence reported as health, doorOutbox, DoorNext, DoorReceipt, RcOutboxRail
- **Links:** [[0090-pre-merge-audit-gate]] (the adversarial passes that found all five) · `apps/web/src/lib/doorOutbox.ts` · `apps/web/src/lib/doorOutbox.durability.test.ts` · `.planning/v3.0-TECH-DEBT.md` ("The offline queue reports a write it swallowed as a write that succeeded") · `CLAIMS.jsonl` id `ADR-0140`

## Context

A receiver taps **Finish** at the door. There is no signal in a walk-in, so the
tap always succeeds locally and the receipt syncs later. When the outbox
eventually **gives up** on one — a 4xx, or the attempt budget spent — it writes a
drop record before deleting the queue entry, because the count alone cannot say
*which* delivery left.

Sometimes that record cannot be written: the tablet's storage is full. The
receipt is then **kept** rather than deleted, which is correct and is not in
question here. The question was what to *tell the porter* about it — a state this
branch called a **strand**.

Five successive designs were built for that, each fixing the one before it, each
shipping a new defect. None was spotted by reading; every one was measured by an
adversarial pass:

| # | Design | What it did |
|---|---|---|
| 1 | a per-pass count, accumulated in component state | one lost receipt read as **"3 deliveries"** after three screen unlocks, and vanished on the navigate Finish triggers |
| 2 | a mark parked on the queue entry, read back | the mark is written through the storage whose refusal **creates** the strand, so the alarm went **silent** — the screen said *"still trying"* about a delivery that existed nowhere |
| 3 | mark **or** attempt ceiling | the ceiling could not be cleared, so a delivery the server **accepted** raised an undismissable alert forever; and acknowledging a drop pin uncovered a louder version of the same loss |
| 4 | an in-memory ledger, pruned against the queue | the queue read **cannot report failure**, so one unreadable read erased the only witness — design 2's silence, one layer down |
| 5 | orphaned ledger entries settled into drop records | one IndexedDB blip wrote a permanent *"we gave up on this delivery"* record for a receipt that was **still queued** and then delivered — sending a porter to re-enter by hand, under a new idempotency key, what the server already had |

They are **one defect wearing five hats.** The outbox was being asked to record,
durably and then read back, a fact whose *cause* is that durable storage failed —
on a layer that reports both a failed write and a failed read as success
(`localStoragePut` swallows its quota error and resolves; `idbGetAll` catches
every IndexedDB error and falls through to an empty array). Nothing built on top
of that can tell **absence** from **failure**, which is this repo's named
cross-cutting fault, and no amount of care at the door fixes it.

## Decision

**The door outbox keeps the receipt and claims nothing it cannot prove.**

1. **Every data-loss fix stays.** A receipt whose drop record could not be written
   is **kept in the queue**, never deleted. The drop record itself is durable,
   keyed on the queue id so one loss cannot be counted twice, and scoped per
   restaurant so one house's order label never reaches another's screen. A
   retryable failure does not raise the drop alarm.
2. **No durable, screen-facing witness is kept for a strand.** There is no
   ledger, no reader, and no banner. `readStrandedDoorReceipts` and
   `StrandedDoorReceipt` are removed from the module's surface.
3. **`DoorFlushResult.stranded` stays, and describes ONE PASS.** It is true about
   that pass and nothing else. It must never be accumulated, stored, or rendered
   as a standing alarm — that was design 1.
4. **What the porter sees instead is read from data that is actually there**: the
   receipt is still in the queue, `pendingDoorCount` counts it, and the receiving
   rail lists it with its attempt count and its last error. The flush still tries
   to leave the reason on the entry as `lastError`, best-effort, for that line —
   and nothing depends on it landing.
5. **The real fix is at the storage layer**, and it is filed, not done here:
   `v3.0-TECH-DEBT.md`, *"The offline queue reports a write it swallowed as a
   write that succeeded."* When the queue's writes and reads can report their own
   failure, a strand becomes reportable and this decision can be revisited.

## Options considered

1. **Keep design 5 and fix its blip.** *Rejected.* There is no fix: "is the entry
   gone?" is answerable only by a queue read, and that read cannot say "I could
   not look". Every variant gates on something the layer does not expose.
2. **Fix the storage layer first, in this branch.** *Rejected for scope, not for
   merit* — it is the right answer and it is filed as such. Making
   `localStoragePut` rethrow changes the contract for every offline caller at
   once; `spotCountOutbox`'s call is not inside a `try` and would abandon the
   rest of its queue mid-loop. That deserves its own sweep and its own branch.
3. **Revert the whole door lane to `main`.** *Rejected.* `main` **destroys** the
   receipt — it deletes a queue entry whose loss it failed to record. Every round
   of this work was built on top of fixing that, and losing it to tidy away the
   reporting question would trade a cosmetic problem for a real one.
4. **Ship design 5 and let the founder judge it in use.** *Rejected.* It
   fabricates loss records from a read blip, and the remedy it then prints —
   re-enter from the paper record — double-books stock under a new idempotency
   key. "Idempotency is the whole design" is the first thing this module's header
   says.

## Consequences

- **What becomes easier.** There is one honest story at the door: the receipt is
  either delivered, or recorded as lost by name, or still in the queue where you
  can see it. Nothing on any screen is derived from a write that may not have
  happened.
- **What becomes harder.** A strand is quieter than it was for one day in
  September: it shows as a queued entry rather than raising its own alarm. That
  is a deliberate trade of loudness for truth, and it is strictly louder than
  `main`, which said nothing at all *and* destroyed the receipt.
- **What is NOT fixed here.** The storage layer's swallow (filed). `sync-manager`
  clearing the whole pending queue (filed). The `permanent` classification that
  treats 401/403 as unrecoverable (filed).
- **What would trigger revisiting.** The storage entry above being closed; or a
  porter reporting that a kept-but-unrecorded receipt went unnoticed in the rail.
- **Guard.** `CLAIMS.jsonl` id `ADR-0140` asserts points 2 and 4 mechanically:
  the module exports no strand reader, no screen carries a `door:stranded`
  surface, and the durability suite that proves the receipt survives does **not**
  mock `./offline-storage` — the mock that made five defects invisible.
