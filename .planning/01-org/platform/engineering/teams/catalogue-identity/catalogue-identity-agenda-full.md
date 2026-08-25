---
type: agenda-full
division: platform
department: engineering
team: catalogue-identity
status: provisional
metrics: [identity.false_merge_count, identity.false_split_count]
updated: 2026-08-24
links: ["[[catalogue-identity-charter]]", "[[catalogue-identity-premortem]]", "[[catalogue-identity-agenda-board]]", "[[catalogue-identity-loops]]", "[[engineering-agenda-full]]", "[[annotation-ground-truth-charter|dat-annotation-ground-truth]]", "[[DISH_IDENTITY_DESIGN]]"]
---

# Catalogue & Identity — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Turn "false-merge count, target zero" from a stated policy into a **read number**, then
keep it at zero while the catalogue grows. Three concrete deliverables, in order:

1. **A labelled identity set.** Ground truth for beverages, producers, and (later) dishes.
   Without it `scripts/eval_merge_policies.py` scores against nothing.
2. **The scoring rule as a CI gate**, not a script. Two columns — merges and splits —
   never one number.
3. **Producer normalization brought under merge governance**, since it is a merge that
   currently has none of the merge safety machinery.

Deferred on purpose: **dish identity**. `.planning/DISH_IDENTITY_DESIGN.md` exists and the
design was written *before* the deferral, which is the correct order. It stays deferred
until the beverage side has a working ground-truth loop — building two identity systems
against zero labelled sets doubles the unfalsifiable surface.

## How

**The asymmetry is the design constraint, not a preference.** Everything below follows
from one line already in the repo (`scripts/eval_merge_policies.py:5-13`): false merges and
false splits must never be summed.

- **Labelled set first, matcher second.** Any change to
  `services/agent-orchestrator/services/wine_matcher.py` before the set exists is
  unfalsifiable, and [[catalogue-identity-directive]] rejects it at team level.
- **Two columns, everywhere.** Board, CI output, PR description. If a surface can only
  display one number, it displays false merges.
- **Un-merge is not undo.** Every un-merge ships with a downstream attribution report
  (premortem M3). The migration is literally named `merge_undo_honesty` — honour that.
- **Guest identity stays minimal.** Expansion is a [[compliance-privacy-charter|compliance-charter]] conversation
  before it is an engineering one, because the merge and the disclosure are both
  irreversible.

## Why now

- The merge machinery is already dense — nine migrations, three runtime services, two
  parity guards — and it is **running without a scoreboard**.
- The wine corpus is actively being enriched (144 of 1,448 wines enriched in recent
  sessions; producer-reputation at 100% coverage on the menu corpus). Enrichment
  multiplies match surface. Every week without ground truth is a week of merges nobody can
  audit retroactively.
- `nf_b.*` guest signal accumulation has started
  (`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql`). Guest signal is
  the thing a false merge destroys, and it only accrues forward.

## Next steps

- [ ] Define the labelled identity set: scope, size, sampling, and who adjudicates a
      disputed pair — with [[annotation-ground-truth-charter|dat-annotation-ground-truth]] on methodology
- [ ] Land `eval_merge_policies` as a CI gate that fails on any false-merge increase
- [ ] Publish the first `identity.false_merge_count` / `identity.false_split_count` reading
- [ ] Add producer collapses to the labelled set as their own class (premortem M4)
- [ ] Instrument the collapse ratio for `producer_normalization.py`
- [ ] Add an outcome-side twin for `scripts/check_no_guest_name_matching.sh` (premortem M5)
- [ ] Write the un-merge downstream attribution report format before the next un-merge
- [ ] Keep `.planning/DISH_IDENTITY_DESIGN.md` warm; do not implement yet

## Questions for the founder

1. **Who adjudicates a disputed identity pair?** Two vintages, one label change, one
   importer renaming — these need a human ruling and the ruling *is* the ground truth.
   A sommelier? The founder? The answer determines whether the labelled set is buildable
   this quarter.
2. **Is `identity.false_merge_count` a hard CI blocker?** The charter says yes. That means
   a change improving splits and costing one merge is rejected, permanently, with no
   override. Confirm — the whole team's design collapses to "another matcher team" if
   there is an override path.
3. **Does producer normalization count as merging?** This charter says yes and governs it
   accordingly. It is currently treated as normalization elsewhere in the codebase.
4. **How minimal is "minimal" for guest identity?** The slice is deliberately narrow and
   the guard is a grep. What is the intended end state — and does it ever include
   name-based linkage?
5. **When does dish identity un-defer?** Proposal: when beverages have had a green
   false-merge gate for one full quarter. Is that the trigger?
