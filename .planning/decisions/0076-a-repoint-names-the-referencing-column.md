# 0076 — A catalog-driven repoint names the referencing column, not every column

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** merge_library_wines, pg_constraint, conkey, confkey, composite foreign key, MATCH SIMPLE, fk_repoint_plan, repoint, latent
- **Links:** [[0070-a-quantity-states-its-own-unit]] (introduces the first composite FK), `supabase/migrations/20260902160000_merge_repoints_by_referenced_column.sql`, `scripts/check_fk_repoint_by_referenced_column.py`, OD-119

## Context

`merge_library_wines()` collapses a duplicate `master_wine_library` row into a
keeper. It discovers the foreign keys it must repoint from the catalog rather
than from a hard-coded list, and that decision is still right: a hard-coded list
is wrong the moment someone adds a referencing table, and wrong silently. The
live definition is
`supabase/migrations/20260818020000_merge_undo_honesty.sql:160` and `:188` —
**not** `20260813030000_merge_library_wines.sql`, where the defect was reported.
Three superseded copies carry the same code; fixing only the reported one would
have changed nothing in any database.

Both discovery loops unnested `conkey` alone:

```sql
JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
```

`conkey` lists the **referencing** columns; `confkey` lists the columns they
reference, positionally paired. Unnesting one without the other discards the
pairing, so a **composite** foreign key yields one row per component and the
loop emits one `UPDATE t SET <col> = <keeper id> WHERE <col> = <loser id>` per
component — including components that reference nothing relevant.

### What that actually does — measured, not reasoned

Postgres 17, 2026-09-02, against the schema built from all 87 migrations. The
report framed the consequence as *"writing a uuid into an unrelated column."*
That is the **rarest** of three outcomes, and naming it as the consequence would
have overstated the severity while missing the likely failure:

| Component | Outcome | Evidence |
|---|---|---|
| Non-uuid (`uom`) — the ADR 0070 shape | **Merge aborts.** `42883 operator does not exist: text = uuid` | `merge_library_wines()` run against a schema carrying `(inventory_id, uom) -> (id, uom)` |
| uuid, all components non-null | **Merge aborts.** `23503` — the composite FK rejects the rewrite itself | direct `UPDATE` on the fixture |
| uuid, another component NULL | **Silent write, unchecked.** MATCH SIMPLE (the default, and what every FK here is) does not enforce a partially null key | same fixture with `pid` NULL |

The `WHERE <col> = <loser id>` clause is what keeps outcome 3 narrow: an
unrelated uuid column only matches if it already holds the loser's id.

**Latent when found, and still latent after ADR 0070 lands.** No composite FK to
`restaurant_inventory` or `master_wine_library` exists outside `inventory_lots`,
which loop 1 excludes by name. The first one is
`inventory_lots_item_uom_fkey (inventory_id, uom) -> restaurant_inventory (id,
canonical_uom)`, on `feat/ledger-unit-typed-quantities`
(`20260902120000_ledger_unit_typed_quantities.sql:316`, ADR 0075) — and it lands
on that excluded table. Fixed anyway: the loop is wrong regardless of whether
anything is standing on it, and the shape that makes it wrong — a catalog query
that enumerates columns without asking what they reference — is invisible in
review.

### The one composite key that does ship

Excluding `inventory_lots` from the *loop* does not exclude it from the
*problem*: the merge moves those lots by hand, and that hand-written `UPDATE` is
subject to the same composite key the moment ADR 0075 lands. Two inventory rows
for the same wine, created by two intake paths in two base units, is the ordinary
duplicate — exactly what this function exists to collapse. Measured on a database
built from all 87 migrations plus that branch's: **the merge already fails there,
at ADR 0075's own unit trigger — `23514 uom ml disagrees with the item`** — not at
the foreign key and not silently. That branch's guard is doing its job.

What that message does not say is that a *merge* moved the lot, and it arrives
after the merge has done other work. So the same blocker check runs against
`inventory_lots` before the move: it refuses first, names the constraint and the
keeper row, and does not depend on that trigger existing. On a schema carrying
the key without the trigger, the same move raises a bare `23503`.

## Options considered

1. **Repoint the id component only; let the FK speak.** Minimal: pair `conkey`
   with `confkey` and keep the component landing on `id`. A keeper/loser
   mismatch surfaces as a raw `23503` naming a constraint the operator never
   wrote. Cheapest, and leaves the merge unexplainable at exactly the moment it
   fails.
2. **Repoint the id component, and refuse loudly on anything unplannable.**
   Adds `fk_repoint_plan()` (returns a row for *every* FK — either a repointable
   id column or a stated `problem`) and `fk_repoint_blockers()` (counts rows a
   composite key would reject, *before* moving anything). More surface, and the
   refusals name the constraint, the components, and what to reconcile.
3. **Rewrite every component to the keeper's values** — `SET inventory_id =
   keeper.id, uom = keeper.uom`. Rejected: a lot's `uom` is a fact about the lot,
   not about its parent row. This trades a loud abort for silent semantic
   corruption, which is the wrong direction on every axis this repo cares about.
4. **Do nothing** — it is latent. Rejected: the trigger that makes it live is a
   composite FK on any table *other* than `inventory_lots`, which is one ordinary
   migration away, and nothing in review would flag it.

## Decision

**Option 2.** Pair `conkey` with `confkey` by ordinality, keep only the
component that references the key — and make the loop *account* for every
foreign key it sees rather than silently doing nothing with the ones it cannot
plan.

The repair is one join. The rest exists because of what the old query did with
what it could not handle: nothing, quietly. A foreign key referencing
`restaurant_inventory` on a column other than `id` was enumerated, repointed on a
column that never matched, reported zero rows, and left its rows to be orphaned
or cascade-deleted when the loser row went away — while the merge log said only
that zero rows moved, which reads as *nothing to do*. That is
[[absence-reported-as-health]] in its purest form, in a function whose whole
purpose is to not lose data.

`fk_repoint_blockers()` counts only rows whose other components are all NOT NULL,
because MATCH SIMPLE does not check the rest — measured, not assumed (outcome 3
above).

**One sibling defect is deliberately out of scope**, filed as OD-119: the
UNIQUE-collision loop reads `pg_index.indkey` and joins to `pg_attribute` by
attnum, so an expression column (attnum 0) is dropped from its comparison list
and a partial index's `indpred` is ignored — both of which make the collision
`DELETE` match *more* rows than it should. Also latent (no expression or partial
UNIQUE index exists on any table referencing `master_wine_library`, checked
2026-09-02). Different catalog, different evidence, its own change.

## Consequences

- **Easier.** A composite FK to either merge target is now handled correctly —
  including the hand-moved `inventory_lots`, the one such key that actually ships
  — and a foreign key the merge cannot account for fails `supabase db push` at the
  migration's own `DO $assert$` block rather than failing silently at merge time.
- **Harder.** Two new functions to keep in step with the merge, and a composite
  FK whose components disagree between keeper and loser now *refuses* the merge
  where before it would have aborted with a confusing error. That is the same
  outcome with a better message, not a new restriction.
- **Given up.** The merge no longer repoints a foreign key that references
  `restaurant_inventory` on some column other than `id` — it refuses. Nothing
  did that before either; it only looked like it did.
- **Tightening.** `a.attname <> 'superseded_by'` was a *global* column-name
  filter that would have silenced that name on any other table too. It is now
  the fully-qualified `public.master_wine_library.superseded_by`.
- **Revisit when** a legitimate foreign key needs to reference
  `restaurant_inventory` or `master_wine_library` on a non-`id` column. The merge
  will refuse it by name, which is the signal.

## Evidence

Postgres 17 in Docker; all 87 migrations plus this one apply with 0 failures,
and the migration's own assertion reports every FK to both targets as planned.

| Claim | How it was checked |
|---|---|
| The live definition is `20260818020000`, not the reported file | 4 migrations `CREATE OR REPLACE` the function; filenames sort by version |
| Pre-fix, the merge **aborts** on a composite `(inventory_id, uom)` FK | same fixture, both databases: pre-fix `42883 operator does not exist: text = uuid`; post-fix the merge completes |
| A composite FK produces 2 plan rows pre-fix, 1 post-fix | `check_fk_repoint_by_referenced_column.py --against-database` runs both queries side by side |
| A non-`id` FK is reported, not skipped | the same arm builds one and asserts `problem IS NOT NULL` |
| The refusal names the constraint | asserts `SQLERRM LIKE '%guard_child_inv_uom_fkey%'` |
| The merge still works | end-to-end merge after reconciling: child repointed, `guard_uom` untouched, loser inventory merged, loser wine superseded |
| The guard fails on the pre-fix tree | a new migration carrying the shape → exit 1; a later redefinition dropping the plan → exit 1; the anchor removed → exit 2 |
| The `inventory_lots` move breaks under ADR 0075's key, and how | database built from all 87 migrations + `20260902120000_ledger_unit_typed_quantities.sql`; keeper `canonical_uom = 'bottle'`, loser `'ml'` → without this fix `23514` from that branch's unit trigger; with it, `P0001 refusing to merge: 1 lot(s) would violate inventory_lots_item_uom_fkey` |
| No expression or partial UNIQUE index exists on any table referencing `master_wine_library` (OD-119 is latent) | grep of `CREATE UNIQUE INDEX` across `supabase/migrations` against the 15 referencing tables |

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | — | Created; founder chose the refuse-loudly option and deferred the `indkey` sibling to OD-119 |
