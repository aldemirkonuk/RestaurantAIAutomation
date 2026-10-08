Branch `fix/what-to-buy-back-runs-out-first`, one commit (8d2a225b5) on top of #619 (`fix/stockout-counts-open-ml`, head 36eb73df8). It changes 14 files against 36eb73df8, and 19 against origin/main (28d32de36), because #619's 15 files are underneath. **Stacked: open it against `fix/stockout-counts-open-ml`, and merge it right after #619** (see Merge-order notes). No SQL changed.

## What was wrong for the owner

The analytics walk on Tuzlu Rüzgar (read-only, production, 2026-10-03) found these problems in "What to buy back":

- **A-025 (AW29).** The restock list tied 8 rows at exactly 61% (0.6098). Pierre Ferrand came first with 45 true days of cover. Ten of the 25 listed rows were spirits, and only 11 of the 27 wines truly at 7 days of cover or less were listed. The register showed 56 of 134 wines below their reorder point. The "Tonight" card told the owner to order Pierre Ferrand.
- **A-070 (C14).** Two of five wines tied at 27% were listed under "the 25 at the highest risk". Database row order picked which two.

#619 (ADR 0299) removed the 61%: on hand now counts the open bottle, and a wine sold on fewer than 14 days gets no risk. It left ADR 0272's order alone, which is highest measured risk first, then the fewest days of cover. That order puts every measured risk above every wine with none. An empty slow seller sat behind a measured 6%, and once 25 measured wines were below their reorder point it fell off the list.

The walk scored the list by days of cover: 27 wines truly at 7 days or less. Below the listed rows sat a group with nothing to judge, the wines with no sale in the window and nothing on hand. ADR 0272 only bounded how many of them filled the cut (fork 3). The founder answered both questions on 2026-10-04, and this PR builds the two answers.

**What Tuzlu will see.** This comes from the plan's and #619's fixture arithmetic and was not re-measured on production. Every Tuzlu row is unmeasured today, because the series still hold one import day. So #619's order and this one give the same list. The five of the walk's eight 61% rows that stay listed after #619 are ordered by days of cover in both.

The visible changes on Tuzlu are:
- the wines with no sale and nothing on hand leave the table and the bars, and one line counts them;
- the table says "the N that run out soonest";
- the "Tonight" card stays silent.

The order starts to matter once #603 dates sales by the till and wines reach 14 dated sale days.

## What changed and why

- **One order: soonest to run out first.** `bySoonestOut` (`engine/comparisons.ts:356`) sorts by fewest days of cover first, with none last. Ties go to the higher risk (unmeasured last), then fewer bottles, then name, then id. Each is compared with the 1e-9 tie tolerance.
  - The register sorts by it (`analytics.service.ts:676-678`).
  - The 25-row cut is keyed on days of cover (`:705`), so it never splits a group with the same cover.
  - A tie at 0 days extends, because each such wine sold in the window and is now empty. A null edge does not extend (`comparisons.ts:310`).
  - `extendOnlyAbove` is removed, because nothing calls it now.
- **The no-demand group leaves the table and the bars, and is counted.** The register drops each wine below its reorder point with `demandDays === 0 && onHand <= 0` before the sort and the cut, and returns the count as `noDemandCount` (`:673-678`, `:701`).
  - The group is keyed on what defines it, not on the risk. Under ADR 0299 a wine sold on 1 to 13 days also has a null risk, and that wine stays listed.
  - The engine's `restockReading` gives a no-sale wine a mean of 0, so `needsReorder` is exactly `onHand <= 0` (`inventory-science.ts:328-345`). The filter therefore removes every no-sale wine that is below its reorder point, and nothing else.
  - `reorderCount` still includes the group, so the figure "Below their reorder point" does not change.
- **One line carries the group**, on the page and in the export (as a note).
  - The line reads "N more below their reorder point have no demand to judge." For one wine it reads "1 more below its reorder point has no demand to judge."
  - When the group is everything below the reorder point, both surfaces say "No wine with demand to judge is below its reorder point." followed by the line. Before, they said "Nothing is below its reorder point", which would be false here.
- **The table sentence counts only the wines with demand.** It reads "N wines are below their reorder point; the M that run out soonest are listed." The export's table title is "Below the reorder point, soonest to run out first". #619's wording "highest measured risk first, then the fewest days of cover" is gone.
- **The bars still rank by risk.** The list now arrives soonest out first, so `barsKeepingTies` sorts the listed rows by risk itself (`rp-registers-house.tsx:610-631`).
  - The sort is stable and treats two risks within the tolerance as equal, so inside a tie the register's order stands.
  - The call site, the tie extension, and the stop when bar 14 is null or 0% are unchanged. The table keeps the register's order.
  - The days-of-cover dash note now prints only when a listed wine has no days of cover. Before, it printed under every list.
- **The "Tonight" card (`stockout_imminent`) reads `mostAtRisk`, not row 1.** With the list soonest out first, row 1 is often a wine with no measured risk, and the riskiest wine can sit past the cut behind wines sold on too few days.
  - The register returns `mostAtRisk`: its riskiest wine below the reorder point, picked from every row by `byStockoutRisk` (`analytics.service.ts:710`). The card reads it (`recommendations.service.ts:316`).
  - Whenever the card fires (risk above 0.4), it names the wine it named before the reorder. The 40% threshold and the wording are unchanged.
- **`INSIGHT_GENERATOR_VERSION` is unchanged.** The insight generator is not touched, and `byStockoutRisk` still orders the stockout #1. The register is computed on each read; there is no cache.

## Tests, guards and harness

**Tests that fail before the fix.** The source files were checked out at 36eb73df8 and the final specs were run against them. Both the builder and the verifier ran this.

- **Gateway: 12 of 49 fail** across `restock-cut-keeps-ties`, `association-comparisons` and `stockout-counts-open-ml`. They cover:
  - the new order (3);
  - the tie-straddling cut and the null edge (2);
  - fork 3's count (1);
  - the export (3);
  - the card (3). The card's control test fails on the base only because `mostAtRisk` does not exist there.
- **The commit body says 10.** That count was taken before the card tests were rewritten. 12 is the re-measured figure. The commit is not amended, because history is not rewritten.
- **Web: 7 of 86 fail** in `ReportsNext.test.tsx` with the base page. They cover:
  - the two changed #619 sentences;
  - bars ranked by risk;
  - the count line;
  - the judged count;
  - the empty-list sentence;
  - the conditional dash note.

**Mutation checks on HEAD.** Each was caught, and the files were restored after each.

- **Card reads `reorderList?.[0]`:** 2 of 3 card tests fail.
- **`mostAtRisk` picked from the 25-row cut instead of from every row:** 1 fails.
- **No-demand group keyed on a null risk:** 6 fail.
- **`reorderCount` made to exclude the group:** 1 fails.
- **Claims verifies:** each of the 3 amended verifies exits 1 on a `git archive` of 36eb73df8 and 0 on HEAD. 14 targeted mutations of them all fail, with 0 no-ops. The mutations:
  - the list sorted by risk again;
  - risk compared before cover;
  - the cut keyed on risk;
  - the card reading row 1;
  - the bars not sorting;
  - the group listed again;
  - the group keyed on a null risk;
  - a null edge extending;
  - the count line and notes dropped;
  - the bars' 0% stop removed;
  - #619's old export title;
  - the dash reason dropped.

**Regression at HEAD (builder and verifier):**

- Gateway `jest src/analytics src/reports/exports --runInBand --forceExit`: 60 suites, 932/932.
- Gateway `jest src/reports`: 6 suites, 107/107.
- Web `vitest run src/pages/reports src/pages/recommendations`: 22 files, 468/468.

**Last call, re-run at 8d2a225b5:**

- Gateway jest: `restock-cut-keeps-ties`, `association-comparisons`, `stockout-counts-open-ml` and `src/reports/exports` give 8 suites, 140/140.
- Gateway jest: every `recommendation*` spec, `goal-source-rule`, `advanced-analytics*` and `consultants*` give 12 suites, 202/202. These hold the other `stockout_imminent` specs.
- Web `ReportsNext.test.tsx`: 86/86.
- Gateway `tsc --noEmit -p tsconfig.spec.json`: 0 errors other than `@simplewebauthn/server`.
- Web `tsc --noEmit`: one error, `@simplewebauthn/browser` not installed in this worktree's node_modules (`src/services/api/passkeys.ts`, untouched).
- `check_decision_claims.sh`: 860 checked, 860 holding.
- `check_adr_numbers_unique.py`: exit 0, no new number.

**Lint:**

- eslint on all 9 changed code files: 0 errors. The 3 gateway specs have 0 warnings.
- `analytics.service.ts`, `recommendations.service.ts` and `report-export-cuttings.ts` keep the base's prettier warning counts (1, 74 and 59). They were not reformatted, so that merges with #607 and #615-#617/#621 stay clean.
- Web eslint (`--quiet`, web-lint plugin path) is clean on both web files.

**Guards, all exit 0:**

- every `scripts/check_*.py` that `ci.yml` lists (43), each with `--self-test` where CI runs one;
- `check_migration_order.py --self-test` (no migration changed);
- `check_no_direct_stock_writes.sh`, `check_model_calls_logged.sh` and `check_no_direct_type_attributes_access.sh`.

**Local Postgres harness: not run.** No SQL, migration or SQL function changed, so there is no `supabase/tests` file and no entry in `audits/stockcut-local-pg.txt`.

## ADR / CLAIMS touched

- **ADR 0272** (its metadata does not name the audit gate). Dated `[2026-10-05, stockcut …]` brackets go on:
  - the Status line;
  - Keywords;
  - Decision 4's cut bullet;
  - Decision 4's 0% bullet, superseded by fork 3's answer;
  - Decision 4's order bullet: the founder's order, with `byStockoutRisk` kept for the #1 and the card;
  - Consequences "Given up";
  - Not covered (the card);
  - Fork 3 (built).

  It also gets a Review trail row.
- **ADR 0299.** Dated brackets go on:
  - the Status line;
  - rule 3: the no-sale wine is counted, not listed;
  - rule 5, superseded in part: one order, one sentence;
  - the founder answers (built);
  - the "Tonight" card consequence.

  It also gets a Review trail row.
- **Claims, amended in place.** The claim text is bracketed, the verify rewritten, and `verified` set to 2026-10-05.
  - `SIG-RESTOCK-CUT-KEEPS-TIES`: the order, the cover-keyed cut, the bars' own sort, the card's `mostAtRisk` and the "soonest" wording.
  - `SIG-RESTOCK-ZERO-TIE-NOT-EXTENDED`: fork 3's group, filter and count; the null-edge stop; no `extendOnlyAbove`; the count line on both surfaces; the bars' 0% stop.
  - `STOCKOUT-DASH-SAYS-WHY`: #619's order sentence is replaced by the export title and the page wording. The dash reasons are kept.
- **`tech-debt.d/2026-10-04-fix-stockout-counts-open-ml.md:7`.** The "OWED: the follow-up branch" bullet is bracketed as built, on the same line, so no citation drifts.
- **`.planning/decisions/README.md` is not edited.** An existing README row is not edited from a lane, so its rows for 0272 (`:200`) and 0299 (`:204`, added by #619) go stale:
  - Row 0272 still says forks 1 to 3 stay open, and "a 0% tie is never extended, so the restock cut is bounded".
  - Row 0299 still says the follow-up answers "go on the follow-up branch".

  A README touch-up is owed after merge (see Not covered).

## Founder answers

Both are quoted verbatim in ADR 0272 Decision 4 and in ADR 0299, taken from the lane brief and `founder-answers-2026-10-03-analytics-fixes.md`.

- **"What to buy back" order** (AskUserQuestion, 2026-10-04 ~20:50Z): *"Soonest to run out (Recommended)"*. The option text (`wave3-forks.md:64`) set out what the answer builds:
  - days of cover for every row, with the percentage only breaking ties;
  - the 25-row cut re-keyed on days of cover, with no extension at a null edge;
  - the bars sorting the listed rows by percentage on their own;
  - 'the N at the highest risk' becoming 'the N that run out soonest' on the page and in the export;
  - the "Tonight" card picking "the highest measured percentage instead of row 1".

  Each of these is built.
- **ADR 0272 fork 3** (AskUserQuestion, 2026-10-04 ~21:30Z): *"Out of both, say a count"*. The 0% group (no measured demand in the window, nothing on hand) leaves BOTH the restock table and the 14 bars, and one line carries them: "N more below their reorder point have no demand to judge." Built.

## Forks deferred

No fork was asked. These are build picks made inside the answers above, and the founder may want to see them. Each has a recommendation.

- **The singular line for one wine:** "1 more below its reorder point has no demand to judge." Recommendation: keep it. The plural form would print "1 more … have".
- **The empty-list sentence:** "No wine with demand to judge is below its reorder point.", then the line.
  - This is new copy. It is needed because "Nothing is below its reorder point" would be false when only the no-demand group is below.
  - The alternative is to print the count line alone.
  - Recommendation: keep it.
- **The table sentence counts only the judged wines** (`reorderCount − noDemandCount`). The figure "Below their reorder point" keeps counting all of them, and the count line's "N more" makes up the difference.
  - The alternative is to count all of them in the sentence too. Then "N more" would double-count.
  - Recommendation: keep it.
- **The card picks from every wine below its reorder point** (`mostAtRisk`), not only from the 25 listed.
  - Picking only from the listed rows would let the card go silent on a house whose first 25 rows have no measured risk. A test pins that case.
  - Recommendation: keep it. It matches "the highest measured percentage".

## Merge-order notes

- **Base and order.** Open this PR against `fix/stockout-counts-open-ml`, where it is 14 files. Against main it shows 19, over the 15 cap. Merge #619 first. Then bring origin/main into this branch with a merge, resolving any hunk on #619's lines toward this branch (the later truth). After that, the diff against main is these 14 files.
  - If the coordinator prefers it and the branch is still unpushed, `git rebase --onto origin/main 36eb73df8` does the same. Do not force-push a pushed branch.
  - If #619 gets another fix round, merge its new head into this branch first.
- **Shared files.** These open PRs share a file with this branch. A `git merge-tree --write-tree` dry run was re-run at last call against each one's current head, and this branch's 14 files auto-merge with every one:
  - #607 at 2854a2152: `recommendations.service.ts`. Its hunks are at the imports, a new block after line 41, and lines 265-283. This branch's one hunk is at 307-319.
  - #609 at 12d1d9e6f: `analytics.service.ts`.
  - #615 at f315abb07: `report-export-cuttings.ts`, `rp-registers-house.tsx` and `ReportsNext.test.tsx`.
  - #616 at cfa9876d7: `analytics.service.ts` and `report-export-cuttings.ts`.
  - #617 at 0355bbf64: `analytics.service.ts`, `report-export-cuttings.ts`, `rp-registers-house.tsx` and `ReportsNext.test.tsx`.
  - #621 at b440d85fa: `report-export-cuttings.ts` and `rp-registers-house.tsx`.
- **Conflicts the dry runs report.** They are #619's own: `.planning/decisions/README.md` with all six, and `insight-generator.service.ts`'s version header with #607 and #609. #619's PR body covers both. #620 (zoneaddr) shares no file.
- **Placement of the new web tests.** They sit right after #619's ADR 0299 block in `ReportsNext.test.tsx`, not at the end of the file, to stay clear of #615's append.

## Not covered (CLAUDE.md §0.5)

**Not measured or checked**

- **Nothing was re-measured on production**, because no production reads are allowed. What Tuzlu's list looks like after this PR comes from fixture arithmetic. How many Tuzlu wines fall in the no-demand group, which is the N the count line will print, is not known. The walk's register had 31 wines with an `unknown` XYZ class, meaning a null CV (`inventory-science.ts:497-498`). That bounds N from above only if a null CV meant no sale in the window on that build. This was not checked.
- **The page was not rendered in a browser** (CLAUDE.md §9). The copy, bars and notes are proven only through the catalogue `view()` in `ReportsNext.test.tsx`. Rendering needs a live gateway.
- **CI has not run.** The branch was pushed 2026-10-05 stacked on #619; CI runs only once it is retargeted to `main` after #619 merges. The ownership classifier is run by the coordinator once the PR has a number.
- **Web prettier was not run.** The lane's eslint command was used instead.

**Residuals and accepted consequences**

- **The list can run past 25 without bound** when wines with the same days of cover straddle row 25. The large case is wines that sold in the window and now hold nothing (0 days). Every one of them is a wine to buy back, and the founder's option text bars extension only at a null edge. 30 such wines list all 30 (pinned by test). Before, the 0% tie was capped at 25.
- **`advanced-analytics.service.ts:770` `reorderTop`** (`reorderList.slice(0, 5)`) now holds the 5 that run out soonest, not the 5 riskiest. No web, mobile or export code reads `reorderTop` (git grep).
- **The consultants' evidence pack** (`consultants.service.ts:151`) now receives the list soonest out first. Neither it nor `reorderTop` carries `noDemandCount`, so the no-demand wines are inside `reorderCount` but not visible to the consultants.
- **The bars' 0% stop is now practically never reached.** A wine below its reorder point with measured demand has a risk of at least 1 minus the service level. The stop is kept as a guard.
- **The dash note for a listed wine with no days of cover is kept**, though such a row is now rare. Cover is null only when the mean is 0 or less (`inventory-science.ts:239`). That happens when negative consumption rows net a sold wine's window to zero or below. Such a wine is empty and still listed, with a dash.
- **The export prints `noDemandCount` as a raw number**, while the page uses `figure()`. A count of 1,000 or more would print without a thousands separator in the export. This is cosmetic.
- **ADR 0299's bracket "On Tuzlu it stays silent: no wine there has a measured risk"** is dated 2026-10-05 and true on today's one-import-day series. It stops being true once #603 lets a Tuzlu wine reach 14 dated sale days.
- **Records that go stale or need a later touch:**
  - The README index rows 0272 (`:200`) and 0299 (`:204`) are stale. A coordinator-owned README touch-up is owed once this merges.
  - Commit 8d2a225b5's body says "10" failing gateway tests where the measured figure is 12.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
