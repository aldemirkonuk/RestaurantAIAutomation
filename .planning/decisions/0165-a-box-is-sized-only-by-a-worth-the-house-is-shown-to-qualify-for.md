# 0165 — A box is sized only by a worth the house is shown to qualify for

- **Status:** Locked **[2026-09-19, founder via `AskUserQuestion` ~09:20Z, the "19-lane blocking answers" round: "LOCK AS WRITTEN (fixed 180-day comparison age, largest-single-order volume)" — founder-sketch-decisions-106-115.md:134-135]**. The founder answered three of the forks (below, in his words) and delegated the fourth; the founder locks it, an agent does not.
- **Date:** 2026-09-19
- **Decider:** Aldemir (founder)
- **Keywords:** promotions, offer-grade, worth, box size, tier, hero, minimum quantity, MOQ, qualify, comparison price, recency, stale price, COMPARISON_MAX_AGE_DAYS, ADR 0020, rankOffers
- **Links:** ADR 0160 §113 (the "answered 2026-09-18" block: "structural system, priorities must come first"; on `wt-review`/`wt-finish-train2`, not yet on `main`) · [[0020-no-fabricated-answers]] · [[0119-an-agreed-price-states-its-unit]] · [[0117-a-price-sighting-names-its-source-its-date-and-its-unit]] · `apps/api-gateway/src/promotions/offer-grade.ts` · `apps/web/src/pages/promotions/next/promotions-format.ts`

## Context

ADR 0160 §113 recorded the founder's answer to the box-sizing research: a bigger box means money worth to the house, shown as an estimate, only when the house qualifies, with the ranking rules (offer qualifies, worth is real, comparison price is recent) settled before any box is sized, in tiers (at most one hero, up to three larger cards, then compact). It named the gap: the grader never read an offer's minimum quantity, and sized by dollar worth while printing a percentage. Facts established before deciding (2026-09-19):

- The minimum already reaches the wire as `provider_promotions.conditions.min_qty` (`promotion-extractor.service.ts:117`), but with **no unit**, and the regex behind it (`promo-extract.ts:236-244`) also reads `12` out of "cases of 12" (a pack size) and drops whether "12+" means bottles or cases. No writer sets a `min_qty_unit`.
- The house's buying volume already exists as `purchaseRate()`, a 540-day per-wine **sum**. A vendor's minimum is per **order**, so the two are different quantities.
- `bestElsewhere` had no age limit: anything inside the 540-day ledger window counted.
- `rankOffers` gave every worth-bearing non-hero offer the same `regular` tier.
- Both production tables that could calibrate any of this (`provider_promotions`, `price_history` bottle rows) held zero rows on the project queried, so nothing here is tuned against live data.

## Options considered

**Volume to compare against a minimum.** (a) Window total, `purchaseRate()`'s sum: simple and consistent with worth, but a house buying 2 a month "qualifies" for a 12-bottle minimum it has never ordered at once. (b) A house-entered typical order: closest to intent but a new setting and new data nobody has typed. (c) **Largest single order, one vendor on one day, summed across the offer's named wines, in the minimum's own unit.** Chosen (delegated to the assistant by the founder: "highest quality best coverage with best scalability, you decide").

**A minimum with no unit.** Assume the house's own unit (guesses; would read "12 cases" as 12 bottles). Fix the extractor first (delays everything). **Withhold the worth and say why**, chosen by the founder.

**Comparison-price age.** The founder asked how finance and adjacent industries handle it. Finding: **no source fixes a universal maximum age.** IFRS 13 / ASC 820, SEC Rule 2a-5 and FINRA 5310 say "current" and leave the number to written policy; bank IPV verifies at least monthly by market; FRTB is the one numeric regime and is adaptive (enough real observations in a rolling window, only real trades count). Adjacent industries use a fixed default with a stated-reason override: appraisal 12 months, procurement bid validity 90 days, EU price claims 30 days, wholesale price posting monthly. No source publishes an adaptive formula. Options: a fixed 90, 180 or 365 days; or an adaptive multiple of the house's own purchase cadence. **Fixed 180 days, one named constant**, chosen by the assistant from that bracket; the adaptive rule is left open (item 2 below).

**Where the tiers live.** Move ranking into the gateway; or keep it in the web `rankOffers`. **Keep in web**, chosen by the founder.

Rejected within the recency rule: pricing the worth against the cheapest *fresh* line when the cheapest overall is stale. It would recover coverage, but the worth and the printed verdict would then compare against different lines.

## Decision

**A worth may size a box only when the offer qualifies, the worth is real, and the comparison price is recent; all three are enforced in `offer-grade.ts` (the gateway), and `rankOffers` sizes in the founder's band.**

The written rule (ADR 0020: money states its rule):

1. **Qualifies.** The offer's minimum (`OfferForGrade.minimum`) is compared with the house's *largest single order* of the offer's named wines. An order is one vendor on one day (a line with no date is its own order). Its size is the sum, in the minimum's unit, of those wines bought in it. Lines in another unit contribute nothing and are never converted. The stored quantity is a floor (unrecorded defaults to 1), so the states are `qualifies` and `not_shown`, never "does not qualify". A minimum with no unit, or a unit outside the seven the ledger holds, is `unit_unknown`. No stated minimum means no qualification is stated (`qualification: null`) and the worth stands. `not_shown` and `unit_unknown` set every wine's `worth` to `null` with the reason in `worthWithheld`, so a bundle's all-or-nothing rollup withholds too.
2. **Worth is real.** As before: a comparison line in the same unit and money, and a positive purchase rate. A box is sized only by a worth above zero.
3. **Comparison is recent.** `bestElsewhere` must be at most `COMPARISON_MAX_AGE_DAYS` (180) days old on the day of grading. An undated line, or one dated after today, withholds. The printed worth carries the comparison date, its age and the limit (FRTB/IPV practice: record the date, the cutoff and the reason so it can be re-checked). The verdict and delta are **not** gated: they state what the house last paid, with its date.
4. **Tiers.** `hero` for the top offer with a positive worth; `large` for the next three; everything else, including a worth at or below zero, `compact`. Constant `LARGE_TIER_MAX = 3`.

## Consequences

- **Every stored offer that has a minimum is unsized today**, because the extractor writes no unit. That is the founder's rule working as chosen, not a regression: those offers appear as compact tiles with "…without saying bottles or cases, so it cannot be shown whether the house qualifies — not sized".
- **Pack sizes are not separated when counting an order.** A 375 ml and a 750 ml line are both "bottle" and both count toward a bottle minimum. Unlike a price, a quantity toward a minimum has no ADR-0124 rule yet; this can overstate qualification for a mixed-size house.
- **`quantity` is a floor**, so `not_shown` may hide an offer the house could take. The bias is toward under-sizing, never over-sizing.
- 180 days is a judgment inside a researched bracket, not a measured value. Revisit when a house has real invoice history to measure how often the cheapest other-vendor price moves.
- The card's worth line still says "bottle(s)" regardless of the worth's unit; not touched here.
- **Bundle line with no comparison stays excluded — answered, not open.** Founder, "Lane answers batch 2" ~09:30Z, founder-sketch-decisions-106-115.md:141: "promos bundle line with no comparison = keep excluding." A bundle line that grades `no_elsewhere` is excluded from the bundle's aggregate `worth`, the same as any other line lacking one — exactly what `bundleWorth`'s all-or-nothing rollup (`offer-grade.ts`) already does. The (baseline − offered) alternative described in that function's doc comment was not chosen. No code change; the comment there is bracket-corrected to point here.
- **The draft-order panel belongs to `/orders`, as its own follow-up lane — answered, not open.** Founder, same batch, founder-sketch-decisions-106-115.md:141: "promos draft-order panel = /orders, own lane." Until that lane ships, today's legacy link (`OfferCard.tsx:215`, `OfferSheet.tsx:181`: `/orders?new=1&promo=<id>`) stays.
- **The 540-day ledger window is confirmed, not merely carried over.** Founder, "Lane answers batch 3" ~09:45Z, founder-sketch-decisions-106-115.md:143: "promos grade window = keep trailing 540 days." `LEDGER_WINDOW_DAYS` (`promotions.service.ts`) does not change; only its status does — see the bracket there.
- **The theme/ground question is superseded here, not answered here.** The founder's 2026-09-19 cross-cutting theme decision (same batch, founder-sketch-decisions-106-115.md:143-146: default ground white/paper, a per-person choice of charcoal; revises ADR 0149 row 6; owned by ADR 0169 in lane 'theme') supersedes any earlier read of this page's hardcoded `ground="charcoal"` (`PromotionsNext.tsx`: `claimMudavymShell(id, 'charcoal')` and `<HouseHeader ... ground="charcoal" />`) as settled. This lane changes nothing about the ground; ADR 0169 owns it.
- **Open items** (not filed in `OPEN-DECISIONS.md`: a new row at the top shifts about 173 citations, `register-row-shifts-citations`; file them with the next batch):
  1. **Extractor must capture the minimum's unit** and stop reading a pack size as a minimum ("cases of 12"). Until then every minimum is `unit_unknown`.
  2. **Adaptive recency**, scaling the age limit to how often the house buys the wine (FRTB-style), instead of one fixed 180.
  3. **Per-wine versus mixed minimums.** The rule sums across the named wines in one order; an offer whose minimum is per wine reads more permissively.
  4. **Ads** (ADR 0160 open item 9) are unaffected and stay open.
  5. **Trusted senders and Prospects on `/promotions` — record superseded by a live change, verify before reuse.** ADR 0160 open item 3 was answered 2026-09-18 (founder via `AskUserQuestion`): they move to `/communications` with their hold-to-trust and add-vendor acts; `/promotions` holds offers only. This ADR's build (00:05, 2026-09-19) kept them on `/promotions` as a disclosed interim (`SendersProspectsPanel.tsx`), because `/communications` (next) had none of this code (measured then: `grep -c "sender_reputation\|/senders/trust\|/prospects" apps/web/src/pages/communications/next` = 0). **As of this note (2026-09-19 ~10:56 ET), `SendersProspectsPanel.tsx` is gone and `PromotionsNext.tsx` instead links out to `/communications`** (an edit this lane did not make — file mtimes place it at 10:50-10:52, after this ADR's own build finished, from an untraced process). Re-measured just now: `communications/next` still has zero sender-reputation, trust-toggle or prospects code (same grep, and no `WhoIsWriting.tsx` file, though `PromotionsNext.tsx:15` now names one) — so trust-a-sender and prospect promote/dismiss/restore appear **unreachable in the product right now**, the exact regression the interim panel existed to avoid. Not fixed here: verify this reading against a live app check before treating it as settled, and route it to whoever owns that edit.
  6. **A source-email link on the offer detail sheet** (viewing the vendor email an offer was extracted from) is not built. Founder, "Lane answers batch 3" ~09:45Z, founder-sketch-decisions-106-115.md:142: "promos source-email link = 'build it later, document it'" (his exact words) — recorded here as a named follow-up, not scheduled.
- Not verified here: any live-data behaviour (no rows), the rendered page in a browser, and CI on this branch.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-19 | founder (chat) | Answered: unit-less minimum withholds; tiers stay in the web `rankOffers`; volume basis delegated ("you decide"); recency: "find how finance companies or other related industry jobs handles it" |
| 2026-09-19 | assistant | Two research agents (finance; adjacent industries) found no fixed standard; chose fixed 180 days and largest single order. No adversarial fan-out was run on the two delegated choices (CLAUDE.md §3 shortcut, named per §0.5) **[moot 2026-09-19: the founder locked both delegated choices as written via `AskUserQuestion` (~09:20Z, row below); no further adversarial pass is owed]** |
| 2026-09-19 | founder (`AskUserQuestion`, ~09:20Z, "19-lane blocking answers") | **Locked as written**: fixed 180-day comparison age; largest-single-order volume basis. Both delegated choices confirmed with no changes (founder-sketch-decisions-106-115.md:134-135). |
| 2026-09-19 | assistant (promos repair pass, r4 round 2) | Every founder-sketch-decisions-106-115.md citation in this ADR had drifted 3-4 lines low against the live file (it grew between when they were written and this pass). Re-measured with `grep -n` and corrected in place: 130-132→134-135 (Status, this row), 138→141 (bundle line + draft-order panel), 140→143 (540-day window), 139-142→143-146 (theme), 139→142 (source-email). Quoted text re-confirmed word-for-word unchanged; only the line pointers moved. Did not touch the ADR-0160-PROMOTIONS-OFFERS-ONLY CLAIMS regression (`.planning/decisions/CLAIMS.jsonl:365`) — outside this lane's scope; see Open item 5. |
