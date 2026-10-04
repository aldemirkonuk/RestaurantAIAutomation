# 0272 — A ranking or a pairing is printed only when the data can tell it apart

- **Status:** Proposed 2026-10-03. This is a technical-approach choice made under the locked [[0020-no-fabricated-answers]]. The method, alpha 0.05, the 30-check floor, the 5-check pair floor, the 1.3 lift floor and the 1e-9 tie tolerance are the build's picks, **not founder answers**. Two product forks (below) stay open and are not taken here.
- **Date:** 2026-10-03
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** peer_rank, "#1 of N", leaderTest, Welch, Bonferroni, runner-up, pooled rest, adjustedGroupEffects, basket_affinity, pairAssociations, hypergeometric, Fisher exact, pUpper, pAdjusted, C(k,2), lift, chi-square, correlationSignificance, Fisher z, stockout_risk, tie, TIE_TOLERANCE, sameValue, cutKeepingTies, byStockoutRisk, reorderList, restock bars, INSIGHT_GENERATOR_VERSION 4, C14, A-002, A-003, A-070, F-132
- **Links:** [[0020-no-fabricated-answers]] (withhold by default); [[0191-the-recommendations-catalogue-is-actionable-not-a-read-only-leaf]] (the generator version and the stored-row recompute); [[0160-the-founders-sketch-review-what-he-valued-and-what-each-page-becomes]] Q4; the weekday tie precedent at `apps/api-gateway/src/analytics/advanced-analytics.service.ts:575-576`; `claims.d/fix-insights-significance-gates.jsonl`; the analytics walk register, cluster C14 (`p4-scratch/sim-run/register/OWNER-QUARTER-2026Q3.md`, outside the repo) and the lane brief `p4-scratch/sim-run/fixes/briefs/sig.md`

## Context

The owner-quarter sim's analytics walk (Tuzlu Rüzgar, 2026-10-03) read the generator on a house where servers and tables were dealt uniformly and baskets were dealt round-robin. There was nothing to find, and the generator found something every time:

- **A-003 (critical).** "Lucas ranks #1 of 5 by average check" on a 1.0% lead, z 1.61. Over the full window he is last. `peerComparison` names the largest of k means as #1 whatever the gap, and the largest of k noisy means is always ahead of something.
- **A-002 (critical).** A pairing printed as "6.3× more than chance" on 3 co-occurrences. The old pick took the top 3 of about 7,000 pairs by lift, then the first with a χ² p under 0.1. That chooses the rarest pairs, and uses an approximation that is invalid at expected counts below 5. It fired on 200 of 200 shuffled copies of the data.
- **A-070 (minor).** The restock register sorted by stockout probability alone and cut at 25. Five wines tied at 27% straddled the cut, and the two it kept were whichever the database returned first. The stockout insight also named one wine out of an 8-way tie, with a hard-coded `z: 2` and `n: 30` that nothing had measured.

On a fixture built to Tuzlu's shape (`insight-rankings-significance.spec.ts`, 3,300 checks, 5 servers, 24 tables, a 120-item menu), the code before this record named a #1 server, a #1 table and a pairing on **40 of 40** null houses.

## Options considered

1. **Permutation max-T (Westfall–Young).** Exact control of the selection, with no distributional assumption. It costs O(B·N) per generate, on a request path that `/recommendations` reaches on every cold read. Rejected for now. Revisit if the normal approximation is shown to mislead at n ≥ 30.
2. **Benjamini–Hochberg FDR over the pairs.** One pairing is printed. For a single pick, BH at its first step, Holm and Bonferroni are the same threshold, so BH buys nothing. Rejected.
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

1. **Ranking** (`leaderTest`, `engine/comparisons.ts:421`). A server or table is eligible at 30 or more checks (`MIN_RANK_N`). The leader is printable only when both of these reject at alpha 0.05 (`SIGNIFICANCE_ALPHA`):
   - (i) a one-sided Welch z of the leader against the **runner-up** (the tie check);
   - (ii) a one-sided Welch z of the leader against the **pooled rest**, with p multiplied by k, the number of eligible groups (Bonferroni, because the leader was picked as the maximum of k).

   The pooled rest is rebuilt from each group's n, mean and variance. One group's outliers (Tuzlu's two $3,400 booth checks) therefore inflate that group's variance instead of crowning it. A **waiter's** lead must also survive table adjustment: if the table-adjusted fit (`adjustedGroupEffects`) puts another eligible server on top, nothing is printed. The old "X actually adds the most per check" clause was a second ranking claim that no test stood behind, so it is removed. The record's `z` is the leader-vs-rest z, and its `n` is the leader's checks.
2. **Correlation clause** (`correlationSignificance`, `comparisons.ts:503`). The table/attribute correlation needs Fisher's z = atanh(r)·√(n−3), two-sided, with Bonferroni over the attributes actually tested, on top of the existing |r| ≥ 0.35.
3. **Pairing** (`hypergeometricUpperTail`, `engine/association.ts:67`).
   - Each pair gets the exact one-sided hypergeometric (Fisher) upper tail, `pUpper`.
   - The family is C(k,2), where k is the number of items on at least 5 checks (`BASKET_MIN_COUNT`), and `pAdjusted = min(1, C(k,2)·pUpper)`.
   - A pair is printable when it is on at least 5 checks, has lift ≥ 1.3 (`BASKET_MIN_LIFT`) and has `pAdjusted` ≤ 0.05.
   - The pick is the smallest `pUpper`, then the larger count, then code-unit order of the names. Picking one of several pairs that each passed is a choice of which true sentence to show, not a ranking claim, so a deterministic order is enough here.
   - The score's z is −Φ⁻¹(pUpper), capped at 8. χ² stays on the record as a description and is never a gate.
   - The descriptive `/analytics/basket` endpoint (`table-analytics.service.ts:430`) keeps its own floor and sort, and only gains the new fields.
4. **Ties** (`sameValue`, `TIE_TOLERANCE = 1e-9`, `comparisons.ts:270`). Two computed values are tied when they are equal to within 1e-9 of the larger magnitude, or absolutely when below 1. That is nine orders of magnitude below anything this product prints and seven above double rounding. Ties are judged on the computed value, never on its printed rounding.
   - A tied #1 is withheld. This follows the weekday precedent at `advanced-analytics.service.ts:575-576`.
   - A list cut never splits a tie group (`cutKeepingTies`, `comparisons.ts:292`). The server's restock list (`analytics.service.ts:691`) grows past 25, and the web's 14 restock bars grow past 14 (`rp-registers-house.tsx:520`).
   - Order inside a group comes from the data, never from database order (`byStockoutRisk`, `comparisons.ts:314`): fewest days of cover, unmeasured last, then fewest bottles, then name, then id.
5. **No fabricated statistics.** The stockout record carries `z: null`, because a probability has no test statistic. Its `n` is the observed demand rows, and its `peerCount` is the wines actually ranked, not every inventory row.
6. **`INSIGHT_GENERATOR_VERSION` becomes 4.** A version-3 row may hold any of the withdrawn sentences, so under ADR 0191's rule it is recomputed on first read, not served.

What carried it: every sentence above is a claim that one thing differs from others, and on a null house the old code made each of them every time. A per-entity test that is corrected for the selection, and computed in closed form, is the cheapest rule that makes those claims answerable on the request path.

### Measured power and null rate

Measured on the fixture's generator with seeded houses (a throwaway spec, not kept). Every time a planted effect fired, it named the planted entity.

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

- **Easier.** On a null house the waiter, table and pairing records are silent (the 40-house spec allows at most 2 firings per rule). The stockout record no longer names one wine out of a tie. The restock list and bars no longer depend on database order.
- **Given up.** Real but small leads go unsaid. Booth-sized outliers on a runner-up cut the waiter rule's power sharply (50/50 down to 15/50 in the table above), because they widen that server's variance. The restock list can run past 25 rows, and the bars past 14, when a tie straddles the cut.
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
- The descriptive staff and table rankings in `table-analytics.service.ts`, which print every row and claim no #1.

## Forks (open, not taken here)

- **Fork 1 — A-069, per-rule naming.** Should /recommendations name which rules could not be judged (ADR 0160 Q4's "field next"), or keep the corrected substitute sentence? Recommendation (a), the corrected sentence now, ships in PR-2. Answer (b) would need an ADR 0160 bracket.
- **Fork 2 — the "no separable leader" copy.** Should a withheld #1 say so ("no server stands apart yet") or stay silent? This record only withholds, which ADR 0020 already requires. Any wording is a product choice.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-03 | — | Created, lane `sig` PR-1 (branch `fix/insights-significance-gates`) |
