# 0291 — A recommendation says when it is for and what its rule measured

- **Status:** Proposed 2026-10-03. The three fixes correct defects found on the analytics walk. The 7-day band, the copy and the category the generator follows are the build's readings, **not founder answers**. Forks F1 and F2 wait on him.
- **Date:** 2026-10-03
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** sales_below_weekday_baseline, weekly_demand_slide, vs_same_weekday, urgency, Tonight, now, this_week, this_month, SALES_DIP_WEEK_DAYS, salesDipWhen, salesDipAdvice, toDaily, wine_revenue, whole-check sales, rule-to-goal basis, RULE_GOAL, vendor.purchase_spend.concentration, categorize, record(), INSIGHT_GENERATOR_VERSION, Nothing live for this type, AW01, AW20, AW23, A-004, A-022, A-024
- **Links:** [[0120-a-goal-comes-from-a-book-a-model-comes-from-the-task]] (its scenario book pairs both sales rules with wine-revenue scenarios, `apps/api-gateway/src/analytics/goal-scenarios.ts:206-207`, `:226`, `:324`); [[0191-the-recommendations-catalogue-is-actionable-not-a-read-only-leaf]]; `claims.d/fix-recommendations-say-when-and-what.jsonl:1-3`; the analytics-walk findings `p4-scratch/sim-run/analytics/FINDINGS.md`, which is outside the repo (AW01 / A-004, AW20 / A-022, AW23 / A-024); the lane brief `p4-scratch/sim-run/fixes/briefs/rec.md`

## Context

On 2026-10-03 the analytics walk on Tuzlu Rüzgar found three places where /recommendations says something its own code does not support.

**AW01: "Tonight" about a seven-week-old day.**
- The sales-dip rule restates `*.vs_same_weekday`. That comparison uses the newest day its series observed, and it walks back up to 90 days to find one. Its `periodKey` is `dayGrain(lastDate)` (`apps/api-gateway/src/analytics/insights/insight-generator.service.ts:1529-1542`).
- The rule stamped every entry `urgency: "now"` with the copy "Tonight: …". On 2026-10-03 the page said "Tonight" about Saturday 2026-08-15.
- Paging the capped read (C15) would only move the card to a newer day, and it would still say "Tonight".
- The same finder matched the comparator name in any category. A soft purchasing day (`overall.purchase_spend.vs_same_weekday`) could therefore raise "brief the floor on top-margin picks".

**AW20: a goal basis that is false.**
- `RULE_GOAL` in `apps/web/src/pages/recommendations/next/rec-forward.ts` pairs both sales rules with a `wine_revenue` goal. It says "The rule compares a day's wine sales" and names the goal "<day> wine revenue back to baseline".
- The trigger is actually whole-check sales: `pos_checks.total`, which covers food, drink and tax (`insight-generator.service.ts:1070`), or bottles sold from the cellar log (`overall.bottles`). The generator computes the two families independently, each gated on its own source (`computeConsumptionFamily`, `:777-778`; `computeChecksFamily`, `:1063-1064`), so any house that keeps a cellar log can fire on bottles, till or no till.
- The goal measures `is_wine` items honestly (`apps/api-gateway/src/analytics/goals.service.ts:935-950`). The false part is the basis sentence, not the goal.

**AW23: the catalogue reads "Nothing live" for a type that is live.**
- The generator recorded `vendor.purchase_spend.concentration` under `risk`.
- `categorize()` files any vendor dimension under `purchasing` (`apps/api-gateway/src/analytics/insights/insight-catalog.ts:486-490`) before its concentration→risk branch (`:493`).
- The catalogue asks under `purchasing`. The generator filters by category before it filters by key (`insight-generator.service.ts:268-270`). So the narrowed read returned nothing even though the insight fired.
- This was the only one of the 16 `this.record(` call sites that disagreed with `categorize()` (re-measured at HEAD; the new spec's own count reads 16), and nothing checked them.

## Options considered

**AW01: how a dip says when it is for**

1. **Page the capped read only (C15).** Rejected: the card moves to a newer day and still says "Tonight".
2. **Urgency from the dip day's age (chosen).**
   - The age is counted in whole UTC days on the generator's clock, the same clock `toDaily` builds the series on.
   - The bands are `salesDipWhen`, `apps/api-gateway/src/analytics/recommendations.service.ts:77-111`:

     | Age | Urgency | Why |
     |---|---|---|
     | 0–1 days | `now` | Yesterday is the newest day the series can hold, so tonight is the next shift after it. |
     | 2–`SALES_DIP_WEEK_DAYS` (7) days | `this_week` | The same weekday comes round again within the week. |
     | More than 7 days, or an age that cannot be read or is in the future | `this_month` | — |

   - Only `now` keeps the "Tonight:" text, word for word. Every other band opens "Before the next <weekday>:" and names the day, its date and its age (`salesDipAdvice`). When the day is a whole number of weeks old, today is that weekday, and "the next Saturday" said on a Saturday could mean tonight or a week out. That copy opens "Before today's <weekday> service:" instead. The 2026-08-15 card read on 2026-10-03 (49 days, both Saturdays) is that case.
3. **Pass a clock seam in from the digest, so the age is counted on the house's send time.** Rejected. It would thread a parameter through `generate()` and `getRecommendations()` for one rule. The series is built on the real clock anyway, so counting the age on the same clock is the consistent reading. The day boundary is UTC, the same as the series, until C02 (the business date) lands.

**AW01: which insight may raise the sales card**

4. **Pin the rule to `overall.revenue.vs_same_weekday`.** Rejected: a house with only the cellar log would lose the card, since its dip is `overall.bottles.vs_same_weekday`, and a house with both would lose its bottles dips.
5. **Require `category === "sales"` in the finder (chosen).** A purchasing dip raises nothing, and a purchasing dip ranked first no longer hides the sales dip behind it.

**AW01: which sales dip the card restates, when two stand**

A house with a till and a cellar log can carry two sales dips, `overall.revenue` and `overall.bottles`, each ending on its own newest observed day.

5a. **The first-ranked dip (the finder before this ADR).** Rejected. Ranked by score alone, a weeks-old dip on one series can outrank yesterday's on the other, so the card would read `this_month` while a dip that earns `now` sat hidden behind it. That undoes the point of the bands.
5b. **The dip about the newest day (chosen).** `freshestSalesDip` (`recommendations.service.ts`) takes the dip with the smallest readable age. A tie, or no readable age at all, keeps the generator's rank. A dated dip beats an undated or future-dated one wherever it ranks. This is the build's reading. Whether an old newest day should say "the sales read is stale" instead is F1(c).

**AW20: the basis a suggested goal states**

6. **Rewrite the basis and the default names to say what fired (chosen).**
   - Each basis says what fired: whole-check sales through the till, or bottles sold from the cellar log in any house that keeps one. For the weekly slide it can also be one wine's bottles. The entry's own sentence says which.
   - It says why the goal still sits on wine revenue: a goal cannot be held on whole-check sales, and the prescription (top-margin picks, a by-the-glass feature, a staff tasting, a pairing prompt) moves wine revenue.
   - It says the goal records part of what fell, not all of it.
   - The names become "<day> wine revenue, after a soft <day>" and "Wine revenue, after a soft week". They no longer claim that wine revenue is what fell.
   - This is the same pairing ADR 0120's scenario book already makes.
7. **Refuse to suggest a goal for these two rules.** This is a product choice and goes to F2(b).
8. **Add a whole-check sales goal metric now.** Deferred to F2(c). AW17 (gross versus net sales) is about to decide what "sales" means, and a metric added before that decision would be built on a basis that is about to change.

**AW23: one category per insight type**

9. **Reorder `categorize()` so concentration→risk wins.** Rejected. It moves 10 of the 573 catalogue types (measured by compiling the catalogue and diffing the two orders), including both order-count concentrations and six inventory concentrations, to fix one call site.
10. **Derive the category inside `record()` from `categorize()`.** Rejected. A future change to `categorize()` would then silently re-file stored rows without a version bump. A disagreement should be a review event, not a side effect.
11. **The generator follows `categorize()`, and a static spec guards it (chosen).**
    - The vendor-concentration `record()` files under `purchasing` (`insight-generator.service.ts:977-978`).
    - A spec parses every `this.record(` call and checks each against `categorize()`. It resolves the helper's `category` identifier through each time-series call site's literal, and fails on any call shape it cannot read (`apps/api-gateway/src/analytics/insights/insight-implementations.spec.ts:228`, `:308`).
    - `INSIGHT_GENERATOR_VERSION` goes from 3 to 4 (`:161`). Version-3 rows are refused (`.gte`, `:476`) and recomputed on the hourly sweep (`staleVersionCategories`, `:507`).
12. *(Doing nothing.)* The page keeps saying "Tonight" about old days, a basis sentence that is false, and "Nothing live" for a live type.

## Decision

A sales-dip entry takes its urgency from the age of the day it is about. Only a sales-category dip raises it, and where two stand, the one about the newer day. The two sales rules' goal bases say what the rule measured and why the goal sits on wine revenue. Every `record()` files its type under the category `categorize()` gives it, and a spec checks that.

Reasoning:
- "Tonight" is a claim that the day is recent, so only a recent day earns it.
- The page's own principle is "a goal on the wrong figure is worse than no goal". A goal on a related figure is honest only when the page says so.
- The catalogue's taxonomy is the one users browse, so the generator follows it rather than the other way round.

### Edge cases, as built

- **Unreadable or future days.** A `d:` key that is not a real date (`d:2026-02-31`), a non-day grain (`t28:` or `p7:`), no key, or a future date all have no age. They fall into the `this_month` band and are never "Tonight". The undated copy says "how old it is cannot be said".
- **Suppression keys do not change.** A generator dip always carries a weekday subject and a `d:` grain, so `withFiring` keeps its own keys (`apps/api-gateway/src/analytics/insights/suppression.ts:293`). Only a dip with neither a subject nor a period would now be keyed by month rather than day.
- **The score stays 3 in every band.** An old dip ranks where it did. It just no longer says "Tonight".
- **The goal period follows the band.** `periodFor` (`rec-forward.ts:222`) turns `this_month` into a month goal.
- **The digest skips old dips by default.** The default `digest_min_urgency` is `this_week` (`supabase/migrations/20260805000000_baseline_from_production.sql:4939`), so a `this_month` dip is not mailed. The digest row records that the entry stood below the floor.

### Founder forks (not decided here)

- **F1: does a dip older than a week fire at all?**
  - (a) It fires as `this_month`, naming its date and age. **The build reads (a).**
  - (b) A dip older than N days does not fire.
  - (c) An old newest day means the sales data is stale, so the page says that instead of raising a dip.
- **F2: what goal does a sales dip suggest?**
  - (a) Wine revenue, with the honest basis. **The build reads (a).**
  - (b) No goal is suggested for these two rules.
  - (c) A whole-check (or net) sales goal metric, built after AW17 settles gross versus net.

## Consequences

**What gets easier**
- The page and the digest stop calling a stale day urgent.
- A purchasing dip cannot raise a floor-staffing card.
- The catalogue finds vendor concentration under the category it lists.
- A future `record()` that disagrees with `categorize()` fails the spec, and so does any call shape the spec cannot parse.

**What it costs**
- The version bump makes every house's version-3 insight rows refused and recomputed once, across all categories, not only purchasing.
- A dip from 2 to 7 days ago drops from `now` to `this_week`. A dip older than a week drops to `this_month` and leaves the default digest.
- The ADR 0191 claim `ADR-0191-ONE-SHARED-ITEM-STATE` (`CLAIMS.jsonl:597`) pinned `INSIGHT_GENERATOR_VERSION = 3`, and went red on the bump. It is corrected in place to hold the version at 3 or above, which is what it protects: a version-2 row is still refused. It holds at origin/main and here, and fails on version 2 or a renamed constant.

**Revisit when**
- C02 lands a business date (the age should then count house days, not UTC days);
- AW17 settles net sales (F2(c));
- the founder answers F1;
- or a sales rule gains a grain other than `d:`.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-03 | Build (lane `rec`, analytics-walk fixes) | Created, Proposed; F1 and F2 put to the founder |
| 2026-10-03 | Independent verifier, round 1 | One major, two minors. The basis said bottles fire only "where only the cellar log is kept", which is false, because the two families are gated independently; it now says "in any house that keeps one" in rec-forward, the service comment, this ADR and the page note. The `record()` count was 15 copied forward, and is 16 when re-measured. The finder took the first-ranked dip, so a stale one could hide a fresh one; it now takes the newest day (5b). The copy at a whole number of weeks now says "today's <weekday> service". The rec-docket comment that quoted "Tonight" now names the bands. The bodies of commits 426658e36 (the "only the cellar log" basis) and 9dc518115 ("15 `record()` calls") keep the old wording; the branch history is not rewritten, so this row is their correction. |
