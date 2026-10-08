> **[2026-10-07 13:17Z, fixer, local head 7f78fd109]** (not pushed)

#624 now holds #619's head `d96dcbf56` (merged in, not rebased) and the founder's answer on its four build picks. Against its base `origin/fix/stockout-counts-open-ml` it is still **14 files**. No code behaviour changed.

**Commits on top of 8d2a225b5**

- `367d76d10`: merges `origin/fix/stockout-counts-open-ml` at `d96dcbf56`, which includes main up to `5e6c0684e`. Five files conflicted. Each was resolved by keeping #619's text and putting #624's changes back on top:
  - `analytics.service.ts`: kept #624's side. #619 had only reworded the comment on the risk-keyed cut, and #624 replaced that cut and its comment.
  - `rp-registers-house.tsx` (`barsKeepingTies` docblock): kept #624's paragraph and added #619's reason (a wine sold on too few days has a null risk). Dropped #619's "as on the gateway's cut", because on #624 the gateway's cut is keyed on days of cover and has no 0% stop.
  - `claims.d/fix-stockout-counts-open-ml.jsonl`: `STOCKOUT-GENERATOR-VERSION` is #619's row. `STOCKOUT-DASH-SAYS-WHY` has #619's corrected claim text, then #624's 2026-10-05 bracket, then a new 2026-10-07 bracket, and keeps #624's verify with one addition. The new bracket says the page's "soonest" sentence prints only under a list cut short. The verify now also checks that the phrase appears once, inside the gated `more:` line. I ran 4 mutations against it; all 4 were caught, with 0 no-ops.
  - `tech-debt.d/2026-10-04-fix-stockout-counts-open-ml.md`: the OWED bullet keeps both brackets (2026-10-05, then 2026-10-06). The residual bullet is #619's.
  - ADR 0299: kept #619's brackets on Status, rules 1, 2 and 5, fork 3 and Consequences. Put back #624's brackets on Status, rules 3 and 5, fork 3 and the "Tonight" card. The review-trail rows are in date order.
  - The commit also adds new dated brackets where the merge moved what a sentence cites:
    - ADR 0299: rule 5's 2026-10-05 bracket is narrowed.
    - ADR 0299: fork 3's server cut is at `:705` on #624.
    - ADR 0299: the card's rule is at `recommendations.service.ts:462-465`.
    - ADR 0299: "On Tuzlu it stays silent" is marked not verified, because #647 has re-dated Tuzlu's POS rows since.
    - ADR 0272: three Decision 4 cites moved: `rp-registers-house.tsx:610-631` → `:650-671`, `:626` → `:666`, and `recommendations.service.ts:316` → `:462`.
- `7f78fd109`: records the founder's 2026-10-07 answer. It goes in ADR 0299's Decision as its own paragraph after the two 2026-10-04 answers. The paragraph quotes the question, the picked option and the rejected option verbatim, and says where each pick is in the code. ADR 0272's Status and two Decision 4 bullets called these picks "the build's"; dated brackets now say they are his answers. Neither Status moves to Locked, because each ADR is Proposed for picks this answer did not cover. The README index rows do not say these picks await him, so they were not edited.

**Results at 7f78fd109**

- Gateway jest:
  - The PR's own specs (`restock-cut-keeps-ties`, `engine/association-comparisons`, `stockout-counts-open-ml`) plus `src/reports/exports`: 8 suites, 140/140.
  - `src/analytics src/reports --runInBand --forceExit` (run at the merge, before 7f78fd109; that commit changes only ADR text): 63 suites, 1000/1000.
- Web vitest:
  - `ReportsNext.test.tsx`: 86/86.
  - `src/pages/reports src/pages/recommendations` (also run at the merge): 22 files, 469/469.
- `tsc --noEmit`: gateway (`tsconfig.spec.json`) and web both have 0 errors besides `@simplewebauthn`.
- `check_decision_claims.sh` (Python 3.11): 922 checked, 922 holding.
- `lanecheck.sh wt-fix-stockcut`: every check rc=0, ownership `[]`. It counts 19 files because it measures against origin/main; against the base it is 14.
- Local Postgres harness: not run. #624's diff against its base has no SQL. The merge brought in SQL only from #619 and main.

**Stale lines in the live body, with replacements**

- `:1`: "one commit (8d2a225b5) on top of #619 (`fix/stockout-counts-open-ml`, head 36eb73df8). It changes 14 files against 36eb73df8, and 19 against origin/main (28d32de36), because #619's 15 files are underneath."
  → "Three commits on top of #619 (`fix/stockout-counts-open-ml`, merged in at `d96dcbf56`): the build `8d2a225b5`, the merge `367d76d10` and the founder-answer record `7f78fd109`. It changes 14 files against `d96dcbf56` and 19 against `origin/main` `5e6c0684e`."
- `:26`, `:27`, `:28`, `:30`, `:43` (`analytics.service.ts:676-678`, `:705`, `comparisons.ts:310`, `:673-678`, `:701`, `analytics.service.ts:710`): these still hold at 7f78fd109. No change needed.
- `:38`: "(`rp-registers-house.tsx:610-631`)" → "(`rp-registers-house.tsx:650-671`)"
- `:43`: "The card reads it (`recommendations.service.ts:316`)." → "The card reads it (`recommendations.service.ts:462-465`)."
- `:88`-`:90` (regression counts): "60 suites, 932/932" / "6 suites, 107/107" / "22 files, 468/468"
  → "At 367d76d10, the merge (7f78fd109 changes only ADR text): gateway `jest src/analytics src/reports --runInBand --forceExit` 63 suites, 1000/1000; web `vitest run src/pages/reports src/pages/recommendations` 22 files, 469/469."
- `:92`: "**Last call, re-run at 8d2a225b5:**" → keep as history, and add after `:100`: "**Re-run at 7f78fd109:** the PR's gateway specs plus `src/reports/exports`: 8 suites, 140/140. `ReportsNext.test.tsx`: 86/86. Both `tsc` runs: 0 errors besides `@simplewebauthn`. `check_decision_claims.sh`: 922 checked, 922 holding. lanecheck: all rc=0."
- `:99`: "`check_decision_claims.sh`: 860 checked, 860 holding." → "`check_decision_claims.sh`: 860 checked, 860 holding at 8d2a225b5; 922/922 at 7f78fd109."
- `:140`: "`STOCKOUT-DASH-SAYS-WHY`: #619's order sentence is replaced by the export title and the page wording. The dash reasons are kept."
  → "`STOCKOUT-DASH-SAYS-WHY`: #619's two order sentences (the export's title and the page's cut-short line) are replaced by the export title and the page wording. The dash reasons are kept. Since 2026-10-07 the verify also checks that the page's phrase sits once, inside the gated `more:` line."
- `:142`, `:212`: "its rows for 0272 (`:200`) and 0299 (`:204`, added by #619)" → "its rows for 0272 (`:200`) and 0299 (`:209`, added by #619)"
- `:148`-`:160` (Founder answers): add a third bullet: "**#624's four build picks** (AskUserQuestion, answered 2026-10-07): *"Keep all four (Recommended)"*, "As built. No code change." The question and both options are quoted verbatim in ADR 0299's Decision."
- `:162`-`:176` (Forks deferred): "No fork was asked. These are build picks made inside the answers above, and the founder may want to see them. Each has a recommendation."
  → "**Forks asked since (2026-10-07).** The four build picks below were put to the founder, and he picked *"Keep all four (Recommended)"*, "As built. No code change." He rejected *"I want to change one"*. They are now his answers, recorded in ADR 0299's Decision and bracketed in ADR 0272." Keep the four bullets as the record of what was asked, and drop each "Recommendation: keep it."
- `:180`: "Merge #619 first. Then bring origin/main into this branch with a merge" → keep, and add: "#619 has since gone through more fix rounds. Its head `d96dcbf56` was merged into this branch on 2026-10-07 (367d76d10)."
- `:183`-`:189` (Shared files): "#607 at 2854a2152 … #609 at 12d1d9e6f … #621 at b440d85fa"
  → "#607 (`1884dea38`), #621 (`4528b9689`) and #609 (`b270a45b8`, merged 2026-10-07 13:11:55Z) are on `main`. #615 (`6f2f063ef`), #616 (`ae079c377`) and #617 (`22a192cf2`) are open, and their dry runs were not re-run at 7f78fd109."
- `:199`: "CI has not run. The branch was pushed 2026-10-05 stacked on #619" → keep, and add: "7f78fd109 is local, not pushed."
- `:210`: "ADR 0299's bracket "On Tuzlu it stays silent: no wine there has a measured risk" … stops being true once #603 lets a Tuzlu wine reach 14 dated sale days."
  → "ADR 0299's bracket "On Tuzlu it stays silent" is now marked not verified (2026-10-07 bracket). #603 is on `main`, and #647 re-dated Tuzlu's POS rows on production on 2026-10-05. Whether any Tuzlu wine now has 14 sale days has not been re-measured."

**Still owed**

- `origin/main` moved to `b270a45b8` (#609, merged 13:11:55Z) during this session, after #619's `d96dcbf56`. A dry run of `merge-tree origin/main HEAD` conflicts in `insight-generator.service.ts`. That is #619's file (the `INSIGHT_GENERATOR_VERSION` header), not one of #624's. #619 has to merge `b270a45b8` first, and then this branch merges #619's new head.
- No three-role ADR 0090 audit has run on #624 at any head.
