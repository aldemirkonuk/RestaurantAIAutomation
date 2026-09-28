import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { assertInventoryBelongsToRestaurant } from "../common/tenant/assert-inventory-belongs-to-restaurant";
import { EventsService } from "../events/events.service";
import { EventType, SourcePage } from "../events/dto/event.dto";
import { queueResearchIfLibraryLacks } from "../inventory/house-item-research";
import {
  CreateInventoryTransactionDto,
  GetTransactionsQueryDto,
  InventoryTransactionResponseDto,
  TransactionsListResponseDto,
  InventoryBalanceResponseDto,
  TransactionSummaryResponseDto,
  BulkTransactionDto,
  BulkTransactionResponseDto,
  TransactionType,
  TransactionSource,
  StockType,
  ReconcileResultDto,
} from "./dto/inventory-ledger.dto";
import { mapStockCountResult } from "../inventory/stock-count-result";

// ============================================================================
// DATABASE ROW INTERFACE
// ============================================================================

interface TransactionRow {
  id: string;
  restaurant_id: string;
  inventory_id: string;
  wine_id: string;
  transaction_type: string;
  source: string;
  quantity_change: number;
  quantity_before: number;
  quantity_after: number;
  stock_type: string;
  reference_type: string | null;
  reference_id: string | null;
  pos_transaction_id: string | null;
  order_id: string | null;
  from_location_id: string | null;
  to_location_id: string | null;
  unit_cost: number | null;
  total_cost: number | null;
  performed_by: string | null;
  performed_by_type: string;
  reason: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  transaction_date: string;
  created_at: string;
}

// ============================================================================
// SERVICE
// ============================================================================

@Injectable()
export class InventoryLedgerService {
  private readonly logger = new Logger(InventoryLedgerService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly eventsService: EventsService,
  ) {}

  // ==========================================================================
  // CREATE TRANSACTION
  // ==========================================================================

  async createTransaction(
    restaurantId: string,
    userId: string,
    dto: CreateInventoryTransactionDto,
  ): Promise<InventoryTransactionResponseDto> {
    const startTime = Date.now();

    this.logger.log({
      message: "Creating inventory transaction",
      restaurantId,
      userId,
      inventoryId: dto.inventoryId,
      transactionType: dto.transactionType,
      quantityChange: dto.quantityChange,
    });

    // Validate quantity change is not zero
    if (dto.quantityChange === 0) {
      throw new BadRequestException("Quantity change cannot be zero");
    }

    // TENANCY, BEFORE THE WRITE (ADR 0141).
    //
    // `dto.inventoryId` is chosen by the caller. Until this check existed,
    // `restaurantId` — which arrives from the authenticated token — was logged
    // and then never used: not as a filter, not as a comparison, not as an
    // argument. `apply_stock_movement` derived the tenant from the inventory
    // row itself, so a well-formed UUID belonging to another house wrote that
    // house's lot and that house's ledger row. The DTO's @IsUUID cannot see
    // this; a foreign id is perfectly UUID-shaped.
    //
    // This runs BEFORE the RPC on purpose. A check that ran afterwards would
    // have refused the response while the stock had already moved.
    await assertInventoryBelongsToRestaurant(
      this.databaseService.supabase,
      restaurantId,
      dto.inventoryId,
      "createTransaction",
      this.logger,
    );

    // record_inventory_transaction referenced a `live_stock` column that does
    // not exist on restaurant_inventory and 500'd against the real database
    // (spine repair, decision A5) — every call now goes through
    // apply_stock_movement, the single stock write primitive, mirroring the
    // reconcile path below. order_id/fromLocationId/toLocationId map onto its
    // p_order_id/p_location_id (transfers are not yet modeled as a single
    // atomic movement — from/to would need two calls, which is out of scope
    // for this port and unchanged from the pre-existing gap).
    const { data, error } = await this.databaseService.supabase.rpc(
      "apply_stock_movement",
      {
        p_inventory_id: dto.inventoryId,
        p_stock_state: dto.stockType || StockType.LIVE,
        p_delta: dto.quantityChange,
        p_transaction_type: dto.transactionType,
        p_source: dto.source,
        p_performed_by: userId,
        p_reason: dto.reason || null,
        p_unit_cost: dto.unitCost || null,
        p_location_id: dto.toLocationId || dto.fromLocationId || null,
        p_order_id: dto.orderId || null,
        p_idempotency_key: dto.idempotencyKey,
        p_reference_type: dto.referenceType || null,
        p_reference_id: dto.referenceId || null,
        p_pos_transaction_id: dto.posTransactionId || null,
        p_notes: dto.notes || null,
        p_metadata: dto.metadata || {},
        // ADR 0141: the movement names the house it is for, so the primitive
        // refuses a mismatch instead of trusting this caller to have checked.
        // The check above and this argument are not redundant — one gives the
        // caller a sentence, the other holds when a future caller forgets.
        p_restaurant_id: restaurantId,
      },
    );

    if (error) {
      this.logger.error({
        message: "Failed to create inventory transaction",
        restaurantId,
        inventoryId: dto.inventoryId,
        error: error.message,
        durationMs: Date.now() - startTime,
      });
      throw error;
    }
    if (!data) {
      // apply_stock_movement returns the EXISTING transaction id on a replayed
      // idempotency key, and NULL only when p_delta was zero — already
      // rejected above. A NULL here means this call landed on a prior
      // transaction whose id we don't have; that is a caller bug (reusing a
      // key across genuinely different transactions), not a retry.
      throw new BadRequestException(
        "apply_stock_movement returned no transaction id",
      );
    }

    // Fetch the created transaction.
    //
    // NOT `getTransaction` (ADR 0141). That method answers a READ — "show me
    // transaction X" — where an empty result genuinely means not found. Here
    // the id came back from a write that committed, so an empty result is not
    // a missing row: it is a contradiction between what the database returned
    // and what this restaurant can see. Reporting it as "Transaction not
    // found" is what made the tenant hole look like a failure to the caller
    // while the other house's ledger had already been written.
    const transaction = await this.readBackCreatedTransaction(
      restaurantId,
      data,
    );

    // Emit event to event ingestion system
    try {
      await this.eventsService.createEvent(restaurantId, userId, {
        eventType: EventType.INVENTORY_CHANGE,
        sourcePage: SourcePage.INVENTORY,
        payload: {
          wineId: dto.wineId,
          quantity: dto.quantityChange,
          previousQuantity: transaction.quantityBefore,
          changeType: this.mapTransactionTypeToChangeType(dto.transactionType),
          reason: dto.reason,
          transactionId: transaction.id,
          source: dto.source,
        },
      });
    } catch (e) {
      this.logger.warn("Failed to emit inventory change event", e);
    }

    // THE SAME RULE AT THIS DOOR TOO (founder, 2026-09-22, round 6z,
    // verbatim pick 8: "Queue it; Mudavym + hold (Recommended)"): this was
    // the one API-only path ADR 0192 stated as "not wired" — the ledger
    // endpoint books whatever type its caller names, and none of it queued
    // research. Now it does, once per item id, same as every other booking
    // path (`queueResearchIfLibraryLacks`): only a booking IN (a positive
    // delta) can be receiving a wine the library lacks. Never blocks the
    // response; a failure is logged.
    if (dto.quantityChange > 0) {
      const research = await queueResearchIfLibraryLacks(this.databaseService.supabase, {
        restaurantId,
        inventoryId: dto.inventoryId,
        queuedFrom: "receiving",
        sourceOrderId: dto.orderId || null,
        queuedBy: userId,
      });
      if (research && !research.ok) {
        this.logger.error({
          message: "Inventory transaction booked, but the item was not queued for research",
          restaurantId,
          inventoryId: dto.inventoryId,
          error: research.error,
        });
      }
    }

    this.logger.log({
      message: "Inventory transaction created",
      restaurantId,
      transactionId: transaction.id,
      quantityBefore: transaction.quantityBefore,
      quantityAfter: transaction.quantityAfter,
      durationMs: Date.now() - startTime,
    });

    return transaction;
  }

  // ==========================================================================
  // BULK CREATE
  // ==========================================================================

  async createBulkTransactions(
    restaurantId: string,
    userId: string,
    dto: BulkTransactionDto,
  ): Promise<BulkTransactionResponseDto> {
    const startTime = Date.now();
    const createdIds: string[] = [];
    const errors: { index: number; error: string }[] = [];

    this.logger.log({
      message: "Creating bulk inventory transactions",
      restaurantId,
      count: dto.transactions.length,
    });

    for (let i = 0; i < dto.transactions.length; i++) {
      try {
        const transaction = await this.createTransaction(
          restaurantId,
          userId,
          dto.transactions[i],
        );
        createdIds.push(transaction.id);
      } catch (error) {
        errors.push({ index: i, error: error.message });
      }
    }

    this.logger.log({
      message: "Bulk transactions completed",
      restaurantId,
      successCount: createdIds.length,
      failedCount: errors.length,
      durationMs: Date.now() - startTime,
    });

    return {
      successCount: createdIds.length,
      failedCount: errors.length,
      createdIds,
      errors,
    };
  }

  // ==========================================================================
  // READ-BACK AFTER A WRITE (ADR 0141)
  // ==========================================================================

  /**
   * The read that follows a COMMITTED write, which is a different question
   * from `getTransaction`'s.
   *
   * `apply_stock_movement` returned an id. The row therefore exists. Three
   * outcomes are possible here and they are three different facts:
   *
   *  - the row comes back → the ordinary case;
   *  - the read FAILS (`error`) → we do not know; say so, and do not invent an
   *    answer either way (ADR 0051);
   *  - the read succeeds and finds NOTHING → the row exists but is not visible
   *    under this restaurant. That is a contradiction, not a missing row, and
   *    it is what the tenant hole looked like from the caller's side: a
   *    committed write reported as "Transaction not found".
   *
   * Since the ownership assertion in `createTransaction` this last state
   * should be unreachable through that path. It is still reported as what it
   * is, because the next way to reach it will not announce itself.
   */
  private async readBackCreatedTransaction(
    restaurantId: string,
    transactionId: string,
  ): Promise<InventoryTransactionResponseDto> {
    const { data, error } = await this.databaseService.supabase
      .from("inventory_transactions")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("id", transactionId)
      .maybeSingle();

    if (error) {
      this.logger.error({
        message: "Stock moved, but the ledger row could not be read back",
        restaurantId,
        transactionId,
        error: error.message,
      });
      throw new InternalServerErrorException(
        `The stock movement was written as transaction ${transactionId}, but ` +
          `reading it back failed (${error.message}). The movement stands — ` +
          `nothing was rolled back — and this response could not describe it.`,
      );
    }

    if (!data) {
      this.logger.error({
        message:
          "Stock moved under a restaurant this caller cannot see — tenant contradiction",
        restaurantId,
        transactionId,
      });
      throw new InternalServerErrorException(
        `apply_stock_movement committed transaction ${transactionId}, but no ` +
          `such row is visible under this restaurant. The write HAPPENED and ` +
          `it did not happen here. This is a contradiction, not a missing ` +
          `transaction, and it is reported rather than shown as "not found".`,
      );
    }

    return this.mapTransaction(data);
  }

  // ==========================================================================
  // READ
  // ==========================================================================

  async getTransaction(
    restaurantId: string,
    transactionId: string,
  ): Promise<InventoryTransactionResponseDto> {
    const { data, error } = await this.databaseService.supabase
      .from("inventory_transactions")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("id", transactionId)
      .single();

    if (error || !data) {
      throw new BadRequestException(`Transaction not found: ${transactionId}`);
    }

    return this.mapTransaction(data);
  }

  async listTransactions(
    restaurantId: string,
    query: GetTransactionsQueryDto,
  ): Promise<TransactionsListResponseDto> {
    const startTime = Date.now();
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const fromIndex = (page - 1) * limit;
    const toIndex = fromIndex + limit - 1;

    this.logger.debug({
      message: "Listing inventory transactions",
      restaurantId,
      query,
    });

    let supabaseQuery = this.databaseService.supabase
      .from("inventory_transactions")
      .select("*", { count: "exact" })
      .eq("restaurant_id", restaurantId);

    if (query.inventoryId) {
      supabaseQuery = supabaseQuery.eq("inventory_id", query.inventoryId);
    }

    if (query.wineId) {
      supabaseQuery = supabaseQuery.eq("wine_id", query.wineId);
    }

    if (query.transactionType) {
      supabaseQuery = supabaseQuery.eq(
        "transaction_type",
        query.transactionType,
      );
    }

    if (query.source) {
      supabaseQuery = supabaseQuery.eq("source", query.source);
    }

    if (query.startDate) {
      supabaseQuery = supabaseQuery.gte("transaction_date", query.startDate);
    }

    if (query.endDate) {
      supabaseQuery = supabaseQuery.lte("transaction_date", query.endDate);
    }

    const { data, error, count } = await supabaseQuery
      .order("transaction_date", { ascending: false })
      .range(fromIndex, toIndex);

    if (error) {
      this.logger.error({
        message: "Failed to list transactions",
        restaurantId,
        error: error.message,
        durationMs: Date.now() - startTime,
      });
      throw error;
    }

    const transactions = (data || []).map((row: TransactionRow) =>
      this.mapTransaction(row),
    );
    const total = count ?? transactions.length;

    this.logger.debug({
      message: "Transactions listed",
      restaurantId,
      resultCount: transactions.length,
      total,
      durationMs: Date.now() - startTime,
    });

    return {
      transactions,
      total,
      page,
      limit,
      hasMore: fromIndex + transactions.length < total,
    };
  }

  // ==========================================================================
  // BALANCE QUERIES
  // ==========================================================================

  async getBalanceAt(
    restaurantId: string,
    inventoryId: string,
    asOf: string,
    stockType: StockType = StockType.LIVE,
  ): Promise<InventoryBalanceResponseDto> {
    const { data, error } = await this.databaseService.supabase.rpc(
      "get_inventory_balance_at",
      {
        p_inventory_id: inventoryId,
        p_as_of: asOf,
        p_stock_type: stockType,
      },
    );

    if (error) {
      this.logger.error({
        message: "Failed to get balance at point in time",
        inventoryId,
        asOf,
        error: error.message,
      });
      throw error;
    }

    return {
      inventoryId,
      balance: data || 0,
      asOf,
      stockType,
    };
  }

  async getTransactionHistory(
    restaurantId: string,
    inventoryId: string,
    days: number = 30,
  ): Promise<InventoryTransactionResponseDto[]> {
    const startDate = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data, error } = await this.databaseService.supabase
      .from("inventory_transactions")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("inventory_id", inventoryId)
      .gte("transaction_date", startDate)
      .order("transaction_date", { ascending: false });

    if (error) {
      throw error;
    }

    return (data || []).map((row: TransactionRow) => this.mapTransaction(row));
  }

  // ==========================================================================
  // SUMMARY & ANALYTICS
  // ==========================================================================

  async getTransactionSummary(
    restaurantId: string,
    startDate: string,
    endDate: string,
  ): Promise<TransactionSummaryResponseDto> {
    const { data, error } = await this.databaseService.supabase
      .from("inventory_transactions")
      .select("transaction_type, source, quantity_change")
      .eq("restaurant_id", restaurantId)
      .gte("transaction_date", startDate)
      .lte("transaction_date", endDate);

    if (error) {
      throw error;
    }

    const transactions = data || [];

    // Calculate summaries
    let totalIn = 0;
    let totalOut = 0;
    const byType: Record<string, { count: number; quantity: number }> = {};
    const bySource: Record<string, { count: number; quantity: number }> = {};

    for (const txn of transactions) {
      const qty = txn.quantity_change;

      if (qty > 0) {
        totalIn += qty;
      } else {
        totalOut += Math.abs(qty);
      }

      // By type
      if (!byType[txn.transaction_type]) {
        byType[txn.transaction_type] = { count: 0, quantity: 0 };
      }
      byType[txn.transaction_type].count++;
      byType[txn.transaction_type].quantity += qty;

      // By source
      if (!bySource[txn.source]) {
        bySource[txn.source] = { count: 0, quantity: 0 };
      }
      bySource[txn.source].count++;
      bySource[txn.source].quantity += qty;
    }

    return {
      restaurantId,
      period: `${startDate} to ${endDate}`,
      totalIn,
      totalOut,
      netChange: totalIn - totalOut,
      transactionCount: transactions.length,
      byType,
      bySource,
    };
  }

  // ==========================================================================
  // RECONCILIATION
  // ==========================================================================

  /**
   * Reconcile an item against a physical count.
   *
   * ADR 0078 — A COUNT IS A RECORD. Two things changed here.
   *
   * 1. THE 400 IS GONE. This used to `throw new BadRequestException("No
   *    adjustment needed - counts match")` when the difference was zero, so a
   *    manager who counted a shelf and found it correct got an error. That was
   *    not a cosmetic wart: it is the same fault as the missing ledger row, one
   *    layer up. The successful outcome had no representation, so the system
   *    could only ever hear about counts that went wrong. Agreement now returns
   *    200 with the recorded count and `transaction: null`.
   *
   * 2. THE EXPECTED QUANTITY IS READ UNDER A LOCK. The old code SELECTed
   *    `restaurant_inventory.stock_live` — an unlocked read of a trigger
   *    -maintained projection — and computed the delta in JS against it. That
   *    is exactly the A11 race `set_stock_absolute` was written to fix, and it
   *    also meant the "Expected N" written into the reason string could differ
   *    from the value the delta was actually computed against.
   *    `record_stock_count` locks the row first and reads the lot sum under it.
   */
  async reconcileInventory(
    restaurantId: string,
    userId: string,
    inventoryId: string,
    wineId: string,
    actualCount: number,
    notes?: string,
    clientCountId?: string,
  ): Promise<ReconcileResultDto> {
    if (
      actualCount == null ||
      Number.isNaN(Number(actualCount)) ||
      Number(actualCount) < 0
    ) {
      throw new BadRequestException(
        "actualCount must be a non-negative number",
      );
    }

    // A client-supplied id makes a retry idempotent; the timestamped fallback
    // does NOT, and never did. It is preserved deliberately rather than being
    // silently upgraded: the count row inherits exactly the retry-safety the
    // caller supplies, no better and no worse. A reconcile retried without a
    // clientCountId records a second count, the same way it previously applied a
    // second movement.
    const idempotencyKey = clientCountId
      ? `reconcile:${inventoryId}:${clientCountId}`
      : `reconcile:${inventoryId}:${Date.now()}`;

    // ADR 0141, Correction 2026-09-12. The route names only an inventory id,
    // and record_stock_count derives the house from that item and calls
    // apply_stock_movement without p_restaurant_id -- so neither database-side
    // refusal runs. Measured by the adversarial pass: a probe calling it for
    // house B on house A's item took A's lots from 9 to 0 and wrote a count
    // stamped A, and the scoped getTransaction below then answered 'not
    // found' for a write that had committed. Checked BEFORE the RPC.
    await assertInventoryBelongsToRestaurant(
      this.databaseService.supabase,
      restaurantId,
      inventoryId,
      "reconcileInventory",
      this.logger,
    );

    const { data: raw, error: rpcError } =
      await this.databaseService.supabase.rpc("record_stock_count", {
        p_inventory_id: inventoryId,
        p_counted_qty: Math.round(Number(actualCount)),
        p_idempotency_key: idempotencyKey,
        p_stock_state: "live",
        p_source: "reconciliation",
        p_transaction_type: "reconciliation",
        p_performed_by: userId,
        p_reason: notes
          ? `Physical count reconciliation — ${notes}`
          : "Physical count reconciliation",
      });

    if (rpcError) {
      this.logger.error({
        message: "Reconciliation record_stock_count failed",
        inventoryId,
        wineId,
        error: rpcError.message,
      });
      throw new BadRequestException(
        rpcError.message || "Failed to record the count",
      );
    }

    const count = mapStockCountResult(raw);
    if (!count) {
      // A successful RPC always returns an object. Nothing back means the call
      // did not do what it claims, and reporting success here would be the same
      // absence-as-health fault this ADR exists to remove.
      this.logger.error({
        message: "record_stock_count returned no payload",
        inventoryId,
      });
      throw new BadRequestException(
        "The count could not be confirmed as recorded",
      );
    }

    // `transaction` is null exactly when the count agreed. It is a result, not
    // an error and not missing data.
    const transaction = count.transactionId
      ? await this.getTransaction(restaurantId, count.transactionId)
      : null;

    return { count, transaction };
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private mapTransaction(row: TransactionRow): InventoryTransactionResponseDto {
    return {
      id: row.id,
      restaurantId: row.restaurant_id,
      inventoryId: row.inventory_id,
      wineId: row.wine_id,
      transactionType: row.transaction_type as TransactionType,
      source: row.source as TransactionSource,
      quantityChange: row.quantity_change,
      quantityBefore: row.quantity_before,
      quantityAfter: row.quantity_after,
      stockType: row.stock_type as StockType,
      referenceType: row.reference_type || undefined,
      referenceId: row.reference_id || undefined,
      posTransactionId: row.pos_transaction_id || undefined,
      orderId: row.order_id || undefined,
      fromLocationId: row.from_location_id || undefined,
      toLocationId: row.to_location_id || undefined,
      unitCost: row.unit_cost || undefined,
      totalCost: row.total_cost || undefined,
      performedBy: row.performed_by || undefined,
      performedByType: row.performed_by_type,
      reason: row.reason || undefined,
      notes: row.notes || undefined,
      metadata: row.metadata,
      transactionDate: row.transaction_date,
      createdAt: row.created_at,
    };
  }

  private mapTransactionTypeToChangeType(
    type: TransactionType,
  ): "add" | "remove" | "adjust" | "transfer" {
    switch (type) {
      case TransactionType.PURCHASE:
      case TransactionType.RETURN:
      case TransactionType.INITIAL:
        return "add";
      case TransactionType.SALE:
      case TransactionType.WASTE:
      case TransactionType.COMP:
        return "remove";
      case TransactionType.TRANSFER:
        return "transfer";
      default:
        return "adjust";
    }
  }
}
