# 0057 — Prove every receiving write before it reaches the ledger

- **Status:** Proposed
- **Date:** 2026-09-01
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** receiving, verifyReceipt, markDelivered, procurement_orders, PGRST204, tenancy, apply_stock_movement, column guard, quantity_received
- **Links:** [[0051-rebuilt-pages-show-live-data-only]] (say the failure, never silently drop), [[0054-order-capture-and-unit-arithmetic]] (the read side of the same order row), `.planning/06-pages/receiving.md`, `scripts/check_orders_column_writes.py`

## Context

Three defects were found in the receiving write path on 2026-09-01 and verified
against both the source and the production schema (`procurement_orders`, 56
columns, read from `information_schema`). They do not share a cause, but they
share a shape: **each one produced a successful-looking outcome while the
database and the ledger disagreed about what happened.**

**D1 — a write to a column that does not exist.**
`procurement.service.ts:1653` (pre-fix) put `notes: body.note ?? undefined` in
the `procurement_orders` update inside `verifyReceipt`. There is no `notes`
column; the table has `delivery_notes`, `manager_notes` and
`discrepancy_notes`. supabase-js drops undefined-valued keys from the JSON body,
so the key only reached PostgREST when a manager had actually typed a note —
that is, only when documenting a discrepancy. By then the ledger correction
(`:1614`) and the vendor credit claim (`:1682`) were already written. PGRST204
rejected the whole update, so `status`, `match_status`, `accepted_quantity`, the
`invoice_*` columns and the price-history row (`:1713`) never landed, and the
retry failed identically. The order was left permanently half-verified, on the
exact path where money is at stake.

**D2 — `adjustments[]` could write stock into another tenant.**
`VerifyReceiptDto.adjustments` was declared `@IsArray() @IsOptional()
@Type(() => ReceiptAdjustmentDto)` with **no `@ValidateNested({ each: true })`**.
Without it class-validator constructs the nested DTOs and validates none of
their decorators, so every field inside an adjustment was accepted verbatim.
`applyReceiptAdjustment` then handed `inventoryId` straight to
`apply_stock_movement`, which derives `restaurant_id` **from the target
inventory row itself**, not from the caller. A well-formed UUID belonging to
another restaurant moved that restaurant's stock.

**D3 — `markDelivered` defeated the door's anti-double-book guard.**
`:1262` wrote `quantity_received: quantityReceived ?? null` while the ledger
booked `resolvedQuantity = quantityReceived ?? order.quantity`. The web client
sends no quantity (`apps/web/src/hooks/useOrdersData.ts:68`), so the ledger held
`order.quantity` and the column held NULL. `recordDoorReceipt` computes
`alreadyBooked = Number(order.quantity_received ?? 0)`
(`receiving.service.ts:194`) to decide what is left to book — NULL reads as 0,
and the door books the entire delivery a second time.

A fourth problem sits on the same endpoint: `procurement.controller.ts:233` took
`quantityReceived` as an unvalidated raw `@Query` string. `Number("abc")` is
NaN, and `NaN ?? x` does **not** fall through, so `resolvedQuantity` became NaN,
the `> 0` test failed, and the order was marked DELIVERED with no stock booked —
answered 200 OK.

## Options considered

1. **Fix the three lines and move on.** Cheapest. Rejected: D1 is a class, not an
   instance. Writing this ADR surfaced a second live member of it — `location_id`
   at `procurement.service.ts:940`, same `?? undefined` shape, same absent column
   — which nobody had noticed and nothing would have caught. Fixing instances of
   a class one at a time is the failure mode named in the
   `absence-reported-as-health` note.
2. **Generate the payload types from the schema (`supabase gen types`) and type
   every write.** The strongest option in principle, and the only one that scales
   past one table. Rejected *for now*, not on merit: it changes every write in
   the gateway at once, the generated types are only as current as the last
   generation, and nothing in CI would notice them going stale — the same
   absence-reported-as-health failure one level up. Worth reopening as its own
   decision; recorded here so the next session does not treat this ADR as a
   verdict against it.
3. **Fix the three defects, and add one blocking guard that derives the real
   column set from `supabase/migrations/` and fails on any update key that is
   not in it.** Chosen.
4. **Do nothing.** Costs: a manager documenting a bad delivery gets a half-saved
   order and no way to finish it; a delivery marked at the door gets booked
   twice; a crafted request moves another restaurant's stock. All three are
   silent to the operator.

## Decision

**Fix all three, and make the class that produced D1 impossible to reintroduce
without CI saying so.** Specifically:

- **D1** — the note is written to `delivery_notes`, the same column
  `updateOrder` writes `dto.deliveryNotes` into. **Appended, not assigned**: a
  note left at the door and a note left at verification are two observations of
  the same delivery, and the second silently erasing the first is data loss
  nobody would report because nobody would see it. `orderRow` is already in hand,
  so the merge costs no extra read.
- **D2** — `@ValidateNested({ each: true })` and `@IsUUID()` on the DTO, **and**
  a server-side ownership check inside `applyReceiptAdjustment` that proves every
  `inventoryId` belongs to the caller's `restaurantId` before the RPC, throwing a
  403 that names the problem. The decorators alone are not the fix: they only
  reject ids that are not UUID-shaped, and a foreign UUID is exactly the case
  that matters. A failed ownership *lookup* is raised as 422, never treated as
  permission — per ADR 0051, absence of an answer is not a yes.
- **D3** — `quantity_received` is written as `resolvedQuantity`, the same number
  the ledger is told, decided once. `?quantityReceived` is parsed and validated
  by an exported `parseDeliveredQuantity`, which refuses non-numeric, fractional
  and negative values with a 400 that says which — and deliberately keeps
  "the caller did not say" (`undefined`, the normal web-client case) distinct
  from "unparseable".
- **The guard** — `scripts/check_orders_column_writes.py` derives
  `procurement_orders`' columns by replaying `supabase/migrations/` (baseline
  plus later `ALTER`s; nothing hardcoded) and fails on any `.update()` key that
  is not one of them. It follows payloads built as a local `const` and mutated by
  `Object.assign` / member assignment, because verifyReceipt builds its payload
  that way and a guard that could not see the defect it was written for would be
  worse than no guard.

## Consequences

**Easier.** A wrong column name fails in CI in seconds instead of in production
on the one path where a manager is documenting money owed back. The receiving
write path has tests for the first time — `verify-receipt.spec.ts`, 15 of them;
12 fail against the pre-fix tree.

**Harder / given up.**
- One extra read per adjustment (the ownership probe) and one per
  `markDelivered` (the pre-read that makes `resolvedQuantity` available to
  write). Both are single-row primary-key lookups on a path a human is standing
  at a door for; correctness is worth more than the round trip here.
- A client that was sending `?quantityReceived=` garbage now gets a 400 where it
  got a 200. That is the point, but it is a behaviour change on a live endpoint.
- The guard covers **one table** and **only `.update()`**. Both limits are
  written into its docstring, and insert-path violations are counted and printed
  on every run so the hole is measured rather than hidden.

**Two things this change deliberately does not settle:**
- `location_id` (`procurement.service.ts:940`) is a second live member of D1's
  class — not a column in migrations or in production, same `?? undefined`
  shape, currently unreachable because no client sends `locationId`. It is
  recorded in the guard's shrink-only `KNOWN_BAD` list rather than fixed,
  because the fix is *either* a migration adding the column *or* deleting the
  feature, and that is a decision, not a default (CLAUDE.md §0.1).
- Two agent insert paths write `wine_name` and `actual_delivery`, neither a
  column (already noted in
  `20260901150000_order_line_capture_and_units.sql:190`). Reported by the guard,
  not enforced.

**Revisit when:** the guard's `KNOWN_BAD` list would need to grow rather than
shrink; a second table needs the same protection (that is the signal to
reconsider option 2 rather than to copy this script); or the insert-path count
the guard prints stops going down.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-01 | — | Created. Status **Proposed** — an agent cannot lock a decision. |
