/**
 * Payloads shaped as the analytics services return them, one per exportable
 * cutting. Several carry the engine's `null`s on purpose — a cellar with no
 * complete cost basis, a forecast with no fitted model, a weekday tie — because
 * those are the figures an export must write as withheld and never as 0.
 *
 * Field names are the services' own (analytics.service.ts getFinancialSummary,
 * advanced-analytics.service.ts getCashflow / getSeasonality / getOverview /
 * getMenuEngineering, goals.service.ts getPosRevenueWindow /
 * listGoalsWithProgress, table-analytics.service.ts, insight-generator.service.ts).
 */
import type { ExportableCutting } from "../report-export-cuttings";

export const HOUSE_A = "11111111-1111-4111-8111-111111111111";
export const HOUSE_B = "22222222-2222-4222-8222-222222222222";
export const MANAGER_A = "33333333-3333-4333-8333-333333333333";

export const PAYLOADS: Record<ExportableCutting, unknown> = {
  reading: {
    source: "stored",
    insights: [
      { candidate_key: "a", sentence: "Barolo sold 32% above its own average this week.", category: "sales", score: 9, entity_label: "Barolo" },
      { candidate_key: "b", sentence: "=HYPERLINK(\"http://evil\")", category: "tables", score: 4, entity_label: null },
    ],
  },
  till: {
    restaurantId: HOUSE_A,
    posConnected: true,
    revenue: 4210.5,
    checkCount: 96,
    from: "2026-08-19",
    to: "2026-09-17",
    days: 30,
    dailySeries: [
      { date: "2026-09-01", revenue: 310 },
      { date: "2026-09-02", revenue: 480.25 },
    ],
  },
  goals: {
    status: "active",
    goals: [
      {
        goal: { id: "g1", name: "Lift wine attach", metric_key: "wine_attach_rate", deadline: "2026-12-31", baseline_value: 0.2 },
        metricLabel: "Wine attach rate",
        unit: "percent",
        current: 0.24,
        target: 0.3,
        progressPct: 0.8,
        onTrack: true,
      },
      { goal: { id: "g2", name: "Cut waste", metric_key: "waste", deadline: null }, unreadable: true, reason: "metric query failed" },
    ],
    total: 2,
    truncated: false,
    basis: { current: "recomputed from the engine's query", peers: "no other restaurant's books" },
  },
  bench: {
    cashflow: { spendLast30d: 1200, spendPrev30d: 900, paceDeltaPct: 33.3, committedOpenOrders: 400, openOrderCount: 2, basis: { outflow: "delivered procurement_orders" } },
    seasonality: null,
    activeGoals: [{ name: "Lift wine attach", metric_key: "wine_attach_rate", baseline_value: 0.2, current_value: 0.24, target_value: 0.3 }],
  },
  pacing: {
    spendLast30d: 1200,
    spendPrev30d: 900,
    paceDeltaPct: 33.3,
    projectedNext4Weeks: null,
    committedOpenOrders: 400,
    openOrderCount: 2,
    basis: { outflow: "delivered procurement_orders" },
  },
  week: {
    weekdayProfile: [
      { day: "Monday", mean: 2, stdev: 1, n: 12 },
      { day: "Tuesday", mean: 0, stdev: 0, n: 0 },
      { day: "Friday", mean: 6, stdev: 2, n: 12 },
      { day: "Saturday", mean: 6, stdev: 2, n: 12 },
    ],
    bestDay: null,
    worstDay: null,
    tie: true,
    trendPerDayPct: -0.4,
    basis: { weekday: "mean units per weekday over 90d", extremes: "withheld on a tie" },
  },
  ahead: {
    model: null,
    modelFitted: false,
    horizon: 14,
    history: { dates: [], values: [] },
    forecast: [],
    totalForecastDemand: null,
    accuracy: null,
    basis: { demand: "wine_consumption_log, 120 days" },
  },
  quadrants: {
    basis: { velocity: "90d consumption", margin: "unit_price − unit cost" },
    costCoverage: { total: 2, priced: 1, unpriced: 1, complete: false },
    medians: { velocityPerDay: 0.5, marginPerBottle: 22 },
    counts: { unclassified: 1, star: 1 },
    items: [
      { id: "w1", name: "Barolo 2019", velocityPerDay: 0.8, marginPerBottle: 30, marginPct: 0.5, quadrant: "star" },
      { id: "w2", name: "<script>alert(1)</script> Nebbiolo", velocityPerDay: 0.1, marginPerBottle: null, marginPct: null, quadrant: null },
    ],
  },
  ledger: {
    basis: { cogs: "delivered procurement_orders (trailing 365d) — null: no delivered order was returned", revenue: "unit_price × on-hand qty", inventoryValue: "on-hand qty × unit cost — 1 of 2", deadStock: "zero movement", costDerived: "null unless every on-hand row carries a recorded cost" },
    costCoverage: { total: 2, priced: 1, unpriced: 1, complete: false },
    inventoryValue: null,
    cogs: null,
    revenue: 5400,
    grossMargin: null,
    cogsRatio: null,
    inventoryTurnover: null,
    daysInventoryOutstanding: null,
    gmroi: null,
    deadStockCapital: null,
  },
  seats: {
    sinceDays: 90,
    dataStatus: "live",
    tables: [
      { tableId: "t1", label: "T1", zone: "Terrace", seats: 4, checks: 12, revenue: 900, covers: 30, avgCheck: 75, revenuePerSeat: 225, seatUtilization: 0.4, wineAttachRate: 0.5 },
      { tableId: "t2", label: "T2", zone: null, seats: null, checks: 0, revenue: 0, covers: 0, avgCheck: null, revenuePerSeat: null, seatUtilization: null, wineAttachRate: null },
    ],
  },
  service: {
    sinceDays: 90,
    dataStatus: "live",
    adjusted: null,
    waiters: [{ name: "Ayşe", checks: 40, revenue: 3000, avgCheck: 75, wineAttachRate: 0.4, tipPct: null, revenuePerCover: 30 }],
  },
  restock: {
    params: { serviceLevel: 0.95, leadTimeDays: 7, demandWindowDays: 90 },
    basis: { demand: "90d consumption", reorderScience: "EOQ + safety stock" },
    skuCount: 12,
    reorderCount: 3,
    reorderList: [
      { id: "w1", name: "Barolo 2019", onHand: 2, daysOfCover: 2.5, reorderPoint: 6, safetyStock: 2, stockoutProbability: 0.7 },
      { id: "w3", name: "Chablis", onHand: 1, daysOfCover: null, reorderPoint: null, safetyStock: null, stockoutProbability: null },
    ],
  },
};
