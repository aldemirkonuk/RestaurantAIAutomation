import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import * as E from "./engine";
import { AnalyticsService } from "./analytics.service";
import { InsightGeneratorService } from "./insights/insight-generator.service";
import { GoalsService } from "./goals.service";

/**
 * AdvancedAnalyticsService — the second wave of catalogue features.
 *
 * Adds the lenses the base service doesn't cover, each mapped to catalogue
 * ids from .planning/ANALYTICS_FEATURE_CATALOG.md:
 *
 *   • Menu engineering quadrants (margin × velocity)      — #124, #301, #54
 *   • Vendor scorecard (lead times, delivery, unit price) — #31, #34, #35
 *   • Seasonality (weekday profile + decomposition)       — #20, #95, #10
 *   • Cashflow & spend pacing (projection, exposure)      — #159, #166, #193
 *   • Wine-360 (per-entity combination endpoint)          — #275-adjacent
 *   • Overview (all lenses bundled, API-bus pattern)      — #207
 *
 * Same honesty contract as the base service: every payload carries a `basis`
 * label when a number is derived rather than booked.
 */
@Injectable()
export class AdvancedAnalyticsService {
  private readonly logger = new Logger(AdvancedAnalyticsService.name);

  constructor(
    private readonly dbService: DatabaseService,
    private readonly analyticsService: AnalyticsService,
    private readonly insightGenerator: InsightGeneratorService,
    private readonly goalsService: GoalsService,
  ) {}

  // =========================================================================
  // Shared lean loaders
  // =========================================================================

  private async loadInventoryWithCost(restaurantId: string) {
    const client = this.dbService.getClient();
    const [invRes, rollupRes] = await Promise.allSettled([
      client
        .from("restaurant_inventory")
        .select(
          "id, wine_name, wine_type, stock_live, unit_price, unit_cost, master_wine_id",
        )
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true),
      client
        .from("inventory_lot_rollup")
        .select("inventory_id, live_qty, wac, has_invoice_cost")
        .eq("restaurant_id", restaurantId),
    ]);
    const inventory =
      invRes.status === "fulfilled" ? invRes.value.data || [] : [];
    const rollup = new Map<string, any>();
    if (rollupRes.status === "fulfilled")
      for (const r of rollupRes.value.data || []) rollup.set(r.inventory_id, r);
    return inventory.map((i: any) => {
      const lot = rollup.get(i.id);
      const cost =
        lot?.has_invoice_cost && lot?.wac
          ? lot.wac
          : i.unit_cost || (i.unit_price ? i.unit_price * 0.6 : 0);
      return {
        id: i.id,
        masterWineId: i.master_wine_id,
        name: i.wine_name || i.master_wine_id || i.id,
        type: i.wine_type || "unknown",
        qty: lot?.live_qty ?? i.stock_live ?? 0,
        unitCost: cost,
        unitPrice: i.unit_price || 0,
        marginPerBottle: (i.unit_price || 0) - cost,
      };
    });
  }

  private async loadConsumption(restaurantId: string, sinceDays = 90) {
    const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
    const { data } = await this.dbService
      .getClient()
      .from("wine_consumption_log")
      .select("master_wine_id, quantity, volume_ml, created_at")
      .eq("restaurant_id", restaurantId)
      .gte("created_at", since);
    return (data || []).map((c: any) => ({
      wineId: c.master_wine_id,
      qty: c.quantity || (c.volume_ml ? c.volume_ml / 750 : 0),
      date: (c.created_at || "").substring(0, 10),
    }));
  }

  private async loadOrders(restaurantId: string, sinceDays = 365) {
    const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
    const { data } = await this.dbService
      .getClient()
      .from("procurement_orders")
      .select(
        "id, provider_id, provider_name, wine_name, total_cost, final_price, bottles_total, quantity, created_at, delivered_at, expected_delivery_date, status",
      )
      .eq("restaurant_id", restaurantId)
      .gte("created_at", since);
    return data || [];
  }

  private toDaily(
    rows: Array<{ date: string; value: number }>,
    days: number,
  ): number[] {
    const byDay = new Map<string, number>();
    for (const r of rows)
      if (r.date) byDay.set(r.date, (byDay.get(r.date) || 0) + r.value);
    const values: number[] = [];
    const today = new Date();
    for (let d = days; d >= 1; d--) {
      const day = new Date(today.getTime() - d * 86400000)
        .toISOString()
        .substring(0, 10);
      values.push(byDay.get(day) || 0);
    }
    return values;
  }

  // =========================================================================
  // 1. Menu engineering — Stars / Plowhorses / Puzzles / Dogs  (#124, #301)
  // =========================================================================

  async getMenuEngineering(restaurantId: string, sinceDays = 90) {
    const [inventory, consumption] = await Promise.all([
      this.loadInventoryWithCost(restaurantId),
      this.loadConsumption(restaurantId, sinceDays),
    ]);
    const soldByWine = new Map<string, number>();
    for (const c of consumption) {
      if (!c.wineId) continue;
      soldByWine.set(c.wineId, (soldByWine.get(c.wineId) || 0) + c.qty);
    }
    const items = inventory
      .filter((i) => i.unitPrice > 0)
      .map((i) => ({
        id: i.id,
        name: i.name,
        type: i.type,
        velocityPerDay: (soldByWine.get(i.masterWineId) || 0) / sinceDays,
        marginPerBottle: i.marginPerBottle,
        marginPct: E.grossMargin(i.unitCost, i.unitPrice),
      }));

    const velocities = items.map((i) => i.velocityPerDay);
    const margins = items.map((i) => i.marginPerBottle);
    const medVel = E.median(velocities) ?? 0;
    const medMargin = E.median(margins) ?? 0;

    const ACTIONS: Record<string, string> = {
      star: "Protect: keep in stock, feature prominently, never discount.",
      plowhorse:
        "High volume, thin margin: nudge price up or renegotiate cost — small moves scale.",
      puzzle:
        "Great margin, slow mover: feature by-the-glass, staff picks, pairing prompts.",
      dog: "Low volume, low margin: candidate to delist, flight off, or replace.",
    };

    const classified = items.map((i) => {
      const highVel = i.velocityPerDay > medVel;
      const highMargin = i.marginPerBottle > medMargin;
      const quadrant = highVel
        ? highMargin
          ? "star"
          : "plowhorse"
        : highMargin
          ? "puzzle"
          : "dog";
      return { ...i, quadrant, action: ACTIONS[quadrant] };
    });

    const counts: Record<string, number> = {};
    for (const c of classified)
      counts[c.quadrant] = (counts[c.quadrant] || 0) + 1;

    return {
      basis: {
        velocity: `wine_consumption_log units/day over ${sinceDays}d`,
        margin: "unit_price − WAC (lot rollup)",
      },
      medians: { velocityPerDay: medVel, marginPerBottle: medMargin },
      counts,
      items: classified.sort(
        (a, b) =>
          b.velocityPerDay * b.marginPerBottle -
          a.velocityPerDay * a.marginPerBottle,
      ),
      generatedAt: new Date().toISOString(),
    };
  }

  // =========================================================================
  // 2. Vendor scorecard — lead times, delivery performance, unit prices (#31/34/35)
  // =========================================================================

  async getVendorScorecard(restaurantId: string) {
    const orders = await this.loadOrders(restaurantId, 365);
    const byVendor = new Map<string, any[]>();
    for (const o of orders) {
      const key = o.provider_id || "unknown";
      const arr = byVendor.get(key) || [];
      arr.push(o);
      byVendor.set(key, arr);
    }

    const vendors = Array.from(byVendor.entries()).map(([vendorId, os]) => {
      const delivered = os.filter((o) => o.status === "delivered");
      const leadTimes = delivered
        .filter((o) => o.delivered_at && o.created_at)
        .map(
          (o) =>
            (new Date(o.delivered_at).getTime() -
              new Date(o.created_at).getTime()) /
            86400000,
        )
        .filter((d) => d >= 0 && d < 120);
      const onTime = delivered.filter(
        (o) =>
          o.expected_delivery_date &&
          o.delivered_at &&
          new Date(o.delivered_at) <=
            new Date(`${o.expected_delivery_date}T23:59:59Z`),
      ).length;
      const withEta = delivered.filter((o) => o.expected_delivery_date).length;
      const unitPrices = delivered
        .map((o) => {
          const bottles = o.bottles_total || o.quantity || 0;
          const cost = o.total_cost || o.final_price || 0;
          return bottles > 0 ? cost / bottles : null;
        })
        .filter((p): p is number => p !== null && Number.isFinite(p));
      const spend = delivered.reduce(
        (s, o) => s + (o.total_cost || o.final_price || 0),
        0,
      );
      return {
        vendorId,
        vendorName: os[0]?.provider_name || vendorId,
        orders: os.length,
        delivered: delivered.length,
        spend,
        leadTimeDays: {
          mean: E.mean(leadTimes),
          median: E.median(leadTimes),
          p90: E.percentile(leadTimes, 90),
          stdev: E.stdev(leadTimes, true),
          n: leadTimes.length,
        },
        onTimeRate: withEta > 0 ? onTime / withEta : null,
        unitPrice: {
          mean: E.mean(unitPrices),
          latest: unitPrices.length ? unitPrices[unitPrices.length - 1] : null,
          trendPerOrderPct: E.trendPerPeriodPct(unitPrices),
        },
      };
    });

    vendors.sort((a, b) => b.spend - a.spend);
    const spendShare = vendors.map((v) => v.spend);
    return {
      vendors,
      concentration: {
        hhi: E.herfindahlIndex(spendShare),
        effectiveVendors: E.effectiveCount(spendShare),
      },
      note: "Lead-time stdev feeds the King safety-stock formula (leadTimeStdev param on /inventory-science).",
      generatedAt: new Date().toISOString(),
    };
  }

  // =========================================================================
  // 3. Seasonality — weekday profile + classical decomposition (#20, #95)
  // =========================================================================

  async getSeasonality(restaurantId: string, sinceDays = 90) {
    const consumption = await this.loadConsumption(restaurantId, sinceDays);
    const rows = consumption.map((c) => ({ date: c.date, value: c.qty }));
    const byDay = new Map<string, number>();
    for (const r of rows)
      if (r.date) byDay.set(r.date, (byDay.get(r.date) || 0) + r.value);
    const dates: string[] = [];
    const values: number[] = [];
    const today = new Date();
    for (let d = sinceDays; d >= 1; d--) {
      const day = new Date(today.getTime() - d * 86400000)
        .toISOString()
        .substring(0, 10);
      dates.push(day);
      values.push(byDay.get(day) || 0);
    }

    const weekday = E.dayOfWeekProfile(dates, values);
    const decomposition = E.seasonalDecompose(values, 7);
    const trend28 = E.trendPerPeriodPct(values.slice(-28));

    // Per-category weekday winners (which type sells on which day).
    const byType = new Map<string, Array<{ date: string; value: number }>>();
    const client = this.dbService.getClient();
    const { data: inv } = await client
      .from("restaurant_inventory")
      .select("master_wine_id, wine_type")
      .eq("restaurant_id", restaurantId);
    const typeByWine = new Map(
      (inv || []).map((i: any) => [i.master_wine_id, i.wine_type || "unknown"]),
    );
    for (const c of consumption) {
      const t = typeByWine.get(c.wineId) || "unknown";
      const arr = byType.get(t) || [];
      arr.push({ date: c.date, value: c.qty });
      byType.set(t, arr);
    }
    const categoryProfiles = Array.from(byType.entries())
      .filter(([, r]) => r.length >= 10)
      .map(([type, r]) => {
        const dts = r.map((x) => x.date);
        const vls = r.map((x) => x.value);
        const p = E.dayOfWeekProfile(dts, vls);
        return {
          type,
          bestDay: p.best ? E.WEEKDAY_NAMES[p.best.weekday] : null,
          worstDay: p.worst ? E.WEEKDAY_NAMES[p.worst.weekday] : null,
        };
      });

    return {
      weekdayProfile: weekday.profiles.map((p) => ({
        day: E.WEEKDAY_NAMES[p.weekday],
        mean: p.mean,
        stdev: p.stdev,
        n: p.n,
      })),
      bestDay: weekday.best ? E.WEEKDAY_NAMES[weekday.best.weekday] : null,
      worstDay: weekday.worst ? E.WEEKDAY_NAMES[weekday.worst.weekday] : null,
      weeklySeasonalFactors: decomposition
        ? decomposition.seasonal.slice(0, 7)
        : null,
      trendPerDayPct: trend28,
      categoryProfiles,
      generatedAt: new Date().toISOString(),
    };
  }

  // =========================================================================
  // 4. Cashflow — spend pacing, projection, upcoming exposure (#159/166/193)
  // =========================================================================

  async getCashflow(restaurantId: string) {
    const orders = await this.loadOrders(restaurantId, 180);
    const delivered = orders.filter((o: any) => o.status === "delivered");
    const spendRows = delivered.map((o: any) => ({
      date: (o.delivered_at || o.created_at || "").substring(0, 10),
      value: o.total_cost || o.final_price || 0,
    }));
    const daily = this.toDaily(spendRows, 180);

    const last30 = daily.slice(-30).reduce((a, b) => a + b, 0);
    const prev30 = daily.slice(-60, -30).reduce((a, b) => a + b, 0);
    const pace = E.periodOverPeriod(daily, 30);

    // Weekly series → Holt projection 4 weeks out.
    const weekly: number[] = [];
    for (let i = 0; i < daily.length; i += 7)
      weekly.push(daily.slice(i, i + 7).reduce((a, b) => a + b, 0));
    const holt = weekly.length >= 4 ? E.holtLinear(weekly, 0.4, 0.2, 4) : null;

    // Committed outflow: orders placed but not delivered.
    const open = orders.filter((o: any) =>
      ["pending", "awaiting_approval", "ordered", "in_transit"].includes(
        o.status,
      ),
    );
    const committed = open.reduce(
      (s: number, o: any) => s + (o.total_cost || o.final_price || 0),
      0,
    );

    return {
      basis: {
        outflow: "delivered procurement_orders (revenue inflow needs POS feed)",
      },
      spendLast30d: last30,
      spendPrev30d: prev30,
      paceDeltaPct: pace?.deltaPct ?? null,
      projectedNext4Weeks: holt?.forecast.map((v) => Math.max(0, v)) ?? null,
      committedOpenOrders: committed,
      openOrderCount: open.length,
      generatedAt: new Date().toISOString(),
    };
  }

  // =========================================================================
  // 5. Wine-360 — per-entity combination endpoint
  // =========================================================================

  async getWine360(restaurantId: string, masterWineId: string) {
    const [inventory, consumption, forecast] = await Promise.all([
      this.loadInventoryWithCost(restaurantId),
      this.loadConsumption(restaurantId, 90),
      this.analyticsService.getDemandForecast(restaurantId, {
        masterWineId,
        horizon: 14,
      }),
    ]);
    const item = inventory.find((i) => i.masterWineId === masterWineId);
    const mine = consumption.filter((c) => c.wineId === masterWineId);
    const daily = this.toDaily(
      mine.map((c) => ({ date: c.date, value: c.qty })),
      90,
    );
    const profile = E.demandProfile(daily);
    const totals = new Map<string, number>();
    for (const c of consumption)
      if (c.wineId) totals.set(c.wineId, (totals.get(c.wineId) || 0) + c.qty);
    const standings = E.peerComparison(
      Array.from(totals.entries()).map(([id, v]) => ({ entity: id, value: v })),
    );
    const standing = standings.find((s) => s.entity === masterWineId);

    const rop =
      profile && profile.mean > 0
        ? E.reorderPoint({
            serviceLevel: 0.95,
            avgDemandPerPeriod: profile.mean,
            demandStdev: profile.stdev,
            avgLeadTime: 7,
          })
        : null;

    return {
      masterWineId,
      name: item?.name ?? masterWineId,
      onHand: item?.qty ?? null,
      unitPrice: item?.unitPrice ?? null,
      unitCost: item?.unitCost ?? null,
      marginPerBottle: item?.marginPerBottle ?? null,
      demand: profile,
      daysOfCover:
        item && profile && profile.mean > 0
          ? E.daysOfCover(item.qty, profile.mean)
          : null,
      stockoutProbability:
        item && profile
          ? E.stockoutProbability({
              onHand: item.qty,
              avgDemandPerPeriod: profile.mean,
              demandStdev: profile.stdev,
              leadTime: 7,
            })
          : null,
      reorderPoint: rop?.reorderPoint ?? null,
      safetyStock: rop?.safetyStock ?? null,
      rankByVolume: standing?.rank ?? null,
      peerCount: standings.length,
      forecast14d: forecast.totalForecastDemand,
      forecastModel: forecast.model,
      trendPerDayPct: E.trendPerPeriodPct(daily.slice(-28)),
      generatedAt: new Date().toISOString(),
    };
  }

  // =========================================================================
  // 6. Overview — every lens in one call (API-bus pattern, #207)
  // =========================================================================

  async getOverview(restaurantId: string) {
    const startedAt = Date.now();
    const [
      financial,
      risk,
      invSci,
      menu,
      seasonality,
      cashflow,
      insights,
      goals,
    ] = await Promise.allSettled([
      this.analyticsService.getFinancialSummary(restaurantId),
      this.analyticsService.getRiskProfile(restaurantId),
      this.analyticsService.getInventoryScience(restaurantId),
      this.getMenuEngineering(restaurantId),
      this.getSeasonality(restaurantId),
      this.getCashflow(restaurantId),
      this.insightGenerator.getStored(restaurantId, { limit: 8 }),
      this.goalsService.listGoals(restaurantId, "active"),
    ]);
    const ok = (r: PromiseSettledResult<any>) =>
      r.status === "fulfilled" ? r.value : null;
    const inventoryScience = ok(invSci);
    const menuFull = ok(menu);
    return {
      financial: ok(financial),
      risk: ok(risk),
      inventory: inventoryScience
        ? {
            reorderCount: inventoryScience.reorderCount,
            reorderTop: inventoryScience.reorderList?.slice(0, 5),
            skuCount: inventoryScience.skuCount,
          }
        : null,
      menuEngineering: menuFull
        ? { counts: menuFull.counts, top: menuFull.items?.slice(0, 5) }
        : null,
      seasonality: ok(seasonality),
      cashflow: ok(cashflow),
      insights: ok(insights) ?? [],
      activeGoals: ok(goals) ?? [],
      computedIn: Date.now() - startedAt,
      generatedAt: new Date().toISOString(),
    };
  }
}
