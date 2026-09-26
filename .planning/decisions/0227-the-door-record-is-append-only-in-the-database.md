# 0227 — The door record is append-only in the database

- **Status:** Locked (founder, 2026-09-25, round 5) on the option he chose, *"Trigger, no cascade (Recommended)"*. Built on `feat/receiving-desk-approach1` (#480), migration `20260927120000_the_door_record_is_append_only.sql`.
- **Date:** 2026-09-25
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** receiving, door receipt, procurement_receipt_events, append-only, trigger, ON DELETE RESTRICT, cascade, house deletion, soft delete, desk history
- **Links:** [[0192-received-is-the-shelf-count-from-the-ledger]] (the `reconciled` event, fourth amendment), [[0160-the-founders-sketch-review-what-he-valued-and-what-each-page-becomes]] §107 ("the verdict history stays append-only"), [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] row 23, [[0104-every-incoming-document-renders-as-one-canonical-mudavym-document]] D5 (the earlier append-only trigger), `.planning/06-pages/receiving.md` §16, PRs #480 and #436

## The founder's answer

Asked 2026-09-25 (round 5, AskUserQuestion), verbatim: *"Receiving desk (#480): the door record
is append-only only by convention (service-role can still update/delete, and deleting an order
cascades). Enforce it in the database?"*

**[founder, 2026-09-25, round 5]** chose, verbatim: *"Trigger, no cascade (Recommended) — A trigger
refuses UPDATE/DELETE on door receipts, and the FK stops cascading (orders with receipts can't be
hard-deleted). Makes 'history from receipts' trustworthy."*

Rejected, verbatim: *"Trigger only — Refuse UPDATE/DELETE, keep the cascade when a house or order is
deleted."* and *"Leave by convention — No DB change now."*

## Context

The receiving desk's line history (#480, the founder's 2026-09-25 answer 2: built from the door
receipts already recorded, no separate verdict ledger) reads `procurement_receipt_events`. §16 of
the receiving dossier measured that this record was append-only by convention only: every write in
the code is an INSERT and clients hold no privilege (`20260825200000_od73_close_anon_dml.sql:204-208`),
but nothing in the database refused an UPDATE or DELETE, a migration had already rewritten rows once
(`20260901220000_door_facts_are_columns.sql:64`), and the foreign keys to the order and the house
were `ON DELETE CASCADE` (`baseline:13182`, `:13190`), so deleting either erased its receipts. The
third key, to the document, was `ON DELETE SET NULL` (`baseline:13174`), which rewrites a receipt.

## Before building: what deletes a house or an order (measured 2026-09-25 on main + #436 + #480)

The brief required this first: a rule that blocks deleting a house must not break a path that
deletes one. Every path, searched as `.from("restaurants"|"procurement_orders")…delete(`,
`table(…).delete()` and `DELETE FROM` across `apps/`, `services/`, `packages/`, `scripts/` and
`supabase/`, on main and on the 59 open PR branches, plus the FK graph of all 235 migrations built in
PGlite (every table whose delete cascades into the receipts, the orders or the houses):

| Path | What it deletes | Can it meet a receipt? | After this ADR |
|---|---|---|---|
| `auth.service.ts:987` (createHouse rollback) | the house this request created moments earlier | No: no order or receipt exists yet | Works (PGlite T8) |
| `auth.service.ts:1173` (registerRestaurant rollback) | same | No | Works (T8) |
| `organizations.service.ts:703` (createLocation rollback) | same | No | Works (T8) |
| `scripts/synth/teardown.py:256` | sim houses (`slug LIKE 'sim-%'`) | No: the simulator's write set has no orders or receipts | Works; a refusal would be logged as `sim-orphan`, never raised |
| `scripts/delete_demo_house.py` | the demo house, once, on the founder's word (ADR 0131) | Already run 2026-09-06 | A re-run on a house with receipts is refused — the intended rule |
| `email-convo-flow.e2e.spec.ts:129` | an order the test created | No: it writes no receipt | Works (T7) |
| Cascades into `restaurants` | none (no table's delete cascades into a house) | — | — |
| Cascades into `procurement_orders` | only from `restaurants` | — | a house with no receipts still takes its orders with it (T8) |

No product route deletes an order or a house. `DELETE /procurement/recurring-orders/:id` deactivates
(`active = false`); account deletion deletes `users` and memberships, which reach no receipt (no FK
from the receipts to `users`). Founder item 26 of 2026-09-25 (an owner who deletes their only house
lands on `/get-started`) names where a person lands; there is no house-deletion code on any branch.

## Options considered

1. **Trigger, no cascade** (chosen). A row trigger refuses UPDATE and DELETE; the order and house
   keys become `ON DELETE RESTRICT`. The history cannot be rewritten or erased by any role that
   has not first disabled the trigger in a migration a reviewer sees. Cost: an order or a house
   that has door receipts cannot be hard-deleted.
2. **Trigger only.** Refuse UPDATE/DELETE but keep the cascade, told apart with
   `pg_trigger_depth()` (the pattern ADR 0191 round 3 on #467 and the #440 pay ledger use). The history would
   still vanish with its order or house. Rejected by the founder.
3. **Leave by convention.** No change; the dossier's §16 finding stands. Rejected by the founder.

How the deletions that remain possible were designed (the brief's "soft delete, or detach"):

- **Soft delete for a house with a door history.** `restaurants.deleted_at` already exists
  (baseline, and read by `20260918153000:76`); marking it removes nothing. PGlite T10 proves it works
  with receipts present. Any future owner "delete this house" must be built this way.
- **Detach, rejected.** Setting the receipts' `restaurant_id` / `order_id` to NULL is an UPDATE the
  trigger refuses, `restaurant_id` is NOT NULL, and a receipt with no house belongs to no tenant and
  can be read by no one — detaching destroys the record in all but name.
- **Copy-then-delete into an archive table, rejected.** It moves the record the rule protects into
  a second place that would need the same rule, and deletes the original.

## Decision

`procurement_receipt_events` is append-only by construction, and nothing it points at can be
hard-deleted from under it. Migration `20260927120000`:

1. `procurement_receipt_events_are_append_only()` raises `restrict_violation` naming ADR 0227; it
   runs `BEFORE UPDATE OR DELETE FOR EACH ROW` and `BEFORE TRUNCATE FOR EACH STATEMENT` (a row
   trigger never sees a TRUNCATE).
2. `order_id` and `restaurant_id` are `ON DELETE RESTRICT`.
3. `document_id` is `ON DELETE RESTRICT` too (was SET NULL). SET NULL is an UPDATE of the receipt,
   which (1) refuses, so the old declaration named an action that could never succeed. This goes one
   key beyond the founder's words ("the FK stops cascading") because the trigger he chose already
   decides it; stated here so it is reviewed, not slipped in.

The migration asserts its own end state from the catalogue (both triggers enabled with the exact
`tgtype`, all three keys `r`), so `supabase db reset` in `schema-parity.yml` fails if it did not land.

## Evidence

- `supabase/tests/20260927120000_the_door_record_is_append_only_test.sql`, 11 tests, run in PGlite
  over all 236 migrations (one transaction, rolled back; 0 rows left): UPDATE, DELETE and TRUNCATE
  refused by the trigger (T1-T3); an INSERT still appends (T4); an order and a house with receipts
  refused whole by the RESTRICT keys, everything intact (T5, T6); an order with no receipts deletes
  (T7); a house with no receipts deletes and its order cascades, an empty house deletes (T8); a
  cited document is refused, an uncited one deletes (T9); a soft delete works (T10); a retried door
  tap still collides on `uq_pre_idempotency` (T11). **11/11 with the migration; 3/11 without it**;
  the migration with its keys left cascading fails T5 T6 T9; without the row trigger it fails T1-T3;
  without the TRUNCATE trigger, T3.
- Both refusals answer SQLSTATE 23001: an `ON DELETE RESTRICT` key reports *"violates RESTRICT
  setting"* with 23001, not 23503. The tests tell them apart by the trigger's message and by the
  constraint name the key reports.
- CLAIMS `ADR-0227-DOOR-RECORD-APPEND-ONLY-IN-DB` (static, mutation-checked).

## Consequences

- The desk history (#480) is trustworthy: what the door and the desk recorded stays as recorded. A
  correction is a new row (a later `reconciled` event is already the verification of record, ADR
  0192's 2026-09-21 amendment).
- **An order or a house with door receipts cannot be hard-deleted.** The delete is refused whole
  (nothing is removed). Removing such a house is a soft delete (`restaurants.deleted_at`).
- A future migration that must correct receipt rows has to disable the trigger in the open, in its
  own file, with a record naming why; that is the point.
- **Not covered, said plainly.** A session with `session_replication_role = replica` skips ordinary
  triggers, and the table owner can `ALTER TABLE … DISABLE TRIGGER`; both need a privileged role and
  leave a trace in a migration or the audit log, not in product code. The rule binds the service
  role the gateway uses. The SQL proof is run locally in PGlite (a WASM PostgreSQL 18.3 on a
  bootstrap platform, not Supabase); CI proves the end state through the migration's own
  assertions under `supabase db reset`, not by running the test file.
- **Revisit when** a product feature needs to remove a house or an order that has receipts (owner
  house deletion, founder item 26): it builds on the soft delete, and whether a soft-deleted house's
  history is ever purged (retention) is a question for the founder then, not a reason to reopen the
  cascade.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-25 | Aldemir (founder), round 5 | Chose *"Trigger, no cascade (Recommended)"* (verbatim above, with the two rejected options) |
| 2026-09-25 | Claude (Opus 5), lane W3-receiving | Measured every house/order delete path first (table above: none meets a receipt), built the migration, the SQL proof (11/11, control 3/11, three mutants each red) and the CLAIMS row; document key moved to RESTRICT and stated |
