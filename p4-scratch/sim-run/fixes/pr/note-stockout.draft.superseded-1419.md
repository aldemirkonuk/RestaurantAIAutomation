> **[2026-10-07 20:15Z, fixer, local head `38d558d00`]** LOCAL ONLY; nothing has been pushed. The remote PR head is still `d96dcbf56`. This head is not audited. It is a **behaviour change** (`7de7a92a8`), so it needs a fresh full audit.

**Commits since the pushed head `d96dcbf56`** (the six up to `a96e181fe` are described in the 14:19Z note below and are unchanged)
- `a1736c6e1` merge of `origin/main` `b270a45b8` (#609); `69533313f` `readLotRollup` (behaviour); `86682af07`, `8b5a00491`, `4d0f78252`, `a96e181fe` (docs and claims).
- `8ceab509d`: merges `origin/main` `ca3582988` (#649: a tables spec fixture and one claims row) via `merge_main.sh`. **No conflicts.**
- `7de7a92a8`: **behaviour change**, the founder's 14:41:21Z answer (below).
  - `readLotRollup` throws a `WholeReadError` on every failure, as `readWholeWindow` does: `read_failed` for a database error, `malformed_page` for no rows and no error, `row_ceiling` for a prefix. It returns the rows, not `{ data, error }`.
  - `AnalyticsService.loadInventory` and `AdvancedAnalyticsService.loadInventoryWithCost` rethrow it (`if (rollupRes.status === "rejected") throw rollupRes.reason;`) instead of falling back to `stock_live` with no open ml. Neither logs it and carries on any more.
  - Every call of those two loaders sits in a `Promise.all` beside `loadConsumption`. So the lenses that refuse are exactly those that refuse on a refused pour read (ADR 0292 fork 3): `getFinancialSummary`, `getInventoryScience` (the register), `getRiskProfile`, `getMenuEngineering` and `getWine360`.
  - Unchanged: a wine the rollup reads whole but has no row for still reads `stock_live` (no lot, so no open bottle). The stockout #1 insight (`readOpenMl`) still catches the refusal and is silent.
  - Spec: a new describe of 13 cases (five lenses × two failure modes, the inventory-science route's 500 with the sentence, Wine-360's route 503, the overview's four lenses `null`, and a control). The two earlier cases that expected the fallback now expect the refusal.
  - New claim `STOCKOUT-UNREAD-ROLLUP-REFUSES`. `STOCKOUT-ROLLUP-READ-WHOLE-OR-REFUSED`'s sentence about the fallback is bracketed.
- `0ddc20fa7`: ADR 0299 and its README row.
  - Consequences, "When the rollup read fails": the answer is quoted verbatim, the fork is marked answered, and what was built, given up, unchanged and owed is named. The superseded sentences are bracketed, not removed.
  - Verifier item 1: the Status and the README row are narrowed from "the bottle-size rule (rule 1) is the founder's" to "the stand-in size for a row that states none", with the old words bracketed. The earlier review-trail row is bracketed the same way.
  - Verifier item 2: the bracket that dated the `readLotRollup` change to `8b5a00491` now says the change is `69533313f`.
  - The server-cut cite `:774` is re-pointed to `:798`. There is a new review-trail row.
- `e36860e27`: tech-debt note. The "failed rollup read" entry is ANSWERED and FIXED for the register and Wine-360. The insight's silence is OWED with ADR 0292's follow-up. Three other readers of the view are recorded, not changed (see Not done). The cites moved by `7de7a92a8` are re-pointed.
- `38d558d00`: prettier formatting of three lines `7de7a92a8` added to the spec.

**The founder's answer** (AskUserQuestion, answered 2026-10-07T14:41:21Z, from `fixes/briefs/answers-2026-10-07-pm.md`). Asked: *"#619: when the stock rollup can't be read whole, the register and Wine 360 quietly fall back to the shelf count without the open bottle. What should they do?"*
- Picked *"Say it couldn't be read (Recommended)"*: *"The same as your rulings for pours and insights: that figure shows 'could not be read', not a quieter number. A small code change inside #619, which is being re-audited anyway."*
- Rejected *"Fall back quietly, as built"*: *"Show the shelf count without the open bottle and say nothing. The number is a little low on a bad read, and nobody can tell."*
- Rejected *"Fall back and say so"*: *"Show the shelf count without the open bottle, labelled 'open bottle not counted: stock could not be read'. More code and copy than the refusal."*

**Results at `38d558d00`** (unless a run names another head)
- **Merge:** `merge_main.sh` → `MERGED 8ceab509d`, with no conflicts.
- **Guards** (`lanecheck.sh wt-fix-stockout`): the six fast guards all rc=0; files=15 against `origin/main` `ca3582988`; ownership `[]`.
- **Claims** (run alone, `PATH=/usr/local/bin:$PATH bash scripts/check_decision_claims.sh`, Python 3.11.0): **928 checked, 928 holding**, PASS.
- **Gateway jest:**
  - `stockout-counts-open-ml.spec.ts`: 31/31.
  - `src/analytics src/common src/reports`: 107 suites, **1757/1757**.
  - The whole gateway (run at `7de7a92a8`'s sources before commit): 620 suites pass. 9 suites fail to load because `@simplewebauthn/server` is missing from the shared `node_modules` (passkeys, auth, health). `scan-parser.arrival` failed once under load and passes alone. None of those 10 is in this lane.
- **Fails before:** with the three source files restored to `8ceab509d`, 14 cases fail: 12 of the new describe's 13 (the 13th is a control) and both rewritten cases. The 17 others pass, including the insight's silence, which is unchanged. The files were restored from `cp -p` snapshots and checked with `cmp`.
- **Mutations** (each from a `cp -p` snapshot, then restored and checked with `cmp`):
  - restoring the register's fallback fails 9 cases;
  - restoring Wine-360's fallback fails 7;
  - a `readLotRollup` that swallows a database error fails 8.
- **The new claim fails under each of six code mutations:** no rethrow in `loadInventory`; no rethrow in `loadInventoryWithCost`; a `logQueryFailure("inventory_lot_rollup", …)` re-added; `readLotRollup` returning `{ data, error }`; `getRiskProfile` on `Promise.allSettled`; and the `read_failed` branch removed.
- **Web vitest:** `ReportsNext.test.tsx` 80/80. Not touched this round.
- **Gateway typecheck:** `tsc --noEmit` on both `tsconfig.json` and `tsconfig.spec.json` shows only the 2 known `@simplewebauthn/server` errors.
- **Gateway eslint** on the four files `7de7a92a8` touched: 0 errors. One prettier warning remains, at `analytics.service.ts:545`, on the pre-existing line that was `:521`. It is also on `main`.
- **Local Postgres:** not run this round. There is no SQL in the diff, and the previous round's read-only probe still stands.

**Stale lines in the live body, and their replacements.** This list replaces the 14:19Z note's list. Line numbers are the live body's.
- L13 *"**Head `1f3b821d3`** (local; the remote PR head stays `b93e67183` …) … 15 files against `origin/main` `4528b9689` … Nothing has changed behaviour since `c8c88c049`."* → **Head `38d558d00`** (local; the remote PR head stays `d96dcbf56` until the coordinator pushes). Branch `fix/stockout-counts-open-ml`, 15 files against `origin/main` `ca3582988`, which this branch contains (merged at `8ceab509d`). Behaviour last changed at `7de7a92a8`: an unread lot rollup refuses. Before that it changed at `69533313f`: the rollup reads are whole-or-refused.
- L41 *"The 14-day floor, the bottle-size rule and the unmeasured-row rule are the build's picks … They are not founder answers."* → The 14-day floor and the unmeasured-row rule are the build's picks under the locked ADR 0020; they are not founder answers. Two parts are the founder's. One is the stand-in size for a row that states none: *"Standard 75 cl, as built (Recommended)"*, 2026-10-07T13:51:58Z, ADR 0299 rule 1. The other is what an unread rollup does: *"Say it couldn't be read (Recommended)"*, 2026-10-07T14:41:21Z, ADR 0299 Consequences.
- L44, add a sub-bullet → Claim `STOCKOUT-STAND-IN-IS-THE-POURS` ties this 750 to the writer's `COALESCE(ri.bottle_size_ml, 750)` and to pos-hub's `RPC_DEFAULT_BOTTLE_ML`.
- L54, add a sub-bullet → **The rollup is read whole or not used.** `readLotRollup` reads one page proved whole by an exact count, or throws `WholeReadError` on a database error, an empty answer or a prefix. The register, Wine-360, the financial summary, the risk profile and menu engineering then say they could not be read, by the path a refused pour read takes (ADR 0292 fork 3). They never fall back to the shelf count without the open bottle. This is the founder's pick of 2026-10-07T14:41:21Z.
- L56 *"It reads `open_ml` itself (`readOpenMl`). If that read fails, the insight logs the failure and stays silent …"* → It reads `open_ml` itself (`readOpenMl`, through `readLotRollup`). If that read fails or is refused, the insight logs it and stays silent instead of ranking sealed counts. /recommendations naming that silence as unread is ADR 0292's owed follow-up.
- L80 *"## Review rounds (none changed behaviour)"* → **## Review rounds.** Add three rounds:
  - **Coordinator re-head and fixer, `8b5a00491`**: the #609 merge, `readLotRollup` (behaviour), the Tonight-card OWED row, and the cite re-points.
  - **Bottle-size answer, `a96e181fe`**: docs and claims only.
  - **Rollup answer and verifier items, `38d558d00`**: the #649 merge, the refusal (behaviour, `7de7a92a8`), the Status/README narrowing, the `69533313f` re-date, and the cite re-points.
- L111–122 *"**At HEAD `1f3b821d3`**"* and its table → replace with the results above, run at `38d558d00`.
- L138 *"904 checked, 904 holding"* → **928 checked, 928 holding** (Python 3.11.0).
- L139 *"The 4 new claims rows each fail against a `git archive` of `origin/main` …"* → The claims file holds 7 rows.
  - `STOCKOUT-UNREAD-ROLLUP-REFUSES` was mutated six ways (above).
  - `STOCKOUT-STAND-IN-IS-THE-POURS` was mutated five ways (14:19Z note).
  - `STOCKOUT-ROLLUP-READ-WHOLE-OR-REFUSED` was mutated five ways (`69533313f`).
  - Not re-run against a `git archive` of `origin/main` this round.
- L144 *"**Local Postgres: not run.** …"* → **Local Postgres:** the read-only probe of the 14:19Z round (writer's `COALESCE(ri.bottle_size_ml, 750)`). Not re-run; no SQL is in the diff.
- L152 *"Its rows are STOCKOUT-OPEN-ML-COUNTED, … and STOCKOUT-GENERATOR-VERSION"* → add `STOCKOUT-ROLLUP-READ-WHOLE-OR-REFUSED`, `STOCKOUT-STAND-IN-IS-THE-POURS` and `STOCKOUT-UNREAD-ROLLUP-REFUSES`, all `resolved`.
- L156 *"Five residuals are OPEN."* → Four residuals are OPEN, and "Two rules for an unstated bottle size" among them is half answered. One entry is OWED elsewhere (the form-default 750). The "failed rollup read" entry is ANSWERED and FIXED for the register and Wine-360, and OWED for the insight's silence. The open-ml-reads entry's one-page half is FIXED. The Tonight card and the bottle size are bullets under the FIXED entry: the Tonight card OWED on a follow-up, the bottle size ANSWERED.
- L158–165 *"## Founder answers — Both answers …"* → add three answers:
  - **Bottle size** (2026-10-07T13:51:58Z): *"Standard 75 cl, as built (Recommended)"*. Built as it stands; ADR 0299 rule 1.
  - **Unread rollup** (2026-10-07T14:41:21Z): *"Say it couldn't be read (Recommended)"*. Built in `7de7a92a8`; ADR 0299 Consequences quotes all three options.
  - **Tonight card** (2026-10-06T16:55:23Z): *"Fire on an empty shelf (Recommended)"*. OWED on a follow-up PR; this PR merges with the card's silence as built.
- L169 *"**None taken here.** The two founder answers above are owed on #624."* → **None is taken by default here.** The bottle-size and unread-rollup forks were asked and answered (above). The two earlier answers (the order and fork 3) are still owed on #624, which is open and stacked on this branch.
- L170 *"**Which bottle-size fallback is right** … It was handed there and not asked."* → **Bottle-size fallback:** answered for the stockout count (the row's size, else 750). /inventory's own rule (`inventory.service.ts:80-82`, library before 750) is still OPEN under AW15 / ADR 0115. It was not asked and is not decided here.
- L177–180 *"The versions are: `main` 5, cap (#609) 6, this PR 7 … **Cap (#609) should merge before this PR.** …"* → Cap (#609) merged first, at `b270a45b8`, with 6. This branch merged it and stays at 7. #625 and #626 hold 8 each and must re-check the version at their merge. STOCKOUT-GENERATOR-VERSION holds.
- L185 *"**#609 cap** conflicts only in `insight-generator.service.ts`, in the version header."* → #609 is merged. Its one conflict, in the version header, was resolved at `a1736c6e1`.
- L183–198, the merge-tree dry runs → **not re-run at this head.** They date from `1f3b821d3`. #626 units overlaps `analytics.service.ts`, `advanced-analytics.service.ts` and `insight-generator.service.ts`, which `7de7a92a8` edited again.
- L203 *"**Already merged:** postime (#603), rec (#607), sig (#602) and tables (#621) …"* → also cap (#609), #622, #651, #620 and #649; this branch contains them.
- L210, add → **Owed elsewhere:**
  - the Tonight card (a follow-up PR and an ADR 0299 amendment);
  - the form-default 750 in `AddWineToInventoryModal` (ADR 0115 / AW15 work);
  - /recommendations naming the stockout #1's silence on an unread rollup as unread (ADR 0292's follow-up PR, which should cover `readOpenMl`).
- L226 *"`analytics.service.ts:694` to `:696`"* → `:694` is now `:798` (`reorderList: E.cutKeepingTies(`; `:710` on `main`). ADR 0272's `advanced-analytics.service.ts:575-576` was not re-measured.
- L236 *"**Two bottle-size fallback rules exist** … So a 1 L spirit with a NULL size reads at 750 ml."* → **Two bottle-size fallback rules exist.** The stockout count uses the writer's rule by the founder's pick (2026-10-07T13:51:58Z), so a 1 L spirit with a NULL size reads at 750 ml by his choice. /inventory's `inventory.service.ts:80-82` still puts the library first (OPEN, AW15). A written 750 can be the add-wine form's default.
- L238 *"**A failed rollup read** degrades the register and Wine-360 to sealed counts, but silences the insight."* → **An unread rollup refuses whole lenses.** That means a database error, an empty answer, or a page its count does not prove whole. On it, the financial summary, inventory science, risk profile, menu engineering and Wine-360 say they could not be read, by the founder's pick (2026-10-07T14:41:21Z). They withhold every figure on that read, including ones that do not count the open bottle (inventory value, COGS, cost-based margins, the risk profile's concentration). That is the lens-level refusal ADR 0292 fork 3 kept for pours. The stockout #1 is silent.
- L241 *"They read one unpaged page. … a house with more than `max_rows = 1000` rollup rows would read only part of it."* → They read one page proved whole by an exact count, or refuse. A house past 1,000 rollup rows gets those lenses refused until the view carries a key to page on, which needs a migration. Tuzlu's rollup row count was not measured: 134 is its ranked inventory count, not its rollup count.

**Not done or not verified (CLAUDE.md §0.5)**
- Nothing is pushed, CI has not run on `38d558d00`, and this head is not audited. It changes behaviour, so it needs a fresh full audit.
- **Callers not re-tested for the rollup.** Tested here: the five lenses, the inventory-science and Wine-360 routes, and the overview. Not tested for the rollup: the other callers ADR 0292's readers table lists for a refused pour read. Those are /recommendations' `sourcesUnread`, the `days_of_inventory` goal, the report export, the MCP `financial` tool and the consultants' evidence pack. They take the same `WholeReadError` through the same lens calls, but that was not run here.
- **Three other readers of `inventory_lot_rollup` are recorded, not changed** (tech-debt note). Changing them would need a 16th file, and none is in ADR 0299's scope.
  - `inventory.service.ts` `fetchLotRollup` drops a database error and reads one unranged page. /inventory then shows `openMl` 0. That page is the AW15 / ADR 0115 lane's.
  - `margin-advice.service.ts:182` refuses on an error but reads one unranged page with no count.
  - `price-locks.service.ts:234`.
- **The two DB-needing guards were not run:** `check_house_item_invariants` and `check_migration_ledger`.
- **The page was not rendered in a browser.** The refusal reaches /reports as the generic "The … register could not be read (…)" line ADR 0292 documents. That is not re-shown for the rollup here.

---

> **[2026-10-07 14:19Z, fixer, local head `a96e181fe`]** LOCAL ONLY; nothing has been pushed. The remote PR head is still `d96dcbf56`. The audit at `d96dcbf56` was overturned because `main` moved to `b270a45b8` (#609) while it ran. This head is not audited.

**Commits since the pushed head `d96dcbf56`**
- `a1736c6e1`: merges `origin/main` `b270a45b8` (#609 cap, ADR 0292). One conflict, in the `INSIGHT_GENERATOR_VERSION` history comment, resolved by later-truth: cap's 6 line kept, the "6 — held for lane cap" placeholder dropped, this branch's 7 line kept. The constant is 7.
- `69533313f`: **behaviour change.** The three `inventory_lot_rollup` reads (the register's `loadInventory`, Wine-360's `loadInventoryWithCost`, the insight's `readOpenMl`) now go through `analytics.service.ts` `readLotRollup`. It reads one page with an exact count. If the page is shorter than the count, it throws `WholeReadError` instead of returning a prefix. The register and Wine-360 treat that as a failed read and fall back to `stock_live` with no open ml (Wine-360 now logs it). The insight stays silent. The spec gains four cases, three of which fail on the merge commit. The commit adds claim `STOCKOUT-ROLLUP-READ-WHOLE-OR-REFUSED`.
- `86682af07`: tech-debt note. An OWED row for the Tonight-card ruling (*"Fire on an empty shelf (Recommended)"*, answered 2026-10-06T16:55:23Z). The one-page residual is bracketed as FIXED. The register/Wine-360 refusal fork is recorded as unasked.
- `8b5a00491`: ADR 0299. The cites #609 moved are re-pointed (`:115` → `:117`, `:696` → `:774`), the merge-order state is updated (cap merged first), and a review-trail row is added.
- `4d0f78252`: tech-debt note.
  - ANSWERED bullet for the bottle size.
  - "Two rules for an unstated bottle size" is half answered: the stockout count is answered, and /inventory's rule is still OPEN under AW15.
  - New OWED-elsewhere entry: `AddWineToInventoryModal` writes a form-default 750 onto `restaurant_inventory.bottle_size_ml`, so a written 750 is not proof of a stated size.
  - The rollup fork is restated as OPEN, unasked and not defaulted.
  - The ADR 0292 answer it cites is given its exact time (*"Say it couldn't be read (Recommended)"*, 12:02:43Z).
- `a96e181fe`: ADR 0299.
  - Rule 1's bracket quotes the founder's bottle-size answer verbatim (question, pick, both rejected options; 2026-10-07T13:51:58Z) and closes the fork.
  - Status and the README row are narrowed, with `[Was: ...]` brackets.
  - Option 11 records that the founder rejected it too.
  - Consequences lists the rollup fork as OPEN.
  - Adds a review-trail row.
  - New claim `STOCKOUT-STAND-IN-IS-THE-POURS`.

**The founder's bottle-size answer** (AskUserQuestion, answered 2026-10-07T13:51:58Z). Asked: *"#619: when a stock row doesn't say its bottle size, what size should the stockout count use for the bottle that's already open?"* Picked: *"Standard 75 cl, as built (Recommended)"*. Rejected: *"Shared catalogue next"* and *"Refuse without a size"*. No code changed. The full option texts are in ADR 0299 rule 1.

**Results at `a96e181fe`**
- **Merge:** `merge_main.sh` reported `UP-TO-DATE a96e181fe`, because `origin/main` is still `b270a45b8`. There were no conflicts this round.
- **Guards** (`lanecheck.sh wt-fix-stockout`):
  - `check_migration_order`, `check_migration_versions_unique`, `check_od_ids_exist`, `check_no_conflict_markers`, `check_citation_pairing` and `check_adr_numbers_unique` all return rc=0;
  - files=15 against `origin/main` `b270a45b8`;
  - ownership `[]`.
- **Claims** (`PATH=/usr/local/bin:$PATH bash scripts/check_decision_claims.sh`, Python 3.11.0): **927 checked, 927 holding**, PASS.
- **New claim, mutation-tested.** The verify was run against each mutation below, and all five failed:
  - stockout `bottleSizeMl ?? 750` → 700;
  - writer `COALESCE(ri.bottle_size_ml, 750)` → 700 (newest migration, `:318`);
  - `RPC_DEFAULT_BOTTLE_ML` 750 → 700;
  - the stand-in made non-literal;
  - a newer probe migration that defines the writer at 1000.

  Through the full runner, the first gave 925/927 (this row and STOCKOUT-OPEN-ML-COUNTED failed). The writer and RPC mutations each gave 926/927, failing only the new row. Every changed file was restored with `cp -p` and checked with `cmp`, and the probe migration was deleted.
- **Gateway jest** (`--runInBand --forceExit`):
  - `src/analytics src/reports/exports`: 62 suites, **979/979**;
  - `src/analytics`: 57 suites, 888/888;
  - the three lane specs (`stockout-counts-open-ml`, `restock-cut-keeps-ties`, `insight-rankings-significance`): 3 suites, 29/29;
  - `src/pos-hub`: 13 suites, 284/284.
- **Web vitest:** `ReportsNext.test.tsx` **80/80**.
- **Gateway typecheck:** `tsc --noEmit -p tsconfig.spec.json` shows only the 2 known `@simplewebauthn/server` errors.
- **Gateway eslint** on the four analytics files `69533313f` touched: 0 errors. There is 1 prettier warning, at `analytics.service.ts:521`, on a pre-existing line from 2026-09-12 that is also on `main`.
- **Local Postgres:** `pgtest.sh lane … stockout_standin_1007` ran with a read-only probe from the scratchpad. It found one `public.record_glass_pour`, with `COALESCE(ri.bottle_size_ml, 750)` in `pg_get_functiondef`: [fix] PASS, [ctl] PASS. That pins kept behaviour, because no SQL is in the diff. The probe fails on both when it looks for 700. The template is `42fe1252b`, one migration behind `origin/main`: #620's zone migration, which does not touch the writer, and which the harness applied as a "lane" migration on [fix].

**Stale lines in the live body, and their replacements**
- L13 *"**Head `1f3b821d3`** (local; the remote PR head stays `b93e67183` …). … 15 files against `origin/main` `4528b9689` … Nothing has changed behaviour since `c8c88c049`."* → **Head `a96e181fe`.** Branch `fix/stockout-counts-open-ml`, 15 files against `origin/main` `b270a45b8`, which this branch contains (merged at `a1736c6e1`). Behaviour last changed at `69533313f`: the lot-rollup reads are whole-or-refused.
- L41 *"The 14-day floor, the bottle-size rule and the unmeasured-row rule are the build's picks under the locked ADR 0020. They are not founder answers."* → The 14-day floor and the unmeasured-row rule are the build's picks under the locked ADR 0020; they are not founder answers. The bottle-size rule is the founder's: *"Standard 75 cl, as built (Recommended)"*, answered 2026-10-07T13:51:58Z, ADR 0299 rule 1.
- L44, add a sub-bullet → Claim `STOCKOUT-STAND-IN-IS-THE-POURS` ties this 750 to the writer's `COALESCE(ri.bottle_size_ml, 750)` and to pos-hub's `RPC_DEFAULT_BOTTLE_ML`.
- L56 *"It reads `open_ml` itself (`readOpenMl`). If that read fails, the insight logs the failure and stays silent …"* → It reads `open_ml` itself (`readOpenMl`, through `readLotRollup`: one page proved whole by an exact count, or `WholeReadError`). If that read fails or is refused, the insight logs it and stays silent instead of ranking sealed counts.
- L80 *"## Review rounds (none changed behaviour)"* → **## Review rounds**. Add two rounds:
  - **Coordinator re-head and fixer, `8b5a00491`**: the #609 merge, `readLotRollup` (a behaviour change), the Tonight-card OWED row, and the cite re-points.
  - **Bottle-size answer, `a96e181fe`**: docs and claims only.
- L111–122 *"**At HEAD `1f3b821d3`**"* and its table → replace with the results above, run at `a96e181fe`.
- L138 *"904 checked, 904 holding"* → **927 checked, 927 holding** (Python 3.11.0).
- L139 *"The 4 new claims rows each fail against a `git archive` of `origin/main` …"* → the claims file now holds 6 rows. `STOCKOUT-ROLLUP-READ-WHOLE-OR-REFUSED` was mutated five ways (`69533313f`). `STOCKOUT-STAND-IN-IS-THE-POURS` was mutated five ways, as above. Against a `git archive` of `origin/main` `b270a45b8` it fails (`['750', None, '750']`), because `bottlesOnHand` is this branch's. Its other two numbers already agree on `main`. `STOCKOUT-ROLLUP-READ-WHOLE-OR-REFUSED` was not re-run against an archive in this round.
- L144 *"**Local Postgres: not run.** …"* → **Local Postgres:** the read-only probe above. No SQL is in the diff.
- L152 *"Its rows are STOCKOUT-OPEN-ML-COUNTED, STOCKOUT-RISK-NEEDS-14-SALE-DAYS, STOCKOUT-DASH-SAYS-WHY and STOCKOUT-GENERATOR-VERSION"* → add `STOCKOUT-ROLLUP-READ-WHOLE-OR-REFUSED` and `STOCKOUT-STAND-IN-IS-THE-POURS`, all `resolved`.
- L156 *"Five residuals are OPEN."* → Five residuals are OPEN, and "Two rules for an unstated bottle size" among them is half answered. One entry is OWED elsewhere (the form-default 750). The open-ml-reads entry's one-page half is FIXED. The Tonight card and the bottle size are bullets under the FIXED entry: the Tonight card OWED on a follow-up, the bottle size ANSWERED.
- L158–165 *"## Founder answers — Both answers …"* → add:
  - **Bottle size** (2026-10-07T13:51:58Z): *"Standard 75 cl, as built (Recommended)"*. Built as it stands, with no code change. Quoted in ADR 0299 rule 1.
  - **Tonight card** (2026-10-06T16:55:23Z): *"Fire on an empty shelf (Recommended)"*. OWED on a follow-up PR; this PR merges with the card's silence as built.
- L170 *"**Which bottle-size fallback is right** … It was handed there and not asked."* → **Bottle-size fallback:** answered for the stockout count (the row's size, else 750). /inventory's own rule (`inventory.service.ts:80-82`, library before 750) is still OPEN under AW15 and was not asked.
- L170, add a bullet → **OPEN, unasked, not defaulted:** should the register and Wine-360 refuse ("could not be read") on an unreadable or over-long rollup, as ADR 0292 fork 3 ruled for `loadConsumption`, instead of falling back to `stock_live` with no open bottle? The fallback stays as built; that is not an answer.
- L177–180 *"The versions are: `main` 5, cap (#609) 6, this PR 7 … **Cap (#609) should merge before this PR.** If this PR merges first, cap takes 8 …"* → cap (#609) merged first, at `b270a45b8`, with 6. This branch merged it and stays at 7. #625 and #626 hold 8 each and must re-check the version at their merge. STOCKOUT-GENERATOR-VERSION holds.
- L185 *"**#609 cap** conflicts only in `insight-generator.service.ts`, in the version header."* → #609 is merged. Its one conflict, in the version header, was resolved at `a1736c6e1`.
- L183–198, the merge-tree dry runs → **not re-run at this head.** They date from `1f3b821d3`.
- L203 *"**Already merged:** postime (#603), rec (#607), sig (#602) and tables (#621) …"* → also cap (#609), #622, #651 and #620; this branch contains them.
- L210, add → **Owed elsewhere:** the Tonight card (follow-up PR, ADR 0299 amendment), and the form-default 750 in `AddWineToInventoryModal` (ADR 0115 / AW15 work).
- L226 *"`analytics.service.ts:694` to `:696`"* → `:694` is now `:774` (`reorderList: E.cutKeepingTies(`; `:710` on `main`). ADR 0272's `advanced-analytics.service.ts:575-576` was not re-measured; it already misses its code on `main` after #609.
- L236 *"**Two bottle-size fallback rules exist** … So a 1 L spirit with a NULL size reads at 750 ml."* → **Two bottle-size fallback rules exist.** The stockout count uses the writer's rule by the founder's pick (2026-10-07T13:51:58Z), so a 1 L spirit with a NULL size reads at 750 ml by his choice. /inventory's `inventory.service.ts:80-82` still puts the library first (OPEN, AW15). A written 750 can be the add-wine form's default.
- L238 *"**A failed rollup read** degrades the register and Wine-360 to sealed counts, but silences the insight."* → also a rollup longer than one page (`readLotRollup`). Whether the register and Wine-360 should refuse instead is the OPEN fork above.
- L241 *"They read one unpaged page. Tuzlu has 134 rows, but a house with more than `max_rows = 1000` rollup rows would read only part of it."* → They read one page proved whole by an exact count, or refuse. A house past 1,000 rollup rows gets no open ml from them until the view carries a key to page on, which needs a migration. Tuzlu's rollup row count was not measured: 134 is its ranked inventory count, not its rollup count.

**Not done or not verified (CLAUDE.md §0.5)**
- Nothing is pushed, CI has not run on `a96e181fe`, and this head is not audited.
- The two DB-needing guards (`check_house_item_invariants`, `check_migration_ledger`) were not run.
- The merge-tree dry runs against open PRs were not re-run.
- Web `tsc` and web eslint were not re-run. None of this PR's web files changed since `1f3b821d3` (`git diff 1f3b821d3 HEAD -- apps/web/src/pages/reports/next/` is empty), but the merges brought in `main`'s web changes.
- No production rows were read, so the number of form-default 750s on production is unknown.
