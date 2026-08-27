# 0014 — A proposal keeps its question when it loses its candidate

- **Status:** Locked
- **Date:** 2026-08-25
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** pos, pos_catalog_match_proposals, candidate_inventory_id, foreign key, set null, cascade, review queue
- **Links:** [[0030-pos-mapping-inventory-integrity]] (the other half — the mapping FK), [[0031-migration-ledger-reconciliation]] (schema and ledger now written together), [OPEN-DECISIONS](OPEN-DECISIONS.md) OD-71, `supabase/migrations/20260825140000_pos_proposal_candidate_fk.sql`


> **Restored 2026-08-27 at its own number.** Written and locked 2026-08-25 in `6780db35` and then lost — that commit is not an ancestor of `main` and a squash-merge dropped the file. **0014** was still vacant, so nothing had to move. Recovered verbatim; only cross-references to the two ADRs that *were* renumbered changed.

## Context

[ADR 0030](0030-pos-mapping-inventory-integrity.md) constrained
`pos_item_mappings.inventory_id` and deliberately left
`pos_catalog_match_proposals.candidate_inventory_id` unconstrained, recording that
`CASCADE` looked wrong there and `SET NULL` was the likely shape — but declining to
decide it inside a migration about something else.

Both columns had gone dangling together and for one reason: `SYNTH_WRITE_SET` omitted
both tables, so `synth teardown` deleted the sim `bistro` tenant's inventory and left
92 mappings *and* 92 pending proposals pointing at rows that no longer existed. Fixing
one column and not the other left the same defect live on the review queue: a human
could still approve a proposal whose candidate was gone, and `upsertItemMapping` would
then attempt precisely the write ADR 0030's FK now rejects.

Measured before deciding: the column is nullable, the table holds 0 rows, and 0
candidates dangle — so any referential action was addable without a data fight, which
means the choice had to be made on meaning rather than on convenience.

## Options considered

1. **`ON DELETE CASCADE`, mirroring the mapping.** Consistent, one rule to remember.
   Costs: it deletes the proposal, and a proposal is not only its candidate.
2. **`ON DELETE SET NULL`.** Keeps the row, clears the suggestion. Costs: a second
   referential action to explain; leaves rows that look "half filled in".
3. **`ON DELETE RESTRICT`.** Loudest signal. Costs: rejected for the same reason as on
   the mapping — it makes `synth teardown` fail rather than complete, converting a data
   integrity rule into an operational blocker.
4. **Leave it unconstrained.** Costs: the review queue keeps the exact defect the
   mapping FK just closed, one table over.

## Decision

**`ON DELETE SET NULL`** — the founder's "complete them all" (2026-08-25) authorising
the shape ADR 0030 had already reasoned toward.

The two columns earn different actions because they *mean* different things, and the
symmetry in option 1 is cosmetic:

- A **mapping** is a claim — "this POS item depletes that stock row". Delete the stock
  row and the claim is void; nothing is left to say. `CASCADE`.
- A **proposal** is a question — "this POS item is unmatched; is that the right
  target?". Delete the candidate and the **question survives**: the item is still
  unmatched and still needs a human answer. `CASCADE` would silently discard the open
  question along with its stale answer — the same class of loss decision B20 built
  `pos_unresolved_lines` to prevent. `SET NULL` discards only the dead suggestion.

This is safe because the null is already a handled state rather than a new one:
`catalog-matcher.service.ts:417` throws *"Proposal has no candidate inventory item to
approve"*, and `catalog-matcher.service.spec.ts:299` already covers that branch. So a
nulled candidate degrades a proposal from "approve this" to "needs a target" —
visible, and honest about what was lost.

## Consequences

- **Easier:** the review queue can no longer nominate a stock row that does not exist.
  Verified against production, both directions, both probes rolled back: an insert
  naming a deleted inventory id is rejected by constraint name, and deleting an
  inventory row nulls the candidate while the proposal row survives.
- **Easier:** the two POS catalog tables now degrade differently and correctly under
  the same teardown — mappings vanish, questions remain.
- **Applied and registered in ONE transaction**, schema and ledger together, which is
  [ADR 0031](0031-migration-ledger-reconciliation.md)'s rule put into practice rather
  than restated: 67 files, 67 ledger rows, still zero drift in either direction.
- **Given up:** a single uniform rule across the two tables. The asymmetry is the
  point, and it is written into the column comments so the next reader does not
  "fix" it.
- **Not addressed:** six reference columns on the four POS tables are still
  unconstrained — `restaurant_id` on all four, `master_wine_id`,
  `candidate_master_wine_id`, and two `resolved_by`. Recorded as OD-71 rather than
  decided here; the `restaurant_id` ones in particular change teardown semantics for
  four tables at once and are not a passing fix.
- **Revisit when:** a human reports a proposal that lost its candidate and cannot tell
  why — that is the signal the null needs a visible reason (a `candidate_cleared_at`
  or a status), not that the action is wrong.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-25 | Claude | Deferred out of ADR 0030 rather than decided in passing; `SET NULL` reasoned but not applied |
| 2026-08-25 | Aldemir (founder) | "complete them all" — apply it. Locked |
| 2026-08-25 | Claude | Applied + registered in one transaction; both FK semantics proven against production and rolled back |
