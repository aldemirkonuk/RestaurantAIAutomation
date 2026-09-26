import { Injectable } from "@nestjs/common";
import { AnalyticsService } from "../../analytics/analytics.service";
import { AdvancedAnalyticsService } from "../../analytics/advanced-analytics.service";
import { GoalsService } from "../../analytics/goals.service";
import { TableAnalyticsService } from "../../analytics/table-analytics.service";
import { InsightGeneratorService } from "../../analytics/insights/insight-generator.service";
import type { ExportableCutting } from "./report-export-cuttings";

/**
 * Reads one cutting's payload the way the /reports page reads it — through the
 * SAME gateway service, with the SAME parameters as the page's request path.
 *
 * Each case cites the page's path (`apps/web/src/pages/reports/next/
 * rp-registers-*.tsx`) and the `AnalyticsController` handler that serves it.
 * `report-cutting-reader.spec.ts` builds that controller on the same service
 * doubles and asserts the two answer identically, so a parameter that drifts
 * here (a horizon, a window, a status filter) fails a test rather than
 * producing an export that disagrees with the screen.
 *
 * A service that throws is NOT caught here: the export service turns it into a
 * `failed` export with the reason, which is the honest outcome — an export
 * written from a read that did not answer would print its absence as figures.
 */
@Injectable()
export class ReportCuttingReader {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly advanced: AdvancedAnalyticsService,
    private readonly goals: GoalsService,
    private readonly tables: TableAnalyticsService,
    private readonly insights: InsightGeneratorService,
  ) {}

  async read(
    restaurantId: string,
    cutting: ExportableCutting,
    days: number | null,
  ): Promise<unknown> {
    switch (cutting) {
      // GET /analytics/insights/:rid?limit=40 — AnalyticsController.getInsights
      // (its readInsights): the stored feed with the ONE shared per-item state
      // applied (ADR 0191), and on a cold start one live computation, persisted.
      // A cache whose every row is withheld is an answer, not a cold start, so
      // the test is rows READ, not rows kept — the same as the page.
      // The page then drops what the person looking snoozed for themselves
      // (ADR 0191 round 3, "Only them"). An export has no one looking — it is
      // queued and read later, and the file can reach others — so it is the
      // house's answer, as the digest and the MCP reader are.
      case "reading": {
        const stored = await this.insights.readStored(restaurantId, {
          categories: undefined,
          limit: 40,
        });
        if (stored.read > 0)
          return {
            source: "stored",
            insights: stored.rows,
            suppressed: stored.withheld.dismissed,
            withheld: stored.withheld,
            suppressionsReadable: stored.suppressionsReadable,
          };
        return this.insights.generate(restaurantId, {
          categories: undefined,
          persist: true,
        });
      }
      // GET /analytics/pos-revenue/:rid?days= — AnalyticsController.getPosRevenue.
      // The handler also attaches a per-wine consumption breakdown; the till
      // cutting reads none of it, so neither does its export.
      case "till":
        return this.goals.getPosRevenueWindow(restaurantId, days ?? 30);
      // GET /analytics/goals/:rid/progress — the handler's default status.
      case "goals":
        return this.goals.listGoalsWithProgress(restaurantId, "active");
      // GET /analytics/overview/:rid
      case "bench":
        return this.advanced.getOverview(restaurantId);
      // GET /analytics/cashflow/:rid
      case "pacing":
        return this.advanced.getCashflow(restaurantId);
      // GET /analytics/seasonality/:rid
      case "week":
        return this.advanced.getSeasonality(restaurantId);
      // GET /analytics/forecast/:rid?horizon=14
      case "ahead":
        return this.analytics.getDemandForecast(restaurantId, {
          masterWineId: undefined,
          horizon: 14,
        });
      // GET /analytics/menu-engineering/:rid
      case "quadrants":
        return this.advanced.getMenuEngineering(restaurantId);
      // GET /analytics/financial/:rid — no `labor` on the page's path, which
      // the handler reads as 0.
      case "ledger":
        return this.analytics.getFinancialSummary(restaurantId, 0);
      // GET /analytics/table-performance/:rid?sinceDays=90
      case "seats":
        return this.tables.getTablePerformance(restaurantId, 90);
      // GET /analytics/waiters/:rid?sinceDays=90
      case "service":
        return this.tables.getWaiterPerformance(restaurantId, 90);
      // GET /analytics/inventory-science/:rid — no params on the page's path.
      case "restock":
        return this.analytics.getInventoryScience(restaurantId, {
          serviceLevel: undefined,
          leadTimeDays: undefined,
        });
      default: {
        const never: never = cutting;
        throw new Error(`No reader for cutting ${String(never)}`);
      }
    }
  }
}
