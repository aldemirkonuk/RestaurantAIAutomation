/**
 * WineOps Analytics Engine — public barrel.
 *
 * The engine is a pure, dependency-free mathematical core (no NestJS, no DB)
 * so it can be unit-tested exhaustively and reused anywhere (services, cron
 * jobs, scripts, edge functions). Import from here:
 *
 *   import { eoq, safetyStock, herfindahlIndex, holtWintersAdditive } from
 *     "../analytics/engine";
 *
 * Modules:
 *   • statistics        — descriptive stats, correlation, OLS, distributions
 *   • finance           — TVM, margins, elasticity, working capital, HHI
 *   • inventory-science — EOQ, safety stock, turnover, GMROI, ABC/XYZ
 *   • risk              — VaR/CVaR, Sharpe, drawdown, portfolio, Gini
 *   • forecasting       — SES/Holt/Holt-Winters, decomposition, error metrics
 */

export * as stats from "./statistics";
export * as finance from "./finance";
export * as inventory from "./inventory-science";
export * as risk from "./risk";
export * as forecast from "./forecasting";
export * as regression from "./regression";
export * as association from "./association";
export * as compare from "./comparisons";
export * as linalg from "./linalg";
export * as pricing from "./pricing-agility";
export * as costing from "./cost-basis";
export * as vendorPrice from "./vendor-price-consensus";

// Also re-export the flat surface for ergonomic single-name imports.
export * from "./statistics";
export * from "./finance";
export * from "./inventory-science";
export * from "./risk";
export * from "./forecasting";
export * from "./regression";
export * from "./association";
export * from "./comparisons";
export * from "./pricing-agility";
export * from "./cost-basis";
export * from "./vendor-price-consensus";
