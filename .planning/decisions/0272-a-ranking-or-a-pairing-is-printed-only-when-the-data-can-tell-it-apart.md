# 0272 — A ranking or a pairing is printed only when the data can tell it apart

- **Status:** Proposed 2026-10-03. This is a technical-approach choice made under the locked [[0020-no-fabricated-answers]]. The method, alpha 0.05, the 30-check floor, the 5-check pair floor, the 1.3 lift floor and the 1e-9 tie tolerance are the build's picks, **not founder answers**. Three forks (below) stay open and are not taken here. [2026-10-04, settle pass: this line said two; fork 3, the unbounded tie at the restock cut, was found after the record was written.] [2026-10-04, fix round 1: the build bounded that tie (Decision 4, no tie at 0% is extended), which is also the build's pick and not a founder answer; what fork 3 still asks is narrower and stays open.]
- **Date:** 2026-10-03
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** peer_rank, "#1 of N", leaderTest, Welch, Bonferroni, runner-up, pooled rest, adjustedGroupEffects, basket_affinity, pairAssociations, hypergeometric, Fisher exact, pUpper, pAdjusted, C(k,2), lift, chi-square, correlationSignificance, Fisher z, stockout_risk, tie, TIE_TOLERANCE, sameValue, cutKeepingTies, byStockoutRisk, reorderList, restock bars, INSIGHT_GENERATOR_VERSION 4, C14, A-002, A-003, A-070, F-132
- **Links:** [[0020-no-fabricated-answers]] (withhold by default); [[0191-the-recommendations-catalogue-is-actionable-not-a-read-only-leaf]] (the generator version and the stored-row recompute); [[0160-the-founders-sketch-review-what-he-valued-and-what-each-page-becomes]] Q4; the weekday tie precedent at `apps/api-gateway/src/analytics/advanced-analytics.service.ts:575-576`; `claims.d/fix-insights-significance-gates.jsonl`; the analytics walk register, cluster C14 (`p4-scratch/sim-run/register/OWNER-QUARTER-2026Q3.md`, outside the repo) and the lane brief `p4-scratch/sim-run/fixes/briefs/sig.md`

## Context

The owner-quarter sim's analytics walk (Tuzlu Rüzgar, 2026-10-03) read the generator on a house where servers and tables were dealt uniformly and baskets were dealt round-robin. There was nothing to find, and the generator found something every time:

- **A-003 (critical).** "Lucas ranks #1 of 5 by average check" on a 1.0% lead, z 1.61. Over the full window he is last. `peerComparison` names the largest of k means as #1 whatever the gap, and the largest of k noisy means is always ahead of something.
- **A-002 (critical).** A pairing printed as "6.3× more than chance" on 3 co-occurrences. The old pick took the top 3 of about 7,000 pairs by lift, then the first with a χ² p under 0.1. That chooses the rarest pairs, and uses an approximation that is invalid at expected counts below 5. It fired on 200 of 200 shuffled copies of the data.
- **A-070 (minor).** The restock register sorted by stockout probability alone and cut at 25. Five wines tied at 27% straddled the cut, and the two it kept were whichever the database returned first. The stockout insight also named one wine out of an 8-way tie, with a hard-coded `z: 2` and `n: 30` that nothing had measured.

On a fixture built to Tuzlu's shape (`insight-rankings-significance.spec.ts`: 5 servers, 24 tables, a 120-item menu), the code before this record named a #1 server, a #1 table and a pairing on the one 3,300-check Tuzlu-shaped house (3,295 checks as dealt), and on **40 of 40** seeded null houses of 1,200 checks each (1,157 as dealt, plus the two booth checks on even seeds; the spec's calibration run). [2026-10-04, fix round 1: this sentence put the 40-house run at 3,300 checks; it runs at 1,200. Both figures were re-measured on the code at `origin/main` with the spec's own fixture: all three rules fired on the single house, and each fired on 40 of 40.]

## Options considered

1. **Permutation max-T (Westfall–Young).** Exact control of the selection, with no distributional assumption. It costs O(B·N) per generate, on a request path that `/recommendations` reaches on every cold read. Rejected for now. Revisit if the normal approximation is shown to mislead at n ≥ 30.
2. **Benjamini–Hochberg FDR over the pairs.** BH is step-up: when many pairs carry moderate p-values it can admit the smallest-p pair at a threshold looser than α/C(k,2), so it would print more often. What it bounds is the expected share of false pairs among those it admits, not the chance that the one pair printed is noise. Bonferroni (the same as Holm at its first step) bounds that chance under any mix of real and null pairs, and that is the promise one printed sentence makes. On a house with nothing to find, both hold the error at α (BH needs the tests independent or positively dependent; Bonferroni needs nothing). Rejected for a single printed pick; revisit if more than one pairing is ever listed. [2026-10-03, last-call review: this option first said that for one pick BH "buys nothing". That holds for Holm, not for BH's step-up rule; corrected in place.]
3. **χ² with Yates' correction.** It is still invalid at the expected counts the rare pairs have. Rejected; the exact test costs no more.
4. **An effect-size floor alone** (lead ≥ x%, lift ≥ y). It does not control noise: the largest of k means and the rarest of 7,000 pairs clear any fixed floor by chance. Kept only as a second gate (the 1.3 lift floor), never as the test.
5. **Mann–Whitney for the ranking.** It tests a shift in the distribution, not the mean that the sentence ("by average check") names. Rejected.
6. **Print "tied with N others"** instead of withholding. That is new copy, and so a product choice. Deferred (fork 2).
7. **Trim the cut to just before the tie group.** When the top group is larger than the cut, this returns zero rows. Rejected; the cut grows instead.
8. **A tie at display precision** (both print "27%"). That would call 26.8% and 26.9% tied. Rejected.
9. **A tie as exact bit equality.** This was the plan's definition. It failed on the data: five wines at 22.5 days of cover share one probability in exact arithmetic, and floating point returned 0.26844096449466426, …370 and …437, depending only on how many bottles each sold. Bit equality would have called them five different risks and ranked them by rounding error. Rejected, and the plan is corrected (see Decision 4).
10. **Do nothing.** The generator keeps naming a #1 and a pairing on every null house. That breaks ADR 0020. Rejected.

## Decision

A "#1", a pairing or a list cut is printed only when the data separates it from what it is ranked against. Otherwise it is withheld (ADR 0020). The rules:

1. **Ranking** (`leaderTest`, `engine/comparisons.ts:436`). A server or table is eligible at 30 or more checks (`MIN_RANK_N`). The leader is printable only when both of these reject at alpha 0.05 (`SIGNIFICANCE_ALPHA`):
   - (i) a one-sided Welch z of the leader against the **runner-up** (the tie check);
   - (ii) a one-sided Welch z of the leader against the **pooled rest**, with p multiplied by k, the number of eligible groups (Bonferroni, because the leader was picked as the maximum of k).

   The pooled rest is rebuilt from each group's n, mean and variance. One group's outliers (Tuzlu's two $3,400 booth checks) therefore inflate that group's variance instead of crowning it. A **waiter's** lead must also survive table adjustment: if the table-adjusted fit (`adjustedGroupEffects`) puts another eligible server on top, nothing is printed. The old "X actually adds the most per check" clause was a second ranking claim that no test stood behind, so it is removed. The record's `z` is the leader-vs-rest z, and its `n` is the leader's checks.
2. **Correlation clause** (`correlationSignificance`, `comparisons.ts:518`). The table/attribute correlation needs Fisher's z = atanh(r)·√(n−3), two-sided, with Bonferroni over the attributes actually tested, on top of the existing |r| ≥ 0.35.
3. **Pairing** (`hypergeometricUpperTail`, `engine/association.ts:67`).
   - Each pair gets the exact one-sided hypergeometric (Fisher) upper tail, `pUpper`.
   - The family is C(k,2), where k is the number of items on at least 5 checks (`BASKET_MIN_COUNT`), and `pAdjusted = min(1, C(k,2)·pUpper)`.
   - A pair is printable when it is on at least 5 checks, has lift ≥ 1.3 (`BASKET_MIN_LIFT`) and has `pAdjusted` ≤ 0.05.
   - The pick is the smallest `pUpper`, then the larger count, then code-unit order of the names. Picking one of several pairs that each passed is a choice of which true sentence to show, not a ranking claim, so a deterministic order is enough here.
   - The score's z is −Φ⁻¹(pUpper), capped at 8. χ² stays on the record as a description and is never a gate.
   - The descriptive `/analytics/basket` endpoint (`table-analytics.service.ts:511`) keeps its own floor and sort, and only gains the new fields.
4. **Ties** (`sameValue`, `TIE_TOLERANCE = 1e-9`, `comparisons.ts:270`). Two computed values are tied when they are equal to within 1e-9 of the larger magnitude, or absolutely when below 1. That is six or more orders of magnitude finer than the finest print of the values it compares (a stockout risk to a tenth of a percent), and about seven above double rounding. Ties are judged on the computed value, never on its printed rounding.
   - A tied #1 is withheld. This follows the weekday precedent at `advanced-analytics.service.ts:575-576`.
   - A list cut never splits a tie group above 0% (`cutKeepingTies`, `comparisons.ts:300`). The server's restock list (`analytics.service.ts:694`) grows past 25, and the web's 14 restock bars grow past 14 (`rp-registers-house.tsx:596`).
   - **A tie at 0% is never extended** (`extendOnlyAbove: 0`; the bars stop at 14 when bar 14 reads 0% or nothing). That group is every wine with no demand in the window and nothing on hand, sitting at or under a reorder point of 0. It has no risk to rank, and extending through it listed all of it: 5 wines with demand and 40 without gave 45 rows, and 11 and 400 gave 411. When the 25th row (the 14th bar) falls in it, the cut fills to 25 (14) in the order below, as the code before this record did in database order. No wine at risk can sit behind a listed 0% row, because every risk above 0% sorts first. Above 0% the growth is bounded by the wines that sold in the window and share the edge's exact risk. In the one-day demand shape (F-129) that is every wine that sold and now holds nothing (8 on Tuzlu, at 61%), and each such row is a wine to buy back. [2026-10-04, fix round 1: added. Rejected for the bound: a fixed cap on the extension, which splits a tie above 0% again and brings A-070 back; trimming before the group (Option 7); and leaving 0% rows out of the list, which drops rows the register showed before and is fork 3's question.]
   - Order inside a group comes from the data, never from database order (`byStockoutRisk`, `comparisons.ts:329`): fewest days of cover, unmeasured last, then fewest bottles, then name, then id.
5. **No fabricated statistics.** The stockout record carries `z: null`, because a probability has no test statistic. Its `n` is the observed demand rows, and its `peerCount` is the wines actually ranked, not every inventory row.
6. **`INSIGHT_GENERATOR_VERSION` becomes 4.** A version-3 row may hold any of the withdrawn sentences, so under ADR 0191's rule it is recomputed on first read, not served.

What carried it: every sentence above is a claim that one thing differs from others, and on a null house the old code made each of them every time. A per-entity test that is corrected for the selection, and computed in closed form, is the cheapest rule that makes those claims answerable on the request path.

### Measured power and null rate

Measured on the fixture's generator with seeded houses (a throwaway spec, not kept, so this table cannot be re-run from the repo; the committed specs pin only the null-house silence and the planted cases). Every time a planted effect fired, it named the planted entity. The lane verifier's independent fixture agreed in direction, not in every figure: a ×1.08 server found in 219 of 300 runs (73%, against 84% here), a pair on 2% of checks in 60 of 60, and a null pairing in 2 of 300.

| Case | Fired |
|---|---|
| Null house, 1,200 checks: waiter / table / pair | 2/200, 0/200, 1/200 |
| Null house, 3,300 checks: waiter / table / pair | 0/100, 0/100, 1/100 |
| One server ×1.04 / ×1.06 / ×1.08 / ×1.12 (about 660 checks each) | 6/50, 21/50, 42/50, 50/50 |
| One server ×1.12, with the booth checks on another server | 15/50 |
| One table ×1.1 / ×1.2 / ×1.3 (about 138 checks each, 24 tables) | 1/50, 25/50, 48/50 |
| A pair together on 1% of checks (printed lift about 1.8) | 23/50 |
| A pair together on 2% or more (lift 2.1, 2.5, 2.9) | 50/50 |

A house of Tuzlu's size will therefore hear about a server whose checks run about 8% higher, a table about 20–30% higher, and a pair together on about 2% of checks. Smaller effects are withheld. That is the price of not naming noise.

## Consequences

- **Easier.** On a null house the waiter, table and pairing records almost always stay silent: the measured rate is 0–1% per rule (table above), and the 40-house spec allows at most 2 firings per rule. The contract is a bounded error rate, not zero. The stockout record no longer names one wine out of a tie. The restock list and bars no longer depend on database order.
- **Given up.** Real but small leads go unsaid. Booth-sized outliers on a runner-up cut the waiter rule's power sharply (50/50 down to 15/50 in the table above), because they widen that server's variance. The restock list can run past 25 rows, and the bars past 14, when a tie above 0% straddles the cut. ~~Nothing bounds how far.~~ The one large tie in practice was the 0% group (fork 3): a probe with 5 wines below their reorder point that have measured demand and 40 with none and nothing on hand listed all 45, where the code before this record listed 25. [2026-10-04, settle pass: the bound was missing here; added.] [2026-10-04, fix round 1: bounded. A 0% tie is no longer extended (Decision 4), and the same probe lists 25 (`restock-cut-keeps-ties.spec.ts`). When the 25th row is a 0% wine, the 0% rows shown are the first by bottles, name and id, so the page's "the N at the highest risk are listed" holds for every wine at risk and only orders the riskless rest.]
- **The stockout record scores lower.** `scoreOf` weighs effect and z equally. The hard-coded `z: 2` gave the significance half 2 of its 3, and the hard-coded `n: 30` gave full support. With `z: null` the significance half is 0, and with `n` = observed demand rows, support is discounted below 14 rows. A 61% risk on 14 or more rows scores 2.25 where it scored 3.75. The record now ranks below insights that carry a measured z, and it can fall under its category's cap (`maxPerCategory`, `insight-generator.service.ts:330-338`) where it sat above it before. That is the cost of not printing a statistic nobody measured. [2026-10-04, fix round 1: added; the commit that made the change did not say so.]
- **Cache.** Version-3 rows are recomputed on first read after deploy (ADR 0191). Lanes `cap` and `rec` also touch the generator. Whichever merges second rebases its version bump onto this one (5, not a second 4).
- **The CLAIMS row `ADR-0191-ONE-SHARED-ITEM-STATE`** pinned `INSIGHT_GENERATOR_VERSION = 3;`. Its verify is amended in place to read a version of 3 or more, so ADR 0191's check outlives every later bump.
- **Revisit when:** a founder or owner reports a withheld lead they could see on the floor (power too low), or a printed #1 or pairing fails a shuffled-data replay on a real house (the normal approximation misleads). Either one reopens Option 1.

## Not covered

- `table.avg_check.driver_weights`: a ridge fit printed on r² > 0.15, with no test.
- Multiplicity across the whole feed (many rules, one owner reading them).
- F-132, the twin finding on another surface.
- The C15 sample cap (the Lucas inversion itself) and the C05 dating.
- Dependence within a party or a set menu: checks are treated as independent.
- The `stockout_imminent` card.
- The descriptive staff and table registers in `table-analytics.service.ts` (`:279-289`, `:456-466`). Every row there carries an untested `peerComparison` `rank` and `pctVsMean`. No web, mobile or export surface reads `rank` (a grep of `apps/web/src`, `apps/mobile` and `report-export-cuttings.ts` finds none). The Reports staff register lists every server in order and says the raw ranking is all there is (`rp-registers-house.tsx:558`). This record gates only the generator's insights, not those fields. [2026-10-04, fix round 1: this line said these registers "claim no #1". That held for what is printed, not for the `rank` field the endpoint returns.]

## Forks (open, not taken here)

- **Fork 1 — A-069, per-rule naming.** Should /recommendations name which rules could not be judged (ADR 0160 Q4's "field next"), or keep the corrected substitute sentence? Recommendation (a), the corrected sentence now, is planned for PR-2 (branch `fix/all-clear-over-partial-reads`, not built when this record was written). Answer (b) would need an ADR 0160 bracket.
- **Fork 2 — the "no separable leader" copy.** Should a withheld #1 say so ("no server stands apart yet") or stay silent? This record only withholds, which ADR 0020 already requires. Any wording is a product choice.
- **Fork 3 — a long tie at the restock cut.** The cut grows through any tie at row 25 (bar 14), with no bound. A wine below its reorder point that has measured demand carries a risk of at least 1 − the service level (its on-hand is at most the reorder point), so the only large tie in practice is the 0% group: wines with no measured demand in the window and nothing on hand, below a reorder point of 0. When fewer than 25 wines below their reorder point have measured demand (fewer than 14 for the bars), the edge lands in that group and all of it joins the list and the bars. Before this record, 25 rows and 14 bars were shown and database order chose the extras. Options:
  - (a) Keep it. The list is true, and the table, which is the register's first view, is read row by row.
  - (b) Keep the table whole but leave the 0% group out of the bars. A 0% bar has no height and ranks nothing.
  - (c) Stop the cut before an edge tie larger than the cut and print "and N more tied at P%". That is new copy.

  Recommendation: (b). The table keeps the tie rule whole, and the chart stops filling with empty bars. This is a presentation choice, so it is not taken here; the build ships (a).

  [2026-10-04, fix round 1: (a) no longer ships. The lane verifier rated the unbounded growth major, so the build bounded it (Decision 4): neither cut extends through a 0% tie, and both fill to 25 rows and 14 bars as before this record, in the data's order. That restores the row and bar counts the page had. It adds no copy and removes no row the page listed before, so it was taken as a fix to this record's own regression, not as an answer to this fork. What the fork still asks: should 0% rows be listed and drawn at all? Option (b) leaves them out of the bars. A further option leaves them out of the list and lets the count carry them ("N more below their reorder point have no demand to judge"), which is new copy. Recommendation unchanged: (b).]

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-03 | — | Created, lane `sig` PR-1 (branch `fix/insights-significance-gates`) |
| 2026-10-03 | Lane verifier | Pass at `ee14215d7`; minor prose points only |
| 2026-10-03 | Last-call review | Four prose corrections in place: Option 2 (BH), Decision 4 (tolerance), Consequences (null rate) and Fork 1 (PR-2 not built). No rule changed |
| 2026-10-04 | Settle pass | Kept the last-call corrections; added BH's dependence condition to Option 2, the unbounded restock tie to Given up, and fork 3. No rule changed |
| 2026-10-04 | Fix round 1 (lane verifier) | One rule changed: no tie at 0% is extended (Decision 4), which bounds the restock cut. Context's 40-house run corrected to 1,200 checks (re-measured on `origin/main`). The stockout score drop and the `rank` field in table analytics are now disclosed |
