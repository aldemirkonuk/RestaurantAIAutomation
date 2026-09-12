# 0030 — Delete orphaned POS mappings, and make the database refuse new ones

- **Status:** Locked
- **Date:** 2026-08-25
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** pos, pos_item_mappings, inventory, foreign key, teardown, synth, write-set, orphan, cascade
- **Links:** [[0010-gemini-model-retirement]] (same failure shape: a silent fallback that looked like success), [OPEN-DECISIONS](OPEN-DECISIONS.md) — *the two register entries this closed were numbered 68 and 69 on 2026-08-25; both numbers have since been spent on unrelated decisions, so they are described here rather than cited* (what to do with the 92 orphaned mappings · what delete behaviour the new FK takes), `supabase/migrations/20260825120000_pos_item_mappings_inventory_fk.sql`, [[0011-pos-sale-volume-contract]] (concurrent POS work on `feat/pos-sale-volume`), `scripts/synth/write_set.py`, `apps/api-gateway/src/pos-hub/pos-hub.service.ts`


> **Restored 2026-08-27, and renumbered 0012 → 0030.** This decision was written and locked 2026-08-25 in `32aa26c3` and then **lost**: the commit is not an ancestor of `main`, a squash-merge dropped the file, and a concurrent session later spent **0012** on a different decision. Recovered verbatim from the object store; only the number, the H1 and cross-references to the other two restored ADRs were changed. Anything citing it as **ADR 0012** predates the restore. Its two register citations went the same way — the numbers 68 and 69 now belong to other decisions — so they are described in words instead.

## Context

All 92 rows in production `pos_item_mappings` carried a non-null `inventory_id`
that resolved to **zero** rows in `restaurant_inventory`, alongside 92 still-`pending`
`pos_catalog_match_proposals` with equally dangling `candidate_inventory_id`. The
table had no foreign key on `inventory_id` — `pg_constraint` held only the pkey and
the `sale_unit`/`sale_volume_ml` CHECKs — and none on `restaurant_id` either, so the
rows also outlived a `restaurant_id` that is not in `restaurants` at all.

**The ids were not synthesized.** Every one of the 92 reproduces exactly as
`uuid5(SIM_NS, "sim.inventory.bistro.<signature_hash>")` over the 342 wines in
`datasets/sim/menus/bistro.json` — 92 of 92, zero misses — and the owning
restaurant is `uuid5(SIM_NS, "sim.restaurant.bistro")`. These were real seeded rows
whose inventory, and whose restaurant, `synth teardown` deleted.
`CatalogMatcherService` never invents an id: `loadInventoryCandidates`
(`catalog-matcher.service.ts:212`) only ever copies one it read out of
`restaurant_inventory`.

The leak is in the teardown registry. `scripts/synth/write_set.py:22-55` lists
`restaurants`, `restaurant_inventory`, `pos_checks` and `pos_unresolved_lines` but
**not** `pos_item_mappings` or `pos_catalog_match_proposals` — both written
*indirectly*, by `pullAndMatch` auto-map (`catalog-matcher.service.ts:242`) and
`queueProposal`, rather than by `seed.py`. That file already spells out this exact
trap twice, in the comments above `pos_checks` and `pos_unresolved_lines`
("written INDIRECTLY … which is exactly why this entry is easy to forget and why
forgetting it is leakage"), and then missed it for the two tables whose rows
*outlive the tenant* rather than merely sitting beside it.

**Why the leftovers were worse than they looked.** A dangling mapping is a black
hole, not a corruption. Probed against production and rolled back: both
`apply_stock_movement` and `record_glass_pour` `RAISE 'inventory % not found'`, so
supabase-js returns `{ error }`, `pos-hub.service.ts:420-424` logs a warn and moves
on — nothing written, no stock moved, no row created. But the line has already
skipped the `if (!it.inventory_id)` queue branch at `pos-hub.service.ts:347`, so it
lands in **neither stock nor `pos_unresolved_lines`**. The sale disappears silently,
which is strictly worse than the unmapped case decision B20 built the queue to
prevent. It had not fired yet for one reason only: the 92 belonged to the dead
`bistro` tenant, while the 66 live `pos_checks` belong to a different restaurant
with no mappings at all — the same "0 rows is the only thing saving us" shape as
the three defects in the previous POS commit.

## Options considered

1. **Re-seed the `bistro` archetype.** Because the ids are deterministic, re-seeding
   restores the identical `restaurant_inventory` rows and all 92 mappings resolve
   again — with no write to `pos_item_mappings` at all. Appealing as the
   zero-data-loss option. Costs: it resurrects a torn-down synthetic tenant in
   production to justify its own leftovers, and leaves the leak in place — the next
   teardown re-creates the same 92 orphans.
2. **Delete the orphans, then constrain.** Finishes the teardown that was left
   half-done and makes the FK addable immediately. Costs: the 92 pending proposals
   (unreviewed matcher output) go with them.
3. **Re-point at the live restaurant's inventory.** Would give the 66 live checks
   real mappings. Rejected: it invents links no matcher produced, against decision
   34 ("a wrong link is worse than no link"), and the live tenant holds a different
   wine list, so most of the 92 would have no honest target.
4. **Do nothing.** The 92 are harmless *today* — they belong to a tenant no webhook
   addresses. Costs: the black-hole path stays armed for whichever tenant next gets
   mapped, and the register keeps reporting `inventory_link: "dangling"` forever.

## Decision

**Option 2, with the FK as `ON DELETE CASCADE`** — founder's call on both, 2026-08-25
("do the right clean approach and safe"; cascade chosen explicitly over RESTRICT).

Deleting won over re-seeding because the orphans are not data, they are *residue*:
the tenant they describe is gone, and what makes them recoverable is exactly what
makes them disposable — re-seeding the archetype restores the identical uuid5
inventory ids, after which `pullAndMatch` reproduces the mappings from scratch. The
92 rows were backed up before deletion regardless.

CASCADE won over RESTRICT because a mapping is cheap and reproducible while the
inventory row it points at is the durable object. RESTRICT would make a teardown
fail loudly — the more honest signal in the abstract — but it would break
`synth teardown` outright until every caller learned to delete mappings first,
converting a data-integrity fix into an operational one. `inventory_id` stays
nullable and unconstrained when null: an unmapped item is a legitimate state, and
is what routes a line into `pos_unresolved_lines`. The FK constrains *claiming* a
target, not *having* one.

The registry fix ships in the same commit. A constraint that only stops the next
bad *write* would still let a teardown delete inventory out from under a mapping —
cascade now handles that for `pos_item_mappings`, but `pos_catalog_match_proposals`
has no such FK and would keep leaking.

## Consequences

- **Easier:** a mapping can no longer name a stock target that does not exist —
  verified against production, not asserted: an insert with a deleted `inventory_id`
  is rejected by constraint name, and deleting an inventory row takes its mapping
  with it (both probes rolled back). The sale-unit review surface on
  `feat/pos-mapping-review` can drop `inventory_link: "dangling"` as a reachable
  state for new rows.
- **Easier:** `synth teardown` now removes both POS catalog tables, so a torn-down
  tenant stops leaving matcher output behind.
- **Given up:** the 92 pending proposals. They were unreviewable — approving one
  would have written precisely the mapping the FK now rejects.
- **Harder:** a teardown now silently discards mapping work rather than announcing
  it. That is the accepted cost of CASCADE over RESTRICT.
- **Not addressed:** `pos_catalog_match_proposals.candidate_inventory_id` has no FK.
  CASCADE is wrong there (a proposal can outlive its candidate and still mean
  something); `ON DELETE SET NULL` is the likely shape. Left open deliberately
  rather than decided in passing.
- **Not addressed:** `pos_item_mappings.restaurant_id` still has no FK, which is why
  92 rows could outlive their restaurant. The founder chose the inventory FK only.
- **Revisit when:** a real POS connects and `pos_unresolved_lines` starts filling
  with lines that *should* have mapped — that is the signal CASCADE is deleting
  mappings a human wanted kept, and the argument for RESTRICT gets stronger.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-25 | Claude | Root cause traced to `SYNTH_WRITE_SET`; ids proven reproducible 92/92 against `bistro.json` |
| 2026-08-25 | Aldemir (founder) | orphaned mappings → **delete**; new FK → **`ON DELETE CASCADE`**. Locked. *(Put as two register questions numbered 68/69 at the time; both numbers were later reused, so the questions are named rather than cited.)* |
| 2026-08-25 | Claude | Applied to production in one guarded transaction; read back on a fresh connection; both FK probes pass |
