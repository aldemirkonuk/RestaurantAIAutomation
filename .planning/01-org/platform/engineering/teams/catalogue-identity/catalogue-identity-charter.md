---
type: charter
division: platform
department: engineering
team: catalogue-identity
status: exists
metrics: [identity.false_merge_count, identity.false_split_count, nf_b.guest_signal_attribution_accuracy]
updated: 2026-08-24
links: ["[[engineering-charter]]", "[[catalogue-identity-premortem]]", "[[catalogue-identity-agenda-full]]", "[[catalogue-identity-agenda-board]]", "[[catalogue-identity-directive]]", "[[catalogue-identity-loops]]", "[[catalogue-identity-schedule]]", "[[eng-catalogue-identity]]", "[[dat-corpora-enrichment]]", "[[dat-substrate-quality]]", "[[schema-migrations-charter]]", "[[BEVERAGE_CATALOGUE_ARCHITECTURE]]", "[[DISH_IDENTITY_DESIGN]]"]
---

# Catalogue & Identity — Charter

Division **Platform** → Department [[engineering-charter]] → Team `catalogue-identity`
(§2.1 of `.planning/foundation/teams/technology.md:73-98`).

## Mandate

Own **what a beverage or dish *is***: match keys, duplicate detection, merge and un-merge,
producer normalization, and the guest identity slice. This team decides when two rows are
the same thing in the world, and it is the only Engineering team whose mistakes cannot be
undone by reverting a deploy.

## Boundaries

Owns outright:

- **Match keys and similarity machinery** — the wine match-key backfill, word-similarity
  matching, and near-key duplicate detection.
- **Merge and un-merge** — including non-destructive merge and merge-undo semantics.
- **Producer and ontology normalization** — `producer_normalization.py`,
  `ontology_normalization.py`.
- **The guest identity slice** — the minimal, deliberately narrow identity model, and the
  guard that keeps guest *name matching* out of it.
- **Identity parity guards** — the CI checks that keep display name and identity
  representations from forking between services.

## Distinct from siblings because

A false merge is **silent, global and unrecoverable**. Every other Engineering failure
has a shape that a revert, a redeploy, or a retry addresses. This one does not: once two
distinct wines are one row, the guest signal attached to both is indistinguishable, and
the damage compounds every day the merge stands
(`.planning/foundation/teams/technology.md:78-80`).

## Explicit non-goals

| Not ours | Whose it is |
|---|---|
| Enriching the corpus — filling in missing attributes, sourcing producer data | [[dat-corpora-enrichment]] |
| Judging whether a *row* is fit for use as L0 substrate | [[dat-substrate-quality]] |
| The DDL that carries identity tables | [[schema-migrations-charter]] — we specify, they author and own the migration |
| Whether a guest *should* be identified at all — consent, GDPR, retention | [[compliance-charter]] *(Corporate)* |
| Rendering identity in a UI | [[client-surfaces-charter]] |
| Agents that reason over the catalogue | [[agent-fleet-charter]] *(Applied AI)* |

## Metrics it moves

**Primary: `identity.false_merge_count`** — false merges against the labelled identity
set. **Target zero, never traded against false splits.**

The asymmetry is not this charter's opinion; it is already written into the code at
`scripts/eval_merge_policies.py:5-13`: "These two errors are not symmetric and must never
be summed into one score." `identity.false_split_count` is tracked as a **separate**
number, and no aggregate combining the two is permitted to justify a change
([[catalogue-identity-directive]]).

Neural-footprint tie: this metric is upstream of `nf_b.*` in the most literal sense — a
false merge attributes one bottle's guest signal to another, and no downstream correction
can separate them again.

## Evidence today

**EXISTS, and heavily** (`.planning/foundation/teams/technology.md:82-89`).

**Schema**
- `supabase/migrations/20260817070000_beverages_table.sql`
- `supabase/migrations/20260817060000_beverage_kind_classification.sql`
- `supabase/migrations/20260818030000_sensory_columns_generated.sql`

**Match-key and duplicate machinery**
- `supabase/migrations/20260812000000_backfill_wine_match_keys.sql`
- `supabase/migrations/20260813000000_wine_match_word_similarity.sql`
- `supabase/migrations/20260813150000_find_library_duplicates.sql`
- `supabase/migrations/20260818010000_beverage_duplicates_near_key.sql`

**Merge safety**
- `supabase/migrations/20260813030000_merge_library_wines.sql`
- `supabase/migrations/20260817120000_nondestructive_merge.sql`
- `supabase/migrations/20260818020000_merge_undo_honesty.sql`

**Guest identity**
- `supabase/migrations/20260819000000_guest_identity_minimal_slice.sql`
- Guard: `scripts/check_no_guest_name_matching.sh`

**Runtime**
- `services/agent-orchestrator/services/wine_matcher.py`
- `services/agent-orchestrator/services/producer_normalization.py`
- `services/agent-orchestrator/services/ontology_normalization.py`

**Parity guards**
- `scripts/check_beverage_identity_parity.py`
- `scripts/check_display_name_parity.py`

**Design corpus**
- `.planning/BEVERAGE_CATALOGUE_ARCHITECTURE.md`
- `.planning/DISH_IDENTITY_DESIGN.md`

**Gap, stated plainly:** the evidence for merge *machinery* is strong; the evidence for a
**labelled identity set** to measure false merges against is absent. `scripts/eval_merge_policies.py`
encodes the scoring rule but the ground-truth set it scores against is not cited in
`technology.md`. Until that set exists, `identity.false_merge_count` is a policy, not a
reading — see [[catalogue-identity-agenda-full]].
