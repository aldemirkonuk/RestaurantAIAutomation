> **[2026-10-07 21:05Z, fixer, local head 6d0b4f194]**
>
> This re-heads #615 after the BLOCK at `6f2f063ef` (report `audits/615-6f2f063ef/report.md`, verdict OVERTURNED) and the HOLD at `ebfccc6e1`. The HOLD came from #621 breaking tests and a claim, and #649 fixed that. **Nothing is pushed.** The live body and base are unedited; the body was read with `gh pr view 615 --json body --jq .body` at 20:31Z, is still the 156-line `6f2f063ef` body, and the line numbers below come from that read. **This head is 16 files against origin/main `ca3582988`, one over the lane cap.** See the fork at the end before pushing.
>
> **Commits since the live head `6f2f063ef`**, first-parent:
> - `117b085c4`: merges origin/main `1c0e8a696` (#644).
> - `6ebceeace` fix(analytics): says net sales in AW17's words ("before tax and surcharge", with no "after discounts") in `NET_SALES_BASIS`, the goals comment and refusal, and the web's till, table and server registers. It also keeps tips per seat whole: `tallySale` counts every tip before it returns on a null net. 10 code and spec files.
> - `1cd0d5880` docs(adr-0295): records F3 verbatim, corrects rule 1 in place, and adds the open claim `ADR-0295-SIMPOS-SUBTOTAL-AFTER-DISCOUNTS`. It touches the ADR, the README row and the `claims.d` fragment.
> - `ebee52ca6`: merges origin/main `54f833e4b` (#627).
> - `ebfccc6e1` docs(adr-0295): names what PR-1 leaves that the PR-2 plan does not yet cover. ADR only. The HOLD was placed at this head.
> - `1a4ea78db`: merges origin/main `ca3582988`, which brings in #621, #622, #620, #651, #609 and #649. It used `merge_main.sh` and was a merge, not a rebase. Four files reported `CONFLICT (manual)`, and each was resolved by later truth:
>   - `goals.service.ts`: kept main's (#609) `readWholeWindow` block with its `WholeReadError` rethrow inside the catch. Its two selects became `"id, subtotal, opened_at, closed_at, items"` and `"id, subtotal, opened_at, closed_at"` (`:939`, `:944`). Kept this branch's net `pos_revenue` and `avg_check` fold, with the `avg_check` refusal thrown after the catch.
>   - `table-analytics.service.ts`: `loadChecks` keeps #609's `readWholeWindow` with this branch's select, `"id, table_id, server_name, server_external_id, opened_at, closed_at, covers, subtotal, tip, items"` (`:228`).
>     - `getTablePerformance` keeps #621's shown and hidden tables and `checksWithoutTable`, and tallies through this branch's `SalesTally` and `tallySale`.
>     - `getHotTables` keeps #621's hidden-table skip and paces on `netSalesOf`.
>     - The `SalesTally` helpers sit before main's `recorded()`.
>   - `report-export-cuttings.ts`: the seats basis keeps #621's sentence *"Checks the till attributed to a shown table over the last N days; voided checks left out."*, then `NET_SALES_BASIS` when `w.net`.
>   - `rp-registers-house.tsx`: `SeatsRegister` keeps both #621's counts and this branch's `net` gate. Its basis takes the same sentence plus `NET_BASIS`, `Taken` becomes `Taken (net)` on net, and the notes are #621's room notes plus this branch's partial note.
> - `40860c7f9` test(read-whole-window): makes #609's reader spec hold on the net basis too. Its fixtures now state `subtotal` (`:237`, `:558`). Its two goals-select assertions accept `total` or `subtotal`, so the spec passes on origin/main and on this head. **This is the 16th file** (see the fork below).
> - `6d0b4f194` docs(adr-0295): dated 2026-10-07 brackets, with the old words kept, and one review-trail row (`:103`). They cover:
>   - Links: 0290 and 0292 have merged, 0287 has not.
>   - Rule 2: 0290 records the supersession itself (`0290:26`, `:35`).
>   - Limits: the file count is now 16, so the controller fix would be the 17th. The 500 citations are re-cited at this head (`analytics.controller.ts:811-823`, `:904-917`, `:911-914`; `goals.service.ts:850-861`, `:395-403`).
>   - Scope: ADR 0290's dashboard convergence is owed and not done here (see below).
>   - Consequences: the merge order is done. g7 pins the `loadChecks` select, and g1 pins the goals non-items select.
>
> **Owed from #649's audit: the `loadChecks` projection assertion.** It already exists in this branch. `table-analytics.service.spec.ts` g7 (`:197`) asserts that the `loadChecks` select names `subtotal` and not `total`. Mutations M1 and M2 below kill it, so no new test was needed.
>
> **Results at `6d0b4f194`** (all run after this head was committed, 20:31Z to 21:05Z):
> - `lanecheck.sh wt-fix-netsales` exits 0. All six guards exit 0: migration order, versions unique, OD ids, conflict markers, citation pairing and ADR numbers unique. **files=16** against `ca3582988`. Ownership `[]`.
> - `check_decision_claims.sh` run alone under Python 3.11: **926 / 926 holding**. Under the system's Python 3.9.6, `ADR-0224-EVERY-HOST-NAMED-OR-EXCUSED` fails (925/926). That is the interpreter, not this branch.
> - Lane claims run alone:
>   - The four resolved `ADR-0295-*` rows exit 0. The open `ADR-0295-SIMPOS-SUBTOTAL-AFTER-DISCOUNTS` exits 1, as an open row must.
>   - All seven `ADR-0303-*` rows exit 0, including the one that accepts the net push.
>   - `ADR-0290-AW21-NET-SALES-ON-THE-MONTH` exits 0.
> - Gateway jest, lane specs: `pos-revenue`, `table-analytics.service`, `report-export-cuttings`, `scenario-verify.service`, #609's `read-whole-window.spec.ts` and #621's `tables-learned-from-the-pos.spec.ts`. **6 suites, 152 / 152.**
> - Gateway jest, wide: `src/analytics`, `reports`, `simpos`, `common`, `dashboard`, `notifications`, `calendar`, `team` and `pos-hub`. **180 suites, 3235 / 3235.**
> - Web vitest: `ReportsNext.test.tsx` **81 / 81**. `src/pages/reports` + `src/pages/recommendations` **22 files, 464 / 464**.
> - `tsc --noEmit`: the gateway shows only its 2 `@simplewebauthn/server` worktree errors, and the web only `services/api/passkeys.ts` (`@simplewebauthn/browser`).
> - ESLint:
>   - Gateway, on the four merge-touched files: 0 errors. The prettier warnings match origin/main per file (4/4, 0/0, 59/59, 0/0).
>   - Web `--quiet --resolve-plugins-relative-to p4-scratch/web-lint` on `rp-registers-house.tsx` and `rp-registers-trade.tsx`: exit 0.
> - Mutations. Each run took a `cp -p` snapshot, mutated, ran the spec, restored and checked `cmp` OK, and the tree is clean after. Every mutation was killed:
>   - **M1**: drop `subtotal` from the `loadChecks` select. g7 fails (1/12).
>   - **M2**: `subtotal` → `total` in the `loadChecks` select. g7 fails.
>   - **M3**: drop the rww `checks()` fixture's `subtotal`. *"getPosRevenueWindow(90) counts 3,313 checks…"* fails.
>   - **M4**: drop the rww waiter fixture's `subtotal`. *"reads all 3,341 checks and puts Maya last"* fails.
>   - **M5**: the goals non-items select `subtotal` → `total`. g1 fails.
> - The stale-basis grep (`after discount` / `before tax and tips`) over the 16 files finds only struck ADR text, the dated brackets, the open claim and three comments that deny the claim (`goals.service.ts:962`, `net-sales.ts:11`, `rp-registers-house.tsx:308`, `rp-registers-trade.tsx:111`).
>
> **The BLOCK at `6f2f063ef`: where each required item is closed at this head**
> 1. **The basis sentence is narrowed to the founder's words.**
>    - `NET_SALES_BASIS` at `net-sales.ts:97`, with the prose at `:93`.
>    - The web copies at `rp-registers-house.tsx:313` and `rp-registers-trade.tsx:231`, with the answers line at `:160`.
>    - The goals comment and refusal at `goals.service.ts:960-966` and `:991`.
>    - ADR rules 1 (`:40`) and 5 (`:44`), as dated corrections.
>    - Specs pin that no basis line says "discount".
> 2. **ADR rule 1 no longer contradicts Limits.** See the bracket at `:40`.
> 3. **An open claims row pins the SimPOS gap.** `ADR-0295-SIMPOS-SUBTOTAL-AFTER-DISCOUNTS` exits 1.
> 4. **`tipPerSeat` is fixed.** `tallySale` counts every tip before it returns on a null net (`table-analytics.service.ts:798-799`), and g8c (`:265`) pins it. **The 500 on `getGoalProgress` is disclosed, not fixed**: ADR Limits `:69-73`, re-cited at this head.
> 5. **F3 is the founder's ruling.** He picked *"Ship now, PR-3 next (Recommended)"* on 2026-10-06 ~01:49Z. ADR `:20-24` quotes the question, the pick and the rejected options. Limits `:68` and the review trail `:100` cite it too.
>
> **Stale lines in the live body, each with its replacement**
> - **:1** *"[2026-10-06 ~00:33Z, coordinator] Re-headed at `6f2f063ef`. … the merge turn re-heads and re-audits."* Keep it as dated history under a new top line: *"**[2026-10-07, fixer] Re-headed at `6d0b4f194`.** It merges origin/main `ca3582988` (#621, #622, #620, #651, #609, #649) at `1a4ea78db`; four files conflicted and were resolved by later truth (see the merge commit). It closes the five items required by the BLOCK at `6f2f063ef`. The PR is 16 files against main. Lines below that name `6f2f063ef` or older heads describe this PR before that merge."*
> - **:5** *"…writes it at ingest (`pos-hub.service.ts:516`)…"*. Replace the cite with `pos-hub.service.ts:969`.
> - **:19** *"`NET_SALES_BASIS` is the basis sentence in the owner's words."* Append: *"It reads 'Net sales: what the checks came to before tax and surcharge. Voided checks are left out.' (AW17's words). It makes no claim about discounts."*
> - **:26** *"…`createGoal` turns the refusal into a 400. The goal list marks that goal unreadable, and both goal producers already catch the throw."* Append: *"The one-goal route `GET /analytics/goals/:rid/:goalId/progress` answers it with a 500 (`analytics.controller.ts:904-917`, which maps every throw to `INTERNAL_SERVER_ERROR` at `:911-914`). This is disclosed in ADR 0295 Limits and left to a follow-up."*
> - **:28** *"`loadChecks` selects `subtotal` in place of `total`."* Replace with: *"`loadChecks` reads the window whole through #609's `readWholeWindow`, selecting `subtotal` in place of `total` (`:228`). g7 pins the projection."*
> - **:30** *"The tip rate is tips over the net of the checks that recorded a tip (A-047)…"*. Add a bullet after it: *"Tips per seat count every tip, including tips on checks with no subtotal (`tallySale`, `table-analytics.service.ts:798-799`; g8c). Only the tip rate needs net."*
> - **:38** *"The till's answers line now reads 'What the house sold, day by day, before tax and tips'."* Replace *"before tax and tips"* with *"before tax and surcharge"*.
> - **:55** *"F3 (whether the adapters' subtotals can be trusted) was an orchestrator fork, not a founder pick. It goes ahead as PR-3…"* Replace with: *"**F3**, AskUserQuestion 2026-10-06 ~01:49Z: *"Ship now, PR-3 next (Recommended)"*. The option read: *"The #615 rework narrows the page sentence to your words ('before tax and surcharge', no 'after discounts' claim) and adds a check that keeps failing until PR-3 fixes SimPOS. Until then, discounted SimPOS checks read high, on sim houses only. Net sales reaches Tuzlu soonest."* Rejected: "PR-3 first" and "Basis per till". PR-3 is `fix/pos-subtotal-means-net`."*
> - **:59** *"…It supersedes ADR 0290 rule 2 (that ADR's branch, line 32) and adopts ADR 0287 rule 3 house-wide…"* Replace *"(that ADR's branch, line 32)"* with *"(0290 is on main via #622 and records the supersession itself, `0290:26`, `:35`)"*. Keep *"adopts ADR 0287 rule 3"*, because 0287 has not merged.
> - **:61-66** *"`claims.d/fix-owner-sales-read-net.jsonl` (new, 4 claims): … Re-run at this head."* Replace with: *"`claims.d/fix-owner-sales-read-net.jsonl` (new, 5 claims). Four are resolved: the till and the goal metric read the subtotal; the server table and the tip rate read net; /reports labels say net in the owner's words; the verifier's yardstick is net. The fifth, `ADR-0295-SIMPOS-SUBTOTAL-AFTER-DISCOUNTS`, is open and exits 1 until PR-3 fixes SimPOS's subtotal. At `6d0b4f194` all 926 claims hold (Python 3.11)."*
> - **:67** *"Last-call correction, commit 1602a7fbe… (`analytics.controller.ts:557`) … (:614) … (:632) … (:659)…"* Keep it as history and re-cite to this head: `tables` `:557`, `table-performance` `:636`, `waiters` `:654`, `hot-tables` `:681`.
> - **:71-99** (*"Code head is 4950e5696…"* through *"…Local Postgres harness… not run."*). Keep them as history under a new first line: *"**Re-run at `6d0b4f194` (fixer, 2026-10-07):** lane gateway specs plus `read-whole-window.spec.ts` and `tables-learned-from-the-pos.spec.ts` 6 suites 152/152; gateway jest over analytics, reports, simpos, common, dashboard, notifications, calendar, team and pos-hub 180 suites 3235/3235; web `ReportsNext.test.tsx` 81/81, reports + recommendations 22 files 464/464; claims 926/926; lanecheck guards 0, ownership `[]`, 16 files; tsc only the known `@simplewebauthn` errors; gateway eslint 0 errors (warnings equal to main), web eslint `--quiet` clean; mutations M1–M5 all killed. Local Postgres not run (no SQL)."* Also mark *"Re-run at last call (1602a7fbe)"* and *"Verifier, at 4950e5696"* as earlier heads.
> - **:103-106** (*"#609 cap … conflicts with this branch … Whichever lands second resolves the conflict…"*). Replace with: *"#609 merged first (`b270a45b8`), and this branch merged it at `1a4ea78db` as the ADR planned. The selects are as planned (`goals.service.ts:939`, `:944`; `table-analytics.service.ts:228`), and the `WholeReadError` rethrow stays inside the catch, with the `avg_check` refusal after it. #609's `read-whole-window.spec.ts` now states `subtotal` (`40860c7f9`)."*
> - **:107-110** (#602, #604, #607/#608, #603/#605/#606/#610/#611). Replace with: *"All of #602, #604, #607, #609, #620, #621, #622, #627, #644, #649 and #651 are on main and merged into this branch. #621's table and seat changes were merged by later truth in four files (see `1a4ea78db`)."*
> - **:114** *"None of these is open at founder level: all were answered."* Keep it. It is true now that F3 is his ruling.
> - **:117** *"F3 is PR-3, after this ADR merges."* Replace with: *"F3: the founder ruled 'Ship now, PR-3 next (Recommended)'. PR-3 follows this PR, and the open claim keeps the build red on the SimPOS gap until it lands."*
> - **:121** *"Under the 15-file cap…"*. Replace with: *"Under the 15-file cap (this PR is at 16 since #609's spec had to state `subtotal`; see the coordinator note)…"*.
> - **:122** *"…(`insight-generator.service.ts`, the `pos_checks` select at :657, then `c.total` at :1114, :1185-1211 and :1471-1494)."* Re-cite: the path is `analytics/insights/insight-generator.service.ts`. The select is `:687`, inside #609's `readWholeWindow` at `:683`. `c.total` is at `:1148`, `:1219-1245` and `:1505-1528`.
> - **:123** *"(`sale-record.producer.ts:233`, `:265`)… `revenueBasis` metadata at `:189`…"*. These are unchanged at this head. No edit.
> - **:126** *"…(`num(row?.revenue) ?? 0`)…"*. Add the cite `useRecommendationsNextData.ts:910`.
> - **:127, :129-131**: `rec-forward.ts:72`, `analytics.controller.ts:1040`, `report-cuttings.ts:79`, `goal-scenarios.ts:204` and `reports.md:123`. Re-cite the controller to `:1062` (the Swagger sentence; the route is `:1058`). The rest are unchanged. In `:130`, replace *"the web register now says 'before tax and tips'"* with *"the web register now says 'before tax and surcharge'"*.
> - **:132** *"The basis sentence exists twice, in `net-sales.ts` and in the web registers, with no test pinning them equal."* Still true. No edit.
> - **:134** *"/calendar and /dashboard do not use `foldNetSales` yet. That waits on ADRs 0287 (#610) and 0290 merging, in a convergence follow-up."* Replace with: *"/dashboard: ADR 0290 (#622, merged) says whichever of #615 and #622 lands second deletes the dashboard's copies of `netSalesOf` and `foldNetSales` (0290 `:35`, `:93`). #622 landed first, so the duty is this PR's. It is **not done here** because of the file cap. The copies match the fold (`dashboard.service.ts:127-136`, `:150-168` against `net-sales.ts:51-60`, `:63-81`), and their comments at `dashboard.service.ts:124`, `:147` and `0290:7` go stale once this merges (ADR 0295 Scope, 2026-10-07 bracket). /calendar waits on ADR 0287 (#610)."*
> - **:142** *"SimPOS (`simpos.service.ts:663-682`) sends its subtotal before discounts … That is a regression against the old gross figure on those houses, until PR-3."* Append: *"The founder accepted this under F3 ('Ship now, PR-3 next'); the page sentence no longer claims 'after discounts', and the open claim pins the gap."*
> - **:143** *"The row cap is separate. Until #609 (cap) merges, the 90-day table and server registers … read at most 1,000 checks (A-005, A-006)."* Replace with: *"The row cap: #609 has merged, and these readers read the window whole or refuse (`readWholeWindow`)."*
> - **:150** *"Typecheck, lint and the wider suites were not re-run at the last-call head…"* Replace with: *"Typecheck, lint and the wider suites were re-run at `6d0b4f194` (see Tests)."*
> - **:152** *"The coordinator merged origin/main `1aa4dcb8c` (#602, #604) in at `f315abb07`…"* Keep it as history.
> - **Add to Not covered:** *"Not run at `6d0b4f194`: a Browser-pane render, `check_gateway_boots.sh`, the `scripts` pytest suite, `pgtest` (no SQL), and any production read."*
>
> **Not done or unverified**
> - **The 15-file cap is breached: 16 files.**
> - ADR 0290's dashboard-copy deletion is owed and not done.
> - The 500 on `getGoalProgress` is disclosed, not fixed.
> - Not run: a Browser-pane render, `check_gateway_boots.sh`, the `scripts` pytest suite, `pgtest` (no SQL), and any production read.
> - `apps/mobile/src/api/queries.ts:353` (ADR `:71`) was not re-cited.
> - Body re-cites not listed above were not checked.
>
> **Forks.** These are coordinator forks. No founder fork is open.
> - **(a) Getting back to 15 files.**
>   - *Recommended:* land `audits/netsales-precursor-rww-spec.patch` (a format-patch of `40860c7f9`) as its own small PR ahead of #615, as #649 did for #621. It passes on origin/main, and once it merges #615 drops to 15. It costs one more small audit and a re-head of #615 after it lands.
>   - Accept 16 files, with the breach stated in the body.
>   - Rejected: moving or dropping the spec change. #609's spec would then fail on this branch.
> - **(b) ADR 0290's dashboard-copy deletion.** Do it in #615, which makes 17 files (or 16 with (a)), or in a follow-up. It is recorded as owed in ADR 0295 Scope. *Recommended:* a follow-up, because it touches `dashboard.service.ts` and its spec, which this PR's audit has not seen.

---
