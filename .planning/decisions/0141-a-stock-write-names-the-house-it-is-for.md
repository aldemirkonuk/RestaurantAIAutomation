# 0141 — A stock write names the house it is for, and the primitive refuses a mismatch

- **Status:** Locked (founder, 2026-09-12, in session — "fix all") — built in this PR
- **Date:** 2026-09-12
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** tenancy, multi-tenant, apply_stock_movement, inventory_lots, inventory_transactions, service role, RLS, ownership check, failed read, deploy window, PostgREST overload, ADR 0141
- **Links:** [[0067-a-failed-read-is-never-an-empty-one]] (a failed read refuses, never admits), [[0051-rebuilt-pages-show-live-data-only]] (a surface says what it does not know), [[0078-a-count-is-a-record-in-its-own-right]] (the last change to this primitive's arguments — cost provenance stopped being inferred), [[0103-a-delivery-is-agreed-before-it-is-verified]] (A1 — the body this one extends), `supabase/migrations/20260906233000_stock_at_the_door_cost_at_verified.sql`, `apps/api-gateway/src/common/tenant/assert-tenant-match.ts`

## Context

`public.apply_stock_movement` is the single stock write primitive: every lot and
every ledger row in the product goes through it (`scripts/check_no_direct_stock_writes.sh`
enforces that). On main `aa426050` it took **no restaurant argument**. Its first
act on the item was

```sql
SELECT restaurant_id, master_wine_id INTO v_restaurant, v_wine
  FROM restaurant_inventory WHERE id = p_inventory_id FOR UPDATE;
```

(`20260906233000_stock_at_the_door_cost_at_verified.sql:222`) and `v_restaurant`
was then stamped on the lot it inserted and the `inventory_transactions` row it
wrote. **The tenant of a stock write was decided entirely by the id the caller
handed in.** There is no RLS on this path — the gateway holds the service-role
key — and there was no tenant assertion anywhere in the function.

**The gateway did not compensate.** `InventoryLedgerService.createTransaction`
(`inventory-ledger.service.ts:69-105` on `aa426050`) received the caller's
`restaurantId` from the authenticated token, **logged it**, validated only that
`quantityChange` was non-zero, and passed `p_inventory_id: dto.inventoryId`
straight through. The restaurant id was never used as a filter, a comparison or
an argument. `assertTenantMatch` cannot see this class of violation at all: it
compares restaurant ids the REQUEST names against the token's, and a request
naming its own restaurant while carrying another house's inventory id passes it
untouched. The DTO's shape decorator cannot see it either — a foreign id is
perfectly UUID-shaped.

So a signed-in user who supplied an inventory id belonging to another house
**wrote into that house's ledger and that house's shelf**. And because the
read-back afterwards IS scoped to the caller, the caller was answered
`Transaction not found` — a committed write reported as a failure. That second
half is its own defect: it is the error message that would have made a probe of
the first half look like a refusal.

**Measured, not argued.** A PGlite probe
(`p4-scratch/pglite-probe/adr0141-stock-write-names-its-house.mjs`) builds the
three tables from the tree's own DDL, installs the **pre-fix** function verbatim
out of `20260906233000`, and calls it as a caller acting for HOUSE_B naming
HOUSE_A's item: **7 bottles and 1 ledger row landed in HOUSE_A**, and the call
returned a transaction id. That is the defect, run rather than reasoned about.

One path already did this correctly. `procurement.service.ts#applyReceiptAdjustment`
proved the id belonged to the caller before the RPC, with a comment saying
exactly why. It was the only one.

## Decision

**A stock movement names the house it is for, at both ends.**

1. **The gateway asserts ownership before the write.** The check
   `applyReceiptAdjustment` already carried is extracted to
   `apps/api-gateway/src/common/tenant/assert-inventory-belongs-to-restaurant.ts`
   and called by every path that takes an inventory id from a request:
   `InventoryLedgerService.createTransaction`, `ProcurementService.createOrder`
   (before the order row exists, so a foreign item is never persisted on
   `procurement_orders.inventory_id` and never reaches
   `reserveOrderShadowStock`), and the non-production E2E route
   `communications.controller.ts#e2eStep1TriggerThreshold`, whose `body.wineId`
   was never scoped to anything. `applyReceiptAdjustment` now calls the shared
   one, so there is exactly one implementation and not a second way.
   **A FAILED ownership read REFUSES** (422 with the reason) rather than falling
   through — supabase-js resolves `{ data, error }` rather than throwing, and
   treating an unanswered question as a yes is this codebase's standing fault.

2. **The function stops trusting its caller.** `apply_stock_movement` gains an
   18th parameter, `p_restaurant_id uuid DEFAULT NULL`. When it is supplied and
   the item does not belong to it, the function **RAISES 42501** and writes
   nothing. It raises twice over: once **before the idempotency lookup**, so a
   caller naming another house cannot replay a known key and be handed that
   house's transaction id; and once **under the `FOR UPDATE` row lock**, which
   is the comparison the write actually depends on. It never widens — a
   mismatch is never a warning, never ignored, never used to relocate the write.

3. **Every caller passes it.** All **15** `apply_stock_movement` call sites in
   the gateway, across 8 files, now pass `p_restaurant_id`, plus the sim seed
   (`scripts/synth/seed.py`). The list and the restaurant each one names is in
   the PR body. A test scans the tree and fails if any call site stops naming a
   house.

4. **The read-back stops calling a contradiction a missing row.**
   `createTransaction` no longer routes its post-write read through
   `getTransaction`. A read that finds nothing after a write that RETURNED AN ID
   is not "not found"; it is the two facts disagreeing. It is now a 500 that
   says the write happened and did not happen here, and a failed read-back is a
   separate 500 that says the movement stands.

### The rollout: the argument defaults to NULL

Migrations apply when the PR merges; the gateway deploys after. For the length
of that window the OLD gateway calls the NEW function.

**Chosen: `DEFAULT NULL`, asserting only when supplied.** The window costs
exactly this and no more — during it the hole is **as wide as it is today, no
wider**, because the old gateway passes no restaurant and the assertion does not
fire. It closes the moment the new gateway boots, since every gateway call site
in this change names its house. Measured in the probe: a 17-argument call from
the old gateway still books against the new function (10 → 12 bottles).

**The residual is real and is recorded.** NULL is still admitted afterwards, so
a future caller that forgets gets the old behaviour. A second migration must
make NULL refuse — and it cannot be written yet, because
`services/agent-orchestrator/core/database.py:996` calls this RPC and **cannot
name a restaurant**: `update_stock(inventory_id, new_stock, …)` takes only an
inventory id. Filed in `.planning/v3.0-TECH-DEBT.md` as the one thing this
change leaves open.

The `DROP` before the `CREATE` is not optional. Postgres treats a different
parameter list as a distinct overload, so an 18-argument function would sit
ALONGSIDE the 17-argument one and PostgREST — which resolves by argument NAME —
would have two candidates for a 17-key call and refuse as ambiguous. This is the
same reason `20260805130000_extend_apply_stock_movement.sql:27` dropped the
12-argument signature. **No ACL is lost:** `grep -rn "apply_stock_movement" supabase/migrations/`
returns no GRANT or REVOKE for this function in any migration, baseline
included, so the "a DROP silently discards the baseline ACL" warning in
`20260906233000` is true in general and empty here.

## Alternatives rejected

- **A REQUIRED restaurant argument.** The strongest guarantee and undeployable.
  Every stock write made by the old gateway during the window would 404 at
  PostgREST — every POS sale, every door receipt, every inventory add — and two
  callers OUTSIDE this deploy unit would break for longer than the window: the
  Python orchestrator (`services/agent-orchestrator/core/database.py:996`) and
  the sim seed, which ship on their own cadence. A fix whose first act is to
  stop the floor is not a fix. It remains the destination, via the follow-up
  migration named above.
- **A second, differently-named primitive** (`apply_stock_movement_v2`) with a
  required argument, leaving the old one alone. No window at all on the new
  path — and it leaves TWO primitives, the permissive one still callable and
  still the name every document, guard and comment in the repo points at. "The
  function must never widen" is not satisfied by adding a narrow one beside it.
- **Smuggling the restaurant through `p_metadata`.** Keeps the 17-argument
  signature and is not an argument: nothing would type it, nothing would default
  it, and a caller omitting it would be indistinguishable from one passing it.
- **Fixing only the gateway.** The measured defect is reachable through
  `createTransaction` today, but the guarantee would then rest on every present
  and future caller remembering a check that lives somewhere else. The founder's
  instruction was "fix all", and the primitive is where "all" is enforceable.
- **Fixing only the function.** The gateway check is not redundant: it gives the
  caller a sentence naming the item, it runs before the RPC so nothing is
  attempted, and it covers the request-sourced ids that the NULL default cannot
  yet cover during the window.
- **RLS on `inventory_lots` / `inventory_transactions`.** The gateway holds the
  service-role key, which bypasses RLS by design. Policies there are worth
  having as defence-in-depth (already tracked in `STATE.md`) and would have
  stopped none of this.

## Consequences

- A cross-tenant stock write through the gateway is refused with a sentence
  naming the item, and nothing is attempted. Measured: `rejects` with
  `ForbiddenException` and **zero** `apply_stock_movement` calls.
- A cross-tenant write that reached the database anyway is refused by the
  database, with `42501` and no rows. Measured in the probe: lots 7 → 7, ledger
  1 → 1.
- `createOrder` now refuses an order placed against another house's item. This
  is a behaviour change on a live route: an order that would previously have
  been created (and would have reserved shadow stock in the other house) now
  returns 403.
- Two spec mocks had to learn that `restaurant_inventory` is now read TWICE on
  the createOrder path — once as an ownership probe (`select("id")`) and once
  for the wine identity. Conflating them made `writes a line even when the wine
  identity cannot be resolved` assert a 403; the mocks now distinguish them by
  the selected columns.
- `releaseOrderShadowStock` binds its read error. It always failed closed on the
  write; it now says so instead of reporting a release of zero.

## What this does NOT settle

- **Whether NULL should be admitted at all.** It must not be, and it still is.
  The follow-up migration is blocked on the Python orchestrator being able to
  name a restaurant — recorded in `v3.0-TECH-DEBT.md`, not fixed here.
- **`services/agent-orchestrator/core/database.py#update_stock`.** It takes only
  an inventory id, so it cannot name a house. It could read `restaurant_id` off
  the very row the function derives the tenant from — which would prove nothing
  and would look like a check. It passes nothing, and that is reported rather
  than dressed up.
- **The existing rows.** Nothing here audits `inventory_lots` or
  `inventory_transactions` for movements already written into the wrong house.
  No production read was made in this session (read-only or otherwise) and no
  claim is made about whether the hole was ever exercised.
- **`procurement_orders.inventory_id`, `procurement_document_lines.inventory_id`
  and `pos_item_mappings.inventory_id`.** All three are plain FKs to
  `restaurant_inventory` with no constraint tying the referenced item's tenant
  to the referencing row's. The new argument makes a mismatch refuse at write
  time; a composite FK or a trigger that makes the mismatch unstorable is a
  larger change and is not taken here.
- **RLS on the stock tables.** Unchanged and still bypassed by the service-role
  key.
- **Whether the 42501 message should name the caller's restaurant.** It names
  the item and the restaurant the CALLER asserted, never the owning one, so it
  discloses nothing the caller did not already supply. Whether even that is too
  much is not decided.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-12 | Aldemir (founder) | Saw the defect; instruction was "fix all" — the gateway check, the function's own argument, and the tests |
| 2026-09-12 | Claude (builder) | Created. 7 of 12 tests in `a-stock-write-names-its-house.spec.ts` observed failing against the pre-fix `inventory-ledger.service.ts` (copied in place with `git show HEAD:`); the 4 migration tests observed failing with the migration file absent; the PGlite probe measured the pre-fix cross-tenant write succeeding and the post-fix one refusing, 9 OK / 0 FAIL |
