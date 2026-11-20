# Merge order for the open PR trains (r32 merge-readiness, 2026-11-13)

## Founder summary

- **What was measured:** `origin/main` = `c459b0a12` (unchanged since r21). There are 777 open PRs, and 694 of them are drafts. 89 of the drafts are new in r28/r29/r30/r31 (#1360-#1448). The snapshot was taken at about 23:45Z. The r31 walkers are still pushing, so re-run the simulator before landing anything.
- **Trains:** 133 trains with 201 tips. That counts every draft, plus the 3 ready PRs that drafts sit on (#577, #691, #958), and leaves out the 4 duplicates to close.
- **Clean:** **122 tips land clean**, and **17 more land with only a register union** (the mechanical regenerate or keep-both step). 2 tips are already contained in earlier ones. In PRs, that is 379 that land and 315 that sit behind a conflicting tip.
- **Conflicts:** **60 tips conflict**. r22 had 34, and 39 of today's 60 involve an r28-r31 PR. Most of them come from a few new PRs:
  - **#1369 and #1382** (cost train #783, `advanced-analytics.service.ts`): 15 and 12 tips. They hit the reports/cost meeting: #1183, #1439, #1436, #1150, #1015, #1163, #1174, #1182, #1357, #1378, #1138 and the goals trio #725/#722.
  - **#1418 and #1413** (menu price column, setup past the menu): they hit the whole menu train #777 (#1257, #1053, #1422, #1381, #1379), plus #762, #778 and #1432.
  - **#1359** (team claim): it hits 5 tips (#874, #952, #897, #901, #925), but only in `DELIVERY-AUDIT.md` and `read_error_baseline.json`. That is register work: keep both entries, then regenerate the baseline.
  - **#1072** (cellar bottles-only count): 11 inventory/dashboard tips. This was already open in r22.
  - **#1076** (VKN): 3 r28/r30 door PRs (#1431, #1367, #1427) in `documents.controller.ts`.
  - **Mail #876:** 7 tips vs #1032/#797. Already open in r22, and r30's #1394-#1442 sit on top of it.
- **Stale resolutions:** r22 resolutions that are no longer enough.
  - Six of them grew r28/r30 children that conflict with the resolution itself: menu `6e2bc4fcf` (#1422, #1381), inventory `eeca8c38b` (#1412), `4e24d8158` (#1407, #1411) and auth `ce2c632c2` (#1292).
  - Two carry #1162, which is to be closed: `3d9caa544` (#903) and `5519cbb30` (#972).
- **Duplicates to close (2 sets):**
  - **#1162**: keep its split **#1165 → #1166**. #1162's own body says so, and the r28/r30 recipe chain (#1186 … #1424) is built on #1166.
  - **#850 → #851 → #852**: keep **#1258 → #1266** on #843. #1258's body says "#850, #851 and #852 can be closed" once its train lands. #850's narrow-screen design was replaced by #1057/#1058.
  - Closing both sets takes the conflicts from 62 to 60. It clears #852, #1420, #1231 and #1363, and adds #903/#972 until their resolutions are re-cut without #1162.
- **Another collision:** **#789 and #809 share migration version `20270301180000`**, with different files (`sign_in_codes_carry_verify_email` and `one_pour_size_for_the_house`). If both land, `supabase db reset` dies on a duplicate key. #789 keeps the version, and **#809 is renumbered** past every version on main and in open PRs.
- **CI:**
  - The 565 stacked drafts have **no CI**, because `ci.yml` runs only on PRs into main/develop. Each gets CI when it is retargeted after its parent lands.
  - Of the 129 main-based drafts, 66 are green, 3 have no finished run yet (#802, #1443, #1444), and 32 are green apart from `Test E2E`. That check fails on every PR because of the runner: "Playwright does not support chromium on ubuntu26.04-x64", so it is not a PR defect.
  - 28 are red on a real check.
  - `Lint TypeScript` on #1278 died with exit 134 and 0 lint errors (a runner abort). The other six Lint reds were not opened.
  - #1404's "Decision register" red is real: `DESIGN-FLAG-READ-FAILURE-IS-NOT-CACHED-AS-OFF` is listed open, but it now verifies.
- **Not changed:** no PR was changed, closed or retargeted.

## 1. Decisions (the session's calls under the 2026-11-07 /goal)

1. **The landing model is kept from r21/r22.** Trains land tip by tip with "Create a merge commit", and a resolve SHA is landed by fast-forwarding the tip's head branch to it. The rejected alternatives are r21's: squash breaks ancestry, and rebase-merge rewrites the SHAs.
2. **The two duplicate sets above are closed rather than landed.** The order in `order.json` already excludes them (`"exclude": [1162, 850]`).
   - *Rejected: land both copies and let git merge identical hunks.* #1162 and #1165+#1166 are the same code applied onto different #1160 tips, and the recipe siblings conflict on that (#1420, #1231). #850's flow design (`SHEET_FLOW_BELOW`) contradicts #1057/#1058, and #1258's body says the two cannot both merge.
   - The keep-all run (`order-keep-all.json`, 62 conflicts) is kept for comparison.
3. **Carried copies stay open.** Each pair below shares hunks on purpose, one PR carrying another's change onto a second train. Identical hunks merge clean, so neither PR is closed:
   - #1020/#1183 ↔ #1203: #1203 says "Merge this PR after #1200, not #1183". r21's `48ab85144` merges both.
   - #1112 ↔ #1443: r31 lifted #1112's toast hunk. #1443 lands clean after #1127.
   - #839 ⊂ #909, #797 ⊂ #948, #725 ⊃ #730, and #760 ⊃ #731/#747/#758/#759 (#760: "Supersedes #731, #747, #758 and #759, which are closed after this merges"). These are ancestry, so the smaller PR is marked merged when the bigger one lands.
   - #1326 ↔ #1352 and #1131 ↔ #1146/#1147 are "carry … onto" chores.
   - #1188/#1189/#1190/#1191 share the `useHouseMoney` hook.
   - `house-number.ts` is carried by #1303, #1307, #1308, #1312, #1317, #1319, #1400, #1423 and #1447. The r31 digit-grouping lane owns #1447, and it was not touched.
4. **A resolution now applies to the tip's descendants (simulator change).** r21's `tipsim.py` looked up a resolution only on the tip itself. Seven r22-resolved tips have since grown children, so r21 would have silently simulated the bare heads. The r32 simulator walks the tip's path to the nearest resolved PR:
   - it lands the resolution if that contains the head;
   - otherwise it lands a synthetic `merge(resolution, head)` if that is clean (`+ext`: extend the branch with one `git merge`);
   - otherwise it reports `STALE`.
   - **Checked against r21 on the same data and order** (`order-keep-all.json`, output in `tipsim-r21-on-r32-data.txt`): r21 gives 63 conflicts and r32 gives 62. r21 reports #1287 as a false CONFLICT, because it ignores `496a31304` on its parent #1246. r21 also drops the #577→#1332 train entirely, because its hard-coded ready set `{691, 958}` misses #577.
5. **Train order: ascending roots, with the goals trio #730, #725, #722 last** (r22's finding, re-used).
   - *Rejected after testing: land r28+ tips last inside every train* (`order-alt-newwork-last.json`). It gives 62 conflicts instead of 60, and 121 clean instead of 122.
   - Conflicts are symmetric (r21 decision 4). The order only decides who carries a resolution, and here the side that lands second carries it.
6. **CI judgement.** `Test E2E` alone is a runner fault (Playwright and ubuntu 26.04), not a PR verdict, and the founder should not read those 32 PRs as broken. It still turns `CI Complete` red on every PR into main until the workflow pins a supported runner image (for example `ubuntu-24.04`). That is a separate one-line fix, and it is not made here.

## 2. Duplicates and overlaps (from `overlap.py`; data in `dup-pairs.json`, `overlap.json`)

| pair | shared change hunks | relation | keep | close |
|---|---|---|---|---|
| #1162 vs #1165→#1166 | 8/23 vs 8/10 + 8/14; identical file set | split of one PR (body: "Superseded by the split #1165 → #1166") | #1165, #1166 | **#1162** |
| #850→#851→#852 vs #1258→#1266 | #851 15/15 = #1258 15/15; #852 8/11 = #1266 8/11 | carried onto #843 without #850's flow state | #1258, #1266 | **#850, #851, #852** |
| #789 vs #809 | migration `20270301180000` used twice | collision | #789's version | none; **renumber #809** |
| #1020, #1183 vs #1203 | 8/16 vs 8/17 | port onto the cost train; r21 resolution merges both | both | none |
| #1112 vs #1443 | 3 | r31 lifted hunk | both | none |
| #797 ⊂ #948, #839 ⊂ #909, #730 ⊂ #725, #731/#747/#758/#759 ⊂ #760, #828 ⊂ #815, #1119 ⊂ #1113 | n/a | ancestry: landing the larger lands the smaller | both (the smaller is marked merged) | none |

**Overlap hotspots** (files touched by the most open trains, so they carry the most re-merges):

- `procurement.service.ts`: 9 trains / 17 PRs, including r31's #1444.
- `AuthContext.tsx`: 8 / 13.
- `house-number.ts`: 7 / 8.
- `App.tsx`: 7 / 8.
- `inventory.service.ts`: 7 / 13.
- `menus.service.ts`: 6 / 27.
- `advanced-analytics.service.ts`: 6 / 16, with #1369, #1382, #1434 and #1435.
- `InventoryNext.tsx`: 6 / 17.
- `scripts/sql_outside_migrations.txt`: 15 / 29. Never hand-merge it. Regenerate it with `check_migrations_single_home.py --update`.

## 3. The 60 conflicts, by who carries the resolution

The side that lands second carries the resolution, and `+ext`/`STALE` follow decision 4.

- **Register-only (5): #874, #952, #897, #901, #925 vs #1359.** Keep both `DELIVERY-AUDIT.md` entries newest-first. Then regenerate `scripts/read_error_baseline.json` with `scripts/check_read_errors_not_swallowed.py`. The r22 resolutions for #952/#897/#901/#925 are otherwise intact.
- **Reports and cost vs #1369/#1382 (13).** The tips are #1183 and #1439 (r21 `48ab85144`, which is `+ext` to #1439), #1436 and #1437 (r30 staff-withheld chain on #1362), #1150, #1015, #1163, #1174, #1182, #1357, #1378, #1138, and #725/#722 (last). Every one meets in `advanced-analytics.service.ts`, and most also in `analytics.service.ts`.
  - **Call:** re-cut `48ab85144` on top of the #783 train tips #1369, #1382, #1383 and #1447, and keep r21's money rule: an unknown cost is never summed as 0.
  - Then extend #1150 `8174b53d2`, #1015 `e30afa811` and the trio's resolutions from that branch.
- **Menu vs #1418 (on #761) and #1413 (on #770) (8).**
  - The tips are #762, #778, #1257 and #1053 (r21 `6e2bc4fcf`), #1422 and #1381 (`6e2bc4fcf` STALE: 10 files), #1379, and #1432 (`SetupNudgeBanner`/`HouseMenu`).
  - **Call:** re-cut the menu resolution on a base that already has #773, #1413 and #1418, then merge in the r28/r30 menu tips #1422 and #1381.
  - The r21 note still stands: check whether #1265's `parseMenuPrice` covers #761's and #1418's price-column reading.
- **Inventory vs #1072 (8).** The tips are #801, #809, #1189, #1247, #1264, #1360 (r30, on the dashboard train #1175), #1391 and #1423 (r21 `194193193`, `+ext`). This is r22's open item: merge `eeca8c38b` into each one and keep #1072's bottles-only count.
- **Inventory resolutions stale (3).** #1412 is stale on `eeca8c38b` (`InventoryNext.tsx`, `useInventoryNextData.ts`). #1407 and #1411 are stale on `4e24d8158` (`InventoryNext.test.tsx`, `RowDropdown.tsx`). Extend each resolution with its r28/r30 chain (#1356→#1373→#1412, and #1302→#1312→#1386→#1407/#1411).
- **Invoices and door (6).**
  - #1431, #1367 and #1427 vs #1076 meet only in `documents.controller.ts`.
  - #1409 vs #1180/#1370 meets in `delivery-stock.service.ts` and `CanonicalDocumentPage.tsx`.
  - #1078 vs #1370 meets in `CanonicalDocumentPage`.
  - #821 vs #1127 is spec-only: keep both `describe` blocks.
- **Money-in (2).** #1207 and #1275 vs #1127/#1279/#1329, in `money-in.ts` and `verify-receipt.spec.ts`.
- **Mail #876 (7).** The tips are #1442 (r30 #1394→…→#1442), #1293, #1330, #1374 (r28 #1368), #1001, #1009 and #1006, vs #1032/#797/#791/#795/#687/#759. This is r22's mail item, and r30's linear stack now sits on #1397.
- **Onboarding (1).** #1433 (r30 #1372, #1419, #1433) vs #773/#1316, in `MenuScanUpload.tsx`.
- **Auth (2).**
  - #1315 (#1313→#1315) vs #1124's resolution, in `Register.tsx` and the auth fingerprints.
  - #1292 (#1290→#1292) is stale on `ce2c632c2` (`AuthContext.tsx`, `sessionReadRetry`, `RootDoor.tsx`).
- **Route census (2).** #903 and #972: re-cut `3d9caa544`/`5519cbb30` without #1162, on the #1165→#1166 lineage. The census JSON is a key union, as r22 described.
- **POS (1).** #1421 (r30 recipe-sale slice, #1396→#1421) vs #805/#841/#1145, in `pos-hub.service.ts`.

## 4. Order

- **Recommended:** `order.json`, which is r22's resolutions, ascending roots, the trio last, and `exclude [1162, 850]`.
- **Per PR:** `pr-index.tsv` gives, for every draft, its base, train root, full base chain, landing step, tip, simulated status and CI.
- **In the table:**
  - "lands" is the chain of PRs that tip brings that are not yet on the simulated main.
  - "via `sha`" lands an r21/r22 resolution.
  - `+ext` means the resolution is clean once extended with the tip's head.
  - `STALE` means the resolution itself conflicts with the tip's newer commits.

| step | train root | tip | status | lands (chain of PRs not yet on main) | CI of the PRs it lands | conflicts with (landed earlier) | conflicting files |
|---|---|---|---|---|---|---|---|
| 1 | #577 | #1332 | clean | #577→#1332 | green 1, none (stacked) 1 |  |  |
| 2 | #590 | #597 | union-only | #590→#597 | green 1, none (stacked) 1 |  |  |
| 3 | #674 | #687 | union-only | #674→#687 | green 1, none (stacked) 1 |  |  |
| 4 | #680 | #680 | union-only | #680 | green 1 |  |  |
| 5 | #691 | #1124 | clean via `c00cb00a1` | #691→…→#1124 (5) | none (stacked) 4, green 1 |  |  |
| 6 | #691 | #1315 | CONFLICT | #1313→#1314→#1315 | none (stacked) 3 | #1124 | `Register.tsx`, `authPages.off-fingerprints.json` |
| 7 | #698 | #698 | clean | #698 | green 1 |  |  |
| 8 | #706 | #706 | clean | #706 | green 1 |  |  |
| 9 | #731 | #731 | clean | #731 | green 1 |  |  |
| 10 | #747 | #747 | clean | #747 | green 1 |  |  |
| 11 | #748 | #748 | clean | #748 | green 1 |  |  |
| 12 | #754 | #754 | clean | #754 | green 1 |  |  |
| 13 | #758 | #759 | clean | #758→#759 | green 1, none (stacked) 1 |  |  |
| 14 | #760 | #760 | clean | #760 | red 1 |  |  |
| 15 | #761 | #1418 | clean | #761→#1418 | red 1, none (stacked) 1 |  |  |
| 16 | #762 | #762 | CONFLICT | #762 | green 1 | #1418 | `menus.service.ts` |
| 17 | #763 | #763 | clean | #763 | green 1 |  |  |
| 18 | #764 | #764 | clean | #764 | green 1 |  |  |
| 19 | #770 | #1413 | clean | #770→…→#1413 (7) | none (stacked) 6, red 1 |  |  |
| 20 | #773 | #773 | clean | #773 | green 1 |  |  |
| 21 | #774 | #774 | clean | #774 | green 1 |  |  |
| 22 | #775 | #1076 | clean | #775→…→#1076 (8) | none (stacked) 7, green 1 |  |  |
| 23 | #775 | #1370 | clean | #1077→…→#1370 (5) | none (stacked) 5 |  |  |
| 24 | #775 | #1428 | clean | #1371→#1428 | none (stacked) 2 |  |  |
| 25 | #775 | #1078 | CONFLICT | #1078 | none (stacked) 1 | #1370 | `CanonicalDocumentPage.test.tsx`, `CanonicalDocumentPage.tsx` |
| 26 | #775 | #1080 | clean | #1079→#1080 | none (stacked) 2 |  |  |
| 27 | #776 | #776 | clean | #776 | green 1 |  |  |
| 28 | #777 | #1257 | CONFLICT via `6e2bc4fcf` | #777→…→#1257 (23) | none (stacked) 22, green 1 | #773, #1413, #1418 | `menus.service.spec.ts`, `menus.service.ts`, `HouseMenu.tsx`, `MenuVersions.tsx`, `menus.ts` |
| 29 | #777 | #1053 | CONFLICT | #777→…→#1053 (4) | none (stacked) 3, green 1 | #773, #1413, #1418 | `menus.service.spec.ts`, `menus.service.ts`, `HouseMenu.tsx`, `MenuVersions.tsx`, `menus.ts` |
| 30 | #777 | #1422 | CONFLICT (resolution `6e2bc4fcf` on #1265 STALE) | #777→…→#1422 (32) | none (stacked) 31, green 1 | #773, #1413, #1418 | `menus.service.spec.ts`, `menus.service.ts`, `HouseMenu.tsx`, `MenuVersions.tsx`, `menus.ts` |
| 31 | #777 | #1381 | CONFLICT (resolution `6e2bc4fcf` on #1265 STALE) | #777→…→#1381 (22) | none (stacked) 21, green 1 | #773, #1413, #1418 | `menus.service.spec.ts`, `menus.service.ts`, `HouseMenu.tsx`, `MenuVersions.tsx`, `menus.ts` |
| 32 | #777 | #1379 | CONFLICT | #777→…→#1379 (8) | none (stacked) 7, green 1 | #773, #1413, #1418 | `menus.service.spec.ts`, `menus.service.ts`, `HouseMenu.tsx`, `MenuVersions.tsx`, `menus.ts` |
| 33 | #778 | #778 | CONFLICT | #778 | green 1 | #773, #1413, #1418 | `menus.service.spec.ts` |
| 34 | #779 | #779 | clean | #779 | green 1 |  |  |
| 35 | #780 | #815 | clean | #780→#812→#815 | none (stacked) 2, green 1 |  |  |
| 36 | #780 | #828 | already-landed | #828 | none (stacked) 1 |  |  |
| 37 | #781 | #1072 | union-only | #781→…→#1072 (10) | none (stacked) 9, green 1 |  |  |
| 38 | #782 | #782 | clean | #782 | green 1 |  |  |
| 39 | #783 | #846 | union-only | #783→#845→#846 | none (stacked) 2, green 1 |  |  |
| 40 | #783 | #1016 | union-only | #919→#920→#1016 | none (stacked) 3 |  |  |
| 41 | #783 | #1133 | union-only | #932→…→#1133 (16) | none (stacked) 16 |  |  |
| 42 | #783 | #1369 | clean | #1144→…→#1369 (13) | none (stacked) 13 |  |  |
| 43 | #783 | #1447 | clean | #1447 | none (stacked) 1 |  |  |
| 44 | #783 | #1383 | clean | #1209→#1383 | none (stacked) 2 |  |  |
| 45 | #783 | #1382 | clean | #1382 | none (stacked) 1 |  |  |
| 46 | #783 | #1145 | clean | #1145 | none (stacked) 1 |  |  |
| 47 | #783 | #1118 | clean | #1118 | none (stacked) 1 |  |  |
| 48 | #783 | #1119 | already-landed | #1119 | none (stacked) 1 |  |  |
| 49 | #783 | #1436 | CONFLICT | #1362→…→#1436 (4) | none (stacked) 4 | #1133, #1369, #1382 | `advanced-analytics.service.ts`, `rp-registers-trade.tsx`, `useReportsNextData.test.tsx` |
| 50 | #783 | #1437 | CONFLICT | #1362→#1437 | none (stacked) 2 | #1369 | `rp-registers-trade.tsx`, `useReportsNextData.test.tsx` |
| 51 | #783 | #1127 | union-only | #1087→#1112→#1127 | none (stacked) 3 |  |  |
| 52 | #783 | #1130 | clean | #1130 | none (stacked) 1 |  |  |
| 53 | #783 | #1380 | union-only | #1380 | none (stacked) 1 |  |  |
| 54 | #783 | #857 | clean | #857 | none (stacked) 1 |  |  |
| 55 | #784 | #784 | clean | #784 | green 1 |  |  |
| 56 | #785 | #869 | clean | #785→…→#869 (6) | none (stacked) 5, green 1 |  |  |
| 57 | #786 | #786 | clean | #786 | green 1 |  |  |
| 58 | #787 | #821 | CONFLICT | #787→#820→#821 | none (stacked) 2, red 1 | #1127 | `verify-receipt.spec.ts` |
| 59 | #788 | #788 | union-only | #788 | green 1 |  |  |
| 60 | #789 | #1083 | clean | #789→…→#1083 (8) | none (stacked) 7, red 1 |  |  |
| 61 | #790 | #790 | clean | #790 | green 1 |  |  |
| 62 | #791 | #791 | clean | #791 | green 1 |  |  |
| 63 | #792 | #792 | clean | #792 | green 1 |  |  |
| 64 | #795 | #795 | clean | #795 | green 1 |  |  |
| 65 | #796 | #796 | clean | #796 | green 1 |  |  |
| 66 | #797 | #797 | clean | #797 | green 1 |  |  |
| 67 | #798 | #798 | clean | #798 | green 1 |  |  |
| 68 | #799 | #800 | clean | #799→#800 | green 1, none (stacked) 1 |  |  |
| 69 | #799 | #1202 | clean | #1202 | none (stacked) 1 |  |  |
| 70 | #801 | #801 | CONFLICT | #801 | green 1 | #1072 | `database.service.ts` |
| 71 | #802 | #802 | clean | #802 | pending 1 |  |  |
| 72 | #803 | #803 | clean | #803 | green 1 |  |  |
| 73 | #804 | #841 | union-only | #804→…→#841 (9) | none (stacked) 8, green 1 |  |  |
| 74 | #805 | #805 | union-only via `329ee9bc0` | #805 | green 1 |  |  |
| 75 | #807 | #808 | clean | #807→#808 | green 1, none (stacked) 1 |  |  |
| 76 | #807 | #810 | clean | #810 | none (stacked) 1 |  |  |
| 77 | #809 | #809 | CONFLICT | #809 | red 1 | #1072 | `inventory.service.ts` |
| 78 | #811 | #811 | clean | #811 | green 1 |  |  |
| 79 | #816 | #1431 | CONFLICT | #816→…→#1431 (26) | none (stacked) 25, green 1 | #1076 | `documents.controller.ts` |
| 80 | #816 | #1367 | CONFLICT | #816→…→#1367 (25) | none (stacked) 24, green 1 | #1076 | `documents.controller.ts` |
| 81 | #816 | #1427 | CONFLICT | #816→…→#1427 (26) | none (stacked) 25, green 1 | #1076 | `documents.controller.ts` |
| 82 | #816 | #1180 | clean | #816→…→#1180 (16) | none (stacked) 15, green 1 |  |  |
| 83 | #816 | #1409 | CONFLICT | #890→…→#1409 (7) | none (stacked) 7 | #1180, #1370 | `delivery-stock.service.ts`, `CanonicalDocumentPage.tsx` |
| 84 | #817 | #1359 | clean | #817→…→#1359 (7) | none (stacked) 6, green 1 |  |  |
| 85 | #817 | #1417 | clean | #1417 | none (stacked) 1 |  |  |
| 86 | #822 | #822 | clean | #822 | green 1 |  |  |
| 87 | #823 | #823 | clean | #823 | green 1 |  |  |
| 88 | #824 | #825 | clean | #824→#825 | green 1, none (stacked) 1 |  |  |
| 89 | #826 | #826 | clean | #826 | green 1 |  |  |
| 90 | #827 | #874 | CONFLICT | #827→#854→#874 | none (stacked) 2, green 1 | #1359 | `DELIVERY-AUDIT.md` |
| 91 | #833 | #1095 | clean | #833→#865→#1095 | none (stacked) 2, red 1 |  |  |
| 92 | #839 | #858 | clean | #839→#858 | red 1, none (stacked) 1 |  |  |
| 93 | #843 | #1183 | CONFLICT via `48ab85144` | #843→…→#1183 (16) | none (stacked) 15, green 1 | #1133, #1369, #1382 | `advanced-analytics.service.ts` |
| 94 | #843 | #1439 | CONFLICT via `48ab85144` +ext | #843→…→#1439 (22) | none (stacked) 21, green 1 | #1133, #1369, #1382 | `advanced-analytics.service.ts` |
| 95 | #847 | #1316 | clean | #847→…→#1316 (8) | none (stacked) 7, green 1 |  |  |
| 96 | #847 | #1433 | CONFLICT | #1372→#1419→#1433 | none (stacked) 3 | #773, #1316 | `MenuScanUpload.tsx` |
| 97 | #847 | #1387 | clean | #1387 | none (stacked) 1 |  |  |
| 98 | #847 | #1317 | clean | #1261→#1294→#1317 | none (stacked) 3 |  |  |
| 99 | #848 | #1432 | CONFLICT | #848→…→#1432 (8) | none (stacked) 7, green 1 | #1413, #1418 | `SetupNudgeBanner.tsx`, `HouseMenu.tsx` |
| 100 | #853 | #952 | CONFLICT via `2777440ea` | #853→…→#952 (6) | none (stacked) 5, green 1 | #1359 | `DELIVERY-AUDIT.md`, `read_error_baseline.json` |
| 101 | #855 | #999 | clean via `46f8a6475` | #855→…→#999 (6) | none (stacked) 5, green 1 |  |  |
| 102 | #859 | #859 | union-only | #859 | green 1 |  |  |
| 103 | #860 | #1412 | CONFLICT (resolution `eeca8c38b` on #1233 STALE) | #860→…→#1412 (14) | none (stacked) 13, green 1 | #858, #1072 | `InventoryNext.test.tsx`, `InventoryNext.tsx`, `InventoryTable.tsx`, `iv-url.ts`, `useInventoryNextData.ts` |
| 104 | #860 | #1150 | CONFLICT via `8174b53d2` | #860→…→#1150 (18) | none (stacked) 17, green 1 | #790, #1118, #1133, #1369, #1382, #1383, #1447 | `advanced-analytics.service.ts`, `analytics.service.ts`, `order-schema-drift.spec.ts`, `report-export-cuttings.ts`, `ReportsNext.test.tsx` +11 |
| 105 | #860 | #1407 | CONFLICT (resolution `4e24d8158` on #1272 STALE) | #860→…→#1407 (29) | none (stacked) 28, green 1 | #858, #1072, #1095, #1130 | `InventoryNext.tsx`, `InventorySheets.tsx`, `RowDropdown.test.tsx`, `RowDropdown.tsx`, `iv-url.ts` |
| 106 | #860 | #1411 | CONFLICT (resolution `4e24d8158` on #1272 STALE) | #860→…→#1411 (29) | none (stacked) 28, green 1 | #858, #1072, #1095, #1130 | `InventoryNext.tsx`, `InventorySheets.tsx`, `RowDropdown.test.tsx`, `RowDropdown.tsx`, `iv-url.ts` |
| 107 | #860 | #1015 | CONFLICT via `e30afa811` | #860→…→#1015 (12) | none (stacked) 11, green 1 | #790, #1118, #1133, #1369, #1382, #1383, #1447 | `advanced-analytics.service.ts`, `analytics.service.ts`, `order-schema-drift.spec.ts`, `report-export-cuttings.ts`, `ReportsNext.test.tsx` +11 |
| 108 | #860 | #1391 | CONFLICT | #860→…→#1391 (9) | none (stacked) 8, green 1 | #1072, #1095 | `inventory.service.ts` |
| 109 | #863 | #1164 | union-only | #863→…→#1164 (26) | none (stacked) 25, green 1 |  |  |
| 110 | #863 | #1420 | union-only | #1165→…→#1420 (17) | none (stacked) 17 |  |  |
| 111 | #863 | #1423 | CONFLICT via `194193193` +ext | #1230→…→#1423 (4) | none (stacked) 4 | #858, #1072, #1095, #1130 | `InventoryNext.tsx`, `InventorySheets.tsx`, `RowDropdown.test.tsx`, `RowDropdown.tsx`, `iv-url.ts` |
| 112 | #863 | #1231 | clean | #1231 | none (stacked) 1 |  |  |
| 113 | #863 | #1424 | CONFLICT | #1251→…→#1424 (7) | none (stacked) 7 | #1369, #1420 | `inventory-cost.ts`, `dishes-recipe.spec.ts` |
| 114 | #863 | #1174 | CONFLICT | #917→…→#1174 (5) | none (stacked) 5 | #858, #1133, #1359, #1369, #1382 | `DELIVERY-AUDIT.md`, `advanced-analytics.service.ts`, `analytics.service.ts`, `inventory-cost.ts`, `RowExpansion.test.tsx` +1 |
| 115 | #863 | #1182 | CONFLICT | #917→…→#1182 (6) | none (stacked) 6 | #858, #1133, #1359, #1369, #1382 | `DELIVERY-AUDIT.md`, `advanced-analytics.service.ts`, `analytics.service.ts`, `inventory-cost.ts`, `RowExpansion.test.tsx` +1 |
| 116 | #863 | #1357 | CONFLICT | #917→…→#1357 (6) | none (stacked) 6 | #858, #1133, #1359, #1369, #1382 | `DELIVERY-AUDIT.md`, `advanced-analytics.service.ts`, `analytics.service.ts`, `inventory-cost.ts`, `RowExpansion.test.tsx` +1 |
| 117 | #863 | #1378 | CONFLICT | #917→…→#1378 (4) | none (stacked) 4 | #1133, #1359, #1369, #1382 | `DELIVERY-AUDIT.md`, `advanced-analytics.service.ts`, `analytics.service.ts`, `inventory-cost.ts` |
| 118 | #863 | #1163 | CONFLICT | #917→…→#1163 (5) | none (stacked) 5 | #1133, #1369, #1382 | `advanced-analytics.service.ts`, `analytics.service.ts`, `inventory-cost.ts` |
| 119 | #876 | #1032 | union-only | #876→…→#1032 (22) | none (stacked) 21, green 1 |  |  |
| 120 | #876 | #1442 | CONFLICT | #973→…→#1442 (31) | none (stacked) 31 | #687, #759, #791, #795, #797, #1032 | `inbound-email.controller.ts`, `communications.module.ts`, `house-sender.service.ts`, `MailTab.test.tsx`, `MailTab.tsx` +2 |
| 121 | #876 | #1293 | CONFLICT | #973→…→#1293 (25) | none (stacked) 25 | #687, #759, #791, #795, #797, #1032 | `inbound-email.controller.ts`, `communications.module.ts`, `house-sender.service.ts` |
| 122 | #876 | #1330 | CONFLICT | #973→…→#1330 (18) | none (stacked) 18 | #687, #759, #791, #795, #797, #1032 | `inbound-email.controller.ts`, `communications.module.ts`, `house-sender.service.ts`, `mail-format.test.ts` |
| 123 | #876 | #1374 | CONFLICT | #955→…→#1374 (18) | none (stacked) 18 | #791, #792, #797, #1032 | `EXTERNAL_CONNECTIONS.md`, `inbound-email.controller.ts`, `rabbitmq-bridge.service.ts`, `gmail-watch.service.ts`, `inbound-headers.spec.ts` +1 |
| 124 | #876 | #1001 | CONFLICT | #955→…→#1001 (7) | none (stacked) 7 | #797, #1032 | `rabbitmq-bridge.service.ts`, `inbound-headers.spec.ts`, `email_parsing_agent.py` |
| 125 | #876 | #1009 | CONFLICT | #1009 | none (stacked) 1 | #1032 | `fix-review-communications.jsonl`, `communications.ts`, `CommunicationsNext.test.tsx`, `CommunicationsNext.tsx` |
| 126 | #876 | #1006 | CONFLICT | #1006 | none (stacked) 1 | #1032 | `20270421143700_the_mail_list_is_read_by_person_test.sql` |
| 127 | #897 | #897 | CONFLICT via `d56040046` | #897 | green 1 | #1359 | `DELIVERY-AUDIT.md`, `read_error_baseline.json` |
| 128 | #901 | #901 | CONFLICT via `5d66ce382` | #901 | green 1 | #1359 | `DELIVERY-AUDIT.md`, `read_error_baseline.json` |
| 129 | #902 | #925 | CONFLICT via `24ac50e02` | #902→#925 | red 1, none (stacked) 1 | #1359 | `DELIVERY-AUDIT.md`, `read_error_baseline.json` |
| 130 | #903 | #903 | CONFLICT (resolution `3d9caa544` on #903 STALE) | #903 | green 1 | #760, #1164 | `route-access.spec.ts` |
| 131 | #922 | #1013 | clean | #922→…→#1013 (6) | none (stacked) 5, red 1 |  |  |
| 132 | #929 | #1247 | CONFLICT | #929→…→#1247 (6) | none (stacked) 5, green 1 | #1072 | `low-stock-digest.template.ts`, `dashboard.service.ts`, `low-stock-alerts.service.ts` |
| 133 | #958 | #972 | CONFLICT (resolution `5519cbb30` on #972 STALE) | #958→…→#972 (15) | none (stacked) 14, green 1 | #687, #760, #1164, #1420 | `route-access.expected.json`, `route-access.spec.ts` |
| 134 | #1092 | #1092 | clean via `009766cdf` | #1092 | red 1 |  |  |
| 135 | #1096 | #1155 | clean | #1096→…→#1155 (4) | none (stacked) 3, green-but-E2E-runner 1 |  |  |
| 136 | #1096 | #1416 | clean | #1416 | none (stacked) 1 |  |  |
| 137 | #1123 | #1189 | CONFLICT | #1123→#1149→#1189 | none (stacked) 2, green-but-E2E-runner 1 | #1072 | `supabase.ts`, `WineRegister.test.tsx` |
| 138 | #1129 | #1129 | clean | #1129 | none (stacked) 1 |  |  |
| 139 | #1134 | #1190 | clean via `8b3fdabaa` | #1134→…→#1190 (4) | none (stacked) 3, green-but-E2E-runner 1 |  |  |
| 140 | #1134 | #1138 | CONFLICT | #1138 | none (stacked) 1 | #1133, #1369 | `analytics.service.ts` |
| 141 | #1134 | #1342 | clean | #1342 | none (stacked) 1 |  |  |
| 142 | #1136 | #1168 | clean via `5919db253` | #1136→#1148→#1168 | none (stacked) 2, green-but-E2E-runner 1 |  |  |
| 143 | #1143 | #1143 | clean | #1143 | red 1 |  |  |
| 144 | #1153 | #1154 | clean | #1153→#1154 | green-but-E2E-runner 1, none (stacked) 1 |  |  |
| 145 | #1156 | #1205 | clean | #1156→#1205 | red 1, none (stacked) 1 |  |  |
| 146 | #1157 | #1157 | clean | #1157 | green-but-E2E-runner 1 |  |  |
| 147 | #1158 | #1341 | clean | #1158→#1170→#1341 | none (stacked) 2, green-but-E2E-runner 1 |  |  |
| 148 | #1159 | #1172 | clean via `f8434bde9` | #1159→#1172 | red 1, none (stacked) 1 |  |  |
| 149 | #1161 | #1161 | clean | #1161 | red 1 |  |  |
| 150 | #1169 | #1169 | clean | #1169 | green-but-E2E-runner 1 |  |  |
| 151 | #1171 | #1171 | clean | #1171 | green-but-E2E-runner 1 |  |  |
| 152 | #1175 | #1360 | CONFLICT | #1175→…→#1360 (7) | none (stacked) 6, red 1 | #1072 | `dashboard.service.ts` |
| 153 | #1177 | #1177 | clean | #1177 | red 1 |  |  |
| 154 | #1188 | #1188 | clean | #1188 | green-but-E2E-runner 1 |  |  |
| 155 | #1192 | #1192 | clean | #1192 | green-but-E2E-runner 1 |  |  |
| 156 | #1193 | #1279 | clean | #1193→#1279 | green-but-E2E-runner 1, none (stacked) 1 |  |  |
| 157 | #1193 | #1329 | clean | #1282→#1329 | none (stacked) 2 |  |  |
| 158 | #1193 | #1288 | clean | #1288 | none (stacked) 1 |  |  |
| 159 | #1194 | #1207 | CONFLICT | #1194→…→#1207 (4) | none (stacked) 3, red 1 | #1127, #1279, #1329 | `money-in.ts`, `verify-receipt.spec.ts` |
| 160 | #1194 | #1275 | CONFLICT | #1194→#1275 | red 1, none (stacked) 1 | #1127, #1279, #1329 | `money-in.ts`, `verify-receipt.spec.ts` |
| 161 | #1195 | #1289 | clean | #1195→…→#1289 (5) | none (stacked) 4, red 1 |  |  |
| 162 | #1195 | #1445 | clean | #1358→#1445 | none (stacked) 2 |  |  |
| 163 | #1201 | #1201 | clean | #1201 | green-but-E2E-runner 1 |  |  |
| 164 | #1210 | #1210 | clean | #1210 | red 1 |  |  |
| 165 | #1235 | #1235 | clean | #1235 | green-but-E2E-runner 1 |  |  |
| 166 | #1236 | #1236 | clean via `e333a0add` | #1236 | green-but-E2E-runner 1 |  |  |
| 167 | #1239 | #1287 | clean via `496a31304` +ext | #1239→…→#1287 (4) | none (stacked) 3, green-but-E2E-runner 1 |  |  |
| 168 | #1240 | #1240 | clean | #1240 | green-but-E2E-runner 1 |  |  |
| 169 | #1242 | #1292 | CONFLICT (resolution `ce2c632c2` on #1249 STALE) | #1242→…→#1292 (7) | none (stacked) 6, green-but-E2E-runner 1 | #999, #1083, #1092, #1124, #1164, #1168 | `AuthContext.tsx`, `RootDoor.tsx`, `authStore.ts` |
| 170 | #1248 | #1248 | clean via `5f12637bb` | #1248 | green-but-E2E-runner 1 |  |  |
| 171 | #1263 | #1264 | CONFLICT | #1263→#1264 | none (stacked) 2 | #1072, #1095 | `inventory.service.ts` |
| 172 | #1273 | #1273 | clean | #1273 | green-but-E2E-runner 1 |  |  |
| 173 | #1277 | #1321 | clean | #1277→#1321 | green-but-E2E-runner 1, none (stacked) 1 |  |  |
| 174 | #1278 | #1320 | clean | #1278→#1320 | red 1, none (stacked) 1 |  |  |
| 175 | #1280 | #1448 | clean | #1280→…→#1448 (4) | none (stacked) 3, green-but-E2E-runner 1 |  |  |
| 176 | #1280 | #1446 | clean | #1285→#1323→#1446 | none (stacked) 3 |  |  |
| 177 | #1280 | #1324 | clean | #1324 | none (stacked) 1 |  |  |
| 178 | #1283 | #1338 | clean | #1283→#1337→#1338 | none (stacked) 2, red 1 |  |  |
| 179 | #1283 | #1348 | clean | #1348 | none (stacked) 1 |  |  |
| 180 | #1283 | #1351 | clean | #1339→#1351 | none (stacked) 2 |  |  |
| 181 | #1284 | #1331 | clean | #1284→#1331 | red 1, none (stacked) 1 |  |  |
| 182 | #1298 | #1319 | clean | #1298→#1319 | green-but-E2E-runner 1, none (stacked) 1 |  |  |
| 183 | #1303 | #1303 | clean | #1303 | green-but-E2E-runner 1 |  |  |
| 184 | #1322 | #1322 | clean | #1322 | green-but-E2E-runner 1 |  |  |
| 185 | #1333 | #1343 | clean | #1333→#1343 | green-but-E2E-runner 1, none (stacked) 1 |  |  |
| 186 | #1336 | #1336 | clean | #1336 | red 1 |  |  |
| 187 | #1345 | #1399 | clean | #1345→#1399 | red 1, none (stacked) 1 |  |  |
| 188 | #1346 | #1346 | clean | #1346 | green-but-E2E-runner 1 |  |  |
| 189 | #1355 | #1355 | clean | #1355 | green-but-E2E-runner 1 |  |  |
| 190 | #1363 | #1363 | clean | #1363 | green-but-E2E-runner 1 |  |  |
| 191 | #1364 | #1364 | clean | #1364 | red 1 |  |  |
| 192 | #1365 | #1365 | clean | #1365 | red 1 |  |  |
| 193 | #1384 | #1384 | clean | #1384 | green-but-E2E-runner 1 |  |  |
| 194 | #1396 | #1421 | CONFLICT | #1396→#1421 | green-but-E2E-runner 1, none (stacked) 1 | #805, #841, #1145 | `pos-hub.service.ts` |
| 195 | #1404 | #1404 | clean | #1404 | red 1 |  |  |
| 196 | #1425 | #1425 | clean | #1425 | green-but-E2E-runner 1 |  |  |
| 197 | #1443 | #1443 | clean | #1443 | none 1 |  |  |
| 198 | #1444 | #1444 | clean | #1444 | none 1 |  |  |
| 199 | #730 | #730 | union-only via `75c5f4557` | #730 | green 1 |  |  |
| 200 | #725 | #725 | CONFLICT via `5613433ad` | #725 | green 1 | #730, #1133, #1164, #1205, #1369, #1382, #1420 | `advanced-analytics.service.ts`, `CocktailRegister.tsx`, `rp-plot.tsx`, `rp-registers-trade.tsx` |
| 201 | #722 | #722 | CONFLICT via `46951dbfe` | #722 | green 1 | #730, #1133, #1164, #1205, #1369, #1382, #1420 | `advanced-analytics.service.ts`, `CocktailRegister.tsx`, `rp-plot.tsx`, `rp-registers-trade.tsx` |


## 5. Re-running

```sh
cd ~/Projects/p4-scratch/sw-walk/r32/merge-readiness
git -C ~/Projects/restaurant-ai-automation fetch origin --prune
gh pr list --repo aldemirkonuk/RestaurantAIAutomation --state open --limit 1000 \
  --json number,headRefName,baseRefName,isDraft,title,headRefOid,createdAt,additions,deletions,changedFiles > prs-all.json
# CI: ci-pages.jsonl is paged GraphQL (40 PRs per page; 100 per page returns 504), then ci-class.json (see the r32 session notes in QUEUE)
bash ~/Projects/p4-scratch/sim-run/heavy.sh python3 tipsim.py --order order.json > tipsim-ordered.txt   # writes tipsim.json
bash ~/Projects/p4-scratch/sim-run/heavy.sh python3 overlap.py > overlap.txt                            # duplicate hunks / shared files
python3 gen_tables.py                                                                                  # tables.md + pr-index.tsv
```

**Files in this directory:**
- `tipsim.py`: the r21 simulator plus three changes: ready parents are computed, a resolution is looked up on the nearest node of the path (`+ext`/`STALE`), and `exclude` is supported.
- `order.json`: the recommended order.
- `order-keep-all.json`: no duplicates closed (62 conflicts).
- `order-alt-newwork-last.json`: the rejected order (62 conflicts).
- `tipsim-close-dups.json` / `tipsim-keep-all.json` / `tipsim-alt-newwork-last.json`: the three runs.
- `superseded-search.txt` / `sup-sentences.txt`: the body search for self-declared supersession.

**What the simulator does not see:**
- **Semantic clashes.** Two clean merges can still break a test. Only the r21/r22 resolution branches were tested, and none was re-tested this round.
- **Migration ordering.** Only the duplicate-version check above was made.
- **CI on stacked PRs.**
- **Commits pushed after about 23:45Z.**
