import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import * as E from "./engine";
import { METRIC_REGISTRY, MetricDefinition, Persona } from "./metric-registry";
import {
  costBasisSentence,
  resolveUnitCost,
  summarizeCostBasis,
} from "./inventory-cost";
import { ORDER_SPEND_STATUSES } from "../procurement/order-status";

/**
 * AnalyticsService — the quantitative heart of WineOps.
 *
 * Pulls raw operational data from Supabase and runs it through the pure
 * analytics engine (`./engine`) to produce financial, inventory-science,
 * risk, and forecasting metrics. All heavy math lives in the engine (and is
 * unit-tested there); this service is only responsible for (a) fetching &
 * shaping data and (b) mapping it onto the right formulas.
 *
 * Data-source conventions (documented so numbers are auditable):
 *   • Purchases / COGS   ← procurement_orders (delivered) total_cost|final_price
 *   • On-hand & cost     ← restaurant_inventory + inventory_lot_rollup.wac
 *   • Consumption/demand ← wine_consumption_log (quantity, volume_ml)
 *   • Vendor structure   ← procurement_orders.provider_id
 *
 * Where a true POS revenue feed is not yet wired, "revenue" is derived from
 * consumption × unit_price and clearly labelled `basis` in the payload so the
 * UI never presents an approximation as a booked figure.
 */
/**
 * One wine's measured POS sales over a window. A `null` here always means "we
 * have no record", never "zero" — see `getPosConsumptionBreakdown`.
 */
export interface PosConsumptionRow {
  inventoryId: string | null;
  wineName: string;
  bottlesSold: number;
  /** Summed `total_revenue` of bottle lines; null when none carried a price. */
  bottleRevenue: number | null;
  bottleVolumeMl: number;
  /** Measured ml per bottle sold; null when nothing was sold by the bottle. */
  avgBottleMl: number | null;
  /** False when at least one bottle line had no price — the total understates. */
  bottleRevenueComplete: boolean;
  glassesSold: number;
  glassRevenue: number | null;
  glassVolumeMl: number;
  /** Measured pour size; null when nothing was sold by the glass. */
  avgPourMl: number | null;
  glassRevenueComplete: boolean;
  /** `restaurant_inventory.last_purchase_price`; null blocks margin honestly. */
  costPerBottle: number | null;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly HOLDING_RATE = 0.26; // capital+storage+spoilage, %/yr

  constructor(private readonly dbService: DatabaseService) {}

  // =========================================================================
  // Metric catalog (registry) — the "formula library"
  // =========================================================================

  getMetricCatalog(filter?: { persona?: Persona; domain?: string }): {
    count: number;
    metrics: MetricDefinition[];
  } {
    let metrics = METRIC_REGISTRY;
    if (filter?.persona)
      metrics = metrics.filter((m) => m.personas.includes(filter.persona!));
    if (filter?.domain)
      metrics = metrics.filter((m) => m.domain === filter.domain);
    return { count: metrics.length, metrics };
  }

  // =========================================================================
  // Shared data loaders
  // =========================================================================

  private async loadInventory(restaurantId: string) {
    const client = this.dbService.getClient();
    const [invRes, rollupRes] = await Promise.allSettled([
      client
        .from("restaurant_inventory")
        // Column names must match the live schema exactly. PostgREST rejects
        // the WHOLE query with 42703 on a single unknown column, and the
        // allSettled + `data || []` below turns that rejection into an empty
        // inventory rather than an error — so every metric downstream
        // (inventory value, COGS ratio, turnover, GMROI, reorder science)
        // silently reported 0/null for every restaurant. There is no
        // wine_type/unit_price/unit_cost/reorder_point on this table: the
        // menu price is `menu_price_current`, cost is `last_purchase_price`,
        // the reorder trigger is `threshold_min`, and the varietal/type
        // lives on master_wine_library.
        .select(
          "id, wine_name, stock_live, menu_price_current, last_purchase_price, threshold_min, master_wine_id, master_wine_library(primary_type)",
        )
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true),
      client
        .from("inventory_lot_rollup")
        .select(
          // wac_qty / live_qty added 2026-09-02 (ADR 0078) so resolveUnitCost
          // can tell a WAC that covers every on-hand bottle from one that
          // covers a single invoiced bottle in twenty-one.
          "inventory_id, live_qty, wac, has_invoice_cost, wac_qty",
        )
        .eq("restaurant_id", restaurantId),
    ]);

    const inventory =
      invRes.status === "fulfilled" ? invRes.value.data || [] : [];
    const rollup = new Map<string, any>();
    if (rollupRes.status === "fulfilled") {
      for (const r of rollupRes.value.data || []) rollup.set(r.inventory_id, r);
    }

    // Unit cost: invoiced lot WAC → recorded last purchase price → UNKNOWN.
    // The third branch used to be `unitPrice * 0.6`, a magic number with no
    // ADR behind it, and it was the live path for ~70 of 72 production rows.
    // See ./inventory-cost.ts for why cost is now `number | null`.
    return inventory.map((i: any) => {
      const lot = rollup.get(i.id);
      const unitPrice = Number(i.menu_price_current) || 0;
      const { unitCost, costBasis } = resolveUnitCost(i, lot);
      const qty = lot?.live_qty ?? i.stock_live ?? 0;
      return {
        id: i.id,
        name: i.wine_name || i.master_wine_id || i.id,
        type: i.master_wine_library?.primary_type || "unknown",
        qty,
        unitCost,
        costBasis,
        unitPrice,
        thresholdMin: i.threshold_min || 0,
        // This schema carries a single reorder trigger (threshold_min); there
        // is no separate reorder_point column.
        reorderPoint: i.threshold_min || 0,
        masterWineId: i.master_wine_id,
        // A row we cannot cost has no value we can state. `qty × null` must
        // not become 0 — that is the fabrication ADR 0051 names, wearing an
        // arithmetic costume.
        inventoryValue: unitCost == null ? null : qty * unitCost,
      };
    });
  }

  private async loadDeliveredOrders(restaurantId: string, sinceDays = 365) {
    const client = this.dbService.getClient();
    const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
    const { data } = await client
      .from("procurement_orders")
      .select(
        "id, provider_id, total_cost, final_price, bottles_total, quantity, delivered_at, created_at, status",
      )
      .eq("restaurant_id", restaurantId)
      .in("status", ORDER_SPEND_STATUSES)
      .gte("delivered_at", since);
    return (data || []).map((o: any) => ({
      providerId: o.provider_id || "unknown",
      cost: o.total_cost || o.final_price || 0,
      bottles: o.bottles_total || o.quantity || 0,
      date: (o.delivered_at || o.created_at || "").substring(0, 10),
    }));
  }

  private async loadConsumption(restaurantId: string, sinceDays = 90) {
    const client = this.dbService.getClient();
    const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
    // wine_consumption_log keys on inventory_id — it has no master_wine_id
    // column, so selecting one 42703s the whole query and silently yields an
    // empty demand series (zero velocity, zero forecast, no reorder points).
    // Resolve the wine through the inventory FK instead.
    const { data, error } = await client
      .from("wine_consumption_log")
      .select(
        "inventory_id, quantity, volume_ml, created_at, restaurant_inventory(master_wine_id)",
      )
      .eq("restaurant_id", restaurantId)
      .gte("created_at", since);
    // getFinancialSummary's dead-stock join now depends on this series, and an
    // empty one is deliberately read as "no movement signal" rather than "no
    // movement" — so a failure here must at least be loud in the logs.
    if (error)
      this.logger.error(
        `analytics query on wine_consumption_log failed — demand, reorder ` +
          `science and dead stock will report empty rather than wrong: ` +
          `${error.code ?? "?"} ${error.message ?? error}`,
      );
    return (data || []).map((c: any) => ({
      masterWineId: c.restaurant_inventory?.master_wine_id ?? null,
      inventoryId: c.inventory_id,
      qty: c.quantity || (c.volume_ml ? c.volume_ml / 750 : 0),
      date: (c.created_at || "").substring(0, 10),
    }));
  }

  /** Aggregate rows into a dense daily series over [sinceDays, today]. */
  private toDailySeries(
    rows: Array<{ date: string; value: number }>,
    sinceDays: number,
  ): { dates: string[]; values: number[] } {
    const byDay = new Map<string, number>();
    for (const r of rows) {
      if (!r.date) continue;
      byDay.set(r.date, (byDay.get(r.date) || 0) + r.value);
    }
    const dates: string[] = [];
    const values: number[] = [];
    const today = new Date();
    for (let d = sinceDays - 1; d >= 0; d--) {
      const day = new Date(today.getTime() - d * 86400000)
        .toISOString()
        .substring(0, 10);
      dates.push(day);
      values.push(byDay.get(day) || 0);
    }
    return { dates, values };
  }

  // =========================================================================
  // POS consumption breakdown (OD-85)
  // =========================================================================

  /**
   * Per-wine bottle/glass sales over a closed day range, for the Reports page's
   * "Wine Consumption Analytics" section — which shipped with its data source
   * hard-coded to `[]`.
   *
   * Every figure is a SUM of what `wine_consumption_log` actually recorded, not
   * `quantity × some price`: a wine sold at a happy-hour price and a list price
   * in the same window has two real revenues, and multiplying by one of them
   * would invent a third. `pos-hub.service.ts` writes these rows (volume_ml,
   * total_revenue) as each check lands.
   *
   * Nulls are load-bearing. `bottleRevenue: null` means no line carried a price,
   * which is not the same as $0; `costPerBottle: null` means the margin column
   * cannot be computed at all, which is not the same as a 100% margin.
   */
  async getPosConsumptionBreakdown(
    restaurantId: string,
    fromDate: string,
    toDate: string,
  ): Promise<PosConsumptionRow[]> {
    const client = this.dbService.getClient();
    // `created_at` (not `recorded_at`) is what pos-hub writes through and what
    // loadConsumption above already filters on — keep the two consistent.
    const { data, error } = await client
      .from("wine_consumption_log")
      .select(
        "inventory_id, wine_name, consumption_type, quantity, volume_ml, total_revenue, restaurant_inventory(wine_name, last_purchase_price)",
      )
      .eq("restaurant_id", restaurantId)
      .gte("created_at", `${fromDate}T00:00:00Z`)
      .lte("created_at", `${toDate}T23:59:59.999Z`);
    if (error) throw new Error(error.message);

    type Acc = PosConsumptionRow & {
      bottleRevenueRows: number;
      bottleRows: number;
      glassRevenueRows: number;
      glassRows: number;
      bottleRevenueRaw: number;
      glassRevenueRaw: number;
    };
    const byWine = new Map<string, Acc>();

    for (const row of data || []) {
      const inv: any = (row as any).restaurant_inventory ?? null;
      const wineName =
        (row as any).wine_name || inv?.wine_name || "Unnamed wine";
      const key = (row as any).inventory_id || wineName;
      let acc = byWine.get(key);
      if (!acc) {
        acc = {
          inventoryId: (row as any).inventory_id ?? null,
          wineName,
          bottlesSold: 0,
          bottleRevenue: null,
          bottleVolumeMl: 0,
          avgBottleMl: null,
          bottleRevenueComplete: true,
          glassesSold: 0,
          glassRevenue: null,
          glassVolumeMl: 0,
          avgPourMl: null,
          glassRevenueComplete: true,
          costPerBottle:
            inv?.last_purchase_price == null
              ? null
              : Number(inv.last_purchase_price),
          bottleRevenueRows: 0,
          bottleRows: 0,
          glassRevenueRows: 0,
          glassRows: 0,
          bottleRevenueRaw: 0,
          glassRevenueRaw: 0,
        };
        byWine.set(key, acc);
      }

      const qty = Number((row as any).quantity) || 0;
      const ml = Number((row as any).volume_ml) || 0;
      const revenue = (row as any).total_revenue;
      const hasRevenue = revenue != null && !Number.isNaN(Number(revenue));

      if ((row as any).consumption_type === "glass") {
        acc.glassesSold += qty;
        acc.glassVolumeMl += ml;
        acc.glassRows += 1;
        if (hasRevenue) {
          acc.glassRevenueRaw += Number(revenue);
          acc.glassRevenueRows += 1;
        }
      } else {
        acc.bottlesSold += qty;
        acc.bottleVolumeMl += ml;
        acc.bottleRows += 1;
        if (hasRevenue) {
          acc.bottleRevenueRaw += Number(revenue);
          acc.bottleRevenueRows += 1;
        }
      }
    }

    return Array.from(byWine.values()).map((a) => {
      const {
        bottleRevenueRows,
        bottleRows,
        glassRevenueRows,
        glassRows,
        bottleRevenueRaw,
        glassRevenueRaw,
        ...row
      } = a;
      row.bottleRevenue = bottleRevenueRows > 0 ? bottleRevenueRaw : null;
      row.bottleRevenueComplete =
        bottleRows === 0 || bottleRevenueRows === bottleRows;
      row.glassRevenue = glassRevenueRows > 0 ? glassRevenueRaw : null;
      row.glassRevenueComplete =
        glassRows === 0 || glassRevenueRows === glassRows;
      // Measured average, not the 750ml/150ml assumption the UI used to make.
      row.avgBottleMl =
        row.bottlesSold > 0
          ? Math.round(row.bottleVolumeMl / row.bottlesSold)
          : null;
      row.avgPourMl =
        row.glassesSold > 0
          ? Math.round(row.glassVolumeMl / row.glassesSold)
          : null;
      return row;
    });
  }

  // =========================================================================
  // 1. Financial summary — the P&L / capital-efficiency lens
  // =========================================================================

  async getFinancialSummary(restaurantId: string, labor = 0) {
    const DEAD_STOCK_WINDOW_DAYS = 90;
    const [inventory, orders, consumption] = await Promise.all([
      this.loadInventory(restaurantId),
      this.loadDeliveredOrders(restaurantId, 365),
      this.loadConsumption(restaurantId, DEAD_STOCK_WINDOW_DAYS),
    ]);

    // A row holding no bottles contributes 0 to the valuation whatever it
    // cost, so it cannot block the total. Only ON-HAND rows need a cost.
    const onHand = inventory.filter((i) => i.qty > 0);
    // NB `complete` is false for an EMPTY on-hand set, so an empty cellar
    // reports null rather than $0. That is deliberate: `loadInventory` above
    // degrades a failed PostgREST query to `[]` (see its comment), so `[]` is
    // "no rows or no answer", and $0 for a dead query is precisely the silent
    // zero this endpoint has already been burned by once.
    const costCoverage = summarizeCostBasis(onHand);
    // A total assembled from 2 of 72 SKUs is not "inventory value" — it is a
    // different, much smaller number wearing that label. ADR 0051: say we do
    // not know. `costCoverage` below says how far off complete we are, so the
    // UI can name the gap instead of rendering a silent understatement.
    const inventoryValue = costCoverage.complete
      ? E.stats.sum(onHand.map((i) => i.inventoryValue as number))
      : null;
    const cogs = E.stats.sum(orders.map((o) => o.cost));

    // Revenue basis: sell-price valuation of purchased bottles (proxy until a
    // POS revenue feed lands). Menu price is recorded, so this survives an
    // unknown cost — it is the cost-derived fields below that go null.
    const revenue = E.stats.sum(
      inventory.map((i) => i.unitPrice * (i.qty || 0)),
    );
    const marginDollars =
      inventoryValue == null ? null : revenue - inventoryValue;

    // Every one of these takes inventory value as its cost input. A null cost
    // makes them unknown, not zero and not infinite.
    const turnover =
      inventoryValue == null
        ? null
        : E.inventory.inventoryTurnover(cogs, inventoryValue);
    const dio =
      inventoryValue == null
        ? null
        : E.inventory.daysInventoryOutstanding(cogs, inventoryValue);
    const gmroi =
      inventoryValue == null || marginDollars == null
        ? null
        : E.inventory.gmroi(marginDollars, inventoryValue);
    const grossMargin =
      inventoryValue != null && revenue > 0
        ? E.finance.grossMargin(inventoryValue, revenue)
        : null;
    const cogsRatioVal =
      inventoryValue != null && revenue > 0
        ? E.finance.cogsRatio(inventoryValue, revenue)
        : null;
    const primeCost =
      inventoryValue != null && revenue > 0
        ? E.finance.primeCostRatio(inventoryValue, labor, revenue)
        : null;

    // Dead stock: on hand, but NOT MOVING. The previous definition was a
    // depth test (`qty > max(thresholdMin*3, 12)`) with no consumption join at
    // all, so a wine that sold every night but was stocked deep counted as
    // dead capital — while recommendations.service.ts rendered the total to
    // managers as "locked in slow inventory" and advised discounting the top
    // names to cost. Applied to a fast mover that advice destroys margin, so
    // the join is the fix rather than the label: the recommendation attached to
    // this number is only sound for genuinely idle stock.
    //
    // A bottle counts as moving if EITHER its inventory row or its master wine
    // saw consumption in the window — over-matching risks understating dead
    // capital, under-matching risks telling a manager to discount a best
    // seller, and only one of those two errors is expensive.
    const movedInventoryIds = new Set<string>();
    const movedMasterWineIds = new Set<string>();
    for (const c of consumption) {
      if ((c.qty ?? 0) <= 0) continue;
      if (c.inventoryId) movedInventoryIds.add(c.inventoryId);
      if (c.masterWineId) movedMasterWineIds.add(c.masterWineId);
    }
    // No movement recorded ANYWHERE is not evidence that nothing moved — it is
    // a restaurant with no POS/consumption feed, or a loader that failed. Zero
    // rows would otherwise mark the entire cellar dead and put the whole
    // inventory value in front of a manager as idle capital. Null says "we
    // have no idea", which is the truth (ADR 0020).
    const hasMovementSignal =
      movedInventoryIds.size > 0 || movedMasterWineIds.size > 0;
    const deadStock = !hasMovementSignal
      ? []
      : inventory
          .filter(
            (i) =>
              i.qty > 0 &&
              !movedInventoryIds.has(i.id) &&
              !(i.masterWineId && movedMasterWineIds.has(i.masterWineId)),
          )
          .map((i) => ({
            name: i.name,
            value: i.inventoryValue,
            qty: i.qty,
            costBasis: i.costBasis,
          }))
          // Nulls sort last rather than poisoning the comparator with NaN;
          // among themselves the unpriced rows rank by how many bottles are
          // idle, which is the only thing about them we do know.
          .sort((a, b) =>
            a.value == null || b.value == null
              ? (a.value == null ? 1 : 0) - (b.value == null ? 1 : 0) ||
                b.qty - a.qty
              : b.value - a.value,
          );
    // Same argument as inventoryValue: capital we cannot price is not $0 of
    // capital. recommendations.service.ts guards this rule with
    // `(deadStockCapital ?? 0) > 0`, so a null correctly withholds the
    // "discount these to cost" advice rather than attaching it to a guess.
    const deadStockPriced = deadStock.every((d) => d.value != null);
    const deadStockCapital =
      hasMovementSignal && deadStockPriced
        ? E.stats.sum(deadStock.map((d) => d.value as number))
        : null;

    return {
      basis: {
        cogs: "delivered procurement_orders (trailing 365d)",
        revenue: "unit_price × on-hand qty (POS-revenue proxy)",
        // This string used to read "on-hand qty × WAC (lot rollup)"
        // unconditionally while ~70 of 72 rows were valued off a fabricated
        // 0.6 × menu price. A basis now describes the rows it covered.
        inventoryValue: `on-hand qty × unit cost — ${costBasisSentence(costCoverage)}`,
        deadStock: `on-hand qty > 0 with zero wine_consumption_log movement in ${DEAD_STOCK_WINDOW_DAYS}d; null when the restaurant records no movement at all, or when any idle row has no recorded cost`,
        costDerived:
          "inventoryValue, grossMarginDollars, grossMargin, cogsRatio, primeCostRatio, inventoryTurnover, daysInventoryOutstanding, gmroi and deadStockCapital are null unless every on-hand row carries a recorded cost (ADR 0051)",
      },
      costCoverage,
      inventoryValue,
      cogs,
      revenue,
      grossMarginDollars: marginDollars,
      grossMargin,
      cogsRatio: cogsRatioVal,
      primeCostRatio: primeCost,
      inventoryTurnover: turnover,
      daysInventoryOutstanding: dio,
      gmroi,
      deadStockCapital,
      deadStockTop: deadStock.slice(0, 10),
      generatedAt: new Date().toISOString(),
    };
  }

  // =========================================================================
  // 2. Inventory science — per-SKU replenishment & classification
  // =========================================================================

  async getInventoryScience(
    restaurantId: string,
    opts: { serviceLevel?: number; leadTimeDays?: number } = {},
  ) {
    const serviceLevel = opts.serviceLevel ?? 0.95;
    const leadTime = opts.leadTimeDays ?? 7;
    const sinceDays = 90;

    const [inventory, consumption] = await Promise.all([
      this.loadInventory(restaurantId),
      this.loadConsumption(restaurantId, sinceDays),
    ]);

    // Demand series per master wine.
    const demandByWine = new Map<
      string,
      Array<{ date: string; value: number }>
    >();
    for (const c of consumption) {
      if (!c.masterWineId) continue;
      const arr = demandByWine.get(c.masterWineId) || [];
      arr.push({ date: c.date, value: c.qty });
      demandByWine.set(c.masterWineId, arr);
    }

    const skus = inventory.map((i) => {
      const rows = demandByWine.get(i.masterWineId || "") || [];
      const { values } = this.toDailySeries(rows, sinceDays);
      const profile = E.inventory.demandProfile(values) || {
        mean: 0,
        stdev: 0,
        cv: null,
      };
      const rop = E.inventory.reorderPoint({
        serviceLevel,
        avgDemandPerPeriod: profile.mean,
        demandStdev: profile.stdev,
        avgLeadTime: leadTime,
      });
      const stockoutProb = E.inventory.stockoutProbability({
        onHand: i.qty,
        avgDemandPerPeriod: profile.mean,
        demandStdev: profile.stdev,
        leadTime,
      });
      const doc = E.inventory.daysOfCover(i.qty, profile.mean);
      const annualDemand = profile.mean * 365;
      const orderingCost = 25; // fixed cost per PO (assumption; configurable)
      // EOQ's holding term is a fraction of unit cost. With no cost there is
      // no holding cost and therefore no order quantity to state.
      const holdingPerUnit =
        i.unitCost == null ? null : i.unitCost * this.HOLDING_RATE;
      const eoq =
        annualDemand > 0 && holdingPerUnit != null && holdingPerUnit > 0
          ? E.inventory.eoq(annualDemand, orderingCost, holdingPerUnit)
          : null;

      return {
        id: i.id,
        name: i.name,
        onHand: i.qty,
        avgDailyDemand: profile.mean,
        demandCv: profile.cv,
        xyzClass: E.inventory.xyzClassify(profile.cv),
        daysOfCover: doc,
        reorderPoint: rop?.reorderPoint ?? null,
        safetyStock: rop?.safetyStock ?? null,
        stockoutProbability: stockoutProb,
        eoq: eoq?.eoq ?? null,
        needsReorder: rop ? i.qty <= rop.reorderPoint : false,
        unitCost: i.unitCost,
        costBasis: i.costBasis,
        inventoryValue: i.inventoryValue,
        abcClass: null as "A" | "B" | "C" | null,
      };
    });

    // ABC by inventory value. Every class is a cut on cumulative SHARE OF THE
    // TOTAL, so one unpriced row moves every other row's class: the total is
    // unknown, and a Pareto over an unknown total is not a Pareto. Rather than
    // classify the priced subset and present it as the cellar's ABC, the whole
    // column goes null and the basis says why (ADR 0051).
    const costCoverage = summarizeCostBasis(inventory.filter((i) => i.qty > 0));
    if (costCoverage.complete) {
      // Rows holding no bottles are worth 0 whatever they cost — a knowable
      // zero, not a guess — so they take part in the ranking without needing
      // a price.
      const abc = E.inventory.abcClassify(
        inventory.map((i) => ({ item: i.id, value: i.inventoryValue ?? 0 })),
      );
      const abcByItem = new Map(abc.map((a) => [a.item, a.class]));
      for (const s of skus) s.abcClass = abcByItem.get(s.id) || "C";
    }

    const reorderList = skus
      .filter((s) => s.needsReorder)
      .sort(
        (a, b) => (b.stockoutProbability ?? 0) - (a.stockoutProbability ?? 0),
      );

    return {
      params: {
        serviceLevel,
        leadTimeDays: leadTime,
        demandWindowDays: sinceDays,
      },
      // This endpoint carried no `basis` at all, which made its cost-derived
      // columns unreadable: nothing said where `inventoryValue` came from.
      basis: {
        demand: `wine_consumption_log units/day over ${sinceDays}d`,
        reorderScience: `King safety stock at serviceLevel ${serviceLevel}, lead time ${leadTime}d — demand-derived, unaffected by cost`,
        inventoryValue: `on-hand qty × unit cost — ${costBasisSentence(costCoverage)}`,
        costDerived:
          "skus[].inventoryValue, skus[].unitCost and skus[].eoq are null for any row with no recorded cost; skus[].abcClass is null for EVERY row unless the whole cellar is priced, because ABC cuts on share of a total (ADR 0051)",
      },
      costCoverage,
      skuCount: skus.length,
      reorderCount: reorderList.length,
      reorderList: reorderList.slice(0, 25),
      skus: skus
        // Unpriced rows sort last instead of turning the comparator into NaN.
        .sort((a, b) =>
          a.inventoryValue == null || b.inventoryValue == null
            ? (a.inventoryValue == null ? 1 : 0) -
                (b.inventoryValue == null ? 1 : 0) || b.onHand - a.onHand
            : b.inventoryValue - a.inventoryValue,
        )
        .slice(0, 200),
      generatedAt: new Date().toISOString(),
    };
  }

  // =========================================================================
  // 3. Risk profile — the trader/PE lens
  // =========================================================================

  async getRiskProfile(restaurantId: string) {
    const [inventory, orders, consumption] = await Promise.all([
      this.loadInventory(restaurantId),
      this.loadDeliveredOrders(restaurantId, 365),
      this.loadConsumption(restaurantId, 90),
    ]);

    // Vendor concentration (HHI on spend share).
    const spendByVendor = new Map<string, number>();
    for (const o of orders)
      spendByVendor.set(
        o.providerId,
        (spendByVendor.get(o.providerId) || 0) + o.cost,
      );
    const vendorWeights = Array.from(spendByVendor.values());
    const hhi = E.finance.herfindahlIndex(vendorWeights);
    const effectiveVendors = E.finance.effectiveCount(vendorWeights);
    const cr4 = E.finance.concentrationRatio(vendorWeights, 4);

    // Revenue concentration across SKUs (Gini) — sell-price valuation proxy.
    const skuRevenue = inventory.map((i) => i.unitPrice * i.qty);
    const gini = E.risk.giniCoefficient(skuRevenue);
    const skuHhi = E.finance.herfindahlIndex(skuRevenue);

    // Daily revenue series → returns → VaR / Sharpe / drawdown.
    const revRows = consumption.map((c) => ({
      date: c.date,
      value: c.qty, // bottles/day as the "return-generating" flow
    }));
    const { values: dailyDemand } = this.toDailySeries(revRows, 90);
    const returns: number[] = [];
    for (let i = 1; i < dailyDemand.length; i++) {
      if (dailyDemand[i - 1] > 0)
        returns.push(
          (dailyDemand[i] - dailyDemand[i - 1]) / dailyDemand[i - 1],
        );
    }
    const levels: number[] = [];
    let cum = 0;
    for (const v of dailyDemand) {
      cum += v;
      levels.push(cum);
    }

    return {
      vendorConcentration: {
        hhi,
        hhiPoints: hhi === null ? null : Math.round(hhi * 10000),
        effectiveVendors,
        cr4,
        vendorCount: vendorWeights.length,
        interpretation:
          hhi === null
            ? "insufficient data"
            : hhi > 0.25
              ? "highly concentrated — single-vendor risk"
              : hhi > 0.15
                ? "moderately concentrated"
                : "competitive / diversified",
      },
      revenueConcentration: {
        gini,
        hhi: skuHhi,
        interpretation:
          gini === null
            ? "insufficient data"
            : gini > 0.6
              ? "revenue rides on very few SKUs"
              : gini > 0.4
                ? "moderate concentration"
                : "well-distributed",
      },
      demandRisk: {
        historicalVar95: E.risk.historicalVar(returns, 0.95),
        parametricVar95: E.risk.parametricVar(returns, 0.95),
        conditionalVar95: E.risk.conditionalVar(returns, 0.95),
        volatility: E.risk.volatility(returns),
        sharpe: E.risk.sharpeRatio(returns),
        sortino: E.risk.sortinoRatio(returns),
        maxDrawdown: E.risk.maxDrawdown(levels)?.maxDrawdown ?? null,
        sampleDays: dailyDemand.length,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // =========================================================================
  // 4. Forecast — demand projection (aggregate or per SKU)
  // =========================================================================

  async getDemandForecast(
    restaurantId: string,
    opts: { masterWineId?: string; horizon?: number } = {},
  ) {
    const horizon = opts.horizon ?? 14;
    const sinceDays = 120;
    const consumption = await this.loadConsumption(restaurantId, sinceDays);
    const rows = consumption
      .filter((c) => !opts.masterWineId || c.masterWineId === opts.masterWineId)
      .map((c) => ({ date: c.date, value: c.qty }));
    const { dates, values } = this.toDailySeries(rows, sinceDays);

    // Try weekly-seasonal Holt-Winters; fall back to Holt then SES.
    const period = 7;
    let model = "holt_winters";
    let result = E.forecast.holtWintersAdditive(
      values,
      period,
      { alpha: 0.3, beta: 0.05, gamma: 0.3 },
      horizon,
    );
    if (!result) {
      model = "holt_linear";
      const holt = E.forecast.holtLinear(values, 0.4, 0.1, horizon);
      result = holt ? { ...holt, seasonals: [] as number[] } : null;
    }
    if (!result) {
      model = "ses";
      const ses = E.forecast.simpleExponentialSmoothing(values, 0.4, horizon);
      result = ses
        ? {
            fitted: ses.fitted,
            forecast: ses.forecast,
            level: 0,
            trend: 0,
            seasonals: [],
          }
        : null;
    }

    // Backtest accuracy on the fitted series.
    const accuracy = result
      ? {
          mae: E.forecast.mae(values, result.fitted),
          rmse: E.forecast.rmse(values, result.fitted),
          mape: E.forecast.mape(values, result.fitted),
          maseVsSeasonalNaive: E.forecast.mase(
            values,
            result.fitted,
            values,
            period,
          ),
        }
      : null;

    const futureDates: string[] = [];
    const today = new Date();
    for (let h = 1; h <= horizon; h++)
      futureDates.push(
        new Date(today.getTime() + h * 86400000).toISOString().substring(0, 10),
      );

    return {
      model,
      masterWineId: opts.masterWineId ?? "all",
      horizon,
      history: { dates, values },
      forecast:
        result?.forecast.map((v, i) => ({
          date: futureDates[i],
          value: Math.max(0, v),
        })) ?? [],
      totalForecastDemand: result
        ? E.stats.sum(result.forecast.map((v) => Math.max(0, v)))
        : 0,
      accuracy,
      generatedAt: new Date().toISOString(),
    };
  }
}
