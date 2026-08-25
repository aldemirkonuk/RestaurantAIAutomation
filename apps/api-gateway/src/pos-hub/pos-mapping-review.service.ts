import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { PosHubService } from "./pos-hub.service";
import {
  SaleUnit,
  SaleUnitAnswerDto,
  UNIT_IF_UNANSWERED,
} from "./dto/pos-mapping-review.dto";

/**
 * Sale-unit review surface — read the evidence, a human writes the answer.
 *
 * WHY THIS EXISTS
 * ---------------
 * `pos_item_mappings.sale_unit` was added on 2026-08-24 and every mapping
 * written before it carries null. `PosHubService.applyStockEffects` resolves
 * null to `"bottle"` (decision B36), so a by-the-glass sale on an unanswered
 * mapping depletes a whole bottle. The column cannot be backfilled by this
 * service or any other: "BORDEAUX BLEND" and "NERELLO MASCALESE MORETTO" do
 * not say glass or bottle, and B36 exists precisely because guessing from the
 * name is worse than the documented default — a wrong unit looks answered.
 *
 * So this service is strictly read + explicit-write. It NEVER writes a unit it
 * derived itself. `listNeedingSaleUnit` assembles everything a human needs to
 * decide one row without opening another screen; `setSaleUnit` writes only the
 * literal value the human sent.
 *
 * THE EVIDENCE, AND WHAT IT IS NOT
 * --------------------------------
 * The useful signal is price: an $18 line against a $90 bottle is a glass.
 * This service returns the observed POS line price and the inventory bottle
 * price as SEPARATE, RAW fields. It computes no ratio, emits no suggestion,
 * and ranks no candidate — turning the two numbers into a verdict is the
 * human's job, and a "suggested_unit" field would be an inferred unit wearing
 * a different name. `unit_if_unanswered` is not a suggestion either: it is a
 * statement of what the existing code will do to this row on the next sale if
 * nobody answers.
 *
 * Evidence is reported as absent rather than omitted. A row with no observed
 * line and no reachable inventory row returns explicit zero/null fields and an
 * `inventory_link` of "dangling"/"unmapped", so the surface can say "nothing
 * to go on here" instead of rendering blanks that look like data.
 *
 * WHY THE WRITE PATH READS FIRST
 * ------------------------------
 * `PosHubService.upsertItemMapping` builds its row from scratch — absent
 * fields become `is_wine: false`, `inventory_id: null`, `category: null`. It
 * upserts on (restaurant_id, source, external_item_id, item_name), so sending
 * only an identity plus a unit would UPSERT OVER the existing row and wipe the
 * inventory link that makes the mapping worth anything. Every write here
 * therefore loads the current row and merges, so `sale_unit` is the only
 * column whose value changes.
 */

export type InventoryLink = "ok" | "unmapped" | "dangling";

export interface ObservedPrice {
  /**
   * Which key matched the POS lines, mirroring
   * `PosHubService.resolveWine`: external id first, exact lowercase name
   * second. Null when no line matched at all.
   */
  matched_by: "external_item_id" | "item_name" | null;
  line_count: number;
  unit_count: number;
  min: number | null;
  max: number | null;
  latest: number | null;
  latest_at: string | null;
}

export interface InventoryEvidence {
  id: string;
  wine_name: string | null;
  bottle_size_ml: number | null;
  pour_size_ml: number | null;
  /** Bottle price — the number to read the observed line price against. */
  menu_price_current: number | null;
  menu_price_glass: number | null;
}

export interface SaleUnitReviewRow {
  id: string;
  source: string;
  external_item_id: string | null;
  item_name: string | null;
  category: string | null;
  is_wine: boolean;
  sale_unit: SaleUnit | null;
  updated_at: string | null;
  /**
   * True when this row reaches the unit branch of `applyStockEffects` at all
   * (wine, with an inventory id). A row that is false here cannot mis-deplete
   * today no matter what its unit is.
   */
  depletes_stock: boolean;
  /** What the current code books if `sale_unit` stays null. Not advice. */
  unit_if_unanswered: SaleUnit;
  inventory_link: InventoryLink;
  inventory: InventoryEvidence | null;
  observed_price: ObservedPrice;
}

export interface SaleUnitReviewResponse {
  restaurant_id: string;
  checks_scanned: number;
  checks_window: { from: string | null; to: string | null };
  summary: {
    total_mappings: number;
    needing_unit: number;
    returned: number;
    with_observed_price: number;
    with_inventory: number;
    dangling_inventory: number;
    deplete_on_next_sale: number;
  };
  items: SaleUnitReviewRow[];
}

export interface SetSaleUnitResult {
  mapping_id: string;
  ok: boolean;
  sale_unit: SaleUnit | null;
  previous_sale_unit: SaleUnit | null;
  item_name: string | null;
  error?: string;
}

const DEFAULT_CHECK_LIMIT = 500;

interface PriceAccumulator {
  line_count: number;
  unit_count: number;
  min: number | null;
  max: number | null;
  latest: number | null;
  latest_at: string | null;
}

function emptyObservedPrice(): ObservedPrice {
  return {
    matched_by: null,
    line_count: 0,
    unit_count: 0,
    min: null,
    max: null,
    latest: null,
    latest_at: null,
  };
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

@Injectable()
export class PosMappingReviewService {
  private readonly logger = new Logger(PosMappingReviewService.name);

  constructor(
    private readonly dbService: DatabaseService,
    private readonly posHub: PosHubService,
  ) {}

  // =========================================================================
  // Read
  // =========================================================================

  async listNeedingSaleUnit(
    restaurantId: string,
    opts: { includeAnswered?: boolean; checkLimit?: number } = {},
  ): Promise<SaleUnitReviewResponse> {
    const checkLimit = opts.checkLimit ?? DEFAULT_CHECK_LIMIT;
    const db = this.dbService.getClient();

    // One fetch, filtered in memory. The whole point of the surface is that
    // the set is small and reviewed in a single pass, and reading all of it
    // is what makes `summary.total_mappings` honest rather than a second
    // round-trip that could disagree with the rows below it.
    const { data: mappingRows, error: mappingError } = await db
      .from("pos_item_mappings")
      .select(
        "id, source, external_item_id, item_name, category, is_wine, inventory_id, sale_unit, updated_at",
      )
      .eq("restaurant_id", restaurantId);
    if (mappingError) throw new Error(mappingError.message);

    const allMappings = mappingRows || [];
    const needingUnit = allMappings.filter((m: any) => m.sale_unit == null);
    const selected = opts.includeAnswered ? allMappings : needingUnit;

    const [inventoryById, priceIndex] = await Promise.all([
      this.loadInventory(restaurantId, selected),
      this.loadObservedPrices(restaurantId, checkLimit),
    ]);

    const items: SaleUnitReviewRow[] = selected.map((m: any) => {
      const inventory = m.inventory_id
        ? (inventoryById.get(m.inventory_id) ?? null)
        : null;
      const inventory_link: InventoryLink = !m.inventory_id
        ? "unmapped"
        : inventory
          ? "ok"
          : "dangling";

      return {
        id: m.id,
        source: m.source,
        external_item_id: m.external_item_id || null,
        item_name: m.item_name || null,
        category: m.category ?? null,
        is_wine: m.is_wine === true,
        sale_unit: (m.sale_unit as SaleUnit | null) ?? null,
        updated_at: m.updated_at ?? null,
        depletes_stock: m.is_wine === true && !!m.inventory_id,
        unit_if_unanswered: UNIT_IF_UNANSWERED,
        inventory_link,
        inventory,
        observed_price: this.observedPriceFor(m, priceIndex),
      };
    });

    // Rows a human can actually decide come first: observed price, then a
    // reachable bottle price, then alphabetical so the pass is repeatable.
    items.sort((a, b) => {
      const evidence = (r: SaleUnitReviewRow) =>
        (r.observed_price.line_count > 0 ? 2 : 0) + (r.inventory ? 1 : 0);
      const diff = evidence(b) - evidence(a);
      if (diff !== 0) return diff;
      return (a.item_name || "").localeCompare(b.item_name || "");
    });

    return {
      restaurant_id: restaurantId,
      checks_scanned: priceIndex.checksScanned,
      checks_window: priceIndex.window,
      summary: {
        total_mappings: allMappings.length,
        needing_unit: needingUnit.length,
        returned: items.length,
        with_observed_price: items.filter(
          (r) => r.observed_price.line_count > 0,
        ).length,
        with_inventory: items.filter((r) => r.inventory_link === "ok").length,
        dangling_inventory: items.filter((r) => r.inventory_link === "dangling")
          .length,
        deplete_on_next_sale: items.filter(
          (r) => r.depletes_stock && r.sale_unit == null,
        ).length,
      },
      items,
    };
  }

  /**
   * Inventory evidence, scoped to the mapping's own restaurant.
   *
   * The `.eq("restaurant_id", …)` is not redundant: `inventory_id` carries no
   * foreign key, so a mapping can hold an id belonging to another tenant's
   * inventory (or to a row that has since been deleted). Scoping the read
   * means such a row reports `inventory_link: "dangling"` instead of quietly
   * showing another restaurant's bottle price as this restaurant's evidence.
   */
  private async loadInventory(
    restaurantId: string,
    mappings: any[],
  ): Promise<Map<string, InventoryEvidence>> {
    const ids = Array.from(
      new Set(
        mappings
          .map((m) => m.inventory_id)
          .filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ),
      ),
    );
    const byId = new Map<string, InventoryEvidence>();
    if (ids.length === 0) return byId;

    const { data, error } = await this.dbService
      .getClient()
      .from("restaurant_inventory")
      .select(
        "id, wine_name, bottle_size_ml, pour_size_ml, menu_price_current, menu_price_glass",
      )
      .eq("restaurant_id", restaurantId)
      .in("id", ids);
    if (error) throw new Error(error.message);

    for (const row of data || []) {
      byId.set(row.id, {
        id: row.id,
        wine_name: row.wine_name ?? null,
        bottle_size_ml: toNumberOrNull(row.bottle_size_ml),
        pour_size_ml: toNumberOrNull(row.pour_size_ml),
        menu_price_current: toNumberOrNull(row.menu_price_current),
        menu_price_glass: toNumberOrNull(row.menu_price_glass),
      });
    }
    return byId;
  }

  /**
   * Observed POS line prices, indexed exactly the way the ingest resolver
   * looks a line up (`PosHubService.resolveWine`): by `external_item_id`
   * first, by exact lowercased `item_name` second. Indexing any other way
   * would show a price for lines that will not actually resolve to this
   * mapping when they arrive.
   */
  private async loadObservedPrices(
    restaurantId: string,
    checkLimit: number,
  ): Promise<{
    byExternalId: Map<string, PriceAccumulator>;
    byName: Map<string, PriceAccumulator>;
    checksScanned: number;
    window: { from: string | null; to: string | null };
  }> {
    const byExternalId = new Map<string, PriceAccumulator>();
    const byName = new Map<string, PriceAccumulator>();

    const { data, error } = await this.dbService
      .getClient()
      .from("pos_checks")
      .select("items, closed_at")
      .eq("restaurant_id", restaurantId)
      .not("closed_at", "is", null)
      .order("closed_at", { ascending: false })
      .limit(checkLimit);
    if (error) throw new Error(error.message);

    const checks = data || [];
    let from: string | null = null;
    let to: string | null = null;

    const record = (
      index: Map<string, PriceAccumulator>,
      key: string,
      price: number,
      qty: number,
      closedAt: string | null,
    ) => {
      const acc = index.get(key) ?? {
        line_count: 0,
        unit_count: 0,
        min: null,
        max: null,
        latest: null,
        latest_at: null,
      };
      acc.line_count += 1;
      acc.unit_count += qty;
      acc.min = acc.min === null ? price : Math.min(acc.min, price);
      acc.max = acc.max === null ? price : Math.max(acc.max, price);
      // Checks arrive newest-first, so the first sighting of a key is the
      // latest one. Later sightings are older and must not overwrite it.
      if (acc.latest === null) {
        acc.latest = price;
        acc.latest_at = closedAt;
      }
      index.set(key, acc);
    };

    for (const check of checks) {
      const closedAt: string | null = check.closed_at ?? null;
      if (closedAt) {
        if (to === null || closedAt > to) to = closedAt;
        if (from === null || closedAt < from) from = closedAt;
      }
      const lines = Array.isArray(check.items) ? check.items : [];
      for (const line of lines) {
        // `price` is the POS unit price, not the extended line total — the
        // same field `logConsumption` books as `unit_price` — so it is
        // directly comparable to `menu_price_current`.
        const price = toNumberOrNull(line?.price);
        if (price === null) continue;
        const qty = Math.max(0, Math.round(toNumberOrNull(line?.qty) ?? 0));
        const externalId = line?.external_item_id;
        if (typeof externalId === "string" && externalId.length > 0) {
          record(byExternalId, externalId, price, qty, closedAt);
        }
        const name = line?.name;
        if (typeof name === "string" && name.length > 0) {
          record(byName, name.toLowerCase(), price, qty, closedAt);
        }
      }
    }

    return {
      byExternalId,
      byName,
      checksScanned: checks.length,
      window: { from, to },
    };
  }

  private observedPriceFor(
    mapping: any,
    index: {
      byExternalId: Map<string, PriceAccumulator>;
      byName: Map<string, PriceAccumulator>;
    },
  ): ObservedPrice {
    const externalId = mapping.external_item_id;
    if (typeof externalId === "string" && externalId.length > 0) {
      const hit = index.byExternalId.get(externalId);
      if (hit) return { matched_by: "external_item_id", ...hit };
    }
    const name = mapping.item_name;
    if (typeof name === "string" && name.length > 0) {
      const hit = index.byName.get(name.toLowerCase());
      if (hit) return { matched_by: "item_name", ...hit };
    }
    return emptyObservedPrice();
  }

  // =========================================================================
  // Write — the human's answer, and nothing else
  // =========================================================================

  async setSaleUnit(
    restaurantId: string,
    mappingId: string,
    saleUnit: SaleUnit,
  ): Promise<SetSaleUnitResult> {
    const existing = await this.loadMapping(restaurantId, mappingId);
    if (!existing) {
      throw new Error(`Mapping ${mappingId} not found for this restaurant`);
    }

    // Merge, never replace. See the class comment: upsertItemMapping rebuilds
    // the row from the object it is handed, so every column that must survive
    // has to be passed back in explicitly.
    const saved = await this.posHub.upsertItemMapping(restaurantId, {
      source: existing.source,
      external_item_id: existing.external_item_id,
      item_name: existing.item_name,
      category: existing.category,
      is_wine: existing.is_wine === true,
      master_wine_id: existing.master_wine_id,
      inventory_id: existing.inventory_id,
      sale_unit: saleUnit,
    });

    return {
      mapping_id: mappingId,
      ok: true,
      sale_unit: (saved?.sale_unit as SaleUnit | null) ?? saleUnit,
      previous_sale_unit: (existing.sale_unit as SaleUnit | null) ?? null,
      item_name: existing.item_name || null,
    };
  }

  /**
   * Batch form. Entries are applied one at a time and independently: a human
   * working through ninety-odd rows should not lose the eighty that were right
   * because the eighty-first names a mapping that was deleted underneath them.
   */
  async setSaleUnitBatch(
    restaurantId: string,
    answers: SaleUnitAnswerDto[],
  ): Promise<{
    updated: number;
    failed: number;
    results: SetSaleUnitResult[];
  }> {
    const results: SetSaleUnitResult[] = [];
    for (const answer of answers) {
      try {
        results.push(
          await this.setSaleUnit(
            restaurantId,
            answer.mapping_id,
            answer.sale_unit,
          ),
        );
      } catch (error: any) {
        this.logger.warn(
          `sale_unit write failed for mapping ${answer.mapping_id}: ${error?.message}`,
        );
        results.push({
          mapping_id: answer.mapping_id,
          ok: false,
          sale_unit: null,
          previous_sale_unit: null,
          item_name: null,
          error: error?.message || "Update failed",
        });
      }
    }
    return {
      updated: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  /**
   * Scoped by restaurant as well as id — the id alone is a global primary key,
   * so without the `restaurant_id` filter a caller holding any mapping uuid
   * could set the unit on another restaurant's mapping.
   */
  private async loadMapping(restaurantId: string, mappingId: string) {
    const { data, error } = await this.dbService
      .getClient()
      .from("pos_item_mappings")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("id", mappingId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }
}
