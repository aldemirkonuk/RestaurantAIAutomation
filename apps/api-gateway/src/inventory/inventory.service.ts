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
      bottleSizeMl: effectiveBottleSizeMl,
      bottleSizeOz: roundOz(effectiveBottleSizeMl),
      pourSizeMl,
      pourSizeOz: roundOz(pourSizeMl),
      glassesPerBottle,
      saleType: row.sale_type ?? undefined,
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

  /** Phase 2 multi-location: move bottles of a wine between locations (null = unassigned). */
  async transferStock(
    restaurantId: string,
    inventoryId: string,
    dto: {
      fromLocationId?: string | null;
      toLocationId?: string | null;
      qty: number;
      reason?: string;
    },
  ) {
    const client = this.dbService.getClient();
    const { error } = await client.rpc("transfer_stock", {
      p_inventory_id: inventoryId,
      p_from_location_id: dto.fromLocationId ?? null,
      p_to_location_id: dto.toLocationId ?? null,
      p_qty: dto.qty,
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

  /** Phase 2 (2c) by-the-glass: record N glass pours (POS or manual). Depletes open bottle ml. */
  async recordPour(
    restaurantId: string,
    inventoryId: string,
    dto: {
      pours?: number;
      pourMl?: number | null;
      locationId?: string | null;
      source?: string;
      reason?: string;
    },
  ) {
    const client = this.dbService.getClient();
    const { data: pourResult, error } = await client.rpc("record_glass_pour", {
      p_inventory_id: inventoryId,
      p_pours: dto.pours ?? 1,
      p_pour_ml: dto.pourMl ?? null,
      p_location_id: dto.locationId ?? null,
      p_source: dto.source ?? "manual",
      p_reason: dto.reason ?? null,
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
        line.wineDraft?.name || (line.wineId ? `wine ${line.wineId}` : "unknown");

      try {
        const resolved = await this.resolveBulkLineWine(line);
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
  private async resolveBulkLineWine(line: BulkInventoryLineDto): Promise<{
    masterWineId: string;
    wineName: string | null;
    matched: boolean;
    libraryTier: number | null;
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

    const resolution = await this.wineSubmissions.resolveOrCreateLibraryWine({
      name: line.wineDraft.name,
      producer: line.wineDraft.producer ?? null,
      vintage: line.wineDraft.vintage ?? null,
      country: line.wineDraft.country ?? null,
      region: line.wineDraft.region ?? null,
      grapeVariety: line.wineDraft.grapeVariety ?? null,
    });

    return {
      masterWineId: resolution.masterWineId,
      wineName: line.wineDraft.name,
      matched: resolution.matched,
      libraryTier: resolution.libraryTier,
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
      if (line.thresholdMin !== undefined) patch.threshold_min = line.thresholdMin;
      if (line.thresholdMax !== undefined) patch.threshold_max = line.thresholdMax;

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

      const { data: mw } = await client
        .from("master_wine_library")
        .select("name")
        .eq("id", masterWineId)
        .maybeSingle();
      insertData.wine_name = mw?.name ?? null;

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
    const lowStockCount = lowStock.length;
    const criticalCount = inventory.filter(
      (item) => (item.stock_live || 0) === 0,
    ).length;

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
      healthyCount: totalItems - lowStockCount,
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
  ) {
    const client = this.dbService.getClient();

    // Fetch old values for event payload (before update)
    const { data: oldItem } = await client
      .from("restaurant_inventory")
      .select(
        "stock_live, shadow_stock, threshold_min, master_wine_id, version",
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
    if (dto.menuPriceGlass !== undefined)
      updateData.menu_price_glass = dto.menuPriceGlass;
    if (dto.bottleSizeMl !== undefined)
      updateData.bottle_size_ml = dto.bottleSizeMl;
    if (dto.glassesPerBottleOverride !== undefined)
      updateData.glasses_per_bottle_override = dto.glassesPerBottleOverride;

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

    // Route stock changes through the ledger RPC as signed deltas (lots = source of truth,
    // atomic, version-locked, idempotent, negative-guarded). Absolute set -> delta vs. old.
    const applyStockDelta = async (
      stockState: "live" | "shadow",
      newQty: number,
      oldQty: number,
    ) => {
      const delta = newQty - (oldQty ?? 0);
      if (delta === 0) return;
      const { error: rpcErr } = await client.rpc("apply_stock_movement", {
        p_inventory_id: itemId,
        p_stock_state: stockState,
        p_delta: delta,
        p_transaction_type: delta > 0 ? "purchase" : "adjustment",
        p_source: "manual",
        p_reason: "manual_override",
      });
      if (rpcErr) {
        this.logger.error(
          `apply_stock_movement(${stockState}, ${delta}) failed: ${rpcErr.message}`,
        );
        throw new HttpException(rpcErr.message, HttpStatus.BAD_REQUEST);
      }
    };
    if (dto.stockLive !== undefined) {
      await applyStockDelta("live", dto.stockLive, oldItem?.stock_live ?? 0);
    }
    if (dto.shadowStock !== undefined) {
      await applyStockDelta(
        "shadow",
        dto.shadowStock,
        oldItem?.shadow_stock ?? 0,
      );
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
