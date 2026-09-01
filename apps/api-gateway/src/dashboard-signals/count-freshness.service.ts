import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  CountCorrection,
  CountCoverDelta,
  CountFreshnessItem,
  CountFreshnessResponse,
} from "./dto/dashboard-signals.dto";

/**
 * Count freshness and attribution (dashboard rebuild spec §3.1).
 *
 * WHY THIS EXISTS
 * ---------------
 * Every figure on the rebuilt dashboard rests on somebody's stock count, and
 * the person doing the counting currently gets nothing back. The sommelier:
 * "it quietly consumes my labour and hands the credit to a KPI tile. Give me
 * nothing back, I stop caring about precision, and precision is the whole
 * foundation this thing stands on." That is a data-quality risk, not a
 * courtesy, which is why it is a service rather than a UI string.
 *
 * WHAT HE ASKED FOR, EXACTLY
 * --------------------------
 * "Proof isn't a badge, it's a before/after I can point to" — "4 days left →
 * corrected to 2 days, reorder triggered, because of your count on 8/29."
 * A number that moved, dated and attributed. He named streaks, badges and
 * thank-you toasts as insulting, so none are produced here.
 *
 * THE TRAP THIS SERVICE IS BUILT AROUND
 * -------------------------------------
 * Spot counts write through `set_stock_absolute`, which returns before writing
 * anything when the count matches:
 *
 *     v_delta := p_target_qty - v_current;
 *     IF v_delta = 0 THEN RETURN NULL; END IF;
 *     -- supabase/migrations/20260805131000:44-45
 *
 * while `recordSpotCount` stamps `last_counted_at` regardless (decision E41,
 * inventory.service.ts:387-401). So a count that CONFIRMS the number leaves a
 * freshness stamp and no ledger row at all.
 *
 * That makes "no reconciliation row" ambiguous, and the ambiguity is exactly
 * where a lie would get in. Three different claims are separated here and
 * never collapsed:
 *
 *   lastCountChangedStock === true   a real ledger row, attributable to the
 *                                    last count. Before/after is quotable.
 *   lastCountChangedStock === false  counted, and the count changed nothing.
 *   lastCountChangedStock === null   never counted. Nothing to attribute.
 *
 * When the effect cannot be traced, `lastCorrection` is null and the surface
 * says nothing rather than claiming credit.
 */
@Injectable()
export class CountFreshnessService {
  private readonly logger = new Logger(CountFreshnessService.name);

  static readonly DEFAULT_LIMIT = 500;

  /**
   * Advisory staleness threshold. A stated default, NOT a decided policy and
   * not a measured value — it is published in the payload so a surface renders
   * the rule it is actually using instead of hiding a constant.
   */
  static readonly STALE_AFTER_DAYS = 7;

  /**
   * How close a reconciliation row must sit to `last_counted_at` to be
   * attributed to that count. `recordSpotCount` writes the ledger row and then
   * stamps `last_counted_at` on the very next statement, so the real gap is
   * milliseconds; five minutes is deliberately generous and still nowhere near
   * wide enough to swallow a previous day's correction.
   */
  static readonly ATTRIBUTION_WINDOW_SECONDS = 300;

  constructor(private readonly dbService: DatabaseService) {}

  async getCountFreshness(
    restaurantId: string,
    opts: { inventoryIds?: string[]; limit?: number } = {},
  ): Promise<CountFreshnessResponse> {
    const limit = Math.max(
      1,
      Math.min(opts.limit ?? CountFreshnessService.DEFAULT_LIMIT, 2000),
    );
    const client = this.dbService.getClient();
    const now = new Date();

    // Spec §6: tenant-scoped at the database on every query below, ledger
    // included. inventory_transactions carries restaurant_id as a real column,
    // so there is no excuse for filtering it by inventory_id alone.
    let itemQuery = client
      .from("restaurant_inventory")
      .select("id, wine_name, last_counted_at")
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null);
    if (opts.inventoryIds?.length) {
      itemQuery = itemQuery.in("id", opts.inventoryIds);
    }

    const { data: rows, error } = await itemQuery.limit(limit + 1);
    if (error) {
      this.logger.warn(
        `count-freshness inventory query failed: ${error.message}`,
      );
      throw new Error(error.message);
    }

    const fetched = rows ?? [];
    const truncated = fetched.length > limit;
    const inventory = truncated ? fetched.slice(0, limit) : fetched;

    if (inventory.length === 0) {
      return this.envelope(restaurantId, now, [], {
        itemsConsidered: 0,
        itemsEverCounted: 0,
        itemsWithTraceableCorrection: 0,
        truncated,
      });
    }

    const ids = inventory.map((r: any) => r.id);

    // Table names stay as string literals at the call site so
    // scripts/check_queried_tables_exist.py can resolve them statically.
    const [txnRows, analyticsRows] = await Promise.all([
      this.run("inventory_transactions", () =>
        client
          .from("inventory_transactions")
          .select(
            "id, inventory_id, source, quantity_before, quantity_after, quantity_change, transaction_date, performed_by, reason",
          )
          .eq("restaurant_id", restaurantId)
          // Only counts. A sale or a pour also carries a before/after, and
          // presenting one as "because of your count" would be a fabricated
          // attribution — the precise thing the sommelier said would cost him
          // his trust in the number.
          .eq("transaction_type", "reconciliation")
          .in("inventory_id", ids)
          .order("transaction_date", { ascending: false }),
      ),
      this.run("inventory_analytics", () =>
        client
          .from("inventory_analytics")
          .select("inventory_id, velocity_per_day")
          .eq("restaurant_id", restaurantId),
      ),
    ]);

    const latestCorrection = new Map<string, any>();
    for (const txn of txnRows) {
      const current = latestCorrection.get(txn.inventory_id);
      if (!current || txn.transaction_date > current.transaction_date) {
        latestCorrection.set(txn.inventory_id, txn);
      }
    }

    const velocity = new Map<string, number | null>(
      analyticsRows.map((r: any) => [
        r.inventory_id,
        r.velocity_per_day == null ? null : Number(r.velocity_per_day),
      ]),
    );

    const items = inventory.map((row: any) =>
      this.buildItem(
        row,
        latestCorrection.get(row.id),
        velocity.get(row.id) ?? null,
        now,
      ),
    );

    return this.envelope(restaurantId, now, items, {
      itemsConsidered: items.length,
      itemsEverCounted: items.filter((i) => i.lastCountedAt !== null).length,
      itemsWithTraceableCorrection: items.filter(
        (i) => i.lastCorrection !== null,
      ).length,
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
          `count-freshness ${label} query failed: ${error.message}`,
        );
        return [];
      }
      return data ?? [];
    } catch (err: any) {
      this.logger.warn(`count-freshness ${label} query threw: ${err?.message}`);
      return [];
    }
  }

  private buildItem(
    row: any,
    txn: any | undefined,
    velocityPerDay: number | null,
    now: Date,
  ): CountFreshnessItem {
    const lastCountedAt: string | null = row.last_counted_at ?? null;
    const daysSinceCount =
      lastCountedAt === null
        ? null
        : Math.floor(
            (now.getTime() - new Date(lastCountedAt).getTime()) / 86_400_000,
          );

    const attributed = this.attributable(lastCountedAt, txn);

    let lastCorrection: CountCorrection | null = null;
    let correctionUnknownReason: string | null = null;
    let lastCountChangedStock: boolean | null = null;

    if (lastCountedAt === null) {
      // Not "no change" — a different claim entirely, and the UI must be able
      // to tell them apart.
      lastCountChangedStock = null;
      correctionUnknownReason = "this item has never been counted";
    } else if (attributed && txn) {
      lastCountChangedStock = true;
      lastCorrection = {
        transactionId: txn.id,
        at: txn.transaction_date,
        quantityBefore: Number(txn.quantity_before),
        quantityAfter: Number(txn.quantity_after),
        delta: Number(txn.quantity_change),
        source: txn.source,
        performedBy: txn.performed_by ?? null,
        reason: txn.reason ?? null,
      };
    } else if (txn) {
      lastCountChangedStock = false;
      correctionUnknownReason = `the last count recorded no change; the most recent correction (${txn.transaction_date}) predates it and belongs to an earlier count`;
    } else {
      lastCountChangedStock = false;
      correctionUnknownReason =
        "the count confirmed the number on hand, so no change was recorded";
    }

    let coverDelta: CountCoverDelta | null = null;
    let coverDeltaUnknownReason: string | null = null;

    if (!lastCorrection) {
      coverDeltaUnknownReason =
        "no traceable correction, so there is no before and after to compare";
    } else if (velocityPerDay == null || velocityPerDay <= 0) {
      // Not zero days, not infinite days. Not knowable.
      coverDeltaUnknownReason =
        "no sales velocity recorded for this item, so days of cover is not knowable";
    } else {
      coverDelta = {
        velocityPerDay,
        velocityBasis:
          "inventory_analytics.velocity_per_day (30-day sale mean from inventory_transactions)",
        daysOfCoverBefore: Math.round(
          lastCorrection.quantityBefore / velocityPerDay,
        ),
        daysOfCoverAfter: Math.round(
          lastCorrection.quantityAfter / velocityPerDay,
        ),
        confidence: "estimated",
      };
    }

    return {
      inventoryId: row.id,
      name: row.wine_name ?? "(no name recorded)",
      lastCountedAt,
      daysSinceCount,
      lastCorrection,
      correctionUnknownReason,
      lastCountChangedStock,
      coverDelta,
      coverDeltaUnknownReason,
    };
  }

  /**
   * A correction belongs to the last count only when it landed inside the
   * attribution window immediately before the freshness stamp. Anything older
   * belongs to an earlier count, and claiming it would credit the wrong
   * person's work — which is the failure the sommelier described.
   */
  private attributable(lastCountedAt: string | null, txn: any | undefined) {
    if (!lastCountedAt || !txn?.transaction_date) return false;
    const stamped = new Date(lastCountedAt).getTime();
    const written = new Date(txn.transaction_date).getTime();
    if (Number.isNaN(stamped) || Number.isNaN(written)) return false;
    const gapSeconds = (stamped - written) / 1000;
    return (
      gapSeconds >= -CountFreshnessService.ATTRIBUTION_WINDOW_SECONDS &&
      gapSeconds <= CountFreshnessService.ATTRIBUTION_WINDOW_SECONDS
    );
  }

  private envelope(
    restaurantId: string,
    now: Date,
    items: CountFreshnessItem[],
    coverage: CountFreshnessResponse["coverage"],
  ): CountFreshnessResponse {
    return {
      restaurantId,
      generatedAt: now.toISOString(),
      basis: {
        freshness:
          "restaurant_inventory.last_counted_at, stamped by recordSpotCount on every count including one whose delta was zero (decision E41).",
        attribution:
          "The latest inventory_transactions row with transaction_type = 'reconciliation', attributed to the last count only when it landed inside the attribution window before the freshness stamp.",
        noRow:
          "set_stock_absolute writes no ledger row when the counted quantity matches (migration 20260805131000:44), so a missing row means the count CONFIRMED the number — not that no count happened. lastCountChangedStock separates the two, and null means never counted.",
        coverDelta:
          "quantity_before and quantity_after divided by inventory_analytics.velocity_per_day. Velocity is a 30-day mean, so the day figures are estimated. Null where no velocity is recorded — never 0 days.",
        coverage:
          "When truncated is true every coverage count is a FLOOR, not a total.",
      },
      policy: {
        staleAfterDays: CountFreshnessService.STALE_AFTER_DAYS,
        attributionWindowSeconds:
          CountFreshnessService.ATTRIBUTION_WINDOW_SECONDS,
      },
      coverage,
      items,
    };
  }
}
