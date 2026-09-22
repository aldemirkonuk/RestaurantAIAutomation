# Quick Task 260922-qfq: Prepare PRs 415, 430, and 434 without merging gate-owned paths - Context

**Gathered:** 2026-09-22
**Status:** Ready for planning

<domain>
## Task Boundary

Prepare PR #415 (admin), #430 (`/ask` + `/authorize`), and #434 (cellar) in parallel: inventory gate-owned changes, update each branch against current `main`, resolve conflicts, implement #434's live-sales heat map, and document audit readiness. Do not merge any PR. Do not touch #454 preview or #414 get-started except where an unavoidable conflict resolution in these three branches requires preserving current `main`.

</domain>

<decisions>
## Implementation Decisions

### Audit-gate-owned changes
- #415 changes `.github/workflows/ci.yml`.
- #430 changes `.github/workflows/ci.yml` and `.planning/decisions/README.md`.
- #434 changes `.planning/decisions/README.md`.
- These are gate-owned paths under the audit gate's self-modification rule. No audit-and-merge may run until the founder explicitly authorizes that path, following the precedent used for #439.
- Preparation, conflict resolution, tests, and audit bundles may proceed without that authorization. Merge remains blocked.
- Recommended founder subset after preparation: authorize audit-and-merge for #415 and #430 now; hold #434 until Q9 is implemented and verified.
- Once authorized, merge serially as #415 → #430 → #434. Rebase, rerun required CI, and perform a fresh SHA-pinned audit between each merge because every merge moves `main`.
- #430 and #434 are likely over the audit gate's 300k-character diff budget. Prepare file-group slices for the three audit angles instead of relying on one truncated bundle.

### #434 live-sales heat map
- The founder's Q9 answer is already recorded as “wire live sales into the non-alcoholic heat map before #434 merges”; this is locked scope, not an open design question.
- An existing worktree at `/Users/aldemirkonuk/Projects/wt-pr434-q9-heatmap` on `feat/page-cellar-q9-heatmap` is actively changing the gateway beverage sales row-record path. Integrate that work; do not duplicate it.
- Do not overwrite or reset that worktree. Wait for its atomic commit, then cherry-pick or merge its focused commit into #434.
- Required shape: a tenant-scoped sales-by-hour read for non-alcoholic items from the existing POS series, honest empty/not-connected states, tests, and a re-checkable claim.
- Founder question remains open: if no house currently has POS sales data, does an honestly empty-until-sales heat map count as Q9 “wired,” or must production-like sales be demonstrated before #434 can enter audit?

### Branch handling
- Work in isolated worktrees; the source checkout has unrelated uncommitted founder work.
- Existing prep worktrees for #415 and #430 contain broad in-progress `main` merges and unresolved conflicts. Inventory them but do not overwrite another agent's state.
- Keep commits atomic per PR. Pushing updates to the three PR branches is allowed; merging into `main` is not.
- #415 must renumber both migrations past the current `main` tip and resolve the deleted `prod-smoke.spec.ts` path without resurrecting the retired file.
- #430 must renumber its five migrations that sort before the current `main` tip; re-evaluate those versions after #415 lands.

### Claude's Discretion
- Exact conflict resolutions where both sides can be preserved mechanically and no product decision is introduced.
- Focused verification commands and audit-prep report format.

</decisions>

<specifics>
## Specific Ideas

- Current branch divergence at capture time: #415 is 20 behind/3 ahead, #430 is 13 behind/12 ahead, #434 is 14 behind/10 ahead.
- GitHub reports #415 and #430 as `CONFLICTING`/`DIRTY`; #434's mergeability was temporarily `UNKNOWN`, while the deploy blocker record identifies a `CLAIMS.jsonl` conflict and stale checks.
- All three current heads have a failing `PR Audit Gate` check and no SHA-matched audit marker.
- Current required contexts on `main`: `CI Complete`, `Beverage identity key — SQL matches Python`, `Guest merge policy — zero false merges`, `Fresh database equals remote`, and `Code queries only relations production has`.
- Prepare gate-specific review notes: #415's `ci.yml` hunk must preserve triggers/check names and remain fail-closed; #430's CI guards must fail closed and its README edit must be index-only; #434's README edit must be index-only, with role-gated pricing/menu-read security and #430's shared model-client edit reviewed together.

</specifics>

<canonical_refs>
## Canonical References

- `.claude/skills/pr-audit-gate/SKILL.md` — gate-owned paths and founder escalation rule.
- `.planning/07-reference/deploy/PAGE-WAVE-BLOCKERS-2026-09-22.md:70,177,200` — #434 Q9 live-sales requirement and readiness notes.
- `.planning/07-reference/deploy/PAGE-GAP-QUESTIONS-2026-09-22.md:158-168` — original Q9 decision framing.
- `.planning/07-reference/deploy/THREE-GATE-OWNED-SKETCH-2026-09-22.md` — Opus sketch establishing parallel prep, serial merge order, migration-renumber requirements, audit slicing, and the recommended founder subset.
- PR #439 audit comment — precedent: founder explicitly authorized audit + merge-on-HOLDS before a gate-owned PR merged.

</canonical_refs>
