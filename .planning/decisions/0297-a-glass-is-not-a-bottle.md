# 0297 — A glass is not a bottle: demand counts each consumption line by its own mode

- **Status:** Proposed. Forks 1 and 2 are answered by the founder (2026-10-04, quoted verbatim below); the record as a whole waits on his word.
- **Date:** 2026-10-05
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** AW02, A-032, A-025, glass, single, pour, carafe, bottle-equivalent, consumption_type, quantity, volume_ml, bottle_size_ml, 750 ml stand-in, STOCK_STAND_IN_BOTTLE_ML, bottlesOf, consumption-units, unitsCoverage, counts.unmeasured, sizeStandIn, demandUnknown, unassessed, UncountedConsumptionError, menu engineering, quadrant, restock, inventory science, Wine 360, seasonality, demand forecast, risk, insight bundle, Bottles sold goal, INSIGHT_GENERATOR_VERSION 8 [Corrected 2026-10-08, coordinator: the code has 9 (`insight-generator.service.ts:224`); the coordinator renumbers `INSIGHT_GENERATOR_VERSION` at merge above every value on `main`] [Corrected 2026-10-08, re-sync onto `origin/main` be9a16ccf: the code has 11 (`insight-generator.service.ts:232`); `main` is at 10 (#652), and this PR sets 11]
- **Links:** [[0011-pos-sale-volume-contract]] (what `quantity` is), [[0124-a-bottle-has-one-identity-and-every-price-names-it]] (the library's 750 is a default, not a reading), [[0115-the-house-item-is-the-ledgers-key]] (R7, on PR #589, unmerged), [[0020-no-fabricated-answers]], [[0051-rebuilt-pages-show-live-data-only]], [[0086-a-count-confesses-what-it-could-not-count]], [[0292-analytics-reads-the-whole-window-or-refuses]] (this change stacks on its PR #609) [Corrected 2026-10-08, coordinator: #609 merged as b270a45b8 and this branch merged `origin/main` at a95cb520c, so it no longer stacks; its base is `main`] [Corrected 2026-10-08, re-sync: "its base is `main`" is true of the branch's content, which carries `main` (merged be9a16ccf); on GitHub, PR #626's base stays #609's branch until the coordinator retargets it to `main`], [[0285-a-short-pour-opens-the-next-bottle]] (`record_glass_pour`). Claims: [`claims.d/fix-a-glass-is-not-a-bottle.jsonl`](claims.d/fix-a-glass-is-not-a-bottle.jsonl).

## Context

The read-only analytics walk on Tuzlu Rüzgar (2026-10-03) filed AW02. It also covers the glass halves of A-032 and A-025. Every demand reader took `wine_consumption_log.quantity` as a count of bottles, but it is not one.

ADR 0011 (Locked) makes the summary view's two count columns mode counts (`0011:215`). The POS mirror is what writes `quantity` as a count in the line's own depletion mode:

- A volume sale is written as a `glass` row whose `volume_ml` is the pour's millilitres times `quantity`.
- A bottle sale is written as a `bottle` row.
- The writer is `apps/api-gateway/src/pos-hub/pos-hub.service.ts:1018-1022`, with `quantity: qty` at `:1060`. [2026-10-07, re-pinned at the merge of `origin/main` ca3582988: now `:1583-1587`, with `quantity: qty` at `:1625`.]
- A 500 ml carafe is a `glass` row of 500 ml.

So a 150 ml glass counted as one whole bottle, five times what it poured. A 50 ml rakı single counted fifteen times what it poured.

The figures this inflated:

| Reader | Where | Figures inflated |
|---|---|---|
| Menu engineering | `advanced-analytics.service.ts`, `getMenuEngineering` | Velocity, then the quadrant and the action |
| Seasonality | `getSeasonality` | Its series |
| Wine 360 | `getWine360` | Demand, forecast and peer rank |
| Restock and inventory science | `analytics.service.ts`, `getInventoryScience` | Daily demand, days of cover, reorder point, stockout probability, EOQ |
| Risk profile and demand forecast | `analytics.service.ts` | Their demand figures |
| Insight bundle | `insights/insight-generator.service.ts` | Movers, concentration, forecast gap |
| Bottles sold goal | `goals.service.ts` | The goal's total |

`analytics.service.ts` loadConsumption read `quantity || volume_ml / 750`. The fallback never fired for a POS row, whose `quantity` is always at least 1, and when it did fire it divided by a default.

A bottle's size is not always known:

- `restaurant_inventory.bottle_size_ml` is nullable. ADR 0124 (Locked) records it as known on 51 of 206 rows (`0124:93`).
- ADR 0124 also rules that `master_wine_library.bottle_size_ml`'s 750 is a default, never a reading.
- The stock of an unsized item already moves at 750 ml. `record_glass_pour` COALESCEs a missing size to 750 (`supabase/migrations/20261217112500_a_short_pour_opens_the_next_bottle.sql:102`), and pos-hub mirrors the same number (`RPC_DEFAULT_BOTTLE_ML`, `pos-hub.service.ts:26`). [2026-10-07, at the merge of `origin/main` ca3582988: `record_glass_pour` is now defined by the newer migration `supabase/migrations/20261222100000_a_pos_sale_is_dated_by_its_check.sql` (#603), which keeps `COALESCE(ri.bottle_size_ml, 750)` at `:318`; `RPC_DEFAULT_BOTTLE_ML = 750` is now `pos-hub.service.ts:33`. All three numbers are still 750, and AW02-STAND-IN-IS-THE-STOCKS still passes against the newer migration. The founder's answer on #619 of 2026-10-07 (*Earlier answers* below) keeps the same 75 cl for the stock side of a row that states no size.]

AW02 is neither the 1000-row cap (ADR 0292) nor sale-time dating (F-129), and fixing either leaves it standing.

## Options considered

**The rule.** Each line's bottles come from its own mode. Three alternatives were weighed and rejected:

- **Divide every line's `volume_ml` by a size, whatever its mode.** For a `bottle` line, `volume_ml` is only the writer's stamp of size × quantity, and it already carries the 750 default for an unsized item (`:1021`) [2026-10-07, re-pinned at the merge of `origin/main` ca3582988: now `pos-hub.service.ts:1586`]. A bottle line already *is* bottles. Re-deriving it from the stamp brings the default back for nothing.
- **Keep `quantity` and rename the axis "servings".** Stock, days of cover and the reorder point are in bottles. A servings velocity cannot be set against bottles on hand, and a glass would still weigh the same as a bottle.
- **Re-read the mapping's `sale_volume_ml` at read time.** The line already carries the `volume_ml` written from that mapping at the moment of sale. Re-reading a mapping that may have changed since would rewrite history.

**Fork 1: a glass line of an item with no stated bottle size.**

1. **(a) The 750 ml stand-in, labelled.**
   - It is the same stand-in the item's stock already moves by. R7 keeps it until the item is sized.
   - Every figure that uses it names how many lines and items rest on it, and items carry `sizeStandIn: true`.
   - An item switches to its true size as soon as one is stated.
   - Cost: the error that remains where the true size is not 750. A 70 cl single reads 7% low, a 100 cl one 33% high, and a 37.5 cl half 50% low.
   - Days of cover stay coherent with the stock figure, which carries the same stand-in.
2. **(b) Keep out, say so.**
   - That item's figures go null and it is counted as having no bottle size: no quadrant, "not assessed" on restock.
   - Cost: every unsized item sold by the glass leaves menu engineering, the restock list, Wine 360 and the insight movers until someone states its size.
   - With 155 of 206 rows unsized (ADR 0124:93), that is most of a glass list.
3. **(c) Report ml for those items.**
   - Cost: stock is held in bottles, so days of cover and the reorder point still need a size.
   - ml cannot sit on a bottles-per-day axis next to other items.
4. **Do nothing.**
   - A glass stays a bottle and a 50 ml single stays fifteen times over.
   - The restock list over-orders every glass seller.
   - Menu engineering lifts glass sellers into a higher-velocity quadrant on demand they never had.

**Fork 2: the weekly email's Sold column** (`communications/scheduled-tasks.service.ts:1285`, which adds glasses and bottles into one number).

- (a) "N bottles · M glasses", the mode counts ADR 0011 already names.
- (b) Bottle-equivalents through this record's converter.
- (c) Rename the column "Servings".

**A line with no bottle figure** has no mode, is a glass line with no positive millilitres, or is a bottle line with a negative quantity. Counting it as 1 is the defect itself. Counting it as 0 drops a real sale without a word. Either one breaks ADR 0020 and ADR 0086.

## Founder answers, verbatim

**The answers for this record**, given on 2026-10-04 at about 20:50Z:

- **Fork 1:** "750 ml stand-in (Recommended)". The stand-in is labelled. The counts of the lines and items resting on it are given. An item switches to its true size once that size is stated.
- **Fork 2:** "Bottles · glasses (Recommended)". This is its own PR in the /communications area after R2's pause lifts. It is not in this change and is owed (see *Not fixed here*).

**Earlier answers this record leans on**, quoted where they were given:

- **R7**, from the ADR 0115 lock row (`.planning/decisions/0115-the-house-item-is-the-ledgers-key.md:920` on `origin/docs/adr-0115-drinks-lock` @d54f2de90, PR #589, unmerged): "One wine at a time (Recommended)". Each wine moves to ml once it is sized, using the 750/150 interim, and the interim is dropped after a production count.
- **AW14**, from the 2026-10-04 answers, not yet in an ADR: "Door-checked, labelled (Recommended)". It is a labelled interim figure that holds until the better source takes over, the same shape as fork 1 (a).
- **dash F5**, from the 2026-10-04 answers, not yet in an ADR: "Keep out, say so (Recommended)". This is the shape used here for a line with no bottle figure at all.
- [Added 2026-10-07.] **#619's bottle size**, answered 2026-10-07 at 13:51:58Z (AskUserQuestion, session transcript; quoted in ADR 0299 rule 1 in #619's next head, which was not yet pushed on 2026-10-07 at 20:00Z, and not on `main`). Asked: *"#619: when a stock row doesn't say its bottle size, what size should the stockout count use for the bottle that's already open?"* Picked: *"Standard 75 cl, as built (Recommended)"*, which read *"The row's own size, else 75 cl: the same stand-in each glass pour uses, so stock and demand count the same bottle. No code change. We add a check that ties the two 75 cl stand-ins together, and record your pick in ADR 0299."* Rejected: *"Shared catalogue next"*, which read *"The row, then the shared wine catalogue, then 75 cl. The catalogue is almost always 75 cl, it can come from another restaurant's entry, and demand would still divide by 75 cl, so days of cover would mix two sizes. A small code change in #619 means a fresh audit."*; and *"Refuse without a size"*, which read *"No open-bottle count when the row has no size. The card says the size is missing until someone writes it. A code change in #619 means a fresh audit, and many cards go quiet until sizes are filled in."* It rules the stock side (the open bottle's size in the stockout count) for a row that states no size. It is the same 750 that fork 1 (a) gave the demand side here, so stock and demand divide by one number; it changes no code in this record.

## Decision

**A consumption line's bottles come from its own mode, through one converter**: `bottlesOf` in `apps/api-gateway/src/analytics/consumption-units.ts`.

- A `bottle` line is its `quantity`, whatever its size.
- A `glass` line is its `volume_ml` over the item's stated `restaurant_inventory.bottle_size_ml`. A size counts only when it is positive, which is pos-hub's own test.
- A glass line of an item with no stated size rests on the 750 ml stand-in (fork 1 (a), `STOCK_STAND_IN_BOTTLE_ML`). Every figure built on consumption lines carries the counts of the lines and items resting on it, counted from the lines that figure read (`summarizeUnits`, `unitsBasisSentence`, `unitsLabel`):
  - a `basis` sentence on the analytics endpoints;
  - `units` on the insight bundle, on each of its records and on each Bottles sold goal;
  - the report exports that write those figures (see *Exports* below).
- A line with no mode, a glass line with no positive `volume_ml`, or a bottle line with a negative `quantity` has **no bottle figure**: never 1, never 0.

`quantity` keeps its ADR 0011 meaning. `master_wine_library.bottle_size_ml` is never read.

**Why (a) carried.** The restock list divides demand into stock, and an unsized item's stock already moves at 750 ml a bottle. Demand at that divisor is the stock's own rate, not a new guess. Any other divisor would make days of cover disagree with the stock printed beside it. The founder chose this stand-in for the same items in R7, and a labelled interim in AW14. The claim AW02-STAND-IN-IS-THE-STOCKS ties this constant to `record_glass_pour`'s, so the two cannot drift apart unnoticed.

**A line with no bottle figure** follows dash F5's shape (ADR 0020, 0051 and 0086 posture): it is named, and nothing is guessed. [Narrowed 2026-10-08, audit of PR #626 at b9580443e: this read "figures resting on it are null and named", which is true of the per-item readers only. Seasonality, the risk profile and the demand forecast zero-fill a daily series from counted lines, so a day holding such a line counts only its other lines and reads 0 if it has none; their `basis` says that, not "null" (`unitsBasisSentence(…, "series")`).] Reader by reader:

- **Menu engineering:**
  - The item's velocity, quadrant and action are null, and it is counted in `counts.unmeasured`.
  - `counts.unclassified` keeps its meaning: no recorded cost.
  - The medians are taken over measured items only.
  - Items carry `sizeStandIn`.
  - `unitsCoverage` and `basis.unitsDerived` are returned, and `basis.velocity` carries the coverage sentence.
- **Seasonality:** counted lines only, zero-filled. `basis.units` names the gap: the lines are left out of the series, and a day holding them counts only its other lines, reading 0 if it has none.
- **Wine 360:**
  - An item with such a line has a null demand profile, `forecast14d`, `forecastModel` and `trendPerDayPct`.
  - It leaves the peer ranks.
  - `basis.demand` names its coverage.
- **Inventory science:**
  - Such an item's row has `demandUnknown: true`.
  - Its demand, cover, reorder point, safety stock, stockout probability and EOQ are null, and `needsReorder` is false, so it is not on the reorder list.
  - `unassessed` counts these rows, and `unitsCoverage` is returned.
- **Risk profile:** counted lines only, zero-filled. `basis.demand` names the gap in the same words as seasonality.
- **Demand forecast:**
  - House-wide, counted lines only, zero-filled, and `basis.demand` names the gap in the same words as seasonality.
  - For one item with such a line, the projection and its accuracy are null, and `basis.model` says why.
- **Insight bundle:**
  - Every record built on consumption carries `evidence.units`: the counts of the lines it was built from, the lines and items on the stand-in among them, and the sentence. The series records and the forecast gap count the 90-day series; a mover counts its own wine over the two weeks it compares; concentration counts the lines it shares out; the stockout #1 counts its own wine. `evidence` is stored, so a cached row carries the label too.
  - The bundle's response carries `units` over every line it read.
  - The line's `qty` is null.
  - A day holding such a line is unobserved in the daily series, as a day the manager excluded is. Its counted lines stay in the dense values.
  - Per-item movers skip such items.
  - Concentration is withheld while any wine in the bundle holds such a line. The Holt-Winters forecast gap is withheld while any dated line in the bundle is one.
- **Bottles sold goal:**
  - Each goal's progress carries `units`: the lines and items in its window resting on the stand-in. It is null for every other metric.
  - A window holding a line with no bottle figure throws `UncountedConsumptionError`, and the goal reads as "could not be scored" rather than summing short.
- **Quadrant export** (`reports/exports/report-export-cuttings.ts`, writeQuadrants):
  - Such an item's velocity and quadrant cells say "some of its sales carry no bottle figure", instead of calling it uncosted or unmoved.
  - "No quadrant" counts uncosted and unmeasured items together, and the notes say which is which.
- **Exports** (`reports/exports/report-export-cuttings.ts`):
  - The week's shape writes seasonality's `basis.units`; the restock, forecast and quadrant exports already write the `basis` sentences that carry it.
  - The goals export names each Bottles sold goal's stand-in lines and items, and writes `basis.units`.
  - The reading export counts the sentences that rest in part on the stand-in. Each sentence's own counts stay in the stored feed's `evidence.units`, not in the export.
- **Dead stock:** "moved" stays a line with servings or millilitres above 0, which is the earlier test.

The POS writer never writes such a line, because it fails closed on an explicit volume below `MIN_PLAUSIBLE_SALE_ML` (`pos-hub.service.ts:78-85`) and on a derived glass with no positive pour size (`:111-118`, `:645`), and it skips a line whose quantity rounds to 0 or less (`:755-756`). [2026-10-07, re-pinned at the merge of `origin/main` ca3582988: the volume test is now `:473-480`, the pour-size test `:507-513` and `:65`, and the skip `:1257-1258`.] Such lines can come only from `manual` or `ai_agent` rows.

## Consequences

- **Easier:**
  - There is one place to change the unit rule.
  - When R7's second half changes `record_glass_pour`, the claim AW02-STAND-IN-IS-THE-STOCKS fails until this constant follows it.
  - An item stops resting on the stand-in the moment its size is stated, with no code change.
- **Response fields added:**
  - Menu engineering: `unitsCoverage`, `counts.unmeasured`, `items[].sizeStandIn`, `basis.unitsDerived`.
  - Inventory science: `unitsCoverage`, `skus[].demandUnknown`, `unassessed`.
  - Risk profile: `basis.demand`.
  - Seasonality: `basis.units`.
  - Insight bundle: `units`, and `insights[].evidence.units`.
  - Goals: `basis.units`, and `units` on each goal's progress.
  - Demand forecast: no new field; `basis.demand` and `basis.model` name the coverage.
- **Generator version:** `INSIGHT_GENERATOR_VERSION` is 8. Version 7 belongs to the stockout change (ADR 0299, PR #619), whose history line lands with it. [2026-10-07: now 9, not 8. `main` is at 6 (ADR 0292, #609), #619 holds 7 and #625 (lane tablesins, the ADR 0303 amendment) also holds 8, so this change moved to 9 and no two open PRs share a version. The history line for 8 is #625's and lands with it. The number is re-checked at merge: of #619, #625 and this change, whichever merges later must be above the version on `main` at its merge, by later-truth. The claim AW02-GENERATOR-VERSION-9 reads a version of 9 or more and this record's history line, so a later bump keeps it true.] [Corrected 2026-10-08, re-sync onto `origin/main` be9a16ccf: now 11, not 9. `main` is at 10 (#652, the ADR 0292 fork 3 follow-on), not 6, and this PR sets 11, with floor "A row below 11". The code's history lists 10 (`main`'s) then 11 (this change); the lane's placeholder lines for 7 and 8 are gone, since `main`'s 10 line records that #619/#624 and #625/#626 held them, and none of 7, 8 or 9 was ever on `main`. The claim is renamed AW02-GENERATOR-VERSION-11 and reads a version of 11 or more and the 11 history line.]
- **Given up:**
  - An unsized glass seller's figures carry the stand-in's residual error, labelled. A 70 cl item reads 7% low, a 100 cl one 33% high, and a 37.5 cl one 50% low.
  - An item with a line that has no bottle figure leaves the per-item figures named above until the line is corrected.
- **Revisit when:**
  - R7's second half changes `record_glass_pour`'s 750.
  - A production count shows how many glass lines rest on the stand-in.
  - A writer other than pos-hub starts writing consumption lines.

## Not fixed here

1. **The dashboard sales chart.**
   - `apps/api-gateway/src/dashboard/dashboard.service.ts:893` [2026-10-07, re-pinned at the merge of `origin/main` ca3582988: now `:1386`] (`existing.glasses += c.quantity || 0`) counts every line, bottle lines included, as glasses. Its select has no `consumption_type`.
   - No page calls GET /dashboard/sales-chart. Its client, `getSalesChartData` (`apps/web/src/services/api/dashboard.ts:111`), is only re-exported (`apps/web/src/services/api/index.ts:82`), never called. [2026-10-07: it is also listed in the `dashboardApi` object (`apps/web/src/services/api/dashboard.ts:349`), and no page calls `dashboardApi.getSalesChartData` either.]
   - Open claim AW02-DASH-CHART-GLASSES.
2. **The weekly email's Sold column.**
   - `apps/api-gateway/src/communications/scheduled-tasks.service.ts:1285` adds glasses and bottles into one figure.
   - Fork 2 is answered "Bottles · glasses (Recommended)". It is owed as its own PR in /communications once R2's pause lifts.
   - Open claim AW02-WEEKLY-SOLD-MIXED.
3. **The 90-day divisor over a shorter history.** `advanced-analytics.service.ts:285` divides by `sinceDays` even when the house's history is shorter (60 days at Tuzlu).
4. **Master-wine demand against per-row stock.** `getInventoryScience` keys demand on `master_wine_id` (`analytics.service.ts:635-651` [2026-10-07, re-pinned at the merge of `origin/main` ca3582988: now `:627-643`]), while stock is per `restaurant_inventory` row. Two rows of one wine, for example two sizes, share one demand.
5. **Glass revenue.** Menu engineering's margin per bottle is the bottle menu price less cost. Glass revenue per bottle-equivalent is not used.
6. **The web quadrant register.**
   - In `apps/web/src/pages/reports/next/rp-registers-house.tsx`:
     - `:23` types `velocityPerDay` as `number`;
     - `:61` reads a null velocity as 0;
     - `:96` plots it;
     - `:133` prints it.
   - It does not read `counts.unmeasured`.
   - The fix and its test are owed as a follow-up PR; this change is at its file limit.
   - Until it lands, an item whose sales include a line with no bottle figure plots at 0 bottles a day on /reports, and its "No quadrant" tile counts only `counts.unclassified`. That can happen only through a `manual` or `ai_agent` line: a glass line with no millilitres or a bottle line with a negative quantity.
   - The restock register's empty answer (`:661` [2026-10-07, re-pinned at the merge of `origin/main` ca3582988: now `:700`], "Nothing is below its reorder point. That is a real answer about N wines") does not read `unassessed`. With an unassessed wine it counts that wine among the ones the answer covers; `basis.demand`, shown beside it, names the unassessed rows.
   - How many wines that touches is unmeasured. The read-only count is `SELECT restaurant_id, count(*) FROM wine_consumption_log WHERE (consumption_type = 'glass' AND (volume_ml <= 0 OR volume_ml = 'NaN'::float8 OR volume_ml = 'Infinity'::float8)) OR (consumption_type = 'bottle' AND quantity < 0) GROUP BY 1`.

## Review trail

Cite an audit as `audit of PR #M, round N` with its report path under `.planning/07-reference/pr-audits/`.

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-05 | — | Created by the `units` fix lane (branch `fix/a-glass-is-not-a-bottle`, stacked on PR #609). Forks 1 and 2 answered by the founder on 2026-10-04. |
| 2026-10-07 | — (fix round, lane `units`, on d9b87752d) | Merged `origin/main` ca3582988 (a95cb520c), which carries #609 squashed as b270a45b8; never rebased. Nine files conflicted. #609's own three (ADR 0292, its claims and its tech-debt note) were taken from `main` whole. Four lane files were re-merged three-way against the lane's own pre-state; the lines this lane adds or removes in them are unchanged. `analytics.service.ts` loadConsumption keeps `main`'s read, which now propagates a refusal (ADR 0292 fork 3), with this lane's columns and bottle mapping on top; the lane's earlier catch that degraded a refused read to no lines is gone. The index keeps `main`'s rows plus 0297's. `INSIGHT_GENERATOR_VERSION` moved 8 → 9 (bracket under *Consequences*; claim AW02-GENERATOR-VERSION-9), re-checked at merge. The consumption stub in `consumption-units.spec.ts` now returns only the columns a reader selects, and four stated-size cases fail when any reader stops selecting `bottle_size_ml`. The pos-hub, dashboard, `analytics.service.ts` and register cites that `main` moved are re-pinned in brackets. The founder's #619 bottle-size answer (2026-10-07T13:51:58Z) is quoted under *Earlier answers*. AW02-STAND-IN-IS-THE-STOCKS's text now names the newer `record_glass_pour` migration (`:318`); its check already reads the newest one, and all three numbers are still 750. No new founder fork. |
| 2026-10-08 | — (fix round, lane `units`, on 762916d0f) | Four shoulds from the 2026-10-07 verify. `consumption-units.ts` comment cites re-pointed (pos-hub writer `:1583-1587`/`:1625`, `RPC_DEFAULT_BOTTLE_ML` `:33`, `inventoryVolumesFromRow` `:58-62`, `record_glass_pour` in `20261222100000_a_pos_sale_is_dated_by_its_check.sql:318`) and its rule list now names the negative bottle line this record already states (*Decision*). Keywords and Links bracket-corrected (version 9 in code, renumbered by the coordinator at merge; #609 merged, no longer stacked). New cases: R6b pins that a glass line with no millilitres still counts as movement for dead stock (kills A05); H7b and R5b pin that a negative bottle line has no bottle figure and refuses a Bottles sold total (kills U07). Behaviour unchanged. |
| 2026-10-08 | — (fix round 2, lane `units`, on 57fc2c668) | Merged `origin/main` be9a16ccf (#652) by hand; never rebased. Only `insight-generator.service.ts` conflicted, in three hunks: `main`'s version-10 history line, `BUNDLE_READ_WORDS`, `readWasRefused` and `sourcesUnread` kept; the wine mover keeps `main`'s inventory-list gate with this lane's mover shape; `INSIGHT_GENERATOR_VERSION` 9 → 11 (bracket under *Consequences*; claim renamed AW02-GENERATOR-VERSION-11). `unitsBasisSentence` and the Bottles sold refusal (`UncountedConsumptionError`) now name every cause `bottlesOf` has for a line with no bottle figure, the bottle line with no quantity of 0 or more among them; the basis sentence named only two, and the refusal named none. R6b's comment names `getFinancialSummary`'s dead-stock join, where it named loadConsumption. #652's `insight-unread-sources.spec.ts` "with the inventory list read, the mover fires" fails on this branch: its consumption rows carry no `consumption_type`, so every line has no bottle figure and the mover never fires. Its one-line fixture fix (`consumption_type: "bottle"` on those rows; with it the file passes 32 of 32) would be a 16th file (ADR 0231), so it is owed, not made, and until it lands `npx jest src/analytics` fails 1 of 947 on this branch, so the PR cannot merge green. [Corrected 2026-10-08: that fixture fix landed on `main` as #667 (0d79883e7), this branch carries it (merge b9580443e), and `npx jest src/analytics` passes 947 of 947 there; nothing is owed for it.] No new founder fork. |
| 2026-10-08 | — (fix round 4, lane `units`, on b9580443e) | Answers the BLOCK of the audit of PR #626 at b9580443e (`p4-scratch/sim-run/fixes/audits/626-b9580443e/report.md`): `unitsBasisSentence` told the owner "every figure resting on them is null rather than guessed" on all readers, but seasonality, the risk profile and the demand forecast zero-fill a daily series from counted lines. **Decided by the coordinator under the founder's 2026-10-07T20:04:10Z delegation: fix the words, not the behaviour.** Basis: this record's *Decision* already rules those three readers reader by reader as "counted lines only" with the gap named, and rules "a day holding such a line is unobserved" for the insight bundle alone; the three readers do what was decided, and only the sentence said more. A decided feature does not change unless it breaks something, and the breakage here was the sentence. Rejected: treat a day holding such a line as unobserved in the three series readers, as the bundle does. That changes three decided readers' figures (weekday means, VaR, drawdown, the house projection) for a line the POS writer never produces, with no ruling asking for it. `unitsBasisSentence` takes `reads: "figures" \| "series"` (default "figures"); the three series readers pass "series", which says the lines are left out of this series, a day holding them counts only its other lines and reads 0 if it has none, so the series is short by those lines rather than guessed. Per-item readers and the insight bundle keep the null wording. The comment at `advanced-analytics.service.ts` getSeasonality that said "a short day is never passed off as a quiet one" now says the day is short and the basis says so. Spec cases SB1-SB3 (one per series reader, each with one line with no bottle figure; SB3 also checks the house forecast's history reads 0 on a day holding only it) and SB4 (a per-item sentence keeps "null"); each of SB1-SB3 fails with all three source files at b9580443e and with its own reader's call reverted, SB4 fails when the default flips. New open claim AW02-WEB-QUADRANT-NULL-VELOCITY tracks *Not fixed* #6. `INSIGHT_GENERATOR_VERSION` stays 11: the bundle's sentence is unchanged. No new founder fork. |
