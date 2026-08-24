---
type: scenario
id: S17
slug: same-product-two-identities-merge
class: problem
actors: [owner, governance-reviewer, catalogue-identity, merge-engine, inventory-system]
modules: ["[[catalogue-identity-charter|catalogue-identity]]", "[[inventory-ledger-charter|inventory-ledger]]"]
signals: [duplicate-candidate, match-kind, menu-cooccurrence, vintage-agreement, nf_a]
insights_class: [duplicate-risk, catalogue-health, false-merge-rate]
tier: undecided
sim_harness: synthetic-engine
status: proposed
updated: 2026-08-24
links: ["[[SCENARIO-CONTRACT]]", "[[catalogue-identity-charter]]", "[[BEVERAGE_CATALOGUE_ARCHITECTURE]]", "[[MENU_EXTRACTION_SCALE_PLAN]]"]
---

# S17 — Same product, two identities (merge)

## 1. Trigger
Two rows in `master_wine_library` are — or might be — the same wine: created by re-import,
a vendor substitution, or phrasing drift ("Massican" vs "Massican Winery"). Bounded: from a
duplicate candidate surfaced to a human-confirmed, non-destructive merge (and, rarely, its
reversal). This is the **sharpest failure in the catalogue**: a false merge is silent,
global, and unrecoverable — the only Engineering mistake that reverting a deploy cannot undo
(catalogue-identity charter mandate). "A merge is not reversible in the way a missed merge
is" (`20260813160000_duplicate_match_kind.sql`).

## 2. Actors
Owner / governance reviewer (confirms every merge) · catalogue-identity (owns the machinery)
· the merge engine (proposes, dry-runs, executes on confirm) · inventory ledger (the loser's
stock is folded onto the keeper). No guest, no vendor in the room.

## 3. Signals
The machinery is heavily built; the signals it emits:
- **Match keys** — without them nothing was keyed and every import duplicated
  (`20260812000000_backfill_wine_match_keys.sql`: 293 rows, normalized keys all NULL, 14
  groups of 2–3 identical rows).
- **Duplicate candidates** — `find_library_duplicates` reuses the importer's matcher, O(n)
  not O(n²) (`20260813150000_find_library_duplicates.sql`).
- **Match kind** — `identical` vs `one-name-contains-the-other`; cuvee suffixes ("Castore",
  "Irpinia") are flagged as plausibly *different* wines (`20260813160000_duplicate_match_kind.sql`).
- **Menu co-occurrence** — two lines printed on the **same** menu are, by construction,
  different products, forcing `safe_to_merge = false`
  (`20260817020000_duplicate_menu_cooccurrence_guard.sql`).
- **Vintage agreement** — disagreeing non-null vintages block the merge outright
  (`20260817120000_nondestructive_merge.sql`).
- NF-A verdict of any proposing agent — advisory only; it never authorizes an auto-merge.

## 4. Queries the product must answer
- "Are these two rows the same wine?" — and, harder, "are we *sure enough* to collapse them?"
- "Exactly what would this merge change before I commit it?" — the dry run
  (`20260813040000_merge_dry_run_reports_steps.sql`) does the real work, then raises to roll
  back, carrying the step log in the exception DETAIL.
- "How many duplicates are we carrying, and how fast are they accruing?"

## 5. Outputs (in the moment)
- A **duplicate-review queue**: ranked candidate pairs with match kind and the co-occurrence
  reason surfaced as its own column, never folded into a boolean.
- A **dry-run preview** naming every FK repoint and the `restaurant_inventory` consolidation
  before anything commits.
- One-tap confirm / reject per pair — the human is the gate.

## 6. Insights the owner sees (the payoff)
- **Duplicate risk / catalogue health:** dupes per 100 rows, and "N provisionals that look
  like wines you already carry" — POS-free, within the 25.1% band ([[analytics-bi-charter]]).
- **Pending-merge queue:** how many candidate pairs await a human decision.
- **False-merge rate:** the north-star `identity.false_merge_count` / `identity.false_split_count`
  (catalogue-identity charter metrics) — the numbers that say the catalogue is trustworthy.

## 7. Decisions
**Human confirms every merge — no exception.** The system proposes candidate pairs with match
kind + co-occurrence reason and a full dry-run preview; on confirm it executes a
**non-destructive** merge — supersede, never delete: the loser is soft-deleted with
`superseded_by` and a `wine_aliases` redirect, its stock merged onto the keeper (not moved),
FKs discovered from the catalog (15 columns / 15 tables, 5 `ON DELETE CASCADE`)
(`20260813030000`, `20260817120000`). Nothing auto-runs a merge today, by design — the
co-occurrence guard exists to disarm a "loaded gun, not a fired one"
(`20260817020000...`).

## 8. Failure modes
- **False merge (the unrecoverable one):** two cuvees collapsed → the loser's inventory
  folded onto the keeper, a real distinction destroyed — silent and global.
- **Un-merge does not restore inventory:** the reversal reverses only the catalogue-level
  decision, not the FK repoints or the `restaurant_inventory` consolidation; on-hand
  overstates permanently. The audit forced the honest fix — the function reports what it did
  **not** reverse and was renamed `unsupersede_library_wine` so calling it no longer asserts
  a claim it cannot back (`20260818020000_merge_undo_honesty.sql`).
- **Guard regressions:** before the co-occurrence guard, 18 of 289 proposals were flagged
  safe-to-merge on provably distinct same-menu pairs (`20260817020000...`).
- **Missed merge:** a duplicate persists, splitting one wine's demand signal — costly, but
  cheap next to a false merge (~100:1, arch §3.9, `20260818040000_beverage_duplicates_artifact_shape.sql`).

## 9. Simulation & deploy gate
Harness: `reimport_roundtrip.py` for the phrasing-drift case, plus the **732,874-pair
known-distinct eval set** harvested free from same-menu co-occurrence and `is_artifact()` in
`build_merge_eval_set.py` (commit `b728d25`; `20260818040000...`). Gate: a merge-machinery
change ships only when it commits **zero false merges** on that eval set — the test that
killed a fuzzy threshold which had committed 212 false merges (`DISH_IDENTITY_DESIGN.md`
rationale).

## 10. Tier cut (proposed — OD-48)
Core: the duplicate-review queue — see candidates, merge manually with the dry-run preview.
Plus: ranked candidates with match-kind + co-occurrence reasons and pending-merge insight.
Pro: cross-restaurant and cross-provider dedupe, producer normalization at scale, automated
candidate surfacing — still human-confirmed, always.

## 11. Evolution feedback
Every human accept/reject of a proposed merge is a labeled pair that feeds the eval set and
moves `false_merge_count` / `false_split_count`; systematic overrides tune the match
threshold. The queue's clear-rate tells us whether the machinery proposes at a level a human
can actually adjudicate.

**Flex points:** how aggressively candidates are surfaced; who may confirm a merge (a
governance role vs the owner); whether vintage-NULL pairs are auto-blocked or reviewed;
menu-source vs provider-source priority when they disagree.
