import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  IdleStockItem,
  IdleStockResponse,
  NO_REASON_RECORDED,
  PURCHASE_REASON_CODES,
  PURCHASE_REASON_LABELS,
  PurchaseReasonCode,
  PurchaseReasonForItem,
  PurchaseReasonRecord,
  RecordPurchaseReasonDto,
} from "./dto/dashboard-signals.dto";

/**
 * The "why" on a purchase (dashboard rebuild spec §3.2).
 *
 * The chef's ask, and the two constraints that decided the whole design:
 *
 *   "Paragraphs are dead on arrival."
 *     → five preset chips, tap-once and complete. `reason_code` is a closed
 *       set mirrored by a CHECK constraint; `note` exists for the later voice
 *       note, is never required, and is never rendered as the reason.
 *
 *   "It appears at ORDERING, not receiving. Ordering is the one moment I
 *    already have intent in my head — I know why I'm buying the six bottles of
 *    Barolo the second I hit confirm. Ask me then or you've lost the window."
 *     → `recordReason` refuses once the goods have landed, and stores the
 *       order's REAL status at the moment of capture rather than a claim, so a
 *       reader can say "recorded at ordering" and be right (ADR 0051).
 *
 * Why it matters downstream: the vendor strip calls stock "not moving", and
 * the chef's objection to that framing was that "the same dollar figure covers
 * 'I made a buying mistake' and 'this is aging exactly as planned.'" This is
 * the field that separates them — and where no row exists, the read says
 * "no reason recorded" rather than guessing which of the two it was.
 */
@Injectable()
export class PurchaseReasonService {
  private readonly logger = new Logger(PurchaseReasonService.name);

  /**
   * Order states that mean the goods have arrived. Past these, the ordering
   * window has closed: receiving is chaos and a weeks-later flag cannot
   * recover the reason, so a reason captured here would be a reconstruction,
   * not a memory.
   */
  private static readonly LANDED_STATUSES = new Set([
    "delivered",
    "received",
    "completed",
    "cancelled",
  ]);

  constructor(private readonly dbService: DatabaseService) {}

  /** The chips, server-side, so no surface can drift from the decided wording. */
  listOptions(): Array<{ code: PurchaseReasonCode; label: string }> {
    return PURCHASE_REASON_CODES.map((code) => ({
      code,
      label: PURCHASE_REASON_LABELS[code],
    }));
  }

  async recordReason(
    dto: RecordPurchaseReasonDto,
  ): Promise<PurchaseReasonRecord> {
    if (!PURCHASE_REASON_CODES.includes(dto.reasonCode)) {
      throw new HttpException(
        `reasonCode must be one of: ${PURCHASE_REASON_CODES.join(", ")}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const client = this.dbService.getClient();

    // Spec §6: the order lookup is tenant-scoped at the database, and every
    // value written below comes from the ROW, not from the request body. A
    // caller cannot attach a reason to another unit's purchase, and cannot
    // point a reason at an inventory item the order does not concern.
    const { data: order, error: orderErr } = await client
      .from("procurement_orders")
      .select("id, restaurant_id, inventory_id, status, delivered_at")
      .eq("id", dto.orderId)
      .eq("restaurant_id", dto.restaurantId)
      .single();

    if (orderErr || !order) {
      throw new HttpException(
        "Order not found for this restaurant",
        HttpStatus.NOT_FOUND,
      );
    }

    const status = String(order.status ?? "");
    if (
      order.delivered_at ||
      PurchaseReasonService.LANDED_STATUSES.has(status.toLowerCase())
    ) {
      throw new HttpException(
        `The ordering window has closed for this purchase (status ${status}). A reason recorded now would be a reconstruction, not the intent at ordering.`,
        HttpStatus.CONFLICT,
      );
    }

    const capturedAt = new Date().toISOString();
    const row = {
      restaurant_id: order.restaurant_id,
      order_id: order.id,
      inventory_id: order.inventory_id,
      reason_code: dto.reasonCode,
      note: dto.note ?? null,
      // Measured, not claimed. See the migration header.
      order_status_at_capture: status,
      captured_at: capturedAt,
      captured_by: dto.capturedBy ?? null,
      updated_at: capturedAt,
    };

    const { error: writeErr } = await client
      .from("purchase_reasons")
      .upsert(row, { onConflict: "order_id" });

    if (writeErr) {
      this.logger.error(`purchase reason write failed: ${writeErr.message}`);
      // Never return a record for a row that did not land — a surface that
      // then shows the chip as recorded is lying about stored state.
      throw new HttpException(
        `Failed to record purchase reason: ${writeErr.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return this.toRecord(row);
  }

  /**
   * Reasons for a set of inventory items, including the honest empty answer.
   *
   * Every item asked about comes back. An item with no row does NOT vanish
   * from the result — it returns `reason: null` with `reasonUnknownReason`
   * set to the literal "no reason recorded", because a missing key would let a
   * surface fall through to a default string of its own choosing.
   */
  async getReasonsForItems(
    restaurantId: string,
    inventoryIds?: string[],
  ): Promise<PurchaseReasonForItem[]> {
    const client = this.dbService.getClient();

    let query = client
      .from("purchase_reasons")
      .select(
        "order_id, inventory_id, reason_code, note, order_status_at_capture, captured_at, captured_by",
      )
      .eq("restaurant_id", restaurantId)
      .order("captured_at", { ascending: false });

    if (inventoryIds?.length) {
      query = query.in("inventory_id", inventoryIds);
    }

    const { data, error } = await query;
    if (error) {
      this.logger.warn(`purchase reason read failed: ${error.message}`);
      throw new HttpException(
        `Failed to read purchase reasons: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Newest wins where an item was bought more than once.
    const latest = new Map<string, any>();
    for (const row of data ?? []) {
      const current = latest.get(row.inventory_id);
      if (!current || row.captured_at > current.captured_at) {
        latest.set(row.inventory_id, row);
      }
    }

    const keys = inventoryIds?.length
      ? inventoryIds
      : Array.from(latest.keys());

    return keys.map((inventoryId) => {
      const row = latest.get(inventoryId);
      return {
        inventoryId,
        reason: row ? this.toRecord(row) : null,
        reasonUnknownReason: row ? null : NO_REASON_RECORDED,
      };
    });
  }

  /**
   * Idle stock with its reason attached — the read the vendor strip needs
   * (spec §2.5).
   *
   * "Idle" is not invented here. It is `inventory_analytics.dead_stock`, whose
   * definition is already in the schema: nothing sold in ninety days (or never
   * sold at all) while stock is on hand. This service only joins the reason to
   * it and reports what it cannot value.
   *
   * Ordered by how long the stock has sat, never by dollars — same reason as
   * the drink window. The chef asked for "not moving — here is what to do
   * about it", and a money-ranked list is the finance framing he rejected.
   */
  async getIdleStockWithReasons(
    restaurantId: string,
    opts: { limit?: number } = {},
  ): Promise<IdleStockResponse> {
    const limit = Math.max(1, Math.min(opts.limit ?? 200, 1000));
    const client = this.dbService.getClient();
    const now = new Date();

    const { data: idleRows, error } = await client
      .from("inventory_analytics")
      .select("inventory_id, on_hand, days_since_sale, last_sold_at")
      .eq("restaurant_id", restaurantId)
      .eq("dead_stock", true)
      .limit(limit);

    if (error) {
      this.logger.warn(`idle stock query failed: ${error.message}`);
      throw new HttpException(
        `Failed to read idle stock: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const idle = idleRows ?? [];
    if (idle.length === 0) {
      // A real zero. "Nothing idle" is a different claim from "no idea", and
      // the totals block below is what lets the strip say which one it means.
      return this.idleEnvelope(restaurantId, now, [], {
        idleItems: 0,
        capitalLocked: 0,
        capitalLockedIsFloor: false,
        itemsWithUnknownCapital: 0,
        capitalLockedUnknownReason: null,
      });
    }

    const ids = idle.map((r: any) => r.inventory_id);

    // Table names stay as string literals at the call site so
    // scripts/check_queried_tables_exist.py can resolve them statically.
    const [namesRows, rollupRows, reasons] = await Promise.all([
      this.run("restaurant_inventory", () =>
        client
          .from("restaurant_inventory")
          .select("id, wine_name")
          .eq("restaurant_id", restaurantId)
          .in("id", ids),
      ),
      this.run("inventory_lot_rollup", () =>
        client
          .from("inventory_lot_rollup")
          .select("inventory_id, live_qty, wac, has_invoice_cost")
          .eq("restaurant_id", restaurantId)
          .in("inventory_id", ids),
      ),
      this.getReasonsForItems(restaurantId, ids),
    ]);

    const names = new Map<string, string>(
      namesRows.map((r: any) => [r.id, r.wine_name]),
    );
    const rollup = new Map<string, any>(
      rollupRows.map((r: any) => [r.inventory_id, r]),
    );
    const reasonByItem = new Map(reasons.map((r) => [r.inventoryId, r]));

    const items: IdleStockItem[] = idle.map((row: any) => {
      const roll = rollup.get(row.inventory_id);
      const bottles = Number(roll?.live_qty ?? row.on_hand ?? 0);
      const wac = roll?.wac;

      const reasonRow = reasonByItem.get(row.inventory_id);

      return {
        inventoryId: row.inventory_id,
        name: names.get(row.inventory_id) ?? "(no name recorded)",
        bottles,
        movementStatus:
          row.last_sold_at == null ? "no_movement_recorded" : "idle_since",
        daysSinceSale:
          row.days_since_sale == null ? null : Number(row.days_since_sale),
        capitalLocked:
          wac == null
            ? null
            : {
                amount: Math.round(bottles * Number(wac) * 100) / 100,
                basis: roll?.has_invoice_cost ? "invoice" : "estimated",
                currency: "USD",
              },
        capitalLockedUnknownReason:
          wac == null
            ? "no unit cost on any live lot for this item, so the capital tied up is not knowable"
            : null,
        reason: reasonRow?.reason ?? null,
        reasonUnknownReason: reasonRow?.reason
          ? null
          : (reasonRow?.reasonUnknownReason ?? NO_REASON_RECORDED),
      };
    });

    // Never moved first, then longest idle. Money is not a term.
    items.sort((a, b) => {
      const an = a.daysSinceSale == null;
      const bn = b.daysSinceSale == null;
      if (an !== bn) return an ? -1 : 1;
      if (an && bn) return a.name.localeCompare(b.name);
      return (b.daysSinceSale as number) - (a.daysSinceSale as number);
    });

    const valued = items.filter((i) => i.capitalLocked !== null);
    const unknownCount = items.length - valued.length;
    const total =
      valued.length === 0
        ? null
        : Math.round(
            valued.reduce((s, i) => s + (i.capitalLocked as any).amount, 0) *
              100,
          ) / 100;

    return this.idleEnvelope(restaurantId, now, items, {
      idleItems: items.length,
      capitalLocked: total,
      // A total assembled from only the items we can price is a floor, not a
      // sum. Rendering it as `=` would understate the real figure silently.
      capitalLockedIsFloor: total !== null && unknownCount > 0,
      itemsWithUnknownCapital: unknownCount,
      capitalLockedUnknownReason:
        total === null
          ? "idle stock is on hand, but no cost is known for any of it"
          : null,
    });
  }

  private idleEnvelope(
    restaurantId: string,
    now: Date,
    items: IdleStockItem[],
    totals: IdleStockResponse["totals"],
  ): IdleStockResponse {
    return {
      restaurantId,
      generatedAt: now.toISOString(),
      basis: {
        idle: "inventory_analytics.dead_stock — nothing sold in 90 days, or never sold, while stock is on hand. Definition already in the schema; not invented here.",
        reason:
          "purchase_reasons, captured at ordering. An item with no row reads 'no reason recorded' and is never guessed at.",
        capital:
          "Live bottles x weighted-average cost from inventory_lot_rollup. Null where no cost is known.",
        totals:
          "capitalLocked is a three-way answer: a number, a real 0 meaning nothing is idle, or null meaning idle stock exists but nothing knows what it cost. When capitalLockedIsFloor is true the number is a FLOOR — some idle items could not be priced.",
        ordering:
          "Longest-sitting first, never-moved ahead of that. Dollar value plays no part in the order.",
      },
      totals,
      items,
    };
  }

  /**
   * `label` is for the log line only. The table literal stays at the call site
   * so the static schema guard can still see it.
   */
  private async run(label: string, build: () => any): Promise<any[]> {
    try {
      const { data, error } = await build();
      if (error) {
        this.logger.warn(`idle stock ${label} query failed: ${error.message}`);
        return [];
      }
      return data ?? [];
    } catch (err: any) {
      this.logger.warn(`idle stock ${label} query threw: ${err?.message}`);
      return [];
    }
  }

  private toRecord(row: any): PurchaseReasonRecord {
    const code = row.reason_code as PurchaseReasonCode;
    return {
      orderId: row.order_id,
      inventoryId: row.inventory_id,
      reasonCode: code,
      reasonLabel: PURCHASE_REASON_LABELS[code],
      capturedAt: row.captured_at,
      orderStatusAtCapture: row.order_status_at_capture,
      capturedBy: row.captured_by ?? null,
      note: row.note ?? null,
    };
  }
}
