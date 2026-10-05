# 0297 — A glass is not a bottle: demand counts each consumption line by its own mode

- **Status:** Proposed. Forks 1 and 2 are answered by the founder (2026-10-04, quoted verbatim below); the record as a whole waits on his word.
- **Date:** 2026-10-05
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** AW02, A-032, A-025, glass, single, pour, carafe, bottle-equivalent, consumption_type, quantity, volume_ml, bottle_size_ml, 750 ml stand-in, STOCK_STAND_IN_BOTTLE_ML, bottlesOf, consumption-units, unitsCoverage, counts.unmeasured, sizeStandIn, demandUnknown, unassessed, UncountedConsumptionError, menu engineering, quadrant, restock, inventory science, Wine 360, seasonality, demand forecast, risk, insight bundle, Bottles sold goal, INSIGHT_GENERATOR_VERSION 8
- **Links:** [[0011-pos-sale-volume-contract]] (what `quantity` is), [[0124-a-bottle-has-one-identity-and-every-price-names-it]] (the library's 750 is a default, not a reading), [[0115-the-house-item-is-the-ledgers-key]] (R7, on PR #589, unmerged), [[0020-no-fabricated-answers]], [[0051-rebuilt-pages-show-live-data-only]], [[0086-a-count-confesses-what-it-could-not-count]], [[0292-analytics-reads-the-whole-window-or-refuses]] (this change stacks on its PR #609), [[0285-a-short-pour-opens-the-next-bottle]] (`record_glass_pour`). Claims: [`claims.d/fix-a-glass-is-not-a-bottle.jsonl`](claims.d/fix-a-glass-is-not-a-bottle.jsonl).

## Context

The read-only analytics walk on Tuzlu Rüzgar (2026-10-03) filed AW02. It also covers the glass halves of A-032 and A-025. Every demand reader took `wine_consumption_log.quantity` as a count of bottles, but it is not one.

ADR 0011 (Locked) makes the summary view's two count columns mode counts (`0011:215`). The POS mirror is what writes `quantity` as a count in the line's own depletion mode:

- A volume sale is written as a `glass` row whose `volume_ml` is the pour's millilitres times `quantity`.
- A bottle sale is written as a `bottle` row.
- The writer is `apps/api-gateway/src/pos-hub/pos-hub.service.ts:1018-1022`, with `quantity: qty` at `:1060`.
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
- The stock of an unsized item already moves at 750 ml. `record_glass_pour` COALESCEs a missing size to 750 (`supabase/migrations/20261217112500_a_short_pour_opens_the_next_bottle.sql:102`), and pos-hub mirrors the same number (`RPC_DEFAULT_BOTTLE_ML`, `pos-hub.service.ts:26`).

AW02 is neither the 1000-row cap (ADR 0292) nor sale-time dating (F-129), and fixing either leaves it standing.

## Options considered

**The rule.** Each line's bottles come from its own mode. Three alternatives were weighed and rejected:

- **Divide every line's `volume_ml` by a size, whatever its mode.** For a `bottle` line, `volume_ml` is only the writer's stamp of size × quantity, and it already carries the 750 default for an unsized item (`:1021`). A bottle line already *is* bottles. Re-deriving it from the stamp brings the default back for nothing.
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

**A line with no bottle figure** follows dash F5's shape (ADR 0020, 0051 and 0086 posture): figures resting on it are null and named, and nothing is guessed. Reader by reader:

- **Menu engineering:**
  - The item's velocity, quadrant and action are null, and it is counted in `counts.unmeasured`.
  - `counts.unclassified` keeps its meaning: no recorded cost.
  - The medians are taken over measured items only.
  - Items carry `sizeStandIn`.
  - `unitsCoverage` and `basis.unitsDerived` are returned, and `basis.velocity` carries the coverage sentence.
- **Seasonality:** counted lines only. `basis.units` names the gap.
- **Wine 360:**
  - An item with such a line has a null demand profile, `forecast14d`, `forecastModel` and `trendPerDayPct`.
  - It leaves the peer ranks.
  - `basis.demand` names its coverage.
- **Inventory science:**
  - Such an item's row has `demandUnknown: true`.
  - Its demand, cover, reorder point, safety stock, stockout probability and EOQ are null, and `needsReorder` is false, so it is not on the reorder list.
  - `unassessed` counts these rows, and `unitsCoverage` is returned.
- **Risk profile:** counted lines only. `basis.demand` names the gap.
- **Demand forecast:**
  - House-wide, `basis.demand` names the gap.
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

The POS writer never writes such a line, because it fails closed on an explicit volume below `MIN_PLAUSIBLE_SALE_ML` (`pos-hub.service.ts:78-85`) and on a derived glass with no positive pour size (`:111-118`, `:645`), and it skips a line whose quantity rounds to 0 or less (`:755-756`). Such lines can come only from `manual` or `ai_agent` rows.

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
- **Generator version:** `INSIGHT_GENERATOR_VERSION` is 8. Version 7 belongs to the stockout change (ADR 0299, PR #619), whose history line lands with it.
- **Given up:**
  - An unsized glass seller's figures carry the stand-in's residual error, labelled. A 70 cl item reads 7% low, a 100 cl one 33% high, and a 37.5 cl one 50% low.
  - An item with a line that has no bottle figure leaves the per-item figures named above until the line is corrected.
- **Revisit when:**
  - R7's second half changes `record_glass_pour`'s 750.
  - A production count shows how many glass lines rest on the stand-in.
  - A writer other than pos-hub starts writing consumption lines.

## Not fixed here

1. **The dashboard sales chart.**
   - `apps/api-gateway/src/dashboard/dashboard.service.ts:893` (`existing.glasses += c.quantity || 0`) counts every line, bottle lines included, as glasses. Its select has no `consumption_type`.
   - No page calls GET /dashboard/sales-chart. Its client, `getSalesChartData` (`apps/web/src/services/api/dashboard.ts:111`), is only re-exported (`apps/web/src/services/api/index.ts:82`), never called.
   - Open claim AW02-DASH-CHART-GLASSES.
2. **The weekly email's Sold column.**
   - `apps/api-gateway/src/communications/scheduled-tasks.service.ts:1285` adds glasses and bottles into one figure.
   - Fork 2 is answered "Bottles · glasses (Recommended)". It is owed as its own PR in /communications once R2's pause lifts.
   - Open claim AW02-WEEKLY-SOLD-MIXED.
3. **The 90-day divisor over a shorter history.** `advanced-analytics.service.ts:285` divides by `sinceDays` even when the house's history is shorter (60 days at Tuzlu).
4. **Master-wine demand against per-row stock.** `getInventoryScience` keys demand on `master_wine_id` (`analytics.service.ts:635-651`), while stock is per `restaurant_inventory` row. Two rows of one wine, for example two sizes, share one demand.
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
   - The restock register's empty answer (`:661`, "Nothing is below its reorder point. That is a real answer about N wines") does not read `unassessed`. With an unassessed wine it counts that wine among the ones the answer covers; `basis.demand`, shown beside it, names the unassessed rows.
   - How many wines that touches is unmeasured. The read-only count is `SELECT restaurant_id, count(*) FROM wine_consumption_log WHERE (consumption_type = 'glass' AND (volume_ml <= 0 OR volume_ml = 'NaN'::float8 OR volume_ml = 'Infinity'::float8)) OR (consumption_type = 'bottle' AND quantity < 0) GROUP BY 1`.

## Review trail

Cite an audit as `audit of PR #M, round N` with its report path under `.planning/07-reference/pr-audits/`.

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-05 | — | Created by the `units` fix lane (branch `fix/a-glass-is-not-a-bottle`, stacked on PR #609). Forks 1 and 2 answered by the founder on 2026-10-04. |
