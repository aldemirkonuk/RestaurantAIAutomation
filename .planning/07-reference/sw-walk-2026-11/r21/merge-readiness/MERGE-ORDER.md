# Merge order for the open PR trains (r21 merge-readiness, 2026-11-13)

Measured, not recalled. `origin/main` = `c459b0a12`. Open PRs: **605** (522 draft, 83 ready),
refreshed with `gh pr list` at the end of the session (27 PRs, #1250-#1276, had appeared since
the first snapshot). Simulated: **111 trains, 152 tips**. Result with the resolutions below:
**80 clean, 14 union-only, 3 already-landed, 55 conflicting**. The input is in `prs-all.json` and
the step-by-step output is in `tipsim.json`; `tipsim-ordered.txt` is the console summary.

**This order goes stale.** Heads move: five of the tips resolved here grew children within
hours, and the branches had to be re-cut. Re-run the simulator before landing anything (see
the last section). `gh`'s `mergeable` field was stale for most stacked PRs and is not used.

## 1. Decisions (the session's calls under the 2026-11-07 /goal)

1. **Land each train tip by tip with "Create a merge commit".** Do not squash.
   - *Rejected: squash per PR.* Squash breaks ancestry, so every stacked child then conflicts
     with content that is already identical on main (the squash trap). It also needs one CI
     run per PR, which is 522 serial runs. Any resolution prepared in advance also dies at the
     first squash.
   - *Rejected: rebase-merge.* It rewrites the SHAs, so it has the same problem.
   - *Fallback, if the ADR 0090 gate insists on squash:* after squashing parent `P` into `S_P`,
     move each child by running `git merge <P_final>`, then `git merge -s ours <S_P>`, then
     `git merge origin/main`. This is valid only when `tree(S_P) == tree(P_final)`, so check
     that first.
2. **Resolutions are pushed branches (`resolve/r21-*`), not PRs.** Each one is far above the
   15-file and 30K cap, because it carries both trains. It is a merge commit that descends from
   the tip it resolves.
   - **Landing recipe.** Fast-forward that tip's head branch to the resolution commit (for
     example `git push origin <resolution-sha>:<head-branch>`). This is a fast-forward, not a
     force-push. Then merge the PR as usual. GitHub marks every PR whose head becomes reachable
     from main as merged.
   - **Replaying a resolution elsewhere.** `contrib/rerere-train.sh <resolution-branch>` teaches
     `git rerere` the hunks, so the same meeting replays wherever it happens again.
3. **Generated and append-only registers are never hand-merged.**
   - `scripts/sql_outside_migrations.txt`: run `python3 scripts/check_migrations_single_home.py --update`,
     then the same script without `--update`. It must print PASS.
   - `.planning/decisions/README.md`, `OPEN-DECISIONS.md` and `CLAIMS.jsonl`: keep both sides.
     CLAIMS lines are compared by `(id, verify)`, per memory `claims-conflict-resolution`.
4. **Merge order does not remove textual conflicts.** They are symmetric. Order decides only
   which side carries the resolution and which semantic rule wins. The default is that the
   older, deeper train lands first and the newer, smaller one adapts.
5. **Money rule used in the reports resolution.** An unknown cost is never summed as $0. The
   cost train's withholding (#1016, where `unread` names the window) beats #843's
   "adds nothing to spend" note (`basis.uncosted`), which is dropped.

## 2. Resolution branches (pushed; all tests named below were run on the final commit)

| Branch | Final SHA | Resolves | Verified |
|---|---|---|---|
| `resolve/r21-reports-trains-meet` | `48ab85144` | **The 11 files between the #1183 train and the #1185 train (#1203).** The cost train is #783→…→#1209, with tips #846 #1016 #1133 #1208 #1145 #1118 #1127 #1130 #857, and it contains #1185, #1200 and #1203. Merged into it are #843→#1183 and #1184, then the new #1258→#1266→#1267→#1276. | gateway tsc clean; jest `src/analytics src/reports src/common` 131 suites / 2143 tests, then `analytics reports` 1364 after #1276; web tsc clean; vitest `src/pages/reports` 14 files / 284 tests. Four mutations, all killed: withholding (3 tests), `.or` delivery selection (1), bench uncosted reason (1), currencyMark (1) |
| `resolve/r21-menu-chains-meet` | `6e2bc4fcf` | **The two menu chains.** One runs #1125→#1220→#1256→#1257 and carries the per-kind wording. The other runs #1102→#1218→#1252→#1253→#1265 and carries kitchen lines, not-on-file, the typed price, and "drinks, not wines". #1053 (the first menu becomes current) is merged in too. | gateway tsc clean; jest `src/menus` 228; web tsc clean; vitest menu/HouseMenu/onboarding 18 files / 249 (+10 skipped). Mutations: kitchen_line key, notOnThisFile sentence, HouseMenu `lines` arg (this one survived until a test was added), kitchen wording. All killed |
| `resolve/r21-cocktail-recipe-meets-inventory` | `79c201e87` | **CocktailRegister.tsx (#1226 vs the recipe chain)** and **RecipeNutrition.test.tsx importing `Recipe` (#1013/#1002 vs #1191).** It is recipe tip #1237 with inventory tip #1238 merged in. | web tsc failed before the fix with `RecipeNutrition.test.tsx(53,13): TS2339 Property 'Recipe' does not exist`; it was clean after. vitest cellar+inventory 51 / 1047. The `?open=` mutation was killed |
| `resolve/r21-nutrition-rules-meet-recipe` | `194193193` | **sql_outside_migrations.txt (#1013 vs the recipe chain).** It is the branch above plus #1013, then the new tips #1262 and #1272, which merged clean. | guard PASS; web tsc clean; vitest inventory+cellar 52 / 1061; gateway tsc clean; jest recipes/inventory/item-nutrition 463 |

How each fork in those branches was decided:

- **Reports.**
  - House-day filing, the zone-unset return, the `.or(created_at, delivered_at)` selection and complete-week Holt come from #843.
  - Whole reads, per-window withholding and the bench's `spendUnread` come from the cost train.
  - `rp-registers-trade` drops `basis.uncosted`.
  - The bench's reason that no bars are drawn now includes the uncosted window, placed ahead of the one-window fallback (#1184's `undrawn`).
  - The sheet context keeps #1258's `placeBlocked` with #1183's `currencyMark` and does not use the raw code.
  - The test fakes gained a PostgREST `or()`.
- **Menu.**
  - #1220's per-kind counts win ("3 lines priced from this menu").
  - The kitchen line takes #1265's words, "on the menu and carried nowhere".
  - A line that is not on the file is a "drink".
  - `HouseMenu` passes the plan's `lines` to `makeCurrentSentence`.
  - #1218's `MenuReviewScreen` deletion stands.
- **Cocktail.**
  - `CocktailRegister.tsx` is taken whole from the recipe side. #1142's body says to keep that stack's sheet, and #1002's inline nutrition passed `nutrition: null` on every line.
  - The RecipeNutrition "cocktail recipe shows it" case is dropped.
  - The CellarNext `?open=` assertion now checks the selected row.
  - `RecipeNutrition.tsx` and `nutrition-sum.ts` have no caller after this. That is noted, not deleted.
- **sql inventory.**
  - The regenerated list is both sides plus `supabase/tests/20270512091500_a_good_says_what_is_in_it_test.sql`.
  - #1013's own tree already **fails** the guard on that file ("1 .sql file(s) appeared outside supabase/migrations"). That is a defect the nutrition train carries on its own.

## 3. What the resolutions do not yet clear (55 conflicting tips, from tipsim.json)

These still need a resolution at landing time. The side that lands second carries it:

- **Menu vs single-PR menu fixes.** #761 (Turkish/EU spreadsheets, `menu-price.ts`) and #773
  (no orphan version) both rewrite `menus.service.ts`, and so does the menu train. #1214
  (first-desk) conflicts only in `menus.service.spec.ts`.
  - **Call:** land #761 and #773 first, because they are small, main-based and older. Then
    resolve the menu train against them by merging `origin/main` into `resolve/r21-menu-chains-meet`.
  - Check whether #1265's `parseMenuPrice` already covers #761's `menu-price.ts`. Both read a
    typed price and never guess. If it does, #761's parser is the one to drop. **Not verified.**
- **Inventory tree #860 (#1233, #1238, #1272) vs the cost train (#858, #1072, #1095, #1130).**
  The files are `InventoryNext.tsx`, `InventorySheets.tsx`, `RowDropdown*`, `iv-url.ts` and
  `useInventoryNextData.ts`. Because of this, `resolve/r21-nutrition-rules-meet-recipe` does
  not land clean after the cost train. It must be re-cut on a main that already holds #783's tree.
- **Inside the recipe tree #863.** #1162 conflicts with #1231, #1232 (now #1250), #1237/#1262 and
  #1251 in `route-access.expected.json`, `recipes.service.ts`, `DrinkCards*`, `RecipeSheet*` and
  `useRecipe.ts`. These are siblings of one train, so the train's author should resolve them.
- **Auth trio.** `AuthContext.tsx` conflicts across #1092, #1168 and #1249, and
  `auth.service.ts` and `route-access.*` across #925, #903 and #972 (vs #788, #760, #1083, #1162).
  This is one meeting, so it needs one resolution.
- **Mail tree #876.** #1212, #1075, #1009 and #1006 conflict with #1032, #791, #797 and others.
  #1006 conflicts with #1032 on `supabase/tests/20270421143700_the_mail_list_is_read_by_person_test.sql`.
- **Stale against main itself** (no other tip is involved): #1124 (train #691),
  #722, #725, #730 (goal producers / sales-gated goals). Each needs `git merge origin/main` on
  its own head.
- **Planning registers that are not in the union set.** `.planning/03-scenarios/DELIVERY-AUDIT.md`
  (#874, #952, #1174, #1182, #897), `0011-pos-sale-volume-contract.md` (#805) and
  `read_error_baseline.json` (#952, #897). For the audit file, keep both sides. For the
  baseline file, regenerate it with its own script.
- **The rest**, one or two files each, are listed in the table: #762 #1078 #778 #821 #801 #809
  #893 #1219 #852 #999 #1232 #1174 #925 #1247 #1189 #1190 #1205 #1172 #1181 #1207 #1246 and others.

## 4. Ready-for-review PRs (83, not simulated except #691 and #958, which drafts stack on)

533 538 539 540 541 542 543 545 547 549 550 551 552 553 554 555 556 558 561 562 564 565 566 569 570
573 574 577 582 583 584 589 594 596 598 615 619 624 629-643 648 650 656 658 663 664 666 668 671 672
678 679 681 682 683 684 686 687 688 689 691 692 693 694 695 696 717 732 745 958.
They are numbered #533-#958, and the oldest draft train starts at #590, so most of them predate
the drafts. Decide on them (merge or close) before the drafts. Each one that lands moves the
simulation, so re-run it after each one.

## 5. Order (train roots in ascending number; within a train, tips in the listed order)

`order.json` holds the overrides: menu `[1257, 1265]`, reports `[1276, 1183]`, recipe `[1262]`,
and the resolution SHAs. A step that says "via `<sha>`" lands the resolution branch, not the
bare head. "PRs it lands" counts the PRs in that tip's path that are not yet on main.

| step | train root | tip | status | PRs it lands | conflicts with (tips landed earlier) | conflicting files |
|---|---|---|---|---|---|---|
| 1 | #590 | #597 | union-only | 2 |  |  |
| 2 | #674 | #687 | union-only | 2 |  |  |
| 3 | #680 | #680 | union-only | 1 |  |  |
| 4 | #691 | #1124 | CONFLICT | 5 | main (train is stale against main) | `Register.tsx`, `authPages.off-fingerprints.json`, `authPages.publicDesign.test.tsx` |
| 5 | #698 | #698 | clean | 1 |  |  |
| 6 | #706 | #706 | clean | 1 |  |  |
| 7 | #722 | #722 | CONFLICT | 1 | main (train is stale against main) | `goals.service.ts`, `sales-gated-goals.ts`, `ceiling-held.producer.spec.ts` |
| 8 | #725 | #725 | CONFLICT | 1 | main (train is stale against main) | `2026-11-01-fix-goal-producers-skip-sales-gated-goals.md`, `sales-gated-goals.ts`, `ceiling-held.producer.spec.ts`, `goal-reached.producer.spec.ts` |
| 9 | #730 | #730 | CONFLICT | 1 | main (train is stale against main) | `2026-11-01-fix-goal-producers-skip-sales-gated-goals.md`, `sales-gated-goals.ts`, `ceiling-held.producer.spec.ts`, `goal-reached.producer.spec.ts` |
| 10 | #731 | #731 | clean | 1 |  |  |
| 11 | #747 | #747 | clean | 1 |  |  |
| 12 | #748 | #748 | clean | 1 |  |  |
| 13 | #754 | #754 | clean | 1 |  |  |
| 14 | #758 | #759 | clean | 2 |  |  |
| 15 | #760 | #760 | clean | 1 |  |  |
| 16 | #761 | #761 | clean | 1 |  |  |
| 17 | #762 | #762 | CONFLICT | 1 | #761 | `menus.service.ts` |
| 18 | #763 | #763 | clean | 1 |  |  |
| 19 | #764 | #764 | clean | 1 |  |  |
| 20 | #770 | #1214 | clean | 6 |  |  |
| 21 | #773 | #773 | clean | 1 |  |  |
| 22 | #774 | #774 | clean | 1 |  |  |
| 23 | #775 | #1076 | clean | 8 |  |  |
| 24 | #775 | #1268 | clean | 2 |  |  |
| 25 | #775 | #1078 | CONFLICT | 1 | #1268 | `CanonicalDocumentPage.test.tsx`, `CanonicalDocumentPage.tsx` |
| 26 | #775 | #1080 | clean | 2 |  |  |
| 27 | #776 | #776 | clean | 1 |  |  |
| 28 | #777 | #1257 via `6e2bc4fcf` | CONFLICT | 23 | #761, #773, #1214 | `menus.service.spec.ts`, `menus.service.ts`, `HouseMenu.tsx`, `MenuVersions.tsx` +1 |
| 29 | #777 | #1265 via `6e2bc4fcf` | CONFLICT | 15 | #761, #773, #1214 | `menus.service.spec.ts`, `menus.service.ts`, `HouseMenu.tsx`, `MenuVersions.tsx` +1 |
| 30 | #777 | #1053 | CONFLICT | 4 | #761, #773, #1214 | `menus.service.spec.ts`, `menus.service.ts`, `HouseMenu.tsx`, `MenuVersions.tsx` +1 |
| 31 | #778 | #778 | CONFLICT | 1 | #761, #773, #1214 | `menus.service.spec.ts` |
| 32 | #779 | #779 | clean | 1 |  |  |
| 33 | #780 | #815 | clean | 3 |  |  |
| 34 | #780 | #828 | already-landed | 1 |  |  |
| 35 | #781 | #1072 | union-only | 10 |  |  |
| 36 | #782 | #782 | clean | 1 |  |  |
| 37 | #783 | #846 | union-only | 3 |  |  |
| 38 | #783 | #1016 | union-only | 3 |  |  |
| 39 | #783 | #1133 | union-only | 16 |  |  |
| 40 | #783 | #1208 | clean | 9 |  |  |
| 41 | #783 | #1209 | clean | 1 |  |  |
| 42 | #783 | #1145 | clean | 1 |  |  |
| 43 | #783 | #1118 | clean | 1 |  |  |
| 44 | #783 | #1119 | already-landed | 1 |  |  |
| 45 | #783 | #1127 | union-only | 3 |  |  |
| 46 | #783 | #1130 | clean | 1 |  |  |
| 47 | #783 | #857 | clean | 1 |  |  |
| 48 | #784 | #784 | clean | 1 |  |  |
| 49 | #785 | #869 | clean | 6 |  |  |
| 50 | #786 | #786 | clean | 1 |  |  |
| 51 | #787 | #821 | CONFLICT | 3 | #1127 | `verify-receipt.spec.ts` |
| 52 | #788 | #788 | union-only | 1 |  |  |
| 53 | #789 | #1083 | clean | 8 |  |  |
| 54 | #790 | #790 | clean | 1 |  |  |
| 55 | #791 | #791 | clean | 1 |  |  |
| 56 | #792 | #792 | clean | 1 |  |  |
| 57 | #795 | #795 | clean | 1 |  |  |
| 58 | #796 | #796 | clean | 1 |  |  |
| 59 | #797 | #797 | clean | 1 |  |  |
| 60 | #798 | #798 | clean | 1 |  |  |
| 61 | #799 | #800 | clean | 2 |  |  |
| 62 | #799 | #1202 | clean | 1 |  |  |
| 63 | #801 | #801 | CONFLICT | 1 | #1072 | `database.service.ts` |
| 64 | #802 | #802 | clean | 1 |  |  |
| 65 | #803 | #803 | clean | 1 |  |  |
| 66 | #804 | #841 | union-only | 9 |  |  |
| 67 | #805 | #805 | CONFLICT | 1 | #841 | `0011-pos-sale-volume-contract.md` |
| 68 | #807 | #808 | clean | 2 |  |  |
| 69 | #807 | #810 | clean | 1 |  |  |
| 70 | #809 | #809 | CONFLICT | 1 | #1072 | `inventory.service.ts` |
| 71 | #811 | #811 | clean | 1 |  |  |
| 72 | #816 | #1254 | clean | 21 |  |  |
| 73 | #816 | #1180 | clean | 1 |  |  |
| 74 | #816 | #893 | CONFLICT | 2 | #1254, #1268 | `delivery-stock.service.ts`, `CanonicalDocumentPage.tsx` |
| 75 | #817 | #819 | clean | 3 |  |  |
| 76 | #822 | #822 | clean | 1 |  |  |
| 77 | #823 | #823 | clean | 1 |  |  |
| 78 | #824 | #825 | clean | 2 |  |  |
| 79 | #826 | #826 | clean | 1 |  |  |
| 80 | #827 | #874 | CONFLICT | 3 | #819 | `DELIVERY-AUDIT.md` |
| 81 | #833 | #1095 | clean | 3 |  |  |
| 82 | #839 | #858 | clean | 2 |  |  |
| 83 | #843 | #1276 via `48ab85144` | union-only | 20 |  |  |
| 84 | #843 | #1183 | already-landed | 1 |  |  |
| 85 | #847 | #1259 | clean | 5 |  |  |
| 86 | #847 | #1261 | clean | 1 |  |  |
| 87 | #848 | #1260 | CONFLICT | 5 | #761, #1214 | `SetupNudgeBanner.tsx`, `HouseMenu.tsx` |
| 88 | #850 | #852 | CONFLICT | 3 | #790, #1118, #1133, #1208, #1209, #1276 | `ReportsNext.test.tsx`, `ReportsNext.tsx`, `Sheet.test.tsx`, `Sheet.tsx` +5 |
| 89 | #853 | #952 | CONFLICT | 6 | #788, #819, #1083 | `DELIVERY-AUDIT.md`, `auth.service.ts`, `read_error_baseline.json` |
| 90 | #855 | #999 | CONFLICT | 6 | #731, #760, #802, #1083 | `sign-in-codes.service.ts`, `App.tsx` |
| 91 | #859 | #859 | union-only | 1 |  |  |
| 92 | #860 | #1233 | CONFLICT | 11 | #858, #1072 | `InventoryNext.test.tsx`, `InventoryNext.tsx`, `InventoryTable.tsx`, `iv-url.ts` +1 |
| 93 | #860 | #1150 | CONFLICT | 18 | #1072, #1095, #1130, #1276 | `InventoryNext.tsx`, `InventorySheets.tsx`, `iv-url.ts` |
| 94 | #860 | #1272 | CONFLICT | 25 | #858, #1072, #1095, #1130, #1276 | `InventoryNext.tsx`, `InventorySheets.tsx`, `RowDropdown.test.tsx`, `RowDropdown.tsx` +1 |
| 95 | #860 | #1015 | CONFLICT | 12 | #1072 | `InventoryNext.tsx`, `iv-url.ts` |
| 96 | #863 | #1262 via `194193193` | CONFLICT | 38 | #858, #1072, #1095, #1130, #1276 | `InventoryNext.tsx`, `InventorySheets.tsx`, `RowDropdown.test.tsx`, `RowDropdown.tsx` +1 |
| 97 | #863 | #1162 | union-only | 26 |  |  |
| 98 | #863 | #1164 | clean | 1 |  |  |
| 99 | #863 | #1250 | CONFLICT | 13 | #687, #760, #1162 | `route-access.expected.json`, `recipes.service.ts`, `DrinkCards.test.tsx`, `DrinkCards.tsx` +3 |
| 100 | #863 | #1231 | CONFLICT | 11 | #687, #760, #1162 | `route-access.expected.json`, `recipes.service.ts`, `DrinkCards.test.tsx`, `DrinkCards.tsx` +3 |
| 101 | #863 | #1251 | CONFLICT | 9 | #687, #760, #1162 | `route-access.expected.json`, `recipes.service.ts`, `DrinkCards.test.tsx`, `DrinkCards.tsx` +2 |
| 102 | #863 | #1174 | CONFLICT | 5 | #819, #858, #1133, #1208, #1276 | `DELIVERY-AUDIT.md`, `advanced-analytics.service.ts`, `analytics.service.ts`, `inventory-cost.ts` +2 |
| 103 | #863 | #1182 | CONFLICT | 6 | #819, #858, #1133, #1208, #1276 | `DELIVERY-AUDIT.md`, `advanced-analytics.service.ts`, `analytics.service.ts`, `inventory-cost.ts` +2 |
| 104 | #863 | #1163 | CONFLICT | 5 | #1133, #1208, #1276 | `advanced-analytics.service.ts`, `analytics.service.ts`, `inventory-cost.ts` |
| 105 | #876 | #1032 | union-only | 22 |  |  |
| 106 | #876 | #1269 | CONFLICT | 24 | #687, #759, #791, #795, #797, #1032 | `inbound-email.controller.ts`, `communications.module.ts`, `house-sender.service.ts`, `MailTab.test.tsx` |
| 107 | #876 | #1270 | CONFLICT | 24 | #687, #759, #791, #795, #797, #1032 | `inbound-email.controller.ts`, `communications.module.ts`, `house-sender.service.ts` |
| 108 | #876 | #1271 | CONFLICT | 16 | #791, #792, #797, #1032 | `EXTERNAL_CONNECTIONS.md`, `inbound-email.controller.ts`, `rabbitmq-bridge.service.ts`, `gmail-watch.service.ts` +2 |
| 109 | #876 | #1001 | CONFLICT | 7 | #797, #1032 | `rabbitmq-bridge.service.ts`, `inbound-headers.spec.ts`, `email_parsing_agent.py` |
| 110 | #876 | #1009 | CONFLICT | 1 | #1032 | `fix-review-communications.jsonl`, `communications.ts`, `CommunicationsNext.test.tsx`, `CommunicationsNext.tsx` |
| 111 | #876 | #1006 | CONFLICT | 1 | #1032 | `20270421143700_the_mail_list_is_read_by_person_test.sql` |
| 112 | #897 | #897 | CONFLICT | 1 | #819 | `DELIVERY-AUDIT.md`, `read_error_baseline.json` |
| 113 | #901 | #901 | clean | 1 |  |  |
| 114 | #902 | #925 | CONFLICT | 2 | #788, #1083 | `auth.service.ts` |
| 115 | #903 | #903 | CONFLICT | 1 | #760, #1162 | `route-access.spec.ts` |
| 116 | #922 | #1013 | clean | 6 |  |  |
| 117 | #929 | #1247 | CONFLICT | 6 | #1072 | `low-stock-digest.template.ts`, `dashboard.service.ts`, `low-stock-alerts.service.ts` |
| 118 | #958 | #972 | CONFLICT | 15 | #687, #760, #1162 | `route-access.expected.json`, `route-access.spec.ts` |
| 119 | #1092 | #1092 | CONFLICT | 1 | #1083, #1162 | `AuthContext.tsx` |
| 120 | #1096 | #1155 | clean | 4 |  |  |
| 121 | #1123 | #1189 | CONFLICT | 3 | #1072 | `supabase.ts`, `WineRegister.test.tsx` |
| 122 | #1129 | #1129 | clean | 1 |  |  |
| 123 | #1134 | #1190 | CONFLICT | 4 | #825 | `NotifySection.tsx`, `SettingsNext.test.tsx` |
| 124 | #1134 | #1138 | CONFLICT | 3 | #825, #1133, #1208, #1276 | `analytics.service.ts`, `NotifySection.tsx`, `SettingsNext.test.tsx` |
| 125 | #1136 | #1168 | CONFLICT | 3 | #1083, #1162 | `AuthContext.tsx` |
| 126 | #1143 | #1143 | clean | 1 |  |  |
| 127 | #1153 | #1154 | clean | 2 |  |  |
| 128 | #1156 | #1205 | CONFLICT | 2 | #1208, #1276 | `rp-plot.tsx`, `rp-registers-trade.tsx` |
| 129 | #1157 | #1157 | clean | 1 |  |  |
| 130 | #1158 | #1170 | clean | 2 |  |  |
| 131 | #1159 | #1172 | CONFLICT | 2 | #869 | `vendor-site-writer.spec.ts` |
| 132 | #1161 | #1161 | clean | 1 |  |  |
| 133 | #1169 | #1169 | clean | 1 |  |  |
| 134 | #1171 | #1171 | clean | 1 |  |  |
| 135 | #1175 | #1181 | CONFLICT | 3 | #1072 | `dashboard.service.ts` |
| 136 | #1177 | #1177 | clean | 1 |  |  |
| 137 | #1188 | #1188 | clean | 1 |  |  |
| 138 | #1192 | #1192 | clean | 1 |  |  |
| 139 | #1193 | #1193 | clean | 1 |  |  |
| 140 | #1194 | #1207 | CONFLICT | 4 | #1127, #1276 | `verify-receipt.spec.ts` |
| 141 | #1194 | #1275 | CONFLICT | 2 | #1127, #1276 | `verify-receipt.spec.ts` |
| 142 | #1195 | #1274 | clean | 4 |  |  |
| 143 | #1201 | #1201 | clean | 1 |  |  |
| 144 | #1210 | #1210 | clean | 1 |  |  |
| 145 | #1235 | #1235 | clean | 1 |  |  |
| 146 | #1236 | #1236 | clean | 1 |  |  |
| 147 | #1239 | #1246 | CONFLICT | 3 | #731, #760, #802, #1235 | `App.tsx`, `index.ts`, `ToastContext.tsx`, `vite.config.ts` |
| 148 | #1240 | #1240 | clean | 1 |  |  |
| 149 | #1242 | #1249 | CONFLICT | 4 | #1083, #1162 | `AuthContext.tsx` |
| 150 | #1248 | #1248 | clean | 1 |  |  |
| 151 | #1263 | #1264 | CONFLICT | 2 | #841, #1072, #1095 | `0011-pos-sale-volume-contract.md`, `inventory.service.ts` |
| 152 | #1273 | #1273 | clean | 1 |  |  |

## 6. Re-running

```sh
cd ~/Projects/p4-scratch/sw-walk/r21/merge-readiness
gh pr list --repo aldemirkonuk/RestaurantAIAutomation --state open --limit 1000 \
  --json number,headRefName,baseRefName,isDraft,title,headRefOid,createdAt > prs-all.json
git -C ~/Projects/restaurant-ai-automation fetch origin
python3 tipsim.py --order order.json > tipsim-ordered.txt   # writes tipsim.json
```

How the simulator works:

- Each tip lands as `git merge-tree --write-tree <sim-main> <head or resolution>` followed by `commit-tree` with two parents. No worktree is touched.
- The four registers are union-merged.
- A tip whose head is already reachable from the simulated main reports `already-landed`.
- A conflicting tip does not land. Its siblings still try.

When a resolved tip grows a child (as #1184, #1218, #1220 and #1237 did this session), the
resolution must be extended by merging the new tip into it, and `order.json` must be keyed to
the new tip.
