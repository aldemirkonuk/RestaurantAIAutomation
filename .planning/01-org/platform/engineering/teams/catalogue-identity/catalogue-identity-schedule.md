---
type: schedule
division: platform
department: engineering
team: catalogue-identity
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[catalogue-identity-charter]]", "[[catalogue-identity-loops]]", "[[engineering-schedule]]", "[[skills-charter]]"]
---

# Catalogue & Identity — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per PR | `scripts/check_beverage_identity_parity.py` (CI) | Identity representation parity pass/fail |
| Per PR | `scripts/check_display_name_parity.py` (CI) | Display-name fork detection |
| Per PR | `scripts/check_no_guest_name_matching.sh` (CI) | Guest name-matching guard — **grep-shaped, needs an outcome twin** |
| Per PR | Merge-policy gate — L-CI-1, `scripts/eval_merge_policies.py` promoted to a gate | `identity.false_merge_count`, `identity.false_split_count` (two columns) |
| Per event | Un-merge attribution report — L-CI-4 | Reassignment outcome or a data-loss record |
| Per event | Merge affecting a row with accumulated `nf_b.*` signal | Individual review, never batched |
| Weekly | Labelled-set coverage — L-CI-2 | Set size, per-class coverage, open disputed pairs |
| Weekly | Producer collapse watch — L-CI-3 | Collapse ratio, region-span anomalies |
| Weekly | Guest identity boundary sample — L-CI-5 | Cluster-formation audit |
| Monthly | Near-key duplicate sweep — `supabase/migrations/20260818010000_beverage_duplicates_near_key.sql`, `…20260813150000_find_library_duplicates.sql` | Candidate pairs into the adjudication queue |
| Quarterly | Dish-identity deferral review against `.planning/07-reference/DISH_IDENTITY_DESIGN.md` | Un-defer recommendation or an explicit re-defer |

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

**None built yet.** Proposed, each tied to a scheduled job above:

| Proposed skill | Fires on | Why a skill rather than a script |
|---|---|---|
| `merge-safety-review` | Merge and un-merge events | Needs judgement on derived-data reassignment, not a threshold |
| `identity-adjudication-queue` | Disputed pair arrives | Prepares the evidence packet for a human ruling; must not rule |
| `producer-collapse-audit` | Weekly collapse-ratio anomaly | Same governance as merges — deliberately not a normalization utility |

**Constraint on all three:** none of them may emit a single combined identity score. The
non-summability rule (`scripts/eval_merge_policies.py:5-13`) applies to skills exactly as
it applies to dashboards — a skill that helpfully "summarises identity quality" is the
first step of premortem M1.

Registry governance sits with [[skills-charter]] (Applied AI); this team authors and
retires its own skills within that registry.
