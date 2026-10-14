import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { readForKeys, readWholeWindow } from "../common/read-whole-window";
import * as E from "./engine";
import {
  AnalyticsService,
  demandDaysOnList,
  isRecipePour,
  salesRecordedFromOf,
} from "./analytics.service";
import { readCurrentMenuStockLinks } from "../menus/current-menu-lines";
import { InsightGeneratorService } from "./insights/insight-generator.service";
import { GoalsService } from "./goals.service";
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
  ORDER_CLOSED_STATUSES,
  ORDER_OPEN_WITH_VENDOR_STATUSES,
  ORDER_OUTSTANDING_STATUSES,
  ORDER_SPEND_STATUSES,
  hasStatus,
  toPostgrestInList,
} from "../procurement/order-status";
import { deadlineOf, landedVerdict } from "../procurement/delivery-deadline";
import { overdueStanding } from "../procurement/overdue-order";
import { ProcurementOrderStatus } from "../procurement/dto/procurement.dto";
import { readOverdueContext } from "../procurement/overdue-order-reads";
import {
  namedCurrencies,
  orderSpend,
  sumOrderSpend,
} from "../procurement/order-spend";
import {
  mixedSpendNote,
  spendByCurrency,
} from "../dashboard/dashboard.service";
import { HouseFrame, houseFrame } from "../common/house-frame";
import {
  HOUSE_ZONE_UNSET,
  houseDayBounds,
  houseDayOf,
  houseToday,
  readHouseZone,
  shiftHouseDay,
} from "../common/house-day";
import { beverageCategoryOf } from "../common/beverage-category";
import {
  confirmedPourFrom,
  confirmedWinePourFrom,
  readHouseTargetMargin,
} from "../pricing/target-margin.service";
import {
  COST_NOT_PRE_TAX_SENTENCE,
  costTaxProof,
  readAdviceTaxTerms,
  wineTaxRate,
  type AdviceTaxTerms,
  type CostTaxProof,
  type InventoryPriceRow,
} from "../pricing/margin-advice.service";
import { DayExclusionsService } from "./insights/day-exclusions.service";

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
/**
 * Why an open orders' value is null rather than a sum (F-1042): they were
 * placed in more than one currency. Null when there is one figure to give.
 * Not yet paid, so "ordered in", where `mixedSpendNote` says "paid in".
 */
function orderedInTwoNote(
  orders: any[],
  houseCurrency: string | null = null,
): string | null {
  const codes = namedCurrencies(
    orders.filter((o) => orderSpend(o) != null),
    houseCurrency,
  );
  return codes.length > 1
    ? `Ordered in ${codes.join(" and ")}: with no exchange rate on record these cannot be added into one figure.`
    : null;
}

/** What menu engineering says of its margins for a house whose prices include tax (F-1587). */
export const PRE_TAX_MARGIN_BASIS =
  "Your till prices include tax, so margin is worked out on the price without tax, price ÷ (1 + the wine's tax rate), and only on a cost recorded without tax; a wine without both has no margin and says why (items[].marginRefusal, counted under counts.taxRefused)";

/**
 * What menu engineering says when the house's tax basis could not be read
 * (F-1626): every margin is still refused, but the house is not told its
 * prices include tax, which nobody read.
 */
export const TAX_BASIS_UNREAD =
  "Whether your till prices include tax could not be read, so no margin is worked out until it can be; nothing here says they do (items[].marginRefusal, counted under counts.taxRefused)";

/**
 * A wine's margin for a house whose till prices include tax (F-1587, ADR 0341
 * §6): margin advice's rule, read once more. The price is taken without tax
 * at the wine's rate in force today, and the cost must be proven without tax;
 * anything else is no margin, with the advice's own reason. A basis that
 * could not be read refuses every margin rather than show one on a basis
 * nobody read.
 */
export function preTaxMargin(
  i: {
    id: string;
    unitCost: number | null;
    unitPrice: number;
    costTax: CostTaxProof;
  },
  terms: AdviceTaxTerms | null,
  readError: string | null,
): {
  marginPerBottle: number | null;
  marginPct: number | null;
  marginRefusal: string | null;
} {
  const refuse = (reason: string) => ({
    marginPerBottle: null,
    marginPct: null,
    marginRefusal: reason.replace(/^Cannot advise: /, "No margin: "),
  });
  if (i.unitCost == null)
    return { marginPerBottle: null, marginPct: null, marginRefusal: null };
  if (terms === null)
    return refuse(
      `No margin: whether this house's prices include tax could not be read, so no margin is worked out (${readError ?? "no answer"}).`,
    );
  const rate = wineTaxRate(terms, i.id);
  if ("reason" in rate) return refuse(rate.reason);
  if (i.costTax !== "pre_tax")
    return refuse(COST_NOT_PRE_TAX_SENTENCE[i.costTax]);
  const net = i.unitPrice / (1 + rate.rate);
  return {
    marginPerBottle: net - i.unitCost,
    marginPct: E.grossMargin(i.unitCost, net),
    marginRefusal: null,
  };
}

@Injectable()
export class AdvancedAnalyticsService {
  private readonly logger = new Logger(AdvancedAnalyticsService.name);

  constructor(
    private readonly dbService: DatabaseService,
    private readonly analyticsService: AnalyticsService,
    private readonly insightGenerator: InsightGeneratorService,
    private readonly goalsService: GoalsService,
    // Defaulted so the specs that build this service by hand keep working;
    // Nest injects the module's instance (analytics.module.ts).
    private readonly dayExclusions: DayExclusionsService = new DayExclusionsService(
      dbService,
    ),
  ) {}

  // =========================================================================
  // Shared lean loaders
  // =========================================================================

  private async loadInventoryWithCost(restaurantId: string) {
    const client = this.dbService.getClient();
    // F-1214: read WHOLE or refused, as AnalyticsService.loadInventory is.
    // Unranged, menu engineering and the overview saw 1,000 wines of a larger
    // list, and a failed read became an empty one. A refusal propagates; the
    // overview's `allSettled` turns it into a null lens.
    const [inventory, [houseRes]] = await Promise.all([
      readWholeWindow<any>("The cellar's wines", () =>
        client
          .from("restaurant_inventory")
          // Same schema-drift fix as AnalyticsService.loadInventory: a single
          // unknown column 42703s the whole PostgREST query.
          .select(
            "id, wine_name, created_at, stock_live, menu_price_current, menu_price_glass, last_purchase_price, last_purchase_price_tax_basis, bottle_size_ml, pour_size_ml, pour_size_confirmed_by, pour_size_confirmed_at, master_wine_id, master_wine_library(primary_type, bottle_size_ml)",
            { count: "exact" },
          )
          .eq("restaurant_id", restaurantId)
          .eq("is_active", true),
      ),
      // The house's stated currency: its menu prices are in it, and a cost in
      // other money is not set against them (F-343).
      Promise.allSettled([
        client
          .from("restaurants")
          .select("currency")
          .eq("id", restaurantId)
          .maybeSingle(),
      ]),
    ]);
    if (houseRes.status === "fulfilled" && houseRes.value.error)
      this.logQueryFailure("restaurants", houseRes.value.error);
    // Unread or unstated, the house's money is null and a lot is read as before.
    const houseCurrency =
      houseRes.status === "fulfilled"
        ? (houseRes.value.data?.currency ?? null)
        : null;
    // The lot totals of these wines, a slice at a time (the view has no `id`).
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
            // wac_pre_tax_qty / wac_tax_included_qty (F-1587): whether tax is inside it.
            "inventory_id, live_qty, wac, has_invoice_cost, wac_qty, cost_currency, cost_currency_count, wac_pre_tax_qty, wac_tax_included_qty",
            { count: "exact" },
          )
          .eq("restaurant_id", restaurantId)
          .in("inventory_id", slice),
    );
    const rollup = new Map<string, any>();
    for (const r of rollupRows) rollup.set(r.inventory_id, r);
    // Same fix as AnalyticsService.loadInventory: the third branch here was
    // `unitPrice * 0.6`, an undocumented magic number that was the live path
    // for ~70 of 72 production rows while `basis.margin` below called the
    // result "WAC (lot rollup)". See ./inventory-cost.ts.
    return inventory.map((i: any) => {
      const lot = rollup.get(i.id);
      const unitPrice = Number(i.menu_price_current) || 0;
      const { unitCost, costBasis } = resolveUnitCost(i, lot, houseCurrency);
      return {
        id: i.id,
        masterWineId: i.master_wine_id,
        name: i.wine_name || i.master_wine_id || i.id,
        type: i.master_wine_library?.primary_type || "unknown",
        // F-1645: the day the wine went on the list, as the reorder register reads it.
        listedAt: (i.created_at as string | null | undefined) ?? null,
        qty: lot?.live_qty ?? i.stock_live ?? 0,
        unitCost,
        costBasis,
        // F-1587: whether that cost is proven without tax, by the advice's rule.
        costTax: costTaxProof(
          costBasis,
          i as InventoryPriceRow,
          lot ?? null,
          null,
        ),
        unitPrice,
        // Read for menu engineering (F-472): a wine sold only by the glass has
        // no bottle price, and its glass price needs a confirmed pour.
        glassPrice: Number(i.menu_price_glass) || 0,
        bottleMl:
          Number(i.bottle_size_ml) ||
          Number(i.master_wine_library?.bottle_size_ml) ||
          null,
        winePourMl: confirmedWinePourFrom(i),
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
  private async loadConsumption(
    restaurantId: string,
    sinceDays = 90,
    // `zone` files each line on the house's day (ADR 0296) instead of its
    // UTC date; `sinceIso` starts the read at that day's own midnight.
    house: { zone?: string; sinceIso?: string } = {},
  ) {
    const since =
      house.sinceIso ??
      new Date(Date.now() - sinceDays * 86400000).toISOString();
    const client = this.dbService.getClient();
    let data: any[];
    try {
      data = await readWholeWindow<any>(
        "The consumption lines in this window",
        () =>
          client
            .from("wine_consumption_log")
            // No master_wine_id column on this table — resolve via the inventory FK.
            .select(
              // F-1666: source, notes, wine_name and total_revenue tell a
              // pour into a cocktail from a sale (isRecipePour, F-1492).
              "id, inventory_id, consumption_type, quantity, volume_ml, created_at, source, notes, wine_name, total_revenue, restaurant_inventory(master_wine_id, bottle_size_ml)",
              { count: "exact" },
            )
            .eq("restaurant_id", restaurantId)
            // F-1197: a sale the till voided or corrected down is marked
            // reversed (never a negative row); it is not demand.
            .is("reversed_at", null)
            .gte("created_at", since),
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
        // F-1666: a pour the till took for a cocktail's recipe (F-1329); its
        // price is the cocktail's, so it is not a sale of this drink.
        recipePour: isRecipePour(c),
        date: house.zone
          ? (houseDayOf(c.created_at ?? null, house.zone) ?? "")
          : (c.created_at || "").substring(0, 10),
      };
    });
  }

  /**
   * Wines with at least one line that carries no bottle figure, by master wine
   * — or, with `byItem`, by house item (the ledger's key, ADR 0115), which
   * every drink has and a rakı or a beer has no master wine for (F-1014).
   */
  private uncountedWines(
    consumption: Array<{
      wineId: string | null;
      inventoryId: string | null;
      how: string;
    }>,
    byItem = false,
  ) {
    const out = new Set<string>();
    for (const c of consumption) {
      const key = byItem ? c.inventoryId : c.wineId;
      if (key && c.how === "uncounted") out.add(key);
    }
    return out;
  }

  /**
   * The house's clock (ADR 0207 question 6). A failed read degrades like every
   * loader here — to no zone, which the deadline rule answers by counting only
   * verdicts that hold in every zone, never by assuming UTC — and says so in
   * `onTimeDeadline.houseRecord`. `currency` is the house's stated money
   * (upper-cased; null when unread or unstated): an order naming no currency
   * is in it (F-1088, as F-1052).
   */
  private async loadHouseFrame(restaurantId: string): Promise<
    HouseFrame & {
      currency: string | null;
      read: "read" | "could_not_read" | "no_record";
    }
  > {
    const { data, error } = await this.dbService
      .getClient()
      .from("restaurants")
      .select("id, timezone, country, currency")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logQueryFailure("restaurants", error);
      return { ...houseFrame(null), currency: null, read: "could_not_read" };
    }
    const code = data?.currency;
    return {
      ...houseFrame(data),
      currency:
        typeof code === "string" && code.trim()
          ? code.trim().toUpperCase()
          : null,
      read: data ? "read" : "no_record",
    };
  }

  /**
   * Orders of the last `sinceDays` days, read WHOLE or refused (ADR 0292,
   * F-186). The unranged select this replaces stopped at PostgREST's 1,000
   * rows, and a failed read came back as `[]`, so cashflow and the vendor
   * scorecard drew a house that bought nothing. A refusal now propagates, as
   * `loadConsumption`'s does: the overview turns it into a null lens and the
   * page says the register could not be read.
   */
  private async loadOrders(restaurantId: string, sinceDays = 365) {
    const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
    const client = this.dbService.getClient();
    // Same schema-drift class as loadInventory above. `procurement_orders` has
    // NO provider_name and NO wine_name column (see
    // supabase/migrations/20260805000000_baseline_from_production.sql:4514-4568)
    // — it carries provider_id → providers(id) and inventory_id →
    // restaurant_inventory(id). Naming either one 42703s the WHOLE PostgREST
    // query, and the discarded `error` below turned that into an empty order
    // list, so getVendorScorecard and getCashflow returned zeroes for every
    // restaurant, forever. The vendor label comes from the FK embed instead;
    // wine_name was selected but never read, so it is simply gone.
    try {
      return await readWholeWindow<any>("The orders in this window", () =>
        client
          .from("procurement_orders")
          .select(
            "id, provider_id, providers(name), total_cost, currency, final_price, bottles_total, quantity, created_at, delivered_at, expected_delivery_date, status, cancel_reason_code, cancelled_from_status, source",
            { count: "exact" },
          )
          .eq("restaurant_id", restaurantId)
          .gte("created_at", since),
      );
    } catch (err: any) {
      this.logger.error(
        `analytics query on procurement_orders refused — this lens says it ` +
          `could not be read rather than drawing part of the window: ${err?.message ?? err}`,
      );
      throw err;
    }
  }

  /**
   * Spend pacing's two reads (F-1146). The paid-out days are filed by
   * `delivered_at`, so the delivered orders are windowed on `delivered_at`,
   * as COGS-365 and the purchase-spend goal are: a March en-primeur
   * delivered in October is October's spend. Orders still open are read by
   * status with no date window, so a backorder or a futures order placed
   * more than 180 days ago stays in Committed and Open orders. Both are read
   * whole or refused, as `loadOrders` is.
   */
  private async loadCashflowOrders(restaurantId: string, sinceDays: number) {
    const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
    const client = this.dbService.getClient();
    const columns =
      "id, provider_id, providers(name), total_cost, currency, final_price, bottles_total, quantity, created_at, delivered_at, expected_delivery_date, status, cancel_reason_code, cancelled_from_status";
    try {
      const [delivered, unclosed] = await Promise.all([
        readWholeWindow<any>("The delivered orders in this window", () =>
          client
            .from("procurement_orders")
            .select(columns, { count: "exact" })
            .eq("restaurant_id", restaurantId)
            .in("status", ORDER_SPEND_STATUSES)
            .gte("delivered_at", since),
        ),
        readWholeWindow<any>("The orders still open", () =>
          client
            .from("procurement_orders")
            .select(columns, { count: "exact" })
            .eq("restaurant_id", restaurantId)
            .not("status", "in", toPostgrestInList(ORDER_CLOSED_STATUSES)),
        ),
      ]);
      return { delivered, unclosed };
    } catch (err: any) {
      this.logger.error(
        `analytics query on procurement_orders refused — this lens says it ` +
          `could not be read rather than drawing part of the window: ${err?.message ?? err}`,
      );
      throw err;
    }
  }

  /**
   * A failed loader still degrades to `[]` — an analytics page that 500s
   * because one lens is unavailable is worse than one that renders the rest.
   * But it must never do so SILENTLY: a query that fails and returns no rows
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
    /** With a zone, the days end at the house's yesterday (ADR 0296). */
    zone: string | null = null,
  ): number[] {
    const byDay = new Map<string, number>();
    for (const r of rows)
      if (r.date) byDay.set(r.date, (byDay.get(r.date) || 0) + r.value);
    const values: number[] = [];
    const today = new Date();
    const houseDay = zone ? houseToday(zone, today) : null;
    for (let d = days; d >= 1; d--) {
      const day = houseDay
        ? shiftHouseDay(houseDay, -d)
        : new Date(today.getTime() - d * 86400000)
            .toISOString()
            .substring(0, 10);
      values.push(byDay.get(day) || 0);
    }
    return values;
  }

  // =========================================================================
  // 1. Menu engineering — Stars / Plowhorses / Puzzles / Dogs  (#124, #301)
  // =========================================================================

  /** F-1645: fewer days of sales than this give a wine no quadrant. */
  static readonly MENU_MIN_DAYS = 7;

  /**
   * F-1645: the house's zone and the day it was set up here, for the days a
   * wine's sales are averaged over. Unread, the zone is UTC's and the house's
   * age unknown, so every wine keeps its own days on the list.
   */
  private async readHouseDays(
    restaurantId: string,
  ): Promise<{ zone: string | null; openedOn: string | null }> {
    try {
      const { data, error } = await this.dbService
        .getClient()
        .from("restaurants")
        .select("timezone, country, created_at")
        .eq("id", restaurantId)
        .maybeSingle();
      if (error) throw error;
      const opened =
        typeof data?.created_at === "string"
          ? data.created_at.slice(0, 10)
          : "";
      return {
        zone: houseFrame(data ?? null).zone,
        openedOn: /^\d{4}-\d{2}-\d{2}$/.test(opened) ? opened : null,
      };
    } catch (err: any) {
      this.logQueryFailure("restaurants", err);
      return { zone: null, openedOn: null };
    }
  }

  /**
   * F-1667: the stock links of the house's live menus, or null when they
   * could not be read (the register then keeps every wine and says so).
   */
  private async loadMenuStockLinks(restaurantId: string) {
    try {
      return await readCurrentMenuStockLinks(
        this.dbService.getClient(),
        restaurantId,
      );
    } catch (err: any) {
      this.logger.error(
        `menu engineering could not read the live menus' lines, so every priced wine is placed and the register says so: ${err?.message ?? err}`,
      );
      return null;
    }
  }

  async getMenuEngineering(restaurantId: string, sinceDays = 90) {
    const { zone, openedOn } = await this.readHouseDays(restaurantId);
    const [stock, allLines, house, tax, menuLinks] = await Promise.all([
      this.loadInventoryWithCost(restaurantId),
      this.loadConsumption(restaurantId, sinceDays, zone ? { zone } : {}),
      readHouseTargetMargin(this.dbService.getClient(), restaurantId),
      // F-1587: the house's tax basis, as margin advice reads it.
      readAdviceTaxTerms(this.dbService.getClient(), restaurantId, null),
      this.loadMenuStockLinks(restaurantId),
    ]);
    // F-1667: the list is what is on the house's live menus. A wine taken off
    // every menu (a discarded line leaves its stock row's price as it was)
    // or a reserve bottle never listed is not filed in a quadrant, does not
    // move the medians, and is named apart under `offMenu`. A house with no
    // live menu has no other list than its priced stock, and a failed read
    // keeps every wine and says so (`menuStanding`), never a shorter list.
    const menuStanding: "on_menu" | "no_current_menu" | "unread" =
      menuLinks === null
        ? "unread"
        : menuLinks.currentMenus === 0
          ? "no_current_menu"
          : "on_menu";
    const offMenu: Array<{ id: string; name: string }> = [];
    const inventory =
      menuStanding === "on_menu" && menuLinks
        ? stock.filter((i) => {
            const on =
              menuLinks.inventoryIds.has(i.id) ||
              (i.masterWineId != null && menuLinks.wineIds.has(i.masterWineId));
            if (!on && (i.unitPrice > 0 || i.glassPrice > 0))
              offMenu.push({ id: i.id, name: i.name });
            return on;
          })
        : stock;
    // F-1666: a pour the till took for a cocktail's recipe is not a sale of
    // the drink poured: its price is the cocktail's, and the margin here is
    // the drink's own bottle or glass price. Counted as the gin's movement it
    // filed a Negroni gin a Star or a Plowhorse and sent "raise those prices"
    // at the gin's own price. Those pours are left out of velocity, and each
    // wine says how many bottles went into cocktails (`pouredIntoCocktails`).
    const consumption = allLines.filter((c) => !c.recipePour);
    const cocktailBottles = new Map<string, number>();
    let cocktailPours = 0;
    for (const c of allLines) {
      if (!c.recipePour || !c.inventoryId) continue;
      cocktailPours++;
      if (c.qty != null)
        cocktailBottles.set(
          c.inventoryId,
          (cocktailBottles.get(c.inventoryId) || 0) + c.qty,
        );
    }
    if (house.error) this.logQueryFailure("restaurants", house.error);
    // Only a house whose till prices include tax, or one whose basis could
    // not be read, changes here; every other house is as before, key for key.
    const taxed = tax.terms !== null || tax.error !== null;
    const housePourMl = confirmedPourFrom(house.row);
    // Sales per house item, the ledger's key (ADR 0115): keyed by master
    // wine, a drink that is not a wine read zero velocity — a Dog (F-1014).
    //
    // F-1645: each wine's sales are averaged over the days it has been on the
    // list, from the house's first recorded sale, ending yesterday: the
    // reorder register's window (F-687, F-1516, F-1647). A fixed 90 days read
    // a 9-day house's wines ten times too slow.
    const today = zone
      ? houseToday(zone)
      : new Date().toISOString().slice(0, 10);
    // The house's first recorded line counts a cocktail's pour: it was trading.
    const recordsFrom = salesRecordedFromOf(openedOn, allLines, sinceDays);
    const soldByWine = new Map<string, number>();
    const saleDaysByWine = new Map<string, Array<{ date: string }>>();
    const standInWines = new Set<string>();
    for (const c of consumption) {
      if (!c.inventoryId || c.qty == null) continue;
      if (c.date >= today) continue;
      const days = saleDaysByWine.get(c.inventoryId) || [];
      days.push({ date: c.date });
      saleDaysByWine.set(c.inventoryId, days);
      soldByWine.set(
        c.inventoryId,
        (soldByWine.get(c.inventoryId) || 0) + c.qty,
      );
      if (c.how === "stand_in") standInWines.add(c.inventoryId);
    }
    // A wine with any line that carries no bottle figure has no velocity:
    // summing the rest would report it slower than it sold (ADR 0297).
    const unmeasuredWines = this.uncountedWines(consumption, true);
    const unitsCoverage = summarizeUnits(consumption);
    // The price a bottle earns: its bottle price, or, for a wine with none,
    // its glass price times the glasses a bottle pours at the CONFIRMED pour
    // (F-472). Velocity is bottles a day, so both axes stay per bottle. A wine
    // with neither is left out BY NAME, never dropped without a word.
    const leftOut: Array<{
      id: string;
      name: string;
      reason: "no_price" | "glass_pour_unconfirmed";
    }> = [];
    const priced: Array<
      (typeof inventory)[number] & { priceBasis: "bottle" | "glass" }
    > = [];
    for (const i of inventory) {
      if (i.unitPrice > 0) {
        priced.push({ ...i, priceBasis: "bottle" });
        continue;
      }
      if (!(i.glassPrice > 0)) {
        leftOut.push({ id: i.id, name: i.name, reason: "no_price" });
        continue;
      }
      const pourMl = i.winePourMl ?? housePourMl;
      if (pourMl == null || i.bottleMl == null) {
        leftOut.push({
          id: i.id,
          name: i.name,
          reason: "glass_pour_unconfirmed",
        });
        continue;
      }
      const unitPrice = (i.glassPrice * i.bottleMl) / pourMl;
      priced.push({
        ...i,
        unitPrice,
        priceBasis: "glass",
        marginPerBottle: i.unitCost == null ? null : unitPrice - i.unitCost,
      });
    }
    const costCoverage = summarizeCostBasis(priced);
    const items = priced.map((i) => {
      const m = taxed
        ? preTaxMargin(i, tax.terms, tax.error)
        : {
            marginPerBottle: i.marginPerBottle,
            marginPct:
              i.unitCost == null
                ? null
                : E.grossMargin(i.unitCost, i.unitPrice),
          };
      const velocityDays = demandDaysOnList(
        i.listedAt,
        saleDaysByWine.get(i.id) || [],
        sinceDays,
        zone,
        recordsFrom,
        true,
      );
      return {
        id: i.id,
        name: i.name,
        type: i.type,
        velocityPerDay: unmeasuredWines.has(i.id)
          ? null
          : (soldByWine.get(i.id) || 0) / velocityDays,
        velocityDays,
        // F-1645: too few days of sales to say whether it moves; no quadrant.
        ...(velocityDays < AdvancedAnalyticsService.MENU_MIN_DAYS
          ? { tooFewDays: true as const }
          : {}),
        sizeStandIn: standInWines.has(i.id),
        // F-1666: bottles of it poured into cocktails, not in its velocity.
        ...(cocktailBottles.has(i.id)
          ? { pouredIntoCocktails: cocktailBottles.get(i.id) as number }
          : {}),
        priceBasis: i.priceBasis,
        marginPerBottle: m.marginPerBottle,
        costBasis: i.costBasis,
        marginPct: m.marginPct,
        ...("marginRefusal" in m ? { marginRefusal: m.marginRefusal } : {}),
      };
    });

    const velocities = items
      .filter((i) => !("tooFewDays" in i))
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

    const DOG_IN_COCKTAILS =
      "Slow and thin on its own price, but it also goes into cocktails, which this does not count: weigh it with the cocktails before you delist it.";

    // The quadrant is a two-axis claim. With no cost there is no margin axis,
    // so there is no quadrant and no action — `dog` ("candidate to delist") is
    // not the safe default for a wine we simply never costed.
    const classified = items.map((i) => {
      if (i.marginPerBottle == null || medMargin == null)
        return { ...i, quadrant: null, action: null };
      // Same for the other axis: no bottle figure, no velocity, no quadrant.
      if (i.velocityPerDay == null)
        return { ...i, quadrant: null, action: null };
      if ("tooFewDays" in i) return { ...i, quadrant: null, action: null };
      const highVel = i.velocityPerDay > medVel;
      const highMargin = i.marginPerBottle > medMargin;
      const quadrant = highVel
        ? highMargin
          ? "star"
          : "plowhorse"
        : highMargin
          ? "puzzle"
          : "dog";
      // F-1666: slow on its own price, but poured into cocktails this does
      // not count, a drink is not one to delist on this reading alone.
      if (quadrant === "dog" && "pouredIntoCocktails" in i)
        return { ...i, quadrant, action: DOG_IN_COCKTAILS };
      return { ...i, quadrant, action: ACTIONS[quadrant] };
    });

    // `unclassified` stays "no recorded cost"; a costed wine with no bottle
    // figure is `unmeasured`, so neither count claims the other's reason.
    const counts: Record<string, number> = {
      unclassified: 0,
      unmeasured: 0,
      unpriced: leftOut.length,
      // F-1667: priced wines on no live menu, named in offMenu[].
      offMenu: offMenu.length,
      // F-1645: a costed, measured wine with too few days of sales.
      tooFewDays: 0,
      // F-1587: a costed wine with no pre-tax margin, for its named reason.
      ...(taxed ? { taxRefused: 0 } : {}),
    };
    for (const c of classified)
      if ("marginRefusal" in c && c.marginRefusal != null)
        counts.taxRefused += 1;
      else if (c.marginPerBottle == null || medMargin == null)
        counts.unclassified += 1;
      else if (c.velocityPerDay == null) counts.unmeasured += 1;
      else if (c.quadrant == null) counts.tooFewDays += 1;
      else counts[c.quadrant] = (counts[c.quadrant] || 0) + 1;

    return {
      // F-1626: present only when the basis read failed, so the page says so.
      ...(tax.terms === null && tax.error !== null
        ? { taxBasisUnread: true }
        : {}),
      menuStanding,
      offMenu,
      cocktailPoursLeftOut: cocktailPours,
      basis: {
        velocity: `bottles/day over ${sinceDays}d at most, ending yesterday: each wine over the days since it was listed when that is fewer (items[].velocityDays)${recordsFrom ? `, and never from before the house's first recorded sale on ${recordsFrom}` : ""}; a wine with fewer than ${AdvancedAnalyticsService.MENU_MIN_DAYS} days is given no quadrant (counts.tooFewDays)${cocktailPours > 0 ? `; ${cocktailPours} pour${cocktailPours === 1 ? "" : "s"} into cocktails ${cocktailPours === 1 ? "is" : "are"} not counted as sales of the drink poured, since a cocktail's price is not that drink's (items[].pouredIntoCocktails)` : ""} — ${unitsBasisSentence(unitsCoverage)}`,
        list:
          menuStanding === "on_menu"
            ? "the wines on the house's live menus; a priced wine on no live menu is not placed, and is named in offMenu[] (counts.offMenu)"
            : menuStanding === "no_current_menu"
              ? "every priced wine in stock: the house has no live menu"
              : "every priced wine in stock: which wines are on a live menu could not be read just now",
        // Was "unit_price − WAC (lot rollup)" unconditionally, for a margin
        // that came from WAC on ~2 rows in 72 and from a fabricated
        // 0.6 × menu price on the rest.
        margin: `menu_price_current − unit cost (a wine with no bottle price: menu_price_glass × bottle ml ÷ confirmed pour ml) — ${costBasisSentence(costCoverage)}${taxed ? `. ${tax.terms === null ? TAX_BASIS_UNREAD : PRE_TAX_MARGIN_BASIS}` : ""}`,
        unpriced:
          "a wine with no bottle price and no glass price, or a glass price with no confirmed pour or bottle size, is not in items[]; it is named in leftOut[] and counted under counts.unpriced",
        costDerived:
          "items[].marginPerBottle, items[].marginPct, items[].quadrant, items[].action and medians.marginPerBottle are null for rows with no recorded cost; those rows are counted under counts.unclassified (ADR 0051)",
        unitsDerived:
          "items[].velocityPerDay, items[].quadrant and items[].action are null for a costed wine with any line that carries no bottle figure; those rows are counted under counts.unmeasured, and medians.velocityPerDay is over the known velocities only (ADR 0297)",
      },
      costCoverage,
      unitsCoverage,
      medians: { velocityPerDay: medVel, marginPerBottle: medMargin },
      counts,
      leftOut,
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
      // An order logged at the door (source 'retroactive', F-669, founder
      // S198) was written down after its truck came: its created_at is not a
      // placement, so it is kept out of lead time and on-time. It stays in
      // spend and prices below.
      const leadTimes = delivered
        .filter(
          (o) => o.delivered_at && o.created_at && o.source !== "retroactive",
        )
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
        // Logged at the door, never placed through the house (F-669):
        // informational, outside the rate.
        loggedAtDoor: 0,
      };
      for (const o of os) {
        if (o.source === "retroactive") {
          counts.loggedAtDoor += 1;
          continue;
        }
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
      // An order with no price is left out and counted (F-701): not $0, and
      // not one bottle's `final_price` standing in for the whole order.
      // A vendor paid in two currencies has no one price series (F-1042):
      // a euro case beside a lira one is not a price change.
      const priced = delivered.filter((o) => orderSpend(o) != null);
      const unitPrices = (
        namedCurrencies(priced, house.currency).length > 1 ? [] : delivered
      )
        .map((o) => {
          const bottles = o.bottles_total || o.quantity || 0;
          const cost = orderSpend(o);
          return bottles > 0 && cost != null ? cost / bottles : null;
        })
        .filter((p): p is number => p !== null && Number.isFinite(p));
      // Summed per currency (F-1042, F-339): two named currencies give
      // `spend: null` and say why, never lira added to euros. An order naming
      // no currency is the house's, and one other currency keeps its code
      // (F-1088).
      const paid = spendByCurrency(delivered, house.currency);
      return {
        vendorId,
        vendorName: os[0]?.providers?.name || vendorId,
        orders: os.length,
        delivered: delivered.length,
        spend: paid.total,
        spendCurrency: paid.currency,
        spendByCurrency: paid.byCurrency,
        spendNote: mixedSpendNote(paid.byCurrency),
        unpricedCount: paid.unpricedCount,
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

    // A vendor with no single figure sorts last rather than as 0.
    vendors.sort((a, b) => (b.spend ?? -1) - (a.spend ?? -1));
    // Shares compare one money only (F-1042): across two currencies there is
    // no exchange rate on record to put the vendors on one scale.
    const houseCurrencies = namedCurrencies(
      orders.filter(
        (o: any) =>
          hasStatus(o.status, ORDER_ARRIVED_STATUSES) && orderSpend(o) != null,
      ),
      house.currency,
    );
    const sharesComparable = houseCurrencies.length <= 1;
    const spendShare = vendors.map((v) => v.spend ?? 0);
    return {
      vendors,
      onTimeDeadline: {
        zone: house.zone,
        zoneSource: house.zoneSource,
        houseRecord: house.read,
        arrivalAnswers: overdue.ok ? "read" : "could_not_read",
      },
      concentration: {
        hhi: sharesComparable ? E.herfindahlIndex(spendShare) : null,
        effectiveVendors: sharesComparable
          ? E.effectiveCount(spendShare)
          : null,
        note: sharesComparable
          ? null
          : `Paid in ${houseCurrencies.join(" and ")}: with no exchange rate on record the vendors' shares cannot be compared.`,
        // Shares are of priced spend; these deliveries are not in them.
        unpricedCount: vendors.reduce((n, v) => n + v.unpricedCount, 0),
      },
      note: "Lead-time stdev feeds the King safety-stock formula (leadTimeStdev param on /inventory-science).",
      generatedAt: new Date().toISOString(),
    };
  }

  // =========================================================================
  // 3. Seasonality — weekday profile + classical decomposition (#20, #95)
  // =========================================================================

  async getSeasonality(restaurantId: string, sinceDays = 90) {
    // The week's shape files every line on the house's day (F-185, ADR 0296):
    // on UTC days a bottle opened after 17:00 in Los Angeles landed on the
    // next weekday. A house with no zone has no day to file on, so the lens
    // states nothing rather than UTC days dressed as the house's (DASH-G2).
    const { zone } = await readHouseZone(
      this.dbService.getClient(),
      restaurantId,
    );
    if (!zone) {
      return {
        weekdayProfile: [],
        bestDay: null,
        worstDay: null,
        tie: false,
        timezone: null,
        zoneUnset: true,
        basis: { weekday: HOUSE_ZONE_UNSET, units: null, extremes: null },
        weeklySeasonalFactors: null,
        trendPerDayPct: null,
        categoryProfiles: [],
        generatedAt: new Date().toISOString(),
      };
    }
    // The window: the `sinceDays` whole house days before today.
    const today = houseToday(zone);
    const dates: string[] = [];
    for (let d = sinceDays; d >= 1; d--) dates.push(shiftHouseDay(today, -d));
    const consumption = await this.loadConsumption(restaurantId, sinceDays, {
      zone,
      sinceIso: houseDayBounds(dates[0], dates[dates.length - 1], zone)
        .startIso,
    });
    // Counted lines only, zero-filled: a line with no bottle figure is left
    // out, so a day holding one counts only its other lines and reads 0 if
    // it has none. `basis.units` says so in those words (ADR 0297); the day
    // is short, and the basis is what keeps it from passing as a quiet one.
    const unitsCoverage = summarizeUnits(consumption);
    const rows = consumption
      .filter((c) => c.qty != null)
      .map((c) => ({ date: c.date, value: c.qty as number }));
    const byDay = new Map<string, number>();
    for (const r of rows)
      if (r.date) byDay.set(r.date, (byDay.get(r.date) || 0) + r.value);
    const values = dates.map((day) => byDay.get(day) || 0);

    // The weekday profile reads open days only (F-709): a day with no
    // movement on record is a closure, not a zero, and a day the manager
    // excluded is not a trading day — the same rule the insight generator
    // keeps. Zero-filled, a house shut on Mondays was told Monday is its
    // weakest day and to move deliveries there.
    const exclusions = await this.dayExclusions.load(restaurantId);
    const openIdx = dates.flatMap((d, i) =>
      byDay.has(d) && !exclusions.dates.has(d) ? [i] : [],
    );
    const weekday = E.dayOfWeekProfile(
      openIdx.map((i) => dates[i]),
      openIdx.map((i) => values[i]),
    );
    // `weekday.best`/`.worst` break an exact tie by weekday order, so a week
    // with no movement reported Sunday as both the busiest and the quietest
    // night. An extreme that is shared is not an extreme (ADR 0020).
    // An unreadable exclusion list could leave a buyout inside a weekday, so
    // no weekday is named over it.
    const extremes = exclusions.readable
      ? E.separableExtremes(weekday.profiles)
      : { best: null, worst: null, tie: false };
    const separated = E.weekdayExtremesSeparated(
      weekday.profiles,
      extremes.best,
      extremes.worst,
    );
    const decomposition = E.seasonalDecompose(values, 7);
    const trend28 = E.trendPerPeriodPct(values.slice(-28));

    // Per-category weekday winners (which type sells on which day).
    const byType = new Map<string, Array<{ date: string; value: number }>>();
    const client = this.dbService.getClient();
    // Read whole or refused (F-1214): past 1,000 wines the rest fell to
    // "unknown", and a failed read put every pour there.
    const inv = await readWholeWindow<any>("The cellar's wines", () =>
      client
        .from("restaurant_inventory")
        // Varietal/type lives on master_wine_library, not restaurant_inventory.
        .select("id, kind, master_wine_library(primary_type, beverage_kind)", {
          count: "exact",
        })
        .eq("restaurant_id", restaurantId),
    );
    // By house item (ADR 0115): keyed by master wine, every drink that is not
    // a wine shared the one null key and took the last such row's kind.
    const typeByWine = new Map(
      inv.map((i: any) => [
        i.id,
        // F-742: by kind of drink, wines by colour.
        beverageCategoryOf(i.master_wine_library, i.kind),
      ]),
    );
    const inWindow = new Set(dates);
    for (const c of consumption) {
      if (c.qty == null || !inWindow.has(c.date)) continue;
      const t = typeByWine.get(c.inventoryId) || "unknown";
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
        const ex = E.separableExtremes(p.profiles);
        return {
          type,
          bestDay: ex.best ? E.WEEKDAY_NAMES[ex.best.weekday] : null,
          worstDay: ex.worst ? E.WEEKDAY_NAMES[ex.worst.weekday] : null,
          tie: ex.tie,
        };
      });

    return {
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
      /**
       * True only when the best and worst days stand apart from the rest
       * (`weekdayExtremesSeparated`, F-709). False means "tended to be".
       */
      separated,
      basis: {
        weekday: `mean bottles per open weekday over the last ${sinceDays} days of wine_consumption_log, each line filed on the house's day (${zone}); a day with no movement on record or excluded by the manager is left out, and a weekday with no open day is absent from weekdayProfile rather than reported as 0`,
        units: unitsBasisSentence(unitsCoverage, "series"),
        extremes: !exclusions.readable
          ? "bestDay/worstDay are null: the manager's excluded days could not be read, so an excluded day may sit inside a weekday's mean"
          : weekday.profiles.length === 0
            ? "bestDay/worstDay are null: no open day with movement is on record in the window"
            : extremes.tie
              ? "bestDay/worstDay are null: more than one weekday shares the extreme, and naming one of them would be an arbitrary tie-break, not a finding"
              : "bestDay/worstDay are the single weekdays holding the highest and lowest mean",
        separation: separated
          ? `bestDay and worstDay each stand apart from the next weekday by more than the two days' spreads, over at least ${E.MIN_WEEKS_TO_SEPARATE} weeks each`
          : `bestDay/worstDay, when named, are not yet separated from the next weekday by more than the two days' spreads over at least ${E.MIN_WEEKS_TO_SEPARATE} weeks each`,
      },
      weeklySeasonalFactors: decomposition
        ? decomposition.seasonal.slice(0, 7)
        : null,
      trendPerDayPct: trend28,
      categoryProfiles,
      timezone: zone,
      zoneUnset: false,
      generatedAt: new Date().toISOString(),
    };
  }

  // =========================================================================
  // 4. Cashflow — spend pacing, projection, upcoming exposure (#159/166/193)
  // =========================================================================

  async getCashflow(restaurantId: string) {
    const [{ delivered: deliveredRead, unclosed }, frame] = await Promise.all([
      this.loadCashflowOrders(restaurantId, 180),
      this.loadHouseFrame(restaurantId),
    ]);
    // Money question: PARTIALLY_RECEIVED carries PO-value columns, not
    // received-value ones, so it is excluded here. See order-status.ts.
    const delivered = deliveredRead.filter((o: any) =>
      hasStatus(o.status, ORDER_SPEND_STATUSES),
    );
    const spendUnpricedCount = sumOrderSpend(delivered).unpricedCount;
    // Days are summed in one money only (F-1042): a window holding a lira and
    // a euro delivery has no one figure, so every spend figure built from the
    // days is null and `spendNote` says why.
    // An order naming no currency is the house's (F-1088).
    const paidIn = namedCurrencies(
      delivered.filter((o: any) => orderSpend(o) != null),
      frame.currency,
    );
    const spendNote =
      paidIn.length > 1
        ? `Paid in ${paidIn.join(" and ")}: with no exchange rate on record they cannot be added into one figure, so the 30-day buying figures and the pace are left blank.`
        : null;
    // The windows end TODAY, on the house's own date (F-130). The shared
    // `toDaily` stops at yesterday's UTC date, so every delivery taken in
    // today — and, west of Greenwich, every one after the evening's UTC
    // midnight — was in no window, and the panel read $0 beside a Figures of
    // record that counted them. With no zone the days are UTC days, and the
    // basis says so.
    const zone = frame.zone;
    const today = zone
      ? houseToday(zone)
      : new Date().toISOString().slice(0, 10);
    const byDay = new Map<string, number>();
    for (const o of delivered as any[]) {
      const at = o.delivered_at || o.created_at || null;
      const day = zone ? houseDayOf(at, zone) : (at || "").substring(0, 10);
      if (!day) continue;
      // An order with no price is left out and counted (F-701).
      const spend = orderSpend(o);
      if (spend == null) continue;
      byDay.set(day, (byDay.get(day) || 0) + spend);
    }
    const daily: number[] = [];
    for (let back = 179; back >= 0; back--)
      daily.push(byDay.get(shiftHouseDay(today, -back)) || 0);

    const last30 = daily.slice(-30).reduce((a, b) => a + b, 0);
    const prev30 = daily.slice(-60, -30).reduce((a, b) => a + b, 0);
    const pace = E.periodOverPeriod(daily, 30);

    // Weekly series → Holt projection 4 weeks out.
    const weekly: number[] = [];
    for (let i = 0; i < daily.length; i += 7)
      weekly.push(daily.slice(i, i + 7).reduce((a, b) => a + b, 0));
    const holt =
      !spendNote && weekly.length >= 4
        ? E.holtLinear(weekly, 0.4, 0.2, 4)
        : null;

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
    const open = unclosed.filter((o: any) =>
      hasStatus(o.status, ORDER_OUTSTANDING_STATUSES),
    );
    const committedPaid = spendByCurrency(open, frame.currency);

    // Orders in NEITHER figure: approved but not yet with the vendor's
    // confirmation, or partly received and still open (F-130). Neither rule
    // above is changed here — a partly received order's columns are its
    // order value, not what arrived — but the panel names them, with their
    // order value, instead of letting both figures read as the whole book.
    const neither = unclosed.filter(
      (o: any) =>
        !hasStatus(o.status, ORDER_SPEND_STATUSES) &&
        !hasStatus(o.status, ORDER_OUTSTANDING_STATUSES) &&
        !hasStatus(o.status, ORDER_CLOSED_STATUSES),
    );
    // Their order value is summed the way the two figures are (F-1010): an
    // unpriced order is left out and counted, never read as one bottle's
    // `final_price` or as $0.
    const neitherPaid = spendByCurrency(neither, frame.currency);
    const notCounted = {
      approved: neither.filter((o: any) => o.status === "APPROVED").length,
      partlyReceived: neither.filter(
        (o: any) => o.status === "PARTIALLY_RECEIVED",
      ).length,
      other: neither.filter(
        (o: any) =>
          o.status !== "APPROVED" && o.status !== "PARTIALLY_RECEIVED",
      ).length,
      orderValue: neitherPaid.total,
      orderValueCurrency: neitherPaid.currency,
      orderValueByCurrency: neitherPaid.byCurrency,
      orderValueNote: orderedInTwoNote(neither, frame.currency),
      unpriced: neitherPaid.unpricedCount,
    };

    return {
      basis: {
        outflow: "delivered procurement_orders (revenue inflow needs POS feed)",
        days: zone
          ? `each 30-day window ends today, on the house's own date (${zone})`
          : "each 30-day window ends today, on UTC dates, because the house has no time zone set",
        notCounted:
          "orders approved but not yet confirmed by the vendor, orders still being negotiated, and orders partly received and still open are in neither figure until they are confirmed or closed; they are counted here at their order value, and one with no price is left out of that value and counted",
      },
      spendLast30d: spendNote ? null : last30,
      spendPrev30d: spendNote ? null : prev30,
      paceDeltaPct: spendNote ? null : (pace?.deltaPct ?? null),
      projectedNext4Weeks: holt?.forecast.map((v) => Math.max(0, v)) ?? null,
      // The code the paid-out figures are in; one other currency keeps its
      // code, never read as the house's (F-1088).
      spendCurrency: spendNote ? null : (paidIn[0] ?? frame.currency),
      spendNote,
      committedOpenOrders: committedPaid.total,
      committedCurrency: committedPaid.currency,
      committedByCurrency: committedPaid.byCurrency,
      committedNote: orderedInTwoNote(open, frame.currency),
      openOrderCount: open.length,
      notCounted,
      // Orders the two figures above leave out because they carry no price.
      spendUnpricedCount,
      committedUnpricedCount: committedPaid.unpricedCount,
      generatedAt: new Date().toISOString(),
    };
  }

  // =========================================================================
  // 5. Wine-360 — per-entity combination endpoint
  // =========================================================================

  async getWine360(restaurantId: string, masterWineId: string) {
    // The wine's demand days are the house's (F-928), as its forecast's are.
    const { zone } = await readHouseZone(
      this.dbService.getClient(),
      restaurantId,
    );
    const [inventory, consumption, forecast] = await Promise.all([
      this.loadInventoryWithCost(restaurantId),
      this.loadConsumption(restaurantId, 90, zone ? { zone } : {}),
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
      zone,
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
      // F-573. A failed goals read is null, never `[]`: an empty list reads
      // as "no goal is running". Each goal carries its metric's unit so the
      // bench and its export print $4,210 or 35% the way the goals desk does,
      // not 4.2K or 0.35. `current_value` is the STORED reading, refreshed only
      // when that goal's progress is opened (goals.service.ts listGoals vs
      // listGoalsWithProgress), so `updated_at` travels with it and the bench
      // says when it was last read rather than calling it "now". Live progress
      // is several reads per goal and writes back, too heavy for this call.
      activeGoals:
        goals.status === "fulfilled"
          ? (goals.value as any[]).map((g) => ({
              ...g,
              unit:
                GoalsService.SUPPORTED_METRICS[g.metric_key]?.unit ?? "count",
            }))
          : null,
      computedIn: Date.now() - startedAt,
      generatedAt: new Date().toISOString(),
    };
  }
}
