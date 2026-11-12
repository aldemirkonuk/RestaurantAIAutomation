# QA round 18: inventory item drawer stack #896 / #898 / #899 / #900

Date 2026-11-07. Heads: #896 `3362d8496`, #898 `4fd9c5582`, #899 `d7944492f`, #900 `2ad20b511` (stack head; gateway code identical to R14's `b3723e2ab`). Worktrees `/private/tmp/claude-501/qa-wt-r18-{11,12,13,14}` (removed). Probes, outputs and the mutation script: `sw-walk/qa-report/round18-probes-inventory/` (`lib.mjs`/`pgsupa.mjs` point at the removed `qa-wt-r18-14`; recreate it to re-run the SQL ones). Prior: round14-test-inventory-features.md (server side, still true at this head).

## How it was tested
- Each PR's own suites at its own head: `src/pages/inventory/next` 281 / 283 / 287 / 294 tests, all pass.
- 3 jsdom probe files against the REAL components (ItemDrawer, ItemCards, ItemUsedIn, InventoryNext, RowDropdown, Sheet): 81 printed probe lines (`r18-drawer.out.txt`, `r18-page.out.txt`).
- PGlite with all migrations: re-ran R14's used-in probe at this head (`p1-used-in.out.txt`) and a new low-stock probe (`p2-lowstock.out.txt`).
- 28 one-at-a-time mutations of the PRs' own code, each PR's own specs re-run (`mutate.py`, `mutations.out.json`).
- NOT done: any real-browser run. The Browser pane cannot run a worktree page without writing into the shared checkout, so 375px layout, RTL and real 5k-row timing are read from CSS/code or measured in jsdom only (relative numbers).

## Verdicts

| PR | Verdict | One line |
|---|---|---|
| #896 drawer + 8 cards (not mounted) | **WORKS as scoped, PARTIAL against the ask** | Cards honest: a failed read says "could not be read" (never 0), staff see no currency and no Value card. The 8th card ("What's in it") is an inert div, so KPI -> nutrition does not exist |
| #898 row opens drawer, Back closes | **WORKS** | Row click pushes one history entry, Back closes, deep link closes in place, unknown id says "not on the list", a refetch updates the cards in place, focus goes in and comes back. The Close path is untested (2 mutants survive) |
| #899 "Used in" | **PARTIAL** | Renders the three groups and prints a failed group as failed, but it says "Not on the menu or in a recipe yet" for every food and for any house with no current menu |
| #900 carry a food + kind filter | **PARTIAL** | Carry and the Food/Supplies chips work, but the page then sums grams into "bottles", the table shows foods without units, the low-stock alerts never see them, and the filter works on a list capped at 1,000 |

Tests fail without the code: yes for the main guards, no for 13 of 28 mutants (table below).

## Findings (file:line at the stack head)

### BUG
1. **#899 false "Not on the menu or in a recipe yet".** `ItemUsedIn.tsx:221` returns null for a readable-but-empty group, so the server's `source` sentence is never drawn; `:281-285` then prints the none-line when all three are empty. Probe U1: a house with only a draft menu (server says "This house has no current menu...") reads "Not on the menu or in a recipe yet" - the exact false statement the #860 audit fixed on the server (`f0ea782f4`, which is not in this stack either). Probe U2: any food reads "Not on the menu or in a recipe yet. Recipes are not recorded yet..." in one block (`:198`, `:316`). Absence reported as health. Mutant 899-c (failed group counted as empty) survives.
2. **#900 the read sentence adds grams to bottles.** `useInventoryNextData.ts:512-525` sums `stock` over every row as "bottles". Probe P1: one wine of 10 plus 12,400 g flour reads "2 titles, 12,410 bottles across 1 zone." The table has the same blindness (probe P2 food row): Type "not recorded" (`InventoryTable.tsx:218`), "12,400 / 0 · 5,000" with no unit (`:233-240`) while the drawer says "12.4 kg", Vel/day "2500.0", Your price "—". "Fastest moving" sort puts 2,500 g/day above 3 bottles/day (`sortRows` pace, `:318-325`, probe P3).
3. **Foods and carried non-library drinks never reach a low-stock alert.** `v_low_stock_items` still INNER JOINs `master_wine_library` (baseline migration `:6004-6049`) and is what the alert emails (`low-stock-alerts.service.ts:1176,1261`), the dashboard (`dashboard.service.ts:1181,1420`) and `getLowStockItems` read. PGlite (`p2-lowstock.out.txt`): flour par 500 / stock 0, "House lager keg" par 2000 / stock 0 and a library beer 2/10 all satisfy `stock_live < threshold_min`; the view returns ONLY the library beer. The /inventory page (below par chip, drawer) says flour is out; the alert and the dashboard stay silent. #873 does not change the view.
4. **Kind filter on a capped list.** `database.service.ts:43-53` has no range; 5,001 goods return 1,000 (reproduced, `p4-list.mjs`), unordered. The chips, the Food filter and the footer ("All 1,000 of 1,000 titles are listed") run on that. At 5k goods `?kind=food` can show some foods or none. The fix is #874 (not in the stack).
5. **Evidence panel is wine-shaped for a food.** Opening a card shows the old RowDropdown (`ItemDrawer.tsx:611`). Probe E1 on 12,400 g flour: "Format 750ml" (invented by the list API, `RowDropdown.tsx:283`), "How fast it pours / About 2500.0 a day", "Weighted average cost EUR 0.00" (per gram, rounded), "Live 12,400" with no unit. The same food reads "EUR 4 a kg" on the Cost card.
6. **#899 duplicate React key.** `ItemUsedIn.tsx:294` keys a cocktail line by id+quantity+unit; the server returns 41 lines for 40 cocktails when one uses the item twice (R14 S1), so two lines share a key (probe U3 logged the React duplicate-key error). No count of uses is shown, and no line is a link, so "click -> used in which items" ends at plain text.
7. **#900 / #899: carry has no role check.** The Carry button is hidden for staff (probe P11), but `item-detail.controller.ts:84-98` has no role gate, so a waiter can POST `/house-items` (R14 C: any member). `used-in` returns bottle and glass prices to every member; only the UI hides them (probe U7).

### MISSING for the founder's ask
- Nutrition card with data: `ItemCards.tsx:310-315` draws "Not recorded" in a non-button (`Card` without `onOpen`, `:148`). No KPI leads anywhere near it. Grep for nutrition/kcal/allergen finds only that string and two unrelated specs. No table or column exists.
- Used in for foods: the service reads menu lines and cocktails only (`recipes: {recorded:false}`); the recipe tables from #863/#864/#867 are not read. A food is "used in" nothing.
- List-level KPI cards: none, by design (`InventoryNext.tsx:11` "No KPI tiles"). The eight cards are per item.

### COSMETIC / LOW
- `ItemCards.tsx:81` "EUR 0.02 a item"; unknown unit "2 unit" (no plural, probe D3).
- Cocktail quantity printed raw: "0.30000000000000004", "29.5735295625 oz" (`ItemUsedIn.tsx:296`).
- A fraction under 0.05 reads "0 bottles" next to "worth EUR 1.60" (`fmtCount` one digit, probe D5).
- Minus signs differ: "-1 g" with the real minus and "-EUR 40" with a hyphen (`ItemCards.tsx:96` vs money).
- Usage 0 reads "0 bottles" and Days of cover "Not enough history" (should be none sold); "Usage a day 20.0" next to On hand "400".
- Cost card says "No cost yet" when the cost could not be read (unread and none are the same), probe D4.
- `aria-controls="ivd-evidence"` points at an id that does not exist until opened; the row button says `aria-expanded` but opens a dialog (no `aria-haspopup`).
- Turkish: search folds correctly (IRMIK, İZMİR, ŞARAP, ILIK all match, probe P7). Name sort uses `localeCompare` with no locale (`useInventoryNextData.ts:290,320`): under en-US it reads "İnek, Irmik, İzmir köfte, ırmık"; Turkish order is "ırmık, Irmik, İnek, İzmir". It follows the device.
- No RTL anywhere in the app; `item-drawer.css:51` `text-align:left`, `:100` `padding-left`. 375px: from the CSS the drawer is full screen under 768px with one card column (`item-drawer.css:636-670`); not seen in a browser.
- 5,000 goods: every row is in the DOM, no paging or virtualization (probe P6: 5,000 `tr`). jsdom, relative only: first render 3.4-5.7 s, a kind chip click 1.6-2.2 s, a search 0.25 s.
- `data.canManage` role words: "Counted and received stock on the shelf, from the stock ledger", "Evidence and actions", "A good the library does not hold", "whole small units" (400 reply) are office words for a chef.

## Scenarios (chef / owner / waiter)

| Scenario | Result |
|---|---|
| Tenant isolation, used-in | HOLDS: another house's item 404; a corrupt link in another house's menu and its cocktails do not leak (R14 S6 re-run at this head) |
| Waiter | No currency anywhere in the drawer incl. used-in prices, no Value card, Cost "Not shown" (D7, U7). Server figures money-gated. Carry button hidden but not enforced (7) |
| Used by 0 | "Not on the menu or in a recipe yet" (see 1) |
| Used by 1 / 40 / 300 | 300 plain rows, 302 with a double use, no count, no scroll cap; 3,000 house cocktails make the cocktail group "could not be read" (R14 S12, loud) |
| Archived / deleted recipe | Menus not active, discarded lines and deleted cocktails excluded (server). Dish recipes are not read at all |
| Sub-recipe chains / cycles | Not applicable: no recipe link exists in the used-in read |
| Wine vs food vs supply | Cards in kg / l / count for g / ml / each work (probe D1). With house fields missing a food falls back to "12,400 bottles" (D2) |
| Beer / food low stock | Page: yes (below-par chip, drawer). Alerts and dashboard: library beer yes, food no, carried drink no (3) |
| Kind + search + sort | Kind in URL (`?kind=`), junk kind ignored, chips hidden for a drinks-only house, no counts on chips, search + kind compose (P4/P5/P6) |
| Back / deep link / refresh | Row open: Back closes. `?open=` deep link: Close stays on page, Back leaves it. `?open=<unknown>`: "not on the list". `?highlight=<wine id>` opens the row. Refresh keeps the drawer (P8) |
| Drawer while data refetches | New stock shows in place; row removed -> "not on the list"; list read failing keeps the drawer on the earlier rows (P9) |
| Eight cards, missing data | on hand / value / usage / cover / waste / gap say "could not be read"; none shows 0 for a failed read; used-in failure says so with "Read again" and no 0 (D4, U5). DB text never reaches the person (500 -> "the server failed before it could answer") |
| Keyboard / focus / aria | role=dialog, aria-modal, labelled; focus lands on Close; Tab stays inside; Escape closes; focus returns to the row button (D8, F1) |

## Does a test fail without the code? (28 mutants)

CAUGHT 15, SURVIVES 13.

| PR | Mutant | Result |
|---|---|---|
| #896 | staff sees Cost / Value card | CAUGHT (2) |
| #896 | failed waste read drawn as a figure | CAUGHT |
| #896 | failed count-gap read drawn as "Never counted" | SURVIVES |
| #896 | on hand null drawn as 0 | SURVIVES (at head too) |
| #896 | kg conversion removed | SURVIVES in #896, CAUGHT at the #900 head |
| #896 | bottle words for a food (house kind check) | SURVIVES (equivalent: the unit check covers it) |
| #896 | figures read for an id not on the list | CAUGHT |
| #898 | row open replaces history | CAUGHT |
| #898 | Close always `navigate(-1)` / never pops history | SURVIVES both (Close is untested) |
| #898 | drawer `key` removed | SURVIVES |
| #898 | no-trend sentence reverts to "not enough receipts" | CAUGHT |
| #899 | failed group omitted / staff sees menu prices / unlinked note dropped / read for unknown id | CAUGHT (4) |
| #899 | none-line ignores a failed group | SURVIVES |
| #899 | failed used-in read swallowed in the drawer | SURVIVES |
| #900 | kind filter removed / chips for a drinks-only house / 409 text / name trim / default unit | CAUGHT (5) |
| #900 | supply counted as drink | SURVIVES |
| #900 | Carry button shown to staff | SURVIVES |
| #900 | par accepts decimals and negatives | SURVIVES |
| #900 | junk `?kind=` accepted | SURVIVES |

## Founder asks

| Ask | Status |
|---|---|
| Better inventory UI with all goods incl. foods | PARTIAL: carry a food, kind chips, a drawer in kg; list totals, columns, evidence panel and sort still treat a food as a bottle; list capped at 1,000 |
| Click -> used in which items | PARTIAL: row opens the drawer; "Used in" lists menu lines and house cocktails, plain text, no links, no count; foods and recipes: nothing, said wrongly (1) |
| KPI cards | PARTIAL: eight per-item cards; no list-level cards |
| KPI -> nutrition card | MISSING: the card is inert and has no data |
| Low-stock for beer / food | PARTIAL: library beer yes; food and non-library drinks no (3) |

## Counts
Own suites 4 stacks x all pass; probe lines 81; BUG 7 (1 false empty, 2 mixed units, 3 low stock, 4 cap, 5 evidence, 6 key, 7 role), MISSING 3, COSMETIC 11; mutants 28 (15 caught, 13 survive); REGRESSION none found.
