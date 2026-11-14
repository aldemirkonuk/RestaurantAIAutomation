# Merge order for the open PR trains (r37 merge-hygiene, 2026-11-13/14)

Supersedes r33's `MERGE-ORDER.md`. Generated tables: `tables.md`, `pr-index.tsv` (from `gen_tables.py`). Raw run: `tipsim-final.txt` and `tipsim.json` (pre-run: `tipsim-pre.txt`). The order lives in `order.json`; r33's copy is kept in `order-r33.json`.

## Founder summary

- **Measured:** `origin/main` = `c459b0a12`. `prs-now.json` holds the open PRs; new since r33 are #1572–#1608, and the heads of #1498, #1520 and #1546 moved. 140 trains, 235 tips, `exclude [1162, 850]`.
- **Result:** 142 tips clean, 21 union-only, 14 already landed, **58 conflict**. At r37 start there were 74 conflicts after the new PRs. r33 had 52 conflicts on 209 tips.
- **Children brought up to their parents:** 205 ordinary merge commits on 179 distinct children, all pushed (`upmerges.tsv`). No force-push or rebase, and no PR was retargeted, closed, marked ready or merged.
- **Every named conflict has a meet branch, and tests were run on each:**
  - recipe #1386
  - menu #1469 / #1418 / #761 and the r31 fixes
  - door #1431 vs #1366 (repairPrintedCost)
  - reports #1567 / #1509
  - units #1289
  - #1436 vs #1439 (on #783 and #843): resolved by the reports meets #1567/#1509, and both tips (#1456, #1567) now land
- **Fixed by r37 (were conflicts, now land):** #1231, #1381, #1409, #1486, #1504, #1509, #1514, #1543, #1550, #1552, #1553, #1560, #1561, #1564, #1566, #1567, #1569.
- **Three up-merges need a person**, because each needs a judgement on an old PR (section 4).

## 1. Decisions (the session's calls under the 2026-11-07 /goal)

1. **Up-merge method: merge the parent into the child, then push.** This adds a commit and rewrites nothing. Rejected:
   - rebasing, which needs a force-push and breaks walkers' local branches;
   - retargeting to main, which drops the parent's diff from review.
2. **#922's goods chain (item_nutrition) goes before the recipe train.** In `order.json`, #922 moved to index 67, ahead of #860 (68) and #863 (69). The reason is that the recipe train reads `item_nutrition`. Rejected: leaving #922 after #863, which lands recipe readers on a table that is not there yet.
3. **Menu meet (`resolve/r37-menu-meet-all` = `166c2392a`, built on r33's `513b855b4`):**
   - **#1487:** `assertReadFinished` runs before `computePlan`. The plan wording is the chain's ("change the price of 1 wine the house already has and leave 1 wine at its locked price"). Both test sets are kept.
   - **#1497:** both choice places say `makeCurrentSentence + takenOffSentence`.
   - **#1543:** the held note rides on `ResolvedItem.heldNote` and reaches both the stored row and the reply.
   - **#1486 (taking back a failed import):**
     - A library failure is wrapped by `resolveOrKeepNothing` and says "Nothing was kept; import the menu again".
     - A failed line write runs `persistOrDropVersion`, which deletes the draft only and never a current version.
     - Rejected: #1486's whole-version take-back, because on the chain the library is read before the version exists, so there is nothing to take back.
   - **#1511:** the chain's line wording is kept, and a zero now reads "none priced from this menu", not "0 wines".
   - **#1530:** `standingSecond(data, nameOf)`.
   - **#1566:**
     - The chain's redraw is kept.
     - A new `scanPayload` sends every file through `fittedPhotoRefusal` after the redraw, or after its raw-bytes fallback.
     - The pick check is `menuFileRefusal ?? pickedSizeRefusal`.
     - Rejected: #1566's `fitPhotoForReading`. It duplicates the redraw and now has no caller (follow-up F3).
   - **#1552:** scan-parser keeps `MENU_READER_OFF` and the seam de-duplication.
4. **Door meet (`resolve/r37-door-1431-meet` = `1c00f3cf9`, on r33's `f155e74f1`, plus 12 PRs: #1528 #1508 #1367 #1427 #1501 #1473 #1550 #1180 #1409 #1569 #1560 #1489):**
   - **`repairPrintedCost`:**
     - The order is to read the stated unit (#1550), then the door pack, then the fix (`price ?? lineOnly`).
     - The flagged path skips.
     - A change is recorded only when `fix.unitCost !== booked`, and a dry run records without posting.
     - The invariant held is that **a dry run never posts, and an equal cost never records a change.** Mutations were killed on both lines.
     - Rejected: #1431's line-only fix, which ignores #1550's stated unit and books a per-case price as per-bottle.
   - **`delivery.service`:** the return carries `cost`, `costNote` and `repair` together.
   - **`CanonicalDocumentPage`:** the union of all state hooks.
5. **Units meet (`resolve/r37-units-1289-on-door-meet` = `52856a280`):**
   - `canonical-format.ts` keeps its local read-unit words (kg, g, lb, oz, gal, fl oz) and falls back to the shared `unitWord`.
   - Rejected: replacing them with the shared table, which lacks the US units and would print "gal".
   - New test; mutation killed.
6. **Recipe meet (`resolve/r37-recipe-1386-on-1545` = `9d992e530`):** `731e901f8` with #1545 added.
7. **House #1469 (`b3b0dd9e9`) and reports #1567 (`c6544b012`) / #1509 (`27733c577`):** union meets. Their mutations and tests are recorded in `upmerges.txt`.
8. **#1162 ← #1160 was not up-merged, though the merge is clean,** because #1162 stays in `exclude` as the duplicate to close. Rejected: merging, which would keep a PR alive that the order already drops.

## 2. Meet branches (keyed in `order.json` `resolve`)

| PR(s) | branch | sha |
|---|---|---|
| 1160 (recipe #1386) | resolve/r37-recipe-1386-on-1160 | 731e901f8 |
| 1545 | resolve/r37-recipe-1386-on-1545 | 9d992e530 |
| 1469 | resolve/r37-house-1469-on-menu | b3b0dd9e9 |
| 1567 / 1509 | resolve/r37-reports-1567-on-r33-meet / resolve/r37-reports-1509-on-1567-meet | c6544b012 / 27733c577 |
| 1479, 1552 | resolve/r37-menu-meet-all | 166c2392a (steps: -on-1479 8b5d57bc9, -on-1561 e1826ef0b) |
| 1549, 1388 | resolve/r37-door-1431-meet | 1c00f3cf9 |
| 1289 | resolve/r37-units-1289-on-door-meet | 52856a280 |

## 3. The 58 remaining conflicts (see `tipsim-final.txt` for files and the tips each one meets)

- **Recipe train #863, internal to the train and not among the named pairs:**
  - #1545 meets #1504/#1514/#1564 in `useRecipe.ts`. It was clean before only because it landed first.
  - #1512 meets #1504 in `DishesPage.tsx`.
  - #1537, #1556, #1563 and #1503 meet in `inventory-cost.ts` and `dishes-recipe.spec.ts`.
  - #1163, #1174, #1182, #1357 and #1378 meet the reports/cost knock-ons.
- **Inventory #860:** #1510 #1493 #1568 #1571 #1391, and #903 #972 #1546 #1264 #809 #801.
- **Menu:** #762 (against #1418), #778, #1535.
- **Mail #876:** #1542 #1547 #1531 #1533 #1330 #1521 #1559 #1001 #1009 #1006.
- **Reports/analytics:** #730 #725 #722 #1538 #1570 #1138 #1205 #1540.
- **DELIVERY-AUDIT.md / read_error_baseline only:** #874 #952 #897 #901 #925. Each is a mechanical union against #1359.
- **Other:** #1315 vs #1124 (auth), #1502 #1078 vs #1489 (door frame), #821 #1207 #1275 (verify-receipt), #1247 #1360 (digest), #1189, #1544.

## 4. Up-merges that need a real decision

All three are old non-draft PRs whose parents moved on. Each conflict is in substance, not just in docs.

| child ← parent | behind | conflicting files |
|---|---|---|
| #541 ← #538 | 47 | ADR 0244, procurement.controller/service, order-patch spec |
| #583 ← #582 | 28 | mobile-feed-money-for-staff spec, claims, tech-debt |
| #624 ← #619 | 26 | ADR 0299, analytics.service.ts, rp-registers-house.tsx |

The call to make on each: rebuild the child on its parent's current design, or close it as superseded. Nothing was pushed to any of the three.

## 5. Known failures that are not caused by r37 (each bisected)

- **web `mudavym-ground`** (HouseMenu `first-proof-plan` root, from #1053) fails on r33's `513b855b4` too.
- **The OD-112 ink-3 check** fails at `house-shell.css:190`, which comes from #1491 (`e28501e7a`).
- **invoiceMatch parity** fails 8 of 32. The first failing commit is the merge of #1427: it changed the API invoice-match and not the web mirror.
- **CLAIMS `ADR-0164-ROLES-EXACT-MANAGERS-KEPT`:** the fixture has 214 rows and the pin is 212. #1545's own head already has 214.

## 6. Follow-ups (not done here)

- **F1:** the `agreedPrices` stated-unit read (`delivery-stock.service.ts:1413`, #1550) has no test. A mutation of it survives.
- **F2:** the recipe-train sibling conflicts in section 3 need one recipe meet that lands #1504/#1514/#1564 with #1545.
- **F3:** dead code on the menu meet:
  - `fitPhotoForReading` has no caller.
  - the `menu-add-unpriced` span is dead.
  - the `RecipeNutrition` component is unused on the recipe meet.
- **F4:** walkers with local copies of an up-merged branch must `git pull` (merge, never rebase) before pushing, or their push is refused.
- **F5:** r38 builders opened #1580+ while r37 ran. Those PRs are not in this run's `order.json`.
