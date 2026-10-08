## 2026-10-08 01:06Z: coordinator note, lane caltakings (#610), fixer after the verifier's shoulds at `009f6527b`

**Local only, not pushed.** New head `4862cc72e81aafd350e6d7029b5116afee1b4d03` (`4862cc72e`). Live PR head `31c5ec562`. Merged origin/main `62f8967b4` (clean, no conflict; main touched only `.planning/decisions/README.md` of this lane's files). origin/main has since moved to `be9a16ccf` (#652, recommendations/analytics files only); `git merge-tree` against it is clean, and it is not merged. Files vs origin/main: 14 (lanecheck at `4862cc72e`).

### Commits since `009f6527b`

1. `f2bfa2f73` fix(calendar): a refused register's day says its net sales could not be read; F1 is (b) by the founder's money rule.
2. `4862cc72e` merge origin/main `62f8967b4`.

### Each should, and how it was answered

- **(1) ADR 0287 :60, the Decision-5 clause.** Decision 5 says only that nothing else reads the pair rows; the reach-across reason is `keepPairs`'s doc comment (`day-record.service.ts`). The rejected update path now cites `prediction_outcomes`, `services/self-evolution/main.py:194` (insert) and `:218` (update), and that comment, with a `[Corrected 2026-10-08, coordinator: ...]` bracket saying what it said.
- **(2) :50/:83, "pair written in full".** Both gain a 2026-10-08 bracket: under a sales-register refusal no pair is written for the window, whoever opened it (§Decision 8).
- **(3) :76/:83, the old "ANSWERED"/"Chosen." F1 list.** :76's header is followed directly by the rewritten bracket; :83's "Chosen." gains "chosen by citation of his money rule, not by a pick"; the old list's "Recommended: (b)" gains "no longer a recommendation put to him".
- **Coordinator's correction: F1 is not reopened.** F1 = (b) by citation of the founder's money rule, ADR 0253 round 10 (on #566 at `de4e8cade`, unmerged), quoted: *"owners and managers get it and some authorized staff this rule can be opt out for managers too"*, the authorized staff holding *"Its own right (Recommended)"*; round 11 F6 *"Everywhere (Recommended)"*. The right is not built (`user_restaurant_access_role_known` holds owner/manager/staff), so the role decides: (b). (d), the per-person grant, is recorded as the rule's next step when the houses lane builds the right, not as a rival. Rewritten, each with a bracket naming the old words: ADR 0287 Status, Founder answers, Decision 6, §Forks F1 (and the 2026-10-07 review-trail row, and Revisit when); the README 0287 row (new on this branch, so edited; no main row touched); ADR 0111 §2b; calendar.md :181-188; the claim text; the comments at `calendar.controller.ts:738-745` and `day-record.service.ts:140-148`; the docblock in `SkyMark.tsx` and one test comment.
- **F3: decided (b) by the coordinator under the founder's 2026-10-07T20:04:10Z delegation, and built.** Verified against `briefs/cap.md:63` (ADR 0292 fork 3, *"Say 'could not be read' (Recommended)"*), `:59` (fork 1, *"Refuse and say so (Recommended)"*, rejecting a labelled partial) and `briefs/answers-2026-10-07-pm.md` 14:41:21Z (#619, *"Say it couldn't be read (Recommended)"*). Those rulings were about pours, insights and the stock rollup; that they cover this panel is the coordinator's reading, recorded as such.
  - Code: `SkyMark.tsx:230-241`: `if (withheld) return null;` then `if (refused) {` the em dash and "net sales could not be read", `data-takings="unreadable"`, before the mark reads `day.recorded`. A withheld viewer still gets no mark (F1 before F3).
  - Tests: `CalendarNext.test.tsx:1210` (month panel and Day view, a figure that reached the page is not drawn), `:1233` (a refused day with only its weather half), `:1246` (withheld + refused draws nothing).
  - Rejected in ADR 0287 F3: (a) nothing in the slot, as built at `009f6527b`; (c) a labelled partial or an older pair's figure; (d) the refusal sentence repeated in the slot.
  - The claim's item 11 is rewritten to check that branch.

### Evidence at `4862cc72e`

- Gateway `npx jest src/calendar src/common/read-whole-window.spec.ts --runInBand --forceExit`: **16/16 suites, 367/367** (gateway files changed only in comments). Analytics files are not touched, so `src/analytics` was not run.
- Web `npx vitest run src/pages/calendar`: **4/4 files, 126/126**; `CalendarNext.test.tsx` 77 (was 75): the refusal test rewritten, two added.
- Web mutants (cp -p snapshot, mutate, run, restore, cmp identical): the refused branch returning null fails 2; the refused check moved above the withheld one fails 1.
- Claim verify: 7 new mutants each exit 1 (branch returning null; refused above withheld; branch drawing `takings()`; tag "net sales not recorded"; figure `0` for the em dash; refused prop dropped from DayLedger; main's `SkyMark.tsx`). A first try that mutated the docblock's copy of the words exited 0, as it should, since comments are stripped; it was redone on the code.
- `check_decision_claims.sh`: **943 checked, 943 holding, PASS.**
- lanecheck `wt-fix-caltakings`: the six checks rc=0, files=14, ownership `[]`, rc=0.
- tsc: gateway `tsconfig.spec.json` 2 errors, web 1, all TS2307 `@simplewebauthn/*` (known).
- eslint: web `--quiet` on SkyMark and CalendarNext.test exits 0; gateway on the two commented files 0 errors, 8 warnings, none on the edited lines.

### Not done / not covered

- **Covers and line under a refusal (pre-existing on main, from #609):** `DayRecordMark` still says "covers not recorded" and the day line "No sales register is connected, so this day has no record.", because the refused ledger returns `posConnected: false`. Recorded in ADR 0287 F3 "Not covered"; owed its own fix (lane cap / ADR 0292).
- A passed day in a refused window with no weather half has no record, so no takings mark; only the page's line says the refusal.
- Not re-run: local Postgres (no SQL here), `check_gateway_boots.sh`, the 44 `check_*.py` guards one by one (only the claims guard and lanecheck), a Browser-pane check (jsdom only). Production not read.
- Not merged: origin/main `be9a16ccf` (#652), clean per `git merge-tree`.
- The re-audit is owed at `4862cc72e`. The live body's stale lines are listed under the 2026-10-07 note below; with these corrections: L38/L86/L121 say F1 is (b) by citation of the money rule, no confirmation owed (not "his confirmation owed"); L92-96 Forks deferred lists neither F1 nor F3 (F3 is decided and built); L29 reads "…, and under `recordedRefusal` it says 'net sales could not be read' instead"; L52 reads "4/4 files, 126/126. `CalendarNext.test.tsx` has 77"; L69 reads "943 checked, 943 holding"; L90 reads "11 conditions; item 11 rewritten 2026-10-08 for F3, 7 more mutants".

## 2026-10-07 20:45Z: push note, lane caltakings (#610), fixer after the BLOCK at `31c5ec562`

[Corrected 2026-10-08, coordinator: superseded by the note above. Its F1 "his confirmation is owed" / "reopened" lines are wrong under the founder's money rule (ADR 0253 rounds 10-11): F1 is (b) by citation, no ask. F3 is decided (b) and built at `f2bfa2f73`. Head is now `4862cc72e`, base origin/main `62f8967b4`; counts below are at `009f6527b`.]

**Local only, not pushed.** Head `009f6527b`. Live PR head `31c5ec562`. origin/main `ca3582988`. Files vs origin/main: 14.

### Commits since the live head (`31c5ec562..009f6527b`)

1. `aea170f7c`: merge origin/main `ca3582988`, bringing in #609 (`b270a45b8`, ADR 0292) and #649. `merge_main.sh` reported a manual conflict, so the merge was run by hand. The one conflict was in `apps/api-gateway/src/calendar/recorded-days.service.ts`, in the `pos_checks` read. It was resolved by later-truth:
   - #609's `readWholeWindow` call, its `WholeReadError` catch and both refusal sentences are kept whole.
   - This lane's one change is re-applied on top: the select names `subtotal` in place of `total`, as `"id, opened_at, closed_at, subtotal, covers", { count: "exact" }`.
   - The comment gains one clause: a part-read day's net sales would be a part sum labelled complete.
   - README index rows merged with no conflict.
2. `e17afa4de` fix(calendar): no evidence pair is written while the sales register refuses, and the net read is pinned as whole.
   - `fullWindow` calls `keepPairs` only when `ledger.refusal === null`; otherwise `pairsWritten` is 0. A refused ledger sends no days. Before this change, each pairable day was frozen as checkCount 0 / netSales null, and since `keepPairs` never rewrites a day, it stayed that way.
   - The spec's fake supabase chain is now shaped like PostgREST: a 1,000-row cap, an exact count past the id cursor, order/limit, and column projection.
   - New tests: 2,121 checks are summed whole; a part read is refused; that refusal reaches DayRecordService with no recorded day and no pair; plus a control case.
3. `6e545a59d` fix(calendar): `TakingsMark` takes `refused` (DayLedger passes `!!recordedRefusal`) and draws nothing under it. A new web test covers the month panel and the Day view, and checks that the refusal sentence is shown.
4. `add034c46` test(claims): verify item 1 now accepts the counted select (the `select("id")` probe is skipped).
   - New item (9) checks that the read projects id, asks `count: "exact"`, and is `readWholeWindow`'s build().
   - New item (10) checks that `keepPairs` is called once, guarded by `ledger.refusal === null`.
   - New item (11) checks the web `refused` guard and its prop.
   - The prose now says F1 is built as (b), and the 1,000-row read is dropped from "not checked". Both changes are dated brackets.
5. `009f6527b` docs(calendar), on ADR 0287:
   - Status, Founder answers, Decision 6 and §Forks F1 are bracketed: **F1 is built as (b), not locked; his confirmation is owed.** F1 is reopened with options and a recommendation.
   - Decision 7's row-cap limit, its §Consequences bullet and the merge order are bracketed as closed.
   - New Decision 8: under a refusal, no takings and no pair.
   - New F3 (open).
   - Review-trail row.
   - The same F1 bracket is added to the README row, ADR 0111 §2b and calendar.md, and to the code comments that quoted him beside "owners and managers".

### Results at `009f6527b`

- **Gateway** `npx jest src/calendar src/common/read-whole-window.spec.ts --runInBand --forceExit`: **16/16 suites, 367/367.**
  - `src/calendar` alone: 15/15, 323/323.
  - `day-record.spec.ts`: 54 (was 50).
  - `read-whole-window.spec.ts`: 44/44.
  - At the bare merge `aea170f7c`, before the spec fix, the run was 1 failed / 362: the old fake chain had no `.order`.
- **Web** `npx vitest run src/pages/calendar`: **4/4 files, 124/124.** `CalendarNext.test.tsx` has 75 tests (was 74), and its takings block now has 12.
- **Mutations.** Each used a `cp -p` snapshot, a mutation, a run, a restore, and a `cmp` that came back identical.
  - Gateway:
    - `keepPairs` called during a refusal: 1 fails.
    - The select names `total`: 2 fail.
    - `count` dropped: 1 fails.
    - One capped read in place of `readWholeWindow`: 3 fail.
  - Web:
    - `if (refused) return null` removed: 1 fails.
    - The `refused` prop dropped from DayLedger: 1 fails.
  - Claim verify: 12 new mutants each exit 1. They are:
    - the select naming `total`;
    - the select adding `total`;
    - `id` dropped;
    - `count` dropped;
    - `count` set to `planned`;
    - `readWholeWindow` renamed;
    - `keepPairs` unguarded;
    - `keepPairs`' guard inverted;
    - a second `keepPairs` call;
    - the web guard removed;
    - the prop dropped;
    - the prop set to `false`.
  - Main's copy of each of the 5 verified files also exits 1. The old verify fails at the merge, as the body predicted, and the new one passes.
- `cd ~/Projects && bash …/lanecheck.sh wt-fix-caltakings`:
  - `check_migration_order`, `check_migration_versions_unique`, `check_od_ids_exist`, `check_no_conflict_markers`, `check_citation_pairing` and `check_adr_numbers_unique` all return rc=0.
  - files=14, ownership `[]`, rc=0.
- `check_decision_claims.sh`, run alone: **922 checked, 922 holding, PASS.**
- All 44 `scripts/check_*.py` named in `ci.yml` exit 0. So do the 3 shell guards: `check_model_calls_logged.sh`, `check_no_direct_stock_writes.sh` and `check_no_direct_type_attributes_access.sh`.
- **Typecheck.** Gateway `tsc -p tsconfig.spec.json` gives 2 errors and web `tsc` gives 1, the same 3 as before: all TS2307 `@simplewebauthn/*` in untouched passkeys files.
- **Lint.**
  - Gateway eslint on the 4 calendar files: 0 errors and 15 warnings, the same count as the live body. One new prettier warning in the new spec block was fixed in `009f6527b`.
  - Web `eslint --quiet --resolve-plugins-relative-to p4-scratch/web-lint` on SkyMark, MonthLedger and CalendarNext.test exits 0.

### Forks (open, not asked; recorded in ADR 0287 §Forks)

- **F1, confirmation.** His answer was free text, and the ADR "read" it as (b). No pick of (b) exists in `briefs/caltakings.md` or in the ADR, so Status now says "built as (b)". The options:
  - (b) confirm as built;
  - (d) a per-person grant: `user_restaurant_access_role_known` allows only owner/manager/staff, so this would be a new permission and belongs to OD-180 fork 3;
  - (a) everyone;
  - (c) a line with no figure.
  - **Recommended: (b).**
- **F3.** Under a sales-register refusal, what does the opened day show?
  - (a) No takings mark. This is built, and the page's own line gives the refusal.
  - (b) An em dash and "net sales could not be read" in the panel.
  - **Recommended: (b),** following his ADR 0292 fork 3 and #619 rulings. Not built.

### Not covered (say so in the body)

- **Pre-existing on main, covers half, not fixed here.** Under a refusal, `recorded-days` returns `posConnected: false`. So the opened day's own line (`reconciliationLine`) reads "No sales register is connected, so this day has no record.", and `DayRecordMark` reads "covers not recorded", even though the register exists and could not be read. The page's head line does give the refusal. This belongs to ADR 0111 / ADR 0292 and needs its own follow-up.
- **A day paired before its late checks land still freezes a partial figure.** `keepPairs` writes once, after UTC midnight. This is a pre-existing exposure for covers and is not row truncation. It is not addressed.
- **A ruled-out day that still has checks shows a net figure beside "closed · ruled out"** (audit note 5). Not addressed, and no test pins it.
- **Local Postgres was not re-run.** This lane adds no SQL. The saved run is still the vacuous one at template `fb862aa57`.
- **`check_gateway_boots.sh` was not run**, because `@simplewebauthn/*` is absent from the shared node_modules.
- **No Browser-pane check** of `TakingsMark` (jsdom only).
- **Production was not read.**
- **The audit is owed at the new head.**

### Live body (`gh pr view 610 --json body`): stale lines and replacements

- **L1** (coordinator re-head note at `31c5ec562`).
  - Replace it with this note's header: "Re-headed at `009f6527b` after the BLOCK at `31c5ec562`: merged origin/main `ca3582988` (#609, #649), made the three post-#609 changes, plus Decision 8 and the F1 status fix. One conflict, resolved by keeping #609's read and naming `subtotal` in it."
- **L15**: "Paging is untouched; that belongs to lane cap."
  - Replace with: "The read is #609's `readWholeWindow` (ADR 0292). This PR changes only its select, to `"id, opened_at, closed_at, subtotal, covers", { count: "exact" }`, so a month is summed from every check or refused."
- **L20**: "The evidence pair is still written in full, whoever opened the page."
  - Replace with: "The evidence pair is still written in full, whoever opened the page, unless the sales register refused. Then no pair is written for the window (ADR 0287 Decision 8), so nothing freezes "0 checks"."
- **L29**: "It draws nothing on a day with no checks, nothing for a payload from before this change, and nothing when `takingsWithheld` is set."
  - Append: "…, and nothing when the window carries `recordedRefusal`."
- **L30**: "`MonthLedger.tsx`: `TakingsMark` sits beside `DayRecordMark` in `DayLedger`."
  - Append: "It passes `refused={!!recordedRefusal}`."
- **L34** heading "Founder answers (verbatim, built)" and **L38** F1 bullet "Built as option (b): …"
  - Keep the quote, and append: "**That reading is this lane's; no pick of (b) exists. ADR 0287 now says F1 is built as (b), his confirmation owed (§Forks F1, recommended (b)).**"
- **L40** "run at HEAD `3d0083990`, origin/main `e2cbe426a`".
  - Replace with: "run at HEAD `009f6527b`, origin/main `ca3582988`".
- **L42**: "15/15 suites, 319/319 tests. `day-record.spec.ts` has 50 tests".
  - Replace with: "15/15 suites, 323/323 (plus `read-whole-window.spec.ts` 44/44). `day-record.spec.ts` has 54 tests".
  - Add to the list: "a PostgREST-shaped paged double: 2,121 checks summed whole, a part read refused, and the refusal reaching the day record with no takings and no pair".
- **L52**: "4/4 files, 123/123 tests. `CalendarNext.test.tsx` has 74 tests … has 11 tests".
  - Replace with: "4/4 files, 124/124. `CalendarNext.test.tsx` has 75 … has 12".
  - Add: "no takings under a sales-register refusal, and the refusal sentence shown".
- **L58-63** mutations: append the gateway, web and claim mutants listed above.
- **L64** typecheck: unchanged and still true.
- **L65** lint: still 15 gateway warnings. Web: "exit 0 with `--resolve-plugins-relative-to p4-scratch/web-lint`".
- **L69**: "843 checked, 843 holding".
  - Replace with: "922 checked, 922 holding".
- **L70**: "`check_adr_numbers_unique.py`: … 1,675 refs".
  - Replace with: "`check_adr_numbers_unique` rc=0 (lanecheck at `009f6527b`)".
- **L72-82** pgtest block.
  - Add: "Not re-run at this head; the lane still adds no SQL."
- **L86**: "Locked on the founder's three answers above."
  - Replace with: "Locked on AW22 and AW17. F1 is built as (b), his confirmation owed. Decision 8 (a refused register) and F3 added 2026-10-07."
- **L90**: "Its static verify checks 8 conditions. The verifier ran 19 mutants against it; each exits 1."
  - Replace with: "Its static verify checks 11 conditions, (9)-(11) added 2026-10-07: the whole read, the pair guard, the refusal guard. 19 earlier mutants plus 12 new ones each exit 1."
- **L92-96** Forks deferred: add "**F1 confirmation**" and "**F3**" as above.
- **L98-105** Merge order, "Lane cap … merges FIRST … it needs three changes … Until cap lands, a Tuzlu month window … sums at most 1,000 rows."
  - Replace with: "**Done.** #609 merged first (`b270a45b8`), and this branch merged origin/main `ca3582988` at `aea170f7c`, not rebased. The three changes are made: the counted select names `subtotal` (`aea170f7c`), the claim regex takes the options argument (`add034c46`), and the spec double answers the paged, counted read (`e17afa4de`). A refused month draws no takings and writes no pair."
- **L108**: "ADR 0090's audit is owed before merge." Still true: the re-audit is at `009f6527b`.
- **L110-125** Not covered:
  - Keep L112-118, L120, L122-125. L125 (the coordinator's `db95e8a64` merge) is history and still true. This fixer's merge is `aea170f7c`, and it had one conflict (see L1).
  - L119 (pgtest): add "not re-run at `009f6527b`".
  - **L121**: "ADR 0287's lock covers the founder's three answers. Decisions 3-5 … are this lane's method choices".
    - Replace with: "ADR 0287's lock covers AW22 and AW17. F1 is built as (b) on this lane's reading of his words, and his confirmation is owed. Decisions 3-5 and 8 (a refused register writes no pair and draws no takings) are this lane's method choices, as its Status line says."
  - Add the three pre-existing items above: the refused day's own line saying "No sales register is connected"; a day paired before late checks land; a ruled-out day with checks drawing a net figure.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
