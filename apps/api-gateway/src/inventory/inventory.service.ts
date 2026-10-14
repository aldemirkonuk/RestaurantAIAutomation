import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  Optional,
  Inject,
  forwardRef,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { DatabaseService } from "../database/database.service";
import { readWholeWindow, WHOLE_READ_PAGE } from "../common/read-whole-window";
import { OrchestratorService } from "../common/orchestrator/orchestrator.service";
import { LowStockAlertsService } from "../notifications/low-stock-alerts.service";
import { WineSubmissionsService } from "../wines/wine-submissions.service";
import { PhotoCountService } from "./photo-count.service";
import { NfEventRef } from "../common/model-client/model-client.service";
import { NfVerdictService } from "../common/model-client/nf-verdict.service";
import { HUMAN_COUNT_BASIS, humanCountVerdict } from "./photo-count-verdict";
import {
  mapStockCountResult,
  openTenthsToMl,
  OPENING_COUNT_SOURCE,
} from "./stock-count-result";
import { resolveFactTime } from "../common/fact-time";
import {
  setHouseMenuPrice,
  type HousePriceResult,
} from "../pricing/house-menu-price";
import { assertInventoryBelongsToRestaurant } from "../common/tenant/assert-inventory-belongs-to-restaurant";
import { assertLocationsBelongToRestaurant } from "../common/tenant/assert-location-belongs-to-restaurant";
import {
  enqueueHouseItemResearch,
  readHouseItemResearch,
  type HouseItemResearchView,
} from "./house-item-research";
import { classifyStock } from "../common/stock-status";
import { readHouseZone, shiftHouseDay } from "../common/house-day";
import {
  houseWallAt,
  type WallReading,
} from "../notifications/low-stock-digest-clock";
import {
  CreateInventoryItemDto,
  UpdateInventoryItemDto,
  MapToastItemDto,
  BulkMapToastItemsDto,
  BulkCreateInventoryItemsDto,
  BulkInventoryLineDto,
} from "./dto/inventory.dto";

const ML_PER_OZ = 29.5735;
/** `restaurants.default_threshold_min`'s column default, used when the house row is unread. */
const HOUSE_PAR_MIN_FALLBACK = 3;

function roundOz(ml: number): number {
  return Math.round((ml / ML_PER_OZ) * 10) / 10;
}

/**
 * A queued spot count younger than this is treated as live (F-249): the
 * phone's own retry of a count that just failed on bad signal should not be
 * refused for a sale rung up in the same minute.
 */
const QUEUED_COUNT_GRACE_MS = 2 * 60_000;

/**
 * How many counts and movements since a queued shelf count are read to decide
 * which shelf they touched (F-880). A wine that moved more often than this in
 * the window is refused as "not known which shelf", never let through.
 */
const OVERTAKEN_SCAN_LIMIT = 200;

/**
 * How many shelf counts of one wine are read to find each shelf's newest
 * (F-1165). A wine counted more often than this answers "not known" (null),
 * never a shelf wrongly called uncounted.
 */
const SHELF_COUNT_SCAN = 1000;

/**
 * The /inventory list's shelf counts (F-1235): the window read and the most
 * rows read before the answer is "not known" (null). A shelf with no count in
 * the window is older than the window, so it is due either way; past the cap
 * the list falls back to the whole-wine date, which is never fresher.
 */
const LIST_SHELF_COUNT_DAYS = 60;
const LIST_SHELF_COUNT_CAP = 5000;

/**
 * Whether a Postgres error is the request's fault (F-250): a RAISE from the
 * function itself (P0001), bad data (class 22), a broken constraint (class
 * 23) or a refused foreign item (42501). Anything else — no code at all (the
 * connection dropped), a timeout, a deadlock, a server going away — is
 * transient, and the phone should try again rather than give up.
 */
export function isRequestFaultDbError(
  err: { code?: string } | null | undefined,
): boolean {
  const code = err?.code ?? "";
  return (
    code === "P0001" ||
    code === "42501" ||
    code.startsWith("22") ||
    code.startsWith("23")
  );
}

/**
 * Read a view with no `id` column whole, by range (F-293). PostgREST stops
 * every answer at 1,000 rows (supabase/config.toml:18) with a 200, so these
 * joins were cut with no notice. Pages are ranged over a stable order and the
 * exact count proves the read whole; an error, or a total that moved while the
 * pages were read, refuses rather than answering from part of the view.
 */
async function readEveryRange(
  what: string,
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: any[] | null;
    error: { message?: string } | null;
    count?: number | null;
  }>,
): Promise<any[]> {
  const rows: any[] = [];
  let total: number | null = null;
  for (let from = 0; ; ) {
    const { data, error, count } = await page(from, from + WHOLE_READ_PAGE - 1);
    if (error || !Array.isArray(data)) {
      throw new ServiceUnavailableException(
        `${what} could not be read (${error?.message ?? "no rows and no error"}). Nothing is shown from part of them.`,
      );
    }
    if (total === null && typeof count === "number") total = count;
    rows.push(...data);
    from += data.length;
    const more =
      total !== null ? rows.length < total : data.length === WHOLE_READ_PAGE;
    if (!more || data.length === 0) break;
  }
  if (total !== null && rows.length !== total) {
    throw new ServiceUnavailableException(
      `${what} could not be read whole: ${rows.length} rows read against ${total} counted. Nothing is shown from part of them.`,
    );
  }
  return rows;
}

/** Why a drink is sold out (stock_outs_cause_known, F-145). */
export const STOCK_OUT_CAUSES = [
  "ran_out",
  "broken",
  "pulled",
  "other",
] as const;
export type StockOutCause = (typeof STOCK_OUT_CAUSES)[number];

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly dbService: DatabaseService,
    @Optional()
    @Inject(OrchestratorService)
    private readonly orchestratorService?: OrchestratorService,
    @Optional()
    @Inject(forwardRef(() => LowStockAlertsService))
    private readonly lowStockAlerts?: LowStockAlertsService,
    // Optional so the existing unit specs can construct the service with only a
    // DatabaseService. Nest always injects it in the real app (InventoryModule
    // imports WinesModule); only the wineDraft path needs it.
    @Optional()
    @Inject(WineSubmissionsService)
    private readonly wineSubmissions?: WineSubmissionsService,
    @Optional()
    @Inject(PhotoCountService)
    private readonly photoCountService?: PhotoCountService,
    // Optional for the same reason as the rest: the unit specs construct this
    // service with a DatabaseService alone, and the grading path is not what
    // they exercise.
    @Optional()
    @Inject(NfVerdictService)
    private readonly nfVerdicts?: NfVerdictService,
  ) {}

  private mapInventoryItem(
    row: Record<string, any>,
    rollup?: Record<string, any>,
    locations?: any[],
    analytics?: Record<string, any>,
  ): Record<string, any> {
    const wineBottleMl = row.master_wine_library?.bottle_size_ml ?? 750;
    const defaultPourMl = row.restaurants?.default_pour_ml ?? 150;
    const effectiveBottleSizeMl = row.bottle_size_ml ?? wineBottleMl;
    const pourSizeMl = row.pour_size_ml ?? defaultPourMl;
    const glassesPerBottle =
      row.glasses_per_bottle_override ??
      (pourSizeMl > 0
        ? Math.floor(effectiveBottleSizeMl / pourSizeMl)
        : undefined);

    // Extract wine name before stripping the nested master_wine_library object.
    // Prefer the denormalized column; fall back to the joined library row.
    const wineName: string | null =
      row.wine_name || row.master_wine_library?.name || null;

    // BOTH NAMES TRAVEL (ADR 0124, the naming rule, founder 2026-09-05: "both
    // names searchable"). `wineName` above collapses the two into whichever one
    // is shown, so on its own it makes the OTHER one unfindable: a house that
    // renames "1988 Wine X" to "Wine X" could no longer search for "1988".
    // `libraryName` is the library's own name, carried beside the alias and
    // NEVER shown in its place -- the display is the house's, the search is
    // both. Null when the row has no library name to differ from.
    const libraryName: string | null = row.master_wine_library?.name ?? null;
    const houseAlias: string | null = row.wine_name || null;

    // Market price + markup live on the joined wine library / inventory row —
    // capture them BEFORE the nested library object is stripped below, or they are lost.
    const retailPriceAvg: number | null =
      row.master_wine_library?.retail_price_avg ?? null;
    const markupRatio: number | null = row.markup_ratio ?? null;
    // F-739: what the drink IS. `kind` is the house item's own (ADR 0115);
    // `beverageKind` is the library's verdict, which can be newer than a
    // `kind` stamped when the item was added. Both travel; the page picks.
    const beverageKind: string | null =
      row.master_wine_library?.beverage_kind ?? null;

    const result = { ...row };
    if (row.master_wine_library) delete result.master_wine_library;
    if (row.restaurants) delete result.restaurants;

    return {
      ...result,
      wineName,
      wine_name: wineName,
      // The library's own name, for search only. `wineName` stays the one
      // displayed value so no surface has to choose.
      libraryName,
      // Whether the house has actually set an alias, told apart from the
      // fallback: `wineName` is non-null either way, so without this a caller
      // cannot see that a name is the library's rather than the house's.
      houseAlias,
      kind: row.kind ?? null,
      beverageKind,
      bottleSizeMl: effectiveBottleSizeMl,
      bottleSizeOz: roundOz(effectiveBottleSizeMl),
      pourSizeMl,
      pourSizeOz: roundOz(pourSizeMl),
      glassesPerBottle,
      saleType: row.sale_type ?? undefined,
      // Decision E41: a real column, set only by recordSpotCount — never by
      // a generic field edit — so the count-due badge measures counts, not
      // "any edit at all" (which is what row.updated_at would give it).
      lastCountedAt: row.last_counted_at ?? null,
      menuPriceGlass: row.menu_price_glass ?? undefined,
      // This house's own bottle price -- never the wine library's reference
      // price. ADR 0193: it IS `menu_price_current`, the column every margin,
      // valuation and POS path already reads; the cellar lane's short-lived
      // second column (`menu_price_bottle`) was removed before merge so there
      // is one number. Same undefined-not-null idiom as menuPriceGlass above.
      menuPriceBottle: row.menu_price_current ?? undefined,
      glassesPerBottleOverride: row.glasses_per_bottle_override ?? undefined,
      retailPriceAvg: retailPriceAvg ?? undefined,
      markupRatio: markupRatio ?? undefined,
      // Phase 2 read-cutover: true WAC + provenance + lot spread derived from inventory_lots.
      wac: rollup?.wac ?? undefined,
      costProvenance: rollup
        ? rollup.has_invoice_cost
          ? "invoice"
          : "estimated"
        : undefined,
      lotLiveQty: rollup?.live_qty ?? undefined,
      lotLocationCount: rollup?.live_location_count ?? undefined,
      // Phase 2 (2c) by-the-glass: total open-bottle ml across live lots.
      openMl: rollup?.open_ml ?? 0,
      // Phase 2 (2d/2e): velocity / days-of-cover / reorder / ABC / dead-stock.
      velocityPerDay: analytics?.velocity_per_day ?? undefined,
      // F-687: the days the rate is averaged over (a wine listed 3 days ago
      // is averaged over 3, not 30), and whether it is too new to plan on.
      velocityDays: analytics?.velocity_days ?? undefined,
      velocityIsNew: analytics?.is_new ?? undefined,
      // F-1516: true when those days are fewer because the house's sales
      // records began after the wine was listed (its first till sale).
      velocityFromTill: analytics?.velocity_from_till ?? undefined,
      daysOfCover: analytics?.days_of_cover ?? undefined,
      reorderPoint: analytics?.reorder_point ?? undefined,
      reorderSuggested: analytics?.reorder_suggested ?? false,
      abcClass: analytics?.abc_class ?? undefined,
      deadStock: analytics?.dead_stock ?? false,
      daysSinceSale: analytics?.days_since_sale ?? undefined,
      // Phase 2 multi-location: per-location live quantities ([{locationId, qty, wac}]).
      locations: locations ?? [],
    };
  }

  /** Phase 2: per-inventory WAC / on-hand / location spread derived from inventory_lots. */
  private async fetchLotRollup(
    restaurantId: string,
    refuseOnError = false,
  ): Promise<Map<string, any>> {
    // F-293: read every page. This used to read only `data` with no range, so
    // past 1,000 rows the later wines lost their lot totals and cost, and a
    // failed read looked like "no lots". The list refuses on a failed read
    // (`refuseOnError`); the single-item paths keep the old log-and-carry-on.
    const map = new Map<string, any>();
    const client = this.dbService.getClient();
    const rows = await readEveryRange("The lot totals", (from, to) =>
      client
        .from("inventory_lot_rollup")
        .select(
          "inventory_id, live_qty, shadow_qty, wac, has_invoice_cost, live_location_count, open_ml",
          { count: "exact" },
        )
        .eq("restaurant_id", restaurantId)
        .order("inventory_id", { ascending: true })
        .range(from, to),
    ).catch((err: any) => {
      if (refuseOnError) throw err;
      this.logger.warn(`fetchLotRollup failed: ${err?.message}`);
      return [] as any[];
    });
    for (const r of rows) map.set(r.inventory_id, r);
    return map;
  }

  /** Phase 2 multi-location: per-inventory live lot quantities by location. */
  private async fetchLocationBreakdown(
    restaurantId: string,
    refuseOnError = false,
  ): Promise<Map<string, any[]>> {
    // F-293: one row per (wine, location), so 400 wines in 3 rooms is 1,200
    // rows; unpaged, the cap at 1,000 dropped shelves from the later wines.
    const map = new Map<string, any[]>();
    const client = this.dbService.getClient();
    const rows = await readEveryRange("The shelf totals", (from, to) =>
      client
        .from("inventory_location_breakdown")
        .select("inventory_id, location_id, qty, wac", { count: "exact" })
        .eq("restaurant_id", restaurantId)
        .eq("stock_state", "live")
        .order("inventory_id", { ascending: true })
        .order("location_id", { ascending: true, nullsFirst: true })
        .range(from, to),
    ).catch((err: any) => {
      if (refuseOnError) throw err;
      this.logger.warn(`fetchLocationBreakdown failed: ${err?.message}`);
      return [] as any[];
    });
    for (const r of rows) {
      const arr = map.get(r.inventory_id) ?? [];
      arr.push({ locationId: r.location_id, qty: r.qty, wac: r.wac });
      map.set(r.inventory_id, arr);
    }
    return map;
  }

  /**
   * Phase 2 (2d/2e): per-inventory velocity, days-of-cover, reorder, ABC,
   * dead-stock.
   *
   * `ok: false` is a FAILED read, told apart from a real, empty result. This
   * method still swallows the underlying error rather than throwing — the
   * rest of the inventory list (stock, lots, locations) is real and useful
   * even when this one join is down, and the other `fetch*` helpers beside it
   * follow the same resilience pattern — but the caller needs to know WHICH
   * case it is in, because "the join has nothing for this row" and "the join
   * could not be read" are different sentences downstream (`BottleLeaf`'s
   * sold line used to print the former for both, ADR 0160 sec110 item 3(c)).
   */
  private async fetchAnalytics(
    restaurantId: string,
  ): Promise<{ map: Map<string, any>; ok: boolean }> {
    const map = new Map<string, any>();
    try {
      const client = this.dbService.getClient();
      const rows = await readEveryRange("The sales pace", (from, to) =>
        client
          .from("inventory_analytics")
          .select(
            "inventory_id, velocity_per_day, days_of_cover, reorder_point, reorder_suggested, abc_class, dead_stock, days_since_sale, velocity_days, is_new, velocity_from_till",
            { count: "exact" },
          )
          .eq("restaurant_id", restaurantId)
          .order("inventory_id", { ascending: true })
          .range(from, to),
      );
      for (const r of rows) map.set(r.inventory_id, r);
      return { map, ok: true };
    } catch (err: any) {
      this.logger.warn(`fetchAnalytics failed: ${err?.message}`);
      return { map, ok: false };
    }
  }

  /**
   * F-1235: each wine's shelves' newest counts, for the list's count-due flag.
   * A count of one shelf no longer stamps last_counted_at (F-1165), so a house
   * that counts shelf by shelf read as "due" forever. One house-wide read of
   * the last LIST_SHELF_COUNT_DAYS, newest first, keeps the first row seen per
   * (wine, shelf). `null` is an answer we do not have -- a failed read, or more
   * rows than the cap -- and the page then falls back to the whole-wine date,
   * so a shelf is never shown fresher than it is.
   */
  private async fetchShelfCounts(
    restaurantId: string,
  ): Promise<Map<
    string,
    Array<{ locationId: string; countedAt: string }>
  > | null> {
    const since = new Date(
      Date.now() - LIST_SHELF_COUNT_DAYS * 86_400_000,
    ).toISOString();
    const client = this.dbService.getClient();
    let rows: any[];
    try {
      rows = await readEveryRange("The shelf counts", (from, to) =>
        from >= LIST_SHELF_COUNT_CAP
          ? Promise.reject(new Error("more shelf counts than one list reads"))
          : client
              .from("stock_counts")
              .select("id, inventory_id, location_id, counted_at", {
                count: "exact",
              })
              .eq("restaurant_id", restaurantId)
              .eq("stock_state", "live")
              .gte("counted_at", since)
              .order("counted_at", { ascending: false })
              .order("id", { ascending: true })
              .range(from, to),
      );
    } catch (err: any) {
      this.logger.warn(`fetchShelfCounts failed: ${err?.message}`);
      return null;
    }
    const map = new Map<
      string,
      Array<{ locationId: string; countedAt: string }>
    >();
    const seen = new Set<string>();
    for (const r of rows) {
      if (!r.location_id) continue;
      const key = `${r.inventory_id}|${r.location_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const arr = map.get(r.inventory_id) ?? [];
      arr.push({ locationId: r.location_id, countedAt: r.counted_at });
      map.set(r.inventory_id, arr);
    }
    return map;
  }

  /**
   * F-1434: which of this house's items are sold out (86'd) now -- the open
   * stock_outs rows, the same rows the item's stock-out route reads. One
   * house-wide read, so every list row (wine, spirit, beer or anything else)
   * can say it is sold out without being opened. `null` is an answer we do
   * not have, and the list then says so; it is never read as "none sold out".
   */
  private async fetchOpenStockOuts(
    restaurantId: string,
  ): Promise<Map<string, { cause: string; startedAt: string }> | null> {
    const client = this.dbService.getClient();
    let rows: any[];
    try {
      rows = await readEveryRange("The sold-out drinks", (from, to) =>
        client
          .from("stock_outs")
          .select("id, inventory_id, cause, started_at", { count: "exact" })
          .eq("restaurant_id", restaurantId)
          .is("ended_at", null)
          .order("id", { ascending: true })
          .range(from, to),
      );
    } catch (err: any) {
      this.logger.warn(`fetchOpenStockOuts failed: ${err?.message}`);
      return null;
    }
    const map = new Map<string, { cause: string; startedAt: string }>();
    for (const r of rows) {
      map.set(String(r.inventory_id), {
        cause: String(r.cause),
        startedAt: String(r.started_at),
      });
    }
    return map;
  }

  /**
   * The money one house keeps its books in, for the all-locations export
   * (F-599). `restaurants.currency` is nullable and never defaulted here; a
   * failed read is `readable: false`, never "not recorded" (ADR 0083).
   */
  async readHouseCurrency(
    restaurantId: string,
  ): Promise<{ code: string | null; readable: boolean }> {
    const { data, error } = await this.dbService
      .getClient()
      .from("restaurants")
      .select("currency")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logger.warn(
        `Could not read the currency of ${restaurantId}: ${error.message}`,
      );
      return { code: null, readable: false };
    }
    const code = (data as { currency?: string | null } | null)?.currency;
    return { code: code ?? null, readable: true };
  }

  async getRestaurantInventory(restaurantId: string, active = true) {
    this.logger.log(`Fetching inventory for restaurant: ${restaurantId}`);
    const [data, rollup, locations, analytics, shelfCounts, soldOut] =
      await Promise.all([
        this.dbService.getRestaurantInventory(restaurantId, active),
        this.fetchLotRollup(restaurantId, true),
        this.fetchLocationBreakdown(restaurantId, true),
        this.fetchAnalytics(restaurantId),
        this.fetchShelfCounts(restaurantId),
        this.fetchOpenStockOuts(restaurantId),
      ]);
    return (data || []).map((row) => ({
      ...this.mapInventoryItem(
        row,
        rollup.get(row.id),
        locations.get(row.id),
        analytics.map.get(row.id),
      ),
      // Additive: every existing reader that does not know this field simply
      // ignores it. `false` means the analytics join itself could not be
      // read for this batch — not that this row has no analytics row.
      analyticsReadable: analytics.ok,
      // F-1235: each shelf's newest count in the window; null = not known.
      shelfCounts: shelfCounts ? (shelfCounts.get(row.id) ?? []) : null,
      // F-1434: the open 86 (cause, since when), null when it is not sold
      // out. `soldOutReadable: false` means the sold-out read failed, so a
      // null here is not "available".
      soldOut: soldOut ? (soldOut.get(row.id) ?? null) : null,
      soldOutReadable: soldOut !== null,
    }));
  }

  /**
   * Phase 2 multi-location: move bottles of a wine between locations (null = unassigned).
   *
   * ADR 0078 (attribution): `performedBy` comes from the verified JWT via
   * `@CurrentUser()`, never from the request body. `transfer_stock` has always
   * accepted `p_performed_by` (baseline:1838) and this call has always omitted
   * it, so `performed_by_type` resolved to 'system' on every manual transfer —
   * a ledger built to answer "who moved this" answering "the system".
   */
  async transferStock(
    restaurantId: string,
    inventoryId: string,
    dto: {
      fromLocationId?: string | null;
      toLocationId?: string | null;
      qty: number;
      reason?: string;
    },
    performedBy?: string | null,
  ) {
    const client = this.dbService.getClient();
    // ADR 0141, Correction 2026-09-12. This path takes an inventory id from
    // the URL and hands it to a SQL wrapper that derives the house from the
    // item itself, so without this check a caller could move another
    // house's stock -- the adversarial pass drained a foreign house's lots
    // 9 to 0 through the same shape. It runs BEFORE the RPC: a check that
    // ran afterwards would refuse the response after the stock had moved.
    await assertInventoryBelongsToRestaurant(
      client,
      restaurantId,
      inventoryId,
      "transferStock",
      this.logger,
    );
    // F-435: the zones too. The RPC files the lot under whatever zone id it
    // is given, with no house tie, so another house's zone would be accepted.
    // F-1334: a deleted zone may still be the source (its bottles must be
    // able to leave it), never the destination, or the bottles are stranded
    // on a shelf nobody can see.
    await assertLocationsBelongToRestaurant(
      client,
      restaurantId,
      [dto.fromLocationId],
      "transferStock",
      this.logger,
    );
    await assertLocationsBelongToRestaurant(
      client,
      restaurantId,
      [dto.toLocationId],
      "transferStock",
      this.logger,
      { liveOnly: true },
    );
    // F-1542: bottles land on a shelf, never on a place that holds other
    // places. Filed there they sit on no shelf, so the wine can no longer be
    // counted shelf by shelf (the F-945 rule the count panel follows). A read
    // that fails refuses: an unanswered question is not a yes.
    if (dto.toLocationId) {
      const { data: inside, error: insideError } = await client
        .from("storage_locations")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .eq("parent_id", dto.toLocationId)
        .is("deleted_at", null)
        .limit(1);
      if (insideError) {
        this.logger.error(
          `transferStock zone read failed: ${insideError.message}`,
        );
        throw new HttpException(
          "Where the bottles were going could not be read, so nothing was moved.",
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      if ((inside ?? []).length > 0) {
        throw new HttpException(
          "That place holds other places. Move the bottles onto one of the shelves inside it, so they can be counted there.",
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    const { error } = await client.rpc("transfer_stock", {
      p_inventory_id: inventoryId,
      p_from_location_id: dto.fromLocationId ?? null,
      p_to_location_id: dto.toLocationId ?? null,
      p_qty: dto.qty,
      p_performed_by: performedBy ?? null,
      p_reason: dto.reason ?? "location transfer",
    });
    if (error) {
      this.logger.error(`transfer_stock failed: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
    const [row, rollup, locations] = await Promise.all([
      client
        .from("restaurant_inventory")
        .select(
          `*, master_wine_library (*), restaurants (default_pour_ml, measurement_unit)`,
        )
        .eq("restaurant_id", restaurantId)
        .eq("id", inventoryId)
        .single(),
      this.fetchLotRollup(restaurantId),
      this.fetchLocationBreakdown(restaurantId),
    ]);
    return row.data
      ? this.mapInventoryItem(
          row.data,
          rollup.get(inventoryId),
          locations.get(inventoryId),
        )
      : null;
  }

  /**
   * Phase 2 (2c) by-the-glass: record N glass pours (POS or manual). Depletes open bottle ml.
   *
   * ADR 0078 (attribution): `performedBy` comes from the verified JWT, never the
   * body. Null is correct and expected for a POS-sourced pour, which genuinely
   * has no human actor — the fix is that a MANUAL pour stops claiming to be one.
   */
  async recordPour(
    restaurantId: string,
    inventoryId: string,
    dto: {
      pours?: number;
      pourMl?: number | null;
      locationId?: string | null;
      source?: string;
      reason?: string;
      idempotencyKey?: string | null;
    },
    performedBy?: string | null,
  ) {
    const client = this.dbService.getClient();
    // pour_events.idempotency_key is now mandatory (spine repair, decision
    // A12): a full unique constraint on a nullable column meant every
    // key-less manual pour after the first collided on a duplicate NULL.
    // Prefer the caller's key (stable across an offline retry); fall back to
    // a server-generated one so this endpoint never 500s for a caller that
    // hasn't been updated to send one yet — it simply loses retry-dedupe.
    const idempotencyKey =
      dto.idempotencyKey ??
      `pour:${inventoryId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    // ADR 0141, Correction 2026-09-12. This path takes an inventory id from
    // the URL and hands it to a SQL wrapper that derives the house from the
    // item itself, so without this check a caller could move another
    // house's stock -- the adversarial pass drained a foreign house's lots
    // 9 to 0 through the same shape. It runs BEFORE the RPC: a check that
    // ran afterwards would refuse the response after the stock had moved.
    await assertInventoryBelongsToRestaurant(
      client,
      restaurantId,
      inventoryId,
      "recordPour",
      this.logger,
    );
    await assertLocationsBelongToRestaurant(
      client,
      restaurantId,
      [dto.locationId],
      "recordPour",
      this.logger,
    );
    const { data: pourResult, error } = await client.rpc("record_glass_pour", {
      p_inventory_id: inventoryId,
      p_pours: dto.pours ?? 1,
      p_pour_ml: dto.pourMl ?? null,
      p_location_id: dto.locationId ?? null,
      p_source: dto.source ?? "manual",
      p_performed_by: performedBy ?? null,
      p_reason: dto.reason ?? null,
      p_idempotency_key: idempotencyKey,
    });
    if (error) {
      this.logger.error(`record_glass_pour failed: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
    const [row, rollup, locations] = await Promise.all([
      client
        .from("restaurant_inventory")
        .select(
          `*, master_wine_library (*), restaurants (default_pour_ml, measurement_unit)`,
        )
        .eq("restaurant_id", restaurantId)
        .eq("id", inventoryId)
        .single(),
      this.fetchLotRollup(restaurantId),
      this.fetchLocationBreakdown(restaurantId),
    ]);

    // Real-time low-stock edge check. Fire-and-forget: a pour that crosses par
    // must alert instantly, but must never slow (or fail) the pour response.
    if (this.lowStockAlerts) {
      void this.lowStockAlerts
        .evaluateInventoryItem(restaurantId, inventoryId)
        .catch(() => undefined);
    }

    return {
      pour: pourResult,
      item: row.data
        ? this.mapInventoryItem(
            row.data,
            rollup.get(inventoryId),
            locations.get(inventoryId),
          )
        : null,
    };
  }

  /**
   * F-249. A count queued on a phone with no signal used to be applied when
   * the phone found signal again, against the stock as it was THEN: count 12
   * at 14:00, sell 4, sync at 20:00, and the shelf went back to 12 with the
   * four sales booked as a variance. A count is a statement about one moment,
   * so a count older than the stock's last movement (or than a newer count)
   * is refused, in words, for a person to count again. It is refused rather
   * than re-based on the movements since, because a re-based figure is not
   * what anyone counted and would be stored as if it were (ADR 0078).
   *
   * Only for a queued count (`countedAgoMs` past the grace below): a live
   * count is sent the moment it is taken. A count that already landed (its
   * key is on record) skips the check so its retry replays, not refuses.
   *
   * F-880. A count of one shelf (`locationId`, F-291) is a statement about
   * that shelf only, so only a change to THAT shelf overtakes it: a newer
   * count of the same shelf or of every shelf, or a movement that took from,
   * landed on or moved bottles to or from it. A bar count or a bar sale says
   * nothing about the cellar. A movement whose shelf the record does not say
   * (a delivery, a sale written before lots_taken was kept) still refuses,
   * and the refusal says it is not known which shelf moved -- never that
   * this shelf was counted again.
   */
  private async refuseCountOvertakenByStock(
    client: ReturnType<DatabaseService["getClient"]>,
    restaurantId: string,
    inventoryId: string,
    stockState: "live" | "shadow",
    idempotencyKey: string,
    countedAgoMs: number | undefined,
    countedAt: string | null,
    locationId: string | null = null,
    // F-1544 lane 2: a line of a stock-take (its held retry replays too) and
    // whether it counted the open bottles.
    line: {
      sessionId?: string | null;
      countsOpenMl?: boolean;
      // F-1544 lane 4: a manager posts a held line. The count it was held
      // against is the other half of the same conflict, not a later count
      // that overtakes it, so it and its own correction are set aside.
      resolvesHeld?: {
        countId: string | null;
        transactionId: string | null;
      } | null;
    } = {},
  ): Promise<void> {
    if (
      countedAt == null ||
      countedAgoMs == null ||
      Number(countedAgoMs) <= QUEUED_COUNT_GRACE_MS
    ) {
      return;
    }
    const transient = (what: string, err: { message?: string }) => {
      this.logger.error(`Spot count ${what} read failed: ${err.message}`);
      return new HttpException(
        "The count could not be checked against the stock just now. It will be tried again.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    };

    const landed = await client
      .from("stock_counts")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("idempotency_key", idempotencyKey)
      .limit(1);
    if (landed.error) throw transient("replay", landed.error);
    if ((landed.data ?? []).length > 0) return;
    // A line held as a second count of its shelf (F2 a) replays as held.
    // Unless a manager is posting that held line now (lane 4).
    if (line.sessionId && !line.resolvesHeld) {
      const held = await client
        .from("stock_count_held_lines")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .eq("idempotency_key", idempotencyKey)
        .limit(1);
      if (held.error) throw transient("held replay", held.error);
      if ((held.data ?? []).length > 0) return;
    }

    // F-1544 lane 2. A glass poured from an open bottle and no new bottle
    // opened writes no stock movement (record_glass_pour books only the
    // bottles it opens), so the checks below cannot see it. A queued count of
    // the open bottles is refused after any pour of the item since, from any
    // shelf: a pour may draw on another shelf's open bottle (ADR 0285).
    if (line.countsOpenMl) {
      const poured = await client
        .from("pour_events")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .eq("inventory_id", inventoryId)
        .gt("created_at", countedAt)
        .limit(1);
      if (poured.error) throw transient("pour", poured.error);
      if ((poured.data ?? []).length > 0) {
        throw new HttpException(
          "A glass of this was poured after this count was taken, so the open bottles were not counted. Count it again.",
          HttpStatus.CONFLICT,
        );
      }
    }

    if (locationId) {
      return this.refuseShelfCountOvertaken(
        client,
        restaurantId,
        inventoryId,
        stockState,
        countedAt,
        locationId,
        transient,
        line.resolvesHeld ?? null,
      );
    }
    const asideCount = line.resolvesHeld?.countId ?? null;
    const asideMove = line.resolvesHeld?.transactionId ?? null;

    const newerCount = await client
      .from("stock_counts")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("inventory_id", inventoryId)
      .eq("stock_state", stockState)
      .gt("counted_at", countedAt)
      .limit(2);
    if (newerCount.error) throw transient("newer-count", newerCount.error);
    if (
      ((newerCount.data ?? []) as Array<{ id: string }>).some(
        (c) => c.id !== asideCount,
      )
    ) {
      throw new HttpException(
        "This item was counted again after this count was taken, so this older count was not applied.",
        HttpStatus.CONFLICT,
      );
    }

    const moved = await client
      .from("inventory_transactions")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("inventory_id", inventoryId)
      .eq("stock_type", stockState)
      .gt("transaction_date", countedAt)
      .limit(2);
    if (moved.error) throw transient("movement", moved.error);
    if (
      ((moved.data ?? []) as Array<{ id: string }>).some(
        (m) => m.id !== asideMove,
      )
    ) {
      throw new HttpException(
        "Bottles of this item were sold, received or moved after this count was taken, so it was not applied. Count it again.",
        HttpStatus.CONFLICT,
      );
    }
  }

  /** F-880: `refuseCountOvertakenByStock` for a count of one shelf. */
  private async refuseShelfCountOvertaken(
    client: ReturnType<DatabaseService["getClient"]>,
    restaurantId: string,
    inventoryId: string,
    stockState: "live" | "shadow",
    countedAt: string,
    locationId: string,
    transient: (what: string, err: { message?: string }) => HttpException,
    resolvesHeld: {
      countId: string | null;
      transactionId: string | null;
    } | null = null,
  ): Promise<void> {
    // Every count since, of any shelf: a count of THIS shelf or of every
    // shelf (no location) overtakes; another shelf's count does not, and its
    // own correcting movement is that shelf's, not this one's.
    const counts = await client
      .from("stock_counts")
      .select("id, location_id, transaction_id")
      .eq("restaurant_id", restaurantId)
      .eq("inventory_id", inventoryId)
      .eq("stock_state", stockState)
      .gt("counted_at", countedAt)
      .limit(OVERTAKEN_SCAN_LIMIT);
    if (counts.error) throw transient("newer-count", counts.error);
    const countRows = (
      (counts.data ?? []) as Array<{
        id: string;
        location_id: string | null;
        transaction_id: string | null;
      }>
    ).filter((c) => c.id !== resolvesHeld?.countId);
    if (
      countRows.some(
        (c) => c.location_id == null || c.location_id === locationId,
      )
    ) {
      throw new HttpException(
        "This shelf was counted again after this count was taken, so this older count was not applied.",
        HttpStatus.CONFLICT,
      );
    }
    const otherShelfCounts = new Set(
      countRows.map((c) => c.transaction_id).filter((t): t is string => !!t),
    );
    if (resolvesHeld?.transactionId)
      otherShelfCounts.add(resolvesHeld.transactionId);

    const moved = await client
      .from("inventory_transactions")
      .select("id, from_location_id, to_location_id, metadata")
      .eq("restaurant_id", restaurantId)
      .eq("inventory_id", inventoryId)
      .eq("stock_type", stockState)
      .gt("transaction_date", countedAt)
      .limit(OVERTAKEN_SCAN_LIMIT);
    if (moved.error) throw transient("movement", moved.error);
    const rows = (moved.data ?? []) as Array<{
      id: string;
      from_location_id: string | null;
      to_location_id: string | null;
      metadata: { lots_taken?: unknown } | null;
    }>;
    let shelfUnknown = rows.length >= OVERTAKEN_SCAN_LIMIT;
    for (const r of rows) {
      if (otherShelfCounts.has(r.id)) continue;
      const taken = r.metadata?.lots_taken;
      const transfer = r.from_location_id != null || r.to_location_id != null;
      const touched =
        r.from_location_id === locationId ||
        r.to_location_id === locationId ||
        (Array.isArray(taken) &&
          taken.some(
            (l) => (l as { location_id?: unknown })?.location_id === locationId,
          ));
      if (touched) {
        throw new HttpException(
          "Bottles on this shelf were sold, received or moved after this count was taken, so it was not applied. Count it again.",
          HttpStatus.CONFLICT,
        );
      }
      if (!transfer && !(Array.isArray(taken) && taken.length > 0))
        shelfUnknown = true;
    }
    if (shelfUnknown) {
      throw new HttpException(
        "Bottles of this item were sold, received or moved after this count was taken, and the record does not say from which shelf, so this shelf's count was not applied. Count it again.",
        HttpStatus.CONFLICT,
      );
    }
  }

  /**
   * F-1544 lane 4: the count a held line was held against, and its own
   * correction, which the overtaken check sets aside for that line. The
   * writer checks the held line itself again under its lock.
   */
  private async readHeldAgainst(
    client: ReturnType<DatabaseService["getClient"]>,
    restaurantId: string,
    heldLineId: string,
  ): Promise<{ countId: string | null; transactionId: string | null }> {
    const held = await client
      .from("stock_count_held_lines")
      .select("held_against")
      .eq("restaurant_id", restaurantId)
      .eq("id", heldLineId)
      .maybeSingle();
    if (held.error) {
      this.logger.error(`Held line read failed: ${held.error.message}`);
      throw new HttpException(
        "The held line could not be read just now. Try again.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const countId =
      (held.data as { held_against?: string | null } | null)?.held_against ??
      null;
    if (!countId) return { countId: null, transactionId: null };
    const against = await client
      .from("stock_counts")
      .select("transaction_id")
      .eq("restaurant_id", restaurantId)
      .eq("id", countId)
      .maybeSingle();
    if (against.error) {
      this.logger.error(`Held-against read failed: ${against.error.message}`);
      throw new HttpException(
        "The held line could not be read just now. Try again.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return {
      countId,
      transactionId:
        (against.data as { transaction_id?: string | null } | null)
          ?.transaction_id ?? null,
    };
  }

  /**
   * F-1544 lane 4: the two acts of a stock-take's review that reach the
   * database through a function, kept beside the one count writer's call
   * because sign-off stamps last_counted_at, the writer's own stamp (F-1165).
   * Neither writes a count: a recount clears a shelf's done and sets its
   * held lines aside; a sign-off closes the walk and stamps the items it
   * counted on every shelf they sit on. The house is the token's.
   */
  async askShelfRecount(
    restaurantId: string,
    sessionId: string,
    locationId: string,
    askedBy: string,
    seenRound: number,
  ): Promise<Record<string, unknown>> {
    return this.countReviewCall("ask_stock_count_shelf_recount", {
      p_session_id: sessionId,
      p_restaurant_id: restaurantId,
      p_location_id: locationId,
      p_asked_by: askedBy,
      p_seen_round: seenRound,
    });
  }

  async signOffCountSession(
    restaurantId: string,
    sessionId: string,
    signedOffBy: string,
    evenIfUnfinished: boolean,
  ): Promise<Record<string, unknown>> {
    return this.countReviewCall("sign_off_stock_count_session", {
      p_session_id: sessionId,
      p_restaurant_id: restaurantId,
      p_signed_off_by: signedOffBy,
      p_even_if_unfinished: evenIfUnfinished,
    });
  }

  private async countReviewCall(
    fn: "ask_stock_count_shelf_recount" | "sign_off_stock_count_session",
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const { data, error } = await this.dbService.getClient().rpc(fn, args);
    if (error) {
      // The function's own refusals are said in words; anything else is
      // the house's, and the manager tries again.
      if ((error as { code?: string }).code === "22023") {
        throw new HttpException(String(error.message), HttpStatus.CONFLICT);
      }
      if ((error as { code?: string }).code === "42501") {
        throw new HttpException(
          "That is not part of this house's count.",
          HttpStatus.NOT_FOUND,
        );
      }
      this.logger.error(`${fn} failed: ${error.message}`);
      throw new HttpException(
        "The count could not be changed just now. Try again in a moment.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return (data ?? {}) as Record<string, unknown>;
  }

  /** The item's bottle size, for tenths of a bottle (ADR 0297's stand-in when unset). */
  private async readBottleSizeMl(
    client: ReturnType<DatabaseService["getClient"]>,
    restaurantId: string,
    inventoryId: string,
  ): Promise<number | null> {
    const { data, error } = await client
      .from("restaurant_inventory")
      .select("bottle_size_ml")
      .eq("restaurant_id", restaurantId)
      .eq("id", inventoryId)
      .maybeSingle();
    if (error) {
      this.logger.error(`Spot count bottle size read failed: ${error.message}`);
      throw new HttpException(
        "The bottle size could not be read just now, so nothing was counted. It will be tried again.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const size = (data as { bottle_size_ml?: number | null } | null)
      ?.bottle_size_ml;
    return size == null ? null : Number(size);
  }

  /**
   * F-1544 lane 2: a line names a stock-take of this house, and an opening
   * stock-take's lines are opening counts (ADR 0335 §2-3; the controller lets
   * only an owner or a manager send one). Any other stock-take's lines are
   * counts. The writer checks the house again under its lock.
   */
  private async assertCountLineFitsSession(
    client: ReturnType<DatabaseService["getClient"]>,
    restaurantId: string,
    sessionId: string,
    opening: boolean,
  ): Promise<void> {
    const { data, error } = await client
      .from("stock_count_sessions")
      .select("id, kind")
      .eq("restaurant_id", restaurantId)
      .eq("id", sessionId)
      .maybeSingle();
    if (error) {
      this.logger.error(`Spot count session read failed: ${error.message}`);
      throw new HttpException(
        "The stock-take could not be read just now, so nothing was counted. It will be tried again.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!data) {
      throw new HttpException(
        "That stock-take is not one of this house's, so nothing was counted.",
        HttpStatus.NOT_FOUND,
      );
    }
    const isOpening = (data as { kind?: string }).kind === "opening";
    if (isOpening !== opening) {
      throw new HttpException(
        isOpening
          ? "This stock-take loads opening stock, so its lines are opening counts. Nothing was counted."
          : "Opening stock is not counted in this stock-take. Nothing was counted.",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Spot count (SimPOS testbed plan, decisions E40-E43): per-item count with
   * immediate adjustment.
   *
   * ADR 0078 — A COUNT IS A RECORD. This used to call set_stock_absolute and
   * treat the resulting ledger delta as the evidence a count happened. It could
   * not be: set_stock_absolute returns NULL on a zero delta and
   * inventory_transactions CHECKs quantity_change <> 0, so a count that AGREED
   * wrote nothing at all and any variance rate over the ledger was 1.0 by
   * construction. It now goes through record_stock_count, which writes the count
   * unconditionally and applies a movement only as a consequence of a non-zero
   * difference. That RPC also takes the row lock and reads the expected quantity
   * under it, so the count is still safe against a concurrent manual override —
   * the property set_stock_absolute was introduced for (decision A11).
   */
  async recordSpotCount(
    restaurantId: string,
    inventoryId: string,
    dto: {
      countedQty: number;
      stockState?: "live" | "shadow";
      clientCountId: string;
      reason?: string;
      performedBy?: string | null;
      /** How long ago a queued count was taken, at send time (F-249). */
      countedAgoMs?: number;
      // F-291: the shelf that was counted. Absent = every shelf at once.
      locationId?: string | null;
      /**
       * F-1514, ADR 0335 §2: an opening count, the first count variance is
       * measured FROM, never a variance itself. Kept as source 'import' and
       * movement 'initial', which the month close leaves out of its count
       * variance. The caller checks the person may load opening stock.
       */
      opening?: boolean;
      /**
       * F-1524: an opening count's cost per bottle (the file's). Applied by
       * record_stock_count only when the wine has no live costed lot, so a
       * real cost is never overwritten; `count.costApplied` says which.
       */
      costPerBottle?: number | null;
      costProvenance?: "invoice" | "estimated" | "manual";
      /**
       * F-1544 lane 2: the stock-take this line belongs to (founder
       * 2026-10-12, F2 a: it posts now, as its counter; a second line for the
       * same shelf in the same walk is held). Absent = a spot count, exactly
       * as before.
       */
      sessionId?: string | null;
      /** F3 a: what is left in the open bottles, in ml. */
      openMl?: number | null;
      /** F3 a: the same, in tenths of a bottle, as staff enter it. */
      openTenths?: number | null;
      /** The counter's role in the house, for a line older than 72 h (ADR 0286). */
      role?: string | null;
    },
    /**
     * F-1544 lane 4: a manager posting a line held as a second count of its
     * shelf, as its own counter at its own moment. A separate argument, never
     * the body: the spot-count route spreads its body into `dto`, so a field
     * there would let anyone name a held line.
     */
    resolve?: { heldLineId: string; resolvedBy: string | null } | null,
  ) {
    // An age past the epoch is not a time anyone counted at, and one past
    // Date's range made the replay check throw a RangeError (a 500) instead
    // of refusing the request.
    if (
      dto.countedAgoMs != null &&
      !(
        Number.isFinite(Number(dto.countedAgoMs)) &&
        Number(dto.countedAgoMs) >= 0 &&
        Number(dto.countedAgoMs) <= Date.now()
      )
    ) {
      throw new HttpException(
        "The time this count was taken could not be read, so it was not applied. Count the item again.",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (
      dto.countedQty == null ||
      Number.isNaN(Number(dto.countedQty)) ||
      dto.countedQty < 0
    ) {
      throw new HttpException(
        "countedQty must be a non-negative number",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!dto.clientCountId) {
      throw new HttpException(
        "clientCountId is required (client-generated, for retry-safe idempotency)",
        HttpStatus.BAD_REQUEST,
      );
    }
    // F-1524: a cost goes only with an opening count. A count of a wine on
    // the shelf is not a price.
    const openingCost = dto.costPerBottle ?? null;
    if (openingCost !== null) {
      if (!dto.opening) {
        throw new HttpException(
          "A cost per bottle can only be given with the opening stock, so this count was not applied.",
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!(Number.isFinite(Number(openingCost)) && Number(openingCost) >= 0)) {
        throw new HttpException(
          "The cost per bottle could not be read, so this count was not applied.",
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // F-1544 lane 2 (F3 a): open bottles, in ml or in tenths, never both.
    const namesOpenMl = dto.openMl != null;
    const namesOpenTenths = dto.openTenths != null;
    if (namesOpenMl && namesOpenTenths) {
      throw new HttpException(
        "Say what is left in the open bottles once, in tenths or in ml, not both. Nothing was counted.",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (
      namesOpenMl &&
      !(Number.isInteger(Number(dto.openMl)) && Number(dto.openMl) >= 0)
    ) {
      throw new HttpException(
        "What is left in the open bottles could not be read, so nothing was counted.",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (namesOpenTenths && openTenthsToMl(dto.openTenths, null) === null) {
      throw new HttpException(
        "What is left in the open bottles could not be read, so nothing was counted.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const sessionId = dto.sessionId ? String(dto.sessionId) : null;

    const client = this.dbService.getClient();
    const stockState = dto.stockState ?? "live";
    // Decision E43: client-generated so a retry over flaky signal (the
    // counting UI's declared use case) cannot double-apply a count that
    // already landed but whose response never made it back.
    // The SAME key covers the stock_counts row and the movement (ADR 0078):
    // the count row's unique index is the single replay gate, so a retry that
    // already landed returns the original count and never reaches
    // apply_stock_movement. Before this table there was nothing to duplicate on
    // an agreeing count, so this constraint is created by the fix, not inherited
    // from it.
    const idempotencyKey = `count:${inventoryId}:${dto.clientCountId}`;
    // F-777. When the count was taken, on the server's clock (the phone only
    // says how long ago). It is checked against below AND stored as the
    // count's time: stored as its arrival instead, the older of two queued
    // counts of one item read as the newer, and the newer was refused.
    const countedAt =
      dto.countedAgoMs == null
        ? null
        : new Date(Date.now() - Number(dto.countedAgoMs)).toISOString();

    // ADR 0141, Correction 2026-09-12. This path takes an inventory id from
    // the URL and hands it to a SQL wrapper that derives the house from the
    // item itself, so without this check a caller could move another
    // house's stock -- the adversarial pass drained a foreign house's lots
    // 9 to 0 through the same shape. It runs BEFORE the RPC: a check that
    // ran afterwards would refuse the response after the stock had moved.
    await assertInventoryBelongsToRestaurant(
      client,
      restaurantId,
      inventoryId,
      "recordSpotCount",
      this.logger,
    );
    const openMl = namesOpenTenths
      ? openTenthsToMl(
          dto.openTenths,
          await this.readBottleSizeMl(client, restaurantId, inventoryId),
        )
      : namesOpenMl
        ? Number(dto.openMl)
        : null;
    if (sessionId) {
      await this.assertCountLineFitsSession(
        client,
        restaurantId,
        sessionId,
        dto.opening === true,
      );
      // ADR 0286, which names counts: a line taken more than 72 h before it
      // reached the server is kept only on an owner's or a manager's word.
      // It is refused, never re-dated to now: a count dated at its arrival
      // is a count of a moment nobody counted at (F-777). Lines of a walk
      // only, so a spot count is exactly what it was.
      if (countedAt != null) {
        const fact = resolveFactTime({
          sentAt: countedAt,
          receivedAt: new Date(),
          role: dto.role ?? null,
        });
        if (fact.reason === "too_old") {
          throw new HttpException(
            "This count was taken more than 3 days ago. An owner or a manager can enter it; otherwise count this shelf again.",
            HttpStatus.CONFLICT,
          );
        }
      }
    }
    if (resolve && !sessionId) {
      throw new HttpException(
        "A held line belongs to a stock-take, so it was not posted.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const resolvesHeld = resolve
      ? await this.readHeldAgainst(client, restaurantId, resolve.heldLineId)
      : null;
    await this.refuseCountOvertakenByStock(
      client,
      restaurantId,
      inventoryId,
      stockState,
      idempotencyKey,
      dto.countedAgoMs,
      countedAt,
      dto.locationId ?? null,
      { sessionId, countsOpenMl: openMl !== null, resolvesHeld },
    );
    const { data: countResult, error: rpcErr } = await client.rpc(
      "record_stock_count",
      {
        p_inventory_id: inventoryId,
        p_counted_qty: Math.round(Number(dto.countedQty)),
        p_idempotency_key: idempotencyKey,
        p_stock_state: stockState,
        p_source: dto.opening ? OPENING_COUNT_SOURCE : "mobile_count",
        p_transaction_type: dto.opening ? "initial" : "reconciliation",
        p_performed_by: dto.performedBy ?? null,
        p_reason: dto.reason ?? (dto.opening ? "Opening stock" : "Spot count"),
        p_counted_at: countedAt,
        // F-291: with a shelf, record_stock_count compares and corrects that
        // shelf only. Sent only when set, so a count of every shelf calls the
        // function exactly as before.
        ...(dto.locationId ? { p_location_id: dto.locationId } : {}),
        // F-1524: sent only with a cost, so every other count calls the
        // function exactly as before. 'manual': a person typed it in a file.
        ...(openingCost !== null
          ? {
              p_unit_cost: Number(openingCost),
              p_cost_provenance: dto.costProvenance ?? "manual",
            }
          : {}),
        // F-1544 lane 2: sent only when named, so a spot count calls the
        // function exactly as before.
        ...(openMl !== null ? { p_counted_open_ml: openMl } : {}),
        ...(sessionId ? { p_session_id: sessionId } : {}),
        // F-1544 lane 4: sent only when a held line is named.
        ...(resolve
          ? {
              p_resolves_held_line: resolve.heldLineId,
              p_resolved_by: resolve.resolvedBy,
            }
          : {}),
      },
    );
    if (rpcErr) {
      this.logger.error(
        `Spot count record_stock_count failed: ${rpcErr.message}`,
      );
      // F-250: only the function's own refusals (bad input, a missing item,
      // a foreign item) are the request's fault. A dropped connection, a
      // timeout or a lock that gave up is the house's, and a 400 made the
      // phone park a queued count as "not sent" instead of trying it again.
      throw new HttpException(
        rpcErr.message,
        isRequestFaultDbError(rpcErr)
          ? HttpStatus.BAD_REQUEST
          : HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // Decision E41 stands but is no longer load-bearing: last_counted_at is
    // stamped inside record_stock_count's transaction (previously a separate
    // round trip here whose failure was only a warn, so a count could leave no
    // trace at all and still report success). It survives as a denormalised
    // MAX(counted_at) cache for the list's freshness badge — stock_counts is now
    // the evidence a count happened.

    // OD-59 / P3.0: the count just committed is ground truth for whatever the
    // photo-count model last suggested for this item. Fire-and-forget and after
    // the stock write, so a stumbling instrument cannot turn a count that
    // succeeded into an error the staff member sees.
    // F-1544 lane 2: a held line (a second count of its shelf in one
    // stock-take) committed nothing, so it grades nothing.
    const count = mapStockCountResult(countResult);
    if (!count?.held) {
      void this.gradePhotoCountSuggestion(
        inventoryId,
        Math.round(Number(dto.countedQty)),
      );
    }

    const [row, rollup, locations] = await Promise.all([
      client
        .from("restaurant_inventory")
        .select(
          `*, master_wine_library (*), restaurants (default_pour_ml, measurement_unit)`,
        )
        .eq("restaurant_id", restaurantId)
        .eq("id", inventoryId)
        .single(),
      this.fetchLotRollup(restaurantId),
      this.fetchLocationBreakdown(restaurantId),
    ]);

    if (this.lowStockAlerts) {
      void this.lowStockAlerts
        .evaluateInventoryItem(restaurantId, inventoryId)
        .catch(() => undefined);
    }

    return {
      item: row.data
        ? this.mapInventoryItem(
            row.data,
            rollup.get(inventoryId),
            locations.get(inventoryId),
          )
        : null,
      // ADR 0078: the count itself, including the case that used to be invisible
      // — variance 0 with a null transactionId means "counted, and the books were
      // right", which is a result and not missing data.
      count,
    };
  }

  /**
   * Photo counting (decision E46) — a vision suggestion only. Never writes
   * anything; the caller drops the result into the same quantity field the
   * voice path fills, and the human still has to call recordSpotCount.
   */
  async estimateCountFromPhoto(
    restaurantId: string,
    inventoryId: string,
    imageBase64: string,
  ) {
    if (!imageBase64) {
      throw new HttpException(
        "imageBase64 is required",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!this.photoCountService) {
      throw new HttpException(
        "Photo count estimation is not available",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const client = this.dbService.getClient();
    const { data: item } = await client
      .from("restaurant_inventory")
      .select("wine_name, master_wine_library(name)")
      .eq("restaurant_id", restaurantId)
      .eq("id", inventoryId)
      .maybeSingle();

    const wineName =
      item?.wine_name ||
      (item as any)?.master_wine_library?.name ||
      "this wine";

    // OD-59 / P3.0: record what the model suggested so the count a human commits
    // minutes later can grade it. This is NOT a stock write — the E46 posture is
    // unchanged and `restaurant_inventory` stays the only place a quantity means
    // anything. It is the join that never existed: until now the suggestion went
    // to the browser and was forgotten, so the model's answer and the truth
    // lived at different times and could never be compared.
    const eventRef = new NfEventRef();
    const estimate = await this.photoCountService.estimate(
      imageBase64,
      wineName,
      restaurantId,
      eventRef,
    );

    // Fire-and-forget, and deliberately: a suggestion that cannot be recorded
    // must not fail the count the staff member is standing there doing. The
    // instrument never breaks the thing it measures.
    void this.recordPhotoCountSuggestion(
      eventRef,
      restaurantId,
      inventoryId,
      estimate,
    );

    return estimate;
  }

  private async recordPhotoCountSuggestion(
    eventRef: NfEventRef,
    restaurantId: string,
    inventoryId: string,
    estimate: { suggestedQty: number | null; confidence: string },
  ): Promise<void> {
    try {
      // The emit is fire-and-forget, so the row id arrives late — or never, if
      // the emit was dropped, in which case the ref settles null and this
      // suggestion simply cannot be graded. Recording it anyway keeps the count
      // of ungraded suggestions honest.
      const eventId = await eventRef.id;
      const { error } = await this.dbService
        .getClient()
        .from("photo_count_suggestions")
        .insert({
          event_id: eventId,
          restaurant_id: restaurantId,
          inventory_id: inventoryId,
          suggested_qty: estimate.suggestedQty,
          confidence: estimate.confidence,
        });
      if (error) {
        this.logger.warn(
          `Photo-count suggestion not recorded (${inventoryId}): ${error.message}`,
        );
      }
    } catch (err: any) {
      this.logger.warn(
        `Photo-count suggestion not recorded (${inventoryId}): ${err?.message ?? err}`,
      );
    }
  }

  /**
   * Grade the most recent unmatched photo-count suggestion for this item
   * against the number a human just committed (OD-59, `human_count_v1`).
   *
   * The only grader in the gateway that compares a model's answer to ground
   * truth from the world rather than to the model's own output.
   *
   * Never throws and never blocks the count: called after the stock write has
   * already succeeded, and every failure inside is a warn. A count that
   * succeeded must not be reported as failed because the instrument stumbled.
   */
  private async gradePhotoCountSuggestion(
    inventoryId: string,
    countedQty: number,
  ): Promise<void> {
    if (!this.nfVerdicts) return;
    try {
      const client = this.dbService.getClient();
      const { data: suggestion, error } = await client
        .from("photo_count_suggestions")
        .select("id, event_id, suggested_qty, confidence")
        .eq("inventory_id", inventoryId)
        .is("graded_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !suggestion) return;

      // No event id means the emit was dropped: there is no row to attach a
      // verdict to. Close the suggestion out anyway so it stops appearing in
      // the pending queue forever.
      if (suggestion.event_id) {
        this.nfVerdicts.recordForEvent(
          suggestion.event_id,
          HUMAN_COUNT_BASIS,
          humanCountVerdict({
            suggestedQty: suggestion.suggested_qty ?? null,
            countedQty,
            confidence: suggestion.confidence ?? null,
          }),
        );
      }

      await client
        .from("photo_count_suggestions")
        .update({
          graded_at: new Date().toISOString(),
          counted_qty: countedQty,
        })
        .eq("id", suggestion.id);
    } catch (err: any) {
      this.logger.warn(
        `Photo-count re-grade skipped for ${inventoryId}: ${err?.message ?? err}`,
      );
    }
  }

  async getLowStockItems(restaurantId: string) {
    this.logger.log(`Fetching low stock items for restaurant: ${restaurantId}`);
    return await this.dbService.getLowStockItems(restaurantId);
  }

  /**
   * Activity for one inventory item, powering the row-expansion insight cards:
   *   - daily: movements and sales per day for the last 14 days (velocity
   *            chart draws `sold`)
   *   - heat:  7x8 matrix (Mon..Sun x 4pm..11pm) of bottles sold over the
   *            last 28 days (busy-hours heatmap)
   * Sourced from the inventory_transactions ledger. `out`/`in` are every
   * movement off/onto the shelf; `sold` and `heat` are sales only (F-1595).
   */
  async getItemActivity(restaurantId: string, itemId: string) {
    const client = this.dbService.getClient();
    const since = new Date();
    since.setDate(since.getDate() - 28);

    // Read whole or refused (ADR 0292, F-334). This was ascending with
    // `.limit(2000)`, which PostgREST's 1,000-row cap cut to the OLDEST 1,000
    // movements, so a fast mover's last days drew as zero.
    let data: any[];
    try {
      data = await readWholeWindow<any>(
        "This item's movements in the last 28 days",
        () =>
          client
            .from("inventory_transactions")
            .select("*", { count: "exact" })
            .eq("restaurant_id", restaurantId)
            .eq("inventory_id", itemId)
            .gte("created_at", since.toISOString()),
      );
    } catch (err: any) {
      // A FAILED READ IS NOT AN EMPTY LEDGER (ADR 0067). Returning zeroes here
      // made an outage indistinguishable from a shelf nothing had moved on.
      const message = err?.message ?? String(err);
      this.logger.error(`getItemActivity ledger query failed: ${message}`);
      throw new Error(
        `the movement history of item ${itemId} could not be read (${message}). Nothing is claimed about this shelf — an empty chart here would mean "nothing moved", which is not what we know.`,
      );
    }

    // The house's clock files each movement (F-323): on the server's UTC
    // clock an LA dinner pour (17:00-23:59) read as 00:00-06:59, fell below
    // the 16:00 slot and was dropped, and tonight's bars sat on tomorrow. No
    // zone keeps the server's clock, as before.
    const { zone } = await readHouseZone(client, restaurantId);
    const wallAt = (d: Date): WallReading =>
      zone
        ? houseWallAt(d, zone)
        : {
            dateKey: d.toISOString().slice(0, 10),
            minutes: d.getHours() * 60 + d.getMinutes(),
          };
    const outMap = new Map<string, number>();
    const inMap = new Map<string, number>();
    const soldMap = new Map<string, number>();
    // heat[dow][slot]: dow 0=Mon..6=Sun, slot 0..7 = 16:00..23:00. Sales
    // only — the heatmap answers "when do we pour this", and a truck arriving
    // at 17:00 is not a busy hour, nor is 12 bottles carried from the cellar
    // to the bar, a broken bottle, a comp or a count correction (F-1595).
    const heat: number[][] = Array.from({ length: 7 }, () => Array(8).fill(0));
    let totalOut = 0;
    let totalIn = 0;

    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    for (const row of data) {
      const qty = Number(row.quantity_change ?? row.quantity ?? 0);
      if (!Number.isFinite(qty) || qty === 0) continue;
      const type = String(row.transaction_type || "").toLowerCase();
      // Sign is the classifier. The type list stays only because some depletion
      // writers record a positive magnitude; dropping it would move numbers
      // that were already being reported correctly.
      const isOut = qty < 0 || ["sale", "pour", "glass_pour"].includes(type);
      const magnitude = Math.abs(qty);
      const ts = new Date(row.created_at);
      const wall = wallAt(ts);
      const k = wall.dateKey;

      // F-1595: a sale counts as the inventory_analytics view counts it — a
      // sale or pour, less a return the till sent back. A transfer's out leg,
      // breakage, a comp and a count correction are movements, not sales.
      const sold = ["sale", "pour", "glass_pour"].includes(type)
        ? magnitude
        : type === "return" &&
            String(row.source || "").toLowerCase() === "pos" &&
            qty > 0
          ? -magnitude
          : 0;
      if (sold !== 0) {
        if (ts >= fourteenDaysAgo) soldMap.set(k, (soldMap.get(k) ?? 0) + sold);
        const dow = (new Date(`${k}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon=0
        const slot = Math.floor(wall.minutes / 60) - 16;
        if (slot >= 0 && slot < 8) heat[dow][slot] += sold;
      }

      if (isOut) {
        totalOut += magnitude;
        if (ts >= fourteenDaysAgo)
          outMap.set(k, (outMap.get(k) ?? 0) + magnitude);
      } else {
        // EVERY inbound writer, named or not: a delivery booking
        // (`reference_type = 'delivery'`, `transaction_type = 'purchase'`), a
        // manual adjustment, a transfer in. Before 2026-09-06 this branch did
        // not exist and a booked delivery left no trace on this door at all.
        totalIn += magnitude;
        if (ts >= fourteenDaysAgo)
          inMap.set(k, (inMap.get(k) ?? 0) + magnitude);
      }
    }

    // Dense 14-day series (zero-filled) so the chart has a stable x-axis.
    // A return is never more than a sale in a day or an hour on the chart.
    const daily: Array<{
      date: string;
      out: number;
      in: number;
      sold: number;
    }> = [];
    const today = wallAt(new Date()).dateKey;
    for (let i = 13; i >= 0; i--) {
      const k = shiftHouseDay(today, -i);
      daily.push({
        date: k,
        out: outMap.get(k) ?? 0,
        in: inMap.get(k) ?? 0,
        sold: Math.max(0, soldMap.get(k) ?? 0),
      });
    }
    for (const row of heat)
      for (let s = 0; s < row.length; s++) row[s] = Math.max(0, row[s]);

    // F-1165: which shelf was counted when. A count of one shelf no longer
    // stamps the wine's last_counted_at (migration
    // an_open_bottle_stays_and_a_shelf_count_stays_on_its_shelf), so each
    // shelf's newest count is read from stock_counts.location_id. `null` is an
    // answer we do not have -- a failed read, or more rows than one read holds
    // -- never "no shelf was ever counted".
    let shelfCounts: Array<{ locationId: string; countedAt: string }> | null =
      null;
    const counts = await client
      .from("stock_counts")
      .select("location_id, counted_at")
      .eq("restaurant_id", restaurantId)
      .eq("inventory_id", itemId)
      .eq("stock_state", "live")
      .not("location_id", "is", null)
      .order("counted_at", { ascending: false })
      .limit(SHELF_COUNT_SCAN);
    if (counts.error) {
      this.logger.error(
        `getItemActivity shelf-count read failed: ${counts.error.message}`,
      );
    } else if ((counts.data ?? []).length < SHELF_COUNT_SCAN) {
      const newest = new Map<string, string>();
      for (const r of (counts.data ?? []) as Array<{
        location_id: string | null;
        counted_at: string;
      }>) {
        if (r.location_id && !newest.has(r.location_id))
          newest.set(r.location_id, r.counted_at);
      }
      shelfCounts = [...newest].map(([locationId, countedAt]) => ({
        locationId,
        countedAt,
      }));
    }

    return {
      shelfCounts,
      daily,
      heat,
      totalOut28d: totalOut,
      totalIn28d: totalIn,
      // The door SAYS what it counted. A zeroed series means "these movements
      // did not happen", never "this kind of movement is not looked at".
      includes: {
        out: "movements off the shelf: any negative quantity_change, plus sale/pour/glass_pour rows recorded as a positive magnitude",
        in: "movements onto the shelf: any other positive quantity_change, including deliveries booked at the door (reference_type 'delivery'), manual adjustments and transfers in",
        sold: "bottles sold: sale and pour rows, less returns from the till; a move between shelves, breakage, a comp or a count correction is not a sale. The busy-hours grid counts the same",
        window: "28 days for the totals, the last 14 days for the daily series",
      },
    };
  }

  async getInventoryItem(restaurantId: string, itemId: string) {
    const client = this.dbService.getClient();

    const { data, error } = await client
      .from("restaurant_inventory")
      .select(
        `
        *,
        master_wine_library (bottle_size_ml),
        restaurants (default_pour_ml, measurement_unit)
      `,
      )
      .eq("restaurant_id", restaurantId)
      .eq("id", itemId)
      .single();

    if (error) throw error;
    return data ? this.mapInventoryItem(data) : null;
  }

  /**
   * Decides what cost and provenance a new lot carries.
   *
   * A free sample is a deliberate $0, not a missing price — recording it as
   * unit_cost 0 with provenance 'invoice' (the RPC's historical inference) would
   * pull weighted-average cost toward zero and understate COGS, while recording it
   * as NULL would be indistinguishable from "nobody typed the price in".
   */
  private resolveLotCost(dto: {
    costPerBottle?: number | null;
    costProvenance?: string;
  }): { unitCost: number | null; provenance: string | null } {
    if (dto.costProvenance === "sample") {
      return { unitCost: 0, provenance: "sample" };
    }
    const unitCost = dto.costPerBottle ?? null;
    return {
      provenance: dto.costProvenance ?? (unitCost !== null ? "manual" : null),
      unitCost,
    };
  }

  /**
   * Create a new inventory item
   */
  /**
   * The house's default par (`restaurants.default_threshold_min`), for a new
   * row the person gave no par for. The column's own default (3) stands in
   * when the house row cannot be read, as it does for a menu import; the
   * failed read is logged so the stand-in is never silent.
   */
  private async houseDefaultParMin(restaurantId: string): Promise<number> {
    const { data, error } = await this.dbService
      .getClient()
      .from("restaurants")
      .select("default_threshold_min")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logger.warn(
        `house ${restaurantId}: default par unread (${error.message}); using ${HOUSE_PAR_MIN_FALLBACK}`,
      );
      return HOUSE_PAR_MIN_FALLBACK;
    }
    const value = (data as { default_threshold_min?: unknown } | null)
      ?.default_threshold_min;
    return typeof value === "number" ? value : HOUSE_PAR_MIN_FALLBACK;
  }

  async createInventoryItem(
    restaurantId: string,
    dto: CreateInventoryItemDto,
    // ADR 0193, founder 2026-09-21 (answer 5): "pass the person through on
    // add-wine ... so every price version names who set it". From the
    // verified JWT; the controller has already refused a priced create by
    // anyone but an owner or manager.
    actorUserId: string | null = null,
  ) {
    const client = this.dbService.getClient();
    // F-435: the item's shelf and its first lot's zone must be this house's.
    // Checked before anything is written, re-activation included.
    // F-1334: and live. Received bottles filed under a deleted zone are lost.
    await assertLocationsBelongToRestaurant(
      client,
      restaurantId,
      [dto.storageLocationId],
      "createInventoryItem",
      this.logger,
      { liveOnly: true },
    );

    // Look up the canonical wine name once; used in both the re-activation and INSERT paths.
    let masterWineName: string | null = null;
    try {
      const { data: mw } = await client
        .from("master_wine_library")
        .select("name")
        .eq("id", dto.wineId)
        .single();
      masterWineName = mw?.name ?? null;
    } catch {
      /* non-fatal — wine_name stays null */
    }

    // Check if this wine already exists in the restaurant's inventory (active OR soft-deleted)
    const { data: existing } = await client
      .from("restaurant_inventory")
      .select("id, is_active")
      .eq("restaurant_id", restaurantId)
      .eq("master_wine_id", dto.wineId)
      .single();

    if (existing) {
      if (!existing.is_active) {
        // Soft-deleted item: re-activate it so the order can proceed. What the
        // add form says is applied, as on the insert path below; what it leaves
        // blank keeps the wine's own value — a re-add without a vendor no
        // longer clears the vendor it had (F-693).
        const reactivation: Record<string, any> = {
          is_active: true,
          stock_live: 0, // applied as a lot via apply_stock_movement below
          ...(masterWineName ? { wine_name: masterWineName } : {}),
        };
        if (dto.providerId) reactivation.provider_id = dto.providerId;
        if (dto.thresholdMin) reactivation.threshold_min = dto.thresholdMin;
        if (dto.thresholdMax) reactivation.threshold_max = dto.thresholdMax;
        if (dto.saleType !== undefined) reactivation.sale_type = dto.saleType;
        if (dto.pourSizeMl !== undefined)
          reactivation.pour_size_ml = dto.pourSizeMl;
        if (dto.bottleSizeMl !== undefined)
          reactivation.bottle_size_ml = dto.bottleSizeMl;
        if (dto.glassesPerBottleOverride !== undefined)
          reactivation.glasses_per_bottle_override =
            dto.glassesPerBottleOverride;
        if (dto.storageLocationId !== undefined)
          reactivation.storage_location_id = dto.storageLocationId;
        const { data: reactivated, error: reactivateError } = await client
          .from("restaurant_inventory")
          .update(reactivation)
          .eq("id", existing.id)
          .select(
            `*, master_wine_library (name, bottle_size_ml), restaurants (default_pour_ml, measurement_unit)`,
          )
          .single();

        if (reactivateError) {
          this.logger.error(
            `Failed to reactivate inventory item: ${reactivateError.message}`,
          );
          throw new HttpException(
            reactivateError.message,
            HttpStatus.BAD_REQUEST,
          );
        }

        if (dto.stockLive && dto.stockLive > 0) {
          const { unitCost, provenance } = this.resolveLotCost(dto);
          const { error: rpcErr } = await client.rpc("apply_stock_movement", {
            p_inventory_id: existing.id,
            p_stock_state: "live",
            p_delta: dto.stockLive,
            p_transaction_type: "initial",
            p_source: "manual",
            p_reason: "stock on re-activation",
            p_unit_cost: unitCost,
            p_location_id: dto.storageLocationId ?? null,
            p_cost_provenance: provenance,
            // ADR 0141 — the house this stock is for. `existing.id` came from a
            // read scoped to this restaurant, so this agrees by construction;
            // the primitive is told anyway, because the guarantee must not rest
            // on each caller having remembered.
            p_restaurant_id: restaurantId,
          });
          // "Added with 12 bottles" must not come back as 0 in silence (F-693).
          if (rpcErr) {
            this.logger.error(
              `reactivation apply_stock_movement failed for ${existing.id}: ${rpcErr.message}`,
            );
            throw new HttpException(
              `The wine is back on your list, but its ${dto.stockLive} ` +
                `${dto.stockLive === 1 ? "bottle was" : "bottles were"} not ` +
                `recorded. Add them with a stock count.`,
              HttpStatus.INTERNAL_SERVER_ERROR,
            );
          }
        }

        this.logger.log({
          message: "Inventory item reactivated",
          restaurantId,
          wineId: dto.wineId,
          inventoryId: existing.id,
        });
        const reactPrice = await this.priceOnAdd(
          client,
          restaurantId,
          existing.id,
          dto,
          actorUserId,
        );
        const { data: freshReact } = await client
          .from("restaurant_inventory")
          .select(
            `*, master_wine_library (*), restaurants (default_pour_ml, measurement_unit)`,
          )
          .eq("id", existing.id)
          .single();
        const reactRollup = await this.fetchLotRollup(restaurantId);
        const reactMapped = this.mapInventoryItem(
          freshReact ?? reactivated,
          reactRollup.get(existing.id),
        );
        return reactPrice ? { ...reactMapped, priceChange: reactPrice } : reactMapped;
      }

      // Active item: return its ID so the caller can skip re-creation
      throw new HttpException(
        {
          message: "This wine already exists in inventory.",
          existingId: existing.id,
        },
        HttpStatus.CONFLICT,
      );
    }

    // Create the inventory item
    const insertData: Record<string, any> = {
      restaurant_id: restaurantId,
      master_wine_id: dto.wineId,
      provider_id: dto.providerId || null,
      stock_live: 0, // initial stock applied as a lot via apply_stock_movement below (lots = source of truth)
      // A par the person gave is kept, 0 included (`||` turned a stated 0 into
      // 6). With none given, the house's own default par is used, the same one
      // a menu import uses, never an invented 6 (F-209).
      threshold_min:
        dto.thresholdMin ?? (await this.houseDefaultParMin(restaurantId)),
      threshold_max: dto.thresholdMax || 24,
      toast_item_guid: dto.toastItemGuid || null,
      is_active: true,
      wine_name: masterWineName,
    };
    if (dto.saleType !== undefined) insertData.sale_type = dto.saleType;
    if (dto.pourSizeMl !== undefined) insertData.pour_size_ml = dto.pourSizeMl;
    // The house's own prices (ADR 0193: bottle = menu_price_current) are NOT
    // in this insert. They go through set_house_menu_price right after it
    // (priceOnAdd), so the wine's first menu_price_versions row names the
    // person who set it (founder, 2026-09-21, answer 5) instead of the
    // trigger's "no person was named".
    if (dto.bottleSizeMl !== undefined)
      insertData.bottle_size_ml = dto.bottleSizeMl;
    if (dto.glassesPerBottleOverride !== undefined)
      insertData.glasses_per_bottle_override = dto.glassesPerBottleOverride;
    if (dto.storageLocationId !== undefined)
      insertData.storage_location_id = dto.storageLocationId;

    const { data, error } = await client
      .from("restaurant_inventory")
      .insert(insertData)
      .select(
        `
        *,
        master_wine_library (name, bottle_size_ml),
        restaurants (default_pour_ml, measurement_unit)
      `,
      )
      .single();

    if (error) {
      this.logger.error(`Failed to create inventory item: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }

    // Initial stock enters as a lot via the RPC so lots are authoritative from creation.
    if (dto.stockLive && dto.stockLive > 0) {
      const { unitCost, provenance } = this.resolveLotCost(dto);
      const { error: rpcErr } = await client.rpc("apply_stock_movement", {
        p_inventory_id: data.id,
        p_stock_state: "live",
        p_delta: dto.stockLive,
        p_transaction_type: "initial",
        p_source: "manual",
        p_reason: "initial stock on add-to-inventory",
        p_unit_cost: unitCost,
        p_location_id: dto.storageLocationId ?? null,
        p_cost_provenance: provenance,
        // ADR 0141 — the house this stock is for. `data.id` is the row this
        // method just INSERTed with `restaurant_id: restaurantId`, so the two
        // cannot disagree; the argument is passed so the primitive never has to
        // take that on trust.
        p_restaurant_id: restaurantId,
      });
      // A wine added with 12 bottles must not come back booked with 0 —
      // fail the request the way the reactivation path does (F-1068, F-693).
      if (rpcErr) {
        this.logger.error(
          `initial apply_stock_movement failed for ${data.id}: ${rpcErr.message}`,
        );
        throw new HttpException(
          `The wine is on your list, but its ${dto.stockLive} ` +
            `${dto.stockLive === 1 ? "bottle was" : "bottles were"} not ` +
            `recorded. Add them with a stock count.`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }

    this.logger.log({
      message: "Inventory item created",
      restaurantId,
      wineId: dto.wineId,
      inventoryId: data.id,
    });

    const price = await this.priceOnAdd(client, restaurantId, data.id, dto, actorUserId);

    const { data: fresh } = await client
      .from("restaurant_inventory")
      .select(
        `*, master_wine_library (*), restaurants (default_pour_ml, measurement_unit)`,
      )
      .eq("id", data.id)
      .single();
    const rollup = await this.fetchLotRollup(restaurantId);
    const mapped = this.mapInventoryItem(fresh ?? data, rollup.get(data.id));
    return price ? { ...mapped, priceChange: price } : mapped;
  }

  /**
   * The price named when a wine is added, written through the one writer so
   * its version row names the person (ADR 0193; founder 2026-09-21, answer 5).
   * Null when no price was named. The wine itself is already saved when this
   * runs, so a refused or failed price write is RETURNED, as
   * `{ outcome: "failed", error }`, for the caller to say out loud -- never
   * swallowed into a wine that looks priced.
   */
  private async priceOnAdd(
    client: ReturnType<DatabaseService["getClient"]>,
    restaurantId: string,
    inventoryId: string,
    prices: { menuPriceBottle?: number; menuPriceGlass?: number },
    actorUserId: string | null,
  ): Promise<HousePriceResult | { outcome: "failed"; error: string } | null> {
    if (prices.menuPriceBottle === undefined && prices.menuPriceGlass === undefined) {
      return null;
    }
    try {
      return await setHouseMenuPrice(client, {
        restaurantId,
        inventoryId,
        ...(prices.menuPriceBottle !== undefined ? { bottle: prices.menuPriceBottle } : {}),
        ...(prices.menuPriceGlass !== undefined ? { glass: prices.menuPriceGlass } : {}),
        source: "manual",
        changedBy: actorUserId,
        reason: "set when the wine was added",
      });
    } catch (err: any) {
      const error = err?.message ?? String(err);
      this.logger.error(
        `wine ${inventoryId} was added but its price was not saved: ${error}`,
      );
      return { outcome: "failed", error };
    }
  }

  /**
   * Receive many wines in one call — menu scan, delivery, or sample drop.
   *
   * Differs from createInventoryItem in three ways that matter for a real receipt:
   *   1. A wine already in inventory is not a conflict. Receiving a case of
   *      something you already carry appends stock to the existing item, which is
   *      what actually happened in the cellar.
   *   2. A line may arrive as a `wineDraft` instead of a `wineId`; it is resolved
   *      against the Master Library (exact signature → name+producer → create
   *      Provisional tier 3), so scanning a menu no longer dead-ends on wines the
   *      shared library has never seen.
   *   3. One bad line does not abort the batch. Every line returns its own result
   *      keyed by original index, so the caller can show exactly what failed and
   *      let the manager retry just those rows.
   */
  async bulkCreateInventoryItems(
    restaurantId: string,
    dto: BulkCreateInventoryItemsDto,
    // ADR 0193, founder 2026-09-21 (answer 5): the person on the token, so a
    // price a new line carries is recorded under their name.
    actorUserId: string | null = null,
  ) {
    const source = dto.source || "bulk_receive";
    const results: Array<Record<string, any>> = [];
    // F-1515: the shelves each wine of an opening-stock file has landed on in
    // this request (null: no shelf). Lines are applied one at a time, so a
    // second line for the same wine COUNTS it, and a line with no shelf
    // counts every shelf: it would replace the first line's bottles.
    const openingShelves = new Map<string, Set<string | null>>();

    for (let index = 0; index < dto.items.length; index++) {
      const line = dto.items[index];
      const wineName =
        line.wineDraft?.name ||
        (line.wineId ? `wine ${line.wineId}` : "unknown");

      try {
        // F-435: a line naming another house's zone fails on its own, before
        // its wine is resolved or anything is written; the rest still land.
        await assertLocationsBelongToRestaurant(
          this.dbService.getClient(),
          restaurantId,
          [line.storageLocationId],
          "bulkCreateInventoryItems",
          this.logger,
          { liveOnly: true },
        );
        const resolved = await this.resolveBulkLineWine(line, restaurantId);
        const shelf = line.storageLocationId ?? null;
        const shelvesSoFar = openingShelves.get(resolved.masterWineId);
        if (source === "opening_stock" && shelvesSoFar) {
          if (shelf !== null && shelvesSoFar.has(shelf)) {
            throw new HttpException(
              "This wine is on an earlier line of the same file for the same shelf, so this line was not used. Nothing was changed for it.",
              HttpStatus.BAD_REQUEST,
            );
          }
          if (shelf === null || shelvesSoFar.has(null)) {
            throw new HttpException(
              "This wine is on an earlier line of the same file, and one of the two lines names no shelf. A line with no shelf counts the wine on every shelf, so it would replace the other line's bottles instead of adding to them. Nothing was changed for this line: name a shelf on each line, or list the wine once with its total.",
              HttpStatus.BAD_REQUEST,
            );
          }
        }
        const outcome = await this.receiveBulkLine(
          restaurantId,
          line,
          resolved.masterWineId,
          source,
          dto.reason,
        );
        if (source === "opening_stock") {
          openingShelves.set(
            resolved.masterWineId,
            (shelvesSoFar ?? new Set<string | null>()).add(shelf),
          );
        }
        // A NEW row's price goes through the one writer, by the person
        // (receiveBulkLine no longer puts it in the insert). An existing
        // row's price is left as it is, as before this build.
        const price =
          outcome.status === "created"
            ? await this.priceOnAdd(
                this.dbService.getClient(),
                restaurantId,
                outcome.inventoryId,
                line,
                actorUserId,
              )
            : null;

        results.push({
          index,
          status: outcome.status,
          inventoryId: outcome.inventoryId,
          ...(price
            ? {
                priceSync: price.outcome,
                ...("error" in price ? { priceError: price.error } : {}),
              }
            : {}),
          masterWineId: resolved.masterWineId,
          wineName: resolved.wineName || wineName,
          libraryMatched: resolved.matched,
          libraryTier: resolved.libraryTier,
          // ADR 0130: this line's name was too generic to join the shared
          // library, so it became this venue's own wine. Reported so the
          // receiving screen can say that rather than implying a library hit.
          venueProvisional: resolved.provisional,
        });
      } catch (error: any) {
        const message =
          error instanceof HttpException
            ? ((error.getResponse() as any)?.message ?? error.message)
            : error?.message || "Failed to receive line";
        this.logger.warn({
          message: "Bulk receive line failed",
          restaurantId,
          index,
          wineName,
          error: message,
        });
        results.push({ index, status: "failed", wineName, error: message });
      }
    }

    const tally = (status: string) =>
      results.filter((r) => r.status === status).length;

    const summary = {
      created: tally("created"),
      stockAdded: tally("stock_added"),
      counted: tally("counted"),
      reactivated: tally("reactivated"),
      failed: tally("failed"),
      results,
    };

    this.logger.log({
      message: "Bulk receive complete",
      restaurantId,
      source,
      lines: dto.items.length,
      ...summary,
      results: undefined,
    });

    return summary;
  }

  /** Resolves a bulk line to a master wine ID, creating a Provisional row if needed. */
  private async resolveBulkLineWine(
    line: BulkInventoryLineDto,
    restaurantId: string,
  ): Promise<{
    masterWineId: string;
    wineName: string | null;
    matched: boolean;
    libraryTier: number | null;
    provisional?: boolean;
  }> {
    const client = this.dbService.getClient();

    if (line.wineId) {
      const { data: mw } = await client
        .from("master_wine_library")
        .select("id, name, library_tier")
        .eq("id", line.wineId)
        .maybeSingle();

      if (!mw?.id) {
        throw new HttpException(
          `Wine ${line.wineId} is not in the master library`,
          HttpStatus.BAD_REQUEST,
        );
      }
      return {
        masterWineId: mw.id,
        wineName: mw.name ?? null,
        matched: true,
        libraryTier: mw.library_tier ?? null,
      };
    }

    if (!line.wineDraft?.name) {
      throw new HttpException(
        "Each line needs either wineId or wineDraft.name",
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!this.wineSubmissions) {
      throw new HttpException(
        "Library resolution is unavailable — send a wineId instead of a wineDraft",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const resolution = await this.wineSubmissions.resolveOrCreateLibraryWine(
      {
        name: line.wineDraft.name,
        producer: line.wineDraft.producer ?? null,
        vintage: line.wineDraft.vintage ?? null,
        country: line.wineDraft.country ?? null,
        region: line.wineDraft.region ?? null,
        grapeVariety: line.wineDraft.grapeVariety ?? null,
        // Lets the library row classify a beer as beer (F-740).
        menuCategory: line.wineDraft.category ?? null,
      },
      restaurantId,
    );

    return {
      masterWineId: resolution.masterWineId,
      wineName: line.wineDraft.name,
      matched: resolution.matched,
      libraryTier: resolution.libraryTier,
      provisional: resolution.provisional,
    };
  }

  /**
   * Applies one resolved line: creates the inventory row, revives a soft-deleted
   * one, or tops up an active one, then books the bottles as a lot.
   */
  private async receiveBulkLine(
    restaurantId: string,
    line: BulkInventoryLineDto,
    masterWineId: string,
    source: string,
    reason?: string,
  ): Promise<{ status: string; inventoryId: string }> {
    const client = this.dbService.getClient();
    const qty = line.stockLive ?? 0;

    const { data: existing } = await client
      .from("restaurant_inventory")
      .select("id, is_active")
      .eq("restaurant_id", restaurantId)
      .eq("master_wine_id", masterWineId)
      .maybeSingle();

    let inventoryId: string;
    let status: string;

    if (existing?.id) {
      const patch: Record<string, any> = {};
      if (!existing.is_active) patch.is_active = true;
      if (line.providerId) patch.provider_id = line.providerId;
      // F-1515: an opening-stock line with no shelf says nothing about where
      // the wine lives, so it leaves the wine's shelf as it is.
      if (
        line.storageLocationId !== undefined &&
        !(source === "opening_stock" && line.storageLocationId === null)
      )
        patch.storage_location_id = line.storageLocationId;
      if (line.thresholdMin !== undefined)
        patch.threshold_min = line.thresholdMin;
      if (line.thresholdMax !== undefined)
        patch.threshold_max = line.thresholdMax;

      if (Object.keys(patch).length > 0) {
        const { error: updateError } = await client
          .from("restaurant_inventory")
          .update(patch)
          .eq("id", existing.id);
        if (updateError) {
          throw new HttpException(updateError.message, HttpStatus.BAD_REQUEST);
        }
      }

      inventoryId = existing.id;
      status = existing.is_active ? "stock_added" : "reactivated";

      // F-1457, ADR 0335 §2: opening stock is a COUNT per house item, never
      // a delivery. A wine the house already carries is counted to the
      // file's number, so the same file sent twice (or sent while the page
      // still thought the list was empty) cannot double the cellar.
      if (source === "opening_stock" && line.stockLive != null) {
        await this.recordSpotCount(restaurantId, inventoryId, {
          countedQty: qty,
          clientCountId: `opening-stock:${randomUUID()}`,
          reason: reason || "Opening stock",
          locationId: line.storageLocationId ?? null,
          opening: true,
          // F-1524: the line's cost per bottle, applied only to a wine with
          // no live costed lot. A sample is a free bottle, not a cost.
          ...(line.costPerBottle != null && line.costProvenance !== "sample"
            ? {
                costPerBottle: line.costPerBottle,
                costProvenance: line.costProvenance ?? "manual",
              }
            : {}),
        });
        return {
          status: existing.is_active ? "counted" : "reactivated",
          inventoryId,
        };
      }
    } else {
      const insertData: Record<string, any> = {
        restaurant_id: restaurantId,
        master_wine_id: masterWineId,
        provider_id: line.providerId || null,
        stock_live: 0, // lots are the source of truth; booked via the RPC below
        threshold_min:
          line.thresholdMin ?? (await this.houseDefaultParMin(restaurantId)),
        threshold_max: line.thresholdMax ?? 24,
        is_active: true,
      };
      if (line.bottleSizeMl !== undefined)
        insertData.bottle_size_ml = line.bottleSizeMl;
      if (line.saleType !== undefined) insertData.sale_type = line.saleType;
      if (line.pourSizeMl !== undefined)
        insertData.pour_size_ml = line.pourSizeMl;
      // ADR 0193: the line's prices are NOT in this insert -- the caller
      // writes them through set_house_menu_price by the person (priceOnAdd).
      if (line.storageLocationId !== undefined)
        insertData.storage_location_id = line.storageLocationId;

      // The venue's own label wins (ADR 0130). This used to read the library
      // row's name and store THAT, which is how "House White Wine" came back
      // from the Antalya receiving screen as "HOUSE WHITE" — a Sim Meyhouse
      // row, on every screen, forever, because restaurant_inventory.wine_name
      // is what /inventory renders. The library name is the fallback for a
      // line that arrived as a bare wineId and carries no label of its own.
      let libraryName: string | null = null;
      if (!line.wineDraft?.name) {
        const { data: mw } = await client
          .from("master_wine_library")
          .select("name")
          .eq("id", masterWineId)
          .maybeSingle();
        libraryName = mw?.name ?? null;
      }
      insertData.wine_name = line.wineDraft?.name ?? libraryName;

      const { data: created, error: insertError } = await client
        .from("restaurant_inventory")
        .insert(insertData)
        .select("id")
        .single();

      if (insertError || !created?.id) {
        throw new HttpException(
          insertError?.message || "Failed to create inventory item",
          HttpStatus.BAD_REQUEST,
        );
      }

      inventoryId = created.id;
      status = "created";
    }

    if (qty > 0) {
      // A sample is a real, deliberate $0 — pass the provenance explicitly so the
      // lot counts as stock without dragging weighted-average cost toward zero.
      const isSample = line.costProvenance === "sample";
      const unitCost = isSample ? 0 : (line.costPerBottle ?? null);

      const { error: rpcError } = await client.rpc("apply_stock_movement", {
        p_inventory_id: inventoryId,
        p_stock_state: "live",
        p_delta: qty,
        // Live enum inventory_transaction_type has no 'restock' — topping up an
        // existing item is a 'purchase'; a brand new row is 'initial'.
        p_transaction_type: status === "created" ? "initial" : "purchase",
        p_source: source === "menu_scan" ? "import" : "manual",
        p_reason: reason || `bulk receive (${source})`,
        p_unit_cost: unitCost,
        p_location_id: line.storageLocationId ?? null,
        p_cost_provenance:
          line.costProvenance ?? (unitCost !== null ? "manual" : null),
        // ADR 0141 — the house this line is being received into. `inventoryId`
        // here is either a row this method just INSERTed under `restaurantId`
        // or one it read back with `.eq("restaurant_id", restaurantId)`.
        p_restaurant_id: restaurantId,
      });

      if (rpcError) {
        throw new HttpException(
          `Stock movement failed: ${rpcError.message}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    return { status, inventoryId };
  }

  async getInventorySummary(restaurantId: string) {
    const rawInventory =
      await this.dbService.getRestaurantInventory(restaurantId);
    const inventory = rawInventory ?? [];
    const rawLowStock = await this.dbService.getLowStockItems(restaurantId);
    const lowStock = rawLowStock ?? [];

    const totalItems = inventory.length;
    const totalBottles = inventory.reduce(
      (sum: number, item: any) => sum + (item.stock_live || 0),
      0,
    );

    // ONE definition, from common/stock-status.ts, over the SAME rows.
    //
    // `criticalCount` was `stock_live === 0` — which is "out of stock", a
    // different question — so it answered 0 for the sim tenant at the exact
    // moment the alert service was calling a wine at 2/5 critical. And
    // `lowStockCount` was `lowStock.length`, a second read of a second source
    // (`v_low_stock_items`) whose predicate the chip did not share. Counting
    // both from one classification over one array means the three numbers on
    // the page can no longer disagree about the same wine.
    const bands = inventory.map((item: any) =>
      classifyStock(item.stock_live, item.threshold_min),
    );
    const lowStockCount = bands.filter(
      (b) => b === "low" || b === "critical",
    ).length;
    const criticalCount = bands.filter((b) => b === "critical").length;
    const atParCount = bands.filter((b) => b === "at_par").length;
    // A wine whose stock or par we could not read is NOT healthy. Folding it
    // into the healthy count is how an unreadable row becomes a reassuring one.
    const unknownCount = bands.filter((b) => b === "unknown").length;

    // `v_low_stock_items` is still read, and any disagreement with the
    // classification above is REPORTED rather than reconciled silently: the
    // view is a database predicate and this is a TypeScript one, and if they
    // ever drift the page must say so instead of picking a winner.
    if (rawLowStock !== null && lowStock.length !== lowStockCount) {
      this.logger.warn(
        `Low-stock count disagreement for ${restaurantId}: v_low_stock_items says ${lowStock.length}, classifyStock over restaurant_inventory says ${lowStockCount}. One of the two predicates has drifted — see datasets/sim/fixtures/below-par-cases.json.`,
      );
    }

    // Count Toast mappings
    const toastMappedCount = inventory.filter(
      (item) => item.toast_item_guid,
    ).length;
    const toastUnmappedCount = totalItems - toastMappedCount;

    return {
      totalItems,
      totalBottles,
      lowStockCount,
      criticalCount,
      atParCount,
      unknownCount,
      // Was `totalItems - lowStockCount`, which counted every unreadable and
      // every at-par row as healthy. Healthy is now a band a row is IN, not
      // the remainder after subtracting the rows we noticed.
      healthyCount: bands.filter((b) => b === "healthy").length,
      toastMappedCount,
      toastUnmappedCount,
    };
  }

  /**
   * This house's items that the wine library does not have, and where each
   * stands on the research queue (founder, 2026-09-21, ADR 0192's amendment).
   * The /inventory flag reads it. A failed read is a 503 with the reason, never
   * an empty list: "nothing to name" and "could not be read" are different.
   */
  async listHouseItemResearch(
    restaurantId: string,
  ): Promise<{ items: HouseItemResearchView[] }> {
    try {
      return {
        items: await readHouseItemResearch(this.dbService.getClient(), restaurantId),
      };
    } catch (err: any) {
      throw new HttpException(
        err?.message ?? "Which wines wait for research could not be read.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * Update an inventory item.
   * After DB update, publishes stock.manual_override event to RabbitMQ
   * so the Buffer Manager can evaluate threshold breaches.
   */
  async updateInventoryItem(
    restaurantId: string,
    itemId: string,
    dto: UpdateInventoryItemDto,
    // ADR 0078 (attribution): from the verified JWT. A manual override is the
    // most consequential manual write on this table and it was landing in the
    // ledger as performed_by_type='system'.
    performedBy?: string | null,
  ) {
    const client = this.dbService.getClient();

    // ADR 0141, second correction 2026-09-12. `stockLive` / `shadowStock` below
    // hand this item id to set_stock_absolute, a SQL wrapper that derives the
    // house from the item and calls apply_stock_movement WITHOUT
    // p_restaurant_id, so neither database-side refusal runs. The scoped read
    // that follows kept `data` and never refused on null, so a PATCH naming
    // another house's item moved that house's stock: a PGlite probe on this
    // tree's migrations took its lots from 9 to empty. Checked FIRST, before
    // any write in this method -- the plain UPDATE of non-stock fields
    // included -- so a foreign item is refused whole, never half-applied.
    await assertInventoryBelongsToRestaurant(
      client,
      restaurantId,
      itemId,
      "updateInventoryItem",
      this.logger,
    );

    // ADR 0193: the house's own prices go FIRST, and only through the one
    // writer (see writeHousePrices); a refusal applies nothing else here.
    const priceChange = await this.writeHousePrices(
      client,
      restaurantId,
      itemId,
      dto,
      performedBy ?? null,
    );

    // Fetch old values for the event payload only (informational — the actual
    // stock delta is computed inside set_stock_absolute against a locked
    // read, not against this value).
    const { data: oldItem } = await client
      .from("restaurant_inventory")
      .select(
        "stock_live, shadow_stock, threshold_min, master_wine_id, is_active, wine_name, master_wine_library (name)",
      )
      .eq("restaurant_id", restaurantId)
      .eq("id", itemId)
      .single();

    // NON-stock fields go through a plain UPDATE. Stock (live/shadow) is NO LONGER
    // written directly — it is a projection of inventory_lots, mutated only via the
    // apply_stock_movement RPC (Phase 2 write cutover). A direct stock_live write would
    // desync from lots and get clobbered by the projection trigger on the next lot change.
    const updateData: Record<string, any> = {};
    if (dto.providerId !== undefined) updateData.provider_id = dto.providerId;
    if (dto.thresholdMin !== undefined)
      updateData.threshold_min = dto.thresholdMin;
    if (dto.thresholdMax !== undefined)
      updateData.threshold_max = dto.thresholdMax;
    if (dto.toastItemGuid !== undefined)
      updateData.toast_item_guid = dto.toastItemGuid;
    if (dto.isActive !== undefined) updateData.is_active = dto.isActive;
    if (dto.saleType !== undefined) updateData.sale_type = dto.saleType;
    if (dto.pourSizeMl !== undefined) updateData.pour_size_ml = dto.pourSizeMl;
    // menuPriceGlass / menuPriceBottle are NOT here: they went through
    // set_house_menu_price above, so they carry a version row and an actor.
    if (dto.bottleSizeMl !== undefined)
      updateData.bottle_size_ml = dto.bottleSizeMl;
    if (dto.glassesPerBottleOverride !== undefined)
      updateData.glasses_per_bottle_override = dto.glassesPerBottleOverride;
    // THE NAMING RULE (ADR 0124, founder 2026-09-05): "One alias on the item,
    // library immutable" -- "Names are the house's; identity is the library's."
    //
    // `wine_name` IS that one alias. It is not a new column: it already existed
    // and this service already PREFERS it over the library's name when it reads
    // (`:83`). What did not exist was a way for the house to set it, so a house
    // could not call its house white anything but what the library row said.
    //
    // An empty string CLEARS the alias -- the row falls back to the library
    // name -- rather than storing "" as a name. Nothing here touches
    // `master_wine_library`: the library is immutable from this page, which is
    // the founder's own line, "masterwinelibrary parts /wines not at all".
    if (dto.wineName !== undefined) {
      const alias = dto.wineName.trim();
      updateData.wine_name = alias.length > 0 ? alias : null;
    }

    if (Object.keys(updateData).length > 0) {
      const { error: updErr } = await client
        .from("restaurant_inventory")
        .update(updateData)
        .eq("restaurant_id", restaurantId)
        .eq("id", itemId);
      if (updErr) {
        this.logger.error(`Failed to update inventory item: ${updErr.message}`);
        throw new HttpException(updErr.message, HttpStatus.BAD_REQUEST);
      }
    }

    // F-1416: taking a wine off the list, or putting it back, is filed with
    // who did it, like a removal (F-633). Only a real change is filed. Like
    // the removal, a failed audit write does not undo the change; it is logged.
    if (
      dto.isActive !== undefined &&
      oldItem &&
      Boolean((oldItem as any).is_active) !== Boolean(dto.isActive)
    ) {
      const o = oldItem as any;
      await this.recordInventoryItemAudit(
        restaurantId,
        itemId,
        o.wine_name?.trim() ||
          o.master_wine_library?.name?.trim() ||
          "This wine",
        performedBy ?? null,
        dto.isActive
          ? "inventory_item_reactivated"
          : "inventory_item_deactivated",
        { active: { from: !dto.isActive, to: dto.isActive } },
      );
    }

    // Route stock changes through set_stock_absolute rather than computing a
    // delta from `oldItem` here: that read has no lock, so two concurrent
    // manual overrides can both diff against the same stale quantity and lose
    // an update once both deltas land (spine repair, decision A11).
    // set_stock_absolute locks the restaurant_inventory row FIRST and only
    // then reads the true current lot total, so the delta it hands to
    // apply_stock_movement is always computed against a value nobody else can
    // change out from under it.
    const setStockAbsolute = async (
      stockState: "live" | "shadow",
      targetQty: number,
    ) => {
      const { error: rpcErr } = await client.rpc("set_stock_absolute", {
        p_inventory_id: itemId,
        p_stock_state: stockState,
        p_target_qty: targetQty,
        p_transaction_type: "adjustment",
        p_source: "manual",
        p_performed_by: performedBy ?? null,
        p_reason: "manual_override",
        p_idempotency_key: `manual-override:${itemId}:${stockState}:${Date.now()}`,
      });
      if (rpcErr) {
        this.logger.error(
          `set_stock_absolute(${stockState}, ${targetQty}) failed: ${rpcErr.message}`,
        );
        throw new HttpException(rpcErr.message, HttpStatus.BAD_REQUEST);
      }
    };
    if (dto.stockLive !== undefined) {
      await setStockAbsolute("live", dto.stockLive);
    }
    if (dto.shadowStock !== undefined) {
      await setStockAbsolute("shadow", dto.shadowStock);
    }

    // Re-fetch the row (projection now reflects lot changes) for the response.
    const { data, error } = await client
      .from("restaurant_inventory")
      .select(
        `
        *,
        master_wine_library (*),
        restaurants (default_pour_ml, measurement_unit)
      `,
      )
      .eq("restaurant_id", restaurantId)
      .eq("id", itemId)
      .single();

    if (error) {
      this.logger.error(`Failed to reload inventory item: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }

    // A RENAME RE-DECIDES THE RESEARCH QUEUE (founder, 2026-09-21, ADR 0192's
    // amendment). For an item the wine library does not have, the house's name
    // is the only thing research can go on, so a new name decides again: a
    // placeholder ("wine 1", "house red") is `not_findable` and flagged, a real
    // name is `queued`. Found by the item's id; a row research already
    // `matched` is left alone. This is the edit path the /inventory flag
    // ("Tell us which wine this is ...") points at — the same PATCH and the
    // same gate as every other item edit.
    if (dto.wineName !== undefined && !(data as any)?.master_wine_id) {
      const reloaded = data as Record<string, any>;
      const alias =
        typeof reloaded.wine_name === "string" && reloaded.wine_name.trim()
          ? reloaded.wine_name.trim()
          : null;
      const declared =
        typeof reloaded.display_name === "string" &&
        reloaded.display_name.trim()
          ? reloaded.display_name.trim()
          : null;
      const research = await enqueueHouseItemResearch(client, {
        restaurantId,
        inventoryId: itemId,
        name: alias ?? declared,
        queuedFrom: "rename",
        sourceOrderId: null,
        queuedBy: performedBy ?? null,
      });
      if (!research.ok) {
        this.logger.error(
          `updateInventoryItem: item ${itemId} renamed, but the research queue was not updated: ${research.error}`,
        );
        throw new HttpException(
          `The name was saved, but whether this wine can now be looked up was not recorded (${research.error}). Save the name again to retry.`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }

    this.logger.log({
      message: "Inventory item updated",
      restaurantId,
      itemId,
      updatedFields: [
        ...Object.keys(updateData),
        ...(dto.stockLive !== undefined ? ["stock_live"] : []),
        ...(dto.shadowStock !== undefined ? ["shadow_stock"] : []),
      ],
    });

    // Publish stock.manual_override event if stock changed (Buffer Manager threshold eval).
    if (dto.stockLive !== undefined && this.orchestratorService) {
      try {
        await this.orchestratorService.publishEvent(
          "stock.events",
          "stock.manual_override",
          {
            restaurant_id: restaurantId,
            inventory_id: itemId,
            wine_id: oldItem?.master_wine_id || null,
            old_stock_live: oldItem?.stock_live ?? 0,
            new_stock_live: dto.stockLive,
            old_shadow_stock: oldItem?.shadow_stock ?? 0,
            new_shadow_stock: dto.shadowStock ?? oldItem?.shadow_stock ?? 0,
            threshold_min: oldItem?.threshold_min ?? 6,
            source: "manual_override",
            timestamp: new Date().toISOString(),
          },
        );
      } catch (pubErr) {
        this.logger.warn(
          `Failed to publish stock.manual_override: ${pubErr?.message}`,
        );
      }
    }

    // A threshold crossing has TWO sides, and only one of them was wired.
    //
    // `evaluateInventoryItem` was called from the stock-moving paths only, so
    // stock falling to meet par alerted and par rising to meet stock did not.
    // Measured on the 2026-09-03 lens run: three pars raised above current
    // stock through this door produced 0 notifications; the two-minute sweep
    // caught two of them about nine minutes later, and the third was never
    // explained. The sweep is a backstop, not the mechanism — an owner raising
    // a par is TELLING the system a wine is now short.
    //
    // Fired on a lowering too, not only a raise: the alert ledger has to learn
    // that a crossing was undone, or `last_alert_level` stays advanced and the
    // wine is never alerted about again when it genuinely falls.
    //
    // Fire-and-forget for the same reason the pour path is: an owner's edit
    // must not fail because the notification service is down. The alert
    // service logs its own failures — this `catch` drops a rejection, not a
    // report.
    const parChanged =
      dto.thresholdMin !== undefined &&
      Number(dto.thresholdMin) !== Number(oldItem?.threshold_min ?? NaN);
    if (parChanged && this.lowStockAlerts) {
      void this.lowStockAlerts
        .evaluateInventoryItem(restaurantId, itemId)
        .catch(() => undefined);
    }

    const rollup = await this.fetchLotRollup(restaurantId);
    const mapped = this.mapInventoryItem(data, rollup.get(itemId));
    // Said, not implied: "unchanged" and "stale" are different answers from
    // "changed", and the page tells the manager which one happened.
    return priceChange ? { ...mapped, priceChange } : mapped;
  }

  /**
   * THE HOUSE'S OWN PRICES on an inventory PATCH (ADR 0193, founder
   * 2026-09-21: "it should be changed whenever the manager wants").
   *
   * Written only through set_house_menu_price: house-scoped again in SQL,
   * changed_by from the JWT (a change naming nobody is refused, 400), and the
   * trigger closes the open menu_price_versions row and opens a 'manual' one.
   * Called before any other write in the PATCH, so a refused price change does
   * not half-apply the fields beside it. Who may call it is the controller's
   * check (owner or manager), not this method's. Null when the PATCH names
   * neither price.
   */
  private async writeHousePrices(
    client: ReturnType<DatabaseService["getClient"]>,
    restaurantId: string,
    itemId: string,
    dto: UpdateInventoryItemDto,
    performedBy: string | null,
  ): Promise<HousePriceResult | null> {
    if (dto.menuPriceBottle === undefined && dto.menuPriceGlass === undefined) {
      return null;
    }
    return setHouseMenuPrice(client, {
      restaurantId,
      inventoryId: itemId,
      ...(dto.menuPriceBottle !== undefined ? { bottle: dto.menuPriceBottle } : {}),
      ...(dto.menuPriceGlass !== undefined ? { glass: dto.menuPriceGlass } : {}),
      source: "manual",
      changedBy: performedBy,
      reason: "typed on /inventory",
    });
  }

  /**
   * Map a Toast item GUID to an inventory item
   */
  async mapToastItem(restaurantId: string, dto: MapToastItemDto) {
    const client = this.dbService.getClient();

    // Verify the inventory item belongs to this restaurant
    const { data: existing, error: checkError } = await client
      .from("restaurant_inventory")
      .select("id, toast_item_guid")
      .eq("restaurant_id", restaurantId)
      .eq("id", dto.inventoryId)
      .single();

    if (checkError || !existing) {
      throw new HttpException("Inventory item not found", HttpStatus.NOT_FOUND);
    }

    // Check if this Toast GUID is already mapped to another item
    const { data: duplicate } = await client
      .from("restaurant_inventory")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("toast_item_guid", dto.toastItemGuid)
      .neq("id", dto.inventoryId)
      .single();

    if (duplicate) {
      throw new HttpException(
        "Toast item GUID is already mapped to another inventory item",
        HttpStatus.CONFLICT,
      );
    }

    // Update the mapping
    const { data, error } = await client
      .from("restaurant_inventory")
      .update({ toast_item_guid: dto.toastItemGuid })
      .eq("id", dto.inventoryId)
      .select(
        `
        *,
        master_wine_library (bottle_size_ml),
        restaurants (default_pour_ml, measurement_unit)
      `,
      )
      .single();

    if (error) {
      this.logger.error(`Failed to map Toast item: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }

    this.logger.log({
      message: "Toast item mapped",
      restaurantId,
      inventoryId: dto.inventoryId,
      toastItemGuid: dto.toastItemGuid,
    });

    return this.mapInventoryItem(data);
  }

  /**
   * Bulk map Toast items to inventory
   */
  async bulkMapToastItems(restaurantId: string, dto: BulkMapToastItemsDto) {
    const results = {
      success: [] as string[],
      failed: [] as { inventoryId: string; error: string }[],
    };

    for (const mapping of dto.mappings) {
      try {
        await this.mapToastItem(restaurantId, mapping);
        results.success.push(mapping.inventoryId);
      } catch (error) {
        results.failed.push({
          inventoryId: mapping.inventoryId,
          error: error.message,
        });
      }
    }

    this.logger.log({
      message: "Bulk Toast mapping completed",
      restaurantId,
      successCount: results.success.length,
      failedCount: results.failed.length,
    });

    return results;
  }

  /**
   * Get unmapped inventory items (items without Toast GUID)
   */
  async getUnmappedItems(restaurantId: string) {
    const client = this.dbService.getClient();

    const { data, error } = await client
      .from("restaurant_inventory")
      .select(
        `
        id,
        restaurant_id,
        master_wine_id,
        stock_live,
        is_active,
        created_at,
        master_wine_library (
          name,
          producer,
          vintage
        )
      `,
      )
      .eq("restaurant_id", restaurantId)
      .is("toast_item_guid", null)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      this.logger.error(`Failed to get unmapped items: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    return data || [];
  }

  /**
   * Find inventory by Toast item GUID
   */
  async findByToastGuid(restaurantId: string, toastItemGuid: string) {
    const client = this.dbService.getClient();

    const { data, error } = await client
      .from("restaurant_inventory")
      .select(
        `
        *,
        master_wine_library (
          name,
          producer,
          vintage,
          bottle_size_ml
        ),
        restaurants (default_pour_ml, measurement_unit)
      `,
      )
      .eq("restaurant_id", restaurantId)
      .eq("toast_item_guid", toastItemGuid)
      .eq("is_active", true)
      .single();

    if (error) {
      return null;
    }

    return data ? this.mapInventoryItem(data) : null;
  }

  /**
   * Soft-delete an inventory item (set is_active = false)
   *
   * F-633 (2026-10-09). The remove dialog states the rule — a wine leaves the
   * inventory only once its stock is at zero, counted down on the ledger with
   * a reason — but the server took the DELETE whatever the stock, so a direct
   * call hid bottles still on the shelf with no ledger row. The rule now holds
   * here: any bottle left (live or shadow) refuses the removal in plain words,
   * and the write itself repeats the zero-stock filter so stock that lands
   * between the read and the write is not hidden either.
   *
   * WHO AND WHEN. The removal writes one `system_audit_log` row,
   * `inventory_item_removed`, naming the actor and the wine, which /logs
   * already reads. `deleted_at` is NOT stamped: the re-add paths
   * (`createInventoryItem`, the bulk add) reactivate the row with
   * `is_active: true` and never clear it, so a stamp would outlive the wine's
   * return. Like `discardMenuItem` (F-484), a failed audit write does not undo
   * the removal; it is logged and the reply says `audited: false`.
   */
  async softDeleteItem(
    restaurantId: string,
    itemId: string,
    actorUserId: string | null = null,
  ): Promise<{ audited: boolean }> {
    const client = this.dbService.getClient();
    const cols =
      "id, wine_name, stock_live, shadow_stock, master_wine_library (name)";

    // Try by restaurant_inventory.id (PK) first
    const { data: byPk, error: pkError } = await client
      .from("restaurant_inventory")
      .select(cols)
      .eq("restaurant_id", restaurantId)
      .eq("id", itemId);

    if (pkError) {
      this.logger.error(`softDeleteItem (by PK) error: ${pkError.message}`);
      throw new HttpException(pkError.message, HttpStatus.BAD_REQUEST);
    }

    let rows: any[] = byPk || [];
    if (rows.length === 0) {
      // Fallback: caller may have passed master_wine_id instead of restaurant_inventory.id
      this.logger.warn(
        `softDeleteItem: no row matched id=${itemId}; retrying by master_wine_id`,
      );
      const { data: byWineId, error: wineError } = await client
        .from("restaurant_inventory")
        .select(cols)
        .eq("restaurant_id", restaurantId)
        .eq("master_wine_id", itemId);

      if (wineError) {
        this.logger.error(
          `softDeleteItem (by master_wine_id) error: ${wineError.message}`,
        );
        throw new HttpException(wineError.message, HttpStatus.BAD_REQUEST);
      }
      rows = byWineId || [];
    }

    if (rows.length === 0) {
      this.logger.error(
        `softDeleteItem: item not found — id=${itemId}, restaurantId=${restaurantId}`,
      );
      throw new HttpException(
        `Inventory item not found (id: ${itemId})`,
        HttpStatus.NOT_FOUND,
      );
    }

    const nameOf = (r: any): string =>
      r.wine_name?.trim() || r.master_wine_library?.name?.trim() || "This wine";
    const bottles = (r: any): number =>
      Math.max(0, Number(r.stock_live) || 0) +
      Math.max(0, Number(r.shadow_stock) || 0);

    const held = rows.find((r) => bottles(r) > 0);
    if (held) {
      const n = bottles(held);
      throw new HttpException(
        `${nameOf(held)} still has ${n} bottle${n === 1 ? "" : "s"} on the books. Count it down to zero with a reason first, so the bottles leave on the record. Nothing was removed.`,
        HttpStatus.CONFLICT,
      );
    }

    // The zero-stock rule again on the write: a delivery or count that lands
    // after the read above must not be hidden by this removal.
    const { data: gone, error: writeError } = await client
      .from("restaurant_inventory")
      .update({ is_active: false })
      .eq("restaurant_id", restaurantId)
      .in(
        "id",
        rows.map((r) => r.id),
      )
      .lte("stock_live", 0)
      .or("shadow_stock.is.null,shadow_stock.lte.0")
      .select("id");

    if (writeError) {
      this.logger.error(`softDeleteItem write error: ${writeError.message}`);
      throw new HttpException(writeError.message, HttpStatus.BAD_REQUEST);
    }

    // Every row that did go is filed, even when another one did not.
    const goneIds = new Set((gone || []).map((g: any) => g.id));
    let audited = true;
    for (const r of rows.filter((x) => goneIds.has(x.id))) {
      audited =
        (await this.recordRemoval(
          restaurantId,
          r.id,
          nameOf(r),
          actorUserId,
        )) && audited;
    }

    if (goneIds.size < rows.length) {
      throw new HttpException(
        `Stock for ${nameOf(rows[0])} arrived while it was being removed. Count it down to zero first. ${goneIds.size === 0 ? "Nothing was removed." : "Part of it was removed."}`,
        HttpStatus.CONFLICT,
      );
    }

    this.logger.log({
      message: "Inventory item soft-deleted",
      restaurantId,
      itemId,
    });
    return { audited };
  }

  /** The audit half of `softDeleteItem` (F-633). Never throws. */
  private recordRemoval(
    restaurantId: string,
    inventoryId: string,
    wineName: string,
    actorUserId: string | null,
  ): Promise<boolean> {
    return this.recordInventoryItemAudit(
      restaurantId,
      inventoryId,
      wineName,
      actorUserId,
      "inventory_item_removed",
      { in_inventory: { from: true, to: false } },
    );
  }

  /**
   * One `system_audit_log` row about a wine on the list: removed (F-633),
   * taken off or put back on the list (F-1416). Never throws.
   */
  private async recordInventoryItemAudit(
    restaurantId: string,
    inventoryId: string,
    wineName: string,
    actorUserId: string | null,
    action: string,
    fields: Record<string, { from: unknown; to: unknown }>,
  ): Promise<boolean> {
    try {
      const { error } = await this.dbService
        .getClient()
        .from("system_audit_log")
        .insert({
          actor_type: actorUserId ? "user" : "system",
          actor_id: actorUserId,
          action,
          entity_type: "inventory_item",
          entity_id: inventoryId,
          restaurant_id: restaurantId,
          reason: null,
          changes: {
            // Read on /logs as "Name: inventory item removed — Opus One 2018".
            subject: wineName,
            fields,
          },
        });
      if (error) {
        this.logger.error(
          `${action} happened but the audit row failed to write: ${error.message}`,
        );
        return false;
      }
      return true;
    } catch (err: any) {
      this.logger.error(
        `${action} happened but the audit row threw: ${err?.message}`,
      );
      return false;
    }
  }

  /**
   * Remove Toast item mapping
   */
  async unmapToastItem(restaurantId: string, inventoryId: string) {
    const client = this.dbService.getClient();

    const { data, error } = await client
      .from("restaurant_inventory")
      .update({ toast_item_guid: null })
      .eq("restaurant_id", restaurantId)
      .eq("id", inventoryId)
      .select(
        `
        *,
        master_wine_library (bottle_size_ml),
        restaurants (default_pour_ml, measurement_unit)
      `,
      )
      .single();

    if (error) {
      this.logger.error(`Failed to unmap Toast item: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }

    this.logger.log({
      message: "Toast item unmapped",
      restaurantId,
      inventoryId,
    });

    return this.mapInventoryItem(data);
  }
  // ==========================================================================
  // STOCK-OUTS — a drink 86'd (F-145, 20261231900000). The item is sold out
  // exactly while it has an open stock_outs row; ending it brings it back.
  // Nothing here moves stock: a stock-out is availability, not a count.
  // ==========================================================================

  async getStockOuts(restaurantId: string, inventoryId: string) {
    const client = this.dbService.getClient();
    await assertInventoryBelongsToRestaurant(
      client,
      restaurantId,
      inventoryId,
      "getStockOuts",
      this.logger,
    );
    return this.readStockOuts(client, restaurantId, inventoryId);
  }

  async startStockOut(
    restaurantId: string,
    inventoryId: string,
    dto: { cause?: string; note?: string | null },
    userId: string | null,
  ) {
    const cause = String(dto?.cause ?? "");
    if (!(STOCK_OUT_CAUSES as readonly string[]).includes(cause)) {
      throw new HttpException(
        "Say why it is sold out: ran out, broken, pulled or other. Nothing was marked.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const note =
      typeof dto?.note === "string" && dto.note.trim() ? dto.note.trim() : null;
    if (note && note.length > 500) {
      throw new HttpException(
        "The note is longer than 500 characters. Nothing was marked.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const client = this.dbService.getClient();
    await assertInventoryBelongsToRestaurant(
      client,
      restaurantId,
      inventoryId,
      "startStockOut",
      this.logger,
    );
    const { error } = await client.from("stock_outs").insert({
      restaurant_id: restaurantId,
      inventory_id: inventoryId,
      cause,
      note,
      started_by: userId,
    });
    // 23505: it is already sold out (one open stock-out per item). A second
    // tap, or two people at once, answers with the one already open.
    if (error && error.code !== "23505") {
      this.logger.error(`startStockOut ${inventoryId}: ${error.message}`);
      throw new HttpException(
        "Could not mark it sold out. Nothing was marked; try again.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    // S195: who 86'd it is on /logs. A second tap marked nothing, so files
    // nothing.
    if (!error) {
      await this.recordStockOut(restaurantId, inventoryId, userId, true, {
        cause,
      });
    }
    return this.readStockOuts(client, restaurantId, inventoryId);
  }

  /**
   * F-1521: `stockOutId` is the 86 the person saw. Only that one is ended: if
   * another is open now (an owner pulled it since the screen was read), it
   * stands and the answer is 409 with who and why. Without an id (an older
   * phone) the open one is ended, as before.
   */
  async endStockOut(
    restaurantId: string,
    inventoryId: string,
    userId: string | null,
    stockOutId?: string | null,
  ) {
    const client = this.dbService.getClient();
    await assertInventoryBelongsToRestaurant(
      client,
      restaurantId,
      inventoryId,
      "endStockOut",
      this.logger,
    );
    const seen =
      typeof stockOutId === "string" && stockOutId.trim()
        ? stockOutId.trim()
        : null;
    let end = client
      .from("stock_outs")
      .update({ ended_at: new Date().toISOString(), ended_by: userId })
      .eq("restaurant_id", restaurantId)
      .eq("inventory_id", inventoryId)
      .is("ended_at", null);
    if (seen) end = end.eq("id", seen);
    const { data: ended, error } = await end.select("id, cause");
    if (error) {
      this.logger.error(`endStockOut ${inventoryId}: ${error.message}`);
      throw new HttpException(
        "Could not bring it back. It is still marked sold out; try again.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    // A delivery ends an 86 in the database (drink_back_on, 20270105500000);
    // a person ending one is filed here with the same action.
    for (const r of ended ?? []) {
      await this.recordStockOut(restaurantId, inventoryId, userId, false, {
        stock_out_id: r.id,
        cause: r.cause,
      });
    }
    const state = await this.readStockOuts(client, restaurantId, inventoryId);
    if (seen && !(ended ?? []).length && state.open && state.open.id !== seen) {
      throw new HttpException(
        await this.changedSinceWords(restaurantId, state.open),
        HttpStatus.CONFLICT,
      );
    }
    return state;
  }

  /** F-1521: the 86 open now, said as who marked it and why. */
  private async changedSinceWords(
    restaurantId: string,
    open: {
      cause: StockOutCause;
      note: string | null;
      startedBy: string | null;
    },
  ): Promise<string> {
    let who = "Someone";
    if (open.startedBy) {
      const { data, error } = await this.dbService
        .getClient()
        .from("users")
        .select("name")
        .eq("user_id", open.startedBy)
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      // Unnamed rather than unsaid: the refusal stands either way.
      if (error)
        this.logger.warn(
          `endStockOut: who marked it could not be read: ${error.message}`,
        );
      const name = (data as { name?: string | null } | null)?.name?.trim();
      if (name) who = name;
    }
    const why =
      open.cause === "ran_out"
        ? "it ran out"
        : open.cause === "broken"
          ? "it broke"
          : open.cause === "pulled"
            ? "they pulled it"
            : "another reason";
    return `This changed since you looked: ${who} marked it sold out again because ${why}${open.note ? ` (${open.note})` : ""}. It is still sold out; look again before you bring it back.`;
  }

  /**
   * The audit half of an 86 (S195): `drink_sold_out` when a person marks it,
   * `drink_back_on` when a person brings it back. Never throws: the 86 stands
   * or ends either way, and a failed row is logged.
   */
  private async recordStockOut(
    restaurantId: string,
    inventoryId: string,
    actorUserId: string | null,
    soldOut: boolean,
    extra: Record<string, unknown>,
  ): Promise<void> {
    const action = soldOut ? "drink_sold_out" : "drink_back_on";
    try {
      const client = this.dbService.getClient();
      const { data: item, error: nameError } = await client
        .from("restaurant_inventory")
        .select("wine_name, master_wine_library (name)")
        .eq("restaurant_id", restaurantId)
        .eq("id", inventoryId)
        .maybeSingle();
      // The row is filed without the wine's name rather than not at all.
      if (nameError) {
        this.logger.warn(
          `${action}: the wine's name could not be read: ${nameError.message}`,
        );
      }
      const subject =
        (item as any)?.wine_name || (item as any)?.master_wine_library?.name;
      const { error } = await client.from("system_audit_log").insert({
        actor_type: actorUserId ? "user" : "system",
        actor_id: actorUserId,
        action,
        entity_type: "inventory_item",
        entity_id: inventoryId,
        restaurant_id: restaurantId,
        reason: null,
        changes: {
          ...(subject ? { subject } : {}),
          fields: { sold_out: { from: !soldOut, to: soldOut } },
          ...extra,
        },
      });
      if (error) {
        this.logger.error(
          `${action} happened but the audit row failed to write: ${error.message}`,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `${action} happened but the audit row threw: ${err?.message}`,
      );
    }
  }

  /** The open stock-out (or null) and the last ten, newest first. */
  private async readStockOuts(
    client: ReturnType<DatabaseService["getClient"]>,
    restaurantId: string,
    inventoryId: string,
  ) {
    const { data, error } = await client
      .from("stock_outs")
      .select("id, cause, note, started_at, started_by, ended_at, ended_by")
      .eq("restaurant_id", restaurantId)
      .eq("inventory_id", inventoryId)
      .order("started_at", { ascending: false })
      .limit(10);
    if (error) {
      this.logger.error(`readStockOuts ${inventoryId}: ${error.message}`);
      throw new HttpException(
        "Whether this is sold out could not be read. That is not the same as not sold out.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const rows = (data ?? []).map((r: any) => ({
      id: r.id as string,
      cause: r.cause as StockOutCause,
      note: (r.note ?? null) as string | null,
      startedAt: r.started_at as string,
      startedBy: (r.started_by ?? null) as string | null,
      endedAt: (r.ended_at ?? null) as string | null,
      endedBy: (r.ended_by ?? null) as string | null,
    }));
    return {
      open: rows.find((r) => r.endedAt === null) ?? null,
      recent: rows,
    };
  }
}
