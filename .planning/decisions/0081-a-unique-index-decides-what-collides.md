# 0081 — A unique index decides what collides; nothing reconstructs one

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** merge_library_wines, pg_index, indkey, unique index, NULLS DISTINCT, partial index, expression index, INCLUDE, collision, OD-119
- **Links:** [[0076-a-repoint-names-the-referencing-column]] (the FK half of the same function), `supabase/migrations/20260902180000_a_unique_index_decides_what_collides.sql`, `scripts/check_fk_repoint_by_referenced_column.py`, closes OD-119

## Context

[ADR 0076](0076-a-repoint-names-the-referencing-column.md) fixed how
`merge_library_wines()` *finds* the foreign keys it repoints. It deliberately
left the loop that runs next: the one that deletes loser-side rows which would
collide with a keeper-side row on a UNIQUE index. That loop read
`pg_index.indkey`, joined it to `pg_attribute` by attnum, and rebuilt the
index's equality test by hand as a string of `k.col IS NOT DISTINCT FROM l.col`.

OD-119 filed two defects in it. An audit of **all seven UNIQUE indexes the loop
can actually reach** — a catalog query against the built schema, not a grep —
found **five**, and the one OD-119 did not name is the one that is reachable on
the schema as it stands:

| # | Defect | Effect | Status |
|---|---|---|---|
| 1 | **Expression** columns have attnum 0; the join finds nothing and the component vanishes | fewer AND-terms → broader match → **over-deletes** | latent, 0 of 7 |
| 2 | **Partial** index: `indpred` ignored | an index constraining a subset treated as constraining all → **over-deletes** | latent, 0 of 7 |
| 3 | **INCLUDE** columns (`indnatts > indnkeyatts`) compared as key columns | narrows the match → a real collision survives to raise 23505 on the repoint | latent, 0 of 7 |
| 4 | **Invalid** index (failed `CONCURRENTLY`) treated as a constraint | deletes for a constraint that enforces nothing | latent, 0 of 7 |
| 5 | **NULL semantics** — `IS NOT DISTINCT FROM` makes NULL equal NULL | a NULLS DISTINCT index would have allowed both rows → **over-deletes** | **reachable, 1 of 7** |

Defect 5 measured on `sku_mappings`, `UNIQUE (restaurant_id, master_wine_id,
sku_type, sku_value)` with `restaurant_id` nullable — two *global* (unscoped)
mappings for one SKU. The index permits both rows on the keeper (`t`); the merge
kept **1 of 2** before this change and **2 of 2** after.

### Two corrections to my own first pass, recorded because the mistake is the lesson

An earlier draft named `wine_aliases` as a second live instance. **Wrong.** Its
nullable key column is `alias_name_normalized`, and `trg_normalize_alias`
derives it from a `NOT NULL` `alias_name` on every INSERT and UPDATE, so it is
never actually null and the case is unreachable there. Worse, the "proof" of
that non-instance counted rows matching `alias_source IS NULL` — a `NOT NULL`
column with a default, so the predicate could only ever return 0. A probe that
cannot return anything else is not evidence, and it read as a confirmed live
data-loss bug for about ten minutes. Whether production holds two such
`sku_mappings` rows today is **not** knowable from here and is not claimed.

## Options considered

1. **Fix the five cases.** Add `indnkeyatts` slicing, `indisvalid`, an
   `indpred` clause, `pg_get_indexdef()` per key position for expressions, and
   branch on `indnullsnotdistinct`. Keeps the set-based DELETE. Costs: it is a
   second implementation of Postgres's index semantics, and expressions cannot
   be re-aliased into `k.`/`l.` form without rewriting identifiers inside
   arbitrary expression text — which is where a sixth defect would live.
2. **Delete the reconstruction; let the index answer.** Attempt the repoint; a
   row that raises `23505` collided and is dropped in favour of the keeper's, a
   row that does not, did not. Exact for every index shape, including ones added
   after this migration.
3. **Refuse any index the loop cannot parse into plain columns.** Conservative
   and honest, but it turns a legitimate expression index into a merge that
   cannot run at all — and it still needs the parsing it is hedging against.
4. **Do nothing.** Four of five are latent. Rejected: the fifth is reachable
   now, and the four became latent by accident of which indexes exist, not by
   design.

## Decision

**Option 2.** The reconstruction is deleted outright.

The argument is not that five bugs is more than four. It is that four of the
five were invisible *because nobody pictured that index shape*, and the fifth
was invisible because `IS NOT DISTINCT FROM` reads like the careful choice. A
unique index is expressions, partial predicates, opclasses, collations, INCLUDE
columns and null semantics; any hand-built equality test is a second
implementation of all of it that drifts the moment someone adds a shape the
author did not picture. Option 1 fixes the instances and leaves the generator.

The set-based `UPDATE` stays as the fast path, so nothing collides at no per-row
cost and one subtransaction covers the ordinary case. Only a real collision
drops to per-row, bounded by the rows referencing the loser in that one table.
The reported step now names the constraint that **actually fired**
(`GET STACKED DIAGNOSTICS CONSTRAINT_NAME`) rather than one the loop guessed.

## Consequences

- **Easier.** Every index shape is handled, including ones added later — a
  property the previous loop could not have had at any level of care.
- **Harder.** A collision costs one subtransaction per referencing row in the
  affected table. Merges are rare maintenance operations on small per-wine row
  counts; if that ever stops being true, the signal is a merge that is slow
  rather than a merge that is wrong.
- **Not covered, stated rather than discovered later.** `DEFERRED` unique
  constraints raise at COMMIT, so neither this nor its predecessor can catch
  one (none of the seven is deferred). Exclusion constraints (23P01) are not
  caught — unchanged scope, not a new gap. Loop 1 (references to
  `restaurant_inventory`) still has **no** collision handling and aborts on
  23505; teaching it to DELETE would be new destructive behaviour, and aborting
  is the safe direction.
- **Revisit when** a merge is observed to be slow on a table with many rows per
  wine, or when a deferred unique constraint is introduced.

## Evidence

Postgres 17 in Docker; all 89 migrations apply with 0 failures. Two databases
built from the same tree, one with this migration and one without.

| Claim | Pre-fix | Fixed |
|---|---|---|
| NULLS DISTINCT, `sku_mappings`, `restaurant_id` NULL both sides — index permits both (`t`) | **1 of 2 rows survive** | 2 of 2 |
| Expression index `(wine_id, lower(label))`, labels that do not collide | **"a non-colliding row was deleted"** | survives |
| Partial index `(wine_id, code) WHERE active`, predicate false both sides | **"1 of 2 out-of-predicate rows survived"** | 2 of 2 |
| Genuine collision (two aliases normalising to one value) | dropped | dropped, and now reported as `wine_aliases.canonical_id via wine_aliases_canonical_id_alias_name_normalized_key` |
| The migration's own assertion | — | fails `db push` if `merge_library_wines` reads `indkey` again, or if the measured `sku_mappings` shape is gone |
| Guard check C | — | fires on a reintroduced reconstruction (exit 1), stays quiet on a bare `indkey` count |

All four behavioural assertions plus ADR 0076's four run in `schema-parity.yml`
against the freshly reset local stack, and the suite is verified to fail against
a database built without this migration.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | — | Created; closes OD-119, which named 2 of the 5 defects found |
