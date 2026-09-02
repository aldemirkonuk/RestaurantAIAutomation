import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import * as E from "./engine";
import { METRIC_REGISTRY, MetricDefinition, Persona } from "./metric-registry";
import {
  costBasisSentence,
  resolveUnitCost,
  summarizeCostBasis,
} from "./inventory-cost";
import {
  ORDER_ARRIVED_STATUSES,
  ORDER_SPEND_STATUSES,
  hasStatus,
} from "../procurement/order-status";

/**
 * Fraction of a unit's value consumed per year by holding it: capital cost +
 * storage + insurance + spoilage.
 *
 * Exported because two services now need the SAME number. It is an input to
 * the newsvendor overage cost Co, so two copies drifting apart would make two
 * endpoints recommend different order quantities for one bottle and give no
 * clue why.
 */
export const ANNUAL_HOLDING_RATE = 0.26;

/**
 * Fixed cost of raising one purchase order. An assumption, and since the
 * service level became cost-derived, a load-bearing one: it sets the EOQ, the
 * EOQ sets the replenishment cycle, and the cycle sets Co in the critical
 * ratio Cu/(Cu+Co). Surfaced in `/inventory-science`'s `params` so a reader
 * can see the input rather than having to find this line. Whether it should be
 * per-restaurant is a genuine open question, not a drive-by — see ADR 0069,
 * "An open fork this ADR deliberately did not file".
 */
export const ORDERING_COST_PER_PO = 25;

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
  private readonly HOLDING_RATE = ANNUAL_HOLDING_RATE;
  private readonly ORDERING_COST = ORDERING_COST_PER_PO;

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
        .select("inventory_id, live_qty, wac, has_invoice_cost")
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

  /**
   * Observed order→delivery durations, in days, for the King safety-stock
   * formula's σ_LT term.
   *
   * `loadDeliveredOrders` above already reads this table but discards both
   * timestamps in its projection, so the durations were not recoverable from
   * it. This loader exists rather than widening that one because its callers
   * (COGS, spend) must not start paying for columns they do not read.
   *
   * Returns per-order rows, not a summary: `inventory_id` is carried so a
   * future per-SKU lead time can be derived without another query, even though
   * only the pooled restaurant-level profile is consumed today (see
   * `getInventoryScience`).
   */
  private async loadLeadTimeObservations(
    restaurantId: string,
    sinceDays = 365,
  ) {
    const client = this.dbService.getClient();
    const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
    const { data, error } = await client
      .from("procurement_orders")
      .select("inventory_id, created_at, delivered_at, status")
      .eq("restaurant_id", restaurantId)
      .gte("created_at", since);
    if (error)
      this.logger.error(
        `analytics query on procurement_orders (lead time) failed — safety ` +
          `stock will report its lead-time variance as UNMEASURED rather ` +
          `than as zero: ${error.code ?? "?"} ${error.message ?? error}`,
      );
    return (data || [])
      .filter((o: any) => hasStatus(o.status, ORDER_ARRIVED_STATUSES))
      .map((o: any) => ({
        inventoryId: o.inventory_id ?? null,
        // Same window and same sanity bounds as getVendorScorecard, so the
        // two surfaces cannot quote different lead times for one restaurant.
        days:
          o.delivered_at && o.created_at
            ? (new Date(o.delivered_at).getTime() -
                new Date(o.created_at).getTime()) /
              86400000
            : null,
      }))
      .filter(
        (o): o is { inventoryId: string | null; days: number } =>
          o.days !== null && o.days >= 0 && o.days < 120,
      );
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

  /**
   * Per-SKU replenishment science.
   *
   * TWO ASSERTED CONSTANTS WERE REMOVED HERE, AND THEY WERE NOT THE SAME KIND
   * OF THING.
   *
   * `serviceLevel = 0.95` looked like a policy default and was not one. A
   * cycle service level of 0.95 is the newsvendor critical ratio Cu/(Cu+Co) =
   * 0.95, i.e. the assertion that being one unit short costs exactly 19× what
   * holding one spare unit costs — for every SKU on the list at once, from a
   * $12 house pour to a $400 collectible. Nobody chose that ratio; it was a
   * literal. It is now derived per SKU from the menu price, the recorded cost
   * and the holding rate (`E.inventory.serviceLevelFromCosts`), and where an
   * input is missing the row reports `serviceLevel: null` with the reason
   * rather than borrowing a number (ADR 0051).
   *
   * `leadTimeDays = 7` was a placeholder for a quantity the repo measures.
   * Delivered `procurement_orders` carry `created_at` and `delivered_at`, and
   * `getVendorScorecard` has been computing the mean AND the standard
   * deviation of that duration all along — its payload note even says the
   * stdev "feeds the King safety-stock formula". It never reached it. Both
   * moments now come from `loadLeadTimeObservations`.
   *
   * WHAT THIS COSTS. Rows that cannot produce a critical ratio lose
   * `reorderPoint` and `safetyStock` — they used to carry numbers computed at
   * the asserted 0.95, which is worse than carrying none. They keep everything
   * that does not depend on a service level (days of cover, stockout
   * probability, XYZ class), and `needsReorder` falls back to the operator's
   * own `threshold_min`, which is recorded data rather than a substitute
   * guess.
   */
  async getInventoryScience(
    restaurantId: string,
    opts: { serviceLevel?: number; leadTimeDays?: number } = {},
  ) {
    const sinceDays = 90;

    const [inventory, consumption, leadTimeObs] = await Promise.all([
      this.loadInventory(restaurantId),
      this.loadConsumption(restaurantId, sinceDays),
      this.loadLeadTimeObservations(restaurantId),
    ]);

    // ---- Lead time: measured from deliveries, or stated, or unknown. -------
    const measuredLeadTime = E.inventory.leadTimeProfile(
      leadTimeObs.map((o) => o.days),
    );
    const statedLeadTime =
      opts.leadTimeDays != null &&
      Number.isFinite(opts.leadTimeDays) &&
      opts.leadTimeDays > 0
        ? opts.leadTimeDays
        : null;
    const leadTime = statedLeadTime ?? measuredLeadTime?.meanDays ?? null;
    // THE WIRING. `leadTimeStdev` is the σ_LT that advanced-analytics has been
    // computing and discarding. It stays measured even when the caller
    // overrides the mean: dispersion is a property of the delivery process,
    // not of whatever mean the caller wants to model.
    const leadTimeStdev = measuredLeadTime?.stdevDays ?? null;

    // A caller may still state a service level (the endpoint exposes it as a
    // query param) — an operator overriding the maths is a decision, not a
    // fabrication. What is gone is the code doing it silently on their behalf.
    const statedServiceLevel =
      opts.serviceLevel != null &&
      Number.isFinite(opts.serviceLevel) &&
      opts.serviceLevel > 0 &&
      opts.serviceLevel < 1
        ? opts.serviceLevel
        : null;

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
      const doc = E.inventory.daysOfCover(i.qty, profile.mean);
      const annualDemand = profile.mean * 365;
      // EOQ's holding term is a fraction of unit cost. With no cost there is
      // no holding cost and therefore no order quantity to state.
      const holdingPerUnit =
        i.unitCost == null ? null : i.unitCost * this.HOLDING_RATE;
      const eoq =
        annualDemand > 0 && holdingPerUnit != null && holdingPerUnit > 0
          ? E.inventory.eoq(annualDemand, this.ORDERING_COST, holdingPerUnit)
          : null;
      // EOQ's cycleTime is in the demand series' period, and annualDemand is
      // annual — so it is in years. The overage cost is what one spare unit
      // costs to hold for exactly one of these cycles.
      const cycleDays = eoq ? eoq.cycleTime * 365 : null;

      // The critical ratio, per SKU, from this SKU's own economics.
      const derivedSl = E.inventory.serviceLevelFromCosts({
        // `menu_price_current` is coerced with `|| 0` in loadInventory, so a 0
        // is an absent price, not a free bottle.
        unitPrice: i.unitPrice > 0 ? i.unitPrice : null,
        unitCost: i.unitCost,
        annualHoldingRate: this.HOLDING_RATE,
        cycleDays,
      });
      const serviceLevel =
        statedServiceLevel ?? (derivedSl.ok ? derivedSl.serviceLevel : null);
      const serviceLevelBasis: string =
        statedServiceLevel != null
          ? "caller_specified"
          : derivedSl.ok
            ? "critical_ratio Cu/(Cu+Co)"
            : `unavailable — ${derivedSl.reason}`;

      const rop =
        serviceLevel != null && leadTime != null
          ? E.inventory.reorderPoint({
              serviceLevel,
              avgDemandPerPeriod: profile.mean,
              demandStdev: profile.stdev,
              avgLeadTime: leadTime,
              // The orphaned measurement, finally connected.
              leadTimeStdev,
            })
          : null;
      const stockoutProb =
        leadTime == null
          ? null
          : E.inventory.stockoutProbability({
              onHand: i.qty,
              avgDemandPerPeriod: profile.mean,
              demandStdev: profile.stdev,
              leadTime,
            });

      // You cannot order 1.4 cases. Nothing reachable from this row records a
      // pack size, so this is a refusal today rather than a rounding — see
      // `basis.orderQuantity`.
      const packed = E.inventory.roundUpToPack(eoq?.eoq ?? 0, null);
      // Nothing in the schema records shelf life either.
      const shelfLife = E.inventory.shelfLifeCap({
        proposedUnits: eoq?.eoq ?? 0,
        avgDailyDemand: profile.mean,
        shelfLifeDays: null,
      });

      // A trigger, or an honest absence — never `false` standing in for
      // "we could not tell", which is what the old `rop ? … : false` did.
      //
      // THIS DELIBERATELY HAS NO `threshold_min` FALLBACK. An earlier version
      // of this branch fell back to `qty <= thresholdMin` and labelled it
      // `operator_threshold_min`. That label was false, and the argument
      // against it is the same one this file already makes about pack size:
      // `threshold_min` is `integer DEFAULT 3 NOT NULL` and every write site
      // is a literal (`5` = the import default, `baseline_from_production
      // .sql:1614`; `6` = `inventory.service.ts:815,1088,1327`; `3` =
      // `menus.service.ts:18`). Production, all 5 tenants, measured
      // 2026-09-02: `count(distinct threshold_min) = 1` for EVERY tenant —
      // 50 rows at 5, 18 at 10, 2 at 6, 1 at 6, 1 at 10. No operator sets an
      // identical trigger for a house pour and a collectible; uniformity
      // within a tenant is the signature of a default that was never touched.
      // With `stock_live = 0` on 63 of 64 active rows, `qty <= thresholdMin`
      // was true for 100% of rows in 100% of tenants, so the fallback made
      // `reorderList` the entire cellar, every row stamped with a provenance
      // claim that was not true. An unattested default is not an operator
      // decision, and refusing pack_size while accepting this one would have
      // been the same defect twice with opposite verdicts.
      //
      // The column is still reported below as a raw recorded value, labelled
      // for what it is, so a UI can show it without this service treating it
      // as evidence of intent.
      const needsReorder = rop ? i.qty <= rop.reorderPoint : null;

      return {
        id: i.id,
        name: i.name,
        onHand: i.qty,
        avgDailyDemand: profile.mean,
        demandCv: profile.cv,
        xyzClass: E.inventory.xyzClassify(profile.cv),
        daysOfCover: doc,
        serviceLevel,
        serviceLevelBasis,
        underageCost: derivedSl.ok ? derivedSl.underageCost : null,
        overageCost: derivedSl.ok ? derivedSl.overageCost : null,
        reorderPoint: rop?.reorderPoint ?? null,
        safetyStock: rop?.safetyStock ?? null,
        leadTimeVarianceIncluded: rop?.leadTimeVarianceIncluded ?? null,
        // Below 0.5 the critical ratio says HOLD LESS than lead-time demand,
        // which makes safety stock negative and can make the reorder point
        // negative too. That is a real answer, but `qty <= negativeRop` is
        // false for every quantity, so without this the SKU would vanish from
        // the reorder list with nothing on the row explaining why.
        understockOptimal: rop?.understockOptimal ?? null,
        serviceLevelZ: rop?.z ?? null,
        stockoutProbability: stockoutProb,
        eoq: eoq?.eoq ?? null,
        orderQuantity: packed.ok ? packed.units : null,
        orderQuantityBlockedBy: packed.ok ? null : packed.reason,
        shelfLifeCappedQuantity: shelfLife.ok ? shelfLife.cappedUnits : null,
        shelfLifeBlockedBy: shelfLife.ok ? null : shelfLife.reason,
        needsReorder,
        reorderTriggerBasis: !rop
          ? "unavailable"
          : rop.understockOptimal
            ? "king_reorder_point_understock_optimal"
            : "king_reorder_point",
        // Recorded, and labelled as the system default it is in every
        // production tenant. Reported so a reader can see it; never used as a
        // trigger. See the note above `needsReorder`.
        thresholdMin: i.thresholdMin,
        unitCost: i.unitCost,
        unitPrice: i.unitPrice > 0 ? i.unitPrice : null,
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
      // `needsReorder` is now tri-state; only a measured `true` is a reorder.
      .filter((s) => s.needsReorder === true)
      .sort(
        (a, b) => (b.stockoutProbability ?? 0) - (a.stockoutProbability ?? 0),
      );

    const derivedSlCount = skus.filter(
      (s) => s.serviceLevelBasis === "critical_ratio Cu/(Cu+Co)",
    ).length;

    // Three INDEPENDENT inputs gate the reorder science, and in production
    // today all three are absent at once (measured 2026-09-02 against
    // Restaurant_Wine_Ops): `last_purchase_price` and `menu_price_current` are
    // NULL on 72 of 72 rows and both `inventory_lot_rollup` rows have
    // `has_invoice_cost = false`, so NO row can produce a critical ratio;
    // `procurement_orders` holds 2 rows, 0 with `delivered_at`, so lead time
    // is unknown; `wine_consumption_log` is empty, so demand is 0.
    //
    // A caller that saw only `reorderCount: 0` would read that as "nothing
    // needs reordering", which is the absence-as-health fault this endpoint
    // was rebuilt to stop committing. So the endpoint states which inputs it
    // is missing, by name, instead of leaving it to be inferred from nulls.
    const withDemand = skus.filter((s) => s.avgDailyDemand > 0).length;
    const scienceAvailability = {
      computable: skus.filter((s) => s.reorderPoint !== null).length,
      total: skus.length,
      missingInputs: [
        ...(derivedSlCount === 0 && statedServiceLevel == null
          ? ["cost_and_price"]
          : []),
        ...(leadTime == null ? ["delivered_orders"] : []),
        ...(withDemand === 0 ? ["consumption"] : []),
      ],
      rowsWithDemand: withDemand,
      note:
        "Each entry in missingInputs independently nulls the reorder science " +
        "for every row. reorderCount: 0 with a non-empty missingInputs means " +
        "NOT MEASURED, never 'nothing needs reordering'.",
    };

    // Percent for the basis sentence, as its own statement: the guard in
    // scripts/check_analytics_cost_honesty.py reads a whole statement with
    // string literals stripped, so an inline `* 100` next to cost fields
    // looks exactly like a magic-number cost fallback.
    const sigmaLtNoisePct = (
      (measuredLeadTime?.stdevRelativeStandardError ?? 0) * 100
    ).toFixed(0);

    return {
      scienceAvailability,
      params: {
        // No single service level any more — it is per SKU. `null` here when
        // the caller did not state one is the honest shape: the old scalar
        // 0.95 in this position was the whole defect, printed.
        serviceLevel: statedServiceLevel,
        serviceLevelSource:
          statedServiceLevel != null
            ? "caller_specified"
            : "per-SKU critical ratio; see skus[].serviceLevel",
        leadTimeDays: leadTime,
        leadTimeStdevDays: leadTimeStdev,
        leadTimeObservations: measuredLeadTime?.n ?? 0,
        // How much of leadTimeStdevDays is sampling noise: 1/√(2(n−1)).
        // ±71% at n = 2, and the King formula squares σ_LT. Reported rather
        // than gated on, because any minimum-n above 2 is a policy number.
        leadTimeStdevRelativeStandardError:
          measuredLeadTime?.stdevRelativeStandardError ?? null,
        demandWindowDays: sinceDays,
        annualHoldingRate: this.HOLDING_RATE,
        orderingCostPerPo: this.ORDERING_COST,
      },
      // This endpoint carried no `basis` at all, which made its cost-derived
      // columns unreadable: nothing said where `inventoryValue` came from.
      basis: {
        demand: `wine_consumption_log units/day over ${sinceDays}d`,
        serviceLevel:
          statedServiceLevel != null
            ? `caller-specified ${statedServiceLevel} applied to every row`
            : `newsvendor critical ratio Cu/(Cu+Co) per SKU, where Cu = menu_price_current − recorded cost and Co = cost × ${this.HOLDING_RATE}/yr over the EOQ cycle — derivable for ${derivedSlCount} of ${skus.length} row(s); the rest carry serviceLevel: null and a reason (ADR 0051). NOT a 0.95 default: that literal asserted Cu/Co = 19 for every SKU.`,
        leadTime:
          leadTime == null
            ? "no delivered procurement_orders with both created_at and delivered_at in the trailing 365d — mean lead time is unknown, so reorderPoint and stockoutProbability are null for every row"
            : `${statedLeadTime != null ? "caller-specified" : "measured"} mean ${leadTime.toFixed(2)}d from ${measuredLeadTime?.n ?? 0} delivered order(s)`,
        leadTimeVariance:
          leadTimeStdev == null
            ? "UNMEASURED — fewer than two delivered orders, so σ_LT is undefined. Safety stock omits the d̄²·σ_LT² term and is therefore a LOWER BOUND, flagged per row as leadTimeVarianceIncluded: false."
            : `σ_LT = ${leadTimeStdev.toFixed(2)}d over ${measuredLeadTime?.n ?? 0} delivered order(s), included in the King formula's d̄²·σ_LT² term. Sampling noise in that σ_LT is ±${sigmaLtNoisePct}% (relative standard error 1/√(2(n−1))), and the formula SQUARES it — at n = 2 that is ±71%. There is no minimum-n gate above 2, deliberately: 2 is the definition of a sample stdev, anything higher is a policy number nobody has chosen.`,
        reorderScience:
          "King safety stock SS = z·sqrt(LT·σ_d² + d̄²·σ_LT²); z from the per-SKU critical ratio, so unlike before this IS cost-dependent. z is NEGATIVE when the critical ratio is below 0.5 (Cu < Co, i.e. holding a spare costs more than missing a sale) — safety stock and possibly the reorder point go negative, which is the model saying plan to stock out. Those rows carry understockOptimal: true and reorderTriggerBasis: king_reorder_point_understock_optimal rather than silently dropping off reorderList.",
        reorderTrigger:
          "needsReorder comes ONLY from the King reorder point. It does NOT fall back to restaurant_inventory.threshold_min: that column is `integer DEFAULT 3 NOT NULL`, every write site in the repo is a literal, and production has count(distinct threshold_min) = 1 in all 5 tenants (measured 2026-09-02) — an untouched default, not an operator decision. skus[].thresholdMin is reported as a recorded value for display, never used as a trigger.",
        orderQuantity:
          "skus[].orderQuantity is null on every row: case-pack rounding needs a pack size, and nothing reachable from restaurant_inventory records one. All three tables that store one — vendor_price_observations, vendor_portal_listings, procurement_document_lines — declare it `integer DEFAULT 1 NOT NULL`, so an unrecorded pack is stored as a single and cannot be told from a real one; reading it would report an absence as a measurement. skus[].eoq is the unrounded quantity.",
        shelfLife:
          "skus[].shelfLifeCappedQuantity is null on every row: no shelf-life, expiry or best-before column exists in the schema. The seam is wired to E.inventory.shelfLifeCap and needs only a column.",
        inventoryValue: `on-hand qty × unit cost — ${costBasisSentence(costCoverage)}`,
        costDerived:
          "skus[].inventoryValue, skus[].unitCost, skus[].eoq, skus[].serviceLevel, skus[].reorderPoint and skus[].safetyStock are null for any row with no recorded cost; skus[].abcClass is null for EVERY row unless the whole cellar is priced, because ABC cuts on share of a total (ADR 0051)",
      },
      serviceLevelCoverage: {
        total: skus.length,
        derived: derivedSlCount,
        stated: statedServiceLevel != null ? skus.length : 0,
        unavailable:
          statedServiceLevel != null ? 0 : skus.length - derivedSlCount,
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
