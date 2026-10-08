> **[2026-10-08T00:22Z, coordinator] Head `ada37ebb1`** = `26b828724` plus a clean merge of origin/main `62f8967b4` (#628, cellar only; none of this PR's 15 files). Re-run at `ada37ebb1`: web vitest `src/pages/recommendations/next` **17 files, 385 passed**; web `tsc` only the known `@simplewebauthn/browser` error; lanecheck six guards rc=0, files=15, ownership `[]`; decision claims **944 checked, 944 holding**. Independent verifier at `26b828724`: clean (no musts, no shoulds). Re-head after the PASS at `5608cb36a`: a delta audit is owed before merge.

> **[2026-10-07 23:59Z, coordinator] Head `26b828724`:** `eb6280854` fixes the `stakeInSentence` comment (`rec-format.ts:75-78`), which said the headings print `STAKE_LABEL`; they print `ACT_LABEL` (`RecommendationsNext.tsx:928`), and the rail (`:791`) and the *Would change* fact (`Entry.tsx:815`) print `STAKE_LABEL`. Comment only, no behaviour change. Then `26b828724` merges origin/main `b30ca260e` (#612 `214779a76`, #653 `b30ca260e`), no conflict, git's default message; among the lane's files it touched only `.planning/decisions/README.md` (main's row). Evidence at `26b828724`: web vitest `src/pages/recommendations/next` 17 files, **385/385**; web tsc only the known `passkeys.ts` `@simplewebauthn/browser` error; claims **939 checked, 939 holding / PASS**; lanecheck six guards rc=0, files=15, ownership rc=0 `[]`, merge-base = origin/main = `b30ca260e`. Not run at `26b828724`: eslint, mutations, pgtest, layout, Browser pane, repo-wide vitest, gateway jest, the 13-guard self-tests, the ADR-number sweep, the #564 merge-tree. Still not pushed. The delta re-audit range is now `5608cb36a..26b828724`; where lines below say `6014b7ca5` as the head, read them as measured at that commit.

> **[2026-10-07 21:40Z, fixer, local head 6014b7ca5]** NOT pushed. The live head is still `5608cb36a`. The live body was re-read this round (`gh pr view 611`; last updated 2026-10-06 19:54:39Z). This one note replaces the 13:09Z and 20:07Z drafts: everything in them that is still true is folded in here, and nothing they said is needed beside it. Line numbers below are the live body's.

## Commits since the live head `5608cb36a` (first parent, oldest first)

- **`c117f7e2c`, merge of origin/main `5e6c0684e`.** It brings in #622 (`5c07cfb23`, dashboard, ADR 0290), #651 (`42fe1252b`, a receiving test) and #620 (`5e6c0684e`, house time zone, ADR 0304, with a migration and its SQL test). There was no conflict. Among the lane's files it touched only `.planning/decisions/README.md` (main's 0290 and 0304 rows). Its default message was amended locally, before any push, to say why and to carry the trailer.
- **`e5a7963ad`, docs, ADR 0288 only.** It quotes the three 2026-10-04 questions as they were put, with every option and its description: AW28 "Money / Stock (Recommended)", F1 "Stock (Recommended)" and F2 "The floor (Recommended)". It adds the transcript times, 00:22:23Z and 02:05:59Z, and a Status bracket. It adds an *Open, not yet asked* section with the two unasked forks (hidden empty act sections; register names keeping their rail capitals mid-sentence) and one review-trail row.
- **`beb231a1b`, merge of origin/main `b270a45b8` (#609, ADR 0292).** This merge was not made by a lane fixer. It has git's default message and no trailer. Among the lane's files it touched only README.md (main's 0292 row).
- **`07969f368`, merge of origin/main `ca3582988` (#649: a tables spec fixture and one claims row in `feat-tables-learned-from-the-pos.jsonl`).** It is the same kind: default message, no trailer. It changed no lane file.
- **`d12b10249`, fix(recommendations): print a register's name lower-case inside a sentence (ADR 0288).** It adds `rec-format.ts` `stakeInSentence` (`STAKE_LABEL` lower-cased). The three places that print a register name inside a sentence now use it:
  - the working's label, "Why it would change the floor" (`Entry.tsx`);
  - a pressed register's section head, "1 more filed under stock, vendors and the floor" (`RecommendationsNext.tsx` `filedElsewhere`);
  - the unfiled why, "It is shown under unfiled rather than sorted by guesswork" (`stakeFilingOf`, both sentences).
  - These are unchanged, on purpose: the rail's buttons, the entry's *Would change* fact, and the act headings (`ACT_LABEL`, never register names).
  - The working's label sits in `.rc-micro`, and `rec-next.css:28` sets that class to `text-transform: uppercase`. On screen the label reads in capitals either way; only its text in the page changed. The head (`.rc-num`) and the unfiled why (`.rc-prose`) are not transformed, so those two read lower-case on screen.
  - An unknown stake prints as its own word, lower-case, instead of throwing. `rec-scenario-picker.test.tsx`, which is not in this PR, hand-builds an entry with `stake: 'cash'`, and a bare `STAKE_LABEL[...].toLowerCase()` threw 8 of its tests.
  - Tests: two new page tests ("prints a register name lower-case inside a sentence, and as it is on the rail and the fact"; "says an unfiled entry is shown under unfiled, lower-case, inside its why") and two new unit tests ("names a register lower-case inside a sentence, and keeps the rail's capitals in STAKE_LABEL"; "prints a stake it does not know as its own word, lower-case, never a throw"). Three page assertions moved to lower-case.
  - New claim row `ADR-0288-REGISTER-NAMES-LOWER-CASE-MID-SENTENCE` (static python, 6 checks).
  - **One sentence in its message is wrong.** It says "the act headings still print STAKE_LABEL as it is". They print `ACT_LABEL` (`rec-docket.ts`, drawn as `<h2>{ACT_LABEL[a]}</h2>` in `RecommendationsNext.tsx`), and no heading prints a register name. The correct reading is "the act headings (ACT_LABEL, never register names)", which is what ADR 0288 says. The commit is not on origin (`git branch -r --contains d12b10249` is empty), but it was not amended: it sits under `8bf336fae` and the merge `077dd8c69`, so amending it would need a rebase, and the lane rules forbid one.
- **`8bf336fae`, docs: record the founder's two ADR 0288 answers of 2026-10-07.** In ADR 0288: the Status; *Open, not yet asked* (heading, intro, and each bullet with the question as put, the pick and the rejected option with their descriptions); the section-head and working bullets in *Decision*; keywords; one review-trail row. Also the README 0288 row and the page note's register paragraph. Every change is a dated bracket, with the old words kept. The section-head bracket also records two things: the width check was not re-run with the lower-case words, and the earlier "longest words" were not the longest. With Money pressed, the *Not yet filed* act can carry `1 entry · 4 more filed under stock, vendors, the floor and unfiled`, which was never measured.
- **`077dd8c69`, merge of origin/main `a323cc80b` (#613, ADR 0289, house state and country in the location editor).** Made by `merge_main.sh` this round, with no conflict, git's default message and no trailer (the script's commit, not amended). Among the lane's files it touched only README.md (main's 0289 row). The web files it brings (`components/locations/*`, `pages/settings/next/LocationsSection.tsx`) are imported by nothing under `pages/recommendations`. Its gateway, ADR and claims changes are main's.
- **`6014b7ca5`, docs(recommendations): say the working's label is drawn in capitals (ADR 0288).** This is prose only. The README 0288 row and the page note (`recommendations.md:275`) had said a register name inside a sentence "is printed lower-case", with the working as an example. Both now say "in the page's text", and add that the working's label is drawn in capitals by the stylesheet (`.rc-micro`, `rec-next.css:28`), so on screen only the section head and the unfiled why read lower-case. The README row also names the unfiled why and says the rail, the *Would change* fact and the act headings keep their capitals. ADR 0288's working bullet now names two near-misses as out of scope, because the ruling is about register names:
  - the filing label *"Why it is filed under {act}"* (`Entry.tsx`), which prints an act's name;
  - the *Whose hand* fact's *"Yours, in Vendors"*, which names the Vendors page.

## Founder answers (verbatim, `answers-2026-10-07-pm.md`)

- **14:41:21Z, #611 capitals.** Q: "#611: register names keep their rail capitals inside sentences, e.g. 'Why it would change The floor'. Lower-case them mid-sentence?" Picked **"Lower-case mid-sentence (Recommended)"**: "'Why it would change the floor'. The rail and headings keep their capitals. A small change inside #611, which needs a re-audit anyway." Rejected "Keep the capitals, as built": "The register name reads as a proper name everywhere, e.g. 'Why it would change The floor'." → built in `d12b10249`.
- **18:59:42Z, #611 hidden empty acts.** Q: "#611 (recommendations): with a register pressed (say Stock), an act section whose entries are all filed under other registers has no head at all; only the rail's counts show them. Draw a stub head for it?" Picked **"Keep them hidden, as built (Recommended)"**: "A pressed register is a filter, and a filter hides empty groups (as mail labels and issue boards do). The rail already counts what sits under the other registers. No code change." Rejected "Draw a stub head": "e.g. 'Order it · 2 filed under Stock'. It matches the heads that already say '1 more filed under Stock', but adds a line per empty act. A small code change in #611, which is being re-audited anyway." → no code change; recorded.

## Results

**At `6014b7ca5` (this round; clean tree; 15 files vs origin/main):**

- **Web vitest, `src/pages/recommendations`:** 17 files, **385/385 pass** with `--maxWorkers=3 --minWorkers=1`.
  - The first run, with default workers at load average ~47–72, gave 384/385. The one failure was a timeout ("Test timed out in 5000ms") in the pre-existing test "founder item 87 … > owners and managers are unchanged: yours, in Promotions, and Act opens it", which no 2026-10-07 commit touched.
  - Run alone with `-t "founder item 87"`, that group passed, 4 of 4.
- **lanecheck:** the six guards rc=0. files=15. ownership rc=0 `[]`. merge-base = origin/main = `a323cc80b`. Exit 0.
- **The 13 guards the body names** (Python 3.11.0): each exits 0 on a normal run. `--self-test` exits 0 for 12 of them. `check_flag_readby_anchors` has no self-test mode: the script has no `--self-test` handling, ignores the flag and runs normally.
- **ADR number:** across all 777 `origin` refs, one ref and one slug carry 0288.
- **`git merge-tree --write-tree HEAD eadb562df` (#564, still OPEN at that head):** clean.
- **SQL:** `git diff --name-only origin/main...HEAD -- supabase` is empty.

**At `8bf336fae` (the previous fixer; still the latest for these, since only prose and main's merge have changed since):**

- **Mutations of `d12b10249`.** Each source was copied with `cp -p`, mutated, run, restored and checked with `cmp` (identical):

  | Mutation | Tests failing |
  |---|---|
  | head names back to `STAKE_LABEL[s]` | 3 |
  | working label back to `STAKE_LABEL[e.stake]` | 2 |
  | unfiled whys back to "shown under Unfiled" | 2 |
  | unknown-stake fallback removed (also over `rec-scenario-picker.test.tsx`) | 9 (1 unit + 8 scenario-picker) |
  | rail label lower-cased | 6 |
  | *Would change* fact lower-cased | 5 |
  | `.toLowerCase()` removed from `stakeInSentence` | 7 |

- **The second claim row:** each of its 6 checks exits 1 under its own mutation, and each file was restored and checked with `cmp`.
- **eslint `--quiet`** on the 5 `.ts`/`.tsx` files `d12b10249` changed: exit 0.
- **Web tsc:** only the pre-existing `passkeys.ts` / `@simplewebauthn/browser` error.
- **Claims:** **923 checked, 923 holding / PASS**.

**Not run at `6014b7ca5`:**

- claims (not run here by instruction; main's #613 fragment, 7 rows, arrived after the 923/923); [2026-10-07 23:59Z: run at `26b828724`, 939/939 PASS]
- eslint and web tsc; [2026-10-07 23:59Z: web tsc run at `26b828724`, only the known passkeys error; eslint still not run]
- the mutations;
- pgtest (no SQL);
- any layout check: the lower-case heads and the four-name head have never been measured;
- the Browser pane or the live app;
- the repo-wide vitest;
- gateway jest (the PR has no gateway change);
- the verifier's run of all 61 `scripts/check_*.py`.

No push, no CI, no PR edit.

## What the delta re-audit must check (`5608cb36a..6014b7ca5`) [2026-10-07 23:59Z: now `5608cb36a..26b828724`, adding `eb6280854` (comment only) and the merge `26b828724`.]

1. **`d12b10249` code.**
   - `stakeInSentence` and its three call sites, with no fourth mid-sentence register name in `pages/recommendations/next`. The two near-misses are out of scope: an act name, and the Vendors page name.
   - The rail and the *Would change* fact still print `STAKE_LABEL`.
   - The unknown-stake fallback does not throw.
   - The 4 new tests, the 3 moved assertions, and the 6 checks of the second claim row.
   - The two method choices: the fact keeps its capital as a value, not a sentence; an unknown stake prints as its own word. Also the pinned head "… filed under unfiled", reachable only with both an unknown rule and an unknown category.
2. **The records match the screen.** The README 0288 row, the page note at `recommendations.md:275` and ADR 0288's section-head and working bullets must not claim that the working's label reads lower-case on screen. Check `.rc-micro` at `rec-next.css:28`, the head in `.rc-num`, and the unfiled why in `.rc-prose`.
3. **The founder quotes are verbatim** against `answers-2026-10-07-pm.md`, with 14:41:21Z and 18:59:42Z, as are the three 2026-10-04 questions quoted in `e5a7963ad`.
4. **The four merges** (`c117f7e2c`, `beb231a1b`, `07969f368`, `077dd8c69`) [2026-10-07 23:59Z: five, with `26b828724` (main's README row)] changed no lane source or test file. Among the lane's files they added only main's README rows (0290, 0304, 0292, 0289).
5. **Claims at `6014b7ca5`.** Run `check_decision_claims.sh` once, in the re-audit or in CI. It was last run at `8bf336fae`, before #613's fragment arrived. [2026-10-07 23:59Z: run at `26b828724` by the coordinator: 939/939 PASS.]
6. **The rewritten body** against the code: every bracket below, and no sentence broader than the code. The ownRow heading at line 50 is the one the `5608cb36a` audit called broader.
7. **`d12b10249`'s message** carries the one wrong sentence named above. It is disclosed, not amended.

## Stale lines in the LIVE body, with replacements (bracket in place, old words kept)

Where an item says "append", the new line is the old line with the quoted text added at its end.

- **Line 1**, replace the whole line with:
  "**Head `6014b7ca5` (fixer, 2026-10-07 21:40Z).** It re-heads the PASS at `5608cb36a` onto origin/main `a323cc80b` through the merges `c117f7e2c`, `beb231a1b`, `07969f368` and `077dd8c69`. None had a conflict, and among the lane's files they touched only `.planning/decisions/README.md`, adding main's rows. It adds ADR 0288 records (`e5a7963ad`). It builds the founder's 2026-10-07 answer "Lower-case mid-sentence (Recommended)" (`d12b10249`) and records it with his "Keep them hidden, as built (Recommended)" (`8bf336fae`). It corrects two of those records against the screen (`6014b7ca5`). `ownership_between(origin/main, HEAD)` = `[]`. The PR has 15 files and no SQL, and the worktree is clean. A delta re-audit of `5608cb36a..6014b7ca5` is owed. [Head at the PASS, kept: "**Head `5608cb36a` (last call, 2026-10-06 ~05:00Z).** It answers the BLOCK at `9d1d9fa53` with `1ee0c497e`. At `9d1d9fa53`, a stored `__proto__` rule key or urgency made the page throw at render. Head `5608cb36a` then merges origin/main `4528b9689` (#621), with no conflicts and no lane file changed. `ownership_between(origin/main, HEAD)` = `[]`. The PR has 15 files and no SQL, and the worktree is clean."]"
- **Line 18**, append: " [2026-10-07: not re-run since `5608cb36a`. It predates `d12b10249`, which changes words only, not any filing or rail count.]"
- **Line 42**, append: " [Changed 2026-10-07 (`d12b10249`; the founder: "Lower-case mid-sentence (Recommended)"): `Order it · 1 entry · 1 more filed under stock`.]"
- **Line 43**, append: " [Changed 2026-10-07 (`d12b10249`): the names sit inside the head's sentence, so they are lower-case, "stock", "stock and vendors", "stock, vendors and the floor" (`rec-format.ts` `stakeInSentence`). With Money pressed, the *Not yet filed* act can carry four: "stock, vendors, the floor and unfiled". The rail's buttons, the entry's *Would change* fact and the act headings (`ACT_LABEL`, never register names) are unchanged.]"
- **Line 46**, append: " [Changed 2026-10-07 (`d12b10249`): in the label's text the register is lower-case, *"Why it would change the floor"* (`stakeInSentence`). The label sits in `.rc-micro`, which `rec-next.css:28` sets to `text-transform: uppercase`, so on screen it still reads in capitals. The unfiled why now says *"It is shown under unfiled rather than sorted by guesswork"* (`stakeFilingOf`, both sentences), and that reads lower-case on screen. `stakeInSentence` prints a stake it does not know as its own word, lower-case, instead of throwing.]"
- **Line 50**, append: " [Narrowed 2026-10-07; the audit at `5608cb36a` called this heading broader than the code, because the `DigestPost.tsx` floor line is a stored urgency read plain: every table keyed by an entry's stored rule key or urgency, or by a stored goal's metric, reads its own rows, except the two plain lookups under *Not covered*.]"
- **Line 52**, append: " [Narrowed 2026-10-07: keyed by an entry's stored rule key or urgency, or by a stored goal's metric, as ADR 0288 says.]"
- **After line 76**, add:
  "  - **2026-10-07 (`e5a7963ad`, `8bf336fae`, `6014b7ca5`).** The three 2026-10-04 questions are quoted as put, with every option and the transcript times. The two unasked forks were listed, then answered by the founder and recorded in place: Status, *Open, not yet asked*, the section-head and working bullets, keywords and the review trail. The working bullet says the label is drawn in capitals, and it names two near-misses as out of scope."
- **Line 80**, append: " [2026-10-07: re-run at `6014b7ca5`: vitest, lanecheck (six guards, file count, ownership), the 13 guards with their self-tests, the ADR-number sweep and the #564 merge-tree. Re-run at `8bf336fae` by the previous fixer: eslint on the 5 changed files, web tsc, claims, and the mutations of `d12b10249`.]"
- **Line 82**, append: " [2026-10-07: at `6014b7ca5`, 17 files, **385/385** (`--maxWorkers=3 --minWorkers=1`). A first run with default workers, at load average ~47–72, timed out once in a pre-existing test, which then passed alone. At `8bf336fae`: 385/385.]"
- **After line 85**, add:
  "  - `d12b10249` (2026-10-07) added 4. Two are page tests: a register name lower-case inside the head and the working, with the rail and the fact keeping their capitals; and the unfiled why. Two are unit tests: `stakeInSentence` over every register, and an unknown stake. It also moved 3 page assertions to lower-case."
- **After line 109**, add:
  "  - **`d12b10249`, seven mutations** (the fixer at `8bf336fae`; snapshot, mutate, run, restore, `cmp`). Tests failing: head names 3, working label 2, unfiled whys 2, unknown-stake fallback removed 9, rail lower-cased 6, fact lower-cased 5, `.toLowerCase()` removed 7. Each of the second claim row's 6 checks exits 1 under its own mutation."
- **Line 110**, append: " [2026-10-07: the same one error at `8bf336fae`. Not re-run at `6014b7ca5`.]"
- **Line 111**, append: " [2026-10-07: at `8bf336fae`, re-run on the 5 `.ts`/`.tsx` files `d12b10249` changed: exit 0. Not re-run at `6014b7ca5`; no lane `.ts`/`.tsx` file has changed since.]"
- **Line 112**, append: " [Corrected 2026-10-07: `check_flag_readby_anchors` has no self-test mode. It ignores the flag and runs normally, so 12 of the 13 have a self-test. At `6014b7ca5` all 13 exit 0 on a normal run, and the 12 self-tests exit 0 (Python 3.11.0).]"
- **Line 119**, append: " [2026-10-07: at `8bf336fae` (Python 3.11 on PATH): **923 checked, 923 holding / PASS**. Not re-run at `6014b7ca5`, which brings in main's #613 fragment (7 rows) and no claim row of this PR.]"
- **Line 120**, append: " [2026-10-07: "beverage parity" covers two scripts, `check_beverage_identity_parity` and `check_beverage_kind_regression`, which makes eight. That is the set other lanes list (#609, #618); this verifier's own record was not re-read, and the run was not repeated.]"
- **Line 122**, append: " [2026-10-07: not re-run with the lower-case words of `d12b10249`. Those were not the longest words a head can carry, either. With Money pressed, the *Not yet filed* act can carry `1 entry · 4 more filed under stock, vendors, the floor and unfiled`, which has never been measured.]"
- **Line 127**, append: " [2026-10-07: re-run at `e5a7963ad` (`audits/611-local-pg.txt`) on template `42fe1252b`, not rebuilt. The only 'lane' migration it applied was main's #620: `[fix] PASS`, `[ctl] FAIL`. So it again tested main's SQL, not this PR's. Not re-run at `8bf336fae` or `6014b7ca5`, because the PR still has no SQL. The block below is the run at `9d1d9fa53`.]"
- **Line 145**, append: " [2026-10-07: except that register names in them are lower-case, the founder's ruling]"
- **Line 149**, append: " [2026-10-07: now the founder's ruling, "Keep them hidden, as built (Recommended)", not only method]"
- **After line 149**, add:
  "    - the entry's *Would change* fact keeping `STAKE_LABEL`'s capital (a value, not a sentence), and an unknown stake printed as its own word (both 2026-10-07, `d12b10249`)."
- **Line 151**, append: " [2026-10-07: at `6014b7ca5` the guard and its self-test pass. Across all 777 `origin` refs, one ref and one slug carry 0288.]"
- **Line 152**, append: " [2026-10-07: the row now carries a dated bracket for the 2026-10-07 answers (`8bf336fae`, tightened in `6014b7ca5`). The rows main has added since (0289, 0290, 0292, 0304) merged in cleanly.]"
- **Line 153**, append: " [2026-10-07: there are two rows now. The second is `ADR-0288-REGISTER-NAMES-LOWER-CASE-MID-SENTENCE` (`d12b10249`), status resolved, a static python verify with 6 checks: `stakeInSentence` lower-cases `STAKE_LABEL`; the working, the head and both unfiled whys use it; the rail and the *Would change* fact still print `STAKE_LABEL`.]"
- **Line 156**, append: " [2026-10-07: the register paragraph carries a dated bracket for the 2026-10-07 answers (`8bf336fae`, tightened in `6014b7ca5`).]"
- **Line 161**, append: " [2026-10-07: the transcript stamps the answer at 00:22:23Z.]"
- **Line 162**, append: " [2026-10-07: the answers are stamped 02:05:59Z.]"
- **After line 164**, add these two top-level bullets:
  - "- **#611 capitals, 2026-10-07 (recorded 14:41:21Z):** "Lower-case mid-sentence (Recommended)", over "Keep the capitals, as built". Built in `d12b10249`."
  - "- **#611 hidden empty acts, 2026-10-07 (recorded 18:59:42Z):** "Keep them hidden, as built (Recommended)", over "Draw a stub head". No code change."
- **Line 166**, append: " [2026-10-07: two more answers since, both built as worded; the second needed no code change. ADR 0288 quotes every question and option as put (`e5a7963ad`, `8bf336fae`). The 2026-10-07 answers are in `p4-scratch/sim-run/fixes/briefs/answers-2026-10-07-pm.md`.]"
- **Line 170**, append: " [Corrected 2026-10-07: the two below were founder forks that had not been asked, not method choices (fork sweep 2026-10-06, items 15 and 16). Both were put to the founder on 2026-10-07 and answered, so no founder fork is open now.]"
- **Line 172**, append: " [Answered 2026-10-07 (18:59:42Z): "Keep them hidden, as built (Recommended)", over "Draw a stub head". No code change.]"
- **Line 174**, append: " [Not picked, 2026-10-07.]"
- **Line 175**, append: " [Answered 2026-10-07 (14:41:21Z): "Lower-case mid-sentence (Recommended)", over "Keep the capitals, as built". Built in `d12b10249`: "Why it would change the floor" in the page's text (the stylesheet still draws that label in capitals), and "filed under stock, vendors and the floor".]"
- **Line 179**, append: " [2026-10-07: at origin/main `b30ca260e` (merge `26b828724`).]" [coordinator 23:59Z: was `a323cc80b` / `077dd8c69`]
- **Line 181**, append: " [2026-10-07: clean again at `6014b7ca5`; #564 is still OPEN at `eadb562df`.]"
- **Line 183**, append: " [Corrected 2026-10-07: #564 also shares five files, listed above, so README.md is not the only shared file. Not re-measured at `6014b7ca5`.]"
- **Line 184**, append: " [2026-10-07: #620 has merged and is in this head. The rest were still OPEN on 2026-10-07. The textual overlap was not re-measured.]"
- **Line 185**, append: " [2026-10-07: #609, #613 and #622 have merged and are in this head. #577, #589, #612 and #648 were still OPEN.]" [coordinator 23:59Z: #612 has since merged (`214779a76`) and is in head `26b828724`; #577, #589, #648 not re-checked]
- **Line 186**, append: " [2026-10-07: not re-measured at `6014b7ca5`.]"
- **Line 188**, append: " [2026-10-07: the second claim row fails CI if a register name inside a sentence goes back to its capitals, or if the rail or the *Would change* fact loses them.]"
- **Line 204**, append: " [2026-10-07: the lower-case words of `d12b10249` were checked only in vitest, as the page's text. They were not rendered.]"
- **After line 215**, add these two top-level bullets:
  - "- **"filed under unfiled" (2026-10-07).** With the ruling applied literally, a head can read `… more filed under … unfiled`. That needs an entry with both an unknown rule and an unknown category, in the *Not yet filed* act. A page test pins it as built."
  - "- **Two near-misses, out of scope (2026-10-07).** `Entry.tsx`'s *"Why it is filed under {act}"* prints an act's name inside a sentence (`ACT_LABEL`; `.rc-micro` also draws it in capitals). The *Whose hand* fact's *"Yours, in Vendors"* names the Vendors page. The ruling is about register names, and ADR 0288's working bullet names both."
- **Line 216**, append: " [2026-10-07: so do the later `beb231a1b`, `07969f368` and `077dd8c69` (the last made by `merge_main.sh`). `c117f7e2c` carries a message and the trailer. Every non-merge lane commit carries the trailer. `d12b10249`'s message says the act headings "still print STAKE_LABEL as it is". They print `ACT_LABEL`, never a register name, as ADR 0288 says. The message was not amended, because it sits under a later commit and a merge, and amending it would need a rebase.]"
- **Line 223**, append: " [2026-10-07: at `8bf336fae` the fixer re-ran vitest, eslint on the 5 changed files, web tsc, the six lanecheck guards, claims (923/923) and the #564 merge-tree, and ran the mutations of `d12b10249`. At `6014b7ca5` this fixer re-ran vitest (385/385), lanecheck, the 13 guards with their self-tests, the ADR-number sweep and the #564 merge-tree. Neither ran pgtest, the repo-wide vitest, gateway jest or any layout check, and claims were not re-run at `6014b7ca5`.]"

Lines not listed are still true at `6014b7ca5`. Line 124 ("The CSS has not changed since then") holds: `rec-next.css` is unchanged since `5608cb36a`.
