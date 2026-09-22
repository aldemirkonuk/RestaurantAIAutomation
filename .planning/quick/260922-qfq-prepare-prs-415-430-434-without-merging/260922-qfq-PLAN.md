---
quick_id: 260922-qfq
status: planned
date: 2026-09-22
---

# Quick Task 260922-qfq Plan

## Goal

Bring PRs #415, #430, and #434 to honest audit readiness without merging: update their branches, resolve conflicts, satisfy migration ordering, integrate #434's Q9 live-sales heat map, verify focused behavior, and leave the gate-owned audit-and-merge action blocked for explicit founder authorization.

## Task 1 — Prepare #415 and #430 in parallel

**Files:** each PR branch's conflict set, migrations, gate-owned hunks, and focused tests.

**Action:**
- Preserve the existing prep agents/worktrees; consume their atomic commits rather than restarting their work.
- #415: merge/rebase current `main`, preserve union-style registries and claims, drop or relocate edits to deleted `apps/web/e2e/prod-smoke.spec.ts`, renumber both migrations past the current main tip, and verify the `.github/workflows/ci.yml` hunk only adds intended fail-closed coverage.
- #430: merge/rebase current `main`, preserve union-style claims/shared registries, renumber the five pre-tip migrations, and verify the CI guards fail closed plus `.planning/decisions/README.md` remains index-only.
- Run focused branch tests and repository guards; push atomic preparation commits to the PR heads, but do not invoke the audit gate or merge.

**Verify:**
- Both PRs report mergeable/clean against the then-current `main`.
- Migration-order, migration-uniqueness, ADR-number, decision-claims, and affected test suites pass.
- Gate-owned diffs are captured verbatim in the readiness report.

**Done:** #415 and #430 are green and audit-ready, with founder authorization as their only merge gate.

## Task 2 — Integrate and verify #434 Q9

**Files:** the focused commit produced in `/Users/aldemirkonuk/Projects/wt-pr434-q9-heatmap`, #434's conflict set, heat-map UI/data path/tests/claim, and gate-owned README hunk.

**Action:**
- Wait for the existing heat-map agent's atomic commit; do not duplicate, reset, or overwrite its work.
- Review and integrate that commit into `feat/page-cellar`, requiring a tenant-scoped non-alcoholic sales-by-hour read from the live POS series, honest not-connected/empty states, focused tests, and a re-checkable claim.
- Rebase/merge current `main`, resolve `CLAIMS.jsonl` and `apps/web/vercel.json` without losing either side, and keep `.planning/decisions/README.md` index-only.
- Record the unresolved acceptance fork: whether an honestly empty-until-sales production state proves “wired” when no house has POS data.

**Verify:**
- Focused gateway and web heat-map tests pass, including failed-read and no-POS states.
- Claims and repository guards pass.
- #434 is clean against `main`; no #454 preview or unrelated #414 get-started work is introduced.

**Done:** #434 is technically prepared, but remains held until Q9's acceptance question is answered and the founder authorizes gate-owned audit-and-merge.

## Task 3 — Produce audit-ready handoff and stop

**Files:** quick-task SUMMARY, readiness inventory, and `.planning/STATE.md` Quick Tasks Completed row.

**Action:**
- Record each PR's head SHA, divergence, conflicts resolved, migration versions, focused verification, required-check state, gate-owned paths, and remaining blockers.
- Prepare sliced audit bundles for #430 and #434 by coherent file group because their full diffs likely exceed the gate's 300k-character budget.
- Record the post-authorization sequence: #415 → rebase/re-audit #430 → rebase/re-audit #434. Each audit is SHA-pinned and invalidated by the next branch update.
- Recommend founder authorization for #415 + #430 now and holding #434 until Q9 is accepted.
- Update `.planning/STATE.md` only; do not modify `ROADMAP.md`.

**Verify:**
- No PR has been merged, no audit PASS marker has been posted, and no production flag/deploy action has run.
- The handoff names the exact founder answers required and the next commands/actions after authorization.

**Done:** Non-authorized preparation is complete and the serial audit/merge lane is ready to resume from explicit founder word.

