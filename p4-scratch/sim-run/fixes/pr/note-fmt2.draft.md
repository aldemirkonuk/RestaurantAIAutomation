> **[2026-10-07 13:11Z, fixer, local head 1ed002e51]** Merges `origin/main` `5e6c0684e` and records the founder's 2026-10-07 answer on ADR 0294's method (M1–M6), *"Keep all six (Recommended)"*. No code changed. Not pushed; the PR's live head is still `f6b57edae`. This head needs its re-head and a fresh ADR 0090 audit.

## Commits (on top of `f6b57edae`)

- **`ee8bc1254` Merge origin/main (5e6c0684e).** Brings in the six main commits the branch lacked: #644, #627, #621, #622, #651, #620. One file conflicted, `.planning/decisions/README.md`. Its single hunk set this branch's 0294 row against main's 0301, 0303 and 0304 rows; main's 0290 row merged cleanly. `merge_main.sh` resolved it by keeping both sides' rows in number order. `CLAIMS.jsonl` merged with no conflict: main changed other rows, and this lane changes only the `ADR-0215-TEAM-MONEY-IN-THE-HOUSE-CURRENCY` row (now line 531). Main changed none of the PR's other files.
- **`ee13086a1` docs(team): lock ADR 0294's method M1–M6.** ADR 0294 Status moves from "Locked for the two rulings, and Proposed for the method" to Locked for both. The old words are kept in a dated `[Was: …]` bracket, and the Method heading gets one too. A new section, "The founder's words on the method", quotes the question, the picked option with its text and the rejected option with its text, all verbatim, answered 2026-10-07 (recorded 12:54:27Z; the answer's own second was not taken). There is a review-trail row. The README 0294 row no longer says the method is Proposed. The record also says the build has no minimum-peer floor (the median is computed when one colleague is the only other server, pinned by the spec), and that the question did not ask whether to add one, so that stays open. Residuals (a)–(c) stay OPEN.
- **`1ed002e51` docs(team): ADR 0294 names the whole-page error screen.** This is the audit's merge-turn note 1. The deploy-skew consequence said an old page's `avgCheck.toLocaleString()` "throws until the page is reloaded". /team has no error boundary of its own, so the nearest one (`HouseShell.tsx:290`, keyed by route; `App.tsx:167` with the shell off) puts its error screen in place of the whole /team page. The ADR now says that, and says it was traced in code, not reproduced. Prose only.

## Results at `1ed002e51` (origin/main `5e6c0684e`, 0 behind)

- **`lanecheck.sh wt-fix-fmt2`:** `check_migration_order`, `check_migration_versions_unique`, `check_od_ids_exist`, `check_no_conflict_markers`, `check_citation_pairing` and `check_adr_numbers_unique` all gave rc=0. files=13. ownership rc=0 `[]`.
- **`check_decision_claims.sh`** (Python 3.11.0): 921 checked, 921 holding, rc=0. **`test_check_decision_claims.sh`:** 31 ok, 0 failed.
- **Also re-run:** `check_money_states_its_currency` rc=0, `check_windowed_figures` rc=0, `check_adr_numbers_unique` (0294 introduced, 1735 refs).
- **The PR's own tests, after the merge:**
  - `PerformanceCard.test.tsx` 12/12.
  - `performance.service.spec.ts` 11/11.
  - Wider: web `npx vitest run src/pages/team` gave 13 files, 195/195. Gateway `npx jest src/team src/common/read-errors-are-not-silence.spec.ts --runInBand --forceExit` gave 14 suites, 390/390.
- **Not run:**
  - `pgtest.sh`, because the PR has no migration and no SQL test. The merge brought in main's migration `the_cellar_reads_the_tills_own_record`, which is not this PR's. The template is at `42fe1252b`, and origin/main has since moved to `5e6c0684e`. It was not rebuilt.
  - Typecheck and lint, because these commits change only prose and the merge brought in code that is main's.
  - A browser render of the card.

## Stale lines in the live body, with replacements

1. Line 1, *"**[2026-10-06 ~00:33Z, coordinator] Re-headed at `f6b57edae`.** … This is a first audit pass; the merge turn re-heads and re-audits."*
   → Keep it as history, and put the bracket above this note on top of it. The live head becomes `1ed002e51` only once it is pushed.
2. *"## Tests and guards (HEAD `82d7fa080`, origin/main `1aa4dcb8c`, 0 commits behind)"*
   → "## Tests and guards (first measured at `82d7fa080` on origin/main `1aa4dcb8c`; re-run at `1ed002e51` on origin/main `5e6c0684e`, see the top note)"
3. *"`check_decision_claims.sh`: **855 checked, 855 holding**"*
   → "`check_decision_claims.sh`: **921 checked, 921 holding** at `1ed002e51`"
4. *"`check_adr_numbers_unique` (0294 introduced, 1680 refs)"*
   → "`check_adr_numbers_unique` (0294 introduced, 1735 refs at `1ed002e51`)"
5. *"**New: ADR 0294.** R1 and R2 are Locked, from the founder's picks quoted above. M1–M6 are the build's method picks and are marked **Proposed** for the founder's review."*
   → "**New: ADR 0294.** Locked. R1 and R2 are the founder's picks of 2026-10-04 quoted above. M1–M6 are his of 2026-10-07, *"Keep all six (Recommended)"* (option text: *"Locks ADR 0294 as built. No code change; the PR goes to its re-head and audit."*), quoted verbatim in the ADR."
6. Under "## Founder answers (2026-10-04), built as worded", add a bullet:
   → "- 2026-10-07, on M1–M6: *"Keep all six (Recommended)"*. *"I want to change one"* was rejected. No code changed for it."
7. *"- **ADR 0294 M1–M6 wait on the founder's review before promotion:**"* and its six sub-bullets (blended sales per cover; `median: null`; `benchmark.state`; null rather than 0; the house-currency read; the stated member window)
   → Delete them, and put in their place: "- **Minimum-peer floor (open, not asked).** The build computes the median when one colleague is the only other server in the window (`servers: 1`), so a viewer can be set against one person's figures. Whether to add a floor is the founder's call (raised by the audit of `f6b57edae`). The 2026-10-07 answer did not address it."
8. *"This lane changes only line 528, the `ADR-0215-TEAM-MONEY-IN-THE-HOUSE-CURRENCY` row. #607's hunk is at about line 594, so a clean merge is expected."*
   → "This lane changes only the `ADR-0215-TEAM-MONEY-IN-THE-HOUSE-CURRENCY` row (line 531 at `1ed002e51`). #607 has merged, and this branch contains it. Open PRs that also touch CLAIMS.jsonl: #561, #569, #626."
9. *"`.planning/decisions/README.md` is touched by nearly every open lane PR: #533, #577, #589, #596, #598, #603 and #607–#612. … #599, #600, #601, #602 and #604 are already merged, and this branch contains them."*
   → "`.planning/decisions/README.md` is also touched by open PRs #533, #566, #577, #589, #596, #598, #609–#613, #615–#619, #626 and #648. Each adds a row. If a conflict comes up, keep both sides' rows in number order. #599–#602, #604, #607, #620–#622 and #627 have merged, and this branch contains them."
10. Under "Not covered", *"It calls `avgCheck.toLocaleString()`, which throws until reload for a member none of whose last 6 services records a check."*
    → "It calls `avgCheck.toLocaleString()`, which throws in render for a member none of whose last 6 services records a check. /team has no error boundary of its own, so the nearest one (`HouseShell.tsx:290`, keyed by route; `App.tsx:167` with the shell off) shows its error screen in place of the whole /team page, not only the card. That was traced in code, not reproduced."
11. *"**`82d7fa080` was not re-verified.** It came after the verifier's last round. … No second reviewer has read it."*
    → "**`82d7fa080`** came after the verifier's last round. The ADR 0090 audit at `f6b57edae` (PASS) read the whole diff, which includes it. The audit's notes are in `p4-scratch/sim-run/fixes/audits/614-f6b57edae/report.md`."

Lines checked and still true at `1ed002e51`: the PR changes 13 files; no open PR touches the lane's code files (an open-PR file list from `gh` shows only #614); *"No migration. Slot `20261219190000` is unused."*; the residuals (a)–(c) block; the deploy-order note; the 0215 not-edited note.
