import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  HOUSE_ZONE_UNSET,
  houseDayOf,
  houseToday,
  readHouseZone,
  shiftHouseDay,
} from "../common/house-day";
import { readByIds } from "../common/read-by-ids";
import { readConsumptionRows } from "./consumption-read-shared";
import * as E from "./engine";
import {
  FirstRecord,
  MIN_PLAN_DAYS,
  observedWindow,
  readFirstRecord,
  trimToObserved,
  windowWords,
} from "./observed-window";
import { pacingOver, pacingWords, purchasingSpan } from "./purchasing-span";
import { leftOutWords, onRecordedWeekdays } from "./weekdays-recorded";
import { AnalyticsService, SalesGate } from "./analytics.service";
import { InsightGeneratorService } from "./insights/insight-generator.service";
import { GoalsService } from "./goals.service";
import { UncostedOrdersError, orderCostOrNull } from "./order-cost";
import {
  COST_BASIS_LABEL,
  costBasisSentence,
  resolveUnitCost,
  summarizeCostBasis,
} from "./inventory-cost";
import {
  bottlesOf,
  summarizeUnits,
  unitsBasisSentence,
} from "./consumption-units";
import {
  ORDER_ARRIVED_STATUSES,
  ORDER_OPEN_WITH_VENDOR_STATUSES,
  ORDER_OUTSTANDING_STATUSES,
  ORDER_SPEND_STATUSES,
  hasStatus,
} from "../procurement/order-status";
import { deadlineOf, landedVerdict } from "../procurement/delivery-deadline";
import { overdueStanding } from "../procurement/overdue-order";
import { ProcurementOrderStatus } from "../procurement/dto/procurement.dto";
import { readOverdueContext } from "../procurement/overdue-order-reads";
import { HouseFrame, houseFrame } from "../common/house-frame";
import { DataClass } from "../ask-readings/reading-data-classes";
import { insightsForRole, lensHidden } from "./role-reads";

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

  /**
   * The house's first consumption line ever: menu speed and the week's shape
   * start there, not at the window's first day (r36 reports gap 1). Never
   * throws; a failed read falls back to the whole window and says so.
   */
  private async firstConsumption(restaurantId: string): Promise<FirstRecord> {
    const first = await readFirstRecord(
      this.dbService.getClient(),
      "wine_consumption_log",
      restaurantId,
    );
    if (first.read === "could_not_read")
      this.logger.warn(
        `first consumption line could not be read; rates use the whole window: ${first.error}`,
      );
    return first;
  }

  // =========================================================================
  // Shared lean loaders
  // =========================================================================

  /**
   * Read whole or refused, as `AnalyticsService.loadInventory` is (ADR 0292,
   * reports lane r3): unranged, both reads stopped at 1,000 rows. A refusal
   * propagates; both callers read consumption beside it, which already
   * refuses, and the overview turns a throwing lens into a null one.
   */
  private async loadInventoryWithCost(restaurantId: string) {
    const client = this.dbService.getClient();
    const inventory = await readWholeWindow<any>("The house's inventory", () =>
      client
        .from("restaurant_inventory")
        // Same schema-drift fix as AnalyticsService.loadInventory: a single
        // unknown column 42703s the whole PostgREST query.
        .select(
          "id, wine_name, stock_live, menu_price_current, last_purchase_price, master_wine_id, master_wine_library(primary_type)",
          { count: "exact" },
        )
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true),
    );
    const lots = await readByIds<any>(
      "The house's lot totals",
      inventory.map((i: any) => i.id),
      (batch) =>
        client
          .from("inventory_lot_rollup")
          .select(
            // wac_qty / live_qty added 2026-09-02 (ADR 0079) so resolveUnitCost
            // can tell a WAC that covers every on-hand bottle from one that
            // covers a single invoiced bottle in twenty-one.
            "inventory_id, live_qty, wac, has_invoice_cost, wac_qty",
          )
          .eq("restaurant_id", restaurantId)
          .in("inventory_id", batch),
    );
    const rollup = new Map<string, any>();
    for (const r of lots) rollup.set(r.inventory_id, r);
    // Same fix as AnalyticsService.loadInventory: the third branch here was
    // `unitPrice * 0.6`, an undocumented magic number that was the live path
    // for ~70 of 72 production rows while `basis.margin` below called the
    // result "WAC (lot rollup)". See ./inventory-cost.ts.
    return inventory.map((i: any) => {
      const lot = rollup.get(i.id);
      const unitPrice = Number(i.menu_price_current) || 0;
      const { unitCost, costBasis } = resolveUnitCost(i, lot);
      return {
        id: i.id,
        masterWineId: i.master_wine_id,
        name: i.wine_name || i.master_wine_id || i.id,
        type: i.master_wine_library?.primary_type || "unknown",
        qty: lot?.live_qty ?? i.stock_live ?? 0,
        unitCost,
        costBasis,
        unitPrice,
        // A margin computed against an unknown cost is unknown. Defaulting the
        // cost to 0 would report the entire menu price as margin.
        marginPerBottle: unitCost == null ? null : unitPrice - unitCost,
      };
    });
  }

  /**
   * Consumption lines of the last `sinceDays` days, read WHOLE or refused
   * (ADR 0292). The unranged select this replaces stopped at PostgREST's 1,000
   * rows: menu engineering classified the list on 752 of about 8,445 units,
   * and seasonality and Wine 360 read the same slice (A-032, A-033).
   *
   * A refusal (`WholeReadError`, a 503) PROPAGATES. It used to log and return
   * the empty list, which menu engineering, seasonality and Wine 360 then drew
   * as a house that sold nothing. The overview's `allSettled` turns it into a
   * null lens (`getOverview`), as it does for any lens that throws.
   */
  private async loadConsumption(restaurantId: string, sinceDays = 90) {
    let data: any[];
    try {
      // One shared read per (house, window): see consumption-read-shared.ts.
      data = await readConsumptionRows(
        this.dbService.getClient(),
        restaurantId,
        sinceDays,
      );
    } catch (err: any) {
      this.logger.error(
        `analytics query on wine_consumption_log refused — this lens says it ` +
          `could not be read rather than drawing part of the window: ${err?.message ?? err}`,
      );
      throw err;
    }
    // Bottles by each line's own mode (ADR 0297): `quantity` counts
    // servings, so a glass is its millilitres over the item's stated size,
    // and a line with no bottle figure carries null rather than a guess.
    return data.map((c: any) => {
      const { bottles, how } = bottlesOf(c);
      return {
        wineId: c.restaurant_inventory?.master_wine_id ?? null,
        inventoryId: c.inventory_id ?? null,
        qty: bottles,
        how,
        date: (c.created_at || "").substring(0, 10),
        /** The instant, so a lens can file the line on the house's day (ADR 0296). */
        at: (c.created_at as string | null) ?? null,
      };
    });
  }

  /** Wines with at least one line that carries no bottle figure. */
  private uncountedWines(
    consumption: Array<{ wineId: string | null; how: string }>,
  ) {
    const out = new Set<string>();
    for (const c of consumption)
      if (c.wineId && c.how === "uncounted") out.add(c.wineId);
    return out;
  }

  /**
   * The house's clock (ADR 0207 question 6). A failed read degrades like every
   * loader here — to no zone, which the deadline rule answers by counting only
   * verdicts that hold in every zone, never by assuming UTC — and says so in
   * `onTimeDeadline.houseRecord`.
   */
  private async loadHouseFrame(
    restaurantId: string,
  ): Promise<HouseFrame & { read: "read" | "could_not_read" | "no_record" }> {
    const { data, error } = await this.dbService
      .getClient()
      .from("restaurants")
      .select("id, timezone, country")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logQueryFailure("restaurants", error);
      return { ...houseFrame(null), read: "could_not_read" };
    }
    return { ...houseFrame(data), read: data ? "read" : "no_record" };
  }

  /**
   * Purchase orders created OR delivered in the last `sinceDays` days, read
   * WHOLE or refused (ADR 0292, audit G6).
   *
   * The unranged select this replaces stopped at PostgREST's 1,000 rows, and
   * its error was logged and turned into `[]`, so a failed read printed as "no
   * delivered purchase order" on /reports: absence reported as health. A
   * refusal (`WholeReadError`, a 503) now PROPAGATES; the overview's
   * `allSettled` turns it into a null lens, as for consumption.
   *
   * Selected by either date: spend is filed by `delivered_at`, and an order
   * placed before the window and delivered inside it is spend inside it.
   *
   * Schema drift note kept from the old reader: `procurement_orders` has NO
   * provider_name and NO wine_name column; the vendor label comes from the FK
   * embed (supabase/migrations/20260805000000_baseline_from_production.sql).
   */
  private async loadOrders(restaurantId: string, sinceDays = 365) {
    const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
    const client = this.dbService.getClient();
    return readWholeWindow<any>("The purchase orders in this window", () =>
      client
        .from("procurement_orders")
        .select(
          "id, provider_id, providers(name), total_cost, final_price, bottles_total, quantity, created_at, delivered_at, expected_delivery_date, status, cancel_reason_code, cancelled_from_status",
          { count: "exact" },
        )
        .eq("restaurant_id", restaurantId)
        .or(`created_at.gte.${since},delivered_at.gte.${since}`),
    );
  }

  /**
   * The house's first purchase record, of any status: the earlier of its
   * first order placed and its first delivery (a delivery recorded today can
   * be dated last month, and spend is filed on that date). Spend pacing
   * starts there (purchasing-span.ts). Never throws; a failed read falls
   * back to the whole window and the basis says so.
   */
  private async firstOrderAt(
    restaurantId: string,
  ): Promise<{ read: "read"; at: string | null } | { read: "could_not_read" }> {
    const client = this.dbService.getClient();
    // Ascending order puts nulls last, so a delivery date is read when any
    // order has one.
    const earliest = async (column: "created_at" | "delivered_at") => {
      const { data, error } = await client
        .from("procurement_orders")
        .select(column)
        .eq("restaurant_id", restaurantId)
        .order(column, { ascending: true })
        .limit(1);
      if (error) throw error;
      const v = Array.isArray(data) ? data[0]?.[column] : null;
      return v ? String(v) : null;
    };
    try {
      const firsts = (
        await Promise.all([earliest("created_at"), earliest("delivered_at")])
      ).filter((v): v is string => v != null);
      if (firsts.length === 0) return { read: "read", at: null };
      return {
        read: "read",
        at: firsts.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b)),
      };
    } catch (err: any) {
      this.logger.warn(
        `first purchase order could not be read; spend pacing counts the whole window: ${err?.message ?? err}`,
      );
      return { read: "could_not_read" };
    }
  }

  /**
   * The house's zone for a lens that files rows on house days (ADR 0296). A
   * read that fails refuses the lens (503) rather than guessing UTC days.
   */
  private async houseZoneFor(restaurantId: string): Promise<string | null> {
    try {
      return (await readHouseZone(this.dbService.getClient(), restaurantId))
        .zone;
    } catch (err: any) {
      throw new ServiceUnavailableException(
        `${err?.message ?? err}. Nothing is filed on a guessed day.`,
      );
    }
  }

  /**
   * Daily totals over the `days` COMPLETE house days that end yesterday,
   * oldest first. Today is partial, so it is left out, as before.
   */
  private houseDaily(
    rows: Array<{ at: string | null; value: number }>,
    days: number,
    zone: string,
  ): { dates: string[]; values: number[] } {
    const today = houseToday(zone);
    const dates: string[] = [];
    for (let d = days; d >= 1; d--) dates.push(shiftHouseDay(today, -d));
    const byDay = new Map<string, number>();
    for (const r of rows) {
      const day = houseDayOf(r.at, zone);
      if (day) byDay.set(day, (byDay.get(day) || 0) + r.value);
    }
    return { dates, values: dates.map((d) => byDay.get(d) || 0) };
  }

  /**
   * A loader whose rows only label something (the wine types) still degrades
   * to none; the inventory, order and consumption loaders refuse instead, and
   * the overview renders the other lenses around the one that refused. A
   * degraded read must never be SILENT: a query that fails and returns no rows
   * is indistinguishable from one that succeeds with no rows, which is exactly
   * how the provider_name drift above survived unnoticed in production.
   */
  private logQueryFailure(table: string, error: any) {
    this.logger.error(
      `analytics query on ${table} failed — this lens will report empty ` +
        `rather than wrong: ${error?.code ?? "?"} ${error?.message ?? error}`,
    );
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
    const [inventory, consumption, first] = await Promise.all([
      this.loadInventoryWithCost(restaurantId),
      this.loadConsumption(restaurantId, sinceDays),
      this.firstConsumption(restaurantId),
    ]);
    // Sold ÷ the days the house was recording, not ÷ the whole window: a
    // 7-day-old house read every good at a twelfth of its speed and filed
    // it a slow mover (r36 reports gap 1).
    const observed = observedWindow(
      sinceDays,
      new Date().toISOString().substring(0, 10),
      first,
    );
    const soldByWine = new Map<string, number>();
    const standInWines = new Set<string>();
    for (const c of consumption) {
      if (!c.wineId || c.qty == null) continue;
      soldByWine.set(c.wineId, (soldByWine.get(c.wineId) || 0) + c.qty);
      if (c.how === "stand_in") standInWines.add(c.wineId);
    }
    // A wine with any line that carries no bottle figure has no velocity:
    // summing the rest would report it slower than it sold (ADR 0297).
    const unmeasuredWines = this.uncountedWines(consumption);
    const unitsCoverage = summarizeUnits(consumption);
    const priced = inventory.filter((i) => i.unitPrice > 0);
    const costCoverage = summarizeCostBasis(priced);
    const items = priced.map((i) => ({
      id: i.id,
      name: i.name,
      type: i.type,
      velocityPerDay: unmeasuredWines.has(i.masterWineId)
        ? null
        : (soldByWine.get(i.masterWineId) || 0) / observed.rateDays,
      sizeStandIn: standInWines.has(i.masterWineId),
      marginPerBottle: i.marginPerBottle,
      costBasis: i.costBasis,
      marginPct:
        i.unitCost == null ? null : E.grossMargin(i.unitCost, i.unitPrice),
    }));

    const velocities = items
      .map((i) => i.velocityPerDay)
      .filter((v): v is number => v != null);
    // The margin cutoff is a median over the wines that HAVE a margin. Rows
    // with an unknown cost cannot be on either side of it, so they are left
    // unclassified below rather than dragged to one side by a stand-in 0.
    const margins = items
      .map((i) => i.marginPerBottle)
      .filter((m): m is number => m != null);
    const medVel = E.median(velocities) ?? 0;
    const medMargin = margins.length > 0 ? E.median(margins) : null;

    const ACTIONS: Record<string, string> = {
      star: "Protect: keep in stock, feature prominently, never discount.",
      plowhorse:
        "High volume, thin margin: nudge price up or renegotiate cost — small moves scale.",
      puzzle:
        "Great margin, slow mover: feature by-the-glass, staff picks, pairing prompts.",
      dog: "Low volume, low margin: candidate to delist, flight off, or replace.",
    };

    // The quadrant is a two-axis claim. With no cost there is no margin axis,
    // so there is no quadrant and no action — `dog` ("candidate to delist") is
    // not the safe default for a wine we simply never costed.
    const classified = items.map((i) => {
      if (i.marginPerBottle == null || medMargin == null)
        return { ...i, quadrant: null, action: null };
      // Same for the other axis: no bottle figure, no velocity, no quadrant.
      if (i.velocityPerDay == null)
        return { ...i, quadrant: null, action: null };
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

    // `unclassified` stays "no recorded cost"; a costed wine with no bottle
    // figure is `unmeasured`, so neither count claims the other's reason.
    const counts: Record<string, number> = { unclassified: 0, unmeasured: 0 };
    for (const c of classified)
      if (c.marginPerBottle == null || medMargin == null)
        counts.unclassified += 1;
      else if (c.quadrant == null) counts.unmeasured += 1;
      else counts[c.quadrant] = (counts[c.quadrant] || 0) + 1;

    return {
      basis: {
        velocity: `bottles/day ${windowWords(observed, "consumption line")} — ${unitsBasisSentence(unitsCoverage)}`,
        // Was "unit_price − WAC (lot rollup)" unconditionally, for a margin
        // that came from WAC on ~2 rows in 72 and from a fabricated
        // 0.6 × menu price on the rest.
        margin: `menu_price_current − unit cost — ${costBasisSentence(costCoverage)}`,
        costDerived:
          "items[].marginPerBottle, items[].marginPct, items[].quadrant, items[].action and medians.marginPerBottle are null for rows with no recorded cost; those rows are counted under counts.unclassified (ADR 0051)",
        unitsDerived:
          "items[].velocityPerDay, items[].quadrant and items[].action are null for a costed wine with any line that carries no bottle figure; those rows are counted under counts.unmeasured, and medians.velocityPerDay is over the known velocities only (ADR 0297)",
      },
      costCoverage,
      unitsCoverage,
      medians: { velocityPerDay: medVel, marginPerBottle: medMargin },
      counts,
      // Unclassified rows sort after every classified one — ordering them by
      // `velocity × null` would be NaN, and ordering them by velocity alone
      // would interleave them as if they had a known margin of zero.
      items: classified.sort((a, b) => {
        const av =
          a.marginPerBottle == null || a.velocityPerDay == null
            ? null
            : a.velocityPerDay * a.marginPerBottle;
        const bv =
          b.marginPerBottle == null || b.velocityPerDay == null
            ? null
            : b.velocityPerDay * b.marginPerBottle;
        if (av == null || bv == null)
          return (
            (av == null ? 1 : 0) - (bv == null ? 1 : 0) ||
            (a.velocityPerDay == null ? 1 : 0) -
              (b.velocityPerDay == null ? 1 : 0) ||
            (b.velocityPerDay ?? 0) - (a.velocityPerDay ?? 0)
          );
        return bv - av;
      }),
      generatedAt: new Date().toISOString(),
    };
  }

  // =========================================================================
  // 2. Vendor scorecard — lead times, delivery performance, unit prices (#31/34/35)
  // =========================================================================

  async getVendorScorecard(restaurantId: string) {
    const orders = await this.loadOrders(restaurantId, 365);
    const house = await this.loadHouseFrame(restaurantId);
    const nowMs = Date.now();
    // Which orders still out with a vendor are CONFIRMED late — the house
    // answered "Not yet" — or closed with a credit (procurement/overdue-order.ts).
    // A failed read degrades like every loader here, and says so: each order
    // past its date is then `unread`, outside the rate, never guessed late.
    const overdue = await readOverdueContext(
      this.dbService.getClient(),
      restaurantId,
      orders
        .filter((o: any) =>
          hasStatus(o.status, ORDER_OPEN_WITH_VENDOR_STATUSES),
        )
        .map((o: any) => o.id),
    );
    if (!overdue.ok)
      this.logQueryFailure("procurement_order_arrival_answers", {
        message: overdue.reason,
      });
    const byVendor = new Map<string, any[]>();
    for (const o of orders) {
      const key = o.provider_id || "unknown";
      const arr = byVendor.get(key) || [];
      arr.push(o);
      byVendor.set(key, arr);
    }

    const vendors = Array.from(byVendor.entries()).map(([vendorId, os]) => {
      // Timing question: a short delivery still came through the door, so
      // PARTIALLY_RECEIVED counts here. See order-status.ts.
      const delivered = os.filter((o) =>
        hasStatus(o.status, ORDER_ARRIVED_STATUSES),
      );
      const leadTimes = delivered
        .filter((o) => o.delivered_at && o.created_at)
        .map(
          (o) =>
            (new Date(o.delivered_at).getTime() -
              new Date(o.created_at).getTime()) /
            86400000,
        )
        .filter((d) => d >= 0 && d < 120);
      // THE ON-TIME RULE — the one the vendor scorecard reads
      // (procurement/delivery-deadline.ts, ADR 0207): landed before midnight
      // at the end of the expected day on the HOUSE's clock (question 6), and
      // an order still out with the vendor past that midnight is LATE once
      // CONFIRMED — the house answered "Not yet" (question 8 and the founder's
      // delegation of 2026-09-21, procurement/overdue-order.ts). Unanswered it
      // is `unconfirmed`, and 30 days on `incomplete`: both outside the rate.
      // With no zone known, only a verdict that holds in every zone is
      // counted; the rest are `undecided`, outside the rate.
      const counts = {
        onTime: 0,
        late: 0,
        overdue: 0,
        unconfirmed: 0,
        incomplete: 0,
        unread: 0,
        undecided: 0,
        // ADR 0207 round 4 — a never-arrived cancel counts the same as a
        // confirmed-overdue order: late, and named separately so a reader can
        // tell a vendor that missed a live order from one that was cancelled
        // out of a never-arrived state. couldNotSupply/houseDecision/
        // uncategorised are informational only (cancel-reason.ts): they never
        // add to `late`, the same as they are only "listed" in the scorecard.
        neverArrived: 0,
        couldNotSupply: 0,
        houseDecisionCancels: 0,
        uncategorisedCancels: 0,
      };
      for (const o of os) {
        if (o.status === ProcurementOrderStatus.CANCELLED) {
          const from = o.cancelled_from_status as ProcurementOrderStatus | null;
          if (
            from === ProcurementOrderStatus.PENDING ||
            from === ProcurementOrderStatus.APPROVAL_NEEDED
          ) {
            continue; // never placed with the vendor — not a vendor event
          }
          const code = o.cancel_reason_code as string | null;
          if (code === "never_arrived") {
            counts.late += 1;
            counts.neverArrived += 1;
          } else if (code === "vendor_cannot_supply") {
            counts.couldNotSupply += 1;
          } else if (code === "house_decision") {
            counts.houseDecisionCancels += 1;
          } else if (from) {
            // A CANCELLED row that was once placed with the vendor but
            // carries no category — a cancel written before this column
            // existed, or by a path that has not yet been taught it
            // (ADR 0207 §5, the procurement-agent owner's follow-up).
            counts.uncategorisedCancels += 1;
          }
          continue;
        }
        const d = deadlineOf(o.expected_delivery_date, house.zone);
        if (!d) continue;
        if (hasStatus(o.status, ORDER_ARRIVED_STATUSES)) {
          const landed = o.delivered_at ? Date.parse(o.delivered_at) : NaN;
          if (!Number.isFinite(landed)) continue;
          const v = landedVerdict(landed, d);
          if (v === "on_time") counts.onTime += 1;
          else if (v === "late") counts.late += 1;
          else counts.undecided += 1;
        } else if (hasStatus(o.status, ORDER_OPEN_WITH_VENDOR_STATUSES)) {
          const standing = overdueStanding({
            status: o.status,
            expectedDate: o.expected_delivery_date,
            deadline: d,
            nowMs,
            answers: overdue.ok ? (overdue.answers.get(o.id) ?? []) : [],
            closedWithCredit: overdue.ok && overdue.closedWithCredit.has(o.id),
          });
          if (!standing || standing.kind === "not_due") continue;
          if (!overdue.ok) counts.unread += 1;
          else if (standing.kind === "confirmed_late") {
            counts.late += 1;
            counts.overdue += 1;
          } else if (standing.kind === "incomplete") counts.incomplete += 1;
          else counts.unconfirmed += 1;
        }
      }
      const scored = counts.onTime + counts.late;
      // An order with no recorded cost is unknown, never $0 (order-cost.ts).
      // It gives no unit price (a $0 price dragged the mean and the trend
      // down), and the vendor's spend is not summed short over it.
      const unitPrices = delivered
        .map((o) => {
          const bottles = o.bottles_total || o.quantity || 0;
          const cost = orderCostOrNull(o);
          return bottles > 0 && cost != null ? cost / bottles : null;
        })
        .filter((p): p is number => p !== null && Number.isFinite(p));
      const uncostedDelivered = delivered.filter(
        (o) => orderCostOrNull(o) == null,
      ).length;
      const spend =
        uncostedDelivered > 0
          ? null
          : delivered.reduce((s, o) => s + (orderCostOrNull(o) as number), 0);
      return {
        vendorId,
        vendorName: os[0]?.providers?.name || vendorId,
        orders: os.length,
        delivered: delivered.length,
        spend,
        /** Delivered orders with no recorded cost; `spend` is null while any. */
        uncostedDelivered,
        spendUnread:
          uncostedDelivered > 0
            ? new UncostedOrdersError(uncostedDelivered, delivered.length).message
            : null,
        leadTimeDays: {
          mean: E.mean(leadTimes),
          median: E.median(leadTimes),
          p90: E.percentile(leadTimes, 90),
          stdev: E.stdev(leadTimes, true),
          n: leadTimes.length,
        },
        onTimeRate: scored > 0 ? counts.onTime / scored : null,
        onTimeCounts: counts,
        unitPrice: {
          mean: E.mean(unitPrices),
          latest: unitPrices.length ? unitPrices[unitPrices.length - 1] : null,
          trendPerOrderPct: E.trendPerPeriodPct(unitPrices),
        },
      };
    });

    // A vendor whose spend is unknown sorts last, and no share is drawn from
    // a set that holds one: its share would be read as 0.
    vendors.sort((a, b) => (b.spend ?? -1) - (a.spend ?? -1));
    const spendKnown = vendors.every((v) => v.spend != null);
    const spendShare = vendors.map((v) => v.spend as number);
    return {
      vendors,
      onTimeDeadline: {
        zone: house.zone,
        zoneSource: house.zoneSource,
        houseRecord: house.read,
        arrivalAnswers: overdue.ok ? "read" : "could_not_read",
      },
      concentration: spendKnown
        ? {
            hhi: E.herfindahlIndex(spendShare),
            effectiveVendors: E.effectiveCount(spendShare),
          }
        : {
            hhi: null,
            effectiveVendors: null,
            unread:
              "How concentrated buying is cannot be read while a vendor's spend rests on an order with no recorded cost.",
          },
      note: "Lead-time stdev feeds the King safety-stock formula (leadTimeStdev param on /inventory-science).",
      generatedAt: new Date().toISOString(),
    };
  }

  // =========================================================================
  // 3. Seasonality — weekday profile + classical decomposition (#20, #95)
  // =========================================================================

  async getSeasonality(restaurantId: string, sinceDays = 90) {
    // Two extra days are read so the oldest house day is whole in any zone.
    const [all, zone, first] = await Promise.all([
      this.loadConsumption(restaurantId, sinceDays + 2),
      this.houseZoneFor(restaurantId),
      this.firstConsumption(restaurantId),
    ]);
    // Weekdays are the HOUSE's weekdays (ADR 0296, audit G7): on UTC days a
    // US house's evening sales landed on the next weekday. With no zone there
    // is no weekday to file a line on, so nothing is stated, as the till does.
    if (!zone)
      return {
        zoneUnset: true,
        timezone: null,
        weekdayProfile: [],
        bestDay: null,
        worstDay: null,
        tie: false,
        basis: { weekday: HOUSE_ZONE_UNSET, units: null, extremes: null },
        weeklySeasonalFactors: null,
        trendPerDayPct: null,
        generatedAt: new Date().toISOString(),
      };
    const today = houseToday(zone);
    const first = shiftHouseDay(today, -sinceDays);
    const consumption = all.filter((c) => {
      const day = houseDayOf(c.at, zone);
      return day !== null && day >= first && day < today;
    });
    // Counted lines only, zero-filled: a line with no bottle figure is left
    // out, so a day holding one counts only its other lines and reads 0 if
    // it has none. `basis.units` says so in those words (ADR 0297); the day
    // is short, and the basis is what keeps it from passing as a quiet one.
    const unitsCoverage = summarizeUnits(consumption);
    const dense = this.houseDaily(
      consumption
        .filter((c) => c.qty != null)
        .map((c) => ({ at: c.at, value: c.qty as number })),
      sinceDays,
      zone,
    );
    // The window ends yesterday and starts at the house's first line when
    // that is inside it. Zero days before the first line pulled every
    // weekday's mean down and read flat sales as a climb (r36 gap 1).
    // (integ 2026-11-27: #1538's trim on #1037's house days.)
    const observed = observedWindow(
      sinceDays,
      dense.dates[dense.dates.length - 1],
      first,
    );
    const { dates, values } = trimToObserved(dense, observed);

    // A weekday with no line on any of its days is not measured: it is left
    // out of the profile, not read as the quietest (r37 w3 R-F10,
    // weekdays-recorded.ts). The trend below still reads every day.
    // (integ 2026-11-27: #1631 read `byDay`, the UTC-day map #1037 replaced
    // with house days; the recorded set is the house days that hold a line.)
    const recordedDays = new Set(
      consumption
        .filter((c) => c.qty != null)
        .map((c) => houseDayOf(c.at, zone))
        .filter((d): d is string => d != null),
    );
    const measured = onRecordedWeekdays(dates, values, (d) => recordedDays.has(d));
    const weekday = E.dayOfWeekProfile(measured.dates, measured.values);
    // `weekday.best`/`.worst` break an exact tie by weekday order, so a week
    // with no movement reported Sunday as both the busiest and the quietest
    // night. An extreme that is shared is not an extreme (ADR 0020).
    const extremes = E.separableExtremes(weekday.profiles);
    const decomposition = E.seasonalDecompose(values, 7);
    // A trend needs two of each weekday; under that it is the opening
    // fortnight's shape, not a direction, and is withheld.
    const trend28 = observed.young
      ? null
      : E.trendPerPeriodPct(values.slice(-28));

    // The per-category weekday winners (`categoryProfiles`) are gone: no page,
    // agent or tool read them, and they cost an unbounded inventory read whose
    // failure printed as "unknown" (audit G20).
    return {
      zoneUnset: false,
      timezone: zone,
      weekdayProfile: weekday.profiles.map((p) => ({
        day: E.WEEKDAY_NAMES[p.weekday],
        mean: p.mean,
        stdev: p.stdev,
        n: p.n,
      })),
      bestDay: extremes.best ? E.WEEKDAY_NAMES[extremes.best.weekday] : null,
      worstDay: extremes.worst ? E.WEEKDAY_NAMES[extremes.worst.weekday] : null,
      /** True when an extreme is shared, so `bestDay`/`worstDay` are withheld. */
      tie: extremes.tie,
      basis: {
        weekday: `mean bottles per weekday ${observed.since == null && observed.firstRecord !== "could_not_read" ? `over the last ${sinceDays} complete house days in ${zone}` : `${windowWords(observed, "consumption line")} (house days in ${zone})`} of wine_consumption_log; a weekday with no consumption line on any of its days is absent from weekdayProfile rather than reported as 0, and inside a weekday that has one a day with no line counts as 0${leftOutWords(measured.leftOut)}`,
        units: unitsBasisSentence(unitsCoverage, "series"),
        // Names which extreme is withheld, not just that one is (r33 R-F2).
        extremes: E.extremesBasis(extremes, weekday.profiles.length),
        ...(observed.young
          ? {
              trend: `No trend is drawn: the house has ${observed.observedDays} days of records and a trend needs ${MIN_PLAN_DAYS}, two of each weekday.`,
            }
          : {}),
      },
      weeklySeasonalFactors: decomposition
        ? decomposition.seasonal.slice(0, 7)
        : null,
      trendPerDayPct: trend28,
      observed,
      generatedAt: new Date().toISOString(),
    };
  }

  // =========================================================================
  // 4. Cashflow — spend pacing, projection, upcoming exposure (#159/166/193)
  // =========================================================================

  async getCashflow(restaurantId: string) {
    const [orders, zone, firstAt] = await Promise.all([
      this.loadOrders(restaurantId, 182),
      this.houseZoneFor(restaurantId),
      this.firstOrderAt(restaurantId),
    ]);
    // Committed outflow: orders placed but not delivered.
    //
    // This was `["pending", "awaiting_approval", "ordered", "in_transit"]`.
    // `procurement_orders.status` is written from `ProcurementOrderStatus`,
    // which is UPPERCASE and has never had a member called `awaiting_approval`
    // or `ordered` in any casing — so `committedOpenOrders` and
    // `openOrderCount` were a STRUCTURAL ZERO, a number that could not have
    // been anything else, rendered on the cashflow panel as though it had been
    // measured. ADR 0058 fixed the nine `=== "delivered"` sites and the four on
    // `dashboard.service.ts` that carried these exact four literals; this one
    // survived because it is an array `.includes()` rather than a comparison,
    // and `check_order_status_literals.py` only read comparisons. The guard
    // reads this form now too.
    const open = orders.filter((o: any) =>
      hasStatus(o.status, ORDER_OUTSTANDING_STATUSES),
    );
    // An open order with no price yet is not a $0 commitment either.
    const uncostedOpen = open.filter((o: any) => orderCostOrNull(o) == null).length;
    const committed =
      uncostedOpen > 0
        ? null
        : open.reduce((s: number, o: any) => s + (orderCostOrNull(o) as number), 0);

    // The sentence the house reads for each withheld figure: the purchases
    // goal's own (UncostedOrdersError), so the card and the goal agree.
    const unread = (n: number, of: number) =>
      n > 0 ? new UncostedOrdersError(n, of).message : null;

    // Money question: PARTIALLY_RECEIVED carries PO-value columns, not
    // received-value ones, so it is excluded here. See order-status.ts.
    const delivered = orders.filter((o: any) =>
      hasStatus(o.status, ORDER_SPEND_STATUSES),
    );
    // An order with no recorded cost is unknown, never $0 (order-cost.ts, the
    // rule the purchases goal scores by). Each figure whose window holds an
    // uncosted order is withheld, with the count; a window with none is still
    // summed. (integ 2026-11-27: #1173's rule on #1037's house-day filing.)
    const uncostedCount = delivered.filter((o: any) => orderCostOrNull(o) == null).length;
    const uncostedNote =
      uncostedCount > 0
        ? uncostedCount === 1
          ? "1 delivered order carries no cost, so a figure whose window holds it is withheld."
          : `${uncostedCount} delivered orders carry no cost, so a figure whose window holds one is withheld.`
        : null;
    const countIn = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

    // Spend is filed on the HOUSE's day it was delivered (ADR 0296, audit G7).
    // With no zone no day can be filed, so no spend figure is stated; what is
    // committed is not a day figure and still is.
    if (!zone)
      return {
        zoneUnset: true,
        timezone: null,
        basis: { outflow: HOUSE_ZONE_UNSET, uncosted: uncostedNote },
        spendLast30d: null,
        spendPrev30d: null,
        paceDeltaPct: null,
        projectedNext4Weeks: null,
        committedOpenOrders: committed,
        openOrderCount: open.length,
        uncostedOrders: { last30d: null, prev30d: null, window180d: null, open: uncostedOpen },
        unread: {
          spendLast30d: null,
          spendPrev30d: null,
          projectedNext4Weeks: null,
          committedOpenOrders:
            uncostedOpen > 0
              ? `${uncostedOpen} of the ${open.length} open order${open.length === 1 ? "" : "s"} ${uncostedOpen === 1 ? "carries" : "carry"} no price yet, so what is committed is not summed short. Record the price to read it.`
              : null,
        },
        generatedAt: new Date().toISOString(),
      };

    const dated = delivered.map((o: any) => ({
      at: o.delivered_at || o.created_at || null,
      cost: orderCostOrNull(o),
    }));
    const { dates, values: daily } = this.houseDaily(
      dated
        .filter((r) => r.cost != null)
        .map((r) => ({ at: r.at, value: Number(r.cost) })),
      180,
      zone,
    );
    const { values: uncostedDaily } = this.houseDaily(
      dated.filter((r) => r.cost == null).map((r) => ({ at: r.at, value: 1 })),
      180,
      zone,
    );
    const { values: deliveredDaily } = this.houseDaily(
      dated.map((r) => ({ at: r.at, value: 1 })),
      180,
      zone,
    );
    const uncosted = {
      last30d: countIn(uncostedDaily.slice(-30)),
      prev30d: countIn(uncostedDaily.slice(-60, -30)),
      window180d: countIn(uncostedDaily),
    };

    // The window starts at the house's first purchase order (r36 gap 1):
    // days before it are unknown, not days without buying. The pace needs two
    // full 30-day windows of records; the Holt projection runs on complete
    // weeks inside the records, newest-aligned to yesterday (audit G8), and
    // needs four. See purchasing-span.ts. On top of that, a window that holds
    // an order with no recorded cost is withheld (order-cost.ts); the
    // projection reads every week of the 180 days, so one uncosted order
    // anywhere in them withholds it. (integ 2026-11-27: #1616 + #1173.)
    const span = purchasingSpan(
      dates,
      firstAt.read === "read"
        ? { read: "read", day: houseDayOf(firstAt.at, zone) }
        : { read: "could_not_read", day: null },
    );
    const paced = pacingOver(daily, span);
    const last30 = uncosted.last30d > 0 ? null : paced.spendLast30d;
    const prev30 = uncosted.prev30d > 0 ? null : paced.spendPrev30d;
    const paceDeltaPct = last30 == null || prev30 == null ? null : paced.paceDeltaPct;
    const projection = uncosted.window180d === 0 ? paced.projectedNext4Weeks : null;
    const spanWords =
      paced.projectedNext4Weeks != null && projection == null
        ? `${pacingWords(span, paced)}; the projection is withheld: an order in these 180 days carries no recorded cost`
        : pacingWords(span, paced);

    return {
      zoneUnset: false,
      timezone: zone,
      basis: {
        outflow: `delivered procurement_orders, filed on the house's day in ${zone} each was delivered (revenue inflow needs POS feed); ${spanWords}`,
        uncosted: uncostedNote,
      },
      spendLast30d: last30,
      spendPrev30d: prev30,
      paceDeltaPct,
      projectedNext4Weeks: projection,
      committedOpenOrders: committed,
      openOrderCount: open.length,
      /**
       * Orders with no recorded cost, by the window they fall in. A figure
       * whose window holds one is null, and `unread` says why in the house's
       * words (null where the figure was summed whole).
       */
      uncostedOrders: { ...uncosted, open: uncostedOpen },
      unread: {
        spendLast30d: unread(uncosted.last30d, countIn(deliveredDaily.slice(-30))),
        spendPrev30d: unread(uncosted.prev30d, countIn(deliveredDaily.slice(-60, -30))),
        projectedNext4Weeks: unread(uncosted.window180d, countIn(deliveredDaily)),
        committedOpenOrders:
          uncostedOpen > 0
            ? `${uncostedOpen} of the ${open.length} open order${open.length === 1 ? "" : "s"} ${uncostedOpen === 1 ? "carries" : "carry"} no price yet, so what is committed is not summed short. Record the price to read it.`
            : null,
      },
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
    // A wine with any line that carries no bottle figure has no demand: its
    // counted lines alone would understate it (ADR 0297). Every figure that
    // rests on demand goes null with it, and the basis says why.
    const myUnits = summarizeUnits(mine);
    const daily = this.toDaily(
      mine
        .filter((c) => c.qty != null)
        .map((c) => ({ date: c.date, value: c.qty as number })),
      90,
    );
    const profile = myUnits.complete ? E.demandProfile(daily) : null;
    const unmeasured = this.uncountedWines(consumption);
    const totals = new Map<string, number>();
    for (const c of consumption)
      if (c.wineId && c.qty != null && !unmeasured.has(c.wineId))
        totals.set(c.wineId, (totals.get(c.wineId) || 0) + c.qty);
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
      // This endpoint carried no `basis` at all, so `unitCost` arrived with no
      // way to tell an invoiced number from the 0.6 × menu price fabrication.
      basis: {
        demand: `bottles/day over 90d — ${unitsBasisSentence(myUnits)}`,
        unitCost: item
          ? `${COST_BASIS_LABEL[item.costBasis]}${item.unitCost == null ? " — unitCost and marginPerBottle are null (ADR 0051)" : ""}`
          : "wine not found in active inventory",
        unitPrice: "restaurant_inventory.menu_price_current",
      },
      onHand: item?.qty ?? null,
      unitPrice: item?.unitPrice ?? null,
      unitCost: item?.unitCost ?? null,
      costBasis: item?.costBasis ?? null,
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
      forecast14d: myUnits.complete ? forecast.totalForecastDemand : null,
      forecastModel: myUnits.complete ? forecast.model : null,
      trendPerDayPct: myUnits.complete
        ? E.trendPerPeriodPct(daily.slice(-28))
        : null,
      generatedAt: new Date().toISOString(),
    };
  }

  // =========================================================================
  // 6. Overview — every lens in one call (API-bus pattern, #207)
  // =========================================================================

  /**
   * `sees` is the caller's ROLE_POLICY row (ADR 0348 decision 3). A lens of a
   * class it does not see is not read, and answers `withheldForRole` in its
   * place, so `null` keeps meaning "the lens failed". Omitted, the overview
   * reads as the full row (the internal callers: the digest and MCP).
   */
  async getOverview(
    restaurantId: string,
    gate: SalesGate = {},
    sees?: readonly DataClass[],
  ) {
    const startedAt = Date.now();
    const menuHidden = sees ? lensHidden("menuEngineering", sees) : [];
    const cashHidden = sees ? lensHidden("cashflow", sees) : [];
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
      this.analyticsService.getFinancialSummary(restaurantId, 0, gate),
      this.analyticsService.getRiskProfile(restaurantId, gate),
      this.analyticsService.getInventoryScience(restaurantId),
      menuHidden.length ? null : this.getMenuEngineering(restaurantId),
      this.getSeasonality(restaurantId),
      cashHidden.length ? null : this.getCashflow(restaurantId),
      this.insightGenerator.getStored(restaurantId, { limit: 8 }),
      this.goalsService.listGoals(restaurantId, "active", gate),
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
      menuEngineering: menuHidden.length
        ? { withheldForRole: menuHidden }
        : menuFull
          ? { counts: menuFull.counts, top: menuFull.items?.slice(0, 5) }
          : null,
      seasonality: ok(seasonality),
      cashflow: cashHidden.length
        ? { withheldForRole: cashHidden }
        : ok(cashflow),
      insights: sees
        ? insightsForRole(ok(insights) ?? [], sees).kept
        : (ok(insights) ?? []),
      // Each goal carries its metric's unit, so a page prints a baseline as
      // money, a percent or days rather than a bare number. A key outside the
      // catalogue says no unit (null) instead of borrowing one.
      activeGoals: (ok(goals) ?? []).map((g: any) => ({
        ...g,
        unit: GoalsService.SUPPORTED_METRICS[g?.metric_key]?.unit ?? null,
      })),
      computedIn: Date.now() - startedAt,
      generatedAt: new Date().toISOString(),
    };
  }
}
