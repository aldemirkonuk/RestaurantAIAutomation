## Three server holes behind the inventory mount line — CLOSED on `fix/inventory-mount-line-server-guards` — 2026-10-08

ADR 0315 (PR #677, `Consequences`, "The mount line waits on three server
fixes") holds InventoryNext's `App.tsx` mount line until these land. The
coordinator ruled on 2026-10-08 that they ship as their own PR from `main`,
under the founder's 2026-10-07T20:04:10Z delegation. Each fix has its own spec,
and every mutant of each guard was caught (see the PR body).

**(a) Staff could write a loss through the ledger.** `POST
/inventory-ledger/transactions` and `/transactions/bulk` took any movement type
from any member: a waiter could book a `waste` of 12, or the same loss as an
`adjustment`. Gating only the write-off types would have left that second door
open, so both POSTs now carry `@Roles("owner", "manager")` under `RolesGuard`
(`inventory-ledger.controller.ts`). Staff are not cut off from their own work:
counts go through `POST …/reconcile`, and pours through `POST
/inventory/:restaurantId/item/:itemId/pour`. Reconcile and every read stay
open. No web or mobile caller of either POST exists on `main`; the only web
call on this controller is reconcile (`apps/web/src/services/api/inventory.ts:148`).
The InventoryNext write-off sheet on #677 will call `POST /transactions`,
and it shows the sheet only when the role is owner or manager
(`useInventoryNextData.ts:572` on #677).
The proof is `route-access.expected.json`: 8 rows added, none changed.

**(b) A retry confirmed an amount the ledger did not hold.**
`apply_stock_movement` and `record_glass_pour` look an idempotency key up
alone and answer a replay with the movement they first recorded. So a
write-off of 3 that landed behind a 5xx, retried as 1, read "recorded: 1" over
a ledger holding 3. Now a replay whose item, type, amount or stock state differs
is a 409 that says nothing new was recorded. A pour replay is a 409 when its
item, glass count or named glass size differs, or when the recorded pour cannot
be read. A matching replay answers as before. No migration was needed.
Both SQL lookups match the key across every house. So a ledger key that
another house has already spent is refused with a 409 before the RPC runs,
and the pour read-back is filtered to this house. Each route answers every
spent key with one refusal text, so a key spent in another house reads the
same as one spent here on a different movement or pour; the reply never says
another house holds it. **Still open:** the lookups themselves stay global
(`20261222100000_a_pos_sale_is_dated_by_its_check.sql:188`, `:314`). Scoping
them to the house is a migration, left for the ledger's own lane. The
proof is `inventory-ledger/a-replayed-key-must-match.spec.ts` and
`inventory.service.spec.ts` ("a replayed pour key must match…").

**(c) `approveOrder` approved an already-approved order.** A same-state write
is permitted by `canTransition` and skipped by the DB trigger, so APPROVED →
APPROVED passed both: a second approve with a fresh seal reserved stock again
and asked for a second letter. `approveOrder` now reads the status before it
spends the seal. It refuses an already-approved order, or a status
`decideTransition` will not take to APPROVED, and it writes with a
compare-and-set on the raw stored status (`.eq("status", fromStatus)`), so two
approvals racing each other write once. The loser gets a 409 that says nothing
more was reserved; its seal is spent, as any single-use seal is once
presented. The proof is `procurement/order-seal.spec.ts`.

Claims: `claims.d/fix-inventory-mount-line-server-guards.jsonl:1-3`.
