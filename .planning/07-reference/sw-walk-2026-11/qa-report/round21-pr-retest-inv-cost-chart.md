# Round 21 — adversarial re-test: inventory low-stock / units / cost / charts

Date 2026-11-07. PRs #929 #930 #934 #933 #932 #935 #936 (all draft). Method: `gh pr view/diff` read-only; detached worktrees `/private/tmp/claude-501/qa-wt-r21-1..6` (removed afterwards); PGlite for SQL; jest (gateway) and vitest (web). Probes and raw outputs: `round21-probes-invchart/`.

## Verdicts

| PR | Verdict | Tests fail without the code? |
|---|---|---|
| #929 low stock, every good (1/2) | FIXED for reach; PARTIAL for wording on alert / email / dashboard feed (disclosed in PR as other PRs' lanes) | Yes: SQL test `20270502100000_every_good_can_run_low_test.sql` fails without the migration (`column "uom" does not exist`) |
| #930 rail says each good's unit (2/2) | FIXED (rail only) | Yes: 4 of 5 `RailPanels.lowstock.test.tsx` fail with `RailPanels.tsx` reverted |
| #934 each good keeps its unit | FIXED (cosmetic notes) | Yes: 2 PR tests fail with the 3 source files reverted to base `3dbb39a01` |
| #933 unnamed house money costs no invoice | FIXED | Yes: 5 fail with `paper-landed-cost.ts` reverted (1 in `delivery-stock.service.spec.ts`, 4 in `paper-landed-cost.spec.ts`) |
| #932 sale keeps six-place cost | FIXED on the merged tree (#845+#909+#932); 1 new sub-cent residual, 1 unfixed neighbour | Yes: own SQL test `20270512100000_a_sale_keeps_six_places_test.sql` fails without the migration (2000.00 vs 2000.98) |
| #935 bars+line wired to week/room/servers/restock | FIXED (all four reachable by click) | Yes: dropping `combo` from the four `graphs` lists turns 5 tests red |
| #936 swap grows to new subject's size (R-7) | FIXED | Yes: removing the `swapSlot` call turns the R-7 test red (1 of 190) |

Counts: FIXED 5 (#930 #934 #933 #935 #936), FIXED with caveats 2 (#929 #932). NOT FIXED 0. REGRESSION 0.

## #929 (view `v_low_stock_items`, now LEFT JOIN, 43 columns)

PGlite on the #930 head. Wine, beer, spirit, food (g, kg, l, ml) and supply (each, case) all appear when `stock_live < threshold_min`. Not shown, correctly: par 0, stock at par, archived, deleted, IN_TRANSIT, other tenant (house B's good absent from house A's read). Par NULL is impossible: `threshold_min` is NOT NULL default 3. `kind` and `uom` arrive on the MCP `inventoryLowStock` rows (`select *`).

Gaps found:
1. Never-counted rows with a par (stock 0, par 500) and default-par rows (par 3, set by the carry flow `house-item.service.ts:57` default 0) DO appear. OD-161 (never counted = unknown, not zero) is open; #929 keeps the baseline predicate. Noise risk, not a regression.
2. Alert text still speaks bottles and wines (jest probe `p2-alert.out`): `low-stock-alerts.service.ts:802` "Only 200 bottles remaining (par: 500)" for flour; titles `:790-792` "N wines dropped below par"; `mapRow` (~`:1300-1306`) drops `uom`/`kind`; fallback name "Unknown wine"; `low-stock-digest.template.ts:41` "200 / 500 bottles"; `low-stock-alert.template.ts:122` preheader. Dashboard attention feed `dashboard.service.ts:1459` "N left, you keep at least M" via `bottles()`, read at `:1420` selects no `uom`; `dashboard.service.ts:1181` `totalBottles` sums grams. The PR body assigns these to #873/#814/#894/#874.
3. MCP note says "at or under par" but the predicate is strict `<`.
4. `mapRow` treats a null par as 10 (`?? 10`); the view never returns null, so dead code.

## #930 rail

`RailPanels.lowstock.test.tsx` 5/5. Probe renders: "Flour 200 / min 500 g", "Rice 4 / min 10 kg", "Oil 2 / min 5 l", "Milk 900 / min 2,000 ml", "Cups 1 / min 3 cases", "Salt & Pepper 0 / min 2 units". Link hrefs URL-encoded (`/inventory?wine=Salt%20%26%20Pepper`, search term works for any good). Max 6 lines plus "and N more below minimum". Order: out-of-stock first, then stock/min, then name. Only the rail is fixed; see #929 item 2 for the surfaces that are not.

## #934 units

`src/pages/inventory`: 22 files, 460 tests pass. Sentence reader never sums across units: "10 bottles, 2 cases and 1 keg"; "12 kg and 12.4 kg"; "3 l and 750 ml". Notes: kg and g stay separate so two "kg" words can appear; 1049 g reads "1 kg", 1250 g "1.3 kg" (0.1 rounding); mg sentence "2,500 mg" vs cell "2.5 g"; unknown unit "3 crate" (no plural); negative stock clamps to "0 g"; with all stock unread the wording still says "the bottle count is unknown"; CSV export (`iv-export.ts` `valuationColumns`) has no unit column and a "Your bottle price" header.

## #933 currency

procurement suites: 103 suites, 2189 tests pass. 99-case matrix (9 house states x 11 paper states through `finaliseAtVerified`): only 3 are costed, all correct (USD/"USD", USD/"usd", " try "/TRY). House currency null, "", whitespace, "tl", ZZZ, missing row or read error posts nothing and says so in a sentence ("this house has not named the currency it keeps its costs in, so no invoice is costed in it yet; name the house's currency and verify the delivery again"; read errors give a 500 sentence). Proposal path, repair path, no-header and proposals-only shapes all refuse or hold in words. Tenant filter on every read; foreign delivery 404 with 0 RPC calls. Out of scope: order-side `procurement.service.ts` has its own currency claims; mock DB ignores filters (known, round 19).

## #932 six-place cost, merged-tree spec (#845 + #909 + #932; git merge clean)

With the migration: 200 single sales at 10.0049 sum to 2000.98 (draw unit_cost 10.004900, wac 10.004900); 999+1 sale 10004.90; 13 sales at 9.230769 = 119.999997 (120.00 rounded once); 3 sales at 0.333333 = 0.999999. Without it the round-19 hazard reproduces exactly: 2000.00, 119.99, wac 10.00. Standalone (#932 without #909) lots stay at 2 places, so no visible change; the test self-guards. View definitions equal those of `20270303100000` with round(...,2) -> round(...,6); `inventory_transaction_settled_cost` dropped and recreated with grants; it is the only dependent of `cost_total`, which has no TS readers.

Findings:
- NEW sub-cent: provisional estimate 9.230769 settled at 9.5 gives `settled_cost_total` 9.500769 per sale; 13 sales = 123.509997 vs true 123.50 (exactly 123.50 without #932). Cause: 6-place `cost_total` plus 2-place settlement difference (#919 `20270502100100`).
- Not fixed, also present without #932: sales before verification, one bottle at a time, at estimate 10.00 later settled at 10.0049 lose the whole 0.98 (200 singles settle to 2000.00 vs 2000.98; a single 200-bottle sale settles right). This is the "settlement stays two places by design" tech-debt note.
- Deploy (not measured): `cost_total` numeric(12,2)->(16,6) rewrites the table under ACCESS EXCLUSIVE.
- Display: `cellMoney` shows 2 places, so 10.0049 reads 10.00.

## #935 / #936 charts (vitest, jsdom; probe `r21-probe.test.tsx` output `p8-chart-probe.out`)

`src/pages/reports`: 11 files, 190 tests pass at the #936 head.

- Reachability by click: on each of week "The week's shape", seats "The room", service "Who served it", restock "What to buy back", `Draw <title> as` offers `combo`, choosing it draws the "Bars: ... Line: ..." caption, no undrawable sentence. Bars/Line pickers appear when more than 2 measures (week, room, servers); restock has one extra measure so no pickers.
- Dual axis: room/servers bars = money ("Taken"), line = checks, caption names "on the left scale / on the right scale". Week bars and line share bottles/day, caption says "so they share one scale". Restock: stockout risk left, days of cover right. Wording nit (existing string): "Taken, in taken".
- Empty data: each register speaks its own sentence, no chart. One point: draws caption and pickers, no crash.
- Missing figures are gaps (null), not zeros (PR test; probe consistent).
- Full screen: dialog opens on the sheet's pick, `Draw as` still combo, Esc closes it and the sheet behind keeps the combo. View-only change in full screen does not leak (PR test).
- R-7 swap A/B: week -> room -> servers -> restock -> week -> room -> week. Every swap resets the drawing to the new subject's default (bars, bars, table, bars...), as the code comment says; going back to the week gives bars, not the combo. Saved slot ended 12x8 from 6x4: the square grows to max(old, declared) and never shrinks back, so a long swap session ratchets the size up. That is the ruling, not a defect, but worth knowing. x stayed within 12 columns.
- Legend toggles: none exist. `ComboPlot` (`rp-plot.tsx:411-540`) has no `<Legend/>`; the caption sentence is the legend. Series cannot be hidden.
- Non-colour encoding: bars vs line with dots, plus the caption in words. The chart container has no role or aria-label (`Plot`).
- Turkish: no i18n in reports code, labels are English. Server names are cut at 12 characters (`rp-registers-house.tsx:590`, `slice(0, 11)` + "…"); jsdom gives the chart 0 width so axis labels are not rendered and I could not observe a split of a decomposed "I + U+0307". Not verified.
- 375px: not verified visually; jsdom has no layout. Sheet columns are the 12-column ruling.

## What I did not do
- No real-browser check (jsdom only; recharts renders 0x0 there): no pixels, no 375px layout, no Turkish axis labels, no hover.
- Alert email and dashboard wording only read in code plus the jest alert probe, not in a delivered email.
- No live database: PGlite only; deploy lock time of the numeric ALTER not measured.
- Sub-cent settled-cost residual and singles-before-verified loss are measured, not fixed or ruled on.
- Overlap of saved slots after several swaps relies on the PR's own test and the grid compactor; jsdom does not run react-grid-layout compaction.
