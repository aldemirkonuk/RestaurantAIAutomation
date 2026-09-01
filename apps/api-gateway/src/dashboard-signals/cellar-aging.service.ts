import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  DrinkWindow,
  DrinkWindowItem,
  DrinkWindowItemValue,
  DrinkWindowResponse,
  DrinkWindowUrgency,
} from "./dto/dashboard-signals.dto";

/**
 * Cellar aging — the half of "drink window" that needs no new capture
 * (dashboard rebuild spec §5).
 *
 * The chef's split is why this service exists on its own: "For full bottles and
 * cellar stock, the 'on a clock' logic works fine off delivery date and known
 * drinking windows without anyone touching a button." Everything below is
 * assembled from rows that are already written by receiving, procurement and
 * the wine catalogue. Nothing here asks anyone to log anything.
 *
 * THE RANKING RULE
 * ----------------
 * Urgency, never money: "a $40 bottle nobody's pouring that's about to tip over
 * matters more today than a $400 bottle with five good years left." Value is
 * carried on every row because the owner wants to see it, and it is excluded
 * from the sort key on purpose. `urgencyRank` is published so a surface cannot
 * quietly re-sort by dollars and still call the column urgency.
 *
 * WHAT IS MEASURED AND WHAT IS INFERRED (ADR 0051, spec §4/§5)
 * ------------------------------------------------------------
 *   measured   vintage, aging_potential_years   master_wine_library columns
 *   measured   received_at                      inventory_lots
 *   measured   delivered_at                     procurement_orders
 *   measured   live qty, WAC                    inventory_lot_rollup
 *   INFERRED   the drink-by year                vintage + aging potential
 *
 * The last line is why every window carries `confidence: "estimated"`. Aging
 * potential is a property of the WINE in the catalogue, not a measurement of
 * this bottle in this cellar, and the chef's rule is explicit:
 * "rough-but-labelled I'll use. Rough-but-confident I'll ignore within a week."
 *
 * WHERE THE WINDOW IS NOT KNOWABLE, THE ITEM SAYS SO
 * --------------------------------------------------
 * Roughly a third of the catalogue is missing either a vintage or an aging
 * potential (production, 2026-09-01: 4,094 rows, 2,852 with both). Those items
 * come back with `window: null` and a per-item `windowUnknownReason`, and they
 * rank last. A default window would be the exact failure ADR 0051 exists to
 * prevent — a fabricated "drink by 2029" is indistinguishable from a real one.
 *
 * NOT READ HERE
 * -------------
 * Sales. Nothing in this service knows whether a bottle is actually being
 * poured; `pos_checks` is not queried. "Nobody's pouring it" is the owner's
 * read of a long hold, not a claim this service makes.
 */
@Injectable()
export class CellarAgingService {
  private readonly logger = new Logger(CellarAgingService.name);

  /** Safety cap on rows scanned per request. Not a display page size. */
  static readonly DEFAULT_LIMIT = 500;

  /**
   * Tier order. The index IS the ranking weight, so adding a tier in the
   * middle re-ranks everything below it — deliberate, and the reason the
   * numeric rank is published rather than implied by array position.
   */
  private static readonly TIERS: DrinkWindowUrgency[] = [
    "past_window",
    "closing",
    "watch",
    "holding",
    "unknown",
  ];

  constructor(private readonly dbService: DatabaseService) {}

  async getDrinkWindow(
    restaurantId: string,
    opts: { limit?: number } = {},
  ): Promise<DrinkWindowResponse> {
    const limit = Math.max(
      1,
      Math.min(opts.limit ?? CellarAgingService.DEFAULT_LIMIT, 2000),
    );
    const client = this.dbService.getClient();
    const now = new Date();

    // Spec §6: tenant-scoped at the database, not filtered in memory after the
    // fact. `limit + 1` is how truncation is detected without a second count.
    const { data: inventoryRows, error } = await client
      .from("restaurant_inventory")
      .select("id, master_wine_id, wine_name, stock_live")
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .limit(limit + 1);

    if (error) {
      this.logger.warn(`drink-window inventory query failed: ${error.message}`);
      throw new Error(error.message);
    }

    const fetched = inventoryRows ?? [];
    const truncated = fetched.length > limit;
    const inventory = truncated ? fetched.slice(0, limit) : fetched;

    if (inventory.length === 0) {
      return this.envelope(restaurantId, now, [], {
        itemsConsidered: 0,
        itemsWithKnownWindow: 0,
        itemsWithoutKnownWindow: 0,
        itemsWithoutLandedDate: 0,
        truncated,
      });
    }

    const wineIds = Array.from(
      new Set(inventory.map((r: any) => r.master_wine_id).filter(Boolean)),
    );

    // Every `.from()` below takes a string literal, deliberately:
    // scripts/check_queried_tables_exist.py resolves table names statically and
    // a variable would push this module into its unresolvable set, quietly
    // removing three tables from the guard's coverage.
    const [rollupRows, lotRows, orderRows, catalogRows] = await Promise.all([
      this.run("inventory_lot_rollup", () =>
        client
          .from("inventory_lot_rollup")
          .select("inventory_id, live_qty, wac, has_invoice_cost")
          .eq("restaurant_id", restaurantId),
      ),
      this.run("inventory_lots", () =>
        client
          .from("inventory_lots")
          .select("inventory_id, received_at, vintage")
          .eq("restaurant_id", restaurantId)
          .eq("stock_state", "live")
          .eq("status", "active"),
      ),
      this.run("procurement_orders", () =>
        client
          .from("procurement_orders")
          .select("inventory_id, delivered_at")
          .eq("restaurant_id", restaurantId)
          .not("delivered_at", "is", null),
      ),
      // master_wine_library is a GLOBAL catalogue — it has no restaurant_id, so
      // there is nothing to tenant-filter. Isolation comes from the id list,
      // which is built only from this restaurant's inventory rows above.
      wineIds.length === 0
        ? Promise.resolve([])
        : this.run("master_wine_library", () =>
            client
              .from("master_wine_library")
              .select("id, name, producer, vintage, aging_potential_years")
              .in("id", wineIds),
          ),
    ]);

    const rollup = new Map<string, any>(
      rollupRows.map((r: any) => [r.inventory_id, r]),
    );
    const catalog = new Map<string, any>(
      catalogRows.map((r: any) => [r.id, r]),
    );

    // Earliest live lot per item — the moment this stock started its clock.
    const earliestLot = new Map<
      string,
      { at: string; vintage: number | null }
    >();
    for (const lot of lotRows) {
      if (!lot?.received_at) continue;
      const current = earliestLot.get(lot.inventory_id);
      if (!current || lot.received_at < current.at) {
        earliestLot.set(lot.inventory_id, {
          at: lot.received_at,
          vintage: lot.vintage ?? current?.vintage ?? null,
        });
      }
    }

    // Latest delivery per item — the fallback landing record when no lot row
    // exists. Latest, not earliest: it is the most recent time stock of this
    // item is known to have arrived.
    const lastDelivery = new Map<string, string>();
    for (const order of orderRows) {
      if (!order?.delivered_at) continue;
      const current = lastDelivery.get(order.inventory_id);
      if (!current || order.delivered_at > current) {
        lastDelivery.set(order.inventory_id, order.delivered_at);
      }
    }

    const items: DrinkWindowItem[] = [];
    for (const row of inventory) {
      const item = this.buildItem(
        row,
        rollup.get(row.id),
        earliestLot.get(row.id),
        lastDelivery.get(row.id),
        catalog.get(row.master_wine_id),
        now,
      );
      if (item) items.push(item);
    }

    this.rankByUrgency(items);

    return this.envelope(restaurantId, now, items, {
      itemsConsidered: items.length,
      itemsWithKnownWindow: items.filter((i) => i.window !== null).length,
      itemsWithoutKnownWindow: items.filter((i) => i.window === null).length,
      itemsWithoutLandedDate: items.filter((i) => i.landedAt === null).length,
      truncated,
    });
  }

  // -------------------------------------------------------------------------

  /**
   * `label` is for the log line only. The table literal stays at the call site
   * so the static schema guard can still see it.
   */
  private async run(label: string, build: () => any): Promise<any[]> {
    try {
      const { data, error } = await build();
      if (error) {
        this.logger.warn(
          `drink-window ${label} query failed: ${error.message}`,
        );
        return [];
      }
      return data ?? [];
    } catch (err: any) {
      this.logger.warn(`drink-window ${label} query threw: ${err?.message}`);
      return [];
    }
  }

  private buildItem(
    row: any,
    rollupRow: any | undefined,
    lot: { at: string; vintage: number | null } | undefined,
    deliveredAt: string | undefined,
    wine: any | undefined,
    now: Date,
  ): DrinkWindowItem | null {
    // Lots are the source of truth; `stock_live` answers only when the item has
    // no lot rows at all. Which book answered is reported, because the two can
    // disagree.
    const hasRollup = rollupRow != null && rollupRow.live_qty != null;
    const bottles = hasRollup
      ? Number(rollupRow.live_qty)
      : Number(row.stock_live ?? 0);
    if (!bottles || bottles <= 0) return null;

    const landedAt = lot?.at ?? deliveredAt ?? null;
    const landedBasis: DrinkWindowItem["landedBasis"] = lot
      ? "lot_received"
      : deliveredAt
        ? "order_delivered"
        : "unknown";
    const heldDays =
      landedAt === null
        ? null
        : Math.floor(
            (now.getTime() - new Date(landedAt).getTime()) / 86_400_000,
          );

    // The lot's vintage is what physically arrived; the catalogue's is what the
    // wine generally is. Prefer the lot.
    const vintage = lot?.vintage ?? wine?.vintage ?? null;
    const agingPotential = wine?.aging_potential_years ?? null;

    let window: DrinkWindow | null = null;
    let windowUnknownReason: string | null = null;

    if (vintage == null && agingPotential == null) {
      windowUnknownReason =
        "no vintage and no aging potential recorded for this wine";
    } else if (vintage == null) {
      windowUnknownReason = "no vintage recorded, so the clock has no start";
    } else if (agingPotential == null) {
      windowUnknownReason =
        "no aging potential recorded for this wine in the catalogue";
    } else {
      const drinkByYear = Number(vintage) + Number(agingPotential);
      window = {
        drinkByYear,
        yearsRemaining: drinkByYear - now.getFullYear(),
        agingPotentialYears: Number(agingPotential),
        vintage: Number(vintage),
        confidence: "estimated",
        basis: `master_wine_library.aging_potential_years (${agingPotential}y) applied to vintage ${vintage}; whole years, which is all the source data carries`,
      };
    }

    let value: DrinkWindowItemValue | null = null;
    let valueUnknownReason: string | null = null;
    const wac = rollupRow?.wac;
    if (wac == null) {
      valueUnknownReason = hasRollup
        ? "no unit cost on any live lot for this item"
        : "no lot rows for this item, so no cost is known";
    } else {
      value = {
        amount: Math.round(bottles * Number(wac) * 100) / 100,
        basis: rollupRow?.has_invoice_cost ? "invoice" : "estimated",
        currency: "USD",
      };
    }

    const urgency = this.urgencyOf(window);

    return {
      inventoryId: row.id,
      masterWineId: row.master_wine_id ?? null,
      name: wine?.name ?? row.wine_name ?? "(no name recorded)",
      producer: wine?.producer ?? null,
      vintage: vintage == null ? null : Number(vintage),
      bottles,
      bottlesBasis: hasRollup ? "lots" : "stock_live",
      landedAt,
      heldDays,
      landedBasis,
      window,
      windowUnknownReason,
      urgency,
      urgencyRank: this.rankOf(urgency, window),
      value,
      valueUnknownReason,
    };
  }

  /**
   * Tier thresholds. These are policy, not measurement, so they are published
   * in the response `basis` rather than left as bare constants a reader has to
   * guess at.
   */
  private urgencyOf(window: DrinkWindow | null): DrinkWindowUrgency {
    if (!window) return "unknown";
    if (window.yearsRemaining < 0) return "past_window";
    if (window.yearsRemaining <= 1) return "closing";
    if (window.yearsRemaining <= 3) return "watch";
    return "holding";
  }

  private rankOf(
    urgency: DrinkWindowUrgency,
    window: DrinkWindow | null,
  ): number {
    const tier = CellarAgingService.TIERS.indexOf(urgency);
    return tier * 1_000_000 + Math.round((window?.yearsRemaining ?? 0) * 100);
  }

  /**
   * Sorts in place. Money is not a term in this comparator, and that is the
   * whole design: the tie-break is how long the stock has been sitting, so a
   * bottle held longer surfaces first among equally-overdue ones.
   */
  private rankByUrgency(items: DrinkWindowItem[]): void {
    items.sort((a, b) => {
      if (a.urgencyRank !== b.urgencyRank) return a.urgencyRank - b.urgencyRank;
      // Longer-held first; an unknown holding time sorts after a known one,
      // because "we do not know" is not evidence of urgency.
      const ah = a.heldDays ?? -1;
      const bh = b.heldDays ?? -1;
      if (ah !== bh) return bh - ah;
      return a.name.localeCompare(b.name);
    });
  }

  private envelope(
    restaurantId: string,
    now: Date,
    items: DrinkWindowItem[],
    coverage: DrinkWindowResponse["coverage"],
  ): DrinkWindowResponse {
    return {
      restaurantId,
      generatedAt: now.toISOString(),
      basis: {
        window:
          "master_wine_library.vintage + master_wine_library.aging_potential_years. Both are real catalogue columns; the resulting drink-by year is INFERRED and every window is labelled estimated.",
        windowUnknown:
          "An item missing either input returns window: null with a per-item reason and ranks last. No default window is ever assumed.",
        landed:
          "Earliest live inventory_lots.received_at; where the item has no lots, the latest delivered procurement_orders.delivered_at. Neither available means landedAt is null, never today.",
        value:
          "Live bottles x weighted-average cost from inventory_lot_rollup. Null where no cost is known — never 0.",
        ranking:
          "Urgency only: tier (past_window, closing, watch, holding, unknown), then years remaining, then how long the stock has been held. Dollar value never enters the sort.",
        urgencyTiers:
          "past_window: drink-by year already passed. closing: 0-1 years left. watch: 2-3 years left. holding: 4+ years left. unknown: window not knowable.",
        coverage:
          "When truncated is true every coverage count is a FLOOR, and the ranking is over the rows that were scanned rather than the whole cellar.",
        excludes:
          "Sales. pos_checks is not read here, so nothing in this payload knows whether a bottle is actually being poured.",
      },
      coverage,
      items,
    };
  }
}
