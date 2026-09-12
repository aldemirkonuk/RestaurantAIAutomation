/**
 * What each cited page actually said, on the day it was read.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `goal-scenarios.ts` shipped a labour-cost range quoting *"fullservice
 * operators who reported a pre-tax profit … a median of 34.2% of sales"* and
 * cited the NRA's **labour-costs** page. An auditor fetched that exact URL on
 * 2026-09-04: it carries 36.5% and 31.7% verbatim and contains neither "34.2"
 * nor "pre-tax". The clause was true — it is on the NRA's **profitability**
 * page — but the citation beside it was not, and nothing could tell.
 *
 * That is the worst failure mode this catalogue has, because it is invisible:
 * a wrong number with a real URL and a plausible date reads exactly like a
 * right one, and the whole argument for showing operator ranges at all is that
 * each one carries a source a reader can check.
 *
 * Re-reading every citation on 2026-09-04 found the same class of defect four
 * more times, listed here so the count is on the record rather than tidied
 * away:
 *
 *   1. `labour-cost-ratio` cited the labour-costs page for a clause only the
 *      profitability page carries. Repointed.
 *   2. `restock-before-the-shelf-empties` and `on-time-delivery` quoted
 *      *"typical benchmarks between 85% and 95%"*, *"high performers above
 *      95%"* and *"90% on-time within 48 hours"* against the DCL fill-rate
 *      page. **None of those three phrases is on it** — they came from a
 *      search-result summary that had blended several pages. Cut to the one
 *      figure DCL actually publishes.
 *   3. `hold-purchasing-spend` and `food-cost-ratio` carried `2025-08-27`,
 *      which is the labour-costs page's date. The food-cost page is
 *      2025-09-10.
 *   4. Three rows carried a bare year for pages that **show no date at all**
 *      (Restaurant365, TouchBistro, Vast CFO). They now say `undated`, and
 *      this file records that the page shows none.
 *   5. `revpash` quoted concept figures ($150 checks, 45-minute turns) against
 *      a Black Box Intelligence glossary URL that **403s to this fetcher**.
 *      The figures came from a third page. The row now quotes no figure at
 *      all, which is the only honest thing to do with a source we cannot read.
 *
 * WHAT AN ENTRY IS
 * ----------------
 * `excerpt` is verbatim text returned by fetching `url` on `fetchedAt`. It is
 * deliberately short — enough to carry the figures a scenario quotes and
 * nothing more. `pageDate` is the date the PAGE states about itself, or `null`
 * when it states none; `goal-scenarios.spec.ts` requires a row's `published`
 * to agree with it, so "the page is undated" can never quietly become a year.
 *
 * A source that could not be fetched is recorded with `excerpt: null` and the
 * status. The test then forbids any FIGURE being quoted against it: an
 * unreadable source may be named, never quoted.
 *
 * MAINTENANCE
 * -----------
 * This is evidence, not configuration. Re-fetching a page and finding it
 * changed is a real event: update the excerpt AND the row that quotes it in the
 * same change, and move `fetchedAt`. Do not edit an excerpt to make a test
 * pass — that inverts the whole mechanism.
 */

export interface OperatorSourceFixture {
  /** The publisher, as the scenario names it. */
  readonly source: string;
  /** ISO date this text was fetched. */
  readonly fetchedAt: string;
  /** Verbatim text from the page, or null when the fetch failed. */
  readonly excerpt: string | null;
  /** The date the page states about itself; null when it states none. */
  readonly pageDate: string | null;
  /** Present only when `excerpt` is null: why there is no text. */
  readonly unreadable?: string;
}

export const OPERATOR_SOURCES: Readonly<
  Record<string, OperatorSourceFixture>
> = Object.freeze({
  "https://www.restaurant.org/research-and-media/research/restaurant-economic-insights/analysis-commentary/restaurant-operators-kept-food-cost-ratios-in-check-in-2024/":
    {
      source: "National Restaurant Association",
      fetchedAt: "2026-09-04",
      pageDate: "2025-09-10",
      excerpt: [
        "food and non-alcohol beverage costs among fullservice respondents represented a median of 32.0% of sales in 2024",
        "food and non-alcohol beverage costs represented a median of 32.4% of sales in 2024",
        "2025 Restaurant Operations Data Abstract",
        "More than 900 restaurant operators nationwide",
      ].join("\n"),
    },

  "https://restaurant.org/research-and-media/research/restaurant-economic-insights/analysis-commentary/elevated-labor-costs-had-a-significant-impact-on-restaurant-profitability-in-2024/":
    {
      source: "National Restaurant Association",
      fetchedAt: "2026-09-04",
      pageDate: "2025-10-08",
      excerpt: [
        "salaries and wages (including benefits) represented a median of 36.5% of sales in 2024",
        "For fullservice operators who reported a pre-tax profit in 2024, labor costs were a median of 34.2% of sales",
        "salaries and wages (including benefits) represented a median of 31.7% of sales in 2024",
        "2025 Restaurant Operations Data Abstract",
        "More than 900 restaurant operators nationwide",
      ].join("\n"),
    },

  "https://www.restaurant.org/research-and-media/research/restaurant-economic-insights/analysis-commentary/restaurant-labor-costs-are-well-above-historical-averages/":
    {
      source: "National Restaurant Association",
      fetchedAt: "2026-09-04",
      pageDate: "2025-08-27",
      // Kept although no scenario cites it any more: it is the page the wrong
      // citation pointed at, and the excerpt is what proves 34.2 is not on it.
      excerpt: [
        "salaries and wages (including benefits) represented a median of 36.5% of sales in 2024",
        "salaries and wages (including benefits) represented a median of 31.7% of sales in 2024",
        "2025 Restaurant Operations Data Abstract",
        "More than 900 restaurant operators nationwide",
      ].join("\n"),
    },

  "https://www.thehospitalityhangout.com/blog/qsr-check-growth-faq-2026/": {
    source: "The Hospitality Hangout",
    fetchedAt: "2026-09-04",
    pageDate: "2026-08-26",
    excerpt: [
      "In July 2026, average check rose 2.5%",
      "the 2.3% rise in average price",
      "Quick-service traffic fell 1.4% year over year in July 2026",
    ].join("\n"),
  },

  "https://www.sculpturehospitality.com/blog/average-inventory-turnover-ratio-for-restaurant-food":
    {
      source: "Sculpture Hospitality",
      fetchedAt: "2026-09-04",
      pageDate: "2026-06-25",
      excerpt: [
        "A healthy inventory turnover ratio for restaurants usually sits between 4 and 8 times per month.",
        "This means you should completely sell through and restock your inventory roughly 1 to 2 times every single week.",
      ].join("\n"),
    },

  "https://dclcorp.com/blog/fulfillment/fill-rate/": {
    source: "DCL Logistics",
    fetchedAt: "2026-09-04",
    pageDate: "2026-07-07",
    // The whole of what this page says about a benchmark. The three phrases
    // the catalogue used to quote against it are absent, which is the point.
    excerpt: [
      "However, a general rule of thumb is that you should be fulfilling 92-98% of your orders.",
      "As a general benchmark, a healthy fill rate falls between 92-98%, though this varies by industry and business model.",
    ].join("\n"),
  },

  "https://goodsource.com/trends-and-insights/vendor-performance-evaluation-metrics-for-wholesale-food-distribution-partnerships/":
    {
      source: "GoodSource Solutions",
      fetchedAt: "2026-09-04",
      pageDate: "2026-03-22",
      // Fetched looking for a foodservice on-time-delivery PERCENTAGE. There
      // is none: this page defines on-time as a window around a promised slot
      // and scores vendors on accuracy and audits instead. That absence is
      // itself the finding the on-time-delivery caveat reports.
      excerpt: [
        "Delivered between 7:45 and 8:15 AM to count as on-time",
        "Aim for vendors maintaining 95% or higher accuracy rates",
        "Third-party audit scores (minimum 90% for critical suppliers)",
      ].join("\n"),
    },

  "https://www.restaurant365.com/blog/how-to-calculate-prime-cost-in-a-restaurant/":
    {
      source: "Restaurant365",
      fetchedAt: "2026-09-04",
      pageDate: null,
      excerpt: [
        "But generally, the prime cost of a successful, sustainable restaurant business is approximately 60% of your total food and beverage sales.",
        "A full-service restaurant will run a slightly higher prime cost (60-65%) than a quick service restaurant (55-60%).",
      ].join("\n"),
    },

  "https://www.touchbistro.com/blog/important-restaurant-benchmarks/": {
    source: "TouchBistro",
    fetchedAt: "2026-09-04",
    pageDate: null,
    excerpt: [
      "Any prime cost between 55-60% is considered good. Less than 50% could indicate you're running too lean, and more than 70% means it'll likely be hard for you to make a profit.",
      "The industry average for a family restaurant is 3",
      "The average full service restaurant has a staff turnover rate of 27%, according to TouchBistro's 2026 State of Restaurants Report.",
    ].join("\n"),
  },

  "https://www.vastcfo.com/breaking-down-restaurant-sales/": {
    source: "Vast CFO",
    fetchedAt: "2026-09-04",
    pageDate: null,
    excerpt: [
      "Food cost tends to fall between 28% and 35% of food sales.",
      "Liquor typically runs between 15% and 18% of sales.",
      "Draft beer averages 15% to 20%, while bottled or canned beer can run higher, around 24% to 28%.",
      "Wine can range widely, often 25% to 40%, depending on the mix of glass pours versus higher-end bottles.",
    ].join("\n"),
  },

  "https://supy.io/blog/the-impact-of-food-waste-on-restaurant-food-costs-and-how-to-reduce-it":
    {
      source: "Supy",
      fetchedAt: "2026-09-04",
      pageDate: "2025-02-03",
      excerpt: [
        "According to the National Restaurant Association, wasted food can account for 4% to 10% of food purchases",
      ].join("\n"),
    },

  "https://relayfi.com/blog/how-much-cash-reserves-should-a-business-have/": {
    source: "Relay",
    fetchedAt: "2026-09-04",
    pageDate: "2025-10-22",
    excerpt: [
      "Most advisors recommend keeping three to six months of operating expenses on hand",
      "While restaurants typically last only 16 days without revenue",
      "JPMorgan Chase Institute",
    ].join("\n"),
  },

  "https://premiumwineglasses.com/2026/05/30/high-margin-wine-program-custom-glassware/":
    {
      source: "premiumwineglasses.com (a glassware supplier's marketing post)",
      fetchedAt: "2026-09-04",
      pageDate: "2026-05-30",
      excerpt: [
        "typical BTG attach rate before launching branded glassware sits at 22-28%. After 12 months on etched-branded glassware, the same restaurants run 38-46%.",
        "see by-the-glass attach rates rise from 22% to 40-50% over the first 12 months",
      ].join("\n"),
    },

  "https://blackboxintelligence.com/resources/restaurant-glossary/revenue-per-available-seat-hour/":
    {
      source: "Black Box Intelligence",
      fetchedAt: "2026-09-04",
      pageDate: null,
      excerpt: null,
      unreadable: "HTTP 403 Forbidden to this fetcher on 2026-09-04",
    },
});

/** Every URL with recorded evidence. */
export const CITED_URLS: readonly string[] = Object.freeze(
  Object.keys(OPERATOR_SOURCES),
);
