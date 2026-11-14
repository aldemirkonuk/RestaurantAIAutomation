# Merge order for the open PR trains (r33 merge-hygiene, 2026-11-13)

Supersedes r32's `MERGE-ORDER.md` counts. Generated tables: `tables.md`, `pr-index.tsv` (from `gen_tables.py`); raw run: `tipsim-final.txt`, `tipsim.json`.

## Founder summary

- **Measured:** `origin/main` = `c459b0a12`; 819 open PRs (`prs-all.json`, refreshed this session; new #1485-#1490; heads moved on #1433 #1420 #1405 #1404 #809). 134 trains, 209 tips, `exclude [1162, 850]`.
- **Result:** 133 tips clean, 18 union-only, 6 already landed, **52 conflict** (r32: 60; r33 start: 63 after new PRs; mid-runs 53 → 54 → 52).
- **Landed by r33 resolutions:** #1183/#1276 (cost meet), #1464, #1456 (staff chain), #1310/#1076 door, the menu train (#1257/#1265/#1053/#1379), #1362, the inventory/auth/census re-cuts.
- **Exposed by more landing (new on the list, not regressions of a resolution):** #1205 (train #1156: `rp-plot.tsx`, `rp-registers-trade.tsx` vs #1183/#1369/#1456/#1464/#1466) and #730 (`advanced-analytics.service.ts` vs #1133/#1183/#1369/#1456/#1488). Both were clean only because the cost tips used to fail.
- **#903 / #972:** the census half is resolved without #1162; they still conflict, now only in `InventoryNext.test.tsx` against #1072/#1484 (the cellar/inventory meet, open since r22).
- **No PR was retargeted, marked ready, closed or merged.** Two PR heads were pushed (task-directed): #809 and #1404.

## 1. Decisions (the session's calls under the 2026-11-07 /goal)

1. **#809 migration version:** renamed to `20271113190000` (past main and every open PR). Rejected: renumbering #789 instead (#789 keeps the older stamp it shipped with in r32's call). #809 head `a125d8fe6`; #1263/#1264 get it only by ancestry.
2. **#1404 CLAIMS status:** `DESIGN-FLAG-READ-FAILURE-IS-NOT-CACHED-AS-OFF` set to `resolved`, because it verifies. Head `8658102a8`.
3. **Stale r22 resolutions re-cut as new branches (old ones untouched):** menu `5c7a45071`, inventory `bedb72845` (+#1412) and `f1336ca2d` (+#1407/#1411), auth `8e17be1fd` (+#1292), census `3946e6ca2` (#903 without #1162) and `77327e693` (#972 without #1162: 297 rows, the 11 DishesController rows, ADR-0164 count amended).
4. **Cost meet (#1369/#1382 vs the reports train), r32's call kept: re-cut 48ab85144 on the #783 tips.** In `getCashflow`, r21's frame stays (house zone, 182-day read, complete weeks, `zoneUnset`), and #1369's money goes inside it. Each order is costed through `orderHouseCostOrNull`; an order in another currency is counted per code and never summed; last30/prev30/holt are withheld when any other money is present. **Invariant kept: an unknown cost is never summed as 0.** New test `uncostedOrders.last30d == 0` (2 mutations killed). Rejected: taking #1369's whole function, which drops r21's zone and complete-week rules; taking r21's, which sums other-currency spend.
5. **Cost meet on the staff chain (`b7c765372`).**
   - The export bench keeps `readBench`, which reads cashflow, seasonality and active goals directly (audit G9) and passes the sales gate. Rejected: #1456's `getOverview` with role classes, because the export is owner/manager only and the overview runs eight lenses to return three.
   - The page bench keeps its three sources and gains `readers: ['owner','manager']`.
   - A composed register is now withheld when **any** source answers withheld, instead of being read as empty. New test; mutation killed. Rejected: checking single-path registers only, which would read a withheld cashflow as "no spend".
   - The till keeps `null` for an unread day and gains `salesWithheld`.
6. **#1464 on the meet (`f0b6a30f4`):** union. #1464's per-day `checks` and `combo` graph are kept alongside `salesWithheld` and `readers`. The withheld early return runs before `tillMeasures`.
7. **Door (#1076 vs #1431/#1367/#1427), `f155e74f1`.** The conflict starts at #1310. `houseIdsFor` runs first and `ids.orderId` is passed to `paperForTheDoor`. The delivery takes `orderId: paper ? paper.orderId : ids.orderId`. New test: a foreign orderId on a paper with no links gives `orderId: null` and `linkRefused` (mutation killed). Rejected: trusting the paper's orderId unchecked. #1431/#1367/#1427/#1485 extend clean.
8. **Menu (#1418/#1413 vs the menu train), `513b855b4`.** #1265's `parseMenuPrice` does **not** fully cover #761/#1418's reading:
   - Measured on 14 inputs, `readMenuPrice("-45")` returns 45 and drops the minus; `parseMenuPrice` refuses -45, 45.5555 and "45 lira".
   - Call: `correctItem` keeps `parseMenuPrice`. `readMenuPrice` stays only in `csv-parser`. The reply carries both `warnings` and `notes`.
   - #773: `resolveLibrary` runs before the version write, and the kitchen flag is carried on `ResolvedItem`.
   - The HouseMenu lock test now reads the house currency. This fixes a failure that also exists on #1422's own head.
9. **Staff (#1362 + #1369, `bb55388db`; #1456, `3b4b16d11`; #783 tips, `a5e504bd4`).** The till checks `salesWithheld` before it formats money. The overview keeps #1456's role holds and #1488's goal units.

## 2. The 52 conflicts, by train

See `tipsim-final.txt` for files and the tips each one meets. Grouped:

- Reports/cost knock-ons: #1205 (#1156), #730, #725, #722, #1138 (#1134), the #863 group (#1163 #1174 #1182 #1357 #1378 #1463 #1482), #1150 #1015 #1391 #1407 #1411 (#860).
- Menu: #762, #778, #1469 (#848), #1465 (#847), #1486/#1487 (#777, r31 fixes in flight).
- Mail #876: #1467 #1293 #1330 #1374 #1001 #1009 #1006.
- Inventory/cellar #1072 meet: #809, #903, #972, #1264 (#1263), #1428/#1078 (#775).
- Team/register: #874, #952, #897, #901, #925.
- Other: #1315 (#691), #821 (#787), #801, #1409/#1490 (#816), #1247 (#929), #1189 (#1123), #1360 (#1175), #1207/#1275 (#1194), #1483 (#1396).

## 3. Findings

- `readMenuPrice` drops a leading minus (`"-45"` becomes 45), on #761's line.
- The following were already failing at the head the tests ran on (not caused by r33):
  - `price-base-round-trip` ("credit balance is too low") on 48ab85144.
  - `report-cutting-reader.spec.ts`, 2 cases (restock; till-read routes, where staff `getFinancial` returns no args) on #1456's head.
  - `crawl-surface` on ce2c632c2.
  - The cellar claims on BELOW-PAR/#1072.
- Gateway `tsc` on the census branch shows 7 `@wineops/floor-core` TS2307 errors. The workspace package is not linked in the shared node_modules (environmental).

## 4. Not done

- No resolutions for: #1205, #730, #725/#722, #1138, the #863 group, #1150/#1015/#1407/#1411 on the new meet, the #1072 inventory meet, mail #876.
- The r31 in-flight menu fixes #1486/#1487 conflict with the menu meet. Re-cut them after they settle.
- CI was not re-classified this round (`ci-class.json` is r32's).

## 5. Re-running

`cd r33/merge-readiness && bash ~/Projects/p4-scratch/sim-run/heavy.sh python3 tipsim.py --order order.json > tipsim-final.txt && python3 gen_tables.py`
