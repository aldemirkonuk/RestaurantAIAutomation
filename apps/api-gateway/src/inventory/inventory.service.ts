import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  Optional,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { OrchestratorService } from "../common/orchestrator/orchestrator.service";
import { LowStockAlertsService } from "../notifications/low-stock-alerts.service";
import { WineSubmissionsService } from "../wines/wine-submissions.service";
import { PhotoCountService } from "./photo-count.service";
import { NfEventRef } from "../common/model-client/model-client.service";
import { NfVerdictService } from "../common/model-client/nf-verdict.service";
import { HUMAN_COUNT_BASIS, humanCountVerdict } from "./photo-count-verdict";
import { mapStockCountResult } from "./stock-count-result";
import { classifyStock } from "../common/stock-status";
import {
  CreateInventoryItemDto,
  UpdateInventoryItemDto,
  MapToastItemDto,
  BulkMapToastItemsDto,
  BulkCreateInventoryItemsDto,
  BulkInventoryLineDto,
} from "./dto/inventory.dto";

const ML_PER_OZ = 29.5735;

function roundOz(ml: number): number {
  return Math.round((ml / ML_PER_OZ) * 10) / 10;
}

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
  ): Promise<Map<string, any>> {
    const map = new Map<string, any>();
    try {
      const client = this.dbService.getClient();
      const { data } = await client
        .from("inventory_lot_rollup")
        .select(
          "inventory_id, live_qty, shadow_qty, wac, has_invoice_cost, live_location_count, open_ml",
        )
        .eq("restaurant_id", restaurantId);
      for (const r of data || []) map.set(r.inventory_id, r);
    } catch (err: any) {
      this.logger.warn(`fetchLotRollup failed: ${err?.message}`);
    }
    return map;
  }

  /** Phase 2 multi-location: per-inventory live lot quantities by location. */
  private async fetchLocationBreakdown(
    restaurantId: string,
  ): Promise<Map<string, any[]>> {
    const map = new Map<string, any[]>();
    try {
      const client = this.dbService.getClient();
      const { data } = await client
        .from("inventory_location_breakdown")
        .select("inventory_id, location_id, qty, wac")
        .eq("restaurant_id", restaurantId)
        .eq("stock_state", "live");
      for (const r of data || []) {
        const arr = map.get(r.inventory_id) ?? [];
        arr.push({ locationId: r.location_id, qty: r.qty, wac: r.wac });
        map.set(r.inventory_id, arr);
      }
    } catch (err: any) {
      this.logger.warn(`fetchLocationBreakdown failed: ${err?.message}`);
    }
    return map;
  }

  /** Phase 2 (2d/2e): per-inventory velocity, days-of-cover, reorder, ABC, dead-stock. */
  private async fetchAnalytics(
    restaurantId: string,
  ): Promise<Map<string, any>> {
    const map = new Map<string, any>();
    try {
      const client = this.dbService.getClient();
      const { data } = await client
        .from("inventory_analytics")
        .select(
          "inventory_id, velocity_per_day, days_of_cover, reorder_point, reorder_suggested, abc_class, dead_stock, days_since_sale",
        )
        .eq("restaurant_id", restaurantId);
      for (const r of data || []) map.set(r.inventory_id, r);
    } catch (err: any) {
      this.logger.warn(`fetchAnalytics failed: ${err?.message}`);
    }
    return map;
  }

  async getRestaurantInventory(restaurantId: string) {
    this.logger.log(`Fetching inventory for restaurant: ${restaurantId}`);
    const [data, rollup, locations, analytics] = await Promise.all([
      this.dbService.getRestaurantInventory(restaurantId),
      this.fetchLotRollup(restaurantId),
      this.fetchLocationBreakdown(restaurantId),
      this.fetchAnalytics(restaurantId),
    ]);
    return (data || []).map((row) =>
      this.mapInventoryItem(
        row,
        rollup.get(row.id),
        locations.get(row.id),
        analytics.get(row.id),
      ),
    );
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
    },
  ) {
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

    const { data: countResult, error: rpcErr } = await client.rpc(
      "record_stock_count",
      {
        p_inventory_id: inventoryId,
        p_counted_qty: Math.round(Number(dto.countedQty)),
        p_idempotency_key: idempotencyKey,
        p_stock_state: stockState,
        p_source: "mobile_count",
        p_transaction_type: "reconciliation",
        p_performed_by: dto.performedBy ?? null,
        p_reason: dto.reason ?? "Spot count",
      },
    );
    if (rpcErr) {
      this.logger.error(
        `Spot count record_stock_count failed: ${rpcErr.message}`,
      );
      throw new HttpException(rpcErr.message, HttpStatus.BAD_REQUEST);
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
    void this.gradePhotoCountSuggestion(
      inventoryId,
      Math.round(Number(dto.countedQty)),
    );

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
      count: mapStockCountResult(countResult),
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
   *   - daily: depletion per day for the last 14 days (velocity chart)
   *   - heat:  7x8 matrix (Mon..Sun x 4pm..11pm) of depletion counts over the
   *            last 28 days (busy-hours heatmap)
   * Sourced from the inventory_transactions ledger; only outbound movements
   * (sales, pours, negative adjustments) count as depletion.
   */
  async getItemActivity(restaurantId: string, itemId: string) {
    const client = this.dbService.getClient();
    const since = new Date();
    since.setDate(since.getDate() - 28);

    const { data, error } = await client
      .from("inventory_transactions")
      .select("*")
      .eq("inventory_id", itemId)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: true })
      .limit(2000);

    if (error) {
      this.logger.warn(`getItemActivity ledger query failed: ${error.message}`);
      return { daily: [], heat: [], totalOut28d: 0 };
    }

    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const dailyMap = new Map<string, number>();
    // heat[dow][slot]: dow 0=Mon..6=Sun, slot 0..7 = 16:00..23:00
    const heat: number[][] = Array.from({ length: 7 }, () => Array(8).fill(0));
    let totalOut = 0;

    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    for (const row of (data as any[]) || []) {
      const qty = Number(row.quantity_change ?? row.quantity ?? 0);
      const type = String(row.transaction_type || "").toLowerCase();
      const isOut = qty < 0 || ["sale", "pour", "glass_pour"].includes(type);
      if (!isOut) continue;
      const out = Math.abs(qty);
      if (!(out > 0)) continue;

      const ts = new Date(row.created_at);
      totalOut += out;

      if (ts >= fourteenDaysAgo) {
        const k = dayKey(ts);
        dailyMap.set(k, (dailyMap.get(k) ?? 0) + out);
      }
      const dow = (ts.getDay() + 6) % 7; // Mon=0
      const slot = ts.getHours() - 16;
      if (slot >= 0 && slot < 8) heat[dow][slot] += out;
    }

    // Dense 14-day series (zero-filled) so the chart has a stable x-axis.
    const daily: Array<{ date: string; out: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const k = dayKey(d);
      daily.push({ date: k, out: dailyMap.get(k) ?? 0 });
    }

    return { daily, heat, totalOut28d: totalOut };
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
  async createInventoryItem(restaurantId: string, dto: CreateInventoryItemDto) {
    const client = this.dbService.getClient();

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
        // Soft-deleted item: re-activate it so the order can proceed
        const { data: reactivated, error: reactivateError } = await client
          .from("restaurant_inventory")
          .update({
            is_active: true,
            stock_live: 0, // applied as a lot via apply_stock_movement below
            provider_id: dto.providerId || null,
            ...(masterWineName ? { wine_name: masterWineName } : {}),
          })
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
          await client.rpc("apply_stock_movement", {
            p_inventory_id: existing.id,
            p_stock_state: "live",
            p_delta: dto.stockLive,
            p_transaction_type: "initial",
            p_source: "manual",
            p_reason: "stock on re-activation",
            p_unit_cost: unitCost,
            p_location_id: dto.storageLocationId ?? null,
            p_cost_provenance: provenance,
          });
        }

        this.logger.log({
          message: "Inventory item reactivated",
          restaurantId,
          wineId: dto.wineId,
          inventoryId: existing.id,
        });
        const { data: freshReact } = await client
          .from("restaurant_inventory")
          .select(
            `*, master_wine_library (*), restaurants (default_pour_ml, measurement_unit)`,
          )
          .eq("id", existing.id)
          .single();
        const reactRollup = await this.fetchLotRollup(restaurantId);
        return this.mapInventoryItem(
          freshReact ?? reactivated,
          reactRollup.get(existing.id),
        );
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
      threshold_min: dto.thresholdMin || 6,
      threshold_max: dto.thresholdMax || 24,
      toast_item_guid: dto.toastItemGuid || null,
      is_active: true,
      wine_name: masterWineName,
    };
    if (dto.saleType !== undefined) insertData.sale_type = dto.saleType;
    if (dto.pourSizeMl !== undefined) insertData.pour_size_ml = dto.pourSizeMl;
    if (dto.menuPriceGlass !== undefined)
      insertData.menu_price_glass = dto.menuPriceGlass;
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
      });
      if (rpcErr) {
        this.logger.warn(
          `initial apply_stock_movement failed for ${data.id}: ${rpcErr.message}`,
        );
      }
    }

    this.logger.log({
      message: "Inventory item created",
      restaurantId,
      wineId: dto.wineId,
      inventoryId: data.id,
    });

    const { data: fresh } = await client
      .from("restaurant_inventory")
      .select(
        `*, master_wine_library (*), restaurants (default_pour_ml, measurement_unit)`,
      )
      .eq("id", data.id)
      .single();
    const rollup = await this.fetchLotRollup(restaurantId);
    return this.mapInventoryItem(fresh ?? data, rollup.get(data.id));
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
  ) {
    const source = dto.source || "bulk_receive";
    const results: Array<Record<string, any>> = [];

    for (let index = 0; index < dto.items.length; index++) {
      const line = dto.items[index];
      const wineName =
        line.wineDraft?.name ||
        (line.wineId ? `wine ${line.wineId}` : "unknown");

      try {
        const resolved = await this.resolveBulkLineWine(line, restaurantId);
        const outcome = await this.receiveBulkLine(
          restaurantId,
          line,
          resolved.masterWineId,
          source,
          dto.reason,
        );

        results.push({
          index,
          status: outcome.status,
          inventoryId: outcome.inventoryId,
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
      if (line.storageLocationId !== undefined)
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
    } else {
      const insertData: Record<string, any> = {
        restaurant_id: restaurantId,
        master_wine_id: masterWineId,
        provider_id: line.providerId || null,
        stock_live: 0, // lots are the source of truth; booked via the RPC below
        threshold_min: line.thresholdMin ?? 6,
        threshold_max: line.thresholdMax ?? 24,
        is_active: true,
      };
      if (line.bottleSizeMl !== undefined)
        insertData.bottle_size_ml = line.bottleSizeMl;
      if (line.saleType !== undefined) insertData.sale_type = line.saleType;
      if (line.pourSizeMl !== undefined)
        insertData.pour_size_ml = line.pourSizeMl;
      if (line.menuPriceGlass !== undefined)
        insertData.menu_price_glass = line.menuPriceGlass;
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

    // Fetch old values for the event payload only (informational — the actual
    // stock delta is computed inside set_stock_absolute against a locked
    // read, not against this value).
    const { data: oldItem } = await client
      .from("restaurant_inventory")
      .select("stock_live, shadow_stock, threshold_min, master_wine_id")
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
    if (dto.menuPriceGlass !== undefined)
      updateData.menu_price_glass = dto.menuPriceGlass;
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
    return this.mapInventoryItem(data, rollup.get(itemId));
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
   */
  async softDeleteItem(restaurantId: string, itemId: string): Promise<void> {
    const client = this.dbService.getClient();

    // Try by restaurant_inventory.id (PK) first
    const { data: byPk, error: pkError } = await client
      .from("restaurant_inventory")
      .update({ is_active: false })
      .eq("restaurant_id", restaurantId)
      .eq("id", itemId)
      .select("id");

    if (pkError) {
      this.logger.error(`softDeleteItem (by PK) error: ${pkError.message}`);
      throw new HttpException(pkError.message, HttpStatus.BAD_REQUEST);
    }

    if (byPk && byPk.length > 0) {
      this.logger.log({
        message: "Inventory item soft-deleted by PK",
        restaurantId,
        itemId,
      });
      return;
    }

    // Fallback: caller may have passed master_wine_id instead of restaurant_inventory.id
    this.logger.warn(
      `softDeleteItem: no row matched id=${itemId}; retrying by master_wine_id`,
    );
    const { data: byWineId, error: wineError } = await client
      .from("restaurant_inventory")
      .update({ is_active: false })
      .eq("restaurant_id", restaurantId)
      .eq("master_wine_id", itemId)
      .select("id");

    if (wineError) {
      this.logger.error(
        `softDeleteItem (by master_wine_id) error: ${wineError.message}`,
      );
      throw new HttpException(wineError.message, HttpStatus.BAD_REQUEST);
    }

    if (!byWineId || byWineId.length === 0) {
      this.logger.error(
        `softDeleteItem: item not found — id=${itemId}, restaurantId=${restaurantId}`,
      );
      throw new HttpException(
        `Inventory item not found (id: ${itemId})`,
        HttpStatus.NOT_FOUND,
      );
    }

    this.logger.log({
      message: "Inventory item soft-deleted by master_wine_id",
      restaurantId,
      itemId,
    });
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
}
