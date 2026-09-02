# 0078 — A count is a record in its own right

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** stock_counts, spot count, reconciliation, variance, D14, attribution, performed_by, idempotency, absence-reported-as-health
- **Links:** `.planning/07-reference/INVENTORY_SOTA_PLAN.md:63` (D14), `[[0025-executable-decision-claims]]`, `supabase/migrations/20260902190000_a_count_is_a_record.sql`, `scripts/check_a_count_is_recorded.py`

## Context

**D14 was contradicted in the shipped code and the supersession was never recorded. That is the deeper defect here, and this ADR restores D14.**

`.planning/07-reference/INVENTORY_SOTA_PLAN.md:63` locks decision D14 in the founder's own adopted words:

> **Count is truth; perpetual is the audit trail.** The *displayed/trusted* on-hand number is a periodic count re-based against the ledger — not the raw perpetual projection.

The code shipped the exact inverse. The displayed number is `restaurant_inventory.stock_live`, a trigger-maintained projection of `inventory_lots`; a count wrote a delta into `inventory_transactions` and was thereafter indistinguishable from a pour, a receipt or a manual override. No ADR superseded D14. It was simply not implemented, and nothing said so.

**Worse: agreement was physically unrecordable.** Two shipped constraints combine:

- `set_stock_absolute` returns NULL without writing anything when the implied delta is zero — `supabase/migrations/20260805131000_stock_race_and_pour_idempotency.sql:45`.
- `inventory_transactions` carries `CHECK (quantity_change <> 0)`.

So the ledger could **only ever hold counts that disagreed**. Any variance rate computed over `transaction_type = 'reconciliation'` rows is **1.0 by construction** — a property of the schema that reads exactly like a measurement of the restaurant. This is the [[absence-reported-as-health]] shape in its purest form: the successful case leaves no trace, the trace therefore contains only failures, and every aggregate over it is wrong although no row in it is. It is class **O** (silent omission) — the damage cannot be enumerated or repaired, only stopped.

Three further symptoms of the same root:

1. **`reconcileInventory` returned HTTP 400 on agreement.** `throw new BadRequestException("No adjustment needed - counts match")` — a manager who counted a shelf and found it correct got an error. That is the missing ledger row one layer up: the successful outcome had no representation, so the system could only hear about counts that went wrong.
2. **`last_counted_at` was the only surviving evidence a count happened**, and it was stamped by a *separate round trip* after the RPC whose failure was only a `logger.warn`. A count could leave **no trace whatsoever** and still report success.
3. **Attribution was client-asserted or absent.** `recordSpotCount` took `performedBy` from the request **body**, so a client could name anyone as the counter. `transferStock`, `recordPour` and `updateInventoryItem` passed nothing at all, even though `transfer_stock` and `record_glass_pour` have accepted `p_performed_by` since the production baseline (`20260805000000_baseline_from_production.sql:1838`, `:1132`) — so `performed_by_type` resolved to `'system'` on every manual path. A ledger built to answer "who moved this" answered "the system".

`photo_count_suggestions` (`20260827100000`) already does the right thing for the **machine's** answer: it records the suggestion and later grades it against the human number, so a suggestion that was right is as visible as one that was wrong. The **human count was the half with no equivalent**. The machine's guesses were fully audited; the human's counts were recorded only when they were wrong. That asymmetry is the point.

## Options considered

1. **Do nothing.** Costs: the variance tautology stays and will eventually be read as a measurement — the plan's own premortem names "counts never done" as a top-3 killer, and this makes "counts done and agreed" indistinguishable from "never counted". The 400 stays and actively teaches managers not to count. Rejected.
2. **Relax `CHECK (quantity_change <> 0)` and let a zero-delta reconciliation row into the ledger.** Cheapest diff. Rejected: it makes `inventory_transactions` hold rows that are not movements, breaks every `SUM(quantity_change)` reader's assumption that a row means something moved, and still leaves the count indistinguishable from a pour. It fixes the symptom by corrupting the audit trail's meaning.
3. **Keep the count in `last_counted_at` and add `last_counted_qty` / `last_variance` columns.** Rejected: one row per item means the *previous* count is destroyed by the next one, so history — the only thing that makes a variance rate meaningful — is unobtainable. It also keeps the count as an attribute of the item rather than an event.
4. **A `stock_counts` table, written unconditionally, with the movement as a downstream consequence.** Chosen.
5. **Also drop `last_counted_at` now that the table exists.** Rejected — see decision 2 below.

## Decision

**Add `stock_counts`, written unconditionally on every count, and make the stock movement a consequence of a non-zero difference rather than the only evidence the count happened.**

Both count paths (`InventoryService.recordSpotCount`, `InventoryLedgerService.reconcileInventory`) now go through one new primitive, `record_stock_count()`, whose order of operations is load-bearing and is asserted by `scripts/check_a_count_is_recorded.py`:

```
1. lock restaurant_inventory FOR UPDATE   -- serialises concurrent counts
2. replay gate on idempotency_key         -- one gate, shared with the movement
3. read expected = SUM(inventory_lots.qty) under that lock
4. INSERT INTO stock_counts               <-- UNCONDITIONAL, above every branch
5. apply_stock_movement                   <-- only if the difference is non-zero
6. stamp last_counted_at                  -- same transaction, no longer a second trip
```

### The four decisions the brief required, and why

**(a) What `expected_qty` means, and how it is captured without a race.**
It is `SUM(inventory_lots.qty)` for `(inventory_id, stock_state)`, read **inside the same `FOR UPDATE` lock the applied delta is computed from** — i.e. the identical read `set_stock_absolute` performs, in the identical lock.

Two alternatives were rejected. Reading `stock_live` (the projection) would let `expected_qty` disagree with the delta actually applied whenever the projection lags — the count would say "expected 10" while the ledger corrected from 9. Reading anything from TypeScript before or after the RPC re-introduces the **A11 race** that `set_stock_absolute` was written to fix: two concurrent operations diff against the same stale baseline and one is silently absorbed. `reconcileInventory` was doing exactly that (unlocked `SELECT stock_live`, delta computed in JS), so routing it through the locked primitive fixes a second, unrelated defect on the way past.

`expected_qty` is deliberately **not** constrained `>= 0`. It is an observation of a system that can be wrong, and a negative lot sum is a defect this table should be able to *witness* rather than reject.

`variance_qty` is a **generated column** (`counted_qty - expected_qty`), not a written one, so it can never drift from the two numbers it is derived from.

**(b) Does an agreeing count still write `last_counted_at`, and does the column survive?**
Yes, and yes — but its *meaning* changes and it is no longer load-bearing.

It survives because dropping it is destructive on production data (this migration is additive), because it is read on the hot inventory-list path (`inventory.service.ts:106`, feeding the count-due badge) and replacing that with a per-item `MAX(counted_at)` subquery on every render is a real regression, and because sibling surfaces under `apps/web/src/pages/inventory/` read it.

What changes: it stops being **evidence that a count happened** — `stock_counts` is that now — and becomes a denormalised cache of `MAX(stock_counts.counted_at)`. It is also no longer written by a second round trip from the gateway whose failure only warned; it is stamped inside `record_stock_count`'s transaction. That closes the window in which a count succeeded, the stamp failed, and nothing anywhere recorded that a count had occurred.

The distinguishability the E41 decision cared about — "counted and agreed" vs "never counted" — is now carried by a row with a quantity, an actor and a timestamp instead of by a bare timestamp.

**(c) Does the existing idempotency key cover the new row?**
Yes, deliberately the **same key** (`count:{inventoryId}:{clientCountId}`), with `stock_counts.idempotency_key` `NOT NULL UNIQUE` and the replay gate reading it **before** the INSERT. A retried count returns the original row and never reaches `apply_stock_movement`, so the count and the movement can never disagree about what a retry is. One gate, not two.

Note what this means: **the constraint is created by this fix, not inherited from it.** Before `stock_counts`, an agreeing count wrote nothing, so a retry had nothing to duplicate. Making agreement recordable is exactly what makes double-recording possible, which is why the key is mandatory — a count that cannot be de-duplicated cannot be a record, because "how often do counts agree" would become a measure of mobile signal quality.

`reconcileInventory` gains an optional `clientCountId`. Supplied, it is retry-safe; omitted, it falls back to the pre-existing `reconcile:{id}:{Date.now()}`, which is **not** retry-safe and never was. That fallback is preserved rather than silently upgraded: the count row inherits exactly the retry-safety the caller supplies, no better and no worse, and a reconcile retried without a `clientCountId` records a second count the same way it previously applied a second movement.

**(d) What replaces `reconcileInventory`'s 400 on agreement.**
A 200 carrying `{ count, transaction }`, where `transaction` is `null` when nothing had to move. Null is a **result**, not missing data.

The alternative — synthesising a zero-quantity transaction so the old response shape survives — was rejected outright: it fabricates a ledger row that does not exist, which is manufacturing evidence to preserve a type signature. The response type therefore changes from `InventoryTransactionResponseDto` to `ReconcileResultDto`. Measured: neither web consumer reads the body (`RowExpansion.tsx:101` invalidates and toasts; `RemoveFromInventoryModal.tsx:82` discards the return), and `reconcileItem` is typed `Promise<unknown>` (`apps/web/src/services/api/inventory.ts:51`), so no web change is required. No web file was touched by this change.

### Attribution

Fixed for the four paths in this ADR's scope: `recordSpotCount`, `transferStock`, `recordPour` and `updateInventoryItem` now take the actor from `@CurrentUser()` — the verified JWT, which carries `public.users.user_id` — and `recordSpotCount` **ignores** the `performedBy` field in the request body. An attributed ledger whose attribution is client-asserted is worse than no attribution, because it reads as evidence.

`counted_by` references `public.users(user_id)`, **never `auth.users`**: the two tables are disjoint in this database (zero shared ids), so an FK to `auth.users` 23503s on every write and CI cannot catch it — a fresh database has no rows to violate.

**Said out loud, as required: every `inventory_transactions` row written before this change stays unattributable.** They are not backfilled and must not be. A retroactive attribution would be worse than the gap, because the gap is honest and the backfill would be a claim nobody can check. Rows written by the manual paths carry `performed_by_type = 'system'` and that is what they will always say.

### The guard, and its honest limits

`scripts/check_a_count_is_recorded.py` (blocking, CI job `a-count-is-recorded`) enforces: **a count must be recorded whether or not it changed anything.** Three arms — no count committed through a write that vanishes on a zero delta; the INSERT above every delta branch inside `record_stock_count`; no CHECK on `stock_counts` forbidding a zero variance. Exit 1 on violation, 0 clean, **2 when it cannot check** (empty corpus, or zero `record_stock_count` call sites).

It is **static only**. A PASS proves the shipped code has the shape this ADR claims; it cannot prove a row reached Postgres, which needs a live database CI does not have. A count path inventing a different `transaction_type` string would slip past arm A. Python is scanned so a future count path there is caught, but nothing in Python commits a count today and that is stated rather than counted as evidence.

It is written in Python and reads the files itself, rather than shelling out to ripgrep, **because of a measured precedent in this repo**: `scripts/check_no_direct_stock_writes.sh:63` called `rg --type tsx`. There is no ripgrep type named `tsx`; rg exited 2 before examining a single file, `2>/dev/null || true` hid both the message and the status, and the script printed **PASS having examined zero lines**. Verified 2026-09-02 by planting a real direct `stock_live` write and watching the old script report PASS with exit 0. That script is repaired in the same commit: its search's exit status is now inspected, its corpus is counted and asserted, and its allowlist is keyed on file+content rather than file:line — every recorded line number had already rotted (the three `stock_live: 0,` placeholders had moved from 449/519/792 to 744/814/1087), and four entries had never matched anything at all.

## Consequences

- **Easier:** a variance rate over `stock_counts` is a measurement rather than a tautology. "Counted and agreed" is distinguishable from "never counted" by a row, not a timestamp. Counting correctly stops being an error condition. `reconcileInventory` no longer races the projection.
- **Harder / given up:** two count paths must stay routed through one RPC, which the guard enforces but which also means a new count surface has one more thing to get right. `stock_counts` grows without bound (one row per count per item) with no retention policy yet — deliberately deferred rather than guessed. The reconcile response shape changed; nothing reads it today, but a future consumer must handle `transaction: null`.
- **Not done here, and named:** `stock_counts` is written and nothing reads it yet. D14's second half — making the *displayed* number a count re-based against the ledger rather than the raw projection — is a read-path change this ADR does not make. This ADR makes that change *possible* by creating the record it would have to read; it does not make it. Saying otherwise would be the same overclaim this ADR exists to remove.
- **Migration is UNAPPLIED.** `supabase/migrations/20260902190000_a_count_is_a_record.sql` has not been run against production. The Supabase GitHub integration tracks `main` and applies on merge using the version from the repo filename; hand-applying is the only way to manufacture a version mismatch.
- **Revisit when:** `stock_counts` is being read by a product surface (that read is D14's other half and wants its own ADR), or when the table needs a retention policy, or if a count path appears that legitimately cannot supply an idempotency key.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | — | Created. Number 0078 taken after `scripts/check_adr_numbers_unique.py` swept 487 refs and reported 0075 held by `feat/ledger-unit-typed-quantities`. |
