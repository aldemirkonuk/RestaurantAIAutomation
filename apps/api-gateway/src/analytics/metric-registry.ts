/**
 * WineOps Analytics — Metric Registry
 * ===================================
 *
 * A declarative catalog of the metrics the engine can compute, each tied to
 * (a) the underlying formula/theorem, (b) the persona who cares, and (c) the
 * catalogue feature id(s) it satisfies. This is the machine-readable bridge
 * between `.planning/ANALYTICS_FEATURE_CATALOG.md` (the 360 features) and the
 * pure engine functions in `./engine`.
 *
 * The registry is served by the analytics controller (`GET /analytics/metrics`)
 * so the frontend can render a "formula library" and so the AI layer can
 * discover which quantitative tools exist. Adding a metric here + a compute
 * branch in the service is how the catalog gets built out incrementally.
 */

export type Persona =
  | "manager"
  | "trader"
  | "private_equity"
  | "economist"
  | "statistician"
  | "operations";

export type MetricUnit =
  | "currency"
  | "ratio"
  | "percent"
  | "days"
  | "units"
  | "count"
  | "score"
  | "index";

export interface MetricDefinition {
  /** Stable key used by the compute API. */
  key: string;
  name: string;
  /** Domain grouping (mirrors catalogue domains). */
  domain: string;
  /** One-line "what it answers". */
  description: string;
  /** The formula / theorem in plain math, for tooltips & docs. */
  formula: string;
  /** Named lineage — the theory this rests on. */
  theorem?: string;
  unit: MetricUnit;
  /** Engine function(s) that implement it. */
  engineFns: string[];
  /** Personas who reach for this metric. */
  personas: Persona[];
  /** Catalogue feature ids (from ANALYTICS_FEATURE_CATALOG.md) satisfied. */
  catalogIds: number[];
  /** "Good" direction for dashboards. */
  goodDirection?: "up" | "down" | "target";
  /**
   * True only where a served field computes it from live data, and the text
   * above says what that field computes (ADR 0298). cost-honesty.spec.ts pins
   * every `true` to the field that serves it, so a flip without one fails.
   */
  computed: boolean;
}

export const METRIC_REGISTRY: MetricDefinition[] = [
  // ---- Financial / P&L -------------------------------------------------
  {
    key: "wine_cogs_ratio",
    name: "COGS % of Sales",
    domain: "financial",
    description:
      "Cost of the stock items the till sold, as a share of what the till took for them (365d, net of tax and surcharge).",
    formula:
      "Σ(POS bottles out × recorded unit cost) ÷ Σ(POS line price × qty); null unless the POS moved stock and every item that moved it carries a recorded cost",
    unit: "percent",
    engineFns: ["finance.cogsRatio"],
    personas: ["manager", "private_equity"],
    catalogIds: [68, 158],
    goodDirection: "down",
    computed: true,
  },
  {
    key: "prime_cost_ratio",
    name: "Prime Cost Ratio",
    domain: "financial",
    description:
      "Cost of goods plus labour over sales (target ≤ 0.65). Labour is the caller's input (?labor= on /analytics/financial); there is no labour feed, so without it the figure equals the COGS ratio.",
    formula: "(POS COGS + labour supplied by the caller) ÷ POS sales",
    unit: "percent",
    engineFns: ["finance.primeCostRatio"],
    personas: ["manager", "private_equity"],
    catalogIds: [277, 294],
    goodDirection: "target",
    computed: true,
  },
  {
    key: "gross_margin_by_tier",
    name: "Gross Margin",
    domain: "financial",
    description:
      "Margin captured per dollar the till took for stock items, house-wide (no tier split is computed).",
    formula: "(POS sales − POS COGS) ÷ POS sales",
    unit: "percent",
    engineFns: ["finance.grossMargin"],
    personas: ["manager", "private_equity"],
    catalogIds: [152, 156],
    goodDirection: "up",
    computed: true,
  },
  {
    key: "yoy_growth",
    name: "Year-over-Year Growth (CAGR)",
    domain: "financial",
    description: "Compound growth of wine revenue/COGS/covers.",
    formula: "(End ÷ Begin)^(1/years) − 1",
    theorem: "Compound Annual Growth Rate",
    unit: "percent",
    engineFns: ["finance.cagr", "finance.compoundGrowthRate"],
    personas: ["private_equity", "manager"],
    catalogIds: [210, 352],
    goodDirection: "up",
    computed: false,
  },
  {
    key: "early_payment_apr",
    name: "Early-Payment Discount APR",
    domain: "financial",
    description:
      "Annualized return of taking a 2/10 net-30-style discount vs holding cash.",
    formula: "(d ÷ (1−d)) × (365 ÷ daysSaved)",
    theorem: "Trade-credit annualization",
    unit: "percent",
    engineFns: ["finance.earlyPaymentDiscountApr"],
    personas: ["private_equity", "trader", "manager"],
    catalogIds: [176, 162],
    goodDirection: "up",
    computed: false,
  },
  // ---- Inventory science ----------------------------------------------
  {
    key: "inventory_turnover",
    name: "Inventory Turnover",
    domain: "inventory",
    description:
      "How many times today's cellar value sells through per year, from the cost of what the till sold.",
    formula:
      "POS COGS annualised from the observed span (≥ 28 days) ÷ current inventory value at cost (not an average)",
    unit: "ratio",
    engineFns: ["inventory.inventoryTurnover"],
    personas: ["private_equity", "operations", "manager"],
    catalogIds: [242],
    goodDirection: "up",
    computed: true,
  },
  {
    key: "days_inventory_outstanding",
    name: "Days Inventory Outstanding",
    domain: "inventory",
    description:
      "Days today's stock lasts at the rate the till has been selling it.",
    formula:
      "observed days × current inventory value ÷ POS COGS over those days (= 365 ÷ turnover)",
    unit: "days",
    engineFns: ["inventory.daysInventoryOutstanding"],
    personas: ["private_equity", "operations"],
    catalogIds: [243],
    goodDirection: "down",
    computed: true,
  },
  {
    key: "gmroi",
    name: "GMROI",
    domain: "inventory",
    description:
      "Gross-margin return on inventory investment — $ of till margin per year per $ of stock.",
    formula:
      "(POS sales − POS COGS) annualised from the observed span ÷ current inventory value at cost (not an average)",
    theorem: "Merchandising GMROI",
    unit: "ratio",
    engineFns: ["inventory.gmroi"],
    personas: ["private_equity", "manager"],
    catalogIds: [124, 242],
    goodDirection: "up",
    computed: true,
  },
  {
    key: "eoq",
    name: "Economic Order Quantity",
    domain: "inventory",
    description:
      "Order size that minimizes ordering + holding cost. S is an assumed 25 per order and H is 26%/yr of the recorded unit cost; null for an uncosted item.",
    formula: "√(2·D·S ÷ H)",
    theorem: "Wilson EOQ",
    unit: "units",
    engineFns: ["inventory.eoq"],
    personas: ["operations", "economist"],
    catalogIds: [145, 147, 272],
    goodDirection: "target",
    computed: true,
  },
  {
    key: "safety_stock",
    name: "Dynamic Safety Stock",
    domain: "inventory",
    description:
      "Buffer for demand variance at a target service level. Lead-time variance is not fed (σ_LT = 0), so the buffer covers demand variance only.",
    formula: "z · √(LT·σ_d² + d̄²·σ_LT²), served with σ_LT = 0",
    theorem: "King safety-stock formula",
    unit: "units",
    engineFns: ["inventory.safetyStock", "stats.serviceLevelZ"],
    personas: ["operations", "statistician"],
    catalogIds: [144, 239],
    goodDirection: "target",
    computed: true,
  },
  {
    key: "reorder_point",
    name: "Reorder Point",
    domain: "inventory",
    description: "Stock level that should trigger a purchase order.",
    formula: "d̄·LT + SafetyStock",
    unit: "units",
    engineFns: ["inventory.reorderPoint"],
    personas: ["operations", "manager"],
    catalogIds: [235, 238, 272],
    goodDirection: "target",
    computed: true,
  },
  {
    key: "stockout_probability",
    name: "Stockout Probability",
    domain: "risk",
    description: "P(demand exceeds on-hand before next delivery).",
    formula: "1 − Φ((onHand − μ_LT) ÷ σ_LT)",
    theorem: "Gaussian lead-time demand",
    unit: "percent",
    engineFns: ["inventory.stockoutProbability", "stats.normalCdf"],
    personas: ["operations", "statistician"],
    catalogIds: [236, 117],
    goodDirection: "down",
    computed: true,
  },
  {
    key: "newsvendor_event_order",
    name: "Event Order (Newsvendor)",
    domain: "inventory",
    description:
      "Optimal one-shot order for an event balancing stockout vs leftover cost.",
    formula: "Q* = μ + z·σ, z = Φ⁻¹(Cu ÷ (Cu+Co))",
    theorem: "Newsvendor critical fractile",
    unit: "units",
    engineFns: ["inventory.newsvendorOrder"],
    personas: ["economist", "operations"],
    catalogIds: [269, 270, 73],
    goodDirection: "target",
    computed: false,
  },
  {
    key: "abc_xyz_classification",
    name: "ABC-XYZ Classification",
    domain: "inventory",
    description:
      "9-box of value (Pareto) × demand variability — what to auto-buy vs hand-manage.",
    formula: "ABC by cumulative value; XYZ by coefficient of variation",
    theorem: "Pareto principle + demand variability",
    unit: "score",
    engineFns: ["inventory.abcClassify", "inventory.xyzClassify"],
    personas: ["operations", "statistician"],
    catalogIds: [212, 248],
    computed: true,
  },
  {
    key: "dead_stock_capital",
    name: "Dead Stock Capital Lock",
    domain: "financial",
    description:
      "$ tied up in on-hand stock with no consumption in 90 days; null when any idle row has no recorded cost.",
    formula:
      "Σ (on-hand qty × recorded unit cost) over rows with no movement in 90d",
    unit: "currency",
    engineFns: ["stats.sum"],
    personas: ["private_equity", "manager"],
    catalogIds: [70, 251, 160],
    goodDirection: "down",
    computed: true,
  },
  // ---- Risk / portfolio ------------------------------------------------
  {
    key: "vendor_concentration_hhi",
    name: "Vendor Concentration (HHI)",
    domain: "risk",
    description:
      "Herfindahl index of spend across vendors — single-point-of-failure risk.",
    formula: "Σ sᵢ²  (sᵢ = spend share)",
    theorem: "Herfindahl-Hirschman Index",
    unit: "index",
    engineFns: ["finance.herfindahlIndex", "finance.effectiveCount"],
    personas: ["private_equity", "trader", "economist"],
    catalogIds: [84, 173, 268],
    goodDirection: "down",
    computed: true,
  },
  {
    key: "revenue_gini",
    name: "Revenue Concentration (Gini)",
    domain: "risk",
    description:
      "Inequality of POS sales across stock items over 90 days — how few items carry the till.",
    formula:
      "Gini of POS line sales per stock item, 90d, over the items the till can sell: every active item a POS mapping points at (0 when it sold nothing) and every item that sold; an active item no mapping points at is left out",
    theorem: "Gini coefficient",
    unit: "index",
    engineFns: ["risk.giniCoefficient"],
    personas: ["economist", "private_equity"],
    catalogIds: [267, 111],
    goodDirection: "down",
    computed: true,
  },
  {
    key: "demand_var",
    name: "Demand Value-at-Risk",
    domain: "risk",
    description:
      "Worst plausible day-on-day drop in bottles out per day (wine_consumption_log, a glass counted as its share of a bottle per ADR 0297, lines with no bottle figure left out) at 95% confidence (historical & parametric), 90d.",
    formula: "VaR = −quantile_{1−c}(returns); CVaR = E[loss | loss ≥ VaR]",
    theorem: "Value at Risk / Expected Shortfall",
    unit: "percent",
    engineFns: [
      "risk.historicalVar",
      "risk.parametricVar",
      "risk.conditionalVar",
    ],
    personas: ["trader", "private_equity"],
    catalogIds: [120, 72],
    goodDirection: "down",
    computed: true,
  },
  {
    key: "revenue_sharpe",
    name: "Demand Sharpe Ratio",
    domain: "risk",
    description:
      "Consistency of day-on-day change in bottles out per day (wine_consumption_log, a glass counted as its share of a bottle per ADR 0297, lines with no bottle figure left out; mean change ÷ volatility), 90d; not money.",
    formula: "(mean return − rf) ÷ stdev(return)",
    theorem: "Sharpe ratio",
    unit: "ratio",
    engineFns: ["risk.sharpeRatio", "risk.sortinoRatio"],
    personas: ["trader", "private_equity"],
    catalogIds: [120],
    goodDirection: "up",
    computed: true,
  },
  {
    key: "revenue_max_drawdown",
    name: "Revenue Max Drawdown",
    domain: "risk",
    description:
      "Largest peak-to-trough decline in cumulative revenue. Not computed: the served demandRisk.maxDrawdown runs over a cumulative sum of non-negative daily demand, which never falls, so it is 0 by construction (v3.0-TECH-DEBT.md defect 4).",
    formula: "max_t (peak − level_t) ÷ peak",
    theorem: "Maximum drawdown",
    unit: "percent",
    engineFns: ["risk.maxDrawdown"],
    personas: ["trader", "private_equity"],
    catalogIds: [186],
    goodDirection: "down",
    computed: false,
  },
  // ---- Econometrics / pricing -----------------------------------------
  {
    key: "price_elasticity",
    name: "Price Elasticity of Demand",
    domain: "causal",
    description: "% change in bottles for a % change in price.",
    formula: "E = %ΔQ ÷ %ΔP  (arc & log-log)",
    theorem: "Price elasticity of demand",
    unit: "ratio",
    engineFns: [
      "finance.priceElasticityArc",
      "finance.priceElasticityLogLog",
      "finance.priceChangeImpact",
    ],
    personas: ["economist", "manager"],
    catalogIds: [41, 81, 181],
    computed: false,
  },
  {
    key: "optimal_markup",
    name: "Optimal Markup (Lerner)",
    domain: "causal",
    description: "Profit-maximizing price implied by measured elasticity.",
    formula: "(P−MC)÷P = −1/E  ⇒  P* = MC · E/(E+1)",
    theorem: "Lerner index / monopoly pricing",
    unit: "currency",
    engineFns: ["finance.optimalPriceFromElasticity"],
    personas: ["economist", "trader"],
    catalogIds: [177, 40],
    computed: false,
  },
  {
    key: "sales_correlation",
    name: "Driver Correlation",
    domain: "causal",
    description:
      "Pearson association between a table's attributes (seats and the like) and its sales measures, with a partial on seats; no weather or critic-score driver is read.",
    formula: "Pearson r",
    theorem: "Correlation coefficients",
    unit: "ratio",
    engineFns: ["stats.pearson"],
    personas: ["statistician", "economist"],
    catalogIds: [17, 67, 94],
    computed: true,
  },
  {
    key: "anomaly_zscore",
    name: "Sales Anomaly Detector",
    domain: "ai",
    description:
      "Flags days whose sales deviate abnormally (robust z-score / MAD).",
    formula: "z = (x − median) ÷ MAD·1.4826",
    theorem: "Robust z-score (Hampel)",
    unit: "score",
    engineFns: ["stats.robustZScore"],
    personas: ["statistician", "operations"],
    catalogIds: [4, 113, 273],
    computed: true,
  },
  {
    key: "structural_break_cusum",
    name: "Demand Shock Detector",
    domain: "forecasting",
    description: "CUSUM change-point alarm for a sustained shift in demand.",
    formula: "Tabular CUSUM S⁺/S⁻ vs decision interval h",
    theorem: "CUSUM control chart",
    unit: "score",
    engineFns: ["stats.cusum"],
    personas: ["statistician", "operations"],
    catalogIds: [93],
    computed: false,
  },
  {
    key: "demand_forecast",
    name: "Demand Forecast",
    domain: "forecasting",
    description:
      "Daily demand over a horizon (14 days by default), house-wide or for one wine, by exponential smoothing with weekly seasonality, fitted on 120 days.",
    formula: "Holt-Winters additive (level+trend+seasonal)",
    theorem: "Holt-Winters exponential smoothing",
    unit: "units",
    engineFns: [
      "forecast.holtWintersAdditive",
      "forecast.holtLinear",
      "forecast.simpleExponentialSmoothing",
    ],
    personas: ["operations", "statistician"],
    catalogIds: [3, 71, 92, 96],
    computed: true,
  },
  {
    key: "seasonal_decomposition",
    name: "Seasonal Decomposition",
    domain: "forecasting",
    description:
      "Weekly seasonal factors of the house's daily demand; the trend and residual components are not served.",
    formula:
      "Seasonal factors of Y = Trend + Seasonal + Residual (centered MA, period 7)",
    theorem: "Classical time-series decomposition",
    unit: "units",
    engineFns: ["forecast.seasonalDecompose"],
    personas: ["statistician"],
    catalogIds: [20, 95],
    computed: true,
  },
  // ---- Advanced lenses (second wave) -----------------------------------
  {
    key: "menu_engineering",
    name: "Menu Engineering Quadrants",
    domain: "menu",
    description:
      "Stars/Plowhorses/Puzzles/Dogs from margin × velocity, with an action per quadrant.",
    formula: "quadrant(margin vs median, velocity vs median)",
    theorem: "Kasavana–Smith menu engineering",
    unit: "score",
    engineFns: ["median", "grossMargin"],
    personas: ["manager", "private_equity"],
    catalogIds: [124, 301, 54],
    computed: true,
  },
  {
    key: "vendor_lead_time",
    name: "Vendor Lead-Time Distribution",
    domain: "vendor",
    description:
      "Mean/median/p90/σ of order→delivery days per vendor; σ is reported, and safety stock does not read it yet.",
    formula: "distribution(delivered_at − created_at)",
    unit: "days",
    engineFns: ["mean", "median", "percentile", "stdev"],
    personas: ["operations", "statistician"],
    catalogIds: [34, 31],
    goodDirection: "down",
    computed: true,
  },
  {
    key: "vendor_price_trend",
    name: "Vendor Unit-Price Trend",
    domain: "vendor",
    description: "Per-vendor $/bottle trajectory across orders.",
    formula: "OLS slope of unit price per order",
    unit: "percent",
    engineFns: ["trendPerPeriodPct"],
    personas: ["manager", "trader"],
    catalogIds: [35, 36],
    goodDirection: "down",
    computed: true,
  },
  {
    key: "weekday_seasonality",
    name: "Weekday Seasonality Profile",
    domain: "forecasting",
    description:
      "Per-weekday demand means + weekly seasonal factors; best/worst day per category.",
    formula: "day-of-week profile + classical decomposition (period 7)",
    unit: "units",
    engineFns: ["dayOfWeekProfile", "seasonalDecompose"],
    personas: ["statistician", "manager"],
    catalogIds: [10, 20, 95],
    computed: true,
  },
  {
    key: "spend_pacing",
    name: "Purchasing Spend Pacing",
    domain: "financial",
    description:
      "30-day spend vs prior 30, Holt 4-week projection, committed open-order exposure.",
    formula: "period-over-period + Holt linear projection",
    unit: "currency",
    engineFns: ["periodOverPeriod", "holtLinear"],
    personas: ["private_equity", "manager"],
    catalogIds: [159, 166, 193],
    goodDirection: "target",
    computed: true,
  },
  {
    key: "recommendations",
    name: "Action Recommendations",
    domain: "ai",
    description:
      "Deterministic rules translating computed numbers into concrete actions with rationale.",
    formula: "rule engine over metrics + insight feed",
    unit: "score",
    engineFns: ["(rule engine)"],
    personas: ["manager", "operations"],
    catalogIds: [52, 57, 74],
    computed: true,
  },
];

/** Quick lookup by key. */
export const METRIC_BY_KEY: Record<string, MetricDefinition> =
  Object.fromEntries(METRIC_REGISTRY.map((m) => [m.key, m]));

export function metricsForPersona(persona: Persona): MetricDefinition[] {
  return METRIC_REGISTRY.filter((m) => m.personas.includes(persona));
}

export function metricsForDomain(domain: string): MetricDefinition[] {
  return METRIC_REGISTRY.filter((m) => m.domain === domain);
}
