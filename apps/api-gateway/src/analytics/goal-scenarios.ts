/**
 * The book of goal scenarios — what a restaurant might actually decide to hold
 * itself to, and what this product can and cannot hold it to today.
 *
 *   *"we're going to create possible analytic scenarios a restaurant might set
 *    as a goal"*                                — the founder, 2026-09-04
 *
 * Recorded as ADR 0120 (Proposed): a goal is chosen from a book of scenarios.
 *
 * WHAT THIS FILE IS
 * -----------------
 * A pure data catalogue. No query, no clock, no tenant. It is read by
 * `GET /analytics/goal-scenarios` and rendered as a picker above the metric
 * dropdown on both goal sheets, so a manager chooses "hold purchasing spend"
 * rather than reverse-engineering it out of a list of six metric keys.
 *
 * WHAT IT DELIBERATELY DOES NOT CARRY
 * -----------------------------------
 * **A target.** Not a default, not a suggestion, not a pre-filled number the
 * manager can "adjust". `rec-forward.ts` already made this argument for the
 * recommendations sheet — *"The rule states a gap, not a target — Mudavym will
 * not invent the number your house is held to"* — and it applies with more
 * force here, because a scenario is generic by construction. The catalogue
 * carries a RANGE, in the words of the operator source that published it, with
 * that source's URL and date, and one caveat sentence that never comes off.
 *
 * WHY A RANGE IS NOT A TARGET (the honest half of the research)
 * ------------------------------------------------------------
 * Two things were measured while writing this table, and both bound the
 * usefulness of every number in it:
 *
 *  1. **Published ranges exist for RATIOS, almost never for LEVELS.** The
 *     National Restaurant Association publishes a median food-cost RATIO
 *     (32.0% of sales, fullservice, 2024) and a median labour RATIO (36.5%).
 *     Nobody publishes "your wine revenue should be $X" or "you should serve N
 *     covers", because those depend on the size of the room. Four of the six
 *     measures this gateway can hold a goal on are absolute money or counts, so
 *     four of the servable scenarios below honestly carry `range.kind: "none"`
 *     with the reason, rather than a borrowed ratio dressed as a target.
 *  2. **A range is a distribution across hundreds of other houses.** The NRA's
 *     figures come from more than 900 operators; the median is a fact about
 *     that sample and about no single restaurant in it. `THE_CAVEAT` says so,
 *     in the same sentence, every time a range is shown.
 *
 * WHAT "IT NEEDS A METRIC" MEANS
 * ------------------------------
 * `GoalsService.SUPPORTED_METRICS` holds six measures (goals.service.ts:44-81).
 * Most of what operators actually set goals on is not among them. A scenario
 * that cannot be held today says so — `metricKey: null` plus `needsMetric`
 * naming the measure it would take — rather than being quietly dropped from the
 * book or bent onto the nearest metric that fits. A picker that showed only the
 * six servable scenarios would tell the founder this product covers the field;
 * it does not, and the list of what is missing is the more useful half.
 *
 * A measured note that matters for three of those: `/analytics/financial/:rid`
 * ALREADY computes `cogsRatio`, `primeCostRatio`, `inventoryTurnover` and
 * `daysInventoryOutstanding` (analytics.service.ts:444-467). They are not
 * offerable as goals for two separate reasons, and both are stated on the rows
 * below: the goals module has no key for them, AND `primeCostRatio` is called
 * with `labor` defaulting to `0` (analytics.service.ts:396) with no caller in
 * the repo passing it (grepped 2026-09-04: only `?labor=` on
 * analytics.controller.ts:141, unused by web and mobile), so today's "prime
 * cost" is a COGS ratio wearing a prime-cost name. A scenario promising a
 * prime-cost goal on top of that would be the fabrication ADR 0020 forbids.
 *
 * PARITY
 * ------
 * `goal-scenarios.spec.ts` pins every cross-reference in this table: each
 * `metricKey` against `GoalsService.SUPPORTED_METRICS`, each `cuttingId`
 * against `CUTTING_CATALOGUE` (report-cuttings.ts), each rule key against
 * `GoalsService.isRecommendationRuleKey`. A metric renamed in the goals module
 * therefore breaks this file loudly instead of leaving a picker entry that
 * 400s when a manager chooses it.
 */

import { CUTTING_CATALOGUE } from "./report-cuttings";
import { GoalsService } from "./goals.service";

/** The periods a scenario may suggest. `day` is an action window, not a goal. */
export const SCENARIO_PERIODS = ["week", "month", "quarter"] as const;
export type ScenarioPeriod = (typeof SCENARIO_PERIODS)[number];

/**
 * The one sentence that is shown with every published range, always, and is not
 * a property of any row so it cannot be edited away one row at a time.
 */
export const THE_CAVEAT =
  "A range from a report is a fact about the houses in that report, not about yours. Read it to know whether your own number is unusual — never as the number to type.";

export type ScenarioRange =
  | {
      kind: "published";
      /** The range as the source states it, in words. Never parsed into a number. */
      words: string;
      /** Who published it. */
      source: string;
      url: string;
      /** The source's own publication or update date, YYYY-MM-DD. */
      published: string;
      /** What is true of THIS number specifically, beyond `THE_CAVEAT`. */
      caveat: string;
    }
  | {
      kind: "none";
      /** Why no range is shown. Never an empty string. */
      why: string;
    };

export interface GoalScenario {
  /** Stable slug. Stored nowhere — it names a row in this file, not a goal. */
  readonly id: string;
  /** What the picker calls it. */
  readonly name: string;
  /** The operator's own sentence for the thing they are trying to move. */
  readonly question: string;
  /**
   * The `SUPPORTED_METRICS` key this scenario is held on, or `null` when the
   * goals module has no measure for it.
   */
  readonly metricKey: string | null;
  /** Present exactly when `metricKey` is null: the measure this would need. */
  readonly needsMetric: string | null;
  readonly direction: "at_least" | "at_most";
  readonly period: ScenarioPeriod;
  readonly range: ScenarioRange;
  /** The `CUTTING_CATALOGUE` id that draws it, or null with the reason below. */
  readonly cuttingId: string | null;
  /** Why that cutting, or why none. Always a sentence. */
  readonly cuttingWhy: string;
  /**
   * The recommendation rules whose own prescription moves this measure — the
   * `source_rule_key` a goal made from one of them would carry. Empty when no
   * rule lands here.
   *
   * Note that a goal itself files `goal_behind_<goalId>` once it is set and has
   * a deadline (recommendations.service.ts:340-372), which is why that key is
   * matched by shape rather than listed on any row.
   */
  readonly ruleKeys: readonly string[];
}

/**
 * The book.
 *
 * Ordered servable-first, because a picker that opens on six things it cannot
 * do reads as a product that does nothing. Within each half, ordered by how
 * often the sources treat the measure as the headline one.
 */
export const GOAL_SCENARIOS: readonly GoalScenario[] = Object.freeze([
  /* ── Held today: the six measures the goals module serves ─────────────── */

  {
    id: "hold-purchasing-spend",
    name: "Hold purchasing spend",
    question:
      "Keep what we spend with vendors under a line we set, over a month.",
    metricKey: "purchase_spend",
    needsMetric: null,
    direction: "at_most",
    period: "month",
    range: {
      kind: "published",
      words:
        "Food and non-alcohol beverage costs were a median of 32.0% of sales among fullservice operators in 2024, and 32.4% among limited-service operators.",
      source:
        "National Restaurant Association, 2025 Restaurant Operations Data Abstract (900+ operators)",
      url: "https://www.restaurant.org/research-and-media/research/restaurant-economic-insights/analysis-commentary/restaurant-operators-kept-food-cost-ratios-in-check-in-2024/",
      published: "2025-08-27",
      caveat:
        "That is a RATIO to sales. This goal is an absolute ceiling in money, so the ratio only tells you what a ceiling implies once you know what you expect to sell.",
    },
    cuttingId: "pacing",
    cuttingWhy:
      "Spend pacing is the register the ceiling is read from: it is this month's buying against last month's, which is the same arithmetic the goal is scored on.",
    ruleKeys: ["spend_acceleration"],
  },
  {
    id: "wine-revenue-lift",
    name: "Lift wine revenue",
    question: "Sell more wine than we did before, by a date.",
    metricKey: "wine_revenue",
    needsMetric: null,
    direction: "at_least",
    period: "month",
    range: {
      kind: "none",
      why: "No operator source publishes a wine-revenue level, because a level depends on the size of the room. What is published is the cost side — wine COGS commonly 25–40% of wine sales (Vast CFO, https://www.vastcfo.com/breaking-down-restaurant-sales/) — which says nothing about how much wine you should sell.",
    },
    cuttingId: "till",
    cuttingWhy:
      "Through the till is what guests actually paid, day by day, which is where a revenue lift becomes visible before the month closes.",
    ruleKeys: [
      "sales_below_weekday_baseline",
      "weekly_demand_slide",
      "plowhorse_repricing",
    ],
  },
  {
    id: "lift-the-quiet-night",
    name: "Lift the quietest night",
    question: "Make the weakest weekday carry more of the week.",
    metricKey: "wine_revenue",
    needsMetric: null,
    direction: "at_least",
    period: "week",
    range: {
      kind: "none",
      why: "The shape of a week is a house's own — a Tuesday-lunch room and a Saturday-dinner room have nothing to compare. No operator source publishes a per-weekday level.",
    },
    cuttingId: "week",
    cuttingWhy:
      "The week's shape is the register the gap was read from, so the drawing is the goal's own arithmetic laid out.",
    ruleKeys: ["weekday_gap", "sales_below_weekday_baseline"],
  },
  {
    id: "wine-attach-rate",
    name: "More checks leave with wine",
    question: "Raise the share of checks that carry a wine line.",
    metricKey: "wine_attach_rate",
    needsMetric: null,
    direction: "at_least",
    period: "month",
    range: {
      kind: "none",
      why: "No operator body publishes a wine attach-rate range. The only figures found were a glassware supplier's marketing post claiming by-the-glass attach rates of 22–28% rising to 38–46% over twelve months (https://premiumwineglasses.com/2026/05/30/high-margin-wine-program-custom-glassware/, 2026-05-30) — a sales claim, not a benchmark, so it is named here rather than shown as a range.",
    },
    cuttingId: "reading",
    cuttingWhy:
      "Attach is a basket fact, and basket affinity reaches this sheet only as sentences inside The reading — there is no drawing of it, and saying so is better than sending you to a chart that is about something else.",
    ruleKeys: ["pairing_promotion"],
  },
  {
    id: "raise-the-average-check",
    name: "Raise the average check",
    question: "Get more onto each check without needing more guests.",
    metricKey: "avg_check",
    needsMetric: null,
    direction: "at_least",
    period: "month",
    range: {
      kind: "published",
      words:
        "In July 2026 average check rose 2.5% year over year, slightly ahead of the 2.3% rise in average price — check growth running ahead of price growth is the healthier kind.",
      source: "The Hospitality Hangout, QSR Check Growth FAQ 2026",
      url: "https://www.thehospitalityhangout.com/blog/qsr-check-growth-faq-2026/",
      published: "2026",
      caveat:
        "That is a RATE OF CHANGE across quick-service, not a level, and not fullservice. It tells you what kind of movement counts as healthy; it does not tell you what your check should be.",
    },
    cuttingId: "till",
    cuttingWhy:
      "Through the till carries the check totals the average is taken over, so a change in the average is visible in the same register that produced it.",
    ruleKeys: ["staff_spread"],
  },
  {
    id: "close-the-server-spread",
    name: "Close the spread between servers",
    question:
      "Bring the whole floor closer to what the best server's checks look like.",
    metricKey: "avg_check",
    needsMetric: null,
    direction: "at_least",
    period: "month",
    range: {
      kind: "none",
      why: "The NRA's operations abstract reports labour as a share of sales, not per-server check averages, and no source found publishes a spread. The comparison this goal wants is between your own servers, which is the only place it exists.",
    },
    cuttingId: "service",
    cuttingWhy:
      "Who served it is the per-server register the spread is read from; the house average this goal is scored on is what closing that spread moves.",
    ruleKeys: ["staff_spread"],
  },
  {
    id: "move-the-idle-bottles",
    name: "Move the bottles that are not moving",
    question: "Turn idle stock back into cash before it ties up more capital.",
    metricKey: "bottles_sold",
    needsMetric: null,
    direction: "at_least",
    period: "month",
    range: {
      kind: "published",
      words:
        "A healthy inventory turnover ratio for restaurants usually sits between 4 and 8 times per month.",
      source: "Sculpture Hospitality",
      url: "https://www.sculpturehospitality.com/blog/average-inventory-turnover-ratio-for-restaurant-food",
      published: "2026-06-25",
      caveat:
        "Turnover is COGS over average inventory — a ratio. This goal counts bottles leaving the shelf. The range says how fast a cellar should empty and refill; it does not convert into a bottle count without your own inventory value.",
    },
    cuttingId: "quadrants",
    cuttingWhy:
      "Margin against movement is where a bottle that earns its place is separated from one that only occupies it, which is the judgement this goal acts on.",
    ruleKeys: ["dead_stock_capital", "puzzle_activation"],
  },
  {
    id: "serve-more-checks",
    name: "Serve more checks",
    question: "Bring more guests through the room over the month.",
    metricKey: "checks",
    needsMetric: null,
    direction: "at_least",
    period: "month",
    range: {
      kind: "none",
      why: "Guest counts are a house figure — a forty-seat room and a two-hundred-seat room share no number. What gets published is the year-over-year change across a segment (quick-service traffic fell 1.4% in July 2026), which is a direction, not a level.",
    },
    cuttingId: "till",
    cuttingWhy:
      "Through the till counts the checks themselves alongside what they were worth, so the goal and the drawing are the same query.",
    ruleKeys: ["weekly_demand_slide", "weekday_gap"],
  },
  {
    id: "restock-before-the-shelf-empties",
    name: "Stop running out",
    question:
      "Keep selling the bottles that keep running out, instead of losing the sale.",
    metricKey: "bottles_sold",
    needsMetric: null,
    direction: "at_least",
    period: "month",
    range: {
      kind: "published",
      words:
        "Industry benchmarks for fill rates range from 92–98%, with typical benchmarks between 85% and 95% and high performers above 95%.",
      source: "DCL Logistics, Fill Rate",
      url: "https://dclcorp.com/blog/fulfillment/fill-rate/",
      published: "2026",
      caveat:
        "That is a general logistics and e-commerce benchmark, not a foodservice one, and it measures a SUPPLIER's shipping, not your shelf. It is here because nothing restaurant-specific was found, and it should be read as the nearest neighbour rather than as your number.",
    },
    cuttingId: "restock",
    cuttingWhy:
      "What to buy back is the register that names which bottles are about to run out and how likely each is to run out first — the list this goal is worked from.",
    ruleKeys: ["stockout_imminent"],
  },

  /* ── Not held today: the scenario names the measure it would take ──────── */

  {
    id: "prime-cost",
    name: "Hold prime cost under a line",
    question:
      "Keep cost of goods plus labour under a share of sales — the one number that decides whether the month made money.",
    metricKey: null,
    needsMetric:
      "prime_cost_pct = (cost of goods sold + total labour) ÷ sales. `/analytics/financial/:rid` computes `primeCostRatio` (analytics.service.ts:464-467) but with `labor` defaulting to 0 and no caller in this repo supplying it, so today's figure is a COGS ratio under a prime-cost name. Two things are needed: a labour feed, and a `prime_cost_pct` entry in SUPPORTED_METRICS.",
    direction: "at_most",
    period: "month",
    range: {
      kind: "published",
      words:
        "A full-service restaurant runs a prime cost of 60–65% of sales; quick service runs 55–60%; roughly 60% is the figure cited for a sustainable business.",
      source: "Restaurant365, How to Calculate Prime Cost in a Restaurant",
      url: "https://www.restaurant365.com/blog/how-to-calculate-prime-cost-in-a-restaurant/",
      published: "2026",
      caveat:
        "A second operator source disagrees by five points — TouchBistro calls 55–60% good and says above 70% makes profit hard (https://www.touchbistro.com/blog/important-restaurant-benchmarks/). Two published ranges that do not agree is itself the finding: neither is a line your house must sit under.",
    },
    cuttingId: "ledger",
    cuttingWhy:
      "Figures of record is the register that carries the ratios — it would be where a prime-cost goal is read, once a labour figure exists to complete the numerator.",
    ruleKeys: [],
  },
  {
    id: "food-cost-ratio",
    name: "Hold food cost as a share of sales",
    question: "Keep what the food costs under a share of what it sells for.",
    metricKey: null,
    needsMetric:
      "food_cost_pct = cost of goods sold ÷ sales. `/analytics/financial/:rid` computes `cogsRatio`, but over a sell-price valuation of purchased stock rather than POS revenue (analytics.service.ts:432-437), so it is not yet the operator's food-cost ratio. It needs a POS-revenue denominator and a SUPPORTED_METRICS entry.",
    direction: "at_most",
    period: "month",
    range: {
      kind: "published",
      words:
        "Food and non-alcohol beverage costs were a median of 32.0% of sales among fullservice operators in 2024, against roughly 34% averaged over the 2010, 2013 and 2016 editions.",
      source:
        "National Restaurant Association, 2025 Restaurant Operations Data Abstract (900+ operators)",
      url: "https://www.restaurant.org/research-and-media/research/restaurant-economic-insights/analysis-commentary/restaurant-operators-kept-food-cost-ratios-in-check-in-2024/",
      published: "2025-08-27",
      caveat:
        "A median over 900 houses of every size and cuisine. Pizzerias and fine dining sit at opposite ends of it, and both are inside the median.",
    },
    cuttingId: "ledger",
    cuttingWhy:
      "Figures of record already carries the cost-side ratios; a food-cost goal would be read there once the denominator is sales rather than a valuation.",
    ruleKeys: [],
  },
  {
    id: "labour-cost-ratio",
    name: "Hold labour as a share of sales",
    question: "Keep wages and benefits under a share of what we take.",
    metricKey: null,
    needsMetric:
      "labour_cost_pct = (wages + benefits) ÷ sales. There is no labour feed in this gateway at all: `team_members.hourly_wage` was 100% literal before ADR 0088, and nothing else records paid hours. This needs a payroll or scheduling source before it can be a goal.",
    direction: "at_most",
    period: "month",
    range: {
      kind: "published",
      words:
        "Salaries and wages including benefits were a median of 36.5% of sales among fullservice operators in 2024 and 31.7% among limited-service; fullservice operators who reported a pre-tax profit held labour to a median of 34.2%.",
      source:
        "National Restaurant Association, 2025 Restaurant Operations Data Abstract (900+ operators)",
      url: "https://www.restaurant.org/research-and-media/research/restaurant-economic-insights/analysis-commentary/restaurant-labor-costs-are-well-above-historical-averages/",
      published: "2025-08-27",
      caveat:
        "The 34.2% figure is the interesting one: it is the median among operators who actually made money, which is a different population from the 36.5% median across everyone.",
    },
    cuttingId: null,
    cuttingWhy:
      "No cutting on this sheet reads labour — there is no labour register to draw. A labour goal would need its own.",
    ruleKeys: [],
  },
  {
    id: "pour-cost",
    name: "Hold pour cost",
    question: "Keep what the drink costs under a share of what it sells for.",
    metricKey: null,
    needsMetric:
      "pour_cost_pct = beverage cost of goods ÷ beverage sales, ideally split by liquor, beer and wine. `pos_checks.items` carries an `is_wine` flag (goals.service.ts:745-757) but no category beyond it, so beer and spirits cannot be separated today.",
    direction: "at_most",
    period: "month",
    range: {
      kind: "published",
      words:
        "Liquor typically runs 15–18% of sales; draft beer 15–20%; bottled or canned beer 24–28%; wine 25–40%, depending on the mix of glass pours and higher-end bottles.",
      source: "Vast CFO, Breaking Down Restaurant Sales",
      url: "https://www.vastcfo.com/breaking-down-restaurant-sales/",
      published: "2026",
      caveat:
        "Four ranges, not one: a house with a deep bottle list and a house pouring by the glass sit at opposite ends of the wine band, and a blended pour cost hides which one you are.",
    },
    cuttingId: null,
    cuttingWhy:
      "No cutting separates beverage cost from food cost — the sheet has no drink-cost register.",
    ruleKeys: [],
  },
  {
    id: "waste-ratio",
    name: "Waste less of what we buy",
    question: "Cut the share of what we bought that never reached a guest.",
    metricKey: null,
    needsMetric:
      "waste_pct = value of recorded waste ÷ value of purchases. Nothing in this gateway records waste as an event; the inventory ledger records movements, not spoilage reasons. This needs a waste-capture path before it can be a goal.",
    direction: "at_most",
    period: "month",
    range: {
      kind: "published",
      words:
        "Restaurant food waste typically runs 4% to 10% of food purchases (figure attributed to the National Restaurant Association).",
      source: "Supy, The Impact of Food Waste on Restaurant Food Costs",
      url: "https://supy.io/blog/the-impact-of-food-waste-on-restaurant-food-costs-and-how-to-reduce-it",
      published: "2025-02-03",
      caveat:
        "Read second-hand: the range is attributed to the NRA by a vendor's blog, and the primary publication was not located. A house that records no waste will read 0%, which is an absence, not a result.",
    },
    cuttingId: null,
    cuttingWhy:
      "No cutting reads waste, because nothing writes it. This is the clearest case on the sheet of a goal that needs a capture path before it needs a chart.",
    ruleKeys: [],
  },
  {
    id: "days-of-inventory",
    name: "Hold fewer days of stock",
    question: "Stop holding more cellar than the room actually turns.",
    metricKey: null,
    needsMetric:
      "days_of_inventory. `/analytics/financial/:rid` already computes `daysInventoryOutstanding` and `inventoryTurnover` (analytics.service.ts:444-451, both null unless every on-hand row carries a recorded cost). What is missing is only a SUPPORTED_METRICS entry — this is the shortest of the unserved scenarios to close.",
    direction: "at_most",
    period: "quarter",
    range: {
      kind: "published",
      words:
        "A healthy inventory turnover ratio for restaurants usually sits between 4 and 8 times per month — roughly restocking once or twice a week.",
      source: "Sculpture Hospitality",
      url: "https://www.sculpturehospitality.com/blog/average-inventory-turnover-ratio-for-restaurant-food",
      published: "2026-06-25",
      caveat:
        "The source publishes TURNS, not days. Turning that into days of stock is arithmetic this catalogue has not done for you, because the conversion would read as a sourced figure when it is not one.",
    },
    cuttingId: "ledger",
    cuttingWhy:
      "Figures of record is what the cellar is worth and how hard that capital is working — the register days-of-stock is computed inside.",
    ruleKeys: ["dead_stock_capital"],
  },
  {
    id: "table-turns",
    name: "Turn the tables more often",
    question: "Seat more parties on the same tables in the same service.",
    metricKey: null,
    needsMetric:
      "table_turns = parties served ÷ tables. `pos_checks` carries `opened_at` and `closed_at` and `TableAnalyticsService` reads a tables schema, so the arithmetic is reachable; there is no goal metric for it and no seat count on record.",
    direction: "at_least",
    period: "month",
    range: {
      kind: "published",
      words:
        "The industry average table turnover rate for a family restaurant is 3.",
      source: "TouchBistro, 10 Essential Restaurant Benchmarks",
      url: "https://www.touchbistro.com/blog/important-restaurant-benchmarks/",
      published: "2026",
      caveat:
        "One number for one segment. A two-hour tasting menu and a forty-five-minute lunch counter are both restaurants and neither is a 3.",
    },
    cuttingId: "seats",
    cuttingWhy:
      "Which tables earn and which seats sit idle is the register a turns goal is read from, once seats are on record.",
    ruleKeys: [],
  },
  {
    id: "revpash",
    name: "Earn more per seat-hour",
    question:
      "Raise revenue per available seat hour — the measure that catches an empty room and a slow one at the same time.",
    metricKey: null,
    needsMetric:
      "revpash = revenue ÷ (seats × service hours). Revenue exists (`pos_checks`); seats and published service hours do not exist on any restaurant record in this gateway.",
    direction: "at_least",
    period: "month",
    range: {
      kind: "none",
      why: "There is no universal RevPASH benchmark, and the sources say so outright: a fine-dining room with two-hour turns and $150 checks and a casual room with 45-minute turns and $25 checks have different good numbers. The definition is standard (Black Box Intelligence, https://blackboxintelligence.com/resources/restaurant-glossary/revenue-per-available-seat-hour/); the level is yours alone.",
    },
    cuttingId: "seats",
    cuttingWhy:
      "Which tables earn and which seats sit idle is the nearest register — it is the same question at table grain rather than seat-hour grain.",
    ruleKeys: [],
  },
  {
    id: "vendor-concentration",
    name: "Spread the buying across vendors",
    question: "Stop one supplier from being able to stop the kitchen.",
    metricKey: null,
    needsMetric:
      "vendor_hhi — the Herfindahl index over the purchase book. `/analytics/risk/:rid` already computes it and a rule fires above 0.4 (recommendations.service.ts:253); it is not a goal metric, and the goals module holds no index.",
    direction: "at_most",
    period: "quarter",
    range: {
      kind: "none",
      why: "No restaurant body publishes a concentration benchmark. The 0.4 threshold this product's own rule fires at is OUR line, taken from the general HHI convention for a concentrated market — it is not an industry figure and is not offered as one.",
    },
    cuttingId: null,
    cuttingWhy:
      "The concentration register (`/analytics/risk`) is not among the analyses this sheet can lay down, so there is no drawing to send you to.",
    ruleKeys: ["vendor_concentration"],
  },
  {
    id: "on-time-delivery",
    name: "Get what we ordered, when we ordered it",
    question:
      "Hold suppliers to delivering in full and on the day they promised.",
    metricKey: null,
    needsMetric:
      "otif_pct — deliveries received complete and on the promised date ÷ deliveries. `procurement_orders` carries `delivered_at`, and receiving records the pair, so the arithmetic is reachable; there is no goal metric and no promised-date column proven to be populated.",
    direction: "at_least",
    period: "quarter",
    range: {
      kind: "published",
      words:
        "Industry benchmarks for fill rates range from 92–98%, with typical benchmarks between 85% and 95%; a service target of at least 90% on-time within 48 hours is recommended for specialty food distributors.",
      source: "DCL Logistics, Fill Rate",
      url: "https://dclcorp.com/blog/fulfillment/fill-rate/",
      published: "2026",
      caveat:
        "General logistics, not foodservice, and the two halves of the sentence come from different definitions of on-time — requested date or promised date, order level or line level. Whose clock and whose list is the question to settle before the number means anything.",
    },
    cuttingId: null,
    cuttingWhy:
      "There is no vendor-performance register on this sheet. Vendor terms and the receiving door hold the underlying rows, not a drawing.",
    ruleKeys: ["vendor_concentration"],
  },
  {
    id: "cash-days",
    name: "Keep more days of cash",
    question: "Hold enough cash to survive a closed week.",
    metricKey: null,
    needsMetric:
      "days_cash_on_hand = cash ÷ average daily operating expense. Nothing in this gateway reads a bank balance; the closest is purchase spend, which is one side of the outflow only.",
    direction: "at_least",
    period: "quarter",
    range: {
      kind: "published",
      words:
        "Three to six months of operating expenses is the standard reserve advice, while restaurants typically last only 16 days without revenue (JPMorgan Chase Institute).",
      source: "Relay, How Much Cash Reserves Should A Business Have",
      url: "https://relayfi.com/blog/how-much-cash-reserves-should-a-business-have/",
      published: "2025-10-22",
      caveat:
        "The two halves of that sentence are advice and observation, and they are far apart — the gap between what is recommended and what restaurants actually hold is the point, not a target to split the difference on.",
    },
    cuttingId: null,
    cuttingWhy:
      "No cutting reads cash. Spend pacing is the outflow half and nothing else.",
    ruleKeys: [],
  },
  {
    id: "staff-turnover",
    name: "Keep the people we trained",
    question: "Lose fewer of the staff we spent a season teaching.",
    metricKey: null,
    needsMetric:
      "staff_turnover_pct = departures ÷ positions. `team_members` records who is on the roster; nothing records a departure date, so a turnover figure cannot be computed from it.",
    direction: "at_most",
    period: "quarter",
    range: {
      kind: "published",
      words:
        "The average full service restaurant has a staff turnover rate of 27%.",
      source: "TouchBistro, 10 Essential Restaurant Benchmarks",
      url: "https://www.touchbistro.com/blog/important-restaurant-benchmarks/",
      published: "2026",
      caveat:
        "Well below the figures usually quoted for hospitality turnover, and the source does not say over what period or which roles it counts. Treat it as one publisher's number, not a settled one.",
    },
    cuttingId: null,
    cuttingWhy:
      "Who served it reads server checks, not tenure. There is no staffing register on this sheet.",
    ruleKeys: ["staff_spread"],
  },
]);

/**
 * The producer that would announce this scenario, DERIVED rather than stored.
 *
 * `GoalReachedProducer` skips `at_most` outright (goal-reached.producer.ts:121)
 * and `CeilingHeldProducer` selects `direction = at_most`
 * (ceiling-held.producer.ts:95), so direction alone decides. Storing the answer
 * on each row would let this table disagree with the two producers' own
 * filters — the drift `report-cuttings.ts` documents at its DRIFT heading.
 *
 * A scenario with no metric is announced by nothing, because it cannot be set.
 */
export function producerFor(
  scenario: GoalScenario,
): "goal-reached" | "ceiling-held" | null {
  if (scenario.metricKey === null) return null;
  return scenario.direction === "at_most" ? "ceiling-held" : "goal-reached";
}

/** Ids, for the parity test and for a caller that wants to check one. */
export const SCENARIO_IDS: readonly string[] = Object.freeze(
  GOAL_SCENARIOS.map((s) => s.id),
);

export function scenarioById(id: string): GoalScenario | undefined {
  return GOAL_SCENARIOS.find((s) => s.id === id);
}

/**
 * The payload `GET /analytics/goal-scenarios` returns.
 *
 * Static by construction: no restaurant id reaches this function, so a scenario
 * list cannot leak one tenant's shape to another. `servable` is computed here
 * rather than typed in, so a metric added to the goals module changes the
 * answer without anyone editing a boolean.
 */
export function goalScenarioBook(): {
  caveat: string;
  metrics: Array<{ key: string; label: string; unit: string }>;
  scenarios: Array<
    GoalScenario & {
      servable: boolean;
      producer: "goal-reached" | "ceiling-held" | null;
      metricLabel: string | null;
      cuttingAnswers: string | null;
    }
  >;
  counts: { total: number; servable: number; needsAMetric: number };
  basis: string;
} {
  const scenarios = GOAL_SCENARIOS.map((s) => {
    const metric = s.metricKey
      ? GoalsService.SUPPORTED_METRICS[s.metricKey]
      : undefined;
    return {
      ...s,
      servable: s.metricKey !== null,
      producer: producerFor(s),
      metricLabel: metric?.label ?? null,
      cuttingAnswers: s.cuttingId
        ? (CUTTING_CATALOGUE[s.cuttingId]?.answers ?? null)
        : null,
    };
  });
  const servable = scenarios.filter((s) => s.servable).length;
  return {
    caveat: THE_CAVEAT,
    metrics: Object.entries(GoalsService.SUPPORTED_METRICS).map(
      ([key, m]) => ({ key, label: m.label, unit: m.unit }),
    ),
    scenarios,
    counts: {
      total: scenarios.length,
      servable,
      needsAMetric: scenarios.length - servable,
    },
    basis:
      "This is a book of scenarios, not a reading of your books: no figure here was computed from your restaurant, and no target is suggested. Ranges are quoted from the operator sources named on each one, with the date they were published.",
  };
}
