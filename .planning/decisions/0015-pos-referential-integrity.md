---
type: adr
id: 0015
title: POS referential integrity — the remaining ten columns
status: locked
updated: 2026-08-25
links: []
---

# 0015 — The remaining ten POS reference columns get foreign keys

- **Status:** Locked
- **Date:** 2026-08-25
- **Decider:** Aldemir (founder) — *"work OD 71"*
- **Keywords:** pos, foreign key, referential integrity, cascade, set null, OD-71, orphans
- **Links:** `supabase/migrations/20260825140000_pos_referential_integrity.sql`,
  [[0011-pos-sale-volume-contract]], [[0030-pos-mapping-inventory-integrity]] (`inventory_id` FK) and [[0014-proposal-candidate-set-null]]
  (`candidate_inventory_id` SET NULL), both landed by a parallel session

> **Numbering note.** This is 0015, not 0012–0014: those are held by an in-flight
> session that had not pushed when this was written. A gap is cheaper than a
> collision — three OD-id collisions happened on 2026-08-24/25 because sessions
> each took "the next free number" from the same trunk, and git merges duplicate
> ids silently because the surrounding text differs.


> **Citation repair 2026-08-27.** This ADR was written against **ADR 0012** and
> **ADR 0014**; both files were then lost from `main` (a squash-merge dropped
> them) and **0012** was later spent on a different decision. The two are restored
> as **[0030](0030-pos-mapping-inventory-integrity.md)** and
> **[0014](0014-proposal-candidate-set-null.md)**, and the citations above now
> point at them. Nothing in the reasoning changed — the four references had been
> naming a decision about *reports through the gateway* for two days.

## Context

`pos_item_mappings` had **no foreign keys at all**. That is how 92 rows came to
reference a `restaurant_id` present in no row of `restaurants`, and 92
`inventory_id`s resolving to nothing: `scripts/synth/write_set.py` omitted the
POS tables from `SYNTH_WRITE_SET`, so `synth teardown` deleted the tenant and its
inventory and left the matcher output behind. **The database had no way to
object.**

[ADR 0030](0030-pos-mapping-inventory-integrity.md) closed `inventory_id` and [ADR 0014](0014-proposal-candidate-set-null.md) closed `candidate_inventory_id`,
explicitly leaving the rest as OD-71. This closes OD-71: ten columns across the
four `pos_*` tables.

**A dangling reference here is worse than it sounds.** Both stock RPCs
`RAISE 'inventory % not found'`, so the line wrote nothing — but it had already
passed the `if (!it.inventory_id)` branch that queues unmapped lines, so it
landed in **neither** stock **nor** `pos_unresolved_lines`. A black hole, not a
shortfall. Nobody would have found it from either side.

## Options considered

1. **Leave them.** Rejected: the state that produced 92 orphans is still
   reachable. Application code cannot fix this — the orphans were created by a
   *teardown script*, not by the gateway.
2. **Add the FKs, all CASCADE.** Rejected: cascading `master_wine_id` would
   delete a working mapping because a catalogue entry was merged, and cascading
   `resolved_by` would let an account deletion erase queue history.
3. **Add the FKs with delete behaviour derived from the existing schema, and
   [ADR 0014](0014-proposal-candidate-set-null.md)'s rule as the tie-break.** **Chosen.**

## Decision

Ten foreign keys. **The delete behaviour is derived, not invented** — measured
across the 224 existing public FKs:

| Target | Existing convention | Applied here |
|---|---|---|
| `restaurant_id → restaurants` | CASCADE 62 · NO ACTION 6 · SET NULL 4 | **CASCADE** ×4 |
| `→ auth.users` | SET NULL 2 of 2 | **SET NULL** ×2 |
| `→ master_wine_library` | split (8/7/4) — no convention | **SET NULL** ×2, by the rule below |
| `→ restaurant_inventory` | split (5/7/1) — no convention | **SET NULL** ×2, by the rule below |

Where the census was genuinely split, the tie-break is [ADR 0014](0014-proposal-candidate-set-null.md)'s rule:
**a claim dies with its target; a question outlives its answer.**

- `master_wine_id` and `candidate_master_wine_id` assert *"this POS item **is**
  that library wine"*. Losing the library entry costs the mapping a claim about
  identity — it does not stop the mapping pointing at a real inventory row.
- `pos_unresolved_lines` **is** a question: *"what wine is this, and how much
  does one sale remove?"* Deleting the inventory row it referenced does not
  answer it — it makes it more open. CASCADE would silently shrink the review
  queue whenever inventory changed, which is the one thing a queue must never do
  to itself.
- `resolved_by` is attribution. The decision stands; only the name is lost.

Indexes are added on every referencing column — Postgres indexes the *referenced*
key, never the referencing one, so without them each CASCADE delete sequentially
scans every POS table, and `pos_checks` is the fastest-growing table here.

## Consequences

**Proven, not asserted.** A probe restaurant with one `pos_checks`, one
`pos_item_mappings` and one `pos_unresolved_lines` row was deleted inside a
transaction: all three cascaded to 0, then the transaction rolled back. This is
exactly the teardown path that created the 92 orphans, and it now cleans up
after itself.

All ten applied against production with **zero orphans** — every existing row
already satisfied its constraint, so nothing had to be deleted or repaired.

**A tenant delete is now genuinely destructive**, and that is the point. Anyone
adding a `pos_*` table from here inherits the obligation: tenant-scoped columns
cascade, claims and questions null out. `pos_checks.table_id` keeps its
pre-existing `NO ACTION` — narrowing it was not in OD-71's scope and would change
whether a floor plan can be edited while checks reference it.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-25 | Aldemir | *"work OD 71"* — chosen over waiting for the parallel session to land first |
| 2026-08-25 | Claude | Delete behaviour derived from a census of 224 existing FKs rather than chosen by taste; the two genuinely split cases fall back to ADR 0014's claim-vs-question rule |
| 2026-08-25 | Claude | Cascade verified against production in a rolled-back transaction, not inferred from the constraint definition |
