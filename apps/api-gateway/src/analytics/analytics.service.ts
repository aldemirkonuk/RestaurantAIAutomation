import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  DayExclusions,
  DayExclusionsService,
} from "./insights/day-exclusions.service";
import { readForKeys, readWholeWindow } from "../common/read-whole-window";
import * as E from "./engine";
import { METRIC_REGISTRY, MetricDefinition, Persona } from "./metric-registry";
import {
  costBasisSentence,
  resolveUnitCost,
  summarizeCostBasis,
} from "./inventory-cost";
import {
  bottlesOf,
  servingsOf,
  summarizeUnits,
  unitsBasisSentence,
  volumeMlOf,
} from "./consumption-units";
import {
  ORDER_NOT_YET_ARRIVED_STATUSES,
  ORDER_SPEND_STATUSES,
} from "../procurement/order-status";
import { orderSpend } from "../procurement/order-spend";
import {
  costTaxProof,
  readAdviceTaxTerms,
  wineTaxRate,
  type CostTaxProof,
  type InventoryPriceRow,
} from "../pricing/margin-advice.service";
import {
  houseDayBounds,
  houseDayOf,
  houseToday,
  readHouseZone,
  shiftHouseDay,
} from "../common/house-day";

/**
 * F-1492: a consumption line the till wrote for one linked line of a
 * cocktail's recipe (F-1329, pos-hub.service.ts planRecipeLine). It carries no
 * price — the till's price is the cocktail's — and is keyed by the cocktail
 * line's own key with the recipe line's place after it (`…:lineNo:j`), named
 * `<cocktail>: <recipe line>`. A plain sale's key ends at `:lineNo`.
 */
export function isRecipePour(c: {
  source?: unknown;
  notes?: unknown;
  wine_name?: unknown;
  total_revenue?: unknown;
}): boolean {
  return (
    c.total_revenue == null &&
    c.source === "pos" &&
    typeof c.notes === "string" &&
    /:\d+:\d+$/.test(c.notes) &&
    typeof c.wine_name === "string" &&
    c.wine_name.includes(": ")
  );
}

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
 *   • Purchases / COGS   ← procurement_orders (delivered) total_cost; an
 *                          order with none is unpriced and counted (F-701)
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

  /** F-1575: the days an owner or manager ruled out of the baselines (ADR 0317). */
  private readonly dayExclusions: DayExclusionsService;

  constructor(
    private readonly dbService: DatabaseService,
    dayExclusions?: DayExclusionsService,
  ) {
    this.dayExclusions = dayExclusions ?? new DayExclusionsService(dbService);
  }

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

  /**
   * Say so when a read fails. Mirrors
   * advanced-analytics.service.ts:150 `logQueryFailure` — same wording on
   * purpose, so both halves of this directory are greppable as one thing.
   *
   * An empty result is NOT an error and is never logged as one; only a real
   * failure is.
   */
  private logQueryFailure(table: string, error: any) {
    this.logger.error(
      `analytics query on ${table} failed — this lens will report empty ` +
        `rather than wrong: ${error?.code ?? "?"} ${error?.message ?? error}`,
    );
  }

  /** The allSettled variant: a rejection is a failure too. */
  private reportSlice(table: string, r: PromiseSettledResult<any>) {
    if (r.status === "rejected")
      this.logger.error(`analytics query on ${table} rejected: ${r.reason}`);
    else if (r.value?.error) this.logQueryFailure(table, r.value.error);
  }

  private async loadInventory(restaurantId: string) {
    const client = this.dbService.getClient();
    // F-1214: the cellar and its lot totals are read WHOLE or refused. Unranged
    // they stopped at PostgREST's 1,000 rows (supabase/config.toml:18), so a
    // house with more wines (retired vintages included, F-442) was valued on
    // whichever thousand came back; and a failed read became `[]`, "no wine
    // carries a cost", on /reports and in a `ready` export. A refusal now
    // propagates, as `loadDeliveredOrders` does (ADR 0292).
    const [inventory, [houseRes, openRes]] = await Promise.all([
      readWholeWindow<any>("The cellar's wines", () =>
        client
          .from("restaurant_inventory")
          // Column names must match the live schema exactly. PostgREST rejects
          // the WHOLE query with 42703 on a single unknown column, and the
          // allSettled + `data || []` that was here turned that rejection into
          // an empty inventory rather than an error — so every metric downstream
          // (inventory value, COGS ratio, turnover, GMROI, reorder science)
          // silently reported 0/null for every restaurant. There is no
          // wine_type/unit_price/unit_cost/reorder_point on this table: the
          // menu price is `menu_price_current`, cost is `last_purchase_price`,
          // the reorder trigger is `threshold_min`, and the varietal/type
          // lives on master_wine_library.
          // F-442: no `is_active` filter here. An inactive wine still holding
          // bottles is stock in the cellar and counts in the valuation; rows
          // are tagged `isActive` and the reorder and risk lenses keep only
          // active ones (see `activeOnly`).
          .select(
            "id, wine_name, stock_live, menu_price_current, last_purchase_price, last_purchase_price_tax_basis, threshold_min, master_wine_id, is_active, created_at, master_wine_library(primary_type)",
            { count: "exact" },
          )
          .eq("restaurant_id", restaurantId),
      ),
      Promise.allSettled([
        // The house's stated currency: its menu prices are in it, and a cost in
        // other money is not set against them (F-343).
        client
          .from("restaurants")
          .select("currency")
          .eq("id", restaurantId)
          .maybeSingle(),
        // Bottles already ordered and not yet here (F-630): reorder science
        // counts them before it says "order today".
        client
          .from("procurement_orders")
          .select("inventory_id, bottles_total, expected_delivery_date")
          .eq("restaurant_id", restaurantId)
          .in("status", ORDER_NOT_YET_ARRIVED_STATUSES),
      ]),
    ]);

    // allSettled makes a REJECTION invisible and `{ data, error }` makes a
    // FAILED QUERY invisible; the house's money and the open orders below
    // each say what an unread answer means (ADR 0067).
    this.reportSlice("restaurants", houseRes);
    this.reportSlice("procurement_orders", openRes);
    // Unread or unstated, the house's money is null and a lot is read as before.
    const houseCurrency =
      houseRes.status === "fulfilled"
        ? (houseRes.value.data?.currency ?? null)
        : null;

    // The lot totals of exactly these wines: the view has no `id` to page on,
    // so it is read a slice of wines at a time, whole or refused.
    const rollupRows = await readForKeys<any>(
      "The lot totals",
      inventory.map((i: any) => i.id),
      (slice) =>
        client
          .from("inventory_lot_rollup")
          .select(
            // wac_qty / live_qty added 2026-09-02 (ADR 0079) so resolveUnitCost
            // can tell a WAC that covers every on-hand bottle from one that
            // covers a single invoiced bottle in twenty-one.
            // cost_currency / cost_currency_count (F-343): which money the WAC is in.
            // wac_pre_tax_qty / wac_tax_included_qty (F-1715): whether tax is inside it.
            "inventory_id, live_qty, wac, has_invoice_cost, wac_qty, cost_currency, cost_currency_count, wac_pre_tax_qty, wac_tax_included_qty",
            { count: "exact" },
          )
          .eq("restaurant_id", restaurantId)
          .in("inventory_id", slice),
    );
    const rollup = new Map<string, any>();
    for (const r of rollupRows) rollup.set(r.inventory_id, r);
    // Per wine: bottles on order, or null when they cannot be counted — the
    // read failed, or an open order states no bottle count. A failed read is
    // never "nothing on order" (ADR 0067).
    const openRead =
      openRes.status === "fulfilled" && !openRes.value.error
        ? openRes.value.data || []
        : null;
    const onOrder = new Map<
      string,
      { bottles: number | null; nextArrival: string | null }
    >();
    for (const o of openRead ?? []) {
      if (!o.inventory_id) continue;
      const was = onOrder.get(o.inventory_id) ?? {
        bottles: 0,
        nextArrival: null,
      };
      const bottles = Number(o.bottles_total);
      const due = o.expected_delivery_date
        ? String(o.expected_delivery_date).slice(0, 10)
        : null;
      onOrder.set(o.inventory_id, {
        bottles:
          was.bottles === null || !(bottles > 0) ? null : was.bottles + bottles,
        nextArrival:
          due && (!was.nextArrival || due < was.nextArrival)
            ? due
            : was.nextArrival,
      });
    }

    // Unit cost: invoiced lot WAC → recorded last purchase price → UNKNOWN.
    // The third branch used to be `unitPrice * 0.6`, a magic number with no
    // ADR behind it, and it was the live path for ~70 of 72 production rows.
    // See ./inventory-cost.ts for why cost is now `number | null`.
    const rows = inventory.map((i: any) => {
      const lot = rollup.get(i.id);
      const unitPrice = Number(i.menu_price_current) || 0;
      // A wine with no bottle price on the list (a glass-only pour, a bottle
      // not yet priced) has no sell-price value we can state. `unitPrice`
      // stays 0 for the readers below that rank by it; the sell-price
      // valuation leaves these rows out and says how many (F-574).
      const hasPrice = unitPrice > 0;
      const { unitCost, costBasis } = resolveUnitCost(i, lot, houseCurrency);
      const qty = lot?.live_qty ?? i.stock_live ?? 0;
      // F-1652: a WAC that averages 12 bottles of 36 prices those 12 only.
      // The other 24 carry no cost, so the row has no whole value; its costed
      // bottles' value is kept apart, for the priced wines' total.
      const partial =
        unitCost != null && costBasis === "invoice_lot_wac_partial";
      const costedQty = partial
        ? Math.max(0, Math.min(qty, Number(lot?.wac_qty) || 0))
        : qty;
      return {
        id: i.id,
        // Absent reads as active: only an explicit false took a wine off.
        isActive: i.is_active !== false,
        name: i.wine_name || i.master_wine_id || i.id,
        type: i.master_wine_library?.primary_type || "unknown",
        qty,
        unitCost,
        costBasis,
        // F-1715: whether that cost is proven without tax, by the advice's rule.
        costTax: costTaxProof(
          costBasis,
          i as InventoryPriceRow,
          lot ?? null,
          null,
        ) as CostTaxProof,
        unitPrice,
        hasPrice,
        thresholdMin: i.threshold_min || 0,
        // This schema carries a single reorder trigger (threshold_min); there
        // is no separate reorder_point column.
        reorderPoint: i.threshold_min || 0,
        masterWineId: i.master_wine_id,
        onOrder:
          openRead === null
            ? null
            : onOrder.has(i.id)
              ? onOrder.get(i.id)!.bottles
              : 0,
        nextArrival: onOrder.get(i.id)?.nextArrival ?? null,
        // When the wine was put on the list (F-687): demand is averaged over
        // the days since, not over days it could not have sold.
        listedAt: i.created_at ?? null,
        // A row we cannot cost has no value we can state. `qty × null` must
        // not become 0 — that is the fabrication ADR 0051 names, wearing an
        // arithmetic costume.
        inventoryValue: unitCost == null || partial ? null : qty * unitCost,
        /** The costed bottles' value: the whole row's, or a partial row's part. */
        pricedValue: unitCost == null ? null : costedQty * unitCost,
        /** A partial row's bottles with no cost of their own (F-1652). */
        uncostedBottles: partial ? qty - costedQty : 0,
        // F-1654: no cost under the invoice rule (OD-100), yet its lots carry
        // one -- typed in by the house, or an order's price. Said, not hidden.
        notInvoiced:
          unitCost == null &&
          costBasis === "unknown" &&
          lot?.wac != null &&
          !lot?.has_invoice_cost,
      };
    });
    // An inactive wine with nothing on hand is gone from every lens; one that
    // still holds bottles stays, for the valuation only (F-442).
    return rows.filter((r) => r.isActive || r.qty > 0);
  }

  /** The reorder and risk lenses: a wine marked inactive is not restocked. */
  private activeOnly<T extends { isActive?: boolean }>(rows: T[]): T[] {
    return rows.filter((r) => r.isActive !== false);
  }

  /**
   * The house's stated money (`restaurants.currency`), upper-cased; null when
   * none is on record or the read failed — the same degrade `loadInventory`
   * makes for it, logged (F-1052). `openedOn` is the day the house was set
   * up here (`restaurants.created_at`), null when unread: the start of the
   * span turns and days of stock are taken over (F-1412).
   */
  private async loadHouse(
    restaurantId: string,
  ): Promise<{ currency: string | null; openedOn: string | null }> {
    const [res] = await Promise.allSettled([
      this.dbService
        .getClient()
        .from("restaurants")
        .select("currency, created_at")
        .eq("id", restaurantId)
        .maybeSingle(),
    ]);
    this.reportSlice("restaurants", res);
    const row = res.status === "fulfilled" ? res.value?.data : null;
    const c = row?.currency;
    const opened =
      typeof row?.created_at === "string" ? row.created_at.slice(0, 10) : "";
    return {
      currency:
        typeof c === "string" && c.trim() ? c.trim().toUpperCase() : null,
      openedOn: /^\d{4}-\d{2}-\d{2}$/.test(opened) ? opened : null,
    };
  }

  private async loadDeliveredOrders(restaurantId: string, sinceDays = 365) {
    const client = this.dbService.getClient();
    const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
    // Every spend, COGS-ratio and vendor-concentration figure is built on this
    // list. Discarding the error made a failed read report a restaurant that
    // bought nothing all year — the exact shape ADR 0053 named for cost.
    //
    // Read whole or refused (ADR 0292, F-332): unranged, a year of orders
    // stopped at PostgREST's 1,000 rows and COGS-365 summed a slice of the
    // year. A refusal or a failed page now PROPAGATES, as `loadConsumption`
    // does, so the lens says it could not be read instead of a short total.
    const data = await readWholeWindow<any>(
      "The delivered orders in this window",
      () =>
        client
          .from("procurement_orders")
          .select(
            "id, provider_id, total_cost, final_price, currency, bottles_total, quantity, delivered_at, created_at, status",
            { count: "exact" },
          )
          .eq("restaurant_id", restaurantId)
          .in("status", ORDER_SPEND_STATUSES)
          .gte("delivered_at", since),
    );
    return data.map((o: any) => ({
      providerId: o.provider_id || "unknown",
      // Null when the order carries no price (F-701): not $0, and not one
      // bottle's `final_price` standing in for the whole order.
      cost: orderSpend(o),
      // The code the order was placed in; null when it names none (F-339).
      currency:
        typeof o.currency === "string" && o.currency.trim()
          ? o.currency.trim().toUpperCase()
          : null,
      bottles: o.bottles_total || o.quantity || 0,
      date: (o.delivered_at || o.created_at || "").substring(0, 10),
    }));
  }

  private async loadConsumption(
    restaurantId: string,
    sinceDays = 90,
    /** With a zone, each line is dated on the house's day (ADR 0296). */
    zone: string | null = null,
  ) {
    const client = this.dbService.getClient();
    const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
    // wine_consumption_log keys on inventory_id — it has no master_wine_id
    // column, so selecting one 42703s the whole query and silently yields an
    // empty demand series (zero velocity, zero forecast, no reorder points).
    // Resolve the wine through the inventory FK instead.
    //
    // Read whole or refused (ADR 0292): unranged, this stopped at PostgREST's
    // 1,000 rows and every demand series below was built from a slice.
    //
    // A refusal (`WholeReadError`, a 503) PROPAGATES, and so does a failed
    // page: this used to return `[]` with a log line, and the financial
    // summary, risk, inventory science and the forecast then computed as if
    // nothing had been poured. The founder, 2026-10-06 (ADR 0292 fork 3):
    // "Say 'could not be read' (Recommended)". Each of those lenses now
    // refuses whole, as menu engineering and seasonality already did.
    const data = await readWholeWindow<any>(
      "The consumption lines in this window",
      () =>
        client
          .from("wine_consumption_log")
          .select(
            "id, inventory_id, wine_name, consumption_type, quantity, volume_ml, total_revenue, source, notes, created_at, restaurant_inventory(master_wine_id, bottle_size_ml)",
            { count: "exact" },
          )
          .eq("restaurant_id", restaurantId)
          // F-1197: a sale the till voided or corrected down is marked
          // reversed (never a negative row); it is not demand.
          .is("reversed_at", null)
          .gte("created_at", since),
    );
    // `quantity` counts servings in the line's own mode (ADR 0011), so the
    // demand figure `qty` is BOTTLES (ADR 0297): null when the line carries no
    // bottle figure. `servings` and `volumeMl` stay for movement tests.
    return data.map((c: any) => {
      const { bottles, how } = bottlesOf(c);
      return {
        masterWineId: c.restaurant_inventory?.master_wine_id ?? null,
        inventoryId: c.inventory_id,
        qty: bottles,
        how,
        // What the line sold for, as the till wrote it; null when it carried
        // no price, which is not a free pour.
        revenue:
          c.total_revenue == null || Number.isNaN(Number(c.total_revenue))
            ? null
            : Number(c.total_revenue),
        // F-1492: a pour the till took for a cocktail's recipe (F-1329),
        // not a sale of this drink: its price is the cocktail's.
        recipePour: isRecipePour(c),
        servings: servingsOf(c),
        volumeMl: volumeMlOf(c),
        date: zone
          ? (houseDayOf(c.created_at, zone) ?? "")
          : (c.created_at || "").substring(0, 10),
      };
    });
  }

  /**
   * House items (inventory ids) with at least one line that carries no bottle
   * figure. Keyed by the ledger's key, not the master wine (ADR 0115): a rakı
   * or a beer has no master wine, and keyed that way it never counted (F-1014).
   */
  private uncountedWines(
    consumption: Array<{ inventoryId: string | null; how: string }>,
  ) {
    const out = new Set<string>();
    for (const c of consumption)
      if (c.inventoryId && c.how === "uncounted") out.add(c.inventoryId);
    return out;
  }

  /**
   * The days a wine's demand is averaged over (F-687): the window, or fewer
   * when the wine was listed inside it, counting the listing day as day 1 —
   * the inventory_analytics view's rule. A sale dated before the listing
   * (an import) moves the start back to that sale. An unknown listing date
   * keeps the whole window, which is what every wine got before.
   *
   * F-1516: never from before `recordsFrom`, the house's first recorded
   * sale, when it is known. A house that loaded its stock three weeks before
   * its till began has no sale before then for any wine; those days are not
   * days the wine did not sell (the inventory_analytics view's rule since
   * 20270106400000).
   */
  private daysOnList(
    listedAt: string | null | undefined,
    rows: Array<{ date: string }>,
    sinceDays: number,
    /** With a zone, today is the house's, as `toDailySeries` ends on. */
    zone: string | null = null,
    recordsFrom: string | null = null,
    /** F-1647: count to yesterday, as a series ended yesterday does. */
    throughYesterday = false,
  ): number {
    return demandDaysOnList(
      listedAt,
      rows,
      sinceDays,
      zone,
      recordsFrom,
      throughYesterday,
    );
  }

  /**
   * F-1516: the house's first recorded sale, when this window holds its
   * whole record (it was set up inside the window): demand is not averaged
   * over the days before its till began. A house set up before the window
   * may have sold before it, so its first line here is not its first.
   */
  private salesRecordedFrom(
    openedOn: string | null,
    consumption: Array<{ date: string }>,
    sinceDays: number,
  ): string | null {
    return salesRecordedFromOf(openedOn, consumption, sinceDays);
  }

  /**
   * Aggregate rows into a dense daily series over [sinceDays, today]. With
   * `bounds`, it ends yesterday and starts no earlier than `from` (F-1533).
   * A day in `bounds.ruledOut` is left out of the series, never filled as
   * 0, and named in `left` (F-1575, ADR 0317).
   */
  private toDailySeries(
    rows: Array<{ date: string; value: number }>,
    sinceDays: number,
    /** With a zone, "today" is the house's (ADR 0296); without, UTC's. */
    zone: string | null = null,
    bounds: {
      from?: string | null;
      throughYesterday?: boolean;
      ruledOut?: Set<string>;
    } = {},
  ): { dates: string[]; values: number[]; left: string[] } {
    const byDay = new Map<string, number>();
    for (const r of rows) {
      if (!r.date) continue;
      byDay.set(r.date, (byDay.get(r.date) || 0) + r.value);
    }
    const dates: string[] = [];
    const values: number[] = [];
    const left: string[] = [];
    const today = new Date();
    const houseDay = zone ? houseToday(zone, today) : null;
    const last = bounds.throughYesterday ? 1 : 0;
    for (let d = sinceDays - 1 + last; d >= last; d--) {
      const day = houseDay
        ? shiftHouseDay(houseDay, -d)
        : new Date(today.getTime() - d * 86400000)
            .toISOString()
            .substring(0, 10);
      if (bounds.from && day < bounds.from) continue;
      if (bounds.ruledOut?.has(day)) {
        left.push(day);
        continue;
      }
      dates.push(day);
      values.push(byDay.get(day) || 0);
    }
    return { dates, values, left };
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
   *
   * `fromDate`/`toDate` are HOUSE dates and `zone` the house's zone — the same
   * window the till beside it reads (ADR 0296) — so the range runs from the
   * midnight that opens `fromDate` to the one that ends `toDate`, on the
   * house's clock, never UTC's. The caller holds the zone; with none it does
   * not ask.
   */
  async getPosConsumptionBreakdown(
    restaurantId: string,
    fromDate: string,
    toDate: string,
    zone: string,
  ): Promise<PosConsumptionRow[]> {
    const client = this.dbService.getClient();
    const { startIso, endIso } = houseDayBounds(fromDate, toDate, zone);
    // `created_at` (not `recorded_at`) is what pos-hub writes through and what
    // loadConsumption above already filters on — keep the two consistent.
    //
    // Read whole or refused (ADR 0292). Unranged, this stopped at PostgREST's
    // 1,000 rows and the till list summed a slice of the window (A-033). A
    // refusal throws, as a failed read already did. The window is the house
    // days' half-open range (ADR 0296), not UTC's.
    const data = await readWholeWindow<any>(
      "The consumption lines in this window",
      () =>
        client
          .from("wine_consumption_log")
          .select(
            "id, inventory_id, wine_name, consumption_type, quantity, volume_ml, total_revenue, restaurant_inventory(wine_name, last_purchase_price)",
            { count: "exact" },
          )
          .eq("restaurant_id", restaurantId)
          // F-1197: a voided or corrected-down sale is marked reversed.
          .is("reversed_at", null)
          .gte("created_at", startIso)
          .lt("created_at", endIso),
    );

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

  /** How many uncosted on-hand rows the financial summary names. */
  static readonly MAX_UNCOSTED_NAMED = 50;

  /** Fewer days of records than this give no turns or days of stock. */
  static readonly MIN_TURNS_SPAN_DAYS = 30;

  async getFinancialSummary(restaurantId: string, labor = 0) {
    const DEAD_STOCK_WINDOW_DAYS = 90;
    const [inventory, orders, consumption, house, tax] = await Promise.all([
      this.loadInventory(restaurantId),
      this.loadDeliveredOrders(restaurantId, 365),
      this.loadConsumption(restaurantId, DEAD_STOCK_WINDOW_DAYS),
      this.loadHouse(restaurantId),
      // F-1715: the house's tax basis, as margin advice and menu engineering
      // read it. Null terms and no error for every house whose till prices
      // do not include tax: those are as before, key for key.
      readAdviceTaxTerms(this.dbService.getClient(), restaurantId, null),
    ]);
    const houseCurrency = house.currency;

    // A row holding no bottles contributes 0 to the valuation whatever it
    // cost, so it cannot block the total. Only ON-HAND rows need a cost.
    const onHand = inventory.filter((i) => i.qty > 0);
    // NB `complete` is false for an EMPTY on-hand set, so an empty cellar
    // reports null rather than $0. That is deliberate: `[]` used to be "no
    // rows or no answer" (a failed read now refuses instead, F-1214), and $0
    // for an empty set is precisely the silent zero this endpoint has already
    // been burned by once.
    const costCoverage = summarizeCostBasis(onHand);
    // Bottles of a wine marked inactive are still in the cellar, so they are
    // still stock and still valued here (F-442); the basis names how many.
    const inactiveHeld = onHand.filter((i) => !i.isActive).length;
    // A total assembled from 2 of 72 SKUs is not "inventory value" — it is a
    // different, much smaller number wearing that label. ADR 0051: say we do
    // not know. `costCoverage` below says how far off complete we are, so the
    // UI can name the gap instead of rendering a silent understatement.
    const inventoryValue = costCoverage.complete
      ? E.stats.sum(onHand.map((i) => i.inventoryValue as number))
      : null;
    // F-644: one uncosted bottle (a returned bottle, a never-invoiced wine)
    // used to blank the house's whole cellar value. The priced wines' own
    // total is a measurement of those wines, so it is reported under its own
    // name, beside costCoverage.unpriced — the count of wines it leaves out.
    // inventoryValue and every ratio built on it stay null: a part is not
    // the whole, and nothing below divides by this.
    // F-1654: of the unpriced wines, those whose lots carry a cost that is
    // not an invoice's, so a page can say so rather than "no cost".
    const notInvoicedWines = onHand.filter((i) => i.notInvoiced).length;
    // F-1652: a partly costed wine adds its costed bottles only, and its
    // uncosted ones are counted in costCoverage.uncostedBottles.
    const pricedInventoryValue =
      costCoverage.priced > 0
        ? E.stats.sum(
            onHand
              .filter((i) => i.pricedValue != null)
              .map((i) => i.pricedValue as number),
          )
        : null;

    // `E.stats.sum([])` is 0, and the orders loader used to degrade a failed
    // query to `[]` (it now refuses, F-332), so an unconditional sum reported
    // "the query failed" and "this restaurant bought nothing in a year" as the
    // same $0 — absence rendered as a fact. An empty result set is not a measured zero:
    // it is the absence of any row to measure, so it is null and the basis
    // says which. A restaurant that genuinely placed orders still gets its
    // real total, including a real 0 if every order carried no cost.
    //
    // Orders placed in two currencies have no single COGS: there is no
    // rate to add a €400 order to a ₺12,000 one by (F-339). An order naming
    // no currency is in the house's money (F-1052), as every order was before
    // the column existed; with no house currency on record it is added in.
    // A delivered order with no price is left out and counted (F-701), so
    // the page can say what the figure is missing, as costCoverage does.
    const orderCurrencies = new Set(
      orders
        .map((o) => o.currency ?? houseCurrency)
        .filter((c): c is string => c !== null),
    );
    const pricedCosts = orders
      .map((o) => o.cost)
      .filter((c): c is number => c != null);
    const cogsUnpricedCount = orders.length - pricedCosts.length;
    const cogs =
      orders.length === 0 || orderCurrencies.size > 1
        ? null
        : E.stats.sum(pricedCosts);
    // The code COGS is in (F-1052): one currency that is not the house's is
    // given WITH its code, never as house money. Null is the house's money
    // when none is on record.
    const cogsCurrency =
      cogs == null ? null : (Array.from(orderCurrencies)[0] ?? houseCurrency);
    // A euro COGS is not set against a lira cellar: turns and days of stock
    // divide one by the other, and nothing converts between them.
    const cogsInHouseMoney =
      cogsCurrency == null ||
      houseCurrency == null ||
      cogsCurrency === houseCurrency;

    // Revenue basis: sell-price valuation of purchased bottles (proxy until a
    // POS revenue feed lands). Menu price is recorded, so this survives an
    // unknown cost — it is the cost-derived fields below that go null.
    //
    // Only wines with a bottle price are valued (F-574). An unpriced wine used
    // to count as $0 of sales while its cost still counted, so every glass-only
    // wine pushed gross margin and the COGS ratio down, and could take margin
    // below zero, with nothing on the page saying why. It is now left out of
    // both sides of the margin, and `priceCoverage` says how many were left
    // out. No priced wine at all is no valuation, not $0.
    const priced = inventory.filter((i) => i.hasPrice);
    const onHandPriced = onHand.filter((i) => i.hasPrice);
    const priceCoverage = {
      total: onHand.length,
      priced: onHandPriced.length,
      unpriced: onHand.length - onHandPriced.length,
    };
    // F-1715: at a house whose till prices include tax, the shelf price
    // holds the tax, and sales tax is not the house's money. The valuation
    // is taken without it, price ÷ (1 + the wine's rate in force today), as
    // menu engineering's margin is (preTaxMargin, F-1587); and the margin
    // below is set only against costs proven without tax. A wine on hand
    // with no rate, a cost not proven pre-tax, or a basis nobody could read
    // withholds the figures that need it, and `marginTaxNote` says which.
    const taxed = tax.terms !== null || tax.error !== null;
    const heldPriced = priced.filter((i) => (i.qty || 0) !== 0);
    const rateOf = new Map<string, number>();
    let noRate = 0;
    if (tax.terms !== null) {
      for (const i of heldPriced) {
        const r = wineTaxRate(tax.terms, i.id);
        if ("rate" in r) rateOf.set(i.id, r.rate);
        else noRate += 1;
      }
    }
    const costNotPreTax = taxed
      ? onHandPriced.filter((i) => i.unitCost != null && i.costTax !== "pre_tax")
          .length
      : 0;
    const revenue =
      priced.length === 0 || (taxed && (tax.terms === null || noRate > 0))
        ? null
        : E.stats.sum(
            priced.map(
              (i) =>
                (taxed && (i.qty || 0) !== 0
                  ? i.unitPrice / (1 + (rateOf.get(i.id) as number))
                  : i.unitPrice) * (i.qty || 0),
            ),
          );
    // The cost side of the margin: the same priced on-hand rows, so the two
    // sides of every ratio below cover the same bottles. Null whenever the
    // cellar's cost is not complete, as before (ADR 0051).
    const pricedValue =
      inventoryValue == null || costNotPreTax > 0
        ? null
        : E.stats.sum(onHandPriced.map((i) => i.inventoryValue as number));
    const marginDollars =
      pricedValue == null || revenue == null ? null : revenue - pricedValue;

    // Every one of these takes inventory value as its cost input, and the two
    // ratios take revenue as their denominator. A null on either side makes
    // them unknown, not zero and not infinite.
    //
    // F-1412: COGS is what the house bought over the days it has records
    // for, not always a year. A house open six weeks has six weeks of
    // purchases; set against today's cellar as if a year, its turns read a
    // ninth of the truth and its days of stock nine times too many. Turns are
    // given per year (scaled up from the span); under a month of records they
    // are not given.
    //
    // F-1493: the span starts at the first record of buying, the first
    // delivered order, not at sign-up. COGS holds only delivered orders, so a
    // house that signed up three weeks before its first delivery spread 24
    // days of buying over 45. A house set up over a year ago keeps the year:
    // its buying before the window is not read here, so the first order
    // inside it is not its first. With no order the set-up day stands (COGS
    // is then blank and turns are not given for that reason).
    const today = new Date().toISOString().slice(0, 10);
    const daysTo = (d: string) =>
      Math.floor((Date.parse(today) - Date.parse(d)) / 86400000) + 1;
    let firstBuying: string | null = null;
    for (const o of orders)
      if (o.date && (!firstBuying || o.date < firstBuying))
        firstBuying = o.date;
    const spanStart =
      house.openedOn && daysTo(house.openedOn) >= 365
        ? house.openedOn
        : (firstBuying ?? house.openedOn);
    const spanDays = spanStart ? daysTo(spanStart) : 365;
    const periodDays = Number.isFinite(spanDays)
      ? Math.min(365, Math.max(1, spanDays))
      : 365;
    const spanTooShort = periodDays < AnalyticsService.MIN_TURNS_SPAN_DAYS;
    // F-1443: a COGS that leaves out deliveries with no price is short, so
    // turns from it read too low and days of stock too high, as if measured.
    // They are withheld, with that reason, as the purchase_spend goal refuses
    // the same gap (UnpricedSpendError).
    const turnsUnknown =
      inventoryValue == null ||
      cogs == null ||
      !cogsInHouseMoney ||
      cogsUnpricedCount > 0;
    const periodTurns =
      turnsUnknown || spanTooShort
        ? null
        : E.inventory.inventoryTurnover(cogs, inventoryValue);
    const turnover =
      periodTurns == null ? null : (periodTurns * 365) / periodDays;
    const dio =
      turnsUnknown || spanTooShort
        ? null
        : E.inventory.daysInventoryOutstanding(
            cogs,
            inventoryValue,
            periodDays,
          );
    const gmroi =
      pricedValue == null || marginDollars == null
        ? null
        : E.inventory.gmroi(marginDollars, pricedValue);
    const grossMargin =
      pricedValue != null && revenue != null && revenue > 0
        ? E.finance.grossMargin(pricedValue, revenue)
        : null;
    const cogsRatioVal =
      pricedValue != null && revenue != null && revenue > 0
        ? E.finance.cogsRatio(pricedValue, revenue)
        : null;
    const primeCost =
      pricedValue != null && revenue != null && revenue > 0
        ? E.finance.primeCostRatio(pricedValue, labor, revenue)
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
      // Movement is a serving or a millilitre, not a bottle figure: a wine
      // sold only by the glass moved, whatever its size (ADR 0297).
      if ((c.servings ?? 0) <= 0 && (c.volumeMl ?? 0) <= 0) continue;
      if (c.inventoryId) movedInventoryIds.add(c.inventoryId);
      if (c.masterWineId) movedMasterWineIds.add(c.masterWineId);
    }
    // No movement recorded ANYWHERE is not evidence that nothing moved — it is
    // a restaurant with no POS/consumption feed (a failed or refused read of
    // the log no longer lands here: it throws, ADR 0292 fork 3). Zero
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
              // F-1415: a wine listed inside the window has not had 90 days
              // to sell, so no sale yet is not idle capital — the days it
              // has been on the list are counted as daysOnList counts them.
              this.daysOnList(i.listedAt, [], DEAD_STOCK_WINDOW_DAYS) >=
                DEAD_STOCK_WINDOW_DAYS &&
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
        cogs:
          orders.length === 0
            ? "delivered procurement_orders (trailing 365d) — null: no delivered order was returned for this window (a failed read refuses the summary rather than landing here), and an empty list is not a measured $0"
            : orderCurrencies.size > 1
              ? `delivered procurement_orders (trailing 365d) — null: the orders were placed in ${Array.from(orderCurrencies).sort().join(", ")}, and with no exchange rate on record they cannot be added into one figure`
              : `delivered procurement_orders (trailing 365d) — ${pricedCosts.length} order${pricedCosts.length === 1 ? "" : "s"} summed` +
                (cogsUnpricedCount > 0
                  ? `; ${cogsUnpricedCount} delivered order${cogsUnpricedCount === 1 ? "" : "s"} with no price left out`
                  : "") +
                (cogsInHouseMoney
                  ? ""
                  : `; paid in ${cogsCurrency}, not the house's ${houseCurrency}, so it is given in ${cogsCurrency} and inventory turns and days of stock are not taken from it`),
        revenue:
          inventory.length === 0
            ? "unit_price × on-hand qty (POS-revenue proxy) — null: no inventory row was returned (a failed read refuses the summary rather than landing here, F-1214), and $0 would claim an empty cellar sells for nothing"
            : priced.length === 0
              ? `unit_price × on-hand qty (POS-revenue proxy) — null: none of the ${inventory.length} inventory row${inventory.length === 1 ? "" : "s"} carries a bottle price, and $0 would claim they sell for nothing`
              : `unit_price × on-hand qty (POS-revenue proxy) — ${priced.length} inventory row${priced.length === 1 ? "" : "s"} valued${priced.length < inventory.length ? `; ${inventory.length - priced.length} with no bottle price left out of revenue and of the cost the margin is taken against` : ""}`,
        // This string used to read "on-hand qty × WAC (lot rollup)"
        // unconditionally while ~70 of 72 rows were valued off a fabricated
        // 0.6 × menu price. A basis now describes the rows it covered.
        inventoryValue: `on-hand qty × unit cost — ${costBasisSentence(costCoverage)}${inactiveHeld > 0 ? `; includes ${inactiveHeld} wine${inactiveHeld === 1 ? "" : "s"} marked inactive that still hold bottles` : ""}`,
        pricedInventoryValue:
          "on-hand qty × unit cost over the on-hand bottles that carry a recorded cost only; the rows it leaves out are costCoverage.unpriced, and the bottles of partly costed rows it leaves out are costCoverage.uncostedBottles; null when no on-hand row carries a cost",
        notInvoicedWines:
          "of costCoverage.unpriced, the on-hand rows whose lots carry a cost typed in by the house or an order's price but no invoice's",
        turns:
          cogs != null && cogsUnpricedCount > 0
            ? `null: ${cogsUnpricedCount} delivered order${cogsUnpricedCount === 1 ? "" : "s"} with no price ${cogsUnpricedCount === 1 ? "is" : "are"} left out of cost of goods, so it is short, and turns and days of stock are not taken from it`
            : periodDays >= 365
              ? "delivered order cost over the last 365 days ÷ today's inventory value; days of stock = 365 ÷ turns"
              : spanTooShort
                ? `null: the house has ${periodDays} day${periodDays === 1 ? "" : "s"} of buying on record (since its first delivered order), and turns and days of stock need at least ${AnalyticsService.MIN_TURNS_SPAN_DAYS}`
                : `delivered order cost over the ${periodDays} days since the house's first delivered order ÷ today's inventory value, scaled to a year; days of stock = ${periodDays} ÷ turns over those days`,
        deadStock: `on-hand qty > 0 with zero wine_consumption_log movement in ${DEAD_STOCK_WINDOW_DAYS}d, among wines on the list for at least ${DEAD_STOCK_WINDOW_DAYS}d; null when the restaurant records no movement at all, or when any idle row has no recorded cost`,
        costDerived:
          "inventoryValue, grossMarginDollars, grossMargin, cogsRatio, primeCostRatio, inventoryTurnover, daysInventoryOutstanding, gmroi and deadStockCapital are null unless every on-hand row carries a recorded cost (ADR 0051); inventoryTurnover and daysInventoryOutstanding are null again when cogs is null, in a currency other than the house's, or short of delivered orders with no price (cogsUnpricedCount), and the three ratios again when revenue is null, because a ratio over an absent denominator is not a ratio; grossMarginDollars, grossMargin, cogsRatio, primeCostRatio and gmroi are taken over the on-hand wines that carry a bottle price only, so a wine with no price adds neither sales nor cost to them (priceCoverage counts it)",
      },
      costCoverage,
      // Which on-hand rows carry no recorded cost, by name (F-133): the
      // count alone told the owner that the cellar's value was withheld but
      // not which wines to cost to get it back. Capped; `costCoverage.unpriced`
      // is the whole count.
      uncosted: onHand
        .filter((i) => i.unitCost == null)
        .slice(0, AnalyticsService.MAX_UNCOSTED_NAMED)
        .map((i) => ({ id: i.id, name: i.name, qty: i.qty })),
      priceCoverage,
      inventoryValue,
      pricedInventoryValue,
      notInvoicedWines,
      cogs,
      cogsCurrency,
      /** The house's stated money; null when none is on record (F-1052). */
      houseCurrency,
      cogsUnpricedCount,
      // Why `cogs` is blank when the orders were placed in two currencies
      // (F-1054), so the page does not call it an empty window.
      cogsNote:
        orders.length > 0 && orderCurrencies.size > 1
          ? `Ordered in ${Array.from(orderCurrencies).sort().join(" and ")}: with no exchange rate on record these cannot be added into one figure.`
          : null,
      revenue,
      // F-1715: only for a house whose till prices include tax, or whose
      // basis could not be read; every other house gets no key.
      ...(taxed
        ? {
            marginTaxNote:
              tax.terms === null
                ? "Whether your till prices include tax could not be read, so the sell-price valuation, gross margin, COGS ratio and GMROI are not worked out until it can be."
                : noRate > 0
                  ? `Your till prices include tax, and ${noRate} wine${noRate === 1 ? "" : "s"} on hand ${noRate === 1 ? "has" : "have"} no tax rate in force today, so the sell-price valuation, gross margin, COGS ratio and GMROI are not worked out. Set the rates in Settings.`
                  : costNotPreTax > 0
                    ? `Your till prices include tax, so margin is set against costs recorded without tax, and ${costNotPreTax} wine${costNotPreTax === 1 ? "" : "s"} on hand ${costNotPreTax === 1 ? "has a cost" : "have costs"} not recorded that way, so gross margin, COGS ratio and GMROI are not worked out.`
                    : "Your till prices include tax, so the sell-price valuation and the margins here are worked out on prices without it, price ÷ (1 + the wine's tax rate).",
          }
        : {}),
      grossMarginDollars: marginDollars,
      grossMargin,
      cogsRatio: cogsRatioVal,
      primeCostRatio: primeCost,
      inventoryTurnover: turnover,
      daysInventoryOutstanding: dio,
      /** The days turns and days of stock are taken over (F-1412). */
      turnsPeriodDays: periodDays,
      /**
       * F-1491: true when turns and days of stock are withheld because the
       * house has under a month of buying on record — its own reason, not the
       * cost basis's. Only with an order: with none, COGS is the reason.
       */
      turnsSpanShort: spanTooShort && orders.length > 0,
      /**
       * F-1491: the span said in plain words for the page and the export:
       * why turns are withheld, or the days they are scaled up from; null
       * over a full year or with no delivered order.
       */
      turnsSpanNote:
        orders.length === 0
          ? null
          : spanTooShort
            ? `Turns and days of stock need ${AnalyticsService.MIN_TURNS_SPAN_DAYS} days of buying on record; this house has ${periodDays} day${periodDays === 1 ? "" : "s"}, counted from its first delivery.`
            : periodDays < 365
              ? `Turns and days of stock are taken over the ${periodDays} days since this house's first delivery, and turns are scaled up to a year.`
              : null,
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
    // Days are the house's (F-324, F-928), as the forecast's are: on UTC's an
    // evening's pours in a US house sat on tomorrow and today read empty. No
    // zone keeps UTC's days, as before.
    const { zone } = await readHouseZone(
      this.dbService.getClient(),
      restaurantId,
    );

    const [allInventory, consumption, house, exclusions] = await Promise.all([
      this.loadInventory(restaurantId),
      this.loadConsumption(restaurantId, sinceDays, zone),
      this.loadHouse(restaurantId),
      this.dayExclusions.load(restaurantId),
    ]);
    const ruledOutLeft = new Set<string>();
    const inventory = this.activeOnly(allInventory);
    const salesRecordedFrom = this.salesRecordedFrom(
      house.openedOn,
      consumption,
      sinceDays,
    );

    // Demand series per house item — the ledger's key (ADR 0115). Keyed by
    // master wine, every drink that is not a wine (no master) read zero
    // demand and never reached the reorder list (F-1014).
    const demandByWine = new Map<
      string,
      Array<{ date: string; value: number }>
    >();
    for (const c of consumption) {
      if (!c.inventoryId || c.qty == null) continue;
      const arr = demandByWine.get(c.inventoryId) || [];
      arr.push({ date: c.date, value: c.qty });
      demandByWine.set(c.inventoryId, arr);
    }
    // A wine with any line that carries no bottle figure has no demand to
    // reorder on: its counted lines alone would understate it (ADR 0297).
    const unknownDemand = this.uncountedWines(consumption);
    const unitsCoverage = summarizeUnits(consumption);

    const skus = inventory.map((i) => {
      // What the shelf will hold once what is already ordered arrives. An
      // order that cannot be counted adds nothing, and says so (onOrder null).
      const position = i.qty + (i.onOrder ?? 0);
      const rows = demandByWine.get(i.id) || [];
      // F-1647: demand ends yesterday, as the forecast's does (F-1533):
      // today's unfinished day is not a full day of sales.
      const demandDays = this.daysOnList(
        i.listedAt,
        rows,
        sinceDays,
        zone,
        salesRecordedFrom,
        true,
      );
      const { values, left } = this.toDailySeries(rows, demandDays, zone, {
        throughYesterday: true,
        ruledOut: exclusions.dates,
      });
      for (const d of left) ruledOutLeft.add(d);
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
        onHand: position,
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
        /** Bottles ordered and not yet here; null when they cannot be counted. */
        onOrder: i.onOrder,
        nextArrival: i.nextArrival ?? null,
        avgDailyDemand: profile.mean,
        // The days the mean is over: a ruled-out day is not one (F-1575).
        demandDays: values.length,
        demandCv: profile.cv,
        xyzClass: E.inventory.xyzClassify(profile.cv),
        daysOfCover: doc,
        reorderPoint: rop?.reorderPoint ?? null,
        safetyStock: rop?.safetyStock ?? null,
        stockoutProbability: stockoutProb,
        eoq: eoq?.eoq ?? null,
        needsReorder: rop ? position <= rop.reorderPoint : false,
        unitCost: i.unitCost,
        costBasis: i.costBasis,
        inventoryValue: i.inventoryValue,
        abcClass: null as "A" | "B" | "C" | null,
        demandUnknown: false,
        ...(unknownDemand.has(i.id)
          ? {
              avgDailyDemand: null,
              demandCv: null,
              xyzClass: "unknown" as const,
              daysOfCover: null,
              reorderPoint: null,
              safetyStock: null,
              stockoutProbability: null,
              eoq: null,
              needsReorder: false,
              demandUnknown: true,
            }
          : {}),
      };
    });
    const unassessed = skus.filter((s) => s.demandUnknown).length;

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

    // Highest risk first, and within a tie the order is the data's, never the
    // database's: sorted by probability alone, a tie kept whatever order
    // loadInventory returned, so the cut below listed two of Tuzlu's five
    // wines tied at 27% under "the 25 at the highest risk" (A-070, ADR 0272).
    const reorderList = skus
      .filter((s) => s.needsReorder)
      .sort(E.byStockoutRisk);

    return {
      params: {
        serviceLevel,
        leadTimeDays: leadTime,
        demandWindowDays: sinceDays,
        /** F-1516: the house's first recorded sale; null when not known. */
        salesRecordedFrom,
      },
      // This endpoint carried no `basis` at all, which made its cost-derived
      // columns unreadable: nothing said where `inventoryValue` came from.
      basis: {
        demand: `bottles/day over ${sinceDays}d ending yesterday, so today's unfinished day is not counted, or over the days since the wine was listed when that is fewer (skus[].demandDays)${salesRecordedFrom ? `, and never from before the house's first recorded sale on ${salesRecordedFrom}` : ""} — ${unitsBasisSentence(unitsCoverage)}${unassessed > 0 ? `; ${unassessed} row(s) are unassessed (skus[].demandUnknown): their demand, cover, reorder point and stockout risk are null and they are never put on the reorder list` : ""}${ruledOutSaid(exclusions, ruledOutLeft)}`,
        reorderScience: `King safety stock at serviceLevel ${serviceLevel}, lead time ${leadTime}d — demand-derived, unaffected by cost; stockout risk and the reorder list count bottles already ordered and not yet arrived (skus[].onOrder; null when an open order states no bottle count or the orders could not be read, and then only the shelf is counted)`,
        inventoryValue: `on-hand qty × unit cost — ${costBasisSentence(costCoverage)}`,
        costDerived:
          "skus[].inventoryValue, skus[].unitCost and skus[].eoq are null for any row with no recorded cost; skus[].abcClass is null for EVERY row unless the whole cellar is priced, because ABC cuts on share of a total (ADR 0051)",
      },
      costCoverage,
      unitsCoverage,
      skuCount: skus.length,
      unassessed,
      reorderCount: reorderList.length,
      // 25, extended through any tie at row 25 — "the N at the highest risk"
      // is only true when no row tied with the last one listed was left out.
      // Never through a tie at 0%: that group is every wine with no demand
      // and nothing on hand, it carries no risk to rank, and extending
      // through it listed all of them (ADR 0272, fork 3 bound).
      reorderList: E.cutKeepingTies(
        reorderList,
        25,
        (s) => s.stockoutProbability,
        { extendOnlyAbove: 0 },
      ),
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
    // The demand days are the house's (F-928), as in getInventoryScience.
    const { zone } = await readHouseZone(
      this.dbService.getClient(),
      restaurantId,
    );
    const [orders, consumption, exclusions] = await Promise.all([
      this.loadDeliveredOrders(restaurantId, 365),
      this.loadConsumption(restaurantId, 90, zone),
      this.dayExclusions.load(restaurantId),
    ]);

    // Vendor concentration (HHI on spend share). An order with no price is
    // left out and counted, not added as 0 (F-701), and orders paid in two
    // currencies have no shares to take: there is no rate to set a €8,000
    // order beside a ₺300,000 one, as COGS says under F-339 (F-1015).
    const orderCurrencies = Array.from(
      new Set(
        orders.map((o) => o.currency).filter((c): c is string => c !== null),
      ),
    ).sort();
    const mixedCurrency = orderCurrencies.length > 1;
    const vendorUnpricedCount = orders.filter((o) => o.cost == null).length;
    const spendByVendor = new Map<string, number>();
    for (const o of orders)
      if (o.cost != null && !mixedCurrency)
        spendByVendor.set(
          o.providerId,
          (spendByVendor.get(o.providerId) || 0) + o.cost,
        );
    const vendorWeights = Array.from(spendByVendor.values());
    const hhi = E.finance.herfindahlIndex(vendorWeights);
    const effectiveVendors = E.finance.effectiveCount(vendorWeights);
    const cr4 = E.finance.concentrationRatio(vendorWeights, 4);

    // Revenue concentration across drinks (Gini) — over what each house item
    // SOLD in the window, as the till wrote it (F-1016). It was the shelf's
    // sell-price value, so a sold-out or unpriced wine counted as a zero and
    // "protect the top sellers" pointed at the deepest stock. A drink with a
    // line that carries no price is left out and counted, never read as 0;
    // a drink that sold nothing is not in the room's revenue at all.
    //
    // F-1492: a pour into a cocktail is not a sale of the drink poured. It
    // carries no price of its own, and read as an unpriced sale it took the
    // gin's own priced sales out with it. It is skipped and counted; the
    // cocktail's till price lives on the check, not in this log, so the
    // cocktails themselves are not in these figures, and the basis says so.
    const soldValue = new Map<string, number>();
    const unpricedSales = new Set<string>();
    let cocktailPours = 0;
    for (const c of consumption) {
      if (!c.inventoryId) continue;
      if (c.recipePour) cocktailPours++;
      else if (c.revenue == null) unpricedSales.add(c.inventoryId);
      else
        soldValue.set(
          c.inventoryId,
          (soldValue.get(c.inventoryId) || 0) + c.revenue,
        );
    }
    for (const id of unpricedSales) soldValue.delete(id);
    const skuRevenue = Array.from(soldValue.values()).filter((v) => v > 0);
    const gini = E.risk.giniCoefficient(skuRevenue);
    const skuHhi = E.finance.herfindahlIndex(skuRevenue);

    // Daily revenue series → returns → VaR / Sharpe / drawdown. Counted
    // lines only; `basis.demand` names any that carry no bottle figure.
    const unitsCoverage = summarizeUnits(consumption);
    const revRows = consumption
      .filter((c) => c.qty != null)
      .map((c) => ({
        date: c.date,
        value: c.qty as number, // bottles/day as the "return-generating" flow
      }));
    const {
      dates: demandDates,
      values: dailyDemand,
      left: riskLeft,
    } = this.toDailySeries(revRows, 90, zone, { ruledOut: exclusions.dates });
    const returns: number[] = [];
    for (let i = 1; i < dailyDemand.length; i++) {
      // F-1579: no day-to-day change is taken across a ruled-out day; the
      // two days either side of it are not consecutive.
      if (shiftHouseDay(demandDates[i - 1], 1) !== demandDates[i]) continue;
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
      basis: {
        demand: `demandRisk is over bottles/day across 90d — ${unitsBasisSentence(unitsCoverage, "series")}${ruledOutSaid(exclusions, riskLeft, "risk")}`,
        revenueConcentration: `over what each drink sold in the last 90d (${skuRevenue.length} drink(s) with sales)${unpricedSales.size > 0 ? `; ${unpricedSales.size} drink(s) left out because a sale carried no price` : ""}${cocktailPours > 0 ? `; ${cocktailPours} pour(s) into cocktails are not counted as sales of the drinks poured, and the cocktails' own sales are not in these figures` : ""}`,
        vendorConcentration: mixedCurrency
          ? `delivered procurement_orders (trailing 365d) — null: the orders were placed in ${orderCurrencies.join(", ")}, and with no exchange rate on record their spend shares cannot be compared`
          : `delivered procurement_orders (trailing 365d) — shares of ${orders.length - vendorUnpricedCount} priced order${orders.length - vendorUnpricedCount === 1 ? "" : "s"}` +
            (vendorUnpricedCount > 0
              ? `; ${vendorUnpricedCount} delivered order${vendorUnpricedCount === 1 ? "" : "s"} with no price left out`
              : ""),
      },
      vendorConcentration: {
        hhi,
        hhiPoints: hhi === null ? null : Math.round(hhi * 10000),
        effectiveVendors,
        cr4,
        // Vendors with a priced order, counted even when their shares
        // cannot be taken.
        vendorCount: new Set(
          orders.filter((o) => o.cost != null).map((o) => o.providerId),
        ).size,
        // Orders left out of the shares because they carry no price (F-1015).
        unpricedCount: vendorUnpricedCount,
        interpretation: mixedCurrency
          ? "not comparable — orders paid in more than one currency"
          : hhi === null
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
        soldCount: skuRevenue.length,
        unpricedLeftOut: unpricedSales.size,
        /** F-1492: pours into cocktails, which are not sales; cocktails are not in the figures. */
        cocktailPoursLeftOut: cocktailPours,
        interpretation:
          gini === null
            ? "insufficient data"
            : gini > 0.6
              ? "revenue rides on very few drinks"
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
    // Days are the house's (F-324): on UTC's an LA evening's pours sat on
    // tomorrow's bar and the projection started the day after. No zone keeps
    // UTC's days, as before.
    const { zone } = await readHouseZone(
      this.dbService.getClient(),
      restaurantId,
    );
    const [consumption, house, exclusions] = await Promise.all([
      this.loadConsumption(restaurantId, sinceDays, zone),
      this.loadHouse(restaurantId),
      this.dayExclusions.load(restaurantId),
    ]);
    // F-1533: fitted from the house's first recorded sale (F-1516's rule),
    // never on the zeros before its till began, and through yesterday: today
    // is not over, so its count so far is not a day of history.
    const recordsFrom = this.salesRecordedFrom(
      house.openedOn,
      consumption,
      sinceDays,
    );
    const scoped = consumption.filter(
      (c) => !opts.masterWineId || c.masterWineId === opts.masterWineId,
    );
    // Counted lines only. One wine with a line that carries no bottle figure
    // is not projected at all; the house series names the gap (ADR 0297).
    const unitsCoverage = summarizeUnits(scoped);
    const unmeasuredWine = !!opts.masterWineId && !unitsCoverage.complete;
    const rows = scoped
      .filter((c) => c.qty != null)
      .map((c) => ({ date: c.date, value: c.qty as number }));
    // F-1575: a day ruled out of the baselines (a till outage, a closure)
    // is left out of the history, never fitted as a day that sold nothing.
    const {
      dates,
      values: counts,
      left,
    } = this.toDailySeries(rows, sinceDays, zone, {
      from: recordsFrom,
      throughYesterday: true,
      ruledOut: exclusions.dates,
    });
    // F-1579: but the model reads index mod 7 as the weekday, so it is fitted
    // on one value per calendar day: a ruled-out day keeps its place, filled
    // from the same weekday in the weeks around it, and `observed` keeps it
    // out of every accuracy figure. `history` still shows only counted days.
    const counted = new Map(dates.map((d, i) => [d, counts[i]]));
    const days = [...dates, ...left].sort();
    const observed = days.map((d) => counted.has(d));
    const values = E.forecast.fillSeasonalGaps(
      days.map((d) => counted.get(d) ?? null),
      7,
    );

    // Try weekly-seasonal Holt-Winters; fall back to Holt then SES.
    // `warmup` is the seeding window each model reads before its recursion can
    // predict anything out-of-sample — accuracy is scored past it (ADR 0064).
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
            warmup: ses.warmup,
          }
        : null;
    }

    // Rolling one-step-ahead accuracy: each fitted[i] is a prediction of
    // values[i] made from values[0..i-1] only. The seeding window is excluded
    // because those fitted values are in-sample by construction, and `from: w`
    // holds the seasonal-naive denominator to that same window — scoring the
    // numerator on [w, n) against a benchmark drawn from [period, n) would
    // compare two different stretches of trade (ADR 0064).
    let accuracy: {
      mae: number | null;
      rmse: number | null;
      mape: number | null;
      maseVsSeasonalNaive: number | null;
      basis: string;
      scoredPoints: number;
    } | null = null;
    // A short history is not scored either: an error measured against it
    // would be a claim about sales that were never counted.
    if (result && !unmeasuredWine) {
      const w = Math.min(result.warmup, values.length);
      // Scored on counted days only (F-1579): a filled-in day is not a sale.
      const scored = values
        .map((_, i) => i)
        .filter((i) => i >= w && observed[i]);
      const { fitted } = result;
      const actual = scored.map((i) => values[i]);
      const predicted = scored.map((i) => fitted[i]);
      // `toDailySeries` zero-fills, so a restaurant (or SKU) with no
      // consumption yields an all-zero window. MAE and RMSE would both answer
      // 0 there — a *perfect forecast* claimed over a series holding no
      // observation. An unknown is an em dash, never a zero (ADR 0051).
      const hasSignal = actual.some((v) => v !== 0);
      accuracy = hasSignal
        ? {
            mae: E.forecast.mae(actual, predicted),
            rmse: E.forecast.rmse(actual, predicted),
            mape: E.forecast.mape(actual, predicted),
            maseVsSeasonalNaive: E.forecast.mase(
              actual,
              predicted,
              values,
              period,
              w,
              observed,
            ),
            basis: "rolling_one_step_ahead",
            scoredPoints: actual.length,
          }
        : {
            mae: null,
            rmse: null,
            mape: null,
            maseVsSeasonalNaive: null,
            basis: "no_observations_in_scored_window",
            scoredPoints: 0,
          };
    }

    // The history ends yesterday, so the first projected day is today.
    const futureDates: string[] = [];
    const today = new Date();
    for (let h = 0; h < horizon; h++)
      futureDates.push(
        zone
          ? shiftHouseDay(houseToday(zone, today), h)
          : new Date(today.getTime() + h * 86400000)
              .toISOString()
              .substring(0, 10),
      );

    // `toDailySeries` zero-fills, so a restaurant with no consumption feed
    // still hands Holt-Winters 120 numbers and HW dutifully "fits" them. The
    // arithmetic is sound and the answer is not: a projection of zero built on
    // a log holding no observation is not a forecast of no demand, it is the
    // absence of any demand signal — and `totalForecastDemand: 0` put that
    // absence in front of a manager as a prediction. `accuracy` already refuses
    // to score this window (`no_observations_in_scored_window` below); the
    // projection itself must refuse too, or the page reads a flat zero line as
    // a claim about next week (ADR 0020).
    const hasObservation = values.some((v) => v !== 0);
    const projection = hasObservation && !unmeasuredWine ? result : null;

    return {
      // `model` used to report the LAST model attempted even when none of the
      // three fitted, so a caller read "ses" and had no way to learn that SES
      // had refused the history too. When nothing is projected there is no
      // model, and `modelFitted` says so in one field a consumer cannot miss.
      model: projection ? model : null,
      modelFitted: !!projection,
      masterWineId: opts.masterWineId ?? "all",
      horizon,
      history: { dates, values: counts },
      forecast:
        projection?.forecast.map((v, i) => ({
          date: futureDates[i],
          value: Math.max(0, v),
        })) ?? [],
      // This was `: 0` — a zero standing in for an absent model, which reads as
      // "we project you will sell nothing" when the truth is "there is nothing
      // here to project from". Nothing was projected, so nothing is totalled.
      totalForecastDemand: projection
        ? E.stats.sum(projection.forecast.map((v) => Math.max(0, v)))
        : null,
      basis: {
        demand: `bottles/day over ${dates.length} days through yesterday (up to ${sinceDays}${recordsFrom ? `, from the house's first recorded sale on ${recordsFrom}` : ""}; today is not over and is not history), one figure per day, a day with no sale read as 0 — ${unitsBasisSentence(unitsCoverage, "series")}${ruledOutSaid(exclusions, left, "forecast")}${unmeasuredWine ? "; nothing is projected from this short series" : ""}`,
        model: projection
          ? `${model} fitted on ${values.length} days of history${left.length > 0 ? `, ${left.length} of them ruled out and filled in from the same weekday in the weeks around ${left.length === 1 ? "it" : "them"}` : ""}`
          : unmeasuredWine
            ? "no model fitted — this wine has lines that carry no bottle figure, so its history is short by an unknown amount and nothing is projected from it"
            : hasObservation
              ? "no model fitted — Holt-Winters, Holt and SES each refused this history, so no line is projected and no total is claimed"
              : `no model fitted — every one of the ${values.length} days of history reads zero, so there is no demand signal to project from`,
        total: projection
          ? `sum of the ${horizon}-day forecast, each day floored at 0`
          : "null — there is no projection to total",
      },
      accuracy,
      generatedAt: new Date().toISOString(),
    };
  }
}

/**
 * F-1575: what a demand series says about the days ruled out of the
 * baselines (ADR 0317) — the ones it left out, or that the list could not be
 * read, so a ruled-out outage may be in it as a day that sold nothing.
 */
function ruledOutSaid(
  exclusions: DayExclusions,
  left: Iterable<string>,
  /** F-1579: how the series kept the weekly pattern across the gap. */
  use: "average" | "forecast" | "risk" = "average",
): string {
  if (!exclusions.readable)
    return "; the days ruled out of the figures could not be read, so a ruled-out day may be counted here as one that sold nothing";
  const days = Array.from(new Set(left)).sort();
  if (days.length === 0) return "";
  const said = `; ${days.length} day${days.length === 1 ? "" : "s"} ruled out of the figures left out (${days.join(", ")}), not counted as days that sold nothing`;
  if (use === "forecast")
    return `${said}; the forecast holds ${days.length === 1 ? "its" : "their"} place with the same weekday in the weeks around ${days.length === 1 ? "it" : "them"}, so the weekly pattern holds, and its accuracy is scored only on days that were counted`;
  if (use === "risk")
    return `${said}, and no day-to-day change is taken across ${days.length === 1 ? "it" : "them"}`;
  return said;
}

/**
 * The days a wine's demand is averaged over (F-687, F-1516): see
 * `AnalyticsService.daysOnList`. Exported so menu engineering divides a
 * wine's sales by the same days the reorder register does (F-1645).
 */
export function demandDaysOnList(
  listedAt: string | null | undefined,
  rows: Array<{ date: string }>,
  sinceDays: number,
  zone: string | null = null,
  recordsFrom: string | null = null,
  throughYesterday = false,
): number {
  if (!listedAt && !recordsFrom) return sinceDays;
  let first = listedAt
    ? String(listedAt).slice(0, 10)
    : (recordsFrom as string);
  for (const r of rows) if (r.date && r.date < first) first = r.date;
  if (recordsFrom && recordsFrom > first) first = recordsFrom;
  const today = zone ? houseToday(zone) : new Date().toISOString().slice(0, 10);
  // F-1647: a series that ends yesterday counts its days to yesterday.
  const last = throughYesterday
    ? zone
      ? shiftHouseDay(today, -1)
      : new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10)
    : today;
  const days =
    Math.floor((Date.parse(last) - Date.parse(first)) / 86400000) + 1;
  return Number.isFinite(days)
    ? Math.min(sinceDays, Math.max(1, days))
    : sinceDays;
}

/** The house's first recorded sale in a window that holds its whole record (F-1516). */
export function salesRecordedFromOf(
  openedOn: string | null,
  consumption: Array<{ date: string }>,
  sinceDays: number,
): string | null {
  const openedDaysAgo = openedOn
    ? Math.floor(
        (Date.parse(new Date().toISOString().slice(0, 10)) -
          Date.parse(openedOn)) /
          86400000,
      )
    : null;
  let from: string | null = null;
  if (openedDaysAgo != null && openedDaysAgo < sinceDays)
    for (const c of consumption)
      if (c.date && (!from || c.date < from)) from = c.date;
  return from;
}
